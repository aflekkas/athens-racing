// PARALIAKI: race a rival down the real Athens Riviera coast road, Vouliagmeni -> the lake -> Limanakia -> Varkiza -> Lomvarda.
// World built from OpenStreetMap data (see tools/). Boots straight into a countdown, no click needed.
import * as THREE from 'three';
import { loadMap, LANE_W } from './map.js';
import { Ground, Splash, buildHumps, buildBarriers } from './ground.js';
import { buildRoadside } from './roadside.js';
import { Fx } from './fx.js';
import * as ENV from './env.js';
import { buildTerrain } from './terrain.js';
import { buildRoad, ROAD } from './road.js';
import { buildBuildings, infillBuildings, LabelAtlas } from './buildings.js';
import { buildNature } from './nature.js';
import { CARS, CarModel, Driver, setCarEnv } from './cars.js';
import { Vehicle } from './physics.js';
import { Traffic, routeVel, setRouteVel, pushVeh, extents } from './traffic.js';
import { Cockpit } from './cockpit.js';
import { findJunctions, Signals } from './signals.js';
import { People } from './people.js';
import { Hud, fmtTime } from './hud.js';
import { Audio } from './audio.js';
import { createPost } from './post.js';
import { loadTextures, uploadTextures } from './tex.js';
import { batchStatic } from './batch.js';
import { clamp, lerp, damp, smoothstep, frameYield } from './util.js';
import { Multiplayer } from './multiplayer.js';
import { trackVersion } from './network-track.js';
import { simplifyScenery } from './graphics.js';

const Q = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);
const RIVAL_NAME = 'STAVROS';
const RIVAL_BODY = { mini: 'z4', z4: 'mini', taxi: 'mini' };
const RED_LINES = ['SMILE FOR THE CAMERA', 'SAY CHEESE!', 'THE FINE IS IN THE POST', 'THAT WAS VERY RED', 'YOUR MOTHER WILL HEAR ABOUT THIS', 'THE TRAFFIC COP SAW THAT'];
const SHOUTS = ['WATCH IT!', 'MY MIRROR!', 'SORRY, BOSS!', 'NOT THE PAINT!', 'WHO TAUGHT YOU TO DRIVE?', 'INSURANCE!', 'MAMA MIA!'];

function fail(e) { console.error(e); const el = $('err'); el.style.display = 'block'; el.textContent = 'Error: ' + (e && e.message || e); }
window.addEventListener('error', (e) => fail(e.error || e.message));
const lstat = (t, f) => { $('lstat').textContent = t; if (f !== undefined) $('lfill').style.width = (f * 100) + '%'; };

// ------------------------------------------------------------------ renderer
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
let graphicsPreference = Q.get('quality') || 'auto';
try { if (!Q.has('quality')) graphicsPreference = localStorage.getItem('paraliaki.graphics') || 'auto'; } catch {}
const gl = renderer.getContext(), gpuInfo = gl.getExtension('WEBGL_debug_renderer_info');
const gpuName = gpuInfo ? gl.getParameter(gpuInfo.UNMASKED_RENDERER_WEBGL) : '';
const lowGraphics = graphicsPreference === 'low' || (graphicsPreference === 'auto' && /SwiftShader|llvmpipe|softpipe|Software/i.test(gpuName));
window.__renderInfo = () => ({ gpu: gpuName, lowGraphics, pixelRatio });
const DPR = Math.min(window.devicePixelRatio || 1, lowGraphics ? 0.8 : 1.5);
const graphicsControl = document.createElement('select'); graphicsControl.id = 'graphics-quality'; graphicsControl.setAttribute('aria-label', 'Graphics quality');
for (const [value, label] of [['auto', 'GRAPHICS: AUTO'], ['high', 'GRAPHICS: HIGH'], ['low', 'GRAPHICS: LOW']]) { const option = document.createElement('option'); option.value = value; option.textContent = label; graphicsControl.append(option); }
graphicsControl.value = graphicsPreference; document.body.append(graphicsControl);
graphicsControl.onchange = () => { try { localStorage.setItem('paraliaki.graphics', graphicsControl.value); } catch {} const url = new URL(location.href); url.searchParams.set('quality', graphicsControl.value); location.href = url; };
let pixelRatio = DPR;
renderer.setPixelRatio(pixelRatio);
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping; // tone mapping happens in the post pipeline (post.js)
ENV.installAerial(ENV.AP_K); // aerial perspective replaces three's fog in every material
renderer.shadowMap.enabled = !lowGraphics;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(new THREE.Color('#c3cdd6'), 0.00011); // only switches USE_FOG on; see ENV.installAerial
const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.05, 16000);
const mirrorCam = new THREE.PerspectiveCamera(42, 3.6, 0.4, 600);
const mirrorRT = new THREE.WebGLRenderTarget(512, 144, { type: THREE.HalfFloatType });
const audio = new Audio();
audio.onTrack = (t) => hud.message(`♪ <i>${t.title}</i> · ${t.artist}`, 3);

// ------------------------------------------------------------------ game state
const G = {
  state: 'loading', t: 0, raceT: 0, countT: 0, cam: Q.get('cam') === 'chase' ? 'chase' : 'cockpit', userCam: Q.get('cam') === 'chase' ? 'chase' : 'cockpit', carIdx: 0, selIdx: 0, menuFrom: null,
  style: 0, combo: 0, comboT: 0, nearMisses: 0, crashes: 0, topSpeed: 0, pFinish: null, rFinish: null, lastLead: 0, leadT: 0,
  shake: 0, flash: 0, driftAcc: 0, driftT: 0, markIdx: 0, finishedT: 0, orbitA: 0, autodrive: Q.has('autodrive'),
};
window.__game = G;
window.__audio = () => audio.levels && audio.levels();
window.__bus = () => audio.busLevels && audio.busLevels();
window.__dbg = () => ({ state: G.state, raceT: +G.raceT.toFixed(2), fps: Math.round(G.fps), pr: pixelRatio, kmh: Math.round(player.veh.kmh), gear: player.veh.gear, rpm: Math.round(player.veh.rpm), s: Math.round(player.veh.s), u: +player.veh.u.toFixed(2), rs: Math.round(rival.veh.s), rkmh: Math.round(rival.veh.kmh), ru: +rival.veh.u.toFixed(2), rlane: rival.ai.lane, rrev: rival.ai.revT > 0, rdbg: rival.ai.dbg, pdbg: player.ai && player.ai.dbg, crashes: G.crashes, near: G.nearMisses, style: G.style, pen: G.pen, reds: G.reds, rPen: G.rPen, rReds: G.rReds, scared: G.scared, peds: people.peds.filter((p) => p.active).length, onRoad: people.onRoad.length, calls: renderer.info.render.calls, tris: renderer.info.render.triangles });
let map, route, hud, traffic, water, sky, sun, post, assets, startS, signals, people, probe, probeSeed;
let ground = null, splash = null, fx = null;
const lodList = [];
function updateLod() {
  const cx = camera.position.x, cz = camera.position.z;
  for (const m of lodList) { const c = m.boundingSphere.center, dc = Math.hypot(c.x - cx, c.z - cz), d = dc - m.boundingSphere.radius; m.visible = d < m.userData.far && (!m.userData.near || dc + m.boundingSphere.radius * 0.3 > m.userData.near); }
}
let player = null, rival = null; // {veh, model, driver, cockpit, spec}
const keys = new Set();
const input = { throttle: 0, brake: 0, steer: 0, steerRaw: 0, handbrake: false, nitro: false };

// ------------------------------------------------------------------ boot
const T0 = performance.now(); const tlog = (n) => { if (Q.has('debug')) console.log(n, Math.round(performance.now() - T0), 'abs', Math.round(performance.now())); };
async function boot() {
  tlog('boot');
  lstat('LOADING MAP DATA', 0.05);
  const texReady = loadTextures(); // decodes in parallel with the world building below
  map = await loadMap();
  route = map.route;
  startS = route.start;
  hud = new Hud(map);
  hud.drawOverview($('overview'));
  tlog('map');
  lstat('BUILDING TERRAIN', 0.25); await frameYield();
  sky = ENV.createSky(); scene.add(sky);
  const baked = ENV.bakeSky(renderer, sky); probeSeed = baked.cube;
  scene.environment = baked.env;
  ({ sun } = ENV.createLights(scene));
  const infill = infillBuildings(map, (x, z) => map.terrain.height(x, z));
  if (Q.has('debug')) console.log('infill buildings', infill.length);
  const ter = buildTerrain(map.terrain, route, [], scene);
  tlog('terrain');
  water = ENV.createWater(baked.cube, map.terrain, ENV.makeDepthTexture(map.terrain)); scene.add(water.mesh);
  water.setSize(innerWidth * pixelRatio, innerHeight * pixelRatio);
  if (lowGraphics) simplifyScenery(sky, baked.cube, water, ter);
  const labels = new LabelAtlas();
  assets = { labels, water, makeLabel: (t, w, h, bg, fg) => { const r = labels.add(t, bg, fg); return r ? labels.plane(r, w, h) : new THREE.Group(); } };
  lstat('PAVING POSEIDONOS AVENUE', 0.4); await frameYield();
  assets.junctions = findJunctions(map);
  const road = buildRoad(map, scene, ter.heightC, assets);
  assets.asphalt = road.asphalt;
  signals = new Signals(map, scene, road.group, assets.junctions);
  tlog('road');
  lstat('RAISING VOULIAGMENI', 0.55); await frameYield();
  const bld = buildBuildings(map, scene, ter.heightC, labels, infill);
  tlog('buildings');
  lstat('PLANTING PALMS AND PINES', 0.7); await frameYield();
  const nat = buildNature(map, scene, ter.heightC, bld, assets);
  lstat('WAKING UP THE LOCALS', 0.78); await frameYield();
  people = new People(map, scene, assets, nat.group);
  const roadside = buildRoadside(map, scene, ter.heightC, assets); // stairs, retaining walls, bus shelters, canteens, beach bar
  const bs = [batchStatic(road.group), batchStatic(bld.group), batchStatic(nat.group)];
  if (Q.has('debug')) console.log('batched', JSON.stringify(bs));
  tlog('nature');
  scene.add(ENV.createFarScenery(map.data.proj));
  lstat('FUELLING THE CARS', 0.85); await frameYield();
  // distance culling for instanced props (cells carry userData.far)
  scene.traverse((o) => { if (lowGraphics && o.userData.far) o.userData.far = Math.min(o.userData.far, 700); if ((o.isInstancedMesh || o.userData.lod) && o.userData.far && o.boundingSphere) lodList.push(o); });
  traffic = new Traffic(scene, route, map.data);
  traffic.disabled = Q.has('notraffic');
  traffic.signals = signals; traffic.people = people; people.traffic = traffic;
  traffic.busStops = (assets.busStops || []).slice().sort((a, b) => a - b);
  ground = new Ground(map, ter.heightC, assets);
  traffic.buildParkedRows(scene, ground);
  ground.parked = traffic.parkedCars.concat(roadside.obstacles); // parked cars and roadside props are solid
  traffic.ground = ground; // crashed traffic slides off the road onto what's really there
  buildHumps(map, scene, ter.heightC);
  buildBarriers(map, scene);
  splash = new Splash(scene);
  fx = new Fx(scene, route, ground);
  window.__sim = { signals, people, traffic, route, ground, fx, G, input, look, get player() { return player; } };
  // ?simhook: headless tests advance the game without rendering (software GL draws ~1 frame/s)
  if (Q.has('simhook')) Object.assign(window.__sim, { keys, step: (n = 1, dt = 1 / 60) => { for (let i = 0; i < n; i++) step(dt, false); } });
  post = createPost(renderer, scene, camera, { lowQuality: lowGraphics });
  probe = createProbe();
  setCarEnv(probe.envRT.texture);
  tlog('traffic+post');
  setCar(Q.has('car') ? clamp(+Q.get('car') - 1, 0, CARS.length - 1) : 0, false);
  resetRace();
  updateCamera(0, true);
  lstat('WARMING TYRES', 0.95);
  await texReady; uploadTextures(renderer);
  tlog('textures');
  updateLod();
  try { await renderer.compileAsync(scene, camera); } catch (e) { /* older drivers: compile on first frame */ }
  tlog('compiled');
  onResize();
  document.body.classList.add('loaded');
  lstat('READY', 1);
  G.state = 'countdown'; G.countT = 0; G.countShown = -1;
  document.body.classList.add('counting');
  multiplayer.loaded = true;
  multiplayer.trackVersion = trackVersion(map.data.route);
  if (multiplayer.active) { setCar(Math.max(0, CARS.findIndex(c => c.id === multiplayer.me.car))); onlineWait(); onlineMembers(multiplayer.lobby.players.filter(p => p.id !== multiplayer.id)); multiplayer.renderRoom(); }
  tlog('ready');
  last = performance.now();
  requestAnimationFrame(frame);
}

