// PARALIAKI: race a rival down the real Athens Riviera coast road, Vouliagmeni -> the lake -> Limanakia -> Varkiza -> Lomvarda.
// World built from OpenStreetMap data (see tools/). Boots straight into a countdown, no click needed.
import * as THREE from 'three';
import { loadMap, LANE_W } from './map.js';
import * as ENV from './env.js';
import { ROAD } from './road.js';
import { CARS, CarModel, Driver, setCarEnv, setPaint } from './cars.js';
import { savedPaint } from './vehicle-paint.js';
import { Vehicle } from './physics.js';
import { input as controls } from './input.js';
import { routeVel, setRouteVel, pushVeh, extents } from './traffic.js';
import { Police, pursuit } from './police.js';
import { PoliceHud } from './police-hud.js';
import { Cockpit } from './cockpit.js';
import { Hud, fmtTime } from './hud.js';
import { Audio } from './audio.js';
import { createPost } from './post.js';
import { loadTextures, uploadTextures } from './tex.js';
import { clamp, lerp, damp, smoothstep, frameYield } from './util.js';
import { Multiplayer } from './multiplayer.js';
import * as EV from './events.js';
import { Menu } from './menu.js';
import { updateLapHud } from './lap-hud.js';
import { settings, onSettings, fmtSpeed, fmtDist, speedIn, speedUnit } from './settings.js';
import { trackVersion } from './network-track.js';
import { initWeather, updateWeather, disposeWeather } from './weather.js';
import { buildMapWorld } from './map-world.js';
import { SCENERY_TIERS, updateSceneryLod } from './scenery.js';
import { initReplay } from './replay-mode.js';

const Q = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);
const RIVAL_NAME = 'STAVROS';
const RIVAL_BODY = { mini: 'z4', z4: 'mini', taxi: 'mini' };

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
const quality = lowGraphics ? 'low' : graphicsPreference === 'med' || (graphicsPreference === 'auto' && /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent)) ? 'med' : 'high';
window.__renderInfo = () => ({ gpu: gpuName, quality, lowGraphics, pixelRatio, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures, fps: G.fps });
const DPR = Math.min(window.devicePixelRatio || 1, SCENERY_TIERS[quality].pixelRatio);
const graphicsControl = document.createElement('select'); graphicsControl.id = 'graphics-quality'; graphicsControl.setAttribute('aria-label', 'Graphics quality');
for (const [value, label] of [['auto', 'GRAPHICS: AUTO'], ['high', 'GRAPHICS: HIGH'], ['med', 'GRAPHICS: MED'], ['low', 'GRAPHICS: LOW']]) { const option = document.createElement('option'); option.value = value; option.textContent = label; graphicsControl.append(option); }
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
const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.1, 90000);
const mirrorCam = new THREE.PerspectiveCamera(42, 3.6, 0.4, 600);
const mirrorRT = new THREE.WebGLRenderTarget(512, 144, { type: THREE.HalfFloatType });
let mirrorFrame = 0;
const audio = new Audio();
audio.onTrack = (t) => hud.message(`♪ <i>${t.title}</i> · ${t.artist}`, 3);

// ------------------------------------------------------------------ game state
const G = {
  state: 'loading', t: 0, raceT: 0, countT: 0, cam: Q.get('cam') === 'chase' ? 'chase' : 'cockpit', userCam: Q.get('cam') === 'chase' ? 'chase' : 'cockpit', carIdx: 0, selIdx: 0, menuFrom: null,
  crashes: 0, topSpeed: 0, pFinish: null, rFinish: null, lastLead: 0, leadT: 0,
  shake: 0, flash: 0, driftAcc: 0, driftT: 0, markIdx: 0, finishedT: 0, orbitA: 0, autodrive: Q.has('autodrive'),
};
window.__game = G;
window.__audio = () => audio.levels && audio.levels();
window.__bus = () => audio.busLevels && audio.busLevels();
window.__dbg = () => ({ state: G.state, raceT: +G.raceT.toFixed(2), fps: Math.round(G.fps), pr: pixelRatio, kmh: Math.round(player.veh.kmh), gear: player.veh.gear, rpm: Math.round(player.veh.rpm), s: Math.round(player.veh.s), u: +player.veh.u.toFixed(2), rs: Math.round(rival.veh.s), rkmh: Math.round(rival.veh.kmh), ru: +rival.veh.u.toFixed(2), rlane: rival.ai.lane, rrev: rival.ai.revT > 0, rdbg: rival.ai.dbg, pdbg: player.ai && player.ai.dbg, crashes: G.crashes, pen: G.pen, reds: G.reds, rPen: G.rPen, rReds: G.rReds, scared: G.scared, peds: people.peds.filter((p) => p.active).length, onRoad: people.onRoad.length, calls: renderer.info.render.calls, tris: renderer.info.render.triangles });
let map, route, hud, traffic, water, sky, sun, post, assets, startS, signals, people, probe, probeSeed;
let ground = null, splash = null, fx = null, police = null, policeHud = null;
let world = null, mapSwitch = null, lastMapDisposal = null;
const lodList = [];
function updateLod() { updateSceneryLod(lodList, camera); }

let player = null, rival = null; // {veh, model, driver, cockpit, spec}
const keys = controls.keys; // retained for the simulation test hook
const input = controls.state;

// ------------------------------------------------------------------ boot
const T0 = performance.now(); const tlog = (n) => { if (Q.has('debug')) console.log(n, Math.round(performance.now() - T0), 'abs', Math.round(performance.now())); };
async function boot() {
  tlog('boot');
  lstat('LOADING MAP DATA', 0.05);
  const texReady = loadTextures(); // decodes in parallel with the world building below
  map = await loadMap(undefined, './', Q.get('map') || 'riviera');
  route = map.route;
  startS = route.start;
  hud = new Hud(map);
  hud.onPaint = (id, color) => { if (player?.spec.id === id) setPaint(player.model, color); }; // garage paint picker (hud.showPaint)
  hud.drawOverview($('overview'));
  tlog('map');
  lstat('BUILDING TERRAIN', 0.25); await frameYield();
  sky = ENV.createSky(); scene.add(sky);
  const baked = ENV.bakeSky(renderer, sky); probeSeed = baked.cube;
  scene.environment = baked.env;
  ({ sun } = ENV.createLights(scene));
  world = await buildMapWorld(map, { scene, sky, skyCube: baked.cube, lowGraphics, quality, progress: lstat });
  bindMapWorld(world);
  policeHud = new PoliceHud();
  post = createPost(renderer, scene, camera, { quality });
  probe = createProbe();
  setCarEnv(probe.envRT.texture);
  bindMapWeather(); // time of day + weather (?tod=&wx=)
  tlog('traffic+post');
  setCar(Q.has('car') ? clamp(+Q.get('car') - 1, 0, CARS.length - 1) : savedCar(), false);
  prepareEvent(SKIP_MENU && Q.get('event') || 'quick');
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
  multiplayer.loaded = true;
  multiplayer.mapId = map.id || 'riviera';
  multiplayer.trackVersion = trackVersion(map.data.route);
  initFlow();
  initReplay({ G, scene, camera, renderer, canvas, post, traffic, route, hud, input, controls, render,
    player: () => player, grid: () => multiplayer.active ? [] : grid, online: () => multiplayer.active,
    trackVersion: () => multiplayer.trackVersion });
  if (multiplayer.active) {
    setCar(Math.max(0, CARS.findIndex(c => c.id === multiplayer.me.car)));
    // Hydrate only after the lobby's track is loaded, including a reload into an ongoing race.
    onlineWait();
    await multiplayer.syncLobby();
  } else if (SKIP_MENU) startCountdown(); // test / dev URLs go straight to the grid as before
  else showTitle();
  tlog('ready');
  last = performance.now();
  requestAnimationFrame(frame);
}

// Map scene ownership is separate from persistent rendering, input and menu state.
function bindMapWorld(next) {
  ({ map, water, assets, signals, people, traffic, ground, splash, fx, markers } = next);
  route = map.route; startS = route.start;
  lodList.splice(0, lodList.length, ...next.lod);
  traffic.disabled = Q.has('notraffic') || route.closed;
  { const base = traffic.density.bind(traffic); traffic.density = (s) => base(s) * (G.trafficMul ?? 1); }
  police = new Police(traffic, route); window.__police = police;
  window.__sim = { signals, people, traffic, route, ground, fx, G, input, look, get player() { return player; } };
  if (Q.has('simhook')) Object.assign(window.__sim, { keys, step: (n = 1, dt = 1 / 60) => { for (let i = 0; i < n; i++) step(dt, false); } });
  G.mapId = map.id || 'riviera';
}
function bindMapWeather() {
  initWeather({ renderer, scene, camera, sky, water, sun, post, probe, traffic, assets, audio, quality, cars: () => [player, rival], cam: () => G.cam });
}
/** Menu/lobby contract: await switchMap(id), then prepare/start the selected event. */
async function switchMap(id = 'riviera') {
  if (mapSwitch) { await mapSwitch; return switchMap(id); }
  if (map?.id === id) return map;
  mapSwitch = (async () => {
    const priorState = G.state;
    if (window.__replay?.active) { window.__replay.close(); if (window.__replay.active) window.__replay.close(); }
    controls.clear(); G.state = 'loading';
    let nextMap, nextWorld;
    try {
      nextMap = await loadMap(undefined, './', id);
      nextWorld = await buildMapWorld(nextMap, { scene, sky, skyCube: probeSeed, lowGraphics, quality, progress: lstat });
    } catch (error) { nextMap?.dispose?.(); G.state = priorState; throw error; }
    if (G.run && !G.run.done) G.run.abort('map-change');
    window.__replay?.hideGhost();
    if (window.__replay?.ghost) window.__replay.disposeGhost();
    disposeWeather();
    police?.reset(false); for (const off of police?.offs || []) off();
    hideGrid();
    for (const c of remoteCars.values()) if (c !== rival) disposeCar(c);
    remoteCars.clear();
    const previous = world;
    world = nextWorld; bindMapWorld(world);
    // Cars persist across maps, but their dynamics must project against the new route.
    for (const c of [player, rival]) { c.veh = new Vehicle(c.spec, route); c.veh.ground = ground; c.ai = { lane: 0, cool: 0 }; delete c.networkName; }
    applyDriving();
    hud.paintPanel?.remove(); $('rticks').replaceChildren();
    hud = new Hud(map); hud.onPaint = (car, color) => { if (player?.spec.id === car) setPaint(player.model, color); };
    hud.drawOverview($('overview'));
    if (window.__replay) { Object.assign(window.__replay.ctx, { route, traffic, hud }); window.__replay.last = null; window.__replay.saved = null; window.__replay.recorder = null; }
    G.ev = null; G.run = null; G.pendingEvent = null; G.gridKey = null;
    const disposedResources = previous.dispose();
    lastMapDisposal = { mapId: previous.map.id, detached: !previous.group.parent, children: previous.group.children.length, bundleDisposed: previous.map.disposed, resources: disposedResources };
    renderer.renderLists.dispose();
    bindMapWeather();
    multiplayer.mapId = map.id; multiplayer.trackVersion = trackVersion(map.data.route);
    prepareEvent('quick'); resetRace();
    G.state = 'menu'; G.cam = 'orbit'; applyCamMode(); updateCamera(0, true);
    document.body.classList.remove('racing', 'counting');
    post.resetHistory?.(); onResize(); updateLod();
    const url = new URL(location.href); url.searchParams.set('map', map.id); history.replaceState(null, '', url);
    last = performance.now();
    return map;
  })();
  try { return await mapSwitch; } finally { mapSwitch = null; }
}
window.__switchMap = switchMap;
window.__mapRuntime = () => ({ mapId: map?.id, switching: !!mapSwitch, worlds: scene.children.filter(o => o.name.startsWith('map-world:')).map(o => o.name), lastDisposal: lastMapDisposal, memory: { ...renderer.info.memory }, weatherWidgets: document.querySelectorAll('#police-hud, #replay-controls').length });

// ------------------------------------------------------------------ cars
function makeCar(spec, isPlayer) {
  const model = new CarModel(spec);
  scene.add(model.root);
  const driver = new Driver(isPlayer ? {} : { helmet: true, shirt: '#16181c', skin: '#b67c56' });
  driver.root.position.copy(model.seat).add(new THREE.Vector3(0, -0.195, 0.1));
  model.body.add(driver.root);
  if (!spec.convertible && driver.curlMesh) {
    driver.curlMesh.scale.setScalar(.38); driver.hairBase.scale.multiplyScalar(.55);
    driver.hairY = .015; driver.hairBase.position.y = driver.hairY; // closed-car roof clearance
  } else if (spec.body !== 'mini' && driver.curlMesh) { driver.curlMesh.scale.setScalar(0.82); driver.hairBase.scale.multiplyScalar(0.85); }
  if (!isPlayer) for (const a of driver.arms) a.up.visible = a.fo.visible = a.hand.visible = false;
  return { model, driver };
}
function disposeCar(c) {
  if (!c) return;
  c.model.disposeDamage?.();
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
  // rival: a different body, same performance envelope so the race is fair. Offline the field is built per event
  // (buildGrid, from resetRace); this single rival is the boot-time car and what the online code reuses.
  if (!rival || multiplayer.active) {
  if (multiplayer.active) menu?.hide();
  hideGrid(); // online: the offline AI field goes away (rebuilt by resetRace once back offline)
  const rb = CARS.find((c) => c.id === RIVAL_BODY[spec.id]) || CARS[1];
  const rspec = { ...rb }; // A rival keeps its actual chassis, driven axle, engine and dimensions.
  disposeCar(rival);
  const rc = makeCar(rspec, false);
  const rveh = rival ? rival.veh : new Vehicle(rspec, route);
  rveh.setSpec(rspec); rveh.gear = Math.min(rveh.gear, rspec.gears.length);
  rival = { spec: rspec, veh: rveh, ...rc, ai: rival ? rival.ai : { lane: 0, cool: 0 } };
  $('rivalName').textContent = RIVAL_NAME;
  }
  applyDriving();
  applyCamMode();
  if (keepPose) { syncCar(player, 0); syncCar(rival, 0); }
}

function resetRace() {
  if (!G.ev) prepareEvent(EV.QUICK_RACE);
  if (!multiplayer.active) { resetEvent(); return; }
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
  Object.assign(G, { raceT: 0, crashes: 0, topSpeed: 0, pFinish: null, rFinish: null, lastLead: 0, leadT: 0, driftAcc: 0, driftT: 0, shake: 0, flash: 0, finishedT: 0, rivalBanner: false, cones: 0,
    pen: 0, rPen: 0, reds: 0, rReds: 0, scared: 0, postT: 0, pFront: null, rFront: null, tickT: 0, waitJ: -1 });
  const n = Math.ceil((route.finish - startS) / 10) + 2;
  G.tP = new Float32Array(n).fill(NaN); G.tR = new Float32Array(n).fill(NaN);
  G.markIdx = map.data.marks.findIndex((m) => m.s > s0 + 50); if (G.markIdx < 0) G.markIdx = map.data.marks.length;
  syncCar(player, 0); syncCar(rival, 0);
}
/** offline reset onto the active event: the grid, traffic in the event's direction and density, timing */
function resetEvent() {
  const { def, r } = G.ev, dir = r.dir;
  buildGrid();
  traffic.disabled = Q.has('notraffic') || !((def.traffic ?? 1) > 0); G.trafficMul = def.traffic ?? 1;
  const base = Q.has('s') ? +Q.get('s') : r.s0;
  const solo = !grid.length;
  if (solo) { const s = base - dir * 4; placeVeh(player.veh, s, route.closed ? 0 : dir * route.laneU(s, Math.min(1, route.lanes(s) - 1)), dir); }
  else { const g = gridSlot(grid.length, base); placeVeh(player.veh, g.s, g.u, dir); }
  player.dir = dir;
  for (const [i, c] of grid.entries()) {
    const g = gridSlot(i, base); placeVeh(c.veh, g.s, g.u, dir); c.dir = dir;
    c.ai = { lane: g.lane, u: g.u, cool: 0, mistakeT: (20 + Math.random() * 20) / c.drv.mistakes, sigJ: -1 };
    Object.assign(c, { pen: 0, reds: 0, finish: null, front: null, ghost: false, lastBrake: false });
  }
  if (solo) { // no rivals: park the spare car well out of the way (and out of earshot)
    const s = clamp(r.s0 - dir * 700, 5, route.length - 5); rival.veh.reset(s, -dir * route.laneU(s, 0), 0);
    rival.ai = { lane: 0, cool: 0, sigJ: -1 }; rival.model.root.visible = false; rival.finish = null; rival.pen = 0;
  }
  for (const v of [player.veh, ...grid.map((c) => c.veh)]) { v.nitro = 0.4; v.dragMul = 1; v.wallHit = 0; v.safe = null; v.water = 0; }
  G.sinkT = 0; G.sinkFade = false; G.stuckT = 0; G.stuckHint = false; G.towing = false;
  if (fx) fx.clearMarks();
  if (player.ai) { player.ai.sigJ = -1; player.ai.lane = undefined; }
  signals.reset();
  traffic.reset(player.veh.s);
  people.reset(peopleS(player.veh.s));
  Object.assign(G, { raceT: 0, crashes: 0, topSpeed: 0, pFinish: null, rFinish: null, lastLead: 0, leadT: 0, driftAcc: 0, driftT: 0, shake: 0, flash: 0, finishedT: 0, rivalBanner: false, cones: 0,
    pen: 0, rPen: 0, reds: 0, rReds: 0, scared: 0, postT: 0, pFront: null, rFront: null, tickT: 0, waitJ: -1,
    lastPos: 0, gapWho: null, lastSplit: null, lastTrap: null, wrong: {}, wrongShown: null, evHtml: null, result: null });
  const n = Math.ceil(r.len / 10) + 4;
  G.tP = new Float32Array(n).fill(NaN); G.tR = new Float32Array(n).fill(NaN);
  for (const c of grid) c.tR = new Float32Array(n).fill(NaN);
  G.marksDir = map.data.marks.filter((m) => prog(m.s) > 50 && prog(m.s) <= r.len + 1).sort((a, b) => prog(a.s) - prog(b.s)); G.markIdx = 0;
  document.querySelector('#posBox .of').textContent = '/' + (grid.length + 1);
  if (grid[0]) $('rivalName').textContent = grid[0].name;
  syncCar(player, 0); for (const c of grid) syncCar(c, 0); if (solo) syncCar(rival, 0);
  police?.reset(false); // police come back on at the event's 'start' (src/police.js)
}
// people spawn / despawn in a window ahead of where they're told the player is; reverse events look the other way
const peopleS = (s) => (G.dir < 0 && !multiplayer.active ? s - 300 : s);

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
  const s = route.closed ? sf.s : clamp(sf.s, 5, route.length - 5), lanes = route.lanes(s);
  const lane = clamp(Math.round((Math.abs(sf.u) - route.medHalf(s)) / LANE_W - 0.5), 0, lanes - 1);
  pv.reset(s, route.closed ? clamp(sf.u, -route.edge(s) + 1.2, route.edge(s) - 1.2) : Math.sign(sf.u || 1) * route.laneU(s, lane), 0);
  if (sf.u < 0 && !route.closed) pv.yaw += Math.PI; // you were on the far side heading back: face the way you came
  pv._curbZ = null; pv._gx = pv._gz = pv._gy = undefined; pv.air = 0; pv.vy = 0;
}

// ---- stuck (dug into the sand, wheels spinning against a bank, wedged in the scrub): after a few seconds of trying,
// a hint (back out with S, ease the throttle); T calls a tow back onto the road at any time, and after a long
// fight the tow comes on its own
function stuckCheck(pv, dt) {
  if (G.state !== 'race' || G.sinkT || G.towing) { G.stuckT = 0; return; }
  const trying = input.throttle > 0.3 || input.brake > 0.3;
  const burnout = input.throttle > 0.3 && input.brake > 0.3 && !pv.offroad; // brake held on tarmac: on purpose
  const stuck = trying && !burnout && pv.kmh < 3 && (pv.offroad || pv.dig > 0.15 || pv.wheelspin > 0.3);
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
  menu?.hide();
  if (!multiplayer.active && G.ev) {
    if (G.run && !G.run.done) G.run.abort('restart');
    G.run = new EV.EventRun(G.ev.def, evCtx(), { car: player.spec.id });
    const r = G.ev.r; hud.banner(G.ev.def.name, `${r.fromName} ${r.reverse ? '◀' : '▶'} ${r.toName} · ${EV.TYPES[G.ev.def.type].label}`);
  }
}

function restart(idx = G.carIdx) {
  if (multiplayer.active) return;
  document.body.classList.add('fading');
  setTimeout(() => {
    if (multiplayer.active) { document.body.classList.remove('fading'); return; }
    if (G.run && !G.run.done) G.run.abort('restart');
    if (G.pendingEvent) { prepareEvent(G.pendingEvent); G.pendingEvent = null; }
    if (idx !== G.carIdx || player.spec !== CARS[idx]) setCar(idx);
    setPaint(player.model, savedPaint(player.spec));
    resetRace(); audio.restart();
    G.cam = G.userCam || 'cockpit'; applyCamMode();
    updateCamera(0, true);
    startCountdown();
    document.body.classList.remove('fading');
  }, 280);
}

// ------------------------------------------------------------------ input
addEventListener('keydown', e => {
  if (e.target.closest?.('input, select, textarea, button, [contenteditable]')) return;
  if (!multiplayer.panel.hidden) { clearDriveInput(); return; }
  audio.start();
});
addEventListener('pointerdown', () => audio.start());

function readInput(dt) {
  const inMenu = window.__flow.inMenu();
  const blocked = document.hidden || !multiplayer.panel.hidden || G.state === 'loading';
  controls.update(dt, { speed: player ? Math.abs(player.veh.vLong) : 0, inMenu, blocked });
  for (const name of controls.actions) {
    // Shared defaults (Escape, Enter, A/B) have different meanings in a menu and while driving.
    if ((inMenu && name === 'restart' && input.confirm) || (inMenu && name === 'pause' && input.back) || (!inMenu && name === 'back')) continue;
    flowAction(name);
    if (!inMenu && (name === 'shiftUp' || name === 'shiftDown')) player?.veh.shiftManual(name === 'shiftUp' ? 1 : -1);
  }
  // An action can open a menu during this very poll; zero driving immediately.
  if (window.__flow?.inMenu?.()) Object.assign(input, { throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false });
  if (input.throttle || input.brake || input.steer) document.body.classList.add('started');
}
// ------------------------------------------------------------------ events, modes & menus (race flow)
// The flow: loading -> 'menu' (title / events / settings, src/menu.js) -> countdown -> race -> finished -> results.
// 'paused' (Esc / tab hidden) freezes the simulation; 'garage' is the car picker reached from the title menu.
// Online races are handed to multiplayer.js (its own lobby / onlineCountdown / onlineFinished states).
let grid = []; // the offline AI field: [{ spec, veh, model, driver, ai, drv, name, dir, pen, reds, finish, tR, actor }]; grid[0] === rival
let markers = null, menu = null;
const MENU_STATES = ['menu', 'paused', 'results', 'garage'];
const evCtx = () => ({ map, mapId: map.id || 'riviera', route, marks: map.data.marks, events: map.events });
const aidSpec = (spec) => (settings.aids ? spec : { ...spec, tc: 0, esc: 0, edl: 0, abs: false });
function applyDriving() {
  if (!player) return;
  player.veh.setSpec(aidSpec(player.spec));
  player.veh.setManual?.(settings.transmission === 'manual');
}
function carBest(i) { return +localStorage.getItem('paraliaki.best.' + CARS[i].id) || 0; }
// dev / test URLs (?simhook, ?autodrive, ?car=, ?s=, ?event=, ?quick) skip the title menu; ?menu forces it
const SKIP_MENU = !Q.has('menu') && ['simhook', 'autodrive', 'car', 's', 'event', 'quick', 'fixeddt', 'turbo'].some((k) => Q.has(k));
function savedCar() { try { const i = CARS.findIndex((c) => c.id === localStorage.getItem('paraliaki.car')); return i >= 0 ? i : 0; } catch { return 0; } }
function initFlow() {
  menu = new Menu($('ui'), {
    quickRace: () => openEvent('quick'), openEvent, multiplayer: () => multiplayer.open(), garage: openGarage, switchMap,
    chooseCar: (index, def, garage) => {
      try { localStorage.setItem('paraliaki.car', CARS[index].id); } catch {}
      if (garage) { setCar(index); menu.back(); return; }
      if (!def) return;
      G.pendingEvent = def; restart(index);
    },
    resume, restart: () => restart(), quit: quitToMenu, next: (id) => openEvent(id),
    ctx: evCtx, carName: () => player.spec.name, fmtTime, ui: (fwd) => audio.ui?.(fwd),
    bindings: (el) => controls.openBindings?.(el), cancelBindings: () => controls.cancelCapture?.(), graphicsControl,
  });
  onSettings(onFlowSettings); onFlowSettings(settings, null);
  // police pursuits (src/police.js): keep the latest state; busted ends any race as a DNF; shaking them off wins an escape
  EV.events.on('pursuit', (p) => {
    G.pursuit = p;
    if (G.state !== 'race' || multiplayer.active || !G.ev) return;
    if (p.phase === 'busted') finishRace('busted'); // a DNF in any race
    else if (p.phase === 'evaded' && G.ev.def.type === 'pursuit' && G.ev.def.rules?.goal === 'escape') finishRace('evaded');
  });
  EV.events.on('start', () => { G.pursuit = null; });
  // the leaderboard (multiplayer owner) gets every finished solo event
  import('./leaderboard.js').then((m) => { if (m?.submitResult) EV.events.on('finish', (r) => { try { m.submitResult(r); } catch (e) { console.warn(e); } }); }).catch(() => {});
}