// ------------------------------------------------------------------ cars
function makeCar(spec, isPlayer) {
  const model = new CarModel(spec);
  scene.add(model.root);
  const driver = new Driver(isPlayer ? {} : { helmet: true, shirt: '#16181c', skin: '#b67c56' });
  driver.root.position.copy(model.seat).add(new THREE.Vector3(0, -0.195, 0.1));
  model.body.add(driver.root);
  if (spec.body !== 'mini' && driver.curlMesh) { driver.curlMesh.scale.setScalar(0.82); driver.hairBase.scale.multiplyScalar(0.85); }
  if (!isPlayer) for (const a of driver.arms) a.up.visible = a.fo.visible = a.hand.visible = false;
  return { model, driver };
}
function disposeCar(c) {
  if (!c) return;
  scene.remove(c.model.root);
  const liveMaterials = new Set(), liveTextures = new Set();
  scene.traverse(o => { for (const m of Array.isArray(o.material) ? o.material : o.material ? [o.material] : []) { liveMaterials.add(m); if (m.map) liveTextures.add(m.map); } });
  const geometries = new Set(), materials = new Set(), textures = new Set();
  c.model.root.traverse(o => {
    if (o.geometry && !o.geometry.userData.shared) geometries.add(o.geometry);
    for (const m of Array.isArray(o.material) ? o.material : o.material ? [o.material] : []) if (!liveMaterials.has(m)) { materials.add(m); if (m.map?.isCanvasTexture && !liveTextures.has(m.map)) textures.add(m.map); }
  });
  for (const resource of [...geometries, ...materials, ...textures]) resource.dispose();
}


function setCar(idx, keepPose = true) {
  const old = player;
  const spec = CARS[idx];
  G.carIdx = idx; G.selIdx = idx;
  disposeCar(old);
  const pc = makeCar(spec, true);
  const veh = old ? old.veh : new Vehicle(spec, route);
  veh.setSpec(spec); veh.gear = Math.min(veh.gear, spec.gears.length);
  player = { spec, veh, ...pc };
  veh.ground = ground;
  player.cockpit = new Cockpit(spec, pc.model, mirrorRT.texture);
  audio.setEngine(spec);
  // rival: a different body, same performance envelope so the race is fair
  const rb = CARS.find((c) => c.id === RIVAL_BODY[spec.id]) || CARS[1];
  const rspec = { ...rb }; // A rival keeps its actual chassis, driven axle, engine and dimensions.
  disposeCar(rival);
  const rc = makeCar(rspec, false);
  const rveh = rival ? rival.veh : new Vehicle(rspec, route);
  rveh.setSpec(rspec); rveh.gear = Math.min(rveh.gear, rspec.gears.length);
  rival = { spec: rspec, veh: rveh, ...rc, ai: rival ? rival.ai : { lane: 0, cool: 0 } };
  $('rivalName').textContent = RIVAL_NAME;
  applyCamMode();
  if (keepPose) { syncCar(player, 0); syncCar(rival, 0); }
}

function resetRace() {
  const s0 = Q.has('s') ? +Q.get('s') : startS;
  player.veh.reset(s0, route.laneU(s0, 1), 0);
  rival.veh.reset(s0 + 9, route.laneU(s0 + 9, 0), 0);
  for (const v of [player.veh, rival.veh]) { v.nitro = 0.4; v.dragMul = 1; v.wallHit = 0; v.safe = null; v.water = 0; }
  G.sinkT = 0; G.sinkFade = false; G.stuckT = 0; G.stuckHint = false; G.towing = false;
  if (fx) fx.clearMarks();
  rival.ai = { lane: 0, u: route.laneU(s0 + 9, 0), cool: 0, mistakeT: 20 + Math.random() * 20, sigJ: -1 };
  if (player.ai) player.ai.sigJ = -1;
  signals.reset();
  traffic.reset(s0);
  people.reset(s0);
  Object.assign(G, { raceT: 0, style: 0, combo: 0, comboT: 0, nearMisses: 0, crashes: 0, topSpeed: 0, pFinish: null, rFinish: null, lastLead: 0, leadT: 0, driftAcc: 0, driftT: 0, shake: 0, flash: 0, finishedT: 0, rivalBanner: false, cones: 0,
    pen: 0, rPen: 0, reds: 0, rReds: 0, scared: 0, polite: 0, postT: 0, pFront: null, rFront: null, tickT: 0, waitJ: -1 });
  const n = Math.ceil((route.finish - startS) / 10) + 2;
  G.tP = new Float32Array(n).fill(NaN); G.tR = new Float32Array(n).fill(NaN);
  G.markIdx = map.data.marks.findIndex((m) => m.s > s0 + 50); if (G.markIdx < 0) G.markIdx = map.data.marks.length;
  syncCar(player, 0); syncCar(rival, 0);
}

// ---- into the sea (or the lake): a splash, the car settles and sinks, and you're put back on the road where you left it
function seaCheck(pv, dt) {
  if (!pv.ground) return;
  if (pv.water > 0.2 && !G.sinkT) {
    G.sinkT = 1e-3;
    const v = pv.velocityWorld(new THREE.Vector3()), sp = Math.hypot(v.x, v.z);
    splash.burst(pv.x, pv.z, v.x, v.z, sp / 18);
    audio.noise({ dur: 1.4, f: 500, type: 'lowpass', gain: 0.5 * Math.min(1, 0.4 + sp / 25) });
    audio.noise({ dur: 0.5, f: 2400, type: 'bandpass', q: 0.8, gain: 0.25 });
    G.shake = Math.max(G.shake, Math.min(0.7, sp / 30));
    hud.message('<i>SPLASH</i> · BACK ON THE ROAD', 2.4);
  }
  if (G.sinkT) {
    G.sinkT += dt;
    if (G.sinkT > 2.4 && !G.sinkFade) { G.sinkFade = true; document.body.classList.add('fading'); }
    if (G.sinkT > 2.7) {
      backOnRoad(pv);
      G.sinkT = 0; G.sinkFade = false; pv.water = 0;
      setTimeout(() => document.body.classList.remove('fading'), 120);
    }
  }
}
// put the car back in a lane where it was last safely on the road
function backOnRoad(pv) {
  const sf = pv.safe || { s: pv.s, u: route.laneU(pv.s, 1) };
  const s = clamp(sf.s, 5, route.length - 5), lanes = route.lanes(s);
  const lane = clamp(Math.round((Math.abs(sf.u) - route.medHalf(s)) / LANE_W - 0.5), 0, lanes - 1);
  pv.reset(s, Math.sign(sf.u || 1) * route.laneU(s, lane), 0);
  if (sf.u < 0) pv.yaw += Math.PI; // you were on the far side heading back: face the way you came
  pv._curbZ = null; pv._gx = pv._gz = pv._gy = undefined; pv.air = 0; pv.vy = 0;
}

// ---- stuck (dug into the sand, wheels spinning against a bank, wedged in the scrub): after a few seconds of trying,
// a hint (back out with S, ease the throttle); T calls a tow back onto the road at any time, and after a long
// fight the tow comes on its own
function stuckCheck(pv, dt) {
  if (G.state !== 'race' || G.sinkT || G.towing) { G.stuckT = 0; return; }
  const trying = input.throttle > 0.3 || input.brake > 0.3;
  const stuck = trying && pv.kmh < 3 && (pv.offroad || pv.dig > 0.15 || pv.wheelspin > 0.3);
  G.stuckT = stuck ? G.stuckT + dt : Math.max(0, G.stuckT - dt * 0.5);
  if (G.stuckT > 2.5 && !G.stuckHint) {
    G.stuckHint = true;
    hud.message(pv.surf === 'sand' ? 'STUCK IN THE SAND · HOLD <i>S</i> TO BACK OUT, THEN EASE ON · <i>T</i> FOR A TOW' : 'STUCK? HOLD <i>S</i> TO BACK OUT · <i>T</i> FOR A TOW', 4.5);
  }
  if (G.stuckT <= 0) G.stuckHint = false;
  if (G.stuckT > 14) tow(pv);
}
function tow(pv) {
  if (G.state !== 'race' || G.sinkT || G.towing) return;
  G.towing = true; G.stuckT = 0;
  document.body.classList.add('fading');
  setTimeout(() => {
    G.towing = false;
    if (G.state !== 'race') { document.body.classList.remove('fading'); return; }
    backOnRoad(pv);
    hud.message('<i>TOWED</i> · BACK ON THE ROAD', 2);
    setTimeout(() => document.body.classList.remove('fading'), 120);
  }, 320);
}

function startCountdown() {
  G.state = 'countdown'; G.countT = 0; G.countShown = -1; G.countWall = 0;
  document.body.classList.remove('racing'); document.body.classList.add('counting');
  hud.hideMenu();
}

function restart(idx = G.carIdx) {
  if (multiplayer.active) return;
  document.body.classList.add('fading');
  setTimeout(() => {
    if (multiplayer.active) { document.body.classList.remove('fading'); return; }
    if (idx !== G.carIdx || player.spec !== CARS[idx]) setCar(idx);
    resetRace(); audio.restart();
    G.cam = G.userCam || 'cockpit'; applyCamMode();
    updateCamera(0, true);
    startCountdown();
    document.body.classList.remove('fading');
  }, 280);
}