function mapEvent(id) {
  if (id && typeof id === 'object') return id;
  const list = map.events || [];
  if (id === 'quick') return map.id === 'riviera' ? EV.QUICK_RACE : list.find(e => e.type === 'sprint') || list[0] || EV.QUICK_RACE;
  return list.find(e => e.id === id) || EV.getEvent(id);
}

/** make an event (definition or id) the active one: route segment / direction, HUD range, arches, traffic direction */
function prepareEvent(e) {
  const def = mapEvent(e) || mapEvent('quick');
  const r = EV.resolve(def, evCtx());
  G.ev = { def, r }; G.dir = r.dir; startS = r.s0;
  traffic.dir = r.dir;
  hud.setRange(r.s0, r.s1);
  markers.build(r, { start: map.id === 'riviera' ? route.start : NaN, finish: map.id === 'riviera' ? route.finish : NaN });
  document.body.dataset.mode = def.type;
  // time of day / weather (the conditions system, when it is there)
  const sc = window.__setConditions, gc = window.__conditions;
  if (typeof sc === 'function' && typeof gc === 'function' && !multiplayer.active) {
    if (!G.baseCond) G.baseCond = gc(); // whatever the session started with (?tod= / ?wx=)
    const want = { ...G.baseCond, ...(def.conditions || {}) }, now = gc();
    if (want.time !== now.time || want.weather !== now.weather) { try { sc(want); } catch (err) { console.warn('[events] setConditions', err); } }
  }
  return r;
}
/** Grid slot i: 8 m rows; single file on one-lane roads, two abreast otherwise. */
function gridSlot(i, base = G.ev.r.s0) {
  const r = G.ev.r, dir = r.dir;
  const columns = route.closed || route.lanes(base) > 1 ? 2 : 1;
  const rawS = base - dir * (4 + Math.floor(i / columns) * 8);
  const s = route.closed ? rawS : clamp(rawS, 5, route.length - 5);
  const lane = Math.min(i % 2, route.lanes(s) - 1);
  const u = route.closed ? (i % 2 ? 1 : -1) * Math.min(2.25, Math.max(.5, route.edge(s) - 1.2)) : dir * route.laneU(s, lane);
  return { s, u, lane, yaw: Math.atan2(-route.lin(route.TX, s), -route.lin(route.TZ, s)) + (dir < 0 ? Math.PI : 0) };
}
function placeVeh(veh, s, u, dir) { veh.reset(s, u, 0); if (dir < 0) veh.yaw += Math.PI; }
const prog = (s) => (s - G.ev.r.s0) * G.ev.r.dir;

/** the AI field for the active event (rebuilt only when the event or your car changes) */
function buildGrid() {
  if (multiplayer.active) return;
  const def = G.ev.def, drivers = def.type === 'sprint' ? EV.gridFor(def) : [];
  const key = def.id + '|' + player.spec.id + '|' + drivers.map((d) => d.id).join(',');
  if (key === G.gridKey && !rival.networkName) return;
  G.gridKey = key;
  for (const c of grid) if (c !== rival) disposeCar(c);
  grid = [];
  const ids = CARS.map((c) => c.id);
  for (const [i, d] of drivers.entries()) {
    const spec = CARS.find((c) => c.id === EV.driverCar(d, ids, player.spec.id)) || CARS[1];
    let c;
    if (i === 0) { // the first one is `rival`, the car the audio, the post blur mask and the online code know about
      disposeCar(rival); const built = makeCar(spec, false);
      rival = { spec, veh: rival.veh, ...built, ai: { lane: 0, cool: 0 } }; rival.veh.setSpec(spec); rival.veh.gear = 1; c = rival;
    } else c = { spec, veh: new Vehicle(spec, route), ...makeCar(spec, false), ai: { lane: 0, cool: 0 } };
    c.veh.ground = ground; c.drv = d; c.name = d.name; c.actor = { veh: c.veh, kind: 'rival', car: c };
    grid.push(c);
  }
  if (!grid.length) { rival.name = ''; rival.drv = null; }
  rival.model.root.visible = grid.length > 0;
}
/** drop the offline AI field (going online): extras are disposed, `rival` is left to the online code */
function hideGrid() {
  for (const c of grid) if (c !== rival) disposeCar(c);
  grid = []; G.gridKey = null;
}
/** the rival the HUD gap, audio and slipstream follow: the nearest car ahead, else the nearest behind */
function focusRival() {
  if (!grid.length) return rival;
  const pp = prog(player.veh.s); let best = null, bd = 1e9;
  for (const c of grid) { const d = prog(c.veh.s) - pp, k = d >= -3 ? d : 400 - d; if (k < bd) { bd = k; best = c; } }
  return best;
}

function onFlowSettings(s, key) {
  audio.setVolumes?.({ master: s.master, music: s.music, sfx: s.sfx });
  if (key === 'aids' || key === 'transmission' || !key) applyDriving();
  if (key === 'units' && menu?.screen === 'events') menu.render();
}

// Direct simulation API: retained for automation and integrations; the menu calls openEvent.
function startEvent(id, opts = {}) {
  if (multiplayer.active) { multiplayer.open(); return; }
  const def = mapEvent(id); if (!def) return;
  const car = def.car || opts.car;
  const idx = car == null ? G.carIdx : typeof car === 'number' ? clamp(Math.floor(car), 0, CARS.length - 1) : Math.max(0, CARS.findIndex(c => c.id === car));
  G.pendingEvent = def; restart(idx);
}
function openEvent(id) {
  if (multiplayer.active) { multiplayer.open(); return; }
  const def = mapEvent(id); if (!def) return;
  const idx = def.car ? Math.max(0, CARS.findIndex(c => c.id === def.car)) : G.carIdx;
  G.state = 'menu'; controls.clear();
  menu.show('car', { def, index: idx }, true);
}

function pauseGame() {
  if (multiplayer.active) { multiplayer.open(); return; }
  if (!['race', 'countdown', 'finished'].includes(G.state)) return;
  G.paused = { state: G.state, cam: G.cam };
  G.state = 'paused'; controls.clear();
  const d = G.ev.def;
  menu.show('pause', { kick: `${d.name} · ${G.ev.r.fromName} ${G.ev.r.reverse ? '◀' : '▶'} ${G.ev.r.toName}`, sub: G.paused.state === 'countdown' ? 'ON THE GRID' : `TIME ${fmtTime(G.raceT + G.pen)}` });
}
function resume() {
  if (G.state !== 'paused') return;
  menu.hide(); G.state = G.paused.state; G.countWall = performance.now(); G.paused = null;
}
function quitToMenu(screen = 'title') {
  if (multiplayer.active) return;
  if (G.run && !G.run.done) G.run.abort('quit');
  document.body.classList.add('fading');
  setTimeout(() => {
    hud.hideMenu(); hud.count('');
    document.body.classList.remove('racing', 'counting');
    G.state = 'menu'; G.cam = 'orbit'; applyCamMode(); G.orbitA = 0.4;
    resetRace(); audio.restart?.();
    updateCamera(0, true);
    menu.show(screen === 'events' ? 'events' : 'title');
    document.body.classList.remove('fading');
  }, 260);
}
function showTitle() {
  G.state = 'menu'; G.cam = 'orbit'; applyCamMode(); G.orbitA = 0.4;
  document.body.classList.remove('racing', 'counting');
  menu.show('title');
}

// Garage and pre-race selection share one showroom; only confirm swaps the driven car.
function openGarage() {
  if (multiplayer.active) { multiplayer.open(); return; }
  if (G.state !== 'menu') return;
  menu.show('car', { index: G.carIdx, garage: true }, true);
}

/** every named input action lands here (src/input.js -> readInput -> window.__flow.action) */
function flowAction(name) {
  if (G.state === 'loading' || !menu) return false;
  if (window.__replay?.action?.(name)) return true; // replay / photo mode take the input while they're up
  if (name === 'garage' && G.state === 'menu' && (menu.screen === 'title' || menu.screen === 'events')) { audio.ui(true); openGarage(); return true; }
  if (menu.open) return menu.action(name);
  if (MENU_STATES.includes(G.state)) return true;
  if (/^car[1-9]$/.test(name)) { const i = +name.slice(3) - 1; if (i < CARS.length && !multiplayer.active) { audio.ui(true); restart(i); } return true; }
  switch (name) {
    case 'camera': G.cam = G.cam === 'cockpit' ? 'chase' : 'cockpit'; G.userCam = G.cam; applyCamMode(); hud.message(G.cam === 'cockpit' ? '<i>COCKPIT</i> CAM' : '<i>CHASE</i> CAM', 1.2); return true;
    case 'tow': tow(player.veh); return true;
    case 'restart': if (G.state === 'race' || G.state === 'countdown' || G.state === 'finished') restart(); return true;
    case 'pause': pauseGame(); return true;
    case 'music': hud.message(audio.toggleMusic() ? 'MUSIC <i>ON</i>' : 'MUSIC <i>OFF</i>', 1.2); return true;
    case 'nextTrack': audio.nextTrack(); return true;
    case 'garage': if (multiplayer.active) multiplayer.open(); else pauseGame(); return true; // the garage lives in the menus; mid-race G pauses
  }
  return false;
}
const inMenu = () => MENU_STATES.includes(G.state) || !!window.__replay?.active; // replay / photo mode take the controls too
window.__flow = {
  switchMap, get mapId() { return map?.id || 'riviera'; }, get map() { return map; },
  action: flowAction, inMenu, prepareEvent, gridSlot, event: () => G.ev, startEvent, openEvent, quickRace: () => startEvent('quick'),
  pause: pauseGame, resume, quit: quitToMenu, hideGrid, setTraffic: (mul) => { G.trafficMul = mul; traffic.disabled = !(mul > 0); }, restart: () => restart(), get state() { return G.state; }, get menu() { return menu; }, get grid() { return grid; },
};
document.addEventListener('visibilitychange', () => { if (document.hidden && !multiplayer.active && (G.state === 'race' || G.state === 'countdown')) pauseGame(); });

/** reverse-aware traffic.laneInfo: nearest thing ahead in travel direction dir within [from, to] metres of s */
function laneInfoDir(u, from, to, halfW, s, dir) {
  if (dir > 0) return traffic.laneInfo(u, s + from, s + to, halfW);
  const s0 = s - from, span = to - from; let best = 1e9, bv = 0;
  for (const c of traffic.cars) {
    if (!c.active) continue;
    const d = s0 - c.s; if (d < -c.hs || d > span) continue;
    if (Math.abs(c.u - u) > c.hu + halfW + 0.35) continue;
    const g = d - c.hs; if (g < best) { best = g; bv = c.crash || c.cross || c.mode === 'parked' ? 0 : -c.dir * c.v; }
  }
  for (const p of people.onRoad) { const d = s0 - p.s; if (d < -0.6 || d > span || Math.abs(p.u - u) > halfW + 0.9) continue; if (d - 1 < best) { best = Math.max(0, d - 1); bv = 0; } }
  for (const st of traffic.sites) { const d = s0 - (st.s + st.len / 2); if (d < -st.len || d > span || Math.abs(st.u - u) > st.wid * 0.5 + halfW) continue; if (Math.max(0, d) < best) { best = Math.max(0, d); bv = 0; } }
  return { gap: best, v: bv };
}
/** a stop line crossed between two front-bumper positions, in either direction of travel */
function crossedDir(prev, now, dir) {
  if (dir > 0) return signals.crossed(prev, now);
  for (const j of signals.J) if (prev > j.sO && now <= j.sO) return j;
  return null;
}

// ---- the AI field, every step (offline only): rubber band, personalities, red lights, finishing
function updateGrid(dt) {
  const pv = player.veh, pp = prog(pv.s), len = G.ev.r.len;
  for (const c of grid) {
    const v = c.veh, d = c.drv, lead = prog(v.s) - pp;
    // rubber band: keeps the race close, but a clean, fast run still wins; each driver has their own pace
    let pace = d.pace;
    if (lead > 50) pace -= Math.min(0.3, (lead - 50) / 900);
    if (lead < -40) pace += Math.min(0.08, (-lead - 40) / 800);
    c.ai.nitroOk = lead < 40 * d.nitro;
    c.ai.mistakeT -= dt;
    if (c.ai.mistakeT < 0) { c.ai.mistakeT = (25 + Math.random() * 30) / d.mistakes; if (lead > -20) c.ai.mistake = 1.2 + Math.random(); }
    if (c.finish !== null) pace = prog(v.s) > len + 120 ? 0 : 0.3;
    const rin = aiInput(c, dt, pace, [player, ...grid.filter((o) => o !== c)]);
    if (pace === 0) { rin.throttle = 0; rin.brake = v.vLong > 1 ? 0.7 : 0; rin.handbrake = v.vLong <= 1; }
    c.lastBrake = rin.brake > 0.2;
    v.dragMul = 1;
    v.update(dt, rin);
    if (!v.nitroOn) v.nitro = Math.min(1, v.nitro + dt * 0.02);
    // stop lines
    const f = v.s + G.dir * v.halfL;
    if (G.state === 'race' && c.front !== null && v.vLong > 0 && c.finish === null) { const j = crossedDir(c.front, f, G.dir); if (j) onStopLine(j, 'rival', c); }
    c.front = c.front === null ? f : G.dir > 0 ? Math.max(c.front, f) : Math.min(c.front, f);
    // out of sight a rival is not held up by traffic (they know these roads); in sight they race for real
    c.ghost = Math.abs(v.s - pv.s) > 140 || c.ai.passT > 0;
  }
}

// ---- timing, positions, splits, cameras, the finish (offline, state 'race')
function raceTiming(dt) {
  const pv = player.veh, run = G.run, r = G.ev.r, def = G.ev.def, pp = prog(pv.s);
  const iP = Math.floor(pp / 10);
  if (iP >= 0 && iP < G.tP.length && isNaN(G.tP[iP])) for (let i = iP; i >= 0 && isNaN(G.tP[i]); i--) G.tP[i] = G.raceT;
  for (const c of grid) {
    const cp = prog(c.veh.s), iR = Math.floor(cp / 10);
    if (iR >= 0 && iR < c.tR.length && isNaN(c.tR[iR])) for (let i = iR; i >= 0 && isNaN(c.tR[i]); i--) c.tR[i] = G.raceT;
    if (c.finish === null && cp >= r.len) { c.finish = G.raceT + c.pen; if (G.pFinish === null && !G.rivalBanner) { G.rivalBanner = true; hud.pop('info cyan', c.name + ' FINISHED'); } }
  }
  // positions and overtakes
  if (grid.length) {
    const pos = racePosition();
    if (G.raceT > 2 && G.lastPos && pos !== G.lastPos && G.t - G.leadT > 1.2) {
      G.leadT = G.t;
      if (pos < G.lastPos) { audio.pluck(587, 0, 0.14); audio.pluck(880, 0.08, 0.14); } // the position box shows it; no pop
    }
    G.lastPos = pos;
  }
  // splits (a brief delta pop in time trials only), the finish, the pursuit survive clock
  for (const e of run.update(dt, { t: def.type === 'pursuit' && def.rules?.goal === 'survive' ? G.raceT : G.raceT + G.pen, s: pv.s, kmh: pv.kmh })) {
    if (e.kind === 'split' && !e.last) {
      const dl = e.delta;
      if (def.type === 'timetrial') hud.pop('split ' + (dl === null ? '' : dl <= 0 ? 'good' : 'bad'), e.name, fmtTime(e.time) + (dl === null ? '' : ` · ${dl <= 0 ? '−' : '+'}${Math.abs(dl).toFixed(2)}`));
    } else if (e.kind === 'finish') { G.pFinish = G.raceT + G.pen; finishRace(); return; }
    else if (e.kind === 'timeup') { finishRace('timeup'); return; }
  }
  // district banners, in the direction of travel
  const marks = G.marksDir;
  while (G.markIdx < marks.length && pp >= prog(marks[G.markIdx].s)) { const m = marks[G.markIdx++]; hud.banner(m.name, m.sub.toUpperCase()); }
}
function racePosition() {
  if (!grid.length) return 1;
  const me = { me: true, prog: prog(player.veh.s), finish: G.pFinish };
  const ranked = EV.rankRacers([me, ...grid.map((c) => ({ c, prog: prog(c.veh.s), finish: c.finish, dnf: !!(c.dnf || c.retired || c.veh.engineStalled || c.veh.drivetrainBroken) }))]);
  return ranked.indexOf(me) + 1;
}
/** HUD gap: to the car ahead (+, behind it) or, leading, to the car behind (−); positions 1..N */
function raceGap() {
  const pos = racePosition();
  if (!grid.length) {
    const i = (G.run?.splits.length || 0) - 1, best = G.run?.best.bestSplits?.[i];
    $('rivalName').textContent = 'BEST';
    return { pos: 1, gap: best == null ? NaN : G.run.splits[i] - best };
  }
  const pp = prog(player.veh.s), pv = player.veh;
  const others = grid.map((c) => ({ c, d: prog(c.veh.s) - pp }));
  const ahead = others.filter((o) => o.d > 0).sort((a, b) => a.d - b.d)[0], behind = others.filter((o) => o.d <= 0).sort((a, b) => b.d - a.d)[0];
  let gap = NaN, who = null;
  if (G.pFinish !== null) { const f = grid.filter((c) => c.finish !== null).sort((a, b) => a.finish - b.finish)[0]; if (f) { gap = G.pFinish - f.finish; who = f; } }
  else if (ahead && pos > 1) { const c = ahead.c, t = c.tR[clamp(Math.floor(pp / 10), 0, c.tR.length - 1)]; gap = isNaN(t) ? ahead.d / Math.max(5, pv.vLong) : G.raceT - t; gap += G.pen - c.pen; who = c; }
  else if (behind) { const c = behind.c, t = G.tP[clamp(Math.floor(prog(c.veh.s) / 10), 0, G.tP.length - 1)]; gap = isNaN(t) ? behind.d / Math.max(5, c.veh.vLong) : -(G.raceT - t); gap += G.pen - c.pen; who = c; }
  if (who && who !== G.gapWho) { G.gapWho = who; $('rivalName').textContent = who.name; }
  return { pos, gap };
}

/** how: 'finish' (crossed the line) | 'evaded' (shook the police in a pursuit-escape) | 'timeup' (survived a pursuit's
 *  clock) | 'busted' (caught: a DNF in any race) */
function finishRace(how = 'finish') {
  if (how === true) how = 'timeup';
  G.state = 'finished'; G.finishedT = 0; G.postT = 0;
  const run = G.run, def = G.ev.def, r = G.ev.r;
  const busted = how === 'busted';
  if (how === 'timeup') G.pFinish = def.rules?.timeLimit || G.raceT;
  else if (how === 'evaded') G.pFinish = G.raceT + G.pen;
  if (busted) G.pFinish = null;
  const pos = racePosition();
  const res = run.finish({ time: G.pFinish, position: busted ? grid.length + 1 : pos, field: grid.length + 1, penalties: G.pen, carName: player.spec.name, topSpeed: G.topSpeed, crashes: G.crashes, reds: G.reds, busted, how, valid: !G.autodrive && !Q.has('s') && !busted });
  G.result = res;
  G.won = !busted && (def.type === 'sprint' ? pos === 1 : !!res.medal);
  if (G.won) audio.win(); else audio.lose();
  hud.pop(G.won ? 'info good' : 'info bad', busted ? 'BUSTED!' : how === 'evaded' ? 'LOST THEM!' : how === 'timeup' ? 'SURVIVED!' : def.type === 'sprint' ? (pos === 1 ? 'FINISH!' : 'P' + pos) : 'FINISH!', res.medal ? res.medal.toUpperCase() + ' MEDAL' : '');
  // the per-car best of the full route (garage card)
  if (G.pFinish !== null && def.type !== 'pursuit' && Math.round(r.s0) === Math.round(route.start) && Math.round(r.s1) === Math.round(route.finish)) {
    const key = 'paraliaki.best.' + player.spec.id; const prev = +localStorage.getItem(key) || 0;
    if (!prev || G.pFinish < prev) localStorage.setItem(key, G.pFinish.toFixed(3));
  }
}
/** results: straight time. Position, time, gap to the winner, event best, the classification and the splits */
function showResults() {
  G.state = 'results'; G.cam = 'orbit'; applyCamMode(); G.selIdx = G.carIdx;
  const res = G.result, def = G.ev.def, r = G.ev.r, run = G.run, prev = run.best || {};
  // Rivals may finish during the post-race coast. Their actual penalized times decide the classification.
  if (def.type === 'sprint' && !res.busted) {
    const pos = racePosition();
    if (pos !== res.position) {
      res.position = pos; res.medal = EV.medalFor(def, res, r); G.won = pos === 1;
      if (res.record) {
        res.record.medal = EV.betterMedal(prev.medal, res.medal) || null;
        res.record.bestPos = Math.min(prev.bestPos ?? 99, pos);
        res.record.last.position = pos; res.record.last.medal = res.medal;
        EV.saveRecord(def.id, res.record);
      }
    }
  }
  const T = (t) => (t == null ? '—' : fmtTime(t)), sign = (d) => (d <= 0 ? '−' : '+') + Math.abs(d).toFixed(2);
  const avg = res.time ? fmtSpeed((G.run?.maxProg || 0) / res.time * 3.6) : '—';
  const kick = `${def.name} · ${r.fromName} ${r.reverse ? '◀' : '▶'} ${r.toName} · ${fmtDist(r.len)}`;
  const splits = run.splits.map((t, i) => { const b = prev.bestSplits?.[i]; const cp = r.checkpoints[i]; return { name: cp.name, time: fmtTime(t), delta: b != null ? sign(t - b) : '', cls: b == null ? '' : t <= b ? 'good' : 'bad' }; });
  const best = res.record?.bestTime ?? prev.bestTime;
  const info = [['TOP SPEED', fmtSpeed(G.topSpeed)], ['AVG SPEED', avg], ['CRASHES', G.crashes], ['RED LIGHTS', G.reds ? `${G.reds} · +${G.pen.toFixed(1)} S` : '0']];
  if (res.laps > 1 && res.bestLap != null) info.unshift(['BEST LAP', T(res.bestLap)]);
  let title, sub, rows, field = null;
  if (res.busted) {
    title = 'BUSTED'; sub = 'The ΕΛ.ΑΣ. got you. Did not finish.';
    rows = [['RESULT', 'DNF'], ['TIME', T(G.raceT + G.pen)], ['EVENT BEST', T(best)], ...info];
  } else if (def.type === 'sprint') {
    const pos = res.position;
    const winner = grid.filter((c) => c.finish !== null).sort((a, b) => a.finish - b.finish)[0];
    title = pos === 1 ? 'VICTORY' : `P${pos} OF ${res.field}`;
    const gap = pos === 1 ? (winner ? winner.finish - res.time : null) : winner ? res.time - winner.finish : null;
    sub = pos === 1 ? (gap != null ? `Won by <b>${gap.toFixed(2)} s</b>.` : 'Won.') : `<b>${gap != null ? gap.toFixed(2) : '?'} s</b> behind <b>${esc(winner?.name || '')}</b>.`;
    rows = [['POSITION', `P${pos} / ${res.field}`], ['YOUR TIME', T(res.time)], [pos === 1 ? 'MARGIN' : 'GAP TO WINNER', gap != null ? (pos === 1 ? '−' : '+') + gap.toFixed(2) + ' S' : '—'], ['EVENT BEST', T(best), res.newBest], ...info];
  } else {
    const d = prev.bestTime != null && res.time != null ? res.time - prev.bestTime : null;
    title = T(res.time);
    sub = def.type === 'pursuit' ? (res.how === 'timeup' ? 'Survived with the police on your tail.' : 'Lost the police.') : d === null ? 'First run on the board.' : d < 0 ? `New best by <b>${Math.abs(d).toFixed(2)} s</b>.` : `<b>${d.toFixed(2)} s</b> off your best.`;
    rows = [['YOUR TIME', T(res.time)], ['EVENT BEST', T(best), res.newBest], ...info];
  }
  if (def.type === 'sprint') {
    const all = [{ name: 'YOU', car: player.spec.short, finish: res.time, prog: prog(player.veh.s), me: true, dnf: !!res.busted }, ...grid.map(c => ({ name: c.name, car: c.spec.short, finish: c.finish, prog: prog(c.veh.s), dnf: !!(c.dnf || c.retired || c.veh.engineStalled || c.veh.drivetrainBroken) }))];
    // Finishers are ordered by time; still running shows distance to go, retired cars show DNF.
    field = EV.rankRacers(all).map((f, i) => ({ pos: i + 1, name: f.name, car: f.car, me: f.me, time: f.finish != null ? fmtTime(f.finish) : f.dnf ? 'DNF' : `+${fmtDist(Math.max(0, r.len - f.prog))}` }));
  }
  menu.show('results', { result: res, def, r, kick, title, sub, win: G.won, rows, splits: def.type === 'pursuit' ? null : splits, field, next: null });
}
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** event HUD: the wrong-way warning, and the survive clock in pursuit-survive (offline) */
function updateEventHud(dt) {
  const box = $('evBox'), ww = $('wrongWay');
  if (!box || !G.ev || multiplayer.active) return;
  const pv = player.veh, run = G.run, def = G.ev.def;
  // wrong way: nose against the event's direction of travel
  const hd = Math.atan2(-route.lin(route.TX, pv.s), -route.lin(route.TZ, pv.s)) + (G.dir < 0 ? Math.PI : 0);
  // only once racing (never on the grid or in the countdown), and the HUD class is forced, never toggled
  const wrong = G.state === 'race' && G.raceT > 1 && !!EV.wrongWay(G.wrong, dt, Math.cos(pv.yaw - hd), pv.vLong);
  if (wrong !== G.wrongShown) { G.wrongShown = wrong; ww.classList.toggle('on', wrong); }
  if ((frameN & 3) !== 0 || !run) return;
  const left = run.timeLeft();
  const html = def.type === 'pursuit' && isFinite(left) ? `<div class="e-k">SURVIVE</div><b class="${left < 10 ? 'good' : ''}">${Math.max(0, left).toFixed(1)}</b>` : '';
  if (html !== G.evHtml) { G.evHtml = html; box.innerHTML = html; box.classList.toggle('on', !!html); }
}