// ------------------------------------------------------------------ input
const DRIVE_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'ShiftLeft', 'ShiftRight'];
addEventListener('keydown', (e) => {
  if (e.target.closest?.('input, select, textarea, button, [contenteditable]')) return;
  if (!multiplayer.panel.hidden) { clearDriveInput(); return; }
  audio.start();
  if (DRIVE_KEYS.includes(e.code) || e.code === 'Enter') e.preventDefault();
  if (e.repeat) { keys.add(e.code); return; }
  keys.add(e.code);
  if (G.state === 'loading') return;
  const menu = G.state === 'results' || G.state === 'garage';
  if (/^Digit[1-9]$/.test(e.code)) { const i = +e.code.slice(5) - 1; if (i < CARS.length) { audio.ui(true); restart(i); } return; }
  if (menu) {
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') pickCar(-1);
    else if (e.code === 'ArrowRight' || e.code === 'KeyD') pickCar(1);
    else if (e.code === 'Enter' || e.code === 'KeyR' || e.code === 'Space') { audio.ui(true); restart(G.selIdx); }
    else if ((e.code === 'Escape' || e.code === 'KeyG') && G.state === 'garage') closeGarage();
    return;
  }
  if (e.code === 'KeyC') { G.cam = G.cam === 'cockpit' ? 'chase' : 'cockpit'; G.userCam = G.cam; applyCamMode(); hud.message(G.cam === 'cockpit' ? '<i>COCKPIT</i> CAM' : '<i>CHASE</i> CAM', 1.2); }
  else if (e.code === 'KeyT') tow(player.veh);
  else if (e.code === 'KeyR' || (e.code === 'Enter' && G.state === 'finished')) restart();
  else if (e.code === 'KeyG') openGarage();
  else if (e.code === 'KeyM') hud.message(audio.toggleMusic() ? 'MUSIC <i>ON</i>' : 'MUSIC <i>OFF</i>', 1.2);
  else if (e.code === 'KeyN') audio.nextTrack();
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('pointerdown', () => audio.start());
addEventListener('blur', () => keys.clear());

function readInput(dt) {
  const k = (c) => keys.has(c);
  const up = k('KeyW') || k('ArrowUp'), dn = k('KeyS') || k('ArrowDown'), lf = k('KeyA') || k('ArrowLeft'), rt = k('KeyD') || k('ArrowRight');
  // pedals: keys are on/off, so ramp them like a foot would (quick, but no snap that unsettles the car)
  input.throttle = up ? Math.min(1, input.throttle + dt * (input.throttle < 0.6 ? 6 : 3)) : Math.max(0, input.throttle - dt * 10);
  input.brake = dn ? Math.min(1, input.brake + dt * (input.brake < 0.7 ? 7 : 3.5)) : Math.max(0, input.brake - dt * 12);
  // steering: the ramp slows with speed (precise at 150 km/h, quick when parking), self-centres faster,
  // flicks the other way faster still; a response curve makes short taps into small corrections.
  // (the physics then maps full input to the lock the tyres can actually use at this speed)
  const target = (rt ? 1 : 0) - (lf ? 1 : 0);
  const v = player ? Math.abs(player.veh.vLong) : 0;
  const base = 1 / (1 + v / 22);
  let rate;
  if (target === 0) rate = 6.5 * (0.5 + 0.5 * base);
  else if (input.steerRaw !== 0 && Math.sign(target) !== Math.sign(input.steerRaw)) rate = 8 * (0.45 + 0.55 * base);
  else rate = 1.6 + 3.4 * base;
  input.steerRaw += clamp(target - input.steerRaw, -rate * dt, rate * dt);
  input.steer = Math.sign(input.steerRaw) * Math.pow(Math.abs(input.steerRaw), 1.4);
  input.handbrake = k('Space');
  input.nitro = k('ShiftLeft') || k('ShiftRight');
  if (up || dn || lf || rt) document.body.classList.add('started');
}

// ------------------------------------------------------------------ garage / results menus
function carBest(i) { return +localStorage.getItem('paraliaki.best.' + CARS[i].id) || 0; }
function pickCar(d) {
  G.selIdx = (G.selIdx + d + CARS.length) % CARS.length;
  audio.ui(d > 0);
  hud.showCar(CARS, G.selIdx, carBest(G.selIdx));
  // live preview: swap the player's model in place
  const veh = player.veh; setCar(G.selIdx); player.veh = veh; G.carIdx = G.selIdx;
  syncCar(player, 0);
}
function openGarage() {
  if (multiplayer.active) { multiplayer.open(); return; }
  if (G.state !== 'race' && G.state !== 'countdown') return;
  G.menuFrom = { state: G.state, car: G.carIdx, cam: G.cam };
  G.state = 'garage'; G.selIdx = G.carIdx; G.cam = 'orbit'; applyCamMode();
  hud.showMenu('garage', { kick: 'PAUSED', title: 'GARAGE', sub: 'Pick your ride with <b>← →</b>, then <b>ENTER</b> to restart the race in it. <b>ESC</b> returns to the race.' });
  hud.showCar(CARS, G.selIdx, carBest(G.selIdx));
}
function closeGarage() {
  const f = G.menuFrom; hud.hideMenu();
  if (G.carIdx !== f.car) { const veh = player.veh; setCar(f.car); player.veh = veh; }
  G.cam = f.cam; applyCamMode(); G.state = f.state;
}

function finishRace() {
  G.state = 'finished'; G.finishedT = 0; G.postT = 0;
  if (G.rFinish === null) { // penalties can still decide it: estimate where STAVROS ends up
    const est = G.raceT + G.rPen + (route.finish - rival.veh.s) / Math.max(15, rival.veh.vLong);
    if (est < G.pFinish) G.rFinish = est;
  }
  const won = G.pFinish !== null && (G.rFinish === null || G.pFinish < G.rFinish);
  G.won = won;
  if (won) { audio.win(); hud.pop('info good', 'FINISH!', 'P1 · ' + route.to.toUpperCase()); } else { audio.lose(); hud.pop('info bad', 'FINISH', 'P2 · ' + RIVAL_NAME + ' GOT THERE FIRST'); }
  const key = 'paraliaki.best.' + player.spec.id; const prev = +localStorage.getItem(key) || 0;
  G.newBest = !prev || G.pFinish < prev; if (G.newBest) localStorage.setItem(key, G.pFinish.toFixed(3));
  G.prevBest = prev;
}
function showResults() {
  G.state = 'results'; G.cam = 'orbit'; applyCamMode(); G.selIdx = G.carIdx;
  const won = G.won, gapT = G.rFinish !== null ? G.pFinish - G.rFinish : null;
  const rgap = route.finish - rival.veh.s;
  const sub = won
    ? (gapT !== null ? `You beat <b>${RIVAL_NAME}</b> to ${route.to} by <b>${Math.abs(gapT).toFixed(2)} s</b>.` : `You beat <b>${RIVAL_NAME}</b> to ${route.to}, he was still <b>${Math.max(0, rgap).toFixed(0)} m</b> back.`)
    : `<b>${RIVAL_NAME}</b> reached ${route.to} <b>${gapT.toFixed(2)} s</b> ahead of you.`;
  hud.showMenu('results', {
    win: won, kick: route.from.toUpperCase() + ' ▶ ' + route.to.toUpperCase() + ' · ' + (route.finish - startS > 0 ? ((route.finish - startS) / 1000).toFixed(1) : '') + ' KM', title: won ? 'VICTORY' : 'DEFEAT', sub,
    rows: [
      ['YOUR TIME', fmtTime(G.pFinish)], [RIVAL_NAME, G.rFinish !== null ? fmtTime(G.rFinish) : 'DNF'], ['BEST · ' + player.spec.short, fmtTime(G.newBest ? G.pFinish : G.prevBest), G.newBest],
      ['TOP SPEED', Math.round(G.topSpeed) + ' KM/H'], ['NEAR MISSES', G.nearMisses], ['CRASHES', G.crashes],
      ['STYLE', Math.round(G.style).toLocaleString('en-US')], ['AVG SPEED', ((route.finish - startS) / G.pFinish * 3.6).toFixed(0) + ' KM/H'], ['CONES', G.cones],
      ['RED LIGHTS', G.reds ? `${G.reds} · +${G.pen.toFixed(1)} S` : '0 · CLEAN'], ['PEOPLE SCARED', G.scared], [RIVAL_NAME + ' REDS', G.rReds],
    ],
  });
  hud.showCar(CARS, G.selIdx, carBest(G.selIdx));
}

// ------------------------------------------------------------------ rival AI
function aiInput(car, dt, pace, other) {
  const veh = car.veh, ai = car.ai, v = Math.max(0, veh.vLong), sp = veh.spec;
  ai.passT = Math.max(0, (ai.passT || 0) - dt);
  const ghost = car.ghost || ai.passT > 0; // deadlocked in a pile-up: squeeze through
  if (!(ai.lane >= -1)) { ai.lane = Math.max(0, Math.min(route.lanes(veh.s) - 1, Math.round((Math.abs(veh.u) - route.medHalf(veh.s)) / 3.5 - 0.5))); ai.u = veh.u; ai.cool = 0; }
  const nl = route.lanes(veh.s);
  const undiv = route.div(veh.s) < 0.3;
  ai.cool -= dt;
  const look = 30 + v * 2.4;
  const laneU = (l) => (l >= 0 ? route.laneU(veh.s + 10, Math.min(l, nl - 1)) : -route.laneU(veh.s + 10, -l - 1));
  const info = (l, from = veh.halfL) => {
    const u = laneU(l);
    const r = ghost ? { gap: 1e9, v: 0 } : traffic.laneInfo(u, veh.s + from, veh.s + look, veh.halfW);
    // the other racer is an obstacle too
    const d = other.veh.s - veh.s;
    if (d > -2 && d < look && Math.abs(other.veh.u - u) < 2.2) { const g = d - other.veh.halfL - veh.halfL; if (g < r.gap) { r.gap = g; r.v = other.veh.vLong; } }
    return r;
  };
  if (ai.lane >= nl) ai.lane = nl - 1;
  if (ai.lane < 0 && !undiv) ai.lane = 0;
  const cur = info(ai.lane);
  const closing = v - cur.v;
  const ttc = closing > 0.5 ? cur.gap / closing : 99;
  ai.stuck = v < 6 && cur.gap < 14 ? (ai.stuck || 0) + dt : 0;
  ai.eval = (ai.eval || 0) - dt;
  if (ai.cool <= 0 && (ttc < 5 || ai.eval <= 0 || ai.stuck > 0.6 || ai.lane < 0)) {
    ai.eval = 0.5;
    // how fast could we be going in each lane a few seconds from now
    const vmax = sp.vmax / 3.6 * pace;
    const eff = (r, l) => (r.gap > look - 5 ? vmax : Math.min(vmax, Math.sqrt(Math.max(0, r.v) ** 2 + 2 * 5 * Math.max(0, r.gap - 10)))) - Math.abs(l - ai.lane) * 0.8;
    let best = ai.lane, bestScore = ai.lane < 0 ? -1e9 : eff(cur, ai.lane) + 1.5;
    const cands = []; for (let l = 0; l < nl; l++) cands.push(l);
    if (undiv) cands.push(-1);
    for (const l of cands) {
      if (l === ai.lane) continue;
      if (Math.abs(l - Math.max(0, ai.lane)) > 1 && l >= 0) continue; // one lane at a time
      const side = info(l, -7);
      if (side.gap < (ai.stuck > 0.6 ? 2 : 4.5)) continue; // somebody alongside
      let score = eff(side, l);
      if (l < 0) { // overtaking on the oncoming lane: needs lots of room (closing speeds add up)
        if (side.gap < (v + Math.abs(Math.min(0, side.v))) * 5 + 40 || ttc > 8) continue; score -= 4;
      }
      if (score > bestScore) { bestScore = score; best = l; }
    }
    if (best !== ai.lane) { ai.lane = best; ai.cool = 0.9; }
  }
  if (ai.lane < 0 && ai.cool < -1.5) { const back = info(0, -10); if (back.gap > 16) { ai.lane = 0; ai.cool = 0.8; } }
  // steering: pure pursuit on a smoothed lane offset
  const tu = laneU(ai.lane);
  ai.u = damp(ai.u ?? veh.u, tu, 1.6, dt);
  let kAhead = 0; for (let d = 0; d <= 36; d += 6) kAhead = Math.max(kAhead, Math.abs(route.curv(veh.s + d)));
  const Ld = Math.max(6, Math.min(9 + v * 0.42, 0.24 / Math.max(1e-4, kAhead)));
  const tp = route.point(veh.s + Ld, ai.u);
  const dx = tp.x - veh.x, dz = tp.z - veh.z;
  const fx = -Math.sin(veh.yaw), fz = -Math.cos(veh.yaw), rx = Math.cos(veh.yaw), rz = -Math.sin(veh.yaw);
  const lat = dx * rx + dz * rz, lon = Math.max(1, dx * fx + dz * fz);
  const delta = Math.atan(veh.wb * 2 * lat / (lon * lon + lat * lat));
  const lock = veh.lockAt(v);
  const steer = clamp(delta / lock - veh.w * 0.04, -1, 1);
  // speed: top speed x pace, braking for bends ahead, following traffic
  let vT = sp.vmax / 3.6 * pace;
  const dec = 7.5 * sp.brake;
  for (let d = 0; d < v * v / (2 * dec) + 60; d += 6) {
    const k = Math.abs(route.curv(veh.s + d)); if (k < 1e-4) continue;
    const vl = Math.sqrt(sp.grip * 9.81 * 0.74 / k);
    vT = Math.min(vT, Math.sqrt(vl * vl + 2 * dec * Math.max(0, d - 8)));
  }
  const now = info(ai.lane);
  // whatever is physically in front of the bonnet right now (we may still be moving across)
  const here = ghost ? { gap: 1e9, v: 0 } : traffic.laneInfo(veh.u, veh.s + veh.halfL, veh.s + look, veh.halfW * 0.8);
  if (here.gap < now.gap) { if (here.gap < 9 && ai.lane !== undefined && Math.abs(veh.u - ai.u) > 1) vT = Math.min(vT, 4); else { now.gap = here.gap; now.v = here.v; } }
  if (now.gap < look) { const lv = Math.max(0, now.v); vT = Math.min(vT, Math.sqrt(lv * lv + 2 * dec * 0.75 * Math.max(0, now.gap - 7 - lv * 0.4))); }
  // traffic lights: stop at red / amber, unless he decides to risk it
  let sigHold = -1;
  if (signals && !(car === player && !G.autodrive)) {
    const front = veh.s + veh.halfL, j = signals.next(front, 1);
    if (j) {
      const d = j.sF - front;
      if (j.main !== 'G' && d < 260) {
        // commit to stop-or-go only once the stop line is close enough to matter
        if (ai.sigJ !== j.i && d < v * v / (2 * dec * 0.85) + 30) { ai.sigJ = j.i; ai.sigRun = decideRun(car, j, d, v); }
        if (!(ai.sigJ === j.i && ai.sigRun)) {
          // be able to stop at the line, but roll up so as to arrive just as it turns green
          const vStop = Math.sqrt(2 * dec * 0.7 * Math.max(0, d - 3)), vTime = d > 25 ? (d - 6) / (j.toGreen + 1.5) : 0;
          vT = Math.min(vT, Math.max(vStop, vTime));
          // brake for the line directly (the speed controller alone lags too much)
          const need = v * v / (2 * Math.max(0.3, d - 2.5));
          if (d < 3.5 || (d < 12 && v < 3)) sigHold = 0.45;
          else if (need > 2.2 && vTime < v) sigHold = Math.min(1, need / (9.81 * sp.brake * 0.95));
        }
      } else if (j.main === 'G' && ai.sigJ === j.i && !ai.sigRun) ai.sigJ = -1;
    }
  }
  ai.dbg = { st: +steer.toFixed(2), dy: +(((veh.yaw - Math.atan2(-route.lin(route.TX, veh.s), -route.lin(route.TZ, veh.s)) + 9.42) % 6.283) - 3.14).toFixed(2), tu: +ai.u.toFixed(1), Ld: Math.round(Ld), vT: Math.round(vT * 3.6), gap: Math.round(now.gap), nv: Math.round(now.v * 3.6), here: Math.round(here.gap), lane: ai.lane, ttc: +ttc.toFixed(1) };
  if (ai.mistake > 0) { vT *= 0.55; ai.mistake -= dt; }
  ai.blockT = v < 1.5 && vT < 3 && sigHold < 0 && G.state === 'race' ? (ai.blockT || 0) + dt : 0;
  if (ai.blockT > 5) { ai.blockT = 0; ai.passT = 3.5; }
  if (ai.passT > 0) vT = Math.max(vT, 7);
  const err = vT - v;
  const thr = clamp(err * 0.35 + 0.1, 0, 1), brk = v < 1.5 ? 0 : clamp(-err * 0.2, 0, 1); // never select reverse by accident
  // unstick: nose in a wall or a wreck -> back out, and as a last resort hop back onto the lane
  const av = Math.abs(veh.vLong);
  ai.goT = Math.max(0, (ai.goT || 0) - dt);
  ai.slow = av < 2 && vT > 3 && ai.goT <= 0 ? (ai.slow || 0) + dt : 0;
  ai.slowLong = v < 3 && vT > 3 ? (ai.slowLong || 0) + dt : 0;
  if (ai.slow > 1.4 && !(ai.revT > 0)) { ai.revT = 1.1; ai.slow = 0; }
  if (ai.revT > 0) { ai.revT -= dt; if (ai.revT <= 0) ai.goT = 2.5; return { throttle: 0, brake: 1, steer: -clamp(lat * 0.3, -1, 1), handbrake: false, nitro: false }; }
  if (sigHold >= 0) { ai.slow = 0; ai.slowLong = 0; return { throttle: 0, brake: v < 1.5 ? Math.min(0.45, sigHold) : sigHold, steer, handbrake: false, nitro: false }; } // < 0.5 when slow: never selects reverse
  if (ai.slowLong > 4) { ai.slowLong = 0; const l = Math.max(0, ai.lane); veh.reset(veh.s + 2, route.laneU(veh.s + 2, l), 0); ai.u = veh.u; }
  return { throttle: brk > 0.05 ? 0 : thr, brake: brk, steer, handbrake: false, nitro: ai.nitroOk && err > 6 && Math.abs(steer) < 0.3 };
}

function decideRun(car, j, d, v) {
  const tArr = d / Math.max(1, v);
  if (j.main === 'A' && (tArr < j.left + 0.25 || v * v / (2 * Math.max(1, d)) > 6.5)) return true; // clears it on amber, or too late to stop
  if (car === player) return Q.has('runreds');
  let p = 0.08;
  const lead = rival.veh.s - player.veh.s;
  if (lead < 0) p += 0.17; if (lead < -80) p += 0.15;
  if (j.main === 'R' && j.left < tArr + 1) p += 0.3; // it will (probably) be green by the time he gets there
  if (car.ghost) p = 0.04;
  return Math.random() < p;
}
function onStopLine(j, who) {
  const red = j.main === 'R' && j.redT > 0.3 && j.toGreen > 0.3; // a little grace at both ends of the red
  if (red && Q.has('redlog')) { const c = who === 'rival' ? rival : player; (G.redLog = G.redLog || []).push([who, Math.round(j.s), +j.redT.toFixed(1), c.ai && c.ai.sigJ === j.i, c.ai && c.ai.sigRun, Math.round(c.veh.kmh), c.ghost || false]); }
  if (who === 'rival') {
    if (!red) return;
    G.rPen += 2; G.rReds++;
    if (Math.abs(rival.veh.s - player.veh.s) < 450) { hud.pop('info cyan', RIVAL_NAME + ' RAN A RED!', '+2.0 S PENALTY'); if (Math.abs(rival.veh.s - player.veh.s) < 120) audio.whistle(); }
    people.redRun(j);
    return;
  }
  if (red) {
    G.pen += 2; G.reds++; G.combo = 0; G.comboT = 0;
    hud.pop('redlight', 'RED LIGHT!', '+2.0 S · ' + RED_LINES[Math.floor(Math.random() * RED_LINES.length)]);
    hud.flashCam(); audio.shutter(); setTimeout(() => audio.whistle(), 260);
    for (const c of traffic.cars) if (c.active && c.cross && Math.abs(c.s - j.s) < 40) { audio.horn(false, 0.9, clamp((c.u - player.veh.u) / 12, -1, 1), Math.random() * 0.2); break; }
    people.redRun(j);
  } else if (j.main !== 'G') { G.style += 50; hud.pop('near', 'AMBER GAMBLER', '+50', 4); }
}
const HONK_LINES = {
  blocking: ['"BEEP BEEP!"', 'IT IS GREEN, FRIEND'], cutoff: ['"HEY! WATCH IT!"', 'YOU CUT HIM UP'], overtaker: ['"GET BACK IN YOUR LANE!"', 'ONCOMING DRIVER IS NOT AMUSED'], angry: ['"MY CAR!"', 'HE WILL TELL HIS COUSIN'], shaken: ['"ARE YOU CRAZY?!"', 'NEARLY TOOK HIM HEAD-ON'],
};
function handleHonk(h) {
  const c = h.c;
  const p = traffic.route.point(c.s, c.u, _v1);
  const dx = p.x - camera.position.x, dz = p.z - camera.position.z, dist = Math.hypot(dx, dz);
  if (dist > 260) return;
  const rx = Math.cos(player.veh.yaw), rz = -Math.sin(player.veh.yaw);
  const pan = clamp((dx * rx + dz * rz) / Math.max(5, dist), -1, 1);
  audio.carHorn(h.kind, h.long ? 1 : 0, 1 / (1 + Math.pow(dist / 22, 1.4)), pan, h.reason === 'stuck' || h.reason === 'fare' ? 0 : Math.random() * 0.15);
  if (h.player && G.state === 'race' && HONK_LINES[h.reason] && G.t - (G.honkPopT || 0) > 3) { G.honkPopT = G.t; hud.pop('quote', ...HONK_LINES[h.reason]); }
}
function handlePeople() {
  for (const e of people.events) {
    const p = e.p;
    if (e.kind === 'shout') {
      const dx = p.x - camera.position.x, dz = p.z - camera.position.z, dist = Math.hypot(dx, dz);
      if (dist < 50 && G.t - (G.shoutT || 0) > 0.3) {
        G.shoutT = G.t;
        const rx = Math.cos(player.veh.yaw), rz = -Math.sin(player.veh.yaw);
        const kind = /^HEY|WATCH/.test(e.text) ? 0 : /WHOA|NOPE/.test(e.text) ? 1 : /AAA/.test(e.text) ? 2 : /OPA/.test(e.text) ? 4 : 3;
        audio.shout(p.look.pitch * (0.95 + Math.random() * 0.1), kind, (dx * rx + dz * rz) / Math.max(6, dist), 0.3 * (1 - dist / 60));
      }
    } else if (G.state !== 'race') continue;
    else if (e.kind === 'dive' && e.who === 'player') { G.scared++; G.style = Math.max(0, G.style - 150); G.combo = 0; G.comboT = 0; hud.pop('info bad', 'PEDESTRIAN PARKOUR!', '−150 · NOBODY HURT, THANKFULLY'); }
    else if (e.kind === 'startle' && e.who === 'player') { if (G.t - (G.startleT || 0) > 2.2) { G.startleT = G.t; hud.pop('quote', `"${p.lastSay || 'HEY!'}"`, 'STARTLED A LOCAL'); } }
    else if (e.kind === 'thanks') { G.style += 50; G.polite++; hud.pop('quote good', `"${p.lastSay || 'THANK YOU!'}"`, 'POLITE DRIVER · +50'); }
  }
  people.events.length = 0;
}

// ------------------------------------------------------------------ per-frame helpers
function syncCar(c, dt) {
  const v = c.veh;
  v.place(c.model.root);
  c.model.update(dt, v.vLong, v.steer, (c === player ? input.brake > 0.3 : c.lastBrake) || false, v.pose, v.corners || v.wheel, v.w);
  for (const zone of ['front', 'rear', 'left', 'right']) c.model.setDamage?.(zone, v.damage?.[zone] || 0);
}

function racerCollide(dt) {
  const a = player.veh, b = rival.veh;
  const ds = b.s - a.s; if (Math.abs(ds) > 8) return;
  const ea = extents(a, route), eb = extents(b, route);
  const du = b.u - a.u;
  const ox = ea.hs + eb.hs - Math.abs(ds), oy = ea.hu + eb.hu - Math.abs(du);
  if (ox <= 0 || oy <= 0) return;
  const ra = routeVel(a, route), rb = routeVel(b, route);
  let sev = 0;
  if (ox < oy) {
    const n = Math.sign(ds) || 1; pushVeh(a, ra.f, -n * ox / 2, 0); pushVeh(b, rb.f, n * ox / 2, 0);
    const cl = (ra.vs - rb.vs) * n; if (cl > 0) { const j = cl * 0.6; ra.vs -= n * j; rb.vs += n * j; sev = cl; b.w += (Math.random() - 0.5) * 0.4; }
  } else {
    const n = Math.sign(du) || 1; pushVeh(a, ra.f, 0, -n * oy / 2); pushVeh(b, rb.f, 0, n * oy / 2);
    const cl = (ra.vu - rb.vu) * n; if (cl > 0) { const j = cl * 0.6; ra.vu -= n * j; rb.vu += n * j; sev = cl; }
  }
  setRouteVel(a, ra.f, ra.vs, ra.vu); setRouteVel(b, rb.f, rb.vs, rb.vu);
  if (sev > 1.5 && G.t - (G.paintT || 0) > 1.2) { G.paintT = G.t; hud.pop('info cyan', 'TRADING PAINT!'); audio.crash('light', Math.min(1, sev / 8)); G.shake = Math.max(G.shake, 0.35); player.driver.impulse(0.4); }
}

function handleEvents(events) {
  for (const e of events) {
    // damage where it hit (front / rear / left / right), scaled by the car's own change of velocity
    if (e.zone && e.dv > 0) (e.who === 'rival' ? rival : player).veh.addDamage?.(e.zone, e.dv, e);
    if (e.who === 'rival') {
      if ((e.kind === 'crash' || e.kind === 'bump') && Math.abs(rival.veh.s - player.veh.s) < 150) {
        const pan = clamp((rival.veh.u - player.veh.u) / 10, -1, 1);
        audio.noise({ dur: 0.3, f: 700, type: 'lowpass', gain: 0.25 * Math.min(1, e.sev / 12), pan });
        if (e.kind === 'crash') hud.pop('info cyan', RIVAL_NAME + ' CRASHED!');
      }
      continue;
    }
    if (e.kind === 'near') {
      G.nearMisses++;
      G.combo = G.comboT > 0 ? G.combo + 1 : 1; G.comboT = 4;
      const close = clamp(1.3 - e.clearance, 0.3, 1.3);
      const pts = Math.round(100 * close * (e.oncoming ? 2 : 1) * (1 + (G.combo - 1) * 0.5) / 10) * 10;
      G.style += pts;
      player.veh.nitro = Math.min(1, player.veh.nitro + (e.oncoming ? 0.12 : 0.07));
      hud.pop('near' + (e.oncoming ? ' onc' : ''), e.oncoming ? 'ONCOMING!' : 'NEAR MISS', `+${pts}${G.combo > 1 ? ' · ×' + G.combo : ''}`, -4);
      audio.nearMiss(Math.min(12, G.combo), e.side * 0.6);
      if (e.car.type.scooter) audio.moped(e.side * 0.7);
    } else if (e.kind === 'crash' || e.kind === 'bump') {
      const big = e.kind === 'crash';
      G.crashes += big ? 1 : 0; G.combo = 0; G.comboT = 0;
      G.shake = Math.max(G.shake, big ? 1 : 0.5); G.flash = big ? 0.8 : 0.3;
      player.driver.impulse(big ? 1.1 : 0.55, -e.side * 0.5, 0.5);
      audio.crash(e.heavy ? 'heavy' : 'light', Math.min(1, e.sev / 14));
      if (big) {
        audio.opa(1.1);
        hud.pop('opa', 'OPA!', SHOUTS[Math.floor(Math.random() * SHOUTS.length)], (Math.random() - 0.5) * 10);
      } else hud.pop('info bad', e.car.type.bus ? 'BUS BUMP!' : 'BUMP!');
      if (e.car.type.scooter) audio.scream();
      else if (Math.random() < 0.6) audio.horn(e.car.type.bus, 0.9, -e.side * 0.4, 0.25);
    } else if (e.kind === 'scrape') { audio.scrape(Math.min(1, e.sev / 4)); G.shake = Math.max(G.shake, 0.15); }
    else if (e.kind === 'cone') {
      G.cones++; G.style += 25; audio.tone({ f: 380 + Math.random() * 200, slide: 900, dur: 0.18, gain: 0.08, type: 'triangle' }); audio.noise({ dur: 0.08, f: 1200, type: 'bandpass', gain: 0.12 });
      if (G.t - (G.coneT || 0) > 1.5) { G.coneT = G.t; hud.pop('info', 'CONE BOWLING!', '+25'); }
    }
  }
}

// ------------------------------------------------------------------ audio feed
const _fr = {}, _av = new THREE.Vector3(), _aw = new THREE.Vector3(), _ar = new THREE.Vector3(), _ap = new THREE.Vector3();
function listenerRel(x, y, z, vx, vz) {
  const cp = camera.position, dx = x - cp.x, dz = z - cp.z, d = Math.hypot(dx, dz, (y - cp.y) * 0.5);
  const lv = player.veh.velocityWorld(_aw);
  const rvx = vx - lv.x, rvz = vz - lv.z;
  _ar.set(1, 0, 0).applyQuaternion(camera.quaternion);
  return { d, pan: (dx * _ar.x + dz * _ar.z) / Math.max(3, d), vr: -(dx * rvx + dz * rvz) / Math.max(1, d) };
}
function handleTrafficSounds() {
  for (const e of traffic.sounds) {
    const c = e.c, p = route.point(c.s, c.u, _ap);
    const L = listenerRel(p.x, p.y, p.z, 0, 0); if (L.d > 140) continue;
    const lvl = 1 / (1 + Math.pow(L.d / 14, 1.5));
    if (e.kind === 'air') audio.airHiss(lvl, L.pan);
    else if (e.kind === 'crunch') audio.crash(e.sev > 8 ? 'heavy' : 'light', Math.min(1, (e.sev || 4) / 14) * lvl);
    else audio.noise({ dur: 0.3 + Math.random() * 0.25, f: 950 + Math.random() * 300, type: 'bandpass', q: 7, gain: 0.16 * lvl, attack: 0.02, pan: L.pan, bus: audio.trafficBus });
  }
  traffic.sounds.length = 0;
}
function updateAudio(dt) {
  if (!audio.ctx) return;
  const pv = player.veh, rv = rival.veh;
  // where is the sea? (the shore side relative to the way the car is pointing)
  const seaR = route.seaR(pv.s), seaL = route.seaL(pv.s), seaD = Math.min(seaR, seaL);
  const ry = Math.atan2(-route.lin(route.TX, pv.s), -route.lin(route.TZ, pv.s));
  const seaPan = (seaR <= seaL ? 1 : -1) * 0.75 * Math.cos(pv.yaw - ry);
  const zone = traffic.zone(pv.s);
  // nearby traffic, relative to the listener (camera): distance, pan, closing speed for doppler
  const tl = [];
  for (const c of traffic.cars) {
    if (!c.active || c.mode === 'parked' || Math.abs(c.s - pv.s) > 150 || (c.crash && c.crash.y > 1)) continue;
    const p = route.point(c.s, c.u, _ap), f = route.frame(c.s, _fr);
    const vs = c.crash ? c.crash.vs : c.cross ? c.xvs : c.dir * c.v, vu = c.crash ? c.crash.vu : c.cross ? c.xvu : (c.uv || 0);
    const L = listenerRel(p.x, p.y, p.z, f.tx * vs + f.rx * vu, f.tz * vs + f.rz * vu);
    if (L.d > 130) continue;
    tl.push({ id: c.id, kind: c.kind, electric: !!c.type.electric, d: L.d, pan: L.pan, vr: L.vr, v: Math.hypot(vs, vu), acc: c.acc || 0 });
  }
  tl.sort((a, b) => a.d - b.d);
  const rw = rv.velocityWorld(_av), RL = listenerRel(rv.x, rv.y, rv.z, rw.x, rw.z);
  const racing = G.state === 'race' || G.state === 'countdown';
  const counting = G.state === 'countdown';
  audio.update({
    dt, damage: pv.damage, rpm: pv.rpm, redline: pv.spec.redline, load: counting ? input.throttle * 0.9 - 0.1 : racing ? pv.load : Math.min(pv.load, 0.3), throttle: input.throttle,
    gear: pv.gear, gearRatio: pv.ratio(), shift: pv.shiftEvent, limiter: pv.limiter || (counting && pv.rpm > pv.spec.redline * 0.97), boost: pv.boost,
    speed: Math.abs(pv.vLong), skid: pv.skid, wheelspin: pv.wheelspin, lockup: pv.lockup, bump: pv.bumpHit, rough: pv.rough, offroad: pv.offroad, nitro: pv.nitroOn, wb: pv.wb,
    open: player.spec.convertible || G.cam !== 'cockpit', muted: G.state === 'garage' || (!multiplayer.active && !multiplayer.panel.hidden),
    sea: 1 - smoothstep(30, 300, seaD), seaPan, city: route.urban(pv.s) * (zone === 'town' ? 0.85 : 0.45),
    beach: zone === 'beach' || zone === 'cove' ? 1 : 0, cliff: zone === 'cliff' ? 1 : 0,
    cicadas: 1 - route.urban(pv.s) * 0.7 + (zone === 'cliff' ? 0.4 : 0),
    action: clamp((pv.kmh - 110) / 160, 0, 1) * 0.6 + Math.min(0.5, G.shake),
    rival: { rpm: rv.rpm, load: rival.lastBrake ? -0.3 : counting ? (G.countT > 1 ? 0.7 : 0.1) : rv.load, dist: RL.d, pan: RL.pan, vr: RL.vr },
    traffic: tl,
  });
}

// ------------------------------------------------------------------ cameras
const camState = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 72, vel: new THREE.Vector3() };
// free look: drag the mouse (either button) or a finger over the view to swing the chase camera around the car or look
// around the cockpit; the wheel zooms the chase camera. Once you let go it eases back behind the car while you drive
// (double-click snaps it back).
const look = { yaw: 0, pitch: 0, zoom: 1, drag: null, idleT: 9 };
canvas.addEventListener('pointerdown', (e) => {
  if (G.cam === 'orbit') return;
  look.drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
  canvas.setPointerCapture?.(e.pointerId);
});
canvas.addEventListener('pointermove', (e) => {
  const d = look.drag; if (!d || d.id !== e.pointerId) return;
  const dx = e.clientX - d.x, dy = e.clientY - d.y; d.x = e.clientX; d.y = e.clientY;
  const k = 4.2 / Math.max(400, innerHeight);
  look.yaw -= dx * k; look.pitch += dy * k * 0.8;
  while (look.yaw > Math.PI) look.yaw -= 2 * Math.PI; while (look.yaw < -Math.PI) look.yaw += 2 * Math.PI;
  look.pitch = clamp(look.pitch, -0.35, 1.0);
  look.idleT = 0;
});
const endLook = (e) => { if (look.drag && look.drag.id === e.pointerId) look.drag = null; };
canvas.addEventListener('pointerup', endLook); canvas.addEventListener('pointercancel', endLook);
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('dblclick', () => { look.yaw = look.pitch = 0; look.zoom = 1; });
canvas.addEventListener('wheel', (e) => { if (G.cam !== 'chase') return; e.preventDefault(); look.zoom = clamp(look.zoom * Math.exp(e.deltaY * 0.0012), 0.55, 3); }, { passive: false });
function updateLook(dt, speed) {
  if (look.drag) { look.idleT = 0; return; }
  look.idleT += dt;
  // swing back behind the car once you've let go and are driving (stays put while parked, so you can look around)
  if (look.idleT > 1.6 && speed > 4) { const k = 1 - Math.exp(-dt * 1.6 * Math.min(1, (speed - 4) / 8)); look.yaw -= look.yaw * k; look.pitch -= look.pitch * k; }
}
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _m = new THREE.Matrix4();
function applyCamMode() {
  if (!player) return;
  const cock = G.cam === 'cockpit';
  player.cockpit.setVisible(true); // The open cabins keep their dashboard in chase/garage views.
  player.driver.head.visible = !cock;
  camera.near = cock ? 0.04 : 0.15; camera.updateProjectionMatrix();
}
function noise1(t) { return Math.sin(t * 1.7) * 0.5 + Math.sin(t * 3.1 + 1.3) * 0.3 + Math.sin(t * 7.3 + 0.7) * 0.2; }
function updateCamera(dt, snap = false) {
  const veh = player.veh, body = player.model.body, root = player.model.root;
  root.updateMatrixWorld(true);
  const kmh = veh.kmh, sk = clamp(kmh / 260, 0, 1.2);
  G.shake = Math.max(0, G.shake - dt * 1.8);
  const rough = (veh.offroad ? 0.6 : 0.06) * sk + G.shake * 0.9;
  const t = G.t;
  updateLook(dt, Math.abs(veh.vLong));
  if (G.cam === 'cockpit') {
    const eye = player.cockpit.eye;
    _v1.set(eye.x - veh.ay * 0.0025, eye.y + 0.02 + noise1(t * 23) * 0.004 * rough, eye.z + clamp(veh.ax, -12, 12) * 0.0035);
    body.localToWorld(_v1);
    camera.position.copy(_v1);
    body.getWorldQuaternion(_q);
    const lookYaw = -player.veh.steer * 0.12 - veh.w * 0.04 + clamp(look.yaw, -2.2, 2.2);
    _e.set(-0.045 - clamp(veh.ax, -12, 12) * 0.0012 - look.pitch * 0.8 + noise1(t * 31 + 5) * 0.004 * rough, lookYaw, noise1(t * 19 + 9) * 0.004 * rough + G.shake * Math.sin(t * 40) * 0.02, 'YXZ');
    camera.quaternion.copy(_q).multiply(_q.clone().setFromEuler(_e));
    const fov = 66 + sk * 10 + (veh.nitroOn ? 5 : 0);
    camState.fov = snap ? fov : damp(camState.fov, fov, 3, dt);
  } else if (G.cam === 'chase') {
    // behind the car, swung round by the free look: yaw about the car, pitch up / down, wheel zoom
    const back = 5.6 + sk * 1.2, up = 1.75 + sk * 0.15;
    const dist = Math.hypot(back, up) * look.zoom, el = clamp(Math.atan2(up, back) + look.pitch, -0.08, 1.35);
    const hd = veh.yaw + look.yaw, hx = Math.sin(hd), hz = Math.cos(hd); // forward is (-sin yaw, -cos yaw): behind is +
    const target = _v1.set(veh.x + hx * Math.cos(el) * dist, veh.y + Math.sin(el) * dist, veh.z + hz * Math.cos(el) * dist);
    const free = look.drag || Math.abs(look.yaw) > 0.05 || Math.abs(look.pitch) > 0.05;
    // while dragging the camera follows the mouse closely; the damped lag is for the car's own motion
    const kXZ = free ? 20 : 9, kY = free ? 20 : 6;
    if (snap) camState.pos.copy(target); else { camState.pos.x = damp(camState.pos.x, target.x, kXZ, dt); camState.pos.z = damp(camState.pos.z, target.z, kXZ, dt); camState.pos.y = damp(camState.pos.y, target.y, kY, dt); }
    camera.position.copy(camState.pos);
    camera.position.x += noise1(t * 21) * 0.03 * rough; camera.position.y += noise1(t * 27 + 3) * 0.03 * rough;
    // look ahead of the car when behind it; at the car itself once swung round to the side / front
    const ahead = 5 * Math.max(0, Math.cos(look.yaw)) * clamp(1 - look.pitch, 0, 1);
    const lk = _v2.set(veh.x, veh.y + 1.0, veh.z).addScaledVector(veh.forward(new THREE.Vector3()), ahead);
    camera.lookAt(lk);
    const fov = 60 + sk * 15 + (veh.nitroOn ? 6 : 0);
    camState.fov = snap ? fov : damp(camState.fov, fov, 3, dt);
  } else { // orbit
    G.orbitA += dt * 0.25;
    const r = 6.8, a = G.orbitA + veh.yaw;
    const target = _v1.set(veh.x + Math.sin(a) * r, veh.y + 1.7, veh.z + Math.cos(a) * r);
    if (snap) camState.pos.copy(target); else camState.pos.lerp(target, 1 - Math.exp(-3 * dt));
    camera.position.copy(camState.pos);
    camera.lookAt(veh.x, veh.y + 0.7, veh.z);
    camState.fov = damp(camState.fov, 50, 3, dt);
  }
  // keep the camera above the terrain/road
  if (G.cam !== 'cockpit') { const gy = route.surfaceY(veh.s, veh.u); if (camera.position.y < gy + 0.6) camera.position.y = gy + 0.6; }
  camera.fov = camState.fov; camera.updateProjectionMatrix();
  // debug view relative to the player car: ?view=right,up,back,lookAhead
  if (DBG_VIEW) {
    const f = veh.forward(_v2), rx = Math.cos(veh.yaw), rz = -Math.sin(veh.yaw);
    camera.position.set(veh.x + rx * DBG_VIEW[0] - f.x * DBG_VIEW[2], veh.y + DBG_VIEW[1], veh.z + rz * DBG_VIEW[0] - f.z * DBG_VIEW[2]);
    camera.lookAt(veh.x + f.x * DBG_VIEW[3] + rx * (DBG_VIEW[4] || 0), veh.y + (DBG_VIEW[5] ?? 1), veh.z + f.z * DBG_VIEW[3] + rz * (DBG_VIEW[4] || 0));
  }
}
const DBG_VIEW = Q.has('view') ? Q.get('view').split(',').map(Number) : null;

// ------------------------------------------------------------------ main loop
let last = 0, perfAcc = 0, perfN = 0, perfCool = 2, frameN = 0;
const events = [];
const ACTORS = [{ veh: null, kind: 'player' }, { veh: null, kind: 'rival' }];
const sunScreen = new THREE.Vector3();
function frame(now) {
  requestAnimationFrame(frame);
  const wallDt = Math.max(0, (now - last) / 1000);
  let dt = Math.min(0.5, wallDt); last = now;
  if (Q.has('fixeddt')) dt = 1 / 60;
  G.lastDt = dt;
  G.fps = G.fps ? G.fps * 0.95 + 0.05 / Math.max(1e-3, (now - (G.lastNow || now - 16)) / 1000) : 60; G.lastNow = now;
  const reps = +(Q.get('turbo') || 1);
  const slices = Math.max(1, Math.ceil(dt / (1 / 60)));
  try { for (let i = 0; i < reps; i++) for (let j = 0; j < slices; j++) step(dt / slices, i === reps - 1 && j === slices - 1); } catch (e) { fail(e); throw e; }
  if (splash) splash.update(dt);
  // adaptive resolution
  perfAcc += wallDt; perfN++; perfCool -= dt;
  if (perfN >= 40) {
    const avg = perfAcc / perfN; perfAcc = 0; perfN = 0;
    if (perfCool <= 0 && !Q.has('fixeddt')) {
      if (avg > 0.024 && pixelRatio > 0.6) { pixelRatio = Math.max(0.6, pixelRatio - 0.1); onResize(); perfCool = 1.5; }
      else if (avg < 0.0135 && pixelRatio < DPR) { pixelRatio = Math.min(DPR, pixelRatio + 0.1); onResize(); perfCool = 3; }
    }
  }
}

function step(dt, draw = true) {
  G.t += dt; frameN++;
  const bootFrameLog = text => { if (frameN === 1) tlog(text); };
  bootFrameLog('first-frame');
  readInput(dt);
  if (multiplayer.active) multiplayer.update(dt, networkState(player.veh));
  const pv = player.veh, rv = rival.veh;
  ACTORS[0].veh = pv; ACTORS[1].veh = rv;
  const simulate = G.state !== 'garage' && G.state !== 'loading' && (multiplayer.active || multiplayer.panel.hidden);
  if (simulate) signals.update(dt, pv.s, camera.position);
  if (simulate) {
    // ---- state machine
    if (G.state === 'countdown') {
      // the countdown runs on wall-clock time so first-frame GPU uploads can't stretch it
      const nowMs = performance.now(); G.countT += Math.min(0.5, Math.max(dt, (nowMs - (G.countWall || nowMs)) / 1000)); G.countWall = nowMs;
      const n = Math.floor(G.countT / 0.4);
      if (n !== G.countShown && n <= 3) {
        G.countShown = n;
        if (n < 3) { hud.count(String(3 - n)); audio.beep(false); }
        else { hud.count('GO!', true); audio.beep(true); G.state = 'race'; G.goAt = G.goAt || Math.round(performance.now()); G.raceT = 0; document.body.classList.remove('counting'); document.body.classList.add('racing'); hud.message('HOLD <i>W / ↑</i> TO FLOOR IT · <i>SHIFT</i> FOR NITRO', 3); }
      }
      // revving on the grid
      pv.rpm = damp(pv.rpm, pv.spec.idle + input.throttle * pv.spec.redline * 0.7, 6, dt);
      rv.rpm = damp(rv.rpm, rv.spec.idle + (G.countT > 1.0 ? rv.spec.redline * 0.55 : 600 * (Math.sin(G.t * 5) * 0.5 + 0.5)), 5, dt);
    }
    if (G.state === 'race' || G.state === 'finished' || G.state === 'results') {
      if (G.state === 'race' && !multiplayer.active) G.raceT += dt;
      // ---- player
      let pin = input;
      if (G.autodrive && !multiplayer.active && G.state === 'race') { player.ai = player.ai || { lane: 1, u: pv.u, cool: 0 }; pin = aiInput(player, dt, 0.95, rival); }
      if (G.state !== 'race') { player.ai = player.ai || { lane: 1, u: pv.u, cool: 0 }; pin = aiInput(player, dt, 0.25, rival); pin.nitro = false; if (pv.s > route.finish + 120) { pin.throttle = 0; pin.brake = pv.vLong > 1 ? 0.6 : 0; pin.handbrake = pv.vLong <= 1; } }
      if (G.autodrive && Q.has('nantrap')) {
        G.pStuck = pv.kmh < 4 && G.state === 'race' ? (G.pStuck || 0) + dt : 0;
        if (G.pStuck > 3 && !G.pStuckLogged) {
          G.pStuckLogged = true;
          const near = traffic.cars.filter((c) => c.active && c.s - pv.s > -10 && c.s - pv.s < 60 && c.dir > 0).map((c) => `${c.type.id}@${(c.s - pv.s).toFixed(0)}/${c.u.toFixed(1)} v${(c.v * 3.6).toFixed(0)} L${c.lane}${c.crash ? ' CRASH' + c.crash.t.toFixed(1) : ''}${c.lcT > 0 ? ' LC' : ''}`);
          const sites = traffic.sites.filter((st) => Math.abs(st.s - pv.s) < 80).map((st) => `site@${(st.s - pv.s).toFixed(0)}/${st.u.toFixed(1)}`);
          console.warn('STUCK', pv.s.toFixed(0), pv.u.toFixed(2), 'lanes', route.lanes(pv.s), JSON.stringify(player.ai.dbg), near.join(' | '), sites.join(' '));
        }
        if (G.pStuck === 0) G.pStuckLogged = false;
      }
      pv.dragMul = 1 - 0.32 * (G.draft || 0);
      const snapP = Q.has('nantrap') ? JSON.stringify({ x: pv.x, z: pv.z, s: pv.s, u: pv.u, yaw: pv.yaw, vL: pv.vLong, vLat: pv.vLat, w: pv.w, pin, ai: player.ai }) : '';
      pv.update(dt, pin);
      if (Q.has('nantrap') && !G.nanP && !isFinite(pv.x + pv.vLong + pv.w + pv.s)) { G.nanP = 1; console.warn('NaN player after update', snapP); }
      seaCheck(pv, dt);
      stuckCheck(pv, dt);
      if (!pv.nitroOn) pv.nitro = Math.min(1, pv.nitro + dt * 0.012);
      if (pv.nitroOn && !G.nitroWas) audio.nitroStart();
      G.nitroWas = pv.nitroOn;
      if (!multiplayer.active) {
      // ---- rival with rubber band
      const lead = rv.s - pv.s;
      // rubber band: keeps the race close, but a clean, fast run still wins
      let pace = 0.9;
      if (lead > 50) pace -= Math.min(0.3, (lead - 50) / 900);
      if (lead < -40) pace += Math.min(0.08, (-lead - 40) / 800);
      rival.ai.nitroOk = lead < 40;
      rival.ai.mistakeT -= dt;
      if (rival.ai.mistakeT < 0) { rival.ai.mistakeT = 25 + Math.random() * 30; if (lead > -20) rival.ai.mistake = 1.2 + Math.random(); }
      if (G.rFinish !== null) pace = rv.s > route.finish + 120 ? 0 : 0.3;
      const rin = aiInput(rival, dt, pace, player);
      if (pace === 0) { rin.throttle = 0; rin.brake = rv.vLong > 1 ? 0.7 : 0; rin.handbrake = rv.vLong <= 1; }
      rival.lastBrake = rin.brake > 0.2;
      rv.dragMul = 1;
      const snapR = Q.has('nantrap') ? JSON.stringify({ x: rv.x, z: rv.z, s: rv.s, u: rv.u, yaw: rv.yaw, vL: rv.vLong, vLat: rv.vLat, w: rv.w, rin, ai: rival.ai }) : '';
      rv.update(dt, rin);
      if (Q.has('nantrap') && !G.nanR && !isFinite(rv.x + rv.vLong + rv.w + rv.s)) { G.nanR = 1; console.warn('NaN rival after update', snapR); }
      if (!rv.nitroOn) rv.nitro = Math.min(1, rv.nitro + dt * 0.02);
      }
      // ---- stop lines: running a red costs time
      const pf = pv.s + pv.halfL, rf = rv.s + rv.halfL;
      if (!multiplayer.active && G.state === 'race' && G.pFront !== null && pv.vLong > 0) { const j = signals.crossed(G.pFront, pf); if (j) onStopLine(j, 'player'); }
      if (!multiplayer.active && G.state === 'race' && G.rFront !== null && rv.vLong > 0 && G.rFinish === null) { const j = signals.crossed(G.rFront, rf); if (j) onStopLine(j, 'rival'); }
      G.pFront = Math.max(G.pFront ?? pf, pf); G.rFront = Math.max(G.rFront ?? rf, rf);
      // ---- traffic + collisions
      const actors = multiplayer.active ? [{ veh: pv, kind: 'player' }] : [{ veh: pv, kind: 'player' }, { veh: rv, kind: 'rival' }];
      traffic.update(dt, pv.s, actors);
      events.length = 0;
      if (!multiplayer.active && !(G.autodrive && player.ai && player.ai.passT > 0)) traffic.collide(actors[0], events, G.t);
      // out of sight the rival is not held up by traffic (he knows these roads); in sight he races for real
      rival.ghost = Math.abs(rv.s - pv.s) > 140 || rival.ai.passT > 0;
      if (!multiplayer.active && !rival.ghost) traffic.collide(actors[1], events, G.t);
      if (!multiplayer.active) racerCollide(dt);
      if (Q.has('nantrap') && !G.nanC && !isFinite(pv.x + pv.vLong + rv.x + rv.vLong)) { G.nanC = 1; console.warn('NaN after collisions', pv.s, rv.s); }
      if (G.state === 'race') handleEvents(events);
      for (const h of traffic.honks) handleHonk(h);
      traffic.honks.length = 0;
      handleTrafficSounds();
      if (pv.bumpHit > 0.1) G.shake = Math.max(G.shake, pv.bumpHit * 0.22);
      if (pv.wallHit > 2.5 && G.state === 'race') { audio.scrape(Math.min(1, pv.wallHit / 10)); G.shake = Math.max(G.shake, Math.min(0.6, pv.wallHit / 12)); if (pv.wallHit > 7) player.driver.impulse(0.4); }
      if (pv.wallHit > 3) fx.sparks(pv, pv.wallHit / 12);
      if (rv.wallHit > 3 && !multiplayer.active) fx.sparks(rv, rv.wallHit / 12);
      // kerb strikes: a thump (scrape when the tyre rubs along the face), a jolt through the camera
      if (pv.curbHit > 0.12 && G.t - (G.curbT || 0) > 0.08) { G.curbT = G.t; audio.curb(Math.min(1, pv.curbHit * (pv.curbScrape ? 0.7 : 1.2))); if (pv.curbScrape) audio.scrape(0.25); G.shake = Math.max(G.shake, pv.curbHit * 0.3); if (pv.curbHit > 0.5) player.driver.impulse(0.25); }
      pv.wallHit = 0; rv.wallHit = 0;
      // ---- slipstream
      const dd = rv.s - pv.s, du = Math.abs(rv.u - pv.u);
      const drafting = (!multiplayer.active || (remoteCars.size > 0 && rival.model.root.visible)) && dd > 4 && dd < 32 && du < 1.6 && pv.vLong > 22;
      G.draft = damp(G.draft || 0, drafting ? 1 - dd / 40 : 0, 3, dt);
      if (drafting) pv.nitro = Math.min(1, pv.nitro + dt * 0.03);
      // ---- drift scoring
      if (pv.drift > 0.12 && pv.vLong > 14 && G.state === 'race') { G.driftAcc += dt * pv.vLong * pv.drift * 14; G.driftT = 0.7; }
      else if (G.driftT > 0) { G.driftT -= dt; if (G.driftT <= 0 && G.driftAcc > 60) { const pts = Math.round(G.driftAcc / 10) * 10; G.style += pts; pv.nitro = Math.min(1, pv.nitro + pts / 2500); hud.pop('near', 'DRIFT', '+' + pts, 4); G.driftAcc = 0; } else if (G.driftT <= 0) G.driftAcc = 0; }
      G.comboT -= dt; if (G.comboT <= 0) G.combo = 0;
      G.topSpeed = Math.max(G.topSpeed, pv.kmh);
      // ---- timing, positions, finish
      if (G.state === 'race' && !multiplayer.active) {
        const iP = Math.floor((pv.s - startS) / 10), iR = Math.floor((rv.s - startS) / 10);
        if (iP >= 0 && iP < G.tP.length && isNaN(G.tP[iP])) for (let i = iP; i >= 0 && isNaN(G.tP[i]); i--) G.tP[i] = G.raceT;
        if (iR >= 0 && iR < G.tR.length && isNaN(G.tR[iR])) for (let i = iR; i >= 0 && isNaN(G.tR[i]); i--) G.tR[i] = G.raceT;
        // overtakes
        const leadSign = Math.sign(pv.s - rv.s);
        if (G.raceT > 2 && leadSign !== G.lastLead && G.t - G.leadT > 1.5 && G.lastLead !== 0) {
          G.leadT = G.t;
          if (leadSign > 0) { hud.pop('info good', 'OVERTAKE!', 'P1'); G.style += 250; audio.pluck(587, 0, 0.14); audio.pluck(880, 0.08, 0.14); }
          else hud.pop('info cyan', RIVAL_NAME + ' PASSES YOU', 'P2');
        }
        G.lastLead = leadSign;
        if (G.rFinish === null && rv.s >= route.finish) { G.rFinish = G.raceT + G.rPen; if (G.pFinish === null) hud.pop('info cyan', RIVAL_NAME + ' FINISHED', 'GO GO GO!'); }
        if (pv.s >= route.finish) { G.pFinish = G.raceT + G.pen; finishRace(); }
        // district banners
        const marks = map.data.marks;
        while (G.markIdx < marks.length && pv.s >= marks[G.markIdx].s) { const m = marks[G.markIdx++]; hud.banner(m.name, m.sub.toUpperCase()); }
      } else if (G.state === 'finished') {
        G.postT += dt;
        if (G.rFinish === null && rv.s >= route.finish) G.rFinish = G.raceT + G.postT + G.rPen - (rv.s - route.finish) / Math.max(1, rv.vLong);
        G.finishedT += dt; G.raceT += 0; // clock stopped
        if (G.finishedT > 0.8 && G.cam !== 'orbit') { G.cam = 'orbit'; applyCamMode(); G.orbitA = 0.6; }
        if (G.finishedT > 2.6) { if (G.rFinish === null) G.rFinish = null; showResults(); }
      } else if (G.state === 'results') {
        G.postT += dt;
        if (G.rFinish === null && rv.s >= route.finish) G.rFinish = G.raceT + G.postT + G.rPen;
      }
    }
  }
  // ---- people (they live on during the countdown too)
  if (simulate) { people.update(dt, pv.s, multiplayer.active ? [] : ACTORS, camera.position); if (!multiplayer.active) handlePeople(); else people.events.length = 0; }
  // ---- next traffic light: HUD, green-man ticker, nitro top-up while waiting at red
  {
    const nj = signals.next(pv.s + pv.halfL, 1);
    let info = null;
    if (nj && (G.state === 'race' || G.state === 'countdown')) {
      const d = nj.sF - (pv.s + pv.halfL);
      if (d < 230) {
        const wait = G.state === 'race' && nj.main !== 'G' && d < 40 && pv.kmh < 3;
        if (wait) { pv.nitro = Math.min(1, pv.nitro + dt * 0.1); if (G.waitJ !== nj.i) { G.waitJ = nj.i; hud.message('RED LIGHT · <i>NITRO CHARGING</i> WHILE YOU WAIT', 2.5); } }
        info = { main: nj.main, d, wait, close: nj.main === 'R' && d < 80 && pv.kmh > 25 };
        if (nj.ped && d < 70) { G.tickT -= dt; if (G.tickT <= 0) { G.tickT = nj.pedLeft < 2.2 ? 0.22 : 0.55; audio.pedTick(nj.pedLeft < 2.2, 0.3); } }
      }
    }
    hud.signal(info);
  }
  bootFrameLog('frame-simulation');
  // ---- visuals
  syncCar(player, simulate ? dt : 0); syncCar(rival, simulate ? dt : 0);
  fx.update(simulate ? dt : 0, multiplayer.active ? [pv] : [pv, rv], camera, innerHeight * pixelRatio);
  traffic.sync(pv.s);
  const acc = { x: pv.ay, y: 0, z: -pv.ax };
  player.cockpit.update(dt, { steerInput: pv.steer / Math.max(0.05, pv.lockAt(Math.abs(pv.vLong))) * (0.55 + 0.45 * Math.min(1, pv.lockAt(Math.abs(pv.vLong)) / pv.spec.steer * 2.5)), rpm: pv.rpm, redline: pv.spec.redline, gear: pv.gear, gearLabel: pv.reverse ? 'R' : String(pv.gear), kmh: pv.kmh, nitro: pv.nitro, nitroOn: pv.nitroOn });
  player.driver.update(dt, G.t, pv.vLong, acc, player.cockpit.wheelInfo, pv.steer, pv.pose.heaveV);
  rival.driver.update(dt, G.t, rv.vLong, { x: rv.ay, y: 0, z: -rv.ax }, null, rv.steer, 0);
  updateCamera(dt);
  // sun + shadows follow the action
  const fwd = pv.forward(_v2);
  ENV.updateSun(sun, _v1.set(pv.x, pv.y, pv.z).addScaledVector(fwd, 35));
  // crossings painted near us
  if (assets.asphalt && assets.crossings) {
    const u = assets.asphalt.userData.uniforms; let k = 0;
    for (const c of assets.crossings) { if (c > pv.s - 120 && k < 16) u.uCross.value[k++] = c; }
    for (; k < 16; k++) u.uCross.value[k] = -9999;
    k = 0; for (const c of assets.stops || []) { if (c > pv.s - 120 && k < 8) u.uStop.value[k++] = c; }
    for (; k < 8; k++) u.uStop.value[k] = -9999;
  }
  ENV.U.time.value = G.t;
  bootFrameLog('frame-visuals');
  // HUD
  const iP = Math.floor((pv.s - startS) / 10), iR = Math.floor((rv.s - startS) / 10);
  let gap = NaN;
  if (G.pFinish !== null && G.rFinish !== null) gap = G.pFinish - G.rFinish;
  else {
    if (rv.s > pv.s) { const t = G.tR[clamp(iP, 0, G.tR.length - 1)]; gap = isNaN(t) ? (rv.s - pv.s) / Math.max(5, pv.vLong) : G.raceT - t; }
    else { const t = G.tP[clamp(iR, 0, G.tP.length - 1)]; gap = isNaN(t) ? -(pv.s - rv.s) / Math.max(5, rv.vLong) : -(G.raceT - t); }
    gap += G.pen - G.rPen; // penalties count
  }
  let pos = G.pFinish !== null ? (G.rFinish !== null && G.rFinish < G.pFinish ? 2 : 1) : (G.rFinish !== null ? 2 : (isFinite(gap) ? (gap <= 0 ? 1 : 2) : (pv.s >= rv.s ? 1 : 2)));
  G.shiftFlash = Math.max(0, (G.shiftFlash || 0) - dt);
  if (pv.shiftEvent) { G.shiftFlash = 0.25; }
  G.lampTC = pv.tcOn ? 0.35 : Math.max(0, (G.lampTC || 0) - dt); G.lampABS = pv.absOn ? 0.35 : Math.max(0, (G.lampABS || 0) - dt); G.lampESC = pv.escOn ? 0.35 : Math.max(0, (G.lampESC || 0) - dt);
  const st = { tc: G.lampTC > 0, abs: G.lampABS > 0, esc: G.lampESC > 0, pos, time: G.pFinish ?? (G.raceT + G.pen), gap, pen: G.pen, junctions: signals.J, s: pv.s, rs: rv.s, style: G.style, combo: G.combo, rpm: pv.rpm, redline: pv.spec.redline, kmh: pv.kmh,
    gearLabel: pv.reverse ? 'R' : (G.state === 'countdown' ? 'N' : String(pv.gear)), nitro: pv.nitro, nitroOn: pv.nitroOn, shiftFlash: G.shiftFlash, draft: G.draft || 0,
    x: pv.x, z: pv.z, yaw: pv.yaw, rx: rv.x, rz: rv.z, traffic: traffic.cars };
  if (multiplayer.active) {
    pos = multiplayer.ranking(pv.s).findIndex(p => p.id === multiplayer.id) + 1; st.pos = pos; st.time = G.pFinish ?? G.raceT; st.gap = remoteCars.size ? (rv.s - pv.s) / Math.max(5, pv.vLong) : NaN; st.pen = 0;
    st.remotes = [...remoteCars.values()].filter(c => c.model.root.visible).map(c => ({ x: c.veh.x, z: c.veh.z }));
    document.querySelector('#posBox .of').textContent = '/' + (multiplayer.lobby.results || multiplayer.lobby.players).length;
  }
  hud.update(st);
  if (G.cam === 'cockpit' && (frameN & 3) === 0) { const c = player.cockpit; hud.drawMinimap(c.navCanvas.getContext('2d'), c.navCanvas.width, c.navCanvas.height, st, 3.4, true); c.navTex.needsUpdate = true; }
  bootFrameLog('frame-hud');
  // audio
  updateAudio(dt);
  pv.shiftEvent = 0; rv.shiftEvent = 0;
  // post FX
  const u = post.u;
  u.uTime.value = G.t;
  u.uSpeed.value = clamp((pv.kmh - 90) / 200, 0, 1) * (G.cam === 'orbit' ? 0 : G.cam === 'cockpit' ? 0.7 : 1);
  u.uNitro.value = damp(u.uNitro.value, pv.nitroOn ? 1 : 0, 6, dt);
  G.flash = Math.max(0, G.flash - dt * 2.5); u.uFlash.value = G.flash; u.uShake.value = G.shake;
  sunScreen.copy(ENV.sunDir).multiplyScalar(5000).add(camera.position).project(camera);
  const vis = sunScreen.z < 1 && Math.abs(sunScreen.x) < 1.2 && Math.abs(sunScreen.y) < 1.2 ? 1 - Math.max(Math.abs(sunScreen.x), Math.abs(sunScreen.y)) / 1.2 : 0;
  u.uSun.value.set(sunScreen.x * 0.5 + 0.5, sunScreen.y * 0.5 + 0.5, vis * 0.8);
  bootFrameLog('frame-draw');
  if (draw && multiplayer.panel.hidden) render();
  bootFrameLog('frame-done');
}

// reflection probe for the cars: one cube face per frame around the player, PMREM-filtered every full turn
function createProbe() {
  const rt = new THREE.WebGLCubeRenderTarget(128, { type: THREE.HalfFloatType, generateMipmaps: false });
  const cc = new THREE.CubeCamera(0.5, 320, rt);
  for (const c of cc.children) { c.layers.set(ENV.REFLECT_LAYER); c.layers.enable(ENV.PROBE_LAYER); }
  // start from the baked sky (no scene renders at boot); the faces stream in once the race is running
  cc.coordinateSystem = renderer.coordinateSystem; cc.updateCoordinateSystem();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envRT = pmrem.fromCubemap(probeSeed);
  return { rt, cc, pmrem, envRT, face: 0 };
}
function updateProbe() {
  const p = probe;
  if (p.face === 0) { p.cc.position.set(player.veh.x, player.veh.y + 1.8, player.veh.z); p.cc.updateMatrixWorld(true); }
  const prevA = renderer.shadowMap.autoUpdate; renderer.shadowMap.autoUpdate = false;
  renderer.setRenderTarget(p.rt, p.face); renderer.render(scene, p.cc.children[p.face]); renderer.setRenderTarget(null);
  renderer.shadowMap.autoUpdate = prevA;
  p.face = (p.face + 1) % 6;
  if (p.face === 0) p.pmrem.fromCubemap(p.rt.texture, p.envRT);
}

function render() {
  renderer.info.autoReset = false; renderer.info.reset();
  if (!lowGraphics && (frameN & 1)) updateProbe();
  if ((frameN % 6) === 0) updateLod();
  sky.position.copy(camera.position);
  // planar reflections and the rear-view mirror alternate frames
  if (!lowGraphics && (frameN % 3) === 0) water.renderReflection(renderer, scene, camera);
  else if (!lowGraphics && G.cam === 'cockpit' && (frameN % 3) === 1) {
    const body = player.model.body, eye = player.cockpit.eye;
    _v1.set(0, eye.y + 0.12, eye.z - 0.1); body.localToWorld(_v1);
    mirrorCam.position.copy(_v1);
    body.getWorldQuaternion(_q); mirrorCam.quaternion.copy(_q).multiply(_q.clone().setFromAxisAngle(_v2.set(0, 1, 0), Math.PI));
    mirrorCam.rotateX(-0.04);
    player.cockpit.group.visible = false;
    const mL = player.model.mirrorL, mR = player.model.mirrorR; if (mL) mL.visible = false; if (mR) mR.visible = false;
    const prevA = renderer.shadowMap.autoUpdate; renderer.shadowMap.autoUpdate = false;
    renderer.setRenderTarget(mirrorRT); renderer.render(scene, mirrorCam); renderer.setRenderTarget(null);
    renderer.shadowMap.autoUpdate = prevA;
    player.cockpit.group.visible = true; if (mL) mL.visible = true; if (mR) mR.visible = true;
  }
  // post: camera motion blur (the racing cars are masked out), depth of field for the orbit cameras
  const orbit = G.cam === 'orbit';
  post.blur = orbit ? 0.35 : 0.5;
  for (let i = 0; i < 2; i++) {
    const m = (i ? rival : player).model;
    post.comp.uCarInv.value[i].copy(m.root.matrixWorld).invert();
    post.comp.uCarHalf.value[i].set(m.dims.W / 2 + 0.25, m.dims.H / 2 + 0.25, m.dims.L / 2 + 0.3);
  }
  post.comp.uDof.value = orbit ? 5.5 : 0;
  if (orbit) post.comp.uFocus.value = camera.position.distanceTo(_v1.set(player.veh.x, player.veh.y + 0.7, player.veh.z));
  post.render(G.lastDt || 1 / 60);
}

function onResize() {
  const w = innerWidth, h = innerHeight;
  renderer.setPixelRatio(pixelRatio); renderer.setSize(w, h);
  camera.aspect = w / h; camera.updateProjectionMatrix();
  if (post) post.setSize(w, h, pixelRatio);
  if (water) water.setSize(w * pixelRatio, h * pixelRatio);
}
addEventListener('resize', onResize);

// Multiplayer owns the online state machine; offline racing retains its AI rival.
const remoteCars = new Map();
const networkState = v => Object.fromEntries(['x', 'y', 'z', 'yaw', 's', 'u', 'vLong', 'vLat', 'steer', 'rpm', 'gear'].map(k => [k, v[k]]));
function clearDriveInput() { keys.clear(); Object.assign(input, { throttle: 0, brake: 0, steer: 0, steerRaw: 0, handbrake: false, nitro: false }); }
function onlineWait() {
  if (!player || !multiplayer.loaded) return;
  clearDriveInput(); hud.hideMenu(); hud.count(''); G.state = 'lobby'; G.cam = G.userCam; applyCamMode();
  traffic.disabled = true; resetRace(); rival.model.root.visible = false;
  document.body.classList.remove('racing', 'counting');
}
function onlineMembers(members) {
  if (!multiplayer.loaded) return;
  const ids = new Set(members.map(p => p.id));
  for (const [id, c] of remoteCars) if (!ids.has(id)) { if (c !== rival) disposeCar(c); else c.model.root.visible = false; remoteCars.delete(id); multiplayer.peers.delete(id); }
  for (const p of members) {
    let c = remoteCars.get(p.id);
    if (!c) {
      const spec = CARS.find(c => c.id === p.car) || CARS[0];
      if (![...remoteCars.values()].includes(rival)) { c = rival; c.spec = spec; c.veh.setSpec(spec); disposeCar(c); const built = makeCar(spec, false); c.model = built.model; c.driver = built.driver; }
      else c = { spec, veh: new Vehicle(spec, route), ...makeCar(spec, false) };
      c.ai = c.ai || { lane: 0, cool: 0 };
      c.veh.reset(startS, route.laneU(startS, 0)); remoteCars.set(p.id, c);
    }
    c.networkName = p.name; c.model.root.visible = ['countdown', 'race'].includes(multiplayer.lobby.status);
  }
  const first = members[0];
  if (first && remoteCars.get(first.id) !== rival) { const old = rival; rival = remoteCars.get(first.id); if (![...remoteCars.values()].includes(old)) disposeCar(old); }
  $('rivalName').textContent = first?.name || 'WAITING';
}
const multiplayer = new Multiplayer(CARS, {
  clearInput: clearDriveInput, carIndex: () => G.carIdx,
  panelClosed() { G.countWall = performance.now(); },
  join(car) { if (multiplayer.loaded) { setCar(Math.max(0, CARS.findIndex(c => c.id === car))); onlineWait(); } },
  wait: onlineWait,
  leave() {
    for (const c of remoteCars.values()) if (c !== rival) disposeCar(c); remoteCars.clear();
    if (!multiplayer.loaded) return;
    traffic.disabled = Q.has('notraffic'); setCar(G.carIdx); resetRace(); G.cam = G.userCam; applyCamMode(); startCountdown();
    document.querySelector('#posBox .of').textContent = '/2';
  },
  members: onlineMembers,
  start(lobby, id) {
    if (!multiplayer.loaded) return;
    onlineWait(); onlineMembers(lobby.players.filter(p => p.id !== id));
    const grid = (v, i) => { const s = startS - Math.floor(i / 2) * 8; v.reset(s, route.laneU(s, Math.min(i % 2, route.lanes(s) - 1)), 0); };
    grid(player.veh, lobby.players.findIndex(p => p.id === id));
    for (let i = 0; i < lobby.players.length; i++) { const c = remoteCars.get(lobby.players[i].id); if (c) { grid(c.veh, i); syncCar(c, 0); } }
    G.state = 'onlineCountdown'; G.countShown = -1; G.cam = G.userCam; applyCamMode(); audio.restart(); updateCamera(0, true);
    document.body.classList.add('counting');
  },
  remote(peers, dt) {
    for (const [id, c] of remoteCars) {
      const peer = peers.get(id); if (!peer) continue;
      const p = peer.state, v = c.veh;
      const k = Math.hypot(v.x - p.x, v.z - p.z) > 30 ? 1 : 1 - Math.exp(-18 * dt);
      for (const key of ['x', 'y', 'z', 's', 'u', 'vLong', 'vLat', 'steer', 'rpm']) v[key] += (p[key] - v[key]) * k;
      v.yaw += Math.atan2(Math.sin(p.yaw - v.yaw), Math.cos(p.yaw - v.yaw)) * k; v.gear = p.gear;
      c.lastBrake = false; c.model.root.visible = performance.now() - peer.at < 3000;
      syncCar(c, dt);
    }
  },
  clock(elapsed, remaining) {
    if (!multiplayer.loaded) return;
    if (G.state === 'onlineCountdown') {
      const n = Math.ceil(remaining);
      if (n !== G.countShown) { G.countShown = n; hud.count(n > 0 ? String(n) : 'GO!', n === 0); audio.beep(n === 0); }
      if (remaining <= 0) { G.state = 'race'; document.body.classList.remove('counting'); document.body.classList.add('racing'); }
    }
    if (multiplayer.me?.finish !== null && multiplayer.me?.finish !== undefined) {
      if (G.pFinish === null) { hud.message('FINISH · <i>' + fmtTime(multiplayer.me.finish) + '</i> · WAITING FOR OTHER DRIVERS', 8); audio.beep(true); }
      G.pFinish = multiplayer.me.finish; G.state = 'onlineFinished';
    }
    G.raceT = elapsed;
  },
  results() { G.state = 'onlineResults'; hud.count(''); },
});
window.__multiplayer = multiplayer;
if (Q.has('debug')) window.__vehicle = () => player?.veh;

boot().catch(fail);