// ------------------------------------------------------------------ rival AI
function aiInput(car, dt, pace, other) {
  const veh = car.veh, ai = car.ai, v = Math.max(0, veh.vLong), sp = veh.spec;
  const dir = car.dir || 1, others = Array.isArray(other) ? other : other ? [other] : []; // reverse events drive -s on the far carriageway
  ai.passT = Math.max(0, (ai.passT || 0) - dt);
  const ghost = car.ghost || ai.passT > 0; // deadlocked in a pile-up: squeeze through
  if (!(ai.lane >= -1)) { ai.lane = Math.max(0, Math.min(route.lanes(veh.s) - 1, Math.round((Math.abs(veh.u) - route.medHalf(veh.s)) / 3.5 - 0.5))); ai.u = veh.u; ai.cool = 0; }
  const nl = route.lanes(veh.s);
  const undiv = route.div(veh.s) < 0.3;
  ai.cool -= dt;
  const look = 30 + v * 2.4;
  const laneU = (l) => dir * (l >= 0 ? route.laneU(veh.s + 10 * dir, Math.min(l, nl - 1)) : -route.laneU(veh.s + 10 * dir, -l - 1));
  const info = (l, from = veh.halfL) => {
    const u = laneU(l);
    const r = ghost ? { gap: 1e9, v: 0 } : laneInfoDir(u, from, look, veh.halfW, veh.s, dir);
    // the other racers are obstacles too
    for (const other of others) {
      const d = (other.veh.s - veh.s) * dir;
      if (d > -2 && d < look && Math.abs(other.veh.u - u) < 2.2) { const g = d - other.veh.halfL - veh.halfL; if (g < r.gap) { r.gap = g; r.v = other.veh.vLong; } }
    }
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
  let kAhead = 0; for (let d = 0; d <= 36; d += 6) kAhead = Math.max(kAhead, Math.abs(route.curv(veh.s + d * dir)));
  const Ld = Math.max(6, Math.min(9 + v * 0.42, 0.24 / Math.max(1e-4, kAhead)));
  const tp = route.point(veh.s + Ld * dir, ai.u);
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
    const k = Math.abs(route.curv(veh.s + d * dir)); if (k < 1e-4) continue;
    const vl = Math.sqrt(sp.grip * 9.81 * 0.74 / k);
    vT = Math.min(vT, Math.sqrt(vl * vl + 2 * dec * Math.max(0, d - 8)));
  }
  const now = info(ai.lane);
  // whatever is physically in front of the bonnet right now (we may still be moving across)
  const here = ghost ? { gap: 1e9, v: 0 } : laneInfoDir(veh.u, veh.halfL, look, veh.halfW * 0.8, veh.s, dir);
  if (here.gap < now.gap) { if (here.gap < 9 && ai.lane !== undefined && Math.abs(veh.u - ai.u) > 1) vT = Math.min(vT, 4); else { now.gap = here.gap; now.v = here.v; } }
  if (now.gap < look) { const lv = Math.max(0, now.v); vT = Math.min(vT, Math.sqrt(lv * lv + 2 * dec * 0.75 * Math.max(0, now.gap - 7 - lv * 0.4))); }
  // traffic lights: stop at red / amber, unless he decides to risk it
  let sigHold = -1;
  if (signals && !(car === player && !G.autodrive)) {
    const front = veh.s + dir * veh.halfL, j = signals.next(front, dir);
    if (j) {
      const d = ((dir > 0 ? j.sF : j.sO) - front) * dir;
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
  if (ai.slowLong > 4) { ai.slowLong = 0; const l = Math.max(0, ai.lane); placeVeh(veh, veh.s + 2 * dir, dir * route.laneU(veh.s + 2 * dir, l), dir); ai.u = veh.u; }
  return { throttle: brk > 0.05 ? 0 : thr, brake: brk, steer, handbrake: false, nitro: ai.nitroOk && err > 6 && Math.abs(steer) < 0.3 };
}

function decideRun(car, j, d, v) {
  const tArr = d / Math.max(1, v);
  if (j.main === 'A' && (tArr < j.left + 0.25 || v * v / (2 * Math.max(1, d)) > 6.5)) return true; // clears it on amber, or too late to stop
  if (car === player) return Q.has('runreds');
  let p = 0.08;
  const lead = (car.veh.s - player.veh.s) * (car.dir || 1);
  if (lead < 0) p += 0.17; if (lead < -80) p += 0.15;
  if (j.main === 'R' && j.left < tArr + 1) p += 0.3; // it will (probably) be green by the time he gets there
  p *= car.drv?.risk ?? 1;
  if (car.ghost) p = 0.04;
  return Math.random() < p;
}
function onStopLine(j, who, rc = rival) {
  const red = j.main === 'R' && j.redT > 0.3 && j.toGreen > 0.3; // a little grace at both ends of the red
  if (red && Q.has('redlog')) { const c = who === 'rival' ? rc : player; (G.redLog = G.redLog || []).push([who, Math.round(j.s), +j.redT.toFixed(1), c.ai && c.ai.sigJ === j.i, c.ai && c.ai.sigRun, Math.round(c.veh.kmh), c.ghost || false]); }
  if (who === 'rival') {
    if (!red) return;
    G.rPen += 2; G.rReds++; rc.pen = (rc.pen || 0) + 2; rc.reds = (rc.reds || 0) + 1;
    if (Math.abs(rc.veh.s - player.veh.s) < 450) { hud.pop('info cyan', (rc.name || RIVAL_NAME) + ' RAN A RED!', '+2.0 S PENALTY'); if (Math.abs(rc.veh.s - player.veh.s) < 120) audio.whistle(); }
    people.redRun(j);
    return;
  }
  if (red) {
    G.pen += 2; G.reds++;
    hud.pop('redlight', 'RED LIGHT!', '+2.0 S');
    hud.flashCam(); audio.shutter(); setTimeout(() => audio.whistle(), 260);
    for (const c of traffic.cars) if (c.active && c.cross && Math.abs(c.s - j.s) < 40) { audio.horn(false, 0.9, clamp((c.u - player.veh.u) / 12, -1, 1), Math.random() * 0.2); break; }
    people.redRun(j);
  }
}
function handleHonk(h) {
  const c = h.c;
  const p = traffic.route.point(c.s, c.u, _v1);
  const dx = p.x - camera.position.x, dz = p.z - camera.position.z, dist = Math.hypot(dx, dz);
  if (dist > 260) return;
  const rx = Math.cos(player.veh.yaw), rz = -Math.sin(player.veh.yaw);
  const pan = clamp((dx * rx + dz * rz) / Math.max(5, dist), -1, 1);
  audio.carHorn(h.kind, h.long ? 1 : 0, 1 / (1 + Math.pow(dist / 22, 1.4)), pan, h.reason === 'stuck' || h.reason === 'fare' ? 0 : Math.random() * 0.15);
}
function handlePeople() {
  for (const e of people.events) {
    const p = e.p;
    if (G.state !== 'race') continue; // pedestrians react with body language only (no speech)
    else if (e.kind === 'dive' && e.who === 'player') { G.scared++; hud.pop('info bad', 'WATCH THE PAVEMENT!'); }

  }
  people.events.length = 0;
}

// ------------------------------------------------------------------ per-frame helpers
function syncCar(c, dt) {
  const v = c.veh;
  v.place(c.model.root);
  c.model.steamAmount = v.steamAmount || 0; c.model.wheelCamber = v.wheelCamber;
  c.model.update(dt, v.vLong, v.steer, (c === player ? input.brake > 0.3 : c.lastBrake) || false, v.pose, v.corners || v.wheel, v.w);
  const impact = v.lastDamage && v.lastDamage.serial !== c.damageSerial ? v.lastDamage : null;
  for (const zone of ['front', 'rear', 'left', 'right']) c.model.setDamage?.(zone, v.damage?.[zone] || 0, impact?.zone === zone ? impact : undefined);
  if (impact?.kind === 'wall' && c === player && impact.ebs > 3.3 && G.t - (c.damageSoundT ?? -1) > .18) {
    c.damageSoundT = G.t;
    audio.crash(impact.ebs > 10 ? 'heavy' : 'light', Math.min(1, (impact.ebs / 16) ** 2), { glass: impact.ebs > 7, metal: true });
  }
  c.damageSerial = v.lastDamage?.serial;
}

function racerCollide(dt) {
  if (grid.length) { const all = [player, ...grid]; for (let i = 0; i < all.length; i++) for (let k = i + 1; k < all.length; k++) racerPair(all[i].veh, all[k].veh, i === 0); return; }
  racerPair(player.veh, rival.veh, true);
}
function racerPair(a, b, mine) {
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
  if (sev > 2.2) {
    const sign = ox < oy ? Math.sign(ds) || 1 : Math.sign(du) || 1;
    const nx = sign * (ox < oy ? ra.f.tx : ra.f.rx), nz = sign * (ox < oy ? ra.f.tz : ra.f.rz);
    const px = (a.x + b.x) * .5, pz = (a.z + b.z) * .5;
    for (const [v, other, inward] of [[a, b, -1], [b, a, 1]]) {
      const c = Math.cos(v.yaw), s = Math.sin(v.yaw), dx = px - v.x, dz = pz - v.z;
      const localPoint = { x: clamp(dx * c - dz * s, -v.halfW, v.halfW), y: .55, z: clamp(dx * s + dz * c, -v.halfL, v.halfL) };
      const localNormal = { x: inward * (nx * c - nz * s), y: 0, z: inward * (nx * s + nz * c) };
      const zone = Math.abs(localNormal.x) > Math.abs(localNormal.z) ? (localNormal.x > 0 ? 'left' : 'right') : (localNormal.z > 0 ? 'front' : 'rear');
      v.addDamage?.(zone, sev * .6, { kind: 'crash', sev, car: { mass: other.m }, localPoint, localNormal });
    }
  }
  if (sev > 1.5 && mine && G.t - (G.paintT || 0) > 1.2) { G.paintT = G.t; hud.pop('info cyan', 'TRADING PAINT!'); audio.crash('light', Math.min(1, sev / 8)); G.shake = Math.max(G.shake, 0.35); player.driver.impulse(0.4); }
}

/** pursuit transitions (src/police.js): call-outs, sounds. In a pursuit event BUSTED ends the run (events flow) */
function onPolice(e) {
  // no points, no money: the stars and these call-outs are all the pursuit says
  if (e.phase === 'start') { hud.pop('info bad', 'POLICE!'); audio.copRadio?.(); }
  else if (e.phase === 'heat') audio.copRadio?.();
  else if (e.phase === 'takedown') hud.pop('opa', 'TAKEDOWN!');
  else if (e.phase === 'evaded') { policeHud.shout('evaded', 'EVADED'); audio.copEvaded?.(); }
  else if (e.phase === 'busted') { policeHud.shout('busted', 'BUSTED'); audio.copBusted?.(); G.shake = Math.max(G.shake, 0.4); }
}
function handleEvents(events) {
  for (const e of events) {
    // damage where it hit (front / rear / left / right), scaled by the car's own change of velocity
    const rc = e.racer || rival;
    if (e.zone && e.dv > 0) {
      const hit = e.who === 'rival' ? rc : player;
      if (hit.veh.addDamage?.(e.zone, e.dv, e) > 0) {
        hit.model.setDamage?.(e.zone, hit.veh.damage[e.zone], hit.veh.lastDamage);
        hit.damageSerial = hit.veh.lastDamage?.serial;
      }
    }
    if (e.who === 'rival') {
      if ((e.kind === 'crash' || e.kind === 'bump') && Math.abs(rc.veh.s - player.veh.s) < 150) {
        const pan = clamp((rc.veh.u - player.veh.u) / 10, -1, 1);
        audio.noise({ dur: 0.3, f: 700, type: 'lowpass', gain: 0.25 * Math.min(1, e.sev / 12), pan });
        if (e.kind === 'crash') hud.pop('info cyan', (rc.name || RIVAL_NAME) + ' CRASHED!');
      }
      continue;
    }
    if (e.kind === 'near') {
      // straight time: no points or pops for a near miss, just the whoosh and a little nitro
      player.veh.nitro = Math.min(1, player.veh.nitro + (e.oncoming ? 0.12 : 0.07));
      audio.nearMiss(1, e.side * 0.6);
      if (e.car.type.scooter) audio.moped(e.side * 0.7);
    } else if (e.kind === 'crash' || e.kind === 'bump') {
      const big = e.kind === 'crash';
      G.crashes += big ? 1 : 0;
      G.shake = Math.max(G.shake, big ? 1 : 0.5); G.flash = big ? 0.8 : 0.3;
      player.driver.impulse(big ? 1.1 : 0.55, -e.side * 0.5, 0.5);
      audio.crash(e.heavy ? 'heavy' : 'light', Math.min(1, Math.pow((player.veh.lastDamage?.ebs || e.sev) / 16, 2)), { glass: (player.veh.lastDamage?.ebs || 0) > 7, metal: true });
      controls.rumble(big ? 1 : 0.5, big ? 0.8 : 0.4, big ? 450 : 200);
      if (big) {
        audio.opa(1.1);
        hud.pop('opa', 'OPA!', '', (Math.random() - 0.5) * 10);
      } else hud.pop('info bad', e.car.type.bus ? 'BUS BUMP!' : 'BUMP!');
      if (e.car.type.scooter) audio.scream();
      else if (Math.random() < 0.6) audio.horn(e.car.type.bus, 0.9, -e.side * 0.4, 0.25);
    } else if (e.kind === 'scrape') { audio.scrape(Math.min(1, e.sev / 4)); G.shake = Math.max(G.shake, 0.15); }
    else if (e.kind === 'cone') {
      G.cones++; audio.tone({ f: 380 + Math.random() * 200, slide: 900, dur: 0.18, gain: 0.08, type: 'triangle' }); audio.noise({ dur: 0.08, f: 1200, type: 'bandpass', gain: 0.12 });
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
    const siren = !!(c.cop && c.cop.siren && !c.crash);
    if (!c.active || (c.mode === 'parked' && !siren) || Math.abs(c.s - pv.s) > (siren ? 420 : 150) || (c.crash && c.crash.y > 1)) continue;
    const p = route.point(c.s, c.u, _ap), f = route.frame(c.s, _fr);
    const vs = c.crash ? c.crash.vs : c.cross ? c.xvs : c.dir * c.v, vu = c.crash ? c.crash.vu : c.cross ? c.xvu : (c.uv || 0);
    const L = listenerRel(p.x, p.y, p.z, f.tx * vs + f.rx * vu, f.tz * vs + f.rz * vu);
    if (L.d > (siren ? 400 : 130)) continue;
    tl.push({ id: c.id, kind: c.kind, electric: !!c.type.electric, cop: !!c.cop, siren, d: L.d, pan: L.pan, vr: L.vr, v: Math.hypot(vs, vu), acc: c.acc || 0 });
  }
  tl.sort((a, b) => a.d - b.d);
  const rw = rv.velocityWorld(_av), RL = listenerRel(rv.x, rv.y, rv.z, rw.x, rw.z);
  const racing = G.state === 'race' || G.state === 'countdown';
  const counting = G.state === 'countdown';
  audio.update({
    dt, damage: pv.damage, rpm: pv.rpm, redline: pv.spec.redline, load: counting ? input.throttle * 0.9 - 0.1 : racing ? pv.load : Math.min(pv.load, 0.3), throttle: input.throttle,
    gear: pv.gear, gearRatio: pv.ratio(), shift: pv.shiftEvent, limiter: pv.limiter || (counting && pv.rpm > pv.spec.redline * 0.97), boost: pv.boost,
    speed: Math.abs(pv.vLong), skid: pv.skid, wheelspin: pv.wheelspin, lockup: pv.lockup, bump: pv.bumpHit, rough: pv.rough, offroad: pv.offroad, nitro: pv.nitroOn, wb: pv.wb,
    open: player.spec.convertible || G.cam !== 'cockpit', muted: G.state === 'garage' || G.state === 'paused' || (!multiplayer.active && !multiplayer.panel.hidden),
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
const look = { yaw: 0, pitch: 0, zoom: 1, drag: null, idleT: 9, back: 0 };
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
  look.back = input.lookBack ? Math.PI : 0; // a held look-back (input.js) on top of the free look
  // a gamepad's right stick (input.cameraLook, -1..1) turns the free look like a mouse drag
  const cl = controls.cameraLook;
  if (cl && (Math.abs(cl.x) > 0.12 || Math.abs(cl.y) > 0.12)) {
    look.yaw -= cl.x * 2.6 * dt; look.pitch = clamp(look.pitch + cl.y * 1.6 * dt, -0.35, 1.0);
    while (look.yaw > Math.PI) look.yaw -= 2 * Math.PI; while (look.yaw < -Math.PI) look.yaw += 2 * Math.PI;
    look.idleT = 0; return;
  }
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
  if (window.__replay?.updateCamera(dt)) return;
  const watching = multiplayer.spectating();
  const targetCar = watching && remoteCars.get(watching.id);
  if (targetCar?.model.root.visible) {
    const v = targetCar.veh, back = 7, target = _v1.set(v.x + Math.sin(v.yaw) * back, v.y + 2.8, v.z + Math.cos(v.yaw) * back);
    const changed = G.spectateId !== watching.id; G.spectateId = watching.id;
    if (snap || changed) camState.pos.copy(target); else camState.pos.lerp(target, 1 - Math.exp(-8 * dt));
    camera.position.copy(camState.pos); camera.position.y = Math.max(camera.position.y, route.surfaceY(v.s, v.u) + 0.6);
    camera.lookAt(v.x, v.y + 0.9, v.z); camera.fov = 65; camera.updateProjectionMatrix();
    // Keep your driver's head and cockpit mirror out of the spectator view.
    if (G.cam !== 'spectate') { G.cam = 'spectate'; applyCamMode(); }
    return;
  }
  G.spectateId = null;
  if (G.cam === 'spectate') { G.cam = G.userCam; applyCamMode(); }
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
    const lookYaw = -player.veh.steer * 0.12 - veh.w * 0.04 + clamp(look.yaw, -2.2, 2.2) + look.back;
    _e.set(-0.045 - clamp(veh.ax, -12, 12) * 0.0012 - look.pitch * 0.8 + noise1(t * 31 + 5) * 0.004 * rough, lookYaw, noise1(t * 19 + 9) * 0.004 * rough + G.shake * Math.sin(t * 40) * 0.02, 'YXZ');
    camera.quaternion.copy(_q).multiply(_q.clone().setFromEuler(_e));
    const fov = 66 + sk * 10 + (veh.nitroOn ? 5 : 0);
    camState.fov = snap ? fov : damp(camState.fov, fov, 3, dt);
  } else if (G.cam === 'chase') {
    // behind the car, swung round by the free look: yaw about the car, pitch up / down, wheel zoom
    const back = 5.6 + sk * 1.2, up = 1.75 + sk * 0.15;
    const dist = Math.hypot(back, up) * look.zoom, el = clamp(Math.atan2(up, back) + look.pitch, -0.08, 1.35);
    const hd = veh.yaw + look.yaw + look.back, hx = Math.sin(hd), hz = Math.cos(hd); // forward is (-sin yaw, -cos yaw): behind is +
    const target = _v1.set(veh.x + hx * Math.cos(el) * dist, veh.y + Math.sin(el) * dist, veh.z + hz * Math.cos(el) * dist);
    const free = look.drag || look.back || Math.abs(look.yaw) > 0.05 || Math.abs(look.pitch) > 0.05;
    // while dragging the camera follows the mouse closely; the damped lag is for the car's own motion
    const kXZ = free ? 20 : 9, kY = free ? 20 : 6;
    if (snap) camState.pos.copy(target); else { camState.pos.x = damp(camState.pos.x, target.x, kXZ, dt); camState.pos.z = damp(camState.pos.z, target.z, kXZ, dt); camState.pos.y = damp(camState.pos.y, target.y, kY, dt); }
    camera.position.copy(camState.pos);
    camera.position.x += noise1(t * 21) * 0.03 * rough; camera.position.y += noise1(t * 27 + 3) * 0.03 * rough;
    // look ahead of the car when behind it; at the car itself once swung round to the side / front
    const ahead = 5 * Math.max(0, Math.cos(look.yaw + look.back)) * clamp(1 - look.pitch, 0, 1);
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
  // The hidden-online timer owns simulation until visibility returns. Ignore a queued older frame.
  if (multiplayer.active && (document.hidden || now < last)) return;
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
  // A queued first frame can predate boot's clock reset. Integrators require a positive timestep.
  if (!(dt > 0) || mapSwitch) return;
  G.t += dt; frameN++;
  const bootFrameLog = text => { if (frameN === 1) tlog(text); };
  bootFrameLog('first-frame');
  readInput(dt);
  if (multiplayer.active) multiplayer.update(dt, networkState(player.veh));
  if (!multiplayer.active && grid.length) rival = focusRival(); // the car the HUD gap, audio and slipstream follow
  const pv = player.veh, rv = rival.veh;
  ACTORS[0].veh = pv; ACTORS[1].veh = rv;
  const simulate = !window.__replay?.active && G.state !== 'garage' && G.state !== 'loading' && G.state !== 'paused' && (multiplayer.active || multiplayer.panel.hidden);
  if (simulate) signals.update(dt, pv.s, camera.position);
  if (simulate) {
    // ---- state machine
    if (G.state === 'countdown') {
      // the countdown runs on wall-clock time so first-frame GPU uploads can't stretch it
      const nowMs = performance.now(); G.countT += Math.min(0.5, Math.max(dt, (nowMs - (G.countWall || nowMs)) / 1000)); G.countWall = nowMs;
      const n = Math.min(3, Math.floor(G.countT / 0.4)); // clamped: a long frame can jump past 1.2 s, and GO must still fire
      if (n !== G.countShown) {
        G.countShown = n;
        if (n < 3) { hud.count(String(3 - n)); audio.beep(false); }
        else { hud.count('GO!', true); audio.beep(true); G.state = 'race'; G.goAt = G.goAt || Math.round(performance.now()); G.raceT = 0; document.body.classList.remove('counting'); document.body.classList.add('racing'); if (!multiplayer.active) G.run?.start({ field: grid.length + 1, grid: grid.map((c) => ({ name: c.name, car: c.spec.id })) }); }
      }
      // revving on the grid
      pv.rpm = damp(pv.rpm, pv.spec.idle + input.throttle * pv.spec.redline * 0.7, 6, dt);
      for (const c of grid.length ? grid : [rival]) { const v = c.veh; v.rpm = damp(v.rpm, v.spec.idle + (G.countT > 1.0 ? v.spec.redline * (0.5 + 0.1 * Math.sin(G.t * 3 + v.halfL * 7)) : 600 * (Math.sin(G.t * 5 + v.halfW * 9) * 0.5 + 0.5)), 5, dt); }
    }
    if (['race', 'finished', 'results', 'onlineFinished', 'onlineResults'].includes(G.state)) {
      if (G.state === 'race' && !multiplayer.active) G.raceT += dt;
      // ---- player
      let pin = input;
      if (G.autodrive && !multiplayer.active && G.state === 'race') { player.ai = player.ai || { lane: 1, u: pv.u, cool: 0 }; pin = aiInput(player, dt, 0.95, grid); }
      if (G.state !== 'race') {
        if (multiplayer.active) {
          // Coasting remains simulated after finishing, independently of the spectator camera.
          const r = multiplayer.lobby.event, dir = r?.dir || 1;
          const ahead = route.point(route.closed ? pv.s + dir * Math.max(8, Math.abs(pv.vLong)) : clamp(pv.s + dir * Math.max(8, Math.abs(pv.vLong)), 0, route.length), pv.u);
          const dx = ahead.x - pv.x, dz = ahead.z - pv.z, lat = dx * Math.cos(pv.yaw) - dz * Math.sin(pv.yaw);
          const lon = Math.max(1, -dx * Math.sin(pv.yaw) - dz * Math.cos(pv.yaw));
          pin = { throttle: 0, brake: Math.abs(pv.vLong) > 1 ? 0.15 : 0, steer: clamp(Math.atan(pv.wb * 2 * lat / (lon * lon + lat * lat)) / pv.lockAt(Math.abs(pv.vLong)), -1, 1), handbrake: Math.abs(pv.vLong) <= 1, nitro: false };
        } else { player.ai = player.ai || { lane: 1, u: pv.u, cool: 0 }; pin = aiInput(player, dt, 0.25, grid); pin.nitro = false; if (prog(pv.s) > G.ev.r.len + 120) { pin.throttle = 0; pin.brake = pv.vLong > 1 ? 0.6 : 0; pin.handbrake = pv.vLong <= 1; } }
      }
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
      updateGrid(dt); // the AI field: rubber band, personalities, red lights (offline)
      }
      // ---- stop lines: running a red costs time
      const D = G.dir || 1, pf = pv.s + D * pv.halfL, rf = rv.s + rv.halfL;
      if (!multiplayer.active && G.state === 'race' && G.pFront !== null && pv.vLong > 0) { const j = crossedDir(G.pFront, pf, D); if (j) onStopLine(j, 'player'); }
      G.pFront = D > 0 ? Math.max(G.pFront ?? pf, pf) : Math.min(G.pFront ?? pf, pf); G.rFront = Math.max(G.rFront ?? rf, rf);
      // ---- traffic + collisions
      const actors = multiplayer.active ? [{ veh: pv, kind: 'player' }] : [{ veh: pv, kind: 'player' }, ...grid.map((c) => c.actor)];
      traffic.update(dt, pv.s, actors);
      events.length = 0;
      if ((!multiplayer.active || multiplayer.lobby.traffic) && !(G.autodrive && player.ai && player.ai.passT > 0)) traffic.collide(actors[0], events, G.t);
      // out of sight a rival is not held up by traffic (they know these roads); in sight they race for real (updateGrid)
      if (!multiplayer.active) for (const c of grid) if (!c.ghost) { const n0 = events.length; traffic.collide(c.actor, events, G.t); for (let k = n0; k < events.length; k++) events[k].racer = c; }
      if (!multiplayer.active) racerCollide(dt);
      if (police && !multiplayer.active) for (const e of police.update(dt, { events, reds: G.reds, racing: G.state === 'race', dir: G.dir || 1, eventId: G.run?.id })) onPolice(e);
      if (Q.has('nantrap') && !G.nanC && !isFinite(pv.x + pv.vLong + rv.x + rv.vLong)) { G.nanC = 1; console.warn('NaN after collisions', pv.s, rv.s); }
      if (G.state === 'race') handleEvents(events);
      for (const h of traffic.honks) handleHonk(h);
      traffic.honks.length = 0;
      handleTrafficSounds();
      if (pv.bumpHit > 0.1) G.shake = Math.max(G.shake, pv.bumpHit * 0.22);
      if (pv.wallHit > 2.5 && G.state === 'race') { audio.scrape(Math.min(1, pv.wallHit / 10)); G.shake = Math.max(G.shake, Math.min(0.6, pv.wallHit / 12)); if (pv.wallHit > 7) player.driver.impulse(0.4); }
      if (pv.wallHit > 3) { fx.sparks(pv, pv.wallHit / 12); controls.rumble(Math.min(1, pv.wallHit / 10), 0.6, 220); }
      if (!multiplayer.active) for (const c of grid) if (c.veh.wallHit > 3) fx.sparks(c.veh, c.veh.wallHit / 12);
      // kerb strikes: a thump (scrape when the tyre rubs along the face), a jolt through the camera
      if (pv.curbHit > 0.12 && G.t - (G.curbT || 0) > 0.08) { G.curbT = G.t; audio.curb(Math.min(1, pv.curbHit * (pv.curbScrape ? 0.7 : 1.2))); if (pv.curbScrape) audio.scrape(0.25); G.shake = Math.max(G.shake, pv.curbHit * 0.3); if (pv.curbHit > 0.5) player.driver.impulse(0.25); controls.rumble(pv.curbScrape ? 0.15 : 0.5 * pv.curbHit, pv.curbScrape ? 0.5 : 0.8 * pv.curbHit, pv.curbScrape ? 140 : 110); }
      pv.wallHit = 0; rv.wallHit = 0; for (const c of grid) c.veh.wallHit = 0;
      // ---- slipstream
      const dd = (rv.s - pv.s) * (G.dir || 1), du = Math.abs(rv.u - pv.u);
      const drafting = (!multiplayer.active || (remoteCars.size > 0 && rival.model.root.visible)) && dd > 4 && dd < 32 && du < 1.6 && pv.vLong > 22;
      G.draft = damp(G.draft || 0, drafting ? 1 - dd / 40 : 0, 3, dt);
      if (drafting) pv.nitro = Math.min(1, pv.nitro + dt * 0.03);
      // ---- drift scoring
      if (pv.drift > 0.12 && pv.vLong > 14 && G.state === 'race') { G.driftAcc += dt * pv.vLong * pv.drift * 14; G.driftT = 0.7; }
      else if (G.driftT > 0) { G.driftT -= dt; if (G.driftT <= 0 && G.driftAcc > 60) { pv.nitro = Math.min(1, pv.nitro + G.driftAcc / 2500); G.driftAcc = 0; /* a drift tops up the bottle; no points */ } else if (G.driftT <= 0) G.driftAcc = 0; }
      G.topSpeed = Math.max(G.topSpeed, pv.kmh);
      // ---- timing, positions, finish
      if (G.state === 'race' && !multiplayer.active) {
        window.__replay?.tick(dt);
        raceTiming(dt);
      } else if (G.state === 'finished') {
        G.postT += dt;
        for (const c of grid) if (c.finish === null && prog(c.veh.s) >= G.ev.r.len) c.finish = G.raceT + G.postT + c.pen - (prog(c.veh.s) - G.ev.r.len) / Math.max(1, c.veh.vLong);
        G.finishedT += dt; G.raceT += 0; // clock stopped
        if (G.finishedT > 0.8 && G.cam !== 'orbit') { G.cam = 'orbit'; applyCamMode(); G.orbitA = 0.6; }
        if (G.finishedT > 2.6) showResults();
      } else if (G.state === 'results') {
        G.postT += dt;
        let changed = false;
        for (const c of grid) if (c.finish === null && prog(c.veh.s) >= G.ev.r.len) { c.finish = G.raceT + G.postT + c.pen; changed = true; }
        if (changed && menu.screen === 'results') showResults();
      }
    }
  }
  // ---- people (they live on during the countdown too)
  if (simulate) { people.update(dt, peopleS(pv.s), multiplayer.active ? [] : ACTORS, camera.position); /* people track two actors: you and the nearest rival (focusRival) */ if (!multiplayer.active) { police?.pedEvents(people.events); handlePeople(); } else people.events.length = 0; }
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
  syncCar(player, simulate ? dt : 0); if (multiplayer.active || !grid.length) syncCar(rival, simulate ? dt : 0); else for (const c of grid) syncCar(c, simulate ? dt : 0);
  fx.update(simulate ? dt : 0, multiplayer.active ? [pv] : [pv, ...grid.map((c) => c.veh)], camera, innerHeight * pixelRatio);
  traffic.sync(pv.s);
  if (police) { police.sync(G.t); policeHud.update(dt); }
  const acc = { x: pv.ay, y: 0, z: -pv.ax };
  player.cockpit.update(dt, { steerInput: pv.steer / Math.max(0.05, pv.lockAt(Math.abs(pv.vLong))) * (0.55 + 0.45 * Math.min(1, pv.lockAt(Math.abs(pv.vLong)) / pv.spec.steer * 2.5)), rpm: pv.rpm, redline: pv.spec.redline, gear: pv.gear, gearLabel: pv.reverse ? 'R' : String(pv.gear), kmh: pv.kmh, nitro: pv.nitro, nitroOn: pv.nitroOn });
  player.driver.update(dt, G.t, pv.vLong, acc, player.cockpit.wheelInfo, pv.steer, pv.pose.heaveV);
  for (const c of !multiplayer.active && grid.length ? grid : [rival]) c.driver.update(dt, G.t, c.veh.vLong, { x: c.veh.ay, y: 0, z: -c.veh.ax }, null, c.veh.steer, 0);
  window.__replay?.visual(dt);
  updateCamera(dt);
  // sun + shadows follow the action
  const fwd = _v2.set(0, 0, -1).applyQuaternion(player.model.root.quaternion);
  ENV.updateSun(sun, _v1.copy(player.model.root.position).addScaledVector(fwd, 35));
  // crossings painted near us
  if (assets.asphalt && assets.crossings) {
    const u = assets.asphalt.userData.uniforms; let k = 0;
    for (const c of assets.crossings) { if (c > pv.s - (G.dir < 0 ? 900 : 120) && k < 16) u.uCross.value[k++] = c; }
    for (; k < 16; k++) u.uCross.value[k] = -9999;
    k = 0; for (const c of assets.stops || []) { if (c > pv.s - 120 && k < 8) u.uStop.value[k++] = c; }
    for (; k < 8; k++) u.uStop.value[k] = -9999;
  }
  ENV.U.time.value = G.t;
  bootFrameLog('frame-visuals');
  // HUD
  let gap = NaN, pos = 1;
  if (!multiplayer.active && G.ev) ({ gap, pos } = raceGap());
  updateEventHud(dt);
  G.shiftFlash = Math.max(0, (G.shiftFlash || 0) - dt);
  if (pv.shiftEvent) { G.shiftFlash = 0.25; }
  G.lampTC = pv.tcOn ? 0.35 : Math.max(0, (G.lampTC || 0) - dt); G.lampABS = pv.absOn ? 0.35 : Math.max(0, (G.lampABS || 0) - dt); G.lampESC = pv.escOn ? 0.35 : Math.max(0, (G.lampESC || 0) - dt);
  const st = { damageLabel: pv.engineStalled || pv.drivetrainBroken ? 'ENGINE STOP' : pv.coolantTemp > 115 ? 'OVERHEATING' : pv.damageSignificant ? 'DAMAGE' : '', tc: G.lampTC > 0, abs: G.lampABS > 0, esc: G.lampESC > 0, pos, time: G.pFinish ?? (G.raceT + G.pen), gap, pen: G.pen, junctions: signals.J, s: pv.s, rs: rv.s, rpm: pv.rpm, redline: pv.spec.redline, kmh: speedIn(pv.kmh), unit: speedUnit(),
    gearLabel: pv.reverse ? 'R' : (G.state === 'countdown' ? 'N' : String(pv.gear)), nitro: pv.nitro, nitroOn: pv.nitroOn, shiftFlash: G.shiftFlash, draft: G.draft || 0,
    x: pv.x, z: pv.z, yaw: pv.yaw, rx: rv.x, rz: rv.z, traffic: traffic.cars };
  if (multiplayer.active) {
    pos = multiplayer.ranking(pv.s).findIndex(p => p.id === multiplayer.id) + 1; st.pos = pos; st.time = G.pFinish ?? G.raceT; st.gap = remoteCars.size ? (rv.s - pv.s) * (multiplayer.lobby.event?.dir || 1) / Math.max(5, Math.abs(pv.vLong)) : NaN; st.pen = 0;
    const other = multiplayer.lobby.players.find(p => p.id !== multiplayer.id);
    if (G.pFinish !== null && other?.finish != null) st.gap = G.pFinish - other.finish;
    st.remotes = [...remoteCars.values()].filter(c => c.model.root.visible).map(c => ({ x: c.veh.x, z: c.veh.z }));
    document.querySelector('#posBox .of').textContent = '/' + (multiplayer.lobby.results || multiplayer.lobby.players).length;
  }
  if (G.state === 'race' && G.raceT > 5) document.body.classList.add('started');
  document.body.classList.toggle('circuit-race', !!G.run?.r.closed && !multiplayer.active);
  hud.update(st);
  updateLapHud(G.run, !multiplayer.active && !MENU_STATES.includes(G.state));
  if (G.cam === 'cockpit' && (frameN & 3) === 0) { const c = player.cockpit; hud.drawMinimap(c.navCanvas.getContext('2d'), c.navCanvas.width, c.navCanvas.height, st, 3.4, true); c.navTex.needsUpdate = true; }
  bootFrameLog('frame-hud');
  // audio
  updateAudio(dt);
  pv.shiftEvent = 0; rv.shiftEvent = 0; for (const c of grid) c.veh.shiftEvent = 0;
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
  if (p.face === 0) { p.cc.position.copy(player.model.root.position); p.cc.position.y += 1.8; p.cc.updateMatrixWorld(true); }
  const prevA = renderer.shadowMap.autoUpdate; renderer.shadowMap.autoUpdate = false;
  renderer.setRenderTarget(p.rt, p.face); renderer.render(scene, p.cc.children[p.face]); renderer.setRenderTarget(null);
  renderer.shadowMap.autoUpdate = prevA;
  p.face = (p.face + 1) % 6;
  if (p.face === 0) p.pmrem.fromCubemap(p.rt.texture, p.envRT);
}

function render() {
  renderer.info.autoReset = false; renderer.info.reset();
  updateWeather(G.lastDt || 1 / 60);
  if (!lowGraphics && (quality === 'med' ? frameN % 4 === 0 : (frameN & 1))) updateProbe();
  if ((frameN % 6) === 0) updateLod();
  sky.position.copy(camera.position);
  // planar reflections and the rear-view mirror alternate frames
  if (water && !lowGraphics && (frameN % (quality === 'med' ? 6 : 3)) === 0) water.renderReflection(renderer, scene, camera);
  else if (G.cam === 'cockpit' && (player.cockpit.mirrorMat.map !== mirrorRT.texture || (++mirrorFrame % (lowGraphics ? 9 : 3)) === 1)) {
    const body = player.model.body, eye = player.cockpit.eye;
    _v1.set(0, eye.y + 0.12, eye.z - 0.1); body.localToWorld(_v1);
    mirrorCam.position.copy(_v1);
    body.getWorldQuaternion(_q); mirrorCam.quaternion.copy(_q).multiply(_q.clone().setFromAxisAngle(_v2.set(0, 1, 0), Math.PI));
    mirrorCam.rotateX(-0.04);
    // Exclude our cabin from the shared rear-facing view: seat backs and the driver
    // otherwise occlude it. Low quality still needs a populated reflection target.
    const wasVisible = player.model.root.visible;
    player.model.root.visible = false;
    const prevA = renderer.shadowMap.autoUpdate; renderer.shadowMap.autoUpdate = false;
    renderer.setRenderTarget(mirrorRT); renderer.render(scene, mirrorCam); renderer.setRenderTarget(null);
    renderer.shadowMap.autoUpdate = prevA;
    player.model.root.visible = wasVisible;
    player.cockpit.setMirrorReady?.();
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
const networkState = v => ({ ...Object.fromEntries(['x', 'y', 'z', 'yaw', 's', 'u', 'vLong', 'vLat', 'steer', 'rpm', 'gear', 'nitro', 'reverse'].map(k => [k, v[k]])), damage: { ...v.damage } });
function clearDriveInput() { controls.clear(); }
function onlineWait() {
  if (!player || !multiplayer.loaded) return;
  clearDriveInput(); hud.hideMenu(); hud.count(''); G.state = 'lobby'; G.cam = G.userCam; applyCamMode();
  G.trafficMul = multiplayer.lobby?.traffic ? 1 : 0; traffic.disabled = !multiplayer.lobby?.traffic; resetRace(); rival.model.root.visible = false;
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
    if (c.spec.id !== p.car) { const spec = CARS.find(s => s.id === p.car) || CARS[0]; disposeCar(c); const built = makeCar(spec, false); c.model = built.model; c.driver = built.driver; c.spec = spec; c.veh.setSpec(spec); c.veh.reset(startS, route.laneU(startS, 0)); }
    c.networkName = p.name; c.model.root.visible = ['countdown', 'race'].includes(multiplayer.lobby.status);
  }
  const first = members[0];
  if (first && remoteCars.get(first.id) !== rival) { const old = rival; rival = remoteCars.get(first.id); if (![...remoteCars.values()].includes(old)) disposeCar(old); }
  $('rivalName').textContent = first?.name || 'WAITING';
}
const multiplayer = new Multiplayer(CARS, {
  clearInput: clearDriveInput, carIndex: () => G.carIdx,
  async mapChanged(id) { await window.__flow.switchMap(id); if (multiplayer.active) onlineWait(); else window.__flow.quit(); },
  panelClosed() { G.countWall = performance.now(); },
  join(car) { graphicsControl.disabled = true; graphicsControl.title = 'Choose graphics before joining a lobby'; if (multiplayer.loaded) { setCar(Math.max(0, CARS.findIndex(c => c.id === car))); onlineWait(); } },
  carChanged(car) {
    for (const c of remoteCars.values()) if (c !== rival) disposeCar(c); remoteCars.clear();
    if (multiplayer.loaded) { setCar(Math.max(0, CARS.findIndex(c => c.id === car))); onlineWait(); }
  },
  wait: onlineWait,
  leave() {
    graphicsControl.disabled = false; graphicsControl.title = '';
    for (const c of remoteCars.values()) if (c !== rival) disposeCar(c); remoteCars.clear();
    if (!multiplayer.loaded) return;
    traffic.disabled = Q.has('notraffic'); setCar(G.carIdx); resetRace(); G.cam = G.userCam; applyCamMode(); startCountdown();
    document.querySelector('#posBox .of').textContent = '/2';
  },
  members: onlineMembers,
  start(lobby, id, resumeState = null) {
    if (!multiplayer.loaded) return;
    window.__flow?.prepareEvent(lobby.eventId || 'quick');
    onlineWait(); onlineMembers(lobby.players.filter(p => p.id !== id));
    const grid = (v, i) => { const slot = window.__flow?.gridSlot(i); const s = slot?.s ?? startS - Math.floor(i / 2) * 8; v.reset(s, slot?.u ?? route.laneU(s, Math.min(i % 2, route.lanes(s) - 1)), 0); if (slot) v.yaw = slot.yaw; };
    grid(player.veh, lobby.players.findIndex(p => p.id === id));
    for (let i = 0; i < lobby.players.length; i++) { const c = remoteCars.get(lobby.players[i].id); if (c) { grid(c.veh, i); syncCar(c, 0); } }
    if (resumeState) { const v = new Vehicle(player.veh.spec, route); v.ground = ground; v.reset(resumeState.s, resumeState.u, resumeState.vLong); Object.assign(v, resumeState); v.damageFx(); v.syncWheels(); v.lastV = v.vLong; player.veh = v; }
    G.state = 'onlineCountdown'; G.countShown = -1; G.cam = G.userCam; applyCamMode(); audio.restart(); updateCamera(0, true);
    document.body.classList.add('counting');
    multiplayer.resumeState = null;
    if (lobby.status === 'results') multiplayer.hooks.results();
  },
  remote(peers, dt) {
    for (const [id, c] of remoteCars) {
      const peer = peers.get(id); if (!peer) continue;
      const p = peer.state, v = c.veh;
      const k = Math.hypot(v.x - p.x, v.z - p.z) > 30 ? 1 : 1 - Math.exp(-18 * dt);
      for (const key of ['x', 'y', 'z', 's', 'u', 'vLong', 'vLat', 'steer', 'rpm']) v[key] += (p[key] - v[key]) * k;
      v.yaw += Math.atan2(Math.sin(p.yaw - v.yaw), Math.cos(p.yaw - v.yaw)) * k; v.gear = p.gear;
      c.lastBrake = false; c.model.root.visible = multiplayer.lobby.players.find(p => p.id === id)?.connected !== false || performance.now() - peer.at < 3000;
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
  results() {
    G.pFinish = multiplayer.me?.finish ?? null;
    if (G.state !== 'onlineResults') { const won = G.pFinish !== null && multiplayer.ranking()[0]?.id === multiplayer.id; if (won) audio.win(); else audio.lose(); }
    G.state = 'onlineResults'; hud.count('');
    document.body.classList.remove('racing', 'counting');
  },
});
window.__multiplayer = multiplayer;
// Browsers stop rAF in hidden tabs. Keep online cars coasting and broadcasting without drawing.
const onlineBackgroundTimer = setInterval(() => {
  if (!document.hidden || !multiplayer.active || !multiplayer.worldReady || !multiplayer.connected || multiplayer.lobby.status === 'waiting') return;
  const now = performance.now(), elapsed = Math.min(2, Math.max(0, (now - last) / 1000));
  if (!(elapsed > 0)) return;
  last = now; clearDriveInput();
  const count = Math.max(1, Math.ceil(elapsed / (1 / 60)));
  for (let i = 0; i < count; i++) step(elapsed / count, false);
}, 250);
document.addEventListener('visibilitychange', () => {
  if (!multiplayer.loaded || !multiplayer.active) return;
  clearDriveInput(); last = performance.now(); multiplayer.advanceClock();
  if (!document.hidden) multiplayer.hooks.remote(multiplayer.peers, 0.1);
});
if (Q.has('debug')) { window.__vehicle = () => player?.veh; window.__onlineCars = () => [...remoteCars].map(([id, c]) => ({ id, car: c.spec.id, visible: c.model.root.visible, s: c.veh.s })); }

boot().catch(fail);
