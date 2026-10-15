import { notifications } from './ui/notifications.js';
import { objectiveNotice } from './ui/objective-notice.js';
import { cameraRelativeSource, cameraDirectionPan, syncAudioListener } from './audio-listener.js';
// PARALIAKI: race a rival down the real Athens Riviera coast road, Vouliagmeni -> the lake -> Limanakia -> Varkiza -> Lomvarda.
// TODO(UI): restyle .tow-prompt/.tow-actions with the shared prompt components; keep this offer non-modal.
// World built from OpenStreetMap data (see tools/). Menus boot without a world; direct race URLs load on demand.
import * as THREE from 'three';
import { loadMap, LANE_W } from './map.js';
import { getMap } from './map-catalog.js';
import { menuMapContext, quickMapEvent, initialMapId } from './menu-map.js';
import { waitForBootSession } from './boot-session.js';
import * as ENV from './env.js';
import { configureWorldLife, tickWorldLife, receiveWorldLife } from './world-life-runtime.js';
import { ROAD } from './road.js';
import { CARS, CarModel, Driver, setCarEnv, setPaint, catalogueTrafficTypes } from './cars.js';
import { normalizeDriverAppearance } from './driver-appearance-data.js';
import { ENGINE_HOT_C } from './driving-feedback-model.js';
import { inGarage } from './car-catalog.js';
import { shiftTransmission } from './transmission.js';
import { savedPaint } from './vehicle-paint.js';
import { bindDriverToCar } from './driver-seating.js';
import { Vehicle } from './physics.js';
import { RivalAI } from './rival-ai.js';
import { input as controls } from './input.js';
import { routeVel, setRouteVel, pushVeh, extents } from './traffic.js';
import { Police, pursuit } from './police.js';
import { PoliceHud } from './police-hud.js';
import { Cockpit } from './cockpit.js';
import { Hud, RacerMarkers, fmtTime } from './hud.js';
import { Audio } from './audio.js';
import { VoiceReactions } from './voice.js';
import { PoliceVoice, impactVoiceCue } from './police-voice.js';
import { HumanVoiceEvents } from './human-voice.js';
import { createPost } from './post.js';
import { loadTextures, uploadTextures } from './tex.js';
import { clamp, lerp, damp, smoothstep, frameYield, RNG } from './util.js';
import { resolvePlayerContacts, containOnlineVehicle } from './multiplayer-contact.js';
import { SharedWorld } from './mp-shared-world.js';
import { onlineWorldVisibility } from './mp-world-policy.js';
import { setOnlineWeather } from './weather.js';
import { Multiplayer } from './multiplayer.js';
import { applyRemotePose } from './remote-timeline.js';
import { personalBestSetup, getPersonalBests, recordPersonalBest, exactBestKey } from './personal-bests.js';
import { captureResultFrame, shareResultCard } from './result-share.js';
import { recoveryPosition, spectatorState, applySpectatorState, restoreVehicleState } from './race-lifecycle.js';
import { roadRecoveryPose } from './road-recovery.js';
import { DrivingFeedback } from './driving-feedback.js';
import { driverName } from './driver-name.js';
import * as EV from './events.js';
import { DrivingModeRun, drivingModeDefinition, isDrivingMode, drivingModeHud, drivingModeResults, drivingModeTarget } from './driving-modes.js';
import { DrivingModeView } from './driving-mode-view.js';
import { firstQualityPreference } from './ui/graphics-onboarding.js';
import { Menu } from './menu.js';
import { updateLapHud } from './lap-hud.js';
import { settings, setSetting, onSettings, applySteeringAssist as applyVehicleSteeringAssist, fmtSpeed, fmtDist, speedIn, speedUnit } from './settings.js';
import { trackVersion } from './network-track.js';
import { initWeather, updateWeather, updateRoadWeather, disposeWeather, applyWeatherQuality } from './weather.js';
import { wetPlanningPace, WEATHER } from './wet-grip.js';
import { buildMapWorld } from './map-world.js';
import { SessionTransitions } from './session-transitions.js';
import { speedLimitAt } from './speed-limit.js';
import { updateSceneryLod, setDrawDistance, drawDistance } from './scenery.js';
import { PRESETS, PRESET_IDS, PRESET_LABELS, detectQuality, resolveGraphics, applyQualityTier, applyRenderResolution, applySceneryQuality, releaseSceneryVariants, trimShadowCasters } from './graphics.js';
import { DistanceDetail } from './batch.js';
import { PARKED_RANGE, fleetModel } from './traffic-fleet.js';
import { initGhostLap } from './ghost-lap-mode.js';
import { loading } from './ui/loading.js';
import { ui, icon } from './ui/components.js';
import { drivingHints } from './ui/driving-hints.js';
import { updateEngineHud } from './engine-hud.js';
import { gearboxMessage, bindingLabel } from './input-labels.js';
import { aidSpec, applyVehicleAids, toggleTractionControl } from './driving-aids.js';

import { towCondition, recoveryHeld, TOW_PROMPT_SECONDS, TOW_PROMPT_COOLDOWN } from './recovery-policy.js';
const recoveryStyle = document.createElement('link'); recoveryStyle.rel = 'stylesheet'; recoveryStyle.href = new URL('./recovery-prompt.css', import.meta.url).href; document.head.append(recoveryStyle);
const Q = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);
// Laws: a police unit that sees you run a red may warn or chase you. Nothing is ever fined.
const RED_GRACE = 0.3; // s at both ends of the red, as the signals' own amber/all-red margins
function lawsEnabled() { return police?.enabled === true && G.ev?.def.rules?.laws !== false; }
const RIVAL_NAME = 'STAVROS';
const RIVAL_BODY = { mini: 'z4', z4: 'mini', taxi: 'mini' };

function fail(e) { console.error(e); const el = $('err'); el.style.display = 'block'; el.textContent = 'Error: ' + (e && e.message || e); }
window.addEventListener('error', (e) => fail(e.error || e.message));
const lstat = (t, f) => loading.progress(t, f); // the loading screen (src/ui/loading.js)

// ------------------------------------------------------------------ renderer
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
let graphicsPreference = Q.get('quality') || 'auto';
try { if (!Q.has('quality')) graphicsPreference = localStorage.getItem('paraliaki.graphics') || 'auto'; } catch {}
const gl = renderer.getContext(), gpuInfo = gl.getExtension('WEBGL_debug_renderer_info');
const gpuName = gpuInfo ? gl.getParameter(gpuInfo.UNMASKED_RENDERER_WEBGL) : '';
graphicsPreference = await firstQualityPreference(graphicsPreference, { gpuName });
// One fixed preset, chosen once: an unset (or legacy 'auto') preference settles on the device heuristic's pick and is
// stored, so Settings always shows the preset that is actually running. Nothing adapts behind the player's back.
if (!PRESETS[graphicsPreference]) graphicsPreference = detectQuality('auto', gpuName, navigator.userAgent);
setSetting('graphics', graphicsPreference);
// GFX: what the preset + the Lighting / Effects / Resolution / Draw distance overrides resolve to (graphics.js)
let GFX = resolveGraphics(settings, { deviceRatio: window.devicePixelRatio, gpuName });
// the post chain runs the effects level; the world, weather and LOD code use the preset's scenery tier
let quality = GFX.preset, sceneryQuality = GFX.scenery;
let lowGraphics = GFX.E.simple;
window.__renderInfo = () => ({ gpu: gpuName, quality, preset: GFX.preset, lighting: GFX.lighting, effects: GFX.effects, lowGraphics, pixelRatio, drawDistance: GFX.drawDistance, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures, fps: G.fps, renderScale: settings.renderScale });
const graphicsControl = document.createElement('ui-select'); graphicsControl.id = 'graphics-quality'; graphicsControl.setAttribute('aria-label', 'Graphics preset');
for (const value of [...PRESET_IDS].reverse()) { const option = document.createElement('option'); option.value = value; option.textContent = 'GRAPHICS: ' + PRESET_LABELS[value]; graphicsControl.append(option); }
graphicsControl.value = graphicsPreference; document.body.append(graphicsControl);
graphicsControl.onchange = () => applyQualityTier(graphicsControl.value);
let pixelRatio = GFX.pixelRatio;
renderer.setPixelRatio(pixelRatio);
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping; // tone mapping happens in the post pipeline (post.js)
ENV.installAerial(ENV.AP_K); // aerial perspective replaces three's fog in every material
renderer.shadowMap.enabled = !!GFX.L.shadow;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
scene.matrixAutoUpdate = false; // never moves; its children update themselves (static world: batch.js freezeStatic)
const drivingFeedback = new DrivingFeedback({ scene, input: controls });
scene.fog = new THREE.FogExp2(new THREE.Color('#c3cdd6'), 0.00011); // only switches USE_FOG on; see ENV.installAerial
const camera = new THREE.PerspectiveCamera(settings.cockpitFov, innerWidth / innerHeight, 0.1, 90000);
const audio = new Audio();
const voices = new VoiceReactions(audio, { settings });
const playerVoices = new VoiceReactions(audio, { settings });
function carVoicePosition(c) {
  if (c.veh) return { x:c.veh.x, y:c.veh.y + 1.25, z:c.veh.z };
  const p = traffic.route.point(c.s,c.u,new THREE.Vector3()); p.y += 1.25; return p;
}
const policeVoice = new PoliceVoice(voices, carVoicePosition);
const humanVoices = new HumanVoiceEvents(voices, (s,u) => traffic.route.point(s,u,new THREE.Vector3()));
function playerImpactVoice(event) {
  const cue = impactVoiceCue(event); if (!cue || !player) return;
  const appearance = player.driver?.appearance || normalizeDriverAppearance();
  return playerVoices.trigger('driver', player, () => carVoicePosition(player), { cue, gender: appearance.gender || 'male', older: appearance.old });
}
const voicePoint = new THREE.Vector3(), voiceRotation = new THREE.Quaternion();
function voiceRelative(p) {
  return voicePoint.set(p.x, p.y, p.z).sub(camera.position).applyQuaternion(voiceRotation.copy(camera.quaternion).invert()).clone();
}
function pedestrianVoice(p, category) {
  if (multiplayer.active) return;
  return voices.trigger(category, p, () => p.active ? { x: p.x, y: (p.wy ?? p.y) + (p.look?.h || 1.7) * .9, z: p.z } : null, { gender: p.look?.female === undefined ? undefined : p.look.female ? 'female' : 'male', older: p.look?.old });
}
function driverVoice(c, category = 'driver', options = {}) {
  if (!c || multiplayer.active) return;
  return voices.trigger(category, c, () => {
    if (c.active === false) return null;
    const v = c.veh;
    if (v) return { x: v.x, y: v.y + 1.25, z: v.z };
    const p = traffic.route.point(c.s, c.u, new THREE.Vector3()); p.y += 1.25; return p;
  }, { ...options, enclosed: category !== 'police' && !(c.windowOpen || c.spec?.convertible || c.type?.scooter || c.type?.moto) });
}
audio.onTrack = (t) => hud?.message(`${icon('music-notes')} <i>${t.title}</i> · ${t.artist}`, 3);

// ------------------------------------------------------------------ game state
const G = {
  state: 'loading', t: 0, raceT: 0, countT: 0, cam: Q.get('cam') === 'chase' ? 'chase' : 'cockpit', userCam: Q.get('cam') === 'chase' ? 'chase' : 'cockpit', carIdx: 0, selIdx: 0, menuFrom: null,
  crashes: 0, topSpeed: 0, pFinish: null, rFinish: null, lastLead: 0, leadT: 0,
  shake: 0, flash: 0, driftAcc: 0, driftT: 0, markIdx: 0, finishedT: 0, orbitA: 0, autodrive: Q.has('autodrive'),
};
canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); G.ctxLost = true; clearDriveInput(); });
canvas.addEventListener('webglcontextrestored', () => { G.ctxLost = false; lightingRecoveryPending = true; });
window.__game = G;
window.__voice = { voices, playerVoices, policeVoice, humanVoices, playerImpactVoice, pedestrianVoice, driverVoice };
window.__audio = () => audio.levels && audio.levels();
window.__bus = () => audio.busLevels && audio.busLevels();
window.__dbg = () => ({ state: G.state, raceT: +G.raceT.toFixed(2), fps: Math.round(G.fps), pr: pixelRatio, kmh: Math.round(player.veh.kmh), gear: player.veh.gear, rpm: Math.round(player.veh.rpm), s: Math.round(player.veh.s), u: +player.veh.u.toFixed(2), rs: Math.round(rival.veh.s), rkmh: Math.round(rival.veh.kmh), ru: +rival.veh.u.toFixed(2), rlane: rival.ai.lane, rrev: rival.ai.revT > 0, rdbg: rival.ai.dbg, pdbg: player.ai && player.ai.dbg, crashes: G.crashes, pen: G.pen, scared: G.scared, peds: people.peds.filter((p) => p.active).length, onRoad: people.onRoad.length, calls: renderer.info.render.calls, tris: renderer.info.render.triangles });
let map, route, hud, traffic, water, sky, sun, post, assets, startS, signals, people, probe, probeSeed;
let lightingRecoveryPending = false, lightingChecks = 0, lightingRepairs = 0;
function lightingInfo() {
  const st = ENV.lightingState(scene), probeOK = !!probe && !probe.invalid && !!probe.envRT.texture;
  const exposure = post?.baseExposure;
  return { ...st, probe: probeOK, probeFace: probe?.face, exposure, valid: st.environment && st.sun && st.fill && probeOK && Number.isFinite(exposure) && exposure > 0,
    checks: lightingChecks, repairs: lightingRepairs };
}
function guardLighting(force = false) {
  if (!sky || !post || !probe || G.ctxLost || renderer.getContext().isContextLost()) return;
  if (!force && !lightingRecoveryPending && ++lightingChecks % 120) return;
  const before = lightingInfo();
  const recovered = ENV.ensureLighting(scene, { rebake: lightingRecoveryPending });
  if (lightingRecoveryPending || recovered || !before.probe) probe.reset();
  if (!Number.isFinite(post.baseExposure) || post.baseExposure <= 0) { post.setConditions(ENV.COND_STATE); post.resetHistory(); }
  if (lightingRecoveryPending || recovered || !before.valid) { renderer.shadowMap.needsUpdate = true; sun.shadow.needsUpdate = true; post.resetHistory(); lightingRepairs++; }
  lightingRecoveryPending = false;
}
window.__lightingInfo = lightingInfo;
window.__lightingGuard = guardLighting;
if (Q.has('simhook')) window.__renderTest = {
  applyQualityTier, applyRenderResolution,
  probeFace(face) { probe.face = face; },
  breakLighting() { scene.environment?.dispose(); scene.environment = null; sun.removeFromParent(); probe.envRT.dispose(); post.baseExposure = NaN; },
};

let ground = null, splash = null, fx = null, police = null, policeHud = null;
let drivingModeView = null;
let world = null, mapSwitch = null, lastMapDisposal = null;
const sessionTransitions = new SessionTransitions();
const lodList = [];
const lodAt = new THREE.Vector3(1e9, 0, 0);
function updateLod() { updateSceneryLod(lodList, camera); lodAt.copy(camera.position); }
// render distance (scenery.js): the setting applies live; traffic is drawn out to about half of it
setDrawDistance(+Q.get('draw') || GFX.drawDistance, GFX.horizon, GFX.detail);
// lower presets cap traffic and pedestrian draw ranges (graphics.js trafficDraw / crowd); high keeps the full range
const applyDrawDistance = () => { if (traffic) PARKED_RANGE.far = traffic.drawRange = Math.min(GFX.trafficDraw ?? Infinity, clamp(drawDistance() * 0.55, 220, 1150)); if (people) people.drawRadius = Math.min(GFX.crowd, Math.max(60, drawDistance() * 0.35)); };
const GRAPHICS_KEYS = new Set(['graphics', 'lighting', 'effects', 'renderScale', 'drawDistance']);
/** re-resolve the graphics settings and apply whatever changed, live (no reload, the world is kept) */
function applyGraphics(key) {
  const prev = GFX; GFX = resolveGraphics(settings, { deviceRatio: window.devicePixelRatio, gpuName });
  graphicsPreference = GFX.preset; graphicsControl.value = GFX.preset;
  if (key === 'graphics') { const url = new URL(location.href); if (url.searchParams.has('quality')) { url.searchParams.set('quality', GFX.preset); history.replaceState(null, '', url); } }
  quality = GFX.preset; sceneryQuality = GFX.scenery; lowGraphics = GFX.E.simple;
  if (GFX.pixelRatio !== pixelRatio) { pixelRatio = GFX.pixelRatio; onResize(); post?.resetHistory(); }
  setDrawDistance(+Q.get('draw') || GFX.drawDistance, GFX.horizon, GFX.detail); applyDrawDistance(); updateLod();
  if (!post) return; // boot reads the current settings below
  if (GFX.effects !== prev.effects) { post.setEffects(GFX.effects); applySceneryQuality(sky, probeSeed, water, world?.group, lowGraphics); applyWeatherQuality(GFX.E.particles); }
  if (GFX.lighting !== prev.lighting) {
    renderer.shadowMap.enabled = !!GFX.L.shadow; renderer.shadowMap.autoUpdate = true; renderer.shadowMap.needsUpdate = true;
    if (GFX.L.shadow) ENV.setShadowRange(...GFX.L.shadow);
  }
  guardLighting(true);
}
onSettings((s, key) => { if (GRAPHICS_KEYS.has(key)) applyGraphics(key); });

let player = null, rival = null; // {veh, model, driver, cockpit, spec}
const keys = controls.keys; // retained for the simulation test hook
const input = controls.state;

// ------------------------------------------------------------------ boot
const T0 = performance.now(); const tlog = (n) => { if (Q.has('debug')) console.log(n, Math.round(performance.now() - T0), 'abs', Math.round(performance.now())); };
async function boot() {
  G.carIdx = savedCar(); G.selIdx = G.carIdx;
  initFlow();
  // loaded means the app can respond to a lobby; mapId/version still gate the loaded/ready protocol.
  multiplayer.loaded = true;
  showTitle();
  last = performance.now(); requestAnimationFrame(frame);
  if (SKIP_MENU && !multiplayer.pendingCode) await waitForBootSession(multiplayer);
  if (multiplayer.active) await multiplayer.syncLobby();
  else if (SKIP_MENU && !multiplayer.pendingCode) {
    await switchMap(initialMapId(Q), Q.get('event') === 'free' ? 'FREE ROAM' : 'QUICK RACE');
    prepareEvent(Q.get('event') || 'quick'); resetRace();
    G.cam = G.userCam; applyCamMode(); updateCamera(0, true); startCountdown();
  }
  document.body.classList.add('loaded');
  performance.mark('menu-ready'); tlog('ready');
}

async function loadFirstMap(id) {
  const texReady = loadTextures(); // decodes in parallel with the world building below
  map = await loadMap(undefined, './', id);
  route = map.route;
  startS = route.start;
  hud?.paintPanel?.remove(); $('rticks').replaceChildren();
  hud = new Hud(map);
  hud.onPaint = (id, color) => { if (player?.spec.id === id) setPaint(player.model, color); }; // garage paint picker (hud.showPaint)
  hud.drawOverview($('overview'));
  tlog('map');
  lstat('BUILDING TERRAIN', 0.25); await frameYield();
  if (!sky) {
    sky = ENV.createSky(); scene.add(sky);
    const baked = ENV.bakeSky(renderer, sky); probeSeed = baked.cube; scene.environment = baked.env;
    ({ sun } = ENV.createLights(scene)); if (GFX.L.shadow) ENV.setShadowRange(...GFX.L.shadow);
  }
  world = await buildMapWorld(map, { scene, sky, skyCube: probeSeed, lowGraphics, quality: sceneryQuality, progress: lstat });
  bindMapWorld(world);
  policeHud ||= new PoliceHud();
  post ||= createPost(renderer, scene, camera, { effects: GFX.effects }); window.__post = post;
  probe ||= createProbe();
  setCarEnv(probe.envRT.texture);
  bindMapWeather(); // time of day + weather (?tod=&wx=)
  tlog('traffic+post');
  // ?car= takes a 1-based number or a car id (?car=2, ?car=z4); anything else falls back to the saved car
  const qCar = Q.get('car'), qIdx = qCar == null ? -1 : /^\d+$/.test(qCar) ? clamp(+qCar - 1, 0, CARS.length - 1) : CARS.findIndex((c) => c.id === qCar);
  setCar(qIdx >= 0 ? qIdx : savedCar(), false);
  prepareEvent('quick');
  resetRace();
  updateCamera(0, true);
  lstat('WARMING TYRES', 0.95);
  await texReady; uploadTextures(renderer);
  tlog('textures');
  updateLod();
  await compileScene();
  if (renderer.shadowMap.enabled) warmShadowPrograms(); // compileAsync skips the shadow depth variants
  tlog('compiled');
  onResize();
  multiplayer.mapId = map.id;
  multiplayer.trackVersion = trackVersion(map.data.route);
  if (!window.__ghostLap) initGhostLap({ G, scene, route, hud, input,
    player: () => player, online: () => multiplayer.active,
    trackVersion: () => multiplayer.trackVersion });
  G.state = 'menu'; G.cam = 'orbit'; applyCamMode(); updateCamera(0, true);
  return map;
}

// Map scene ownership is separate from persistent rendering, input and menu state.
function bindMapWorld(next) {
  ({ map, water, assets, signals, people, traffic, ground, splash, fx, markers } = next); applyDrawDistance();
  for (const c of traffic.cars || []) if (c.m?.root && !c.m.root.userData.shadowTrimmed) { trimShadowCasters(c.m.root); c.m.root.userData.shadowTrimmed = true; }
  route = map.route; startS = route.start;
  drivingModeView?.dispose(); drivingModeView = new DrivingModeView(scene, route);
  lodList.splice(0, lodList.length, ...next.lod);
  traffic.disabled = Q.has('notraffic') || route.closed;
  { const base = traffic.density.bind(traffic); traffic.density = (s) => base(s) * (G.trafficMul ?? 1); }
  police = new Police(traffic, route); window.__police = police;
  policeVoice.reset(); humanVoices.reset(); police.onVoice = (state, transitions) => policeVoice.observe(state, transitions);
  window.__sim = { signals, people, traffic, route, ground, fx, G, input, look, camera, cameraBlend, towOffer, get player() { return player; } };
  if (Q.has('simhook')) {
    Object.assign(window.__sim, { scene, renderer, canvas, keys, render: () => render(), step: (n = 1, dt = 1 / 60) => { for (let i = 0; i < n; i++) step(dt, false); } });
    // World binding precedes post creation/car selection; diagnostics must read current owners after a swap.
    Object.defineProperties(window.__sim, { post: { get: () => post }, cars: { get: () => [player, ...grid] } });
  }
  G.mapId = map.id || 'riviera';
}
function bindMapWeather() {
  initWeather({ renderer, scene, camera, sky, water, sun, post, probe, traffic, assets, audio, quality: GFX.E.particles, cars: () => [player, rival], cam: () => G.cam });
}
/** Menu/lobby contract: await switchMap(id), then prepare/start the selected event. */
async function switchMap(id = 'riviera', context = 'QUICK RACE') {
  if (mapSwitch) { await mapSwitch; return switchMap(id, context); }
  if (world && map?.id === id) return map;
  getMap(id); selectedMapId = id;
  loading.show(id, context);
  mapSwitch = (async () => {
    const priorState = G.state, priorPaused = G.paused;
    sessionTransitions.cancel(); controls.clear(); G.cameraStarting = false; G.towing = false; G.paused = null;
    document.body.classList.remove('fading');
    voices.reset(); audio.menuRequested = true; audio.syncMenu(); audio.cancelIgnition?.(); G.state = 'loading';
    if (!world) {
      try { return await loadFirstMap(id); }
      catch (error) { map?.dispose?.(); map = route = null; G.state = 'menu'; throw error; }
    }
    let nextMap, nextWorld;
    try {
      nextMap = await loadMap(undefined, './', id);
      nextWorld = await buildMapWorld(nextMap, { scene, sky, skyCube: probeSeed, lowGraphics, quality: sceneryQuality, progress: lstat });
    } catch (error) { nextMap?.dispose?.(); G.state = priorState; G.paused = priorPaused; throw error; }
    if (G.run && !G.run.done) G.run.abort('map-change');
    window.__ghostLap?.hideGhost();
    if (window.__ghostLap?.ghost) window.__ghostLap.disposeGhost();
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
    if (window.__ghostLap) { Object.assign(window.__ghostLap.ctx, { route, hud }); window.__ghostLap.recorder = null; }
    G.ev = null; G.run = null; G.pendingEvent = null; G.gridKey = null;
    releaseSceneryVariants(previous.group);
    const disposedResources = previous.dispose();
    lastMapDisposal = { mapId: previous.map.id, detached: !previous.group.parent, children: previous.group.children.length, bundleDisposed: previous.map.disposed, resources: disposedResources };
    renderer.renderLists.dispose();
    bindMapWeather();
    multiplayer.mapId = map.id; multiplayer.trackVersion = trackVersion(map.data.route);
    prepareEvent('quick'); resetRace();
    G.state = 'menu'; G.cam = 'orbit'; applyCamMode(); updateCamera(0, true);
    document.body.classList.remove('racing', 'counting');
    post.resetHistory?.(); onResize(); updateLod();
    // the new world's shaders (and shadow depth variants) compile behind the loading screen, not mid-race
    await compileScene();
    if (renderer.shadowMap.enabled) warmShadowPrograms();
    const url = new URL(location.href); url.searchParams.set('map', map.id); history.replaceState(null, '', url);
    last = performance.now();
    return map;
  })();
  try { const loaded = await mapSwitch; selectedMapId = loaded.id; return loaded; } finally { mapSwitch = null; loading.hide(); }
}
window.__switchMap = switchMap;
window.__mapRuntime = () => ({ mapId: map?.id, switching: !!mapSwitch, worlds: scene.children.filter(o => o.name.startsWith('map-world:')).map(o => o.name), lastDisposal: lastMapDisposal, memory: { ...renderer.info.memory }, weatherWidgets: document.querySelectorAll('#police-hud').length });

// ------------------------------------------------------------------ cars
function makeCar(spec, isPlayer, plate) {
  // The plate is the local driver name (driverName.plate()), a remote driver's
  // lobby plate, or undefined for a random registration. Single player shows
  // the driver name; multiplayer shows every driver's name.
  const model = new CarModel(spec, { plate });
  scene.add(model.root);
  const driver = new Driver(isPlayer ? normalizeDriverAppearance() : { helmet: true, shirt: '#16181c', skin: '#b67c56' });
  bindDriverToCar(driver,model);
  if (!isPlayer) for (const a of driver.arms) a.up.visible = a.fo.visible = a.hand.visible = false;
  // graphics.js: fewer, cheaper shadow draws; a rival's driver is hidden in its body's shadow anyway
  trimShadowCasters(model.root); if (driver.root) { if (isPlayer || spec.convertible) trimShadowCasters(driver.root); else driver.root.traverse(o => { o.castShadow = false; }); }
  return { model, driver };
}
// A rival beyond ~60 m draws the catalogue car's own far level from the traffic fleet (a few merged draws, no shadow)
// instead of the full model (~65 draws and ~40 shadow casters); built with the grid, so the switch costs nothing mid-race.
let rivalFarTypes = null;
function attachRivalFar(c) {
  rivalFarTypes ||= catalogueTrafficTypes(CARS);
  const type = rivalFarTypes.find((t) => t.id === c.spec.id);
  c.far = type ? fleetModel(type, c.model.paint?.color || c.spec.color, new RNG(7), { low: true }) : null;
  if (c.far) { c.far.root.visible = false; c.far.root.name = 'rival-far:' + c.spec.id; scene.add(c.far.root); }
  c.farOn = false; c.shadowsOff = false;
  c.casters = []; c.model.root.traverse((o) => { if (o.isMesh && o.castShadow) c.casters.push(o); });
}
function disposeCar(c) {
  if (!c) return;
  if (c.far) {
    scene.remove(c.far.root);
    c.far.root.traverse((o) => { for (const m of Array.isArray(o.material) ? o.material : o.material ? [o.material] : []) if (!m.userData?.shared) m.dispose?.(); });
    c.far = null;
  }
  c.cockpit?.disposeMirrors();
  c.driver?.dispose?.();
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


function announceGearbox(spec) {
  controls.toast(gearboxMessage(null, player?.veh.manual, controls.bindings, activeInputDevice()));
}

function setCar(idx, keepPose = true) {
  const old = player;
  const spec = CARS[idx];
  G.carIdx = idx; G.selIdx = idx;
  if (old) beginCameraBlend();
  disposeCar(old);
  const pc = makeCar(spec, true, driverName.plate());
  const veh = old ? old.veh : new Vehicle(spec, route);
  veh.setSpec(spec); veh.gear = Math.min(veh.gear, spec.gears.length);
  player = { spec, veh, ...pc };
  veh.ground = ground;
  player.cockpit = new Cockpit(spec, pc.model);
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
  if (document.body.classList.contains('loaded')) announceGearbox(spec);
  applyCamMode();
  if (keepPose) { syncCar(player, 0); syncCar(rival, 0); }
}

function resetRace() {
  world?.tyreWalls?.reset();
  applyDriving();
  if (!G.ev) prepareEvent(EV.QUICK_RACE);
  if (!multiplayer.active) { resetEvent(); return; }
  const s0 = Q.has('s') ? +Q.get('s') : startS;
  player.veh.reset(s0, route.laneU(s0, 1), 0);
  rival.veh.reset(s0 + 9, route.laneU(s0 + 9, 0), 0);
  for (const v of [player.veh, rival.veh]) { v.nitro = v.spec.nitrous === true ? 0.4 : 0; v.dragMul = 1; v.wallHit = 0; v.safe = null; v.water = 0; }
  G.sinkT = 0; G.sinkFade = false; G.stuckT = 0; G.stuckHint = false; G.towing = false; resetTowOffer();
  if (fx) fx.clearMarks();
  rival.ai = { lane: 0, u: route.laneU(s0 + 9, 0), cool: 0, mistakeT: 20 + Math.random() * 20, sigJ: -1 };
  if (player.ai) player.ai.sigJ = -1;
  signals.reset();
  traffic.reset(s0);
  people.reset(s0); voices.reset();
  Object.assign(G, { raceT: 0, crashes: 0, topSpeed: 0, pFinish: null, rFinish: null, lastLead: 0, leadT: 0, driftAcc: 0, driftT: 0, shake: 0, flash: 0, finishedT: 0, rivalBanner: false, cones: 0,
    pen: 0, scared: 0, postT: 0, pFront: null, rFront: null, tickT: 0, waitJ: -1 });
  const n = Math.ceil((route.finish - startS) / 10) + 2;
  G.tP = new Float32Array(n).fill(NaN); G.tR = new Float32Array(n).fill(NaN);
  G.markIdx = map.data.marks.findIndex((m) => m.s > s0 + 50); if (G.markIdx < 0) G.markIdx = map.data.marks.length;
  syncCar(player, 0); syncCar(rival, 0);
}
/** offline reset onto the active event: the grid, traffic in the event's direction and density, timing */
function resetEvent() {
  world?.tyreWalls?.reset();
  notifications.clear();
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
  for (const v of [player.veh, ...grid.map((c) => c.veh)]) { v.nitro = v.spec.nitrous === true ? 0.4 : 0; v.dragMul = 1; v.wallHit = 0; v.safe = null; v.water = 0; }
  G.sinkT = 0; G.sinkFade = false; G.stuckT = 0; G.stuckHint = false; G.towing = false; resetTowOffer();
  if (fx) fx.clearMarks();
  if (player.ai) { player.ai.sigJ = -1; player.ai.lane = undefined; }
  signals.reset();
  traffic.reset(player.veh.s);
  people.reset(peopleS(player.veh.s)); voices.reset();
  Object.assign(G, { raceT: 0, crashes: 0, topSpeed: 0, pFinish: null, rFinish: null, lastLead: 0, leadT: 0, driftAcc: 0, driftT: 0, shake: 0, flash: 0, finishedT: 0, rivalBanner: false, cones: 0,
    pen: 0, scared: 0, postT: 0, pFront: null, rFront: null, tickT: 0, waitJ: -1,
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

// Recovery always offers a choice. A tow costs five seconds: solo timed events add to G.pen;
// online races and pursuit-survive hold the car for five seconds while the authoritative clock runs.
const towOffer = { element: null, cooldown: 0, offT: 0, safe: null, hold: 0, recovering: false, elapsed: 0, stuckT: 0, severeT: 0 };
function closeTowOffer(delay = 0) {
  notifications.dismiss('tow');
  if (towOffer.element) { towOffer.element.remove(); towOffer.element = null; }
  towOffer.cooldown = Math.max(towOffer.cooldown, delay);
}
function resetTowOffer() {
  closeTowOffer(); Object.assign(towOffer, { cooldown: 0, offT: 0, hold: 0, recovering: false, elapsed: 0, stuckT: 0, severeT: 0 });
  towOffer.safe = player ? { s: player.veh.s, u: player.veh.u } : null;
}
function offerTow() {
  if (towOffer.element || towOffer.cooldown > 0) return;
  const el = document.createElement('aside'); el.className = 'tow-prompt ui-prompt'; el.id = 'tow-prompt';
  el.setAttribute('role', 'region'); el.setAttribute('aria-label', 'Tow assistance');
  el.innerHTML = '<strong>NEED A TOW?</strong><p>Repair the car and return to your last road position. ' + (inFreeRoam() ? 'Free recovery.' : 'Costs 5 seconds.') + '</p><div class="tow-actions"><button type="button" data-tow="accept">TOW + REPAIR · ' + bindingLabel(controls.bindings, activeInputDevice() === 'gamepad' ? 'camera' : 'tow', activeInputDevice()) + '</button><button type="button" data-tow="dismiss">KEEP DRIVING</button></div>';
  el.querySelector('[data-tow=accept]').onclick = () => { el.querySelector('button').blur(); tow(player.veh); };
  el.querySelector('[data-tow=dismiss]').onclick = () => { el.querySelector('[data-tow=dismiss]').blur(); closeTowOffer(TOW_PROMPT_COOLDOWN); };
  if (!inFreeRoam() && !multiplayer.active) {
    const retire = document.createElement('button'); retire.type = 'button'; retire.textContent = 'RETIRE · DNF';
    retire.onclick = () => { closeTowOffer(); if (multiplayer.active) multiplayer.retire(); else finishRace('retired'); };
    el.querySelector('.tow-actions').append(retire);
  }
  const chip = document.createElement('button'); chip.type = 'button'; chip.className = 'tow-chip'; chip.textContent = 'R: tow'; chip.setAttribute('aria-label', 'Tow to road'); chip.onclick = () => tow(player.veh); el.append(chip);
  towOffer.element = el; towOffer.elapsed = 0; notifications.adopt('tow',el,{priority:60,persistent:true});
}
// Water still produces its splash, but recovery waits for the driver to accept the offer.
function seaCheck(pv, dt) {
  if (!pv.ground) return;
  if (pv.water > 0.2 && !G.sinkT) {
    G.sinkT = 1e-3;
    const v = pv.velocityWorld(new THREE.Vector3()), sp = Math.hypot(v.x, v.z);
    if (!multiplayer.active) splash.burst(pv.x, pv.z, v.x, v.z, sp / 18);
    audio.noise({ dur: 1.4, f: 500, type: 'lowpass', gain: 0.5 * Math.min(1, 0.4 + sp / 25) });
    audio.noise({ dur: 0.5, f: 2400, type: 'bandpass', q: 0.8, gain: 0.25 });
    G.shake = Math.max(G.shake, Math.min(0.7, sp / 30));
  }
  if (pv.water <= 0.05) G.sinkT = 0;
}
function backOnRoad(pv, recovery = null, { reset = false } = {}) {
  const online = multiplayer.active, dir = online ? multiplayer.lobby.event?.dir || 1 : G.dir || 1;
  const sf = towOffer.safe || pv.safe || { s: G.ev.r.s0, u: 0 };
  // Road projection gives the nearest point on all maps, including unwrapped circuit laps.
  // Online recovery uses the last valid road progress, never the off-road projection or a forward jump.
  let s = recovery?.s ?? (reset ? roadRecoveryPose(route, pv, dir).s : recoveryPosition(pv.s, sf.s, dir));
  if (!online && G.run && !recovery) {
    const next = G.run.r.checkpoints[G.run.cpIdx];
    if (next) s = G.run.r.s0 + dir * Math.min(G.run.progress(s), next.d - 3);
  }
  if (!route.closed) s = clamp(s, 0, route.length);
  const placement = roadRecoveryPose(route, pv, dir, s);
  s = placement.s; // The helper also repairs non-finite or out-of-range anchors.
  const u = placement.u;
  const nitro = pv.nitro; beginCameraBlend();
  pv.reset(s, u, 0); pv.yaw = placement.yaw;
  if (online && !recovery) multiplayer.stateSender.discontinuity();
  pv.nitro = nitro; pv.safe = { s, u }; towOffer.safe = { s, u };
  // reset() clears contact history and marks the suspension fresh; the next update settles each wheel.
  G.sinkT = 0; G.sinkFade = false; look.yaw = look.pitch = look.targetYaw = look.targetPitch = look.yawV = look.pitchV = 0;
  syncCar(player, 0); updateCamera(0, true);
}
function stuckCheck(pv, dt) {
  if (G.state !== 'race' || G.towing || multiplayer.retired) {
    G.stuckT = 0; closeTowOffer(); return;
  }
  towOffer.cooldown = Math.max(0, towOffer.cooldown - dt);
  if (towOffer.element && !towOffer.element.classList.contains('minimised')) {
    towOffer.elapsed += dt;
    if (towOffer.elapsed >= TOW_PROMPT_SECONDS) { towOffer.element.classList.add('minimised'); towOffer.cooldown = TOW_PROMPT_COOLDOWN; }
  }
  const beyond = pv._network ? 0 : Math.abs(pv.u) - route.edge(pv.s); // side streets are valid roads, not a recovery zone
  const offroad = !!pv.offroad || beyond > 0.5 || pv.water > 0.05;
  const inverted = Math.abs(pv.pose.roll) > Math.PI / 2 || Math.abs(pv.pose.pitch) > Math.PI / 2;
  const disabled = pv.engineStalled || pv.drivetrainBroken || EV.isWrecked(pv.maxImpactEbs);
  // Only on-road poses advance the recovery anchor; a circuit excursion cannot skip a checkpoint.
  if (!offroad && !inverted && !disabled && !G.towing && towOffer.hold <= 0) {
    if (!pv._network && Math.abs(pv.u) + pv.halfW <= route.edge(pv.s)) towOffer.safe = { s: pv.s, u: pv.u }; closeTowOffer(); towOffer.offT = towOffer.stuckT = towOffer.severeT = G.stuckT = 0; return;
  }
  const needed = towCondition({ offroad, beyond, water: pv.water, inverted, disabled, speed: pv.speed }, dt, towOffer);
  G.stuckT = towOffer.stuckT;
  if (needed && towOffer.hold <= 0) offerTow();
}
function tow(pv, { reset = false } = {}) {
  if (G.state !== 'race' || G.towing || multiplayer.retired) return;
  G.towing = true; G.stuckT = 0; closeTowOffer(TOW_PROMPT_COOLDOWN);
  controls.releaseMouseLook(); document.body.classList.add('fading');
  const raceId = multiplayer.lobby?.raceId;
  sessionTransitions.after(320, async current => {
    let recovery = null;
    try { if (multiplayer.active) recovery = await multiplayer.recover(); }
    catch (error) { if (current()) { G.towing = false; document.body.classList.remove('fading'); hud.message(error.message, 4); } return; }
    if (!current()) return;
    G.towing = false;
    if (G.state !== 'race' || player.veh !== pv || multiplayer.retired || multiplayer.lobby?.raceId !== raceId) { document.body.classList.remove('fading'); return; }
    // Both controls share checkpoint limits; online keeps the server's anchor.
    backOnRoad(pv, recovery, { reset });
    const hold = multiplayer.active || G.ev.def.type === 'pursuit' && G.ev.def.rules?.goal === 'survive';
    towOffer.recovering = hold;
    if (hold) towOffer.hold = multiplayer.active && recovery ? Math.max(0, (recovery.until - multiplayer.now()) / 1000) : 5; else if (!inFreeRoam()) G.pen += 5;
    hud.message(`<i>${reset ? 'RESET' : 'TOWED'}</i> · ${inFreeRoam() ? '' : '+5 s · '}BACK ON THE ROAD`, 3);
    sessionTransitions.after(120, () => document.body.classList.remove('fading'));
  });
}

function resetCar() {
  if (G.state === 'paused') resume();
  if (multiplayer.active && menu?.open) resume();
  tow(player.veh, { reset: true });
}

function recoverFromCapture() {
  if (G.state !== 'race' || G.towing) return;
  // Online the capture is the server's recovery hold (it costs the clock time), then you race on.
  // (the units are shared: only this driver's judge settles, and the world authority stands its units down)
  if (multiplayer.active) { tow(player.veh); hud.message('<i>PULLED OVER</i> · RECOVERY HOLD', 4); return; }
  if (G.ev?.def.type === 'pursuit') { finishRace('busted'); return; }
  // Pulled over: held at the roadside while the clock runs (no fine, no added seconds), then you drive on.
  police?.reset(police.enabled);
  towOffer.recovering = true; towOffer.hold = inFreeRoam() ? 3 : CAPTURE_HOLD;
  hud.message(`<i>PULLED OVER</i> · HELD ${towOffer.hold} s`, 4);
}

const inFreeRoam = () => !multiplayer.active && G.ev?.def.type === 'free';
const CAPTURE_HOLD = 10; // s held at the roadside after a solo arrest, on the race clock
function startCountdown() {
  document.body.classList.remove('menu-backdrop');
  G.cameraStarting = false; G.paused = null;
  syncSteeringAssist();
  G.state = 'countdown'; G.countT = 0; G.countShown = -1; G.countWall = 0;
  document.body.classList.remove('racing'); document.body.classList.add('counting');
  hud.hideMenu();
  menu?.hide();
  if (!multiplayer.active && G.ev) {
    if (G.run && !G.run.done) G.run.abort('restart');
    G.bestSetup = bestSetup(); G.bestSetupChanged = false; G.result = null; G.resultPhoto = null; G.resultPhotoPending = false;
    G.run = isDrivingMode(G.ev.def) ? new DrivingModeRun(G.ev.def, evCtx(), { car: player.spec.id, map }) : new EV.EventRun(G.ev.def, evCtx(), { car: player.spec.id });
    if (inFreeRoam()) {
      G.state = 'race'; G.run.start({ field: 1, grid: [] }); hud.count('');
      document.body.classList.remove('counting'); document.body.classList.add('racing', 'started');
      hud.banner('FREE ROAM', map.definition?.name || map.id); return;
    }
    const r = G.ev.r; hud.banner(G.ev.def.name, `${r.fromName} ${r.reverse ? '◀' : '▶'} ${r.toName} · ${EV.TYPES[G.ev.def.type].label}`);
  }
}

function restart(idx = G.carIdx) {
  if (multiplayer.active) return;
  sessionTransitions.cancel(); G.towing = false;
  G.cameraStarting = true; controls.requestMouseLock(); beginCameraBlend();
  document.body.classList.add('fading');
  sessionTransitions.after(280, () => {
    if (multiplayer.active) { document.body.classList.remove('fading'); return; }
    // Capture at the actual reset, after the fade delay; the old blend has already elapsed.
    beginCameraBlend(.65);
    if (G.run && !G.run.done) G.run.abort('restart');
    if (G.pendingEvent) { prepareEvent(G.pendingEvent); G.pendingEvent = null; }
    if (idx !== G.carIdx || player.spec !== CARS[idx]) setCar(idx);
    setPaint(player.model, savedPaint(player.spec));
    resetRace(); audio.restart();
    G.cam = G.userCam || 'cockpit'; applyCamMode();
    updateCamera(0, true);
    startCountdown();
    document.body.classList.remove('fading');
  });
}

// ------------------------------------------------------------------ input
function requestRaceLook(action) {
  if ((menu?.screen === 'car' && action === 'carConfirm' && !menu.data.garage) || (G.state === 'paused' && action === 'resume')) {
    G.cameraStarting = true; controls.requestMouseLock();
  }
}
document.addEventListener('click', e => requestRaceLook(e.target.closest?.('[data-act]')?.dataset.act), true);
addEventListener('keydown', e => {
  if (!e.repeat && e.code === 'Enter' && !e.target.closest?.('input, select, textarea, [contenteditable]')) requestRaceLook(menu?.items?.()[menu.focus]?.dataset.act);
});
addEventListener('keydown', e => {
  if (e.target.closest?.('input, select, textarea, button, [contenteditable]')) return;
  if (!multiplayer.panel.hidden && !menu?.open) { clearDriveInput(); return; } // the lobby screens are menus: their keys navigate
  G.inputDevice = 'keyboard'; audio.start();
});
addEventListener('pointerdown', e => { G.inputDevice = e.pointerType === 'touch' ? 'touch' : 'keyboard'; audio.start(); });

function readInput(dt) {
  const inMenu = window.__flow.inMenu();
  const blocked = G.ctxLost || document.hidden || G.state === 'loading' && !menu?.open && multiplayer.panel.hidden;
  controls.setCarSpec(player?.veh.spec);
  controls.update(dt, { speed: player ? Math.abs(player.veh.vLong) : 0, inMenu, blocked, retainMouseLock: !!G.cameraStarting });
  const pad = controls.pad;
  if (controls.keys.size) G.inputDevice = 'keyboard';
  else if (Object.values(controls.touch).some(Boolean)) G.inputDevice = 'touch';
  else if (pad && (pad.buttons?.some(b => (b.value || 0) > 0.05) || pad.axes?.some(a => Math.abs(a) > controls.settings.deadzone))) G.inputDevice = 'gamepad';
  else if (!G.inputDevice || G.inputDevice === 'gamepad' && !pad) G.inputDevice = pad ? 'gamepad' : 'keyboard';
  { const hint = ui.hintDevice(G.inputDevice); if (document.body.dataset.input !== hint) document.body.dataset.input = hint; } // device-aware key hints (ui.css)
  if (syncSteeringAssist() && menu?.screen === 'settings' && settings.steeringAssist === null) menu.refreshValues();
  for (const name of controls.actions) {
    // Shared defaults (Escape, Enter, A/B) have different meanings in a menu and while driving.
    if ((inMenu && name === 'restart' && input.confirm) || (inMenu && name === 'pause' && input.back) || (!inMenu && name === 'back')) continue;
    if (!inMenu) drivingHints.action(name);
    flowAction(name);
    if (!inMenu && !G.autodrive && G.state === 'race' && (name === 'shiftUp' || name === 'shiftDown')) {
      shiftTransmission(player.veh, name === 'shiftUp' ? 1 : -1);
    }
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
function bestSetup(def = G.ev?.def, r = G.ev?.r, car = player?.spec.id) {
  return personalBestSetup({ mapId: map?.id, def, route: r, car: car || CARS[G.carIdx]?.id, conditions: window.__conditions?.(),
    assists: { tc: settings.aids, abs: settings.abs, steering: settings.steeringAssist ?? (['gamepad', 'wheel'].includes(activeInputDevice()) ? 'light' : 'full'), gearbox: settings.transmission } });
}
function rememberResult(res) {
  res.date ||= new Date().toISOString();
  const setup = G.bestSetup || bestSetup();
  const eligible = res.valid && !G.bestSetupChanged && exactBestKey(setup) === exactBestKey(bestSetup());
  res.personalBest = recordPersonalBest(setup, { ...res, valid: eligible });
  G.resultPhoto = null; G.resultPhotoPending = true;
}
function onlinePersonalResult() {
  const me = multiplayer.me;
  if (me?.finish == null || G.result?.raceId === multiplayer.lobby.raceId) return;
  G.result = { raceId: multiplayer.lobby.raceId, time: me.finish, carName: player.spec.name, valid: !G.autodrive && !Q.has('s') && !me.dnf };
  rememberResult(G.result);
}
async function shareResult() {
  const res = G.result; if (!res) return;
  if (!G.resultPhoto) { G.resultPhotoPending = true; render(); }
  const r = G.ev.r;
  try { ui.toast(await shareResultCard({ screenshot: G.resultPhoto, mapName: map.definition?.name,
    routeName: r.closed ? `${r.laps} LAPS · ${r.reverse ? 'REVERSE' : 'FORWARD'}` : `${r.fromName} → ${r.toName}`,
    carName: res.carName || player.spec.name, time: res.time, position: multiplayer.active ? multiplayer.ranking().findIndex(p => p.id === multiplayer.id) + 1 : res.position,
    field: multiplayer.active ? multiplayer.lobby.players.length : res.field, pb: res.personalBest, date: res.date, url: new URL(document.querySelector('link[rel="canonical"]')?.href || location.href).host })); }
  catch (error) { ui.toast(error.message, { tone: 'bad' }); }
}
const MENU_STATES = ['menu', 'paused', 'results', 'garage'];
let selectedMapId = initialMapId(Q);
const evCtx = () => ({ map, mapId: map.id, route, marks: map.data.marks, events: map.events });
const menuCtx = () => map?.id === selectedMapId ? evCtx() : menuMapContext(selectedMapId);
function selectMenuMap(id) { getMap(id); selectedMapId = id; }
const activeInputDevice = () => G.inputDevice || (controls.pad ? 'gamepad' : 'keyboard');
function syncSteeringAssist() {
  if (!player) return false;
  const before = player.veh.steerAssist;
  const value = applyVehicleSteeringAssist(player.veh, activeInputDevice());
  return value !== before;
}
function applyDriving() {
  if (!player) return;
  applyVehicleAids(player.veh, player.spec);
  player.veh.setManual?.(settings.transmission === 'manual', { ai: G.autodrive });
  syncSteeringAssist();
}
function carBest(i) { return +localStorage.getItem('paraliaki.best.' + CARS[i].id) || 0; }
// dev / test URLs (?simhook, ?autodrive, ?car=, ?s=, ?event=, ?quick) skip the title menu; ?menu forces it
const SKIP_MENU = !Q.has('menu') && ['simhook', 'autodrive', 'car', 's', 'event', 'quick', 'fixeddt', 'turbo'].some((k) => Q.has(k));
function savedCar() { try { const i = CARS.findIndex((c) => c.id === localStorage.getItem('paraliaki.car')); return i >= 0 && inGarage(CARS[i]) ? i : 0; } catch { return 0; } } // a car since dropped from the garage falls back to the default
function initFlow() {
  let plate = driverName.plate();
  driverName.onChange(() => { const next = driverName.plate(); if (next !== plate) { plate = next; player?.model.setPlate(next); } });
  menu = new Menu($('ui'), {
    quickRace: () => openEvent('quick'), openEvent, multiplayer: () => multiplayer.open(), garage: openGarage, selectMap: selectMenuMap, switchMap,
    chooseCar: (index, def, garage) => {
      try { localStorage.setItem('paraliaki.car', CARS[index].id); } catch {}
      if (menu.data.inFreeRoam) { const onPick = menu.data.onPick; menu.back(); onPick?.(CARS[index].id); return; }
      if (garage) { if (player && world) setCar(index); else G.carIdx = G.selIdx = index; menu.back(); return; }
      if (!def) return;
      startEvent(def, { car: index });
    },
    openCarPicker, freeRoamCar: () => openCarPicker({ inFreeRoam: true, onPick: switchRoamCar }), roamConditions: openRoamConditions, roamLandmarks: openRoamLandmarks, roamTow: () => { resume(); tow(player.veh); },
    resume, restart: () => openEvent(G.ev.def), quit: quitToMenu, next: (id) => openEvent(id),
    ctx: menuCtx, inputDevice: activeInputDevice, carName: () => CARS[G.carIdx].name, carSpec: () => CARS[G.carIdx], manual: () => player?.veh.manual ?? settings.transmission === 'manual', fmtTime, ui: (fwd) => audio.ui?.(fwd),
    personalBests: (def, r, car) => getPersonalBests(bestSetup(def, r, car)), shareResult,
    bindings: (el) => controls.openBindings?.(el), cancelBindings: () => controls.cancelCapture?.(), graphicsControl,
  });
  onSettings(onFlowSettings); onFlowSettings(settings, null);
  // A police arrest holds you at the roadside; shaking them off wins an escape.
  EV.events.on('pursuit', (p) => {
    G.pursuit = p;
    if (G.state !== 'race' || !G.ev) return;
    if (multiplayer.active) { if (p.phase === 'busted') recoverFromCapture(); return; }
    if (p.phase === 'busted') recoverFromCapture();
    else if (p.phase === 'evaded' && G.ev.def.type === 'pursuit' && G.ev.def.rules?.goal === 'escape') finishRace('evaded');
  });
  EV.events.on('start', () => { G.pursuit = null; });
  // the leaderboard (multiplayer owner) gets every finished solo event
  import('./leaderboard.js').then((m) => { if (m?.submitResult) EV.events.on('finish', (r) => { try { m.submitResult(r); } catch (e) { console.warn(e); } }); }).catch(() => {});
}

function mapEvent(id) {
  if (id && typeof id === 'object') return ['sprint', 'free'].includes(id.type) ? id : null;
  const mapId = selectedMapId;
  if (id === 'free') return EV.freeRoam(mapId);
  const list = map?.id === mapId ? map.events || [] : [];
  if (id === 'quick') return mapId === 'riviera' ? quickMapEvent(mapId) : list.find(e => e.type === 'sprint') || quickMapEvent(mapId);
  const def = list.find(e => e.id === id) || EV.getEvent(id) || (getMap(mapId).eventIds?.includes(id) && quickMapEvent(mapId));
  return ['sprint', 'free'].includes(def?.type) ? def : null;
}

/** make an event (definition or id) the active one: route segment / direction, HUD range, arches, traffic direction */
function prepareEvent(e) {
  const def = mapEvent(e) || mapEvent('quick');
  const r = EV.resolve(def, evCtx());
  G.ev = { def, r }; G.dir = r.dir; startS = r.s0;
  traffic.dir = r.dir;
  hud.setRange(r.s0, r.s1);
  traffic.allowClosedRoam = def.type === 'free';
  markers.group.visible = def.type !== 'free' && !isDrivingMode(def);
  if (def.type !== 'free' && !isDrivingMode(def)) markers.build(r, { start: map.id === 'riviera' ? route.start : NaN, finish: map.id === 'riviera' ? route.finish : NaN });
  document.body.dataset.mode = def.type;
  // time of day / weather (the conditions system, when it is there)
  const sc = window.__setConditions, gc = window.__conditions;
  if (typeof sc === 'function' && typeof gc === 'function' && !multiplayer.active) {
    if (!G.baseCond) G.baseCond = gc(); // whatever the session started with (?tod= / ?wx=)
    const want = { ...G.baseCond, ...(def.conditions || {}) }, now = gc();
    if (want.time !== now.time || want.weather !== now.weather) { try { sc(want); } catch (err) { console.warn('[events] setConditions', err); } }
  }
  configureWorldLife(def, G.baseCond || window.__conditions());
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
    const spec = CARS.find((c) => c.id === (def.car || EV.driverCar(d, ids, player.spec.id))) || CARS[1];
    let c;
    if (i === 0) { // the first one is `rival`, the car the audio, the post blur mask and the online code know about
      disposeCar(rival); const built = makeCar(spec, false);
      rival = { spec, veh: rival.veh, ...built, ai: { lane: 0, cool: 0 } }; rival.veh.setSpec(spec); rival.veh.gear = 1; c = rival;
    } else c = { spec, veh: new Vehicle(spec, route), ...makeCar(spec, false), ai: { lane: 0, cool: 0 } };
    c.veh.ground = ground; c.drv = d; c.name = d.name; c.actor = { veh: c.veh, kind: 'rival', car: c };
    attachRivalFar(c);
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
  if (['aids', 'abs', 'steeringAssist', 'transmission'].includes(key) && G.state === 'race') G.bestSetupChanged = true;
  audio.setVolumes?.(s);
  if (key === 'transmission' && menu?.screen === 'settings') menu.refreshValues();
  if (key === 'aids' || key === 'abs') {
    if (player) applyVehicleAids(player.veh, player.spec, s);
  } else if (key === 'transmission' || !key) applyDriving();
  if (key === 'aids' || !key) {
    controls.setAidsEnabled(s.aids);
    if (!s.aids) G.lampTC = G.lampESC = 0;
    if (menu?.screen === 'settings') menu.refreshValues();
  }
  if (key === 'steeringAssist') syncSteeringAssist();
  if (key === 'units' && menu?.screen === 'events') menu.render();
}

// Direct simulation API: retained for automation and integrations; the menu calls openEvent.
let soloStart = 0;
async function startEvent(id, opts = {}) {
  if (multiplayer.active) { multiplayer.open(); return; }
  const token = ++soloStart;
  const def = mapEvent(id); if (!def) return;
  const car = def.car || opts.car;
  const idx = car == null ? G.carIdx : typeof car === 'number' ? clamp(Math.floor(car), 0, CARS.length - 1) : Math.max(0, CARS.findIndex(c => c.id === car));
  const mapId = def.mapId || selectedMapId;
  menu?.hide();
  try {
    await switchMap(mapId, def.type === 'free' ? 'FREE ROAM' : def.quick || def.id === 'quick' ? 'QUICK RACE' : def.name);
    if (token !== soloStart || multiplayer.active) return;
    G.pendingEvent = def; restart(idx);
  } catch (error) {
    console.error('[map] start failed', error); showTitle();
    ui.toast('COULD NOT LOAD THIS TRACK · PLEASE TRY AGAIN', { icon: 'warning', tone: 'bad' });
  }
}
function openEvent(id, index = G.carIdx) {
  if (multiplayer.active) { multiplayer.open(); return; }
  const def = mapEvent(id); if (!def) return;
  const idx = def.car ? Math.max(0, CARS.findIndex(c => c.id === def.car)) : index;
  // Keep the paused/result state so BACK from the picker restores a working menu.
  if (!['paused', 'results'].includes(G.state)) G.state = 'menu'; controls.clear();
  menu.show('car', { def, index: idx }, true);
}

// UI owner (opus-ui-overhaul-2055): window.__flow.openCarPicker({ inFreeRoam: true, onPick(carId) })
// reuses your car grid. Pause handlers: freeRoamCar, roamConditions, roamLandmarks, roamTow. Keep the paused session intact.
function openCarPicker({ inFreeRoam: roaming = false, onPick } = {}) {
  if (roaming && !inFreeRoam()) return;
  if (roaming && G.state === 'race') pauseGame();
  menu.show('car', { index: G.carIdx, garage: true, inFreeRoam: roaming, onPick }, true);
}
function switchRoamCar(carId) {
  if (!inFreeRoam()) return false;
  const idx = CARS.findIndex(c => c.id === carId); if (idx < 0) return false;
  const old = player.veh, pose = Object.fromEntries(['x', 'y', 'z', 'yaw', 's', 'u', 'vLong', 'vLat', 'w', 'grade', 'bank'].map(k => [k, old[k]]));
  const gear = old.gear, bodyPose = { ...old.pose };
  beginCameraBlend(); setCar(idx);
  // A replacement car is mechanically fresh; retain the exact location and motion, including on a side street.
  const v = player.veh; v.reset(pose.s, pose.u, pose.vLong); restoreVehicleState(v, pose); v.pose = bodyPose;
  v.gear = Math.max(1, Math.min(gear, v.spec.gears.length));
  v.rpm = clamp(Math.abs(v.vLong) / v.spec.wheelR * v.ratio() * 30 / Math.PI, v.spec.idle, v.spec.redline);
  syncCar(player, 0); updateCamera(0, true);
  G.run.car = carId; try { localStorage.setItem('paraliaki.car', carId); } catch {}
  return true;
}
function setRoamConditions(conditions) {
  if (!inFreeRoam()) return;
  const previous = window.__conditions();
  window.__setConditions(conditions); G.baseCond = window.__conditions();
  const hour = !conditions.time || conditions.time === previous.time ? previous.hour : undefined;
  configureWorldLife({ ...G.ev.def, conditions, hour }, G.baseCond);
  G.ev.def.conditions = { ...G.baseCond };
}
function teleportLandmark(id) {
  if (!inFreeRoam()) return false;
  const mark = map.data.marks.find(m => m.id === id); if (!mark) return false;
  beginCameraBlend(0.8); placeVeh(player.veh, mark.s, route.closed ? 0 : route.laneU(mark.s, 0), 1);
  resetTowOffer(); traffic.reset(mark.s); people.reset(mark.s); syncCar(player, 0); updateCamera(0, true);
  return true;
}
function openRoamConditions() { if (inFreeRoam()) menu.show('roamConditions', { conditions: window.__conditions() }, true); }
function openRoamLandmarks() { if (inFreeRoam()) menu.show('roamLandmarks', { landmarks: map.data.marks }, true); }

function pauseGame() {
  if (!['race', 'countdown', 'finished', 'onlineCountdown', 'onlineFinished', 'onlineWrecked'].includes(G.state)) { if (multiplayer.active) multiplayer.open(); return; }
  G.paused = { state: G.state, cam: G.cam, t: G.t, online: multiplayer.active };
  if (!multiplayer.active) G.state = 'paused'; closeTowOffer(TOW_PROMPT_COOLDOWN); controls.clear();
  const d = G.ev.def;
  menu.show('pause', { online: multiplayer.active, def: d, r: G.ev.r, mapName: map.definition?.name, inFreeRoam: inFreeRoam(), sub: inFreeRoam() ? 'DRIVE ANYWHERE · NO CLOCK' : G.paused.state === 'countdown' ? 'ON THE GRID' : `TIME ${fmtTime(G.raceT + G.pen)}` });
}
function resume() {
  if (!G.paused && !(multiplayer.active && menu?.open)) return;
  menu.hide(); if (G.paused && !G.paused.online) G.state = G.paused.state; if (G.paused) G.cam = G.paused.cam; G.countWall = performance.now(); G.paused = null; G.cameraStarting = false; controls.requestMouseLock();
}
function openSettings() {
  if (['race', 'countdown', 'finished', 'onlineCountdown', 'onlineFinished', 'onlineWrecked'].includes(G.state) && !G.paused) pauseGame();
  menu.show('settings', { from: menu.screen || 'pause', tab: 'audio' }, true);
}

function quitToMenu(screen = 'title') {
  if (multiplayer.active) return;
  soloStart++;
  if (!world) { sessionTransitions.cancel(); showTitle(); return; }
  sessionTransitions.cancel();
  window.__ghostLap?.hideGhost();
  if (G.run && !G.run.done) G.run.abort('quit');
  // Stop simulation/input before the fade. A pending restart/tow cannot revive it.
  G.state = 'menu'; G.paused = null; G.cameraStarting = false; G.towing = false;
  G.pendingEvent = null; G.run = null; G.result = null; G.pursuit = null; G.shake = G.flash = 0;
  controls.clear(); resetTowOffer(); voices.reset(); playerVoices.reset(); policeVoice.reset(); humanVoices.reset(); police?.reset(false);
  hideGrid(); rival.model.root.visible = false;
  for (const c of [player, rival]) { c.veh.vLong = c.veh.vLat = c.veh.w = 0; c.veh.nitroOn = false; for (const zone of Object.keys(c.model.damage || {})) c.model.setDamage(zone, 0); }
  traffic.reset(player.veh.s);
  fx?.clearMarks(); hud.hideMenu(); hud.count('');
  clearTimeout(hud._mt); hud.el.msg.classList.remove('on'); hud.el.banner.classList.remove('show'); hud.el.pops.replaceChildren();
  $('evBox')?.classList.remove('on'); $('wrongWay')?.classList.remove('on');
  document.body.classList.remove('racing', 'counting', 'started', 'circuit-race');
  audio.menuRequested = true; audio.syncMenu(); audio.cancelIgnition?.();
  G.cam = 'orbit'; applyCamMode(); G.orbitA = 0.4; updateCamera(0, true); post.resetHistory?.();
  // The static menu backdrop keeps idle menus free of world rendering work.
  document.body.classList.add('menu-backdrop');
  document.body.classList.add('fading');
  sessionTransitions.after(260, () => {
    menu.show(screen === 'events' ? 'events' : 'title');
    document.body.classList.remove('fading');
  });
}
function showTitle() {
  document.body.classList.add('menu-backdrop');
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
  if (!menu || G.state === 'loading' && !menu.open && multiplayer.panel.hidden) return false;
  if (ui.action(name)) return true; // an open prompt / dropdown (src/ui/components.js) takes the input first
  if (!multiplayer.panel.hidden) return window.__lobbyUiAction?.(name) ?? true;
  if (name === 'garage' && G.state === 'menu' && (menu.screen === 'title' || menu.screen === 'events')) { audio.ui(true); openGarage(); return true; }
  if (name === 'transmission') {
    setSetting('transmission', settings.transmission === 'manual' ? 'auto' : 'manual');
    controls.toast(settings.transmission === 'manual' ? 'MANUAL' : 'AUTOMATIC', { id: 'gearbox-mode', ms: 1400 }); return true;
  }
  if (menu.open) return menu.action(name);
  if (MENU_STATES.includes(G.state)) return true;
  switch (name) {
    case 'camera': G.cam = G.cam === 'cockpit' ? 'chase' : 'cockpit'; G.userCam = G.cam; applyCamMode(); hud.message(G.cam === 'cockpit' ? '<i>COCKPIT</i> CAM' : '<i>CHASE</i> CAM', 1.2); return true;
    case 'tow': tow(player.veh); return true;
    case 'map': hud?.toggleBigMap(); return true;
    case 'tractionControl':
      if (G.state === 'race' || G.state === 'countdown' || G.state === 'onlineCountdown')
        toggleTractionControl({ toast: (text, options) => controls.toast(text, options) });
      return true;
    case 'reset': resetCar(); return true;
    case 'restart': if (G.state === 'race' || G.state === 'countdown' || G.state === 'finished') openEvent(G.ev.def); return true;
    case 'pause': pauseGame(); return true;
    case 'music': hud.message(audio.toggleMusic() ? 'MUSIC <i>ON</i>' : 'MUSIC <i>OFF</i>', 1.2); return true;
    case 'nextTrack': audio.nextTrack(); return true;
    case 'garage': if (multiplayer.active) multiplayer.open(); else pauseGame(); return true; // the garage lives in the menus; mid-race G pauses
  }
  return false;
}
const inMenu = () => !!menu?.open || !multiplayer.panel.hidden || MENU_STATES.includes(G.state) || ui.modalOpen;
window.__flow = {
  shareResult,
  switchMap, get mapId() { return map?.id || null; }, get map() { return map; },
  action: flowAction, inMenu, prepareEvent, gridSlot, event: () => G.ev, startEvent, openEvent, quickRace: () => startEvent('quick'),
  pause: pauseGame, openOnlinePause: pauseGame, openSettings, resetCar, resume, quit: quitToMenu, hideGrid, freeRoamDef: () => EV.freeRoam(selectedMapId), drivingModeDef: mode => drivingModeDefinition(mode, selectedMapId), setTraffic: (mul) => { G.trafficMul = mul; traffic.disabled = !(mul > 0); }, restart: () => openEvent(G.ev.def), get state() { return G.state; }, get menu() { return menu; }, openCarPicker, switchRoamCar, setRoamConditions, teleportLandmark, landmarks: () => map.data.marks.map(m => ({ id: m.id, name: m.name })), inFreeRoam, get grid() { return grid; },
};
document.addEventListener('visibilitychange', () => { if (document.hidden && !multiplayer.active && (G.state === 'race' || G.state === 'countdown')) pauseGame(); });

/** a stop line crossed between two front-bumper positions, in either direction of travel */
function crossedDir(prev, now, dir) {
  if (dir > 0) return signals.crossed(prev, now);
  for (const j of signals.J) if (prev > j.sO && now <= j.sO) return j;
  return null;
}

// ---- the AI field, every step (offline only): equal physics, personalities, red lights, finishing
const aiField = []; // every racer, reused each step; each RivalAI skips its own car
function updateGrid(dt) {
  const len = G.ev.r.len;
  aiField.length = 0; aiField.push(player); for (const c of grid) aiField.push(c);
  for (const c of grid) {
    const v = c.veh;
    let pace = 1; // RivalAI applies each driver's pace and a mild gap-to-player band.
    if (c.finish !== null) pace = prog(v.s) > len + 120 ? 0 : 0.3;
    const rin = aiInput(c, dt, pace, aiField);
    if (pace === 0) { rin.throttle = 0; rin.brake = v.vLong > 1 ? 0.7 : 0; rin.handbrake = v.vLong <= 1; }
    c.lastBrake = rin.brake > 0.2;
    v.dragMul = 1 - 0.32 * (c.ai.controller?.draft || 0); // the same slipstream tow the player gets
    // Well away from the player (out of any close view) a rival integrates at 120 Hz instead of 240: half the cost,
    // within 0.3% on lap time (tools/ai-driving.test.mjs far-rival-substep).
    v.subH = Math.hypot(v.x - player.veh.x, v.z - player.veh.z) > 150 ? 1 / 120 : 0;
    v.update(dt, rin);
    if (v.spec.nitrous === true && !v.nitroOn) v.nitro = Math.min(1, v.nitro + dt * 0.012);
    // stop lines
    const f = v.s + G.dir * v.halfL;
    if (G.state === 'race' && c.front !== null && v.vLong > 0 && c.finish === null) { const j = crossedDir(c.front, f, G.dir); if (j) onStopLine(j, 'rival'); }
    c.front = c.front === null ? f : G.dir > 0 ? Math.max(c.front, f) : Math.min(c.front, f);
    c.ghost = false; // Traffic and collision rules apply throughout the race.
  }
}

// ---- timing, positions, splits, cameras, the finish (offline, state 'race')
function raceTiming(dt) {
  const pv = player.veh, run = G.run, r = G.ev.r, def = G.ev.def, pp = prog(pv.s);
  if (isDrivingMode(def)) {
    for (const e of run.update(dt, pv)) {
      if (e.kind === 'objective-pickup') {
        hud.message(def.type === 'taxi' ? 'PASSENGER ON BOARD · FOLLOW THE ROAD TO THE DESTINATION' : 'PICKUP COMPLETE · DRIVE TO THE ESCAPE DROPOFF', 3);
        if (def.type === 'getaway' && def.rules?.police === true && (def.rules?.laws ?? true) && police?.enabled) police.hm.begin(1);
      } else if (e.kind === 'objective-complete') hud.message(`${e.completed} ${def.type === 'taxi' ? 'FARES' : 'MISSIONS'} COMPLETED`, 3);
      else if (e.kind === 'timeup') { finishRace('timeup'); return; }
    }
    return;
  }
  const iP = Math.floor(pp / 10);
  if (iP >= 0 && iP < G.tP.length && isNaN(G.tP[iP])) for (let i = iP; i >= 0 && isNaN(G.tP[i]); i--) G.tP[i] = G.raceT;
  for (const c of grid) {
    const cp = prog(c.veh.s), iR = Math.floor(cp / 10);
    if (iR >= 0 && iR < c.tR.length && isNaN(c.tR[iR])) for (let i = iR; i >= 0 && isNaN(c.tR[i]); i--) c.tR[i] = G.raceT;
    if (c.finish === null && !EV.isWrecked(c.veh.maxImpactEbs) && cp >= r.len) { c.finish = G.raceT + c.pen; if (G.pFinish === null && !G.rivalBanner) { G.rivalBanner = true; hud.pop('info cyan', c.name + ' FINISHED'); } }
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
  for (const e of run.update(dt, { t: def.type === 'pursuit' && def.rules?.goal === 'survive' ? G.raceT : G.raceT + G.pen, s: pv.s, u: pv.u, x: pv.x, y: pv.y, z: pv.z, kmh: pv.kmh })) {
    if (e.kind === 'split' && !e.last) {
      const dl = e.delta;
      if (def.type === 'timetrial') hud.pop('split ' + (dl === null ? '' : dl <= 0 ? 'good' : 'bad'), e.name, fmtTime(e.time) + (dl === null ? '' : ` · ${dl <= 0 ? '−' : '+'}${Math.abs(dl).toFixed(2)}`));
    } else if (e.kind === 'finish') { G.pFinish = e.time ?? G.raceT + G.pen; G.raceT = G.pFinish - G.pen; finishRace(); return; }
    else if (e.kind === 'timeup') { finishRace('timeup'); return; }
  }
  // district banners, in the direction of travel
  const marks = G.marksDir;
  while (G.markIdx < marks.length && pp >= prog(marks[G.markIdx].s)) { const m = marks[G.markIdx++]; hud.banner(m.name, m.sub.toUpperCase()); }
}
function racePosition() {
  if (!grid.length) return 1;
  const me = { me: true, prog: prog(player.veh.s), finish: G.pFinish };
  const ranked = EV.rankRacers([me, ...grid.map((c) => ({ c, prog: prog(c.veh.s), finish: c.finish, dnf: !!(c.dnf || c.retired || EV.isWrecked(c.veh.maxImpactEbs) || c.veh.engineStalled || c.veh.drivetrainBroken) }))]);
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
  let gap = NaN, gapUnit = 's', who = null;
  if (G.pFinish !== null) { const f = grid.filter((c) => c.finish !== null).sort((a, b) => a.finish - b.finish)[0]; if (f) { gap = G.pFinish - f.finish; who = f; } }
  else if (ahead && pos > 1) { const c = ahead.c, t = c.tR[clamp(Math.floor(pp / 10), 0, c.tR.length - 1)]; gapUnit = Number.isFinite(t) ? 's' : 'm'; gap = gapUnit === 'm' ? ahead.d : G.raceT - t + G.pen - c.pen; who = c; }
  else if (behind) { const c = behind.c, t = G.tP[clamp(Math.floor(prog(c.veh.s) / 10), 0, G.tP.length - 1)]; gapUnit = Number.isFinite(t) ? 's' : 'm'; gap = gapUnit === 'm' ? behind.d : -(G.raceT - t) + G.pen - c.pen; who = c; }
  if (who && who !== G.gapWho) { G.gapWho = who; $('rivalName').textContent = who.name; }
  return { pos, gap, gapUnit };
}

/** how: 'finish' (crossed the line) | 'evaded' (shook the police in a pursuit-escape) | 'timeup' (survived a pursuit's
 *  clock) | 'busted' (caught) | 'wrecked' (100 km/h EBS impact); both are a DNF */
function finishRace(how = 'finish') {
  if (how === true) how = 'timeup';
  G.state = 'finished'; G.finishedT = 0; G.postT = 0;
  const run = G.run, def = G.ev.def, r = G.ev.r;
  const busted = how === 'busted', wrecked = how === 'wrecked', retired = how === 'retired', dnf = busted || wrecked || retired;
  if (how === 'timeup') G.pFinish = def.rules?.timeLimit || G.raceT;
  else if (how === 'evaded') G.pFinish = G.raceT + G.pen;
  if (dnf) G.pFinish = null;
  const pos = racePosition();
  const res = run.finish({ time: G.pFinish, position: wrecked || retired ? null : busted ? grid.length + 1 : pos, field: grid.length + 1, penalties: G.pen, carName: player.spec.name, topSpeed: G.topSpeed, crashes: G.crashes, busted, wrecked, retired, how, valid: !G.autodrive && !Q.has('s') && !dnf });
  G.result = res; rememberResult(res);
  G.won = !dnf && (isDrivingMode(def) ? res.completed > 0 : def.type === 'sprint' ? pos === 1 : !!res.medal);
  if (G.won) audio.win(); else audio.lose();
  hud.pop(G.won ? 'info good' : 'info bad', isDrivingMode(def) ? 'SESSION COMPLETE' : wrecked ? 'WRECKED' : busted ? 'BUSTED!' : how === 'evaded' ? 'LOST THEM!' : how === 'timeup' ? 'SURVIVED!' : def.type === 'sprint' ? (pos === 1 ? 'FINISH!' : 'P' + pos) : 'FINISH!', '');
  // the per-car best of the full route (garage card)
  if (G.pFinish !== null && !isDrivingMode(def) && def.type !== 'pursuit' && Math.round(r.s0) === Math.round(route.start) && Math.round(r.s1) === Math.round(route.finish)) {
    try { const key = 'paraliaki.best.' + player.spec.id; const prev = +localStorage.getItem(key) || 0;
    if (!prev || G.pFinish < prev) localStorage.setItem(key, G.pFinish.toFixed(3)); } catch {}
  }
  controls.clear(); controls.releaseMouseLook(); showResults();
}
/** results: straight time. Position, time, gap to the winner, event best, the classification and the splits */
function showResults() {
  G.state = 'results'; G.cam = 'orbit'; applyCamMode(); G.selIdx = G.carIdx;
  const res = G.result, def = G.ev.def, r = G.ev.r, run = G.run, prev = run.best || {};
  if (isDrivingMode(def)) { menu.show('results', { result: res, def, r, mapName: map.definition?.name, ...drivingModeResults(run, res, fmtTime) }); return; }
  // Rivals may finish during the post-race coast. Their actual penalized times decide the classification.
  if (def.type === 'sprint' && !res.busted && !res.wrecked) {
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
  const avgKmh = res.time ? (G.run?.maxProg || 0) / res.time * 3.6 : 0, avg = res.time ? fmtSpeed(avgKmh) : '—';
  // the vehicle keeps its own top speed too; a teleported test car never moves, so never show a top below the average
  const topKmh = Math.max(G.topSpeed || 0, player.veh.topSpeed || 0), top = topKmh >= avgKmh && topKmh > 0 ? fmtSpeed(topKmh) : '—';
  const kick = r.closed ? `${map.definition?.name || def.name} · ${r.laps} ${r.laps === 1 ? 'LAP' : 'LAPS'} · ${fmtDist(r.len)}` : `${def.name} · ${r.fromName} ${r.reverse ? '◀' : '▶'} ${r.toName} · ${fmtDist(r.len)}`;
  const splits = run.splits.map((t, i) => { const b = prev.bestSplits?.[i]; const cp = r.checkpoints[i]; return { name: cp.name, time: fmtTime(t), delta: b != null ? sign(t - b) : '', cls: b == null ? '' : t <= b ? 'good' : 'bad' }; });
  const best = res.record?.bestTime ?? prev.bestTime;
  const info = [['TOP SPEED', top], ['AVG SPEED', avg], ['CRASHES', G.crashes]];
  if (res.laps > 1 && res.bestLap != null) info.unshift(['BEST LAP', T(res.bestLap)]);
  let title, sub, rows, field = null;
  if (res.retired) {
    title = 'RETIRED'; sub = 'Did not finish.';
    rows = [['RESULT', 'DNF'], ['TIME', T(G.raceT + G.pen)], ['EVENT BEST', T(best)], ...info];
  } else if (res.wrecked) {
    title = 'WRECKED'; sub = 'Did not finish.';
    rows = [['RESULT', 'DNF'], ['TIME', T(G.raceT + G.pen)], ['EVENT BEST', T(best)], ...info];
  } else if (res.busted) {
    title = 'BUSTED'; sub = 'The ΕΛ.ΑΣ. got you. Did not finish.';
    rows = [['RESULT', 'DNF'], ['TIME', T(G.raceT + G.pen)], ['EVENT BEST', T(best)], ...info];
  } else if (def.type === 'sprint') {
    const pos = res.position;
    const winner = grid.filter((c) => c.finish !== null).sort((a, b) => a.finish - b.finish)[0];
    title = pos === 1 ? 'VICTORY' : `P${pos} OF ${res.field}`;
    const gap = pos === 1 ? (winner ? winner.finish - res.time : null) : winner ? res.time - winner.finish : null;
    sub = pos === 1 ? (gap != null ? `Won by <b>${gap.toFixed(2)} s</b>.` : '') : `<b>${gap != null ? gap.toFixed(2) : '?'} s</b> behind <b>${esc(winner?.name || '')}</b>.`;
    rows = [['POSITION', `P${pos} / ${res.field}`], ['YOUR TIME', T(res.time)], [pos === 1 ? 'MARGIN' : 'GAP TO WINNER', gap != null ? (pos === 1 ? '−' : '+') + gap.toFixed(2) + ' S' : '—'], ['EVENT BEST', T(best), res.newBest], ...info];
  } else {
    const d = prev.bestTime != null && res.time != null ? res.time - prev.bestTime : null;
    title = T(res.time);
    sub = def.type === 'pursuit' ? (res.how === 'timeup' ? 'Survived with the police on your tail.' : 'Lost the police.') : d === null ? 'First run on the board.' : d < 0 ? `New best by <b>${Math.abs(d).toFixed(2)} s</b>.` : `<b>${d.toFixed(2)} s</b> off your best.`;
    rows = [['YOUR TIME', T(res.time)], ['EVENT BEST', T(best), res.newBest], ...info];
  }
  if (def.type === 'sprint') {
    const all = [{ name: 'YOU', car: player.spec.short, finish: res.time, prog: prog(player.veh.s), me: true, dnf: !!(res.busted || res.wrecked || res.retired) }, ...grid.map(c => ({ name: c.name, car: c.spec.short, finish: c.finish, prog: prog(c.veh.s), dnf: !!(c.dnf || c.retired || EV.isWrecked(c.veh.maxImpactEbs) || c.veh.engineStalled || c.veh.drivetrainBroken) }))];
    // Finishers are ordered by time; a car a lap or more down on a circuit shows +N LAPS, others still driving RUNNING, retired DNF.
    const lapsDown = (f) => r.closed && r.lapLength ? Math.floor(Math.max(0, r.len - f.prog) / r.lapLength) : 0;
    field = EV.rankRacers(all).map((f, i) => ({ pos: i + 1, name: f.name, car: f.car, me: f.me, time: f.finish != null ? fmtTime(f.finish) : f.dnf ? 'DNF' : lapsDown(f) >= 1 ? `+${lapsDown(f)} ${lapsDown(f) === 1 ? 'LAP' : 'LAPS'}` : 'EST. ' + fmtTime(G.raceT + G.postT + Math.max(0, r.len - f.prog) / Math.max(5, f.prog / Math.max(1, G.raceT + G.postT))), running: f.finish == null && !f.dnf }));
  }
  if (field?.some(f => f.running)) sub += ' Rivals still racing · their positions and times are estimated.';
  const pb = res.personalBest;
  rows.push(['BEST · EXACT SETUP', T(pb?.exact?.time)], ['ROUTE BEST · ANY CAR / SETUP', T(pb?.route?.time)]);
  const payload = { result: res, def, r, kick, mapName: map.definition?.name, title, sub, win: G.won, rows, splits: def.type === 'pursuit' ? null : splits, field, next: null };
  if (menu.screen === 'results') { menu.data = payload; menu.refresh(); } else menu.show('results', payload);
}
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** event HUD: the wrong-way warning, and the survive clock in pursuit-survive (offline) */
function updateEventHud(dt) {
  const box = $('evBox'), ww = $('wrongWay');
  if (!box || !G.ev || multiplayer.active) return;
  const pv = player.veh, run = G.run, def = G.ev.def;
  if (inFreeRoam()) { box.classList.remove('on'); notifications.dismiss('wrong-way'); return; }
  if (isDrivingMode(def)) {
    notifications.dismiss('wrong-way');
    const html = run ? drivingModeHud(run.objective, run.routes, pv) : '';
    objectiveNotice(run?.objective,run?.routes,pv);
    if (html !== G.evHtml) { G.evHtml = html; box.innerHTML = html; box.classList.toggle('on', !!html); }
    return;
  }
  objectiveNotice(null,[],pv);
  // wrong way: nose against the event's direction of travel
  const hd = Math.atan2(-route.lin(route.TX, pv.s), -route.lin(route.TZ, pv.s)) + (G.dir < 0 ? Math.PI : 0);
  // only once racing (never on the grid or in the countdown), and the HUD class is forced, never toggled
  const wrong = G.state === 'race' && G.raceT > 1 && !!EV.wrongWay(G.wrong, dt, Math.cos(pv.yaw - hd), pv.vLong);
  G.wrongShown = wrong;
  if(wrong)notifications.banner('wrong-way','WRONG WAY','TURN BACK SAFELY · FOLLOW THE ROAD',{priority:85,tone:'bad',persistent:true});
  else notifications.dismiss('wrong-way');
  if ((frameN & 3) !== 0 || !run) return;
  const left = run.timeLeft();
  const html = def.type === 'pursuit' && isFinite(left) ? `<div class="e-k">SURVIVE</div><b class="${left < 10 ? 'good' : ''}">${Math.max(0, left).toFixed(1)}</b>` : '';
  if (html !== G.evHtml) { G.evHtml = html; box.innerHTML = html; box.classList.toggle('on', !!html); }
}

// ------------------------------------------------------------------ rival AI
// What every AI driver steers around, gathered once per step into reused records.
const aiObs = [], aiObsPool = [];
let aiObsT = NaN;
function aiObstacles() {
  if (aiObsT === G.t) return aiObs;
  aiObsT = G.t; aiObs.length = 0;
  let n = 0;
  const rec = (s, u, hs, hu, a) => { const o = aiObsPool[n] || (aiObsPool[n] = {}); n++; o.s = s; o.u = u; o.hs = hs; o.hu = hu; o.vs = 0; o.a = a; aiObs.push(o); };
  for (const c of traffic.cars) aiObs.push(c);
  for (const p of people.onRoad) rec(p.s, p.u, 0.6, 0.5, p);
  for (const s of traffic.sites) rec(s.s, s.u, s.len / 2, s.wid / 2, s);
  return aiObs;
}
function aiInput(car, dt, pace, other) {
  const ai = car.ai, veh = car.veh;
  if (!ai.controller || ai.controller.route !== route || ai.controller.spec !== veh.spec || ai.controller.dir !== (car.dir || 1)) {
    Object.defineProperty(ai, 'controller', { configurable: true, writable: true, value: new RivalAI(route, veh, { driver: car.drv, dir: car.dir || 1, perfect: car === player, closedRoad: G.ev?.def.traffic === 0 }) });
  }
  const obstacles = aiObstacles();
  // AI owner: capability API now reports live wet grip. Refresh cached braking/corner profiles as it changes.
  const grip = veh.maxLatAccel(25);
  if (ai.wetGrip === undefined) ai.wetGrip = grip;
  if (Math.abs(grip / ai.wetGrip - 1) > .025) {
    ai.controller.profile = ai.controller.line.speedProfile(veh); ai.controller.alternateProfiles?.clear(); ai.wetGrip = grip;
  }
  const result = ai.controller.update(dt, { racers: Array.isArray(other) ? other : other ? [other] : [], traffic: obstacles,
    signals: route.closed ? null : signals, pace: pace * wetPlanningPace(), closeRacing: Q.has('closeracing'), gapToPlayer: (veh.s - player.veh.s) * (car.dir || 1) });
  ai.dbg = ai.controller.debug; ai.u = ai.dbg.u ?? veh.u; ai.revT = ai.dbg.phase === 'reverse' ? 1 : 0;
  return result;
}

function onStopLine(j, who) {
  if (!lawsEnabled() || !(j.main === 'R' && j.redT > RED_GRACE && j.toGreen > RED_GRACE)) return;
  if (who === 'rival') { people.redRun(j); return; }
  // Only a unit that actually sees the crossing reacts (a warning, or more): nothing is ever fined.
  const st = { s: player.veh.s, u: player.veh.u };
  if (police.witnesses(st)) { police.witnessedRed(st); people.redRun(j); }
}

function handleHonk(h) {
  if (multiplayer.active) return;
  const c = h.c;
  if (h.player && ['cutoff', 'blocking', 'shaken', 'angry'].includes(h.reason)) driverVoice(c);
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
    if (G.state !== 'race') continue;
    if (!multiplayer.active && e.who === 'player') humanVoices.offer(e);
    if (e.kind === 'hit' && e.who === 'player') {
      G.shake = Math.max(G.shake, .28 + Math.min(.45, e.sev / 45));
      player.driver.impulse(.35 + Math.min(.5, e.sev / 40), 0, .3);
      controls.rumble(.35, .5, 180);
    }
    if (e.kind === 'dive' && e.who === 'player') { G.scared++; hud.pop('info bad', 'WATCH THE PAVEMENT!'); }

  }
  people.events.length = 0;
}

// ------------------------------------------------------------------ per-frame helpers
function syncCar(c, dt) {
  const v = c.veh;
  v.place(c.model.root);
  // Offline rivals: far level beyond ~60 m (hysteresis 55/62), no shadow casting beyond ~40 m.
  let far = false;
  if (c.far && multiplayer.active && (c.farOn || c.shadowsOff)) { // the online code reuses `rival`: back to the full model
    c.farOn = c.shadowsOff = false; for (const ch of c.model.root.children) ch.visible = true; c.far.root.visible = false; for (const o of c.casters) o.castShadow = true;
  }
  if (c.far && !multiplayer.active) {
    const distance = camera.position.distanceTo(c.model.root.position);
    far = c.model.root.visible && distance > (c.farOn ? 55 : 62);
    if (far !== c.farOn) { c.farOn = far; for (const ch of c.model.root.children) ch.visible = !far; c.far.root.visible = far; }
    if (far) { c.far.root.position.copy(c.model.root.position); c.far.root.quaternion.copy(c.model.root.quaternion); }
    else if (!c.model.root.visible) c.far.root.visible = false;
    const shadowsOff = distance > (c.shadowsOff ? 36 : 42);
    if (shadowsOff !== c.shadowsOff) { c.shadowsOff = shadowsOff; for (const o of c.casters) o.castShadow = !shadowsOff; }
  }
  c.model.steamAmount = multiplayer.active ? 0 : v.steamAmount || 0; c.model.wheelCamber = v.wheelCamber;
  if (!far) c.model.update(dt, v.vLong, v.steer, (c === player ? input.brake > 0.3 : c.lastBrake) || false, v.pose, v.corners || v.wheel, v.w);
  v.fxWheels = c.model.wheels; // Fx owns burnout tread deformation; the model keeps its normal wheel rig.
  if (c !== player) {
    const distance = camera.position.distanceTo(c.model.root.position);
    (c.model.detail ??= new DistanceDetail(c.model.root)).update(distance); // batch.js
    // rivals' and remote drivers' figures are behind tinted glass: not drawn beyond 60 m (20+ draws each)
    const d = c.driver, far = distance > (d?.lodFar ? 55 : 60);
    if (d?.root && far !== !!d.lodFar) {
      d.lodFar = far;
      for (const who of [d, d.passenger]) if (who?.root) { if (far) { who.lodWasVisible = who.root.visible; who.root.visible = false; } else who.root.visible = who.lodWasVisible ?? true; }
    }
  }
  const impact = v.lastDamage && v.lastDamage.serial !== c.damageSerial ? v.lastDamage : null;
  if (multiplayer.active) c.model.setDamageSnapshot?.(v.damage);
  else for (const zone of ['front', 'rear', 'left', 'right']) c.model.setDamage?.(zone, v.damage?.[zone] || 0, impact?.zone === zone ? impact : undefined);
  if (!multiplayer.active && impact?.kind === 'wall' && c === player && impact.ebs > 3.3 && G.t - (c.damageSoundT ?? -1) > .18) {
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
    if (['near', 'crash', 'bump'].includes(e.kind)) {
      if (e.who === 'player') {
        playerImpactVoice(e);
        driverVoice(e.car, e.kind === 'near' ? 'near' : 'driver', { cue: e.kind === 'near' ? undefined : impactVoiceCue(e) });
      }
      else if (e.who === 'rival' && Math.random() < .25) driverVoice(rc);
    }
    if (e.zone && e.dv > 0) {
      const hit = e.who === 'rival' ? rc : player;
      if (hit.veh.addDamage?.(e.zone, e.dv, e) > 0) {
        if (multiplayer.active) hit.model.setDamageSnapshot?.(hit.veh.damage);
        else hit.model.setDamage?.(e.zone, hit.veh.damage[e.zone], hit.veh.lastDamage);
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
      if (player.veh.spec.nitrous === true) player.veh.nitro = Math.min(1, player.veh.nitro + (e.oncoming ? 0.12 : 0.07));
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
        if (!multiplayer.active) audio.opa(1.1);
        hud.pop('opa', 'OPA!', '', (Math.random() - 0.5) * 10);
      } else hud.pop('info bad', e.car.type.bus ? 'BUS BUMP!' : 'BUMP!');
      if (!multiplayer.active && e.target !== 'rider' && Math.random() < 0.6) audio.horn(e.car.type.bus, 0.9, -e.side * 0.4, 0.25);
    } else if (e.kind === 'scrape') { audio.scrape(Math.min(1, e.sev / 4)); G.shake = Math.max(G.shake, 0.15); }
    else if (e.kind === 'cone') {
      G.cones++; audio.tone({ f: 380 + Math.random() * 200, slide: 900, dur: 0.18, gain: 0.08, type: 'triangle' }); audio.noise({ dur: 0.08, f: 1200, type: 'bandpass', gain: 0.12 });
    }
  }
}

// ------------------------------------------------------------------ audio feed
const _fr = {}, _av = new THREE.Vector3(), _aw = new THREE.Vector3(), _ar = new THREE.Vector3(), _ap = new THREE.Vector3();
const audioListener = { x: 0, z: 0, vx: 0, vz: 0, ready: false, camera: null };
function listenerRel(x, y, z, vx, vz) {
  return cameraRelativeSource(camera, audioListener, x, y, z, vx, vz);
}
function handleTrafficSounds() {
  if (multiplayer.active) { traffic.sounds.length = 0; return; }
  for (const e of traffic.sounds) {
    if (e.kind === 'rider-thrown') { humanVoices.offer(e); continue; }
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
  const voiceFrame = { enabled: ['race', 'onlineRace'].includes(G.state) || G.state === 'finished' && G.postT < 5, cockpit: G.cam === 'cockpit' && !player.spec.convertible, relative: voiceRelative };
  voices.update(voiceFrame); playerVoices.update(voiceFrame);
  if (!police?.enabled) policeVoice.reset();
  else if (voiceFrame.enabled) policeVoice.tick();
  if (voiceFrame.enabled) humanVoices.tick();
  if (G.state === 'race' && Math.abs(player.veh.vLong) > 3) for (const a of people.streetLife?.artists || []) {
    if (a.ped?.active && Math.hypot(a.ped.x - player.veh.x, a.ped.z - player.veh.z) < 7) pedestrianVoice(a.ped, 'artist');
  }
  if (!audio.ctx) return;
  syncAudioListener(audio.ctx, camera);
  const pv = player.veh, rv = rival.veh;
  const cp = camera.position, al = audioListener, moved = Math.hypot(cp.x - al.x, cp.z - al.z);
  const continuous = al.ready && al.camera === G.cam && dt > 0 && dt < 0.2 && moved < 15;
  al.vx = continuous ? clamp((cp.x - al.x) / dt, -120, 120) : 0;
  al.vz = continuous ? clamp((cp.z - al.z) / dt, -120, 120) : 0;
  al.x = cp.x; al.z = cp.z; al.ready = true; al.camera = G.cam;
  // where is the sea? (the shore side relative to the way the car is pointing)
  const seaR = route.seaR(pv.s), seaL = route.seaL(pv.s), seaD = Math.min(seaR, seaL);
  const shoreFrame = route.frame(pv.s, _fr);
  const seaPan = (seaR <= seaL ? 1 : -1) * 0.75 * cameraDirectionPan(camera, shoreFrame.rx, 0, shoreFrame.rz);
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
  const others = multiplayer.active ? [...remoteCars.entries()] : grid.map((c, i) => [`ai-${i}`, c]);
  const rivals = others.filter(([, c]) => c.model.root.visible).map(([id, c]) => {
    const v = c.veh, vel = v.velocityWorld(_av), rel = listenerRel(v.x, v.y, v.z, vel.x, vel.z);
    return { id, spec: c.spec, rpm: v.rpm, load: c.lastBrake ? -0.3 : multiplayer.active ? 0.4 : v.load, ...rel };
  });
  audio.update({
    dt, damage: pv.damage, rpm: pv.rpm, redline: pv.spec.redline, load: counting ? input.throttle * 0.9 - 0.1 : racing ? pv.load : Math.min(pv.load, 0.3), throttle: input.throttle,
    gear: pv.gear, gearRatio: pv.ratio(), shift: pv.shiftEvent, limiter: pv.limiter || (counting && pv.rpm > pv.spec.redline * 0.97), boost: pv.boost,
    wheels: pv.corners.map((w, i) => ({ ...w, vgx: pv._S?.[i]?.vgx ?? pv.vLong })), surfaces: pv.wheelSurf,
    nominalLoad: pv.m * 9.81 / 4, rivals,
    menuOpen: !['race', 'countdown', 'onlineRace', 'onlineCountdown', 'onlineSpectating'].includes(G.state),
    speed: Math.hypot(pv.vLong, pv.vLat), skid: pv.skid, wheelspin: pv.wheelspin, lockup: pv.lockup, bump: pv.bumpHit, rough: pv.rough, offroad: pv.offroad, nitro: pv.nitroOn, wb: pv.wb,
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
const camState = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: settings.cockpitFov, vel: new THREE.Vector3() };
// Raw mouse movement works without a click. Race/resume gestures request lock; cursor offset is the fallback.
const look = { yaw: 0, pitch: 0, targetYaw: 0, targetPitch: 0, yawV: 0, pitchV: 0, zoom: 1, idleT: 9, back: 0, backV: 0 };
const canLook = () => G.state === 'race' && !menu?.open && multiplayer.panel.hidden;
function moveLook(dx, dy, k = 0.0028) {
  look.targetYaw = clamp(look.targetYaw - dx * k * settings.mouseSensitivity, -Math.PI * 2 / 3, Math.PI * 2 / 3);
  look.targetPitch = clamp(look.targetPitch + dy * k * settings.mouseSensitivity * (settings.invertLookY ? -1 : 1), -0.55, 0.8);
  look.idleT = 0;
}
controls.mountMouseLook(canvas, { enabled: canLook, move: moveLook,
  position(x, y) { look.targetYaw = clamp(-x * Math.PI * 2 / 3 * settings.mouseSensitivity, -Math.PI * 2 / 3, Math.PI * 2 / 3); look.targetPitch = clamp(y * (y < 0 ? 0.55 : 0.8) * settings.mouseSensitivity * (settings.invertLookY ? -1 : 1), -0.55, 0.8); look.idleT = 0; },
  unlock() { if (G.state === 'race' && !towOffer.element) pauseGame(); },
});
canvas.addEventListener('contextmenu', e => { if (canLook()) e.preventDefault(); });
canvas.addEventListener('wheel', e => { if (!canLook() || G.cam !== 'chase') return; e.preventDefault(); look.zoom = clamp(look.zoom * Math.exp(e.deltaY * 0.0012), 0.55, 3); }, { passive: false });
// Exact critically damped spring update: stable across frame rates and shortest-path yaw wrapping.
function spring(state, key, velocity, target, omega, dt) {
  const delta = state[key] - target, c = (state[velocity] + omega * delta) * dt, decay = Math.exp(-omega * dt);
  state[key] = target + (delta + c) * decay; state[velocity] = (state[velocity] - omega * c) * decay;
}
function springPosition(target, dt, snap = false, omega = 10) {
  if (snap) { camState.pos.copy(target); camState.vel.set(0, 0, 0); return; }
  for (const axis of ['x', 'y', 'z']) {
    const delta = camState.pos[axis] - target[axis], w = axis === 'y' ? omega * 0.7 : omega;
    const c = (camState.vel[axis] + w * delta) * dt, decay = Math.exp(-w * dt);
    camState.pos[axis] = target[axis] + (delta + c) * decay; camState.vel[axis] = (camState.vel[axis] - w * c) * decay;
  }
}
function updateLook(dt) {
  if (!canLook()) {
    if (!G.cameraStarting && G.state !== 'countdown' && G.state !== 'onlineCountdown') controls.releaseMouseLook();
    return;
  }
  spring(look, 'back', 'backV', input.lookBack ? Math.PI : 0, 10, dt);
  const cl = controls.cameraLook;
  if (cl && (Math.abs(cl.x) > 0.01 || Math.abs(cl.y) > 0.01)) moveLook(cl.x * 2.6 * dt, cl.y * 1.6 * dt, 1);
  else look.idleT += dt;
  if (look.idleT > 1.5) { look.targetYaw = damp(look.targetYaw, 0, 5, dt); look.targetPitch = damp(look.targetPitch, 0, 5, dt); }
  spring(look, 'yaw', 'yawV', look.targetYaw, 14, dt); spring(look, 'pitch', 'pitchV', look.targetPitch, 14, dt);
}
const cameraBlend = { active: false, elapsed: 0, duration: 0.45, pos: new THREE.Vector3(), quat: new THREE.Quaternion(), trackPos: new THREE.Vector3(), trackRoot: null, fov: settings.cockpitFov };
function beginCameraBlend(duration = 0.45) {
  if (!G.cameraReady) return;
  Object.assign(cameraBlend, { active: true, elapsed: 0, duration, fov: camera.fov });
  cameraBlend.pos.copy(camera.position); cameraBlend.quat.copy(camera.quaternion);
  cameraBlend.trackRoot = player.model.root; cameraBlend.trackPos.copy(player.model.root.position);
  camState.retarget = true; post?.resetHistory?.();
}
const previousCameraQuat = new THREE.Quaternion(), cameraHeadPoint = new THREE.Vector3();
function finishCamera(dt, trackedRoot = player.model.root) {
  if (cameraBlend.active) {
    // Keep a moving car framed while easing between views. A reset/swap rebases the anchor without moving it.
    const delta = trackedRoot.position.clone().sub(cameraBlend.trackPos);
    if (dt > 0 && cameraBlend.trackRoot === trackedRoot && delta.lengthSq() < 625) cameraBlend.pos.add(delta);
    cameraBlend.trackRoot = trackedRoot; cameraBlend.trackPos.copy(trackedRoot.position);
    cameraBlend.elapsed += dt;
    const t = clamp(cameraBlend.elapsed / cameraBlend.duration, 0, 1), ease = t * t * t * (10 + t * (-15 + 6 * t)); // zero velocity and acceleration at each end
    camera.position.lerpVectors(cameraBlend.pos, camera.position.clone(), ease);
    camera.quaternion.slerpQuaternions(cameraBlend.quat, camera.quaternion.clone(), ease);
    camera.fov = lerp(cameraBlend.fov, camera.fov, ease);
    if (t >= 1) cameraBlend.active = false;
  }
  if (G.cam !== 'cockpit') ground?.constrainCamera?.(camera.position, trackedRoot.position);
  // Apply the same angular response through the blend boundary, avoiding a one-frame change in turn speed.
  if (G.cameraReady && dt > 0) {
    const angle = previousCameraQuat.angleTo(camera.quaternion);
    const alpha = Math.min(-Math.expm1(-20 * dt), angle > 1e-6 ? 4.5 * dt / angle : 1);
    camera.quaternion.slerpQuaternions(previousCameraQuat, camera.quaternion.clone(), alpha);
  }
  player.driver.head.getWorldPosition(cameraHeadPoint);
  player.driver.head.visible = G.cam !== 'cockpit' && camera.position.distanceTo(cameraHeadPoint) > .55;
  camera.updateProjectionMatrix(); G.cameraReady = true;
}
const _qForward = new THREE.Vector3();
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _m = new THREE.Matrix4();
function applyCamMode() {
  if (!player) return;
  if (camState.mode !== G.cam) { beginCameraBlend(); camState.mode = G.cam; }
  const cock = G.cam === 'cockpit';
  player.cockpit.setVisible(true); // The open cabins keep their dashboard in chase/garage views.
  player.driver.head.visible = !cock && !cameraBlend.active;
  camera.near = cock ? 0.05 : 0.25; camera.updateProjectionMatrix(); // as far out as the cabin allows: depth precision at range
}
function noise1(t) { return Math.sin(t * 1.7) * 0.5 + Math.sin(t * 3.1 + 1.3) * 0.3 + Math.sin(t * 7.3 + 0.7) * 0.2; }
function updateCamera(dt, snap = false) {
  // Menus retain the rendered view exactly; no look spring, blend, or terrain constraint advances.
  if (G.state === 'paused' || multiplayer.active && inMenu()) return;
  previousCameraQuat.copy(camera.quaternion);
  snap ||= !!camState.retarget; camState.retarget = false;
  const watching = multiplayer.spectating();
  const targetCar = watching && remoteCars.get(watching.id);
  if (targetCar?.model.root.visible) {
    if (G.cam !== 'spectate') { G.cam = 'spectate'; applyCamMode(); }
    if (G.spectateId && G.spectateId !== watching.id) beginCameraBlend();
    // MP owner: keep remote visual pose sampling before this view; follow model.root rather than packet positions.
    const v = targetCar.veh, visible = targetCar.model.root.position, back = 7;
    const behind = _v2.set(0, 0, 1).applyQuaternion(targetCar.model.root.quaternion);
    const target = _v1.copy(visible).addScaledVector(behind, back); target.y = visible.y + 2.8;
    const changed = G.spectateId !== watching.id; G.spectateId = watching.id;
    target.y = Math.max(target.y, route.surfaceY(v.s, v.u) + 0.6); springPosition(target, dt, snap || changed);
    camera.position.copy(camState.pos);
    camera.lookAt(visible.x, visible.y + 0.9, visible.z); camera.fov = settings.chaseFov; camera.updateProjectionMatrix();
    // Keep your driver's head and cockpit mirror out of the spectator view.
    finishCamera(dt, targetCar.model.root); return;
  }
  G.spectateId = null;
  if (G.cam === 'spectate') { G.cam = G.userCam; applyCamMode(); }
  const veh = player.veh, body = player.model.body, root = player.model.root;
  root.updateMatrixWorld(true);
  const kmh = veh.kmh, sk = clamp(kmh / 260, 0, 1.2);
  G.shake = Math.max(0, G.shake - dt * 1.8);
  const rough = (veh.offroad ? 0.6 : 0.06) * sk + G.shake * 0.9;
  const t = G.paused?.t ?? G.t;
  updateLook(dt);
  if (G.cam === 'cockpit') {
    const eye = player.cockpit.eye;
    _v1.set(eye.x - veh.ay * 0.0025, eye.y + 0.02 + noise1(t * 23) * 0.004 * rough, eye.z + clamp(veh.ax, -12, 12) * 0.0035);
    body.localToWorld(_v1);
    camera.position.copy(_v1);
    body.getWorldQuaternion(_q);
    const lookYaw = -player.veh.steer * 0.12 - veh.w * 0.04 + clamp(look.yaw, -2.2, 2.2) + look.back;
    _e.set(-0.045 - clamp(veh.ax, -12, 12) * 0.0012 - look.pitch * 0.8 + noise1(t * 31 + 5) * 0.004 * rough, lookYaw, noise1(t * 19 + 9) * 0.004 * rough + G.shake * Math.sin(t * 40) * 0.02, 'YXZ');
    camera.quaternion.copy(_q).multiply(_q.clone().setFromEuler(_e));
    // Mirror-fit is a model-inspection view; racing keeps the player's chosen vertical FOV.
    const baseFov = Q.has('mirrorfit') ? Math.max(settings.cockpitFov, player.cockpit.mirrorFov(camera.aspect)) : settings.cockpitFov;
    const fov = baseFov + (settings.speedFov ? Math.min(3, sk * 2 + (veh.nitroOn ? 1 : 0)) : 0);
    camState.fov = snap ? fov : damp(camState.fov, fov, 3, dt);
  } else if (G.cam === 'chase') {
    // behind the car, swung round by the free look: yaw about the car, pitch up / down, wheel zoom
    const back = 5.6 + sk * 1.2, up = 1.75 + sk * 0.15;
    const dist = Math.hypot(back, up) * look.zoom, el = clamp(Math.atan2(up, back) + look.pitch, -0.08, 1.35);
    if (snap || camState.followYaw === undefined) { camState.followYaw = veh.yaw; camState.followYawV = 0; }
    const yawTarget = camState.followYaw + Math.atan2(Math.sin(veh.yaw - camState.followYaw), Math.cos(veh.yaw - camState.followYaw));
    spring(camState, 'followYaw', 'followYawV', yawTarget, 12, dt);
    const hd = camState.followYaw + look.yaw + look.back, hx = Math.sin(hd), hz = Math.cos(hd); // forward is (-sin yaw, -cos yaw): behind is +
    const target = _v1.set(veh.x + hx * Math.cos(el) * dist, veh.y + Math.sin(el) * dist, veh.z + hz * Math.cos(el) * dist);
    // Follow translation directly; the spring damps the camera offset, keeping its distance natural at speed.
    if (!snap && camState.carX !== undefined) { camState.pos.x += veh.x - camState.carX; camState.pos.z += veh.z - camState.carZ; }
    target.y = Math.max(target.y, route.surfaceY(veh.s, veh.u) + 0.6);
    springPosition(target, dt, snap, look.idleT < 1.5 || look.back > 0.01 ? 16 : 10);
    camera.position.copy(camState.pos);
    // look ahead of the car when behind it; at the car itself once swung round to the side / front
    const ahead = 5 * Math.max(0, Math.cos(look.yaw + look.back)) * clamp(1 - look.pitch, 0, 1);
    const lk = _v2.set(veh.x, veh.y + 1.0, veh.z).addScaledVector(_qForward.set(-Math.sin(camState.followYaw), 0, -Math.cos(camState.followYaw)), ahead);
    camera.lookAt(lk);
    const fov = settings.chaseFov + (settings.speedFov ? Math.min(3, sk * 2 + (veh.nitroOn ? 1 : 0)) : 0);
    camState.fov = snap ? fov : damp(camState.fov, fov, 3, dt);
  } else { // orbit
    G.orbitA += dt * 0.25;
    const r = 6.8, a = G.orbitA + veh.yaw;
    const target = _v1.set(veh.x + Math.sin(a) * r, veh.y + 1.7, veh.z + Math.cos(a) * r);
    target.y = Math.max(target.y, route.surfaceY(veh.s, veh.u) + 0.6); springPosition(target, dt, snap, 8);
    camera.position.copy(camState.pos);
    camera.lookAt(veh.x, veh.y + 0.7, veh.z);
    camState.fov = damp(camState.fov, 50, 3, dt);
  }
  camState.carX = veh.x; camState.carZ = veh.z;
  camera.fov = camState.fov; finishCamera(dt);
  // debug view relative to the player car: ?view=right,up,back,lookAhead
  if (DBG_VIEW) {
    const f = veh.forward(_v2), rx = Math.cos(veh.yaw), rz = -Math.sin(veh.yaw);
    camera.position.set(veh.x + rx * DBG_VIEW[0] - f.x * DBG_VIEW[2], veh.y + DBG_VIEW[1], veh.z + rz * DBG_VIEW[0] - f.z * DBG_VIEW[2]);
    camera.lookAt(veh.x + f.x * DBG_VIEW[3] + rx * (DBG_VIEW[4] || 0), veh.y + (DBG_VIEW[5] ?? 1), veh.z + f.z * DBG_VIEW[3] + rz * (DBG_VIEW[4] || 0));
  }
}
const DBG_VIEW = Q.has('view') ? Q.get('view').split(',').map(Number) : null;

// ------------------------------------------------------------------ main loop
let last = 0, frameN = 0;
const events = [];
const ACTORS = [{ veh: null, kind: 'player' }, { veh: null, kind: 'rival' }];
const sunScreen = new THREE.Vector3();
function frame(now) {
  requestAnimationFrame(frame);
  // The hidden-online timer owns simulation until visibility returns. Ignore a queued older frame.
  if (multiplayer.active && (document.hidden || now < last)) return;
  // Frame rate limit (Settings > Graphics, default 60): skip vsync callbacks that arrive early, so a 120 Hz laptop
  // screen doesn't simulate and draw everything twice as often (heat, fan noise, battery).
  const cap = settings.frameCap;
  if (cap > 0 && !Q.has('fixeddt') && now >= last && now - last < 800 / cap) return;
  const wallDt = Math.max(0, (now - last) / 1000);
  let dt = Math.min(0.5, wallDt); last = now;
  if (Q.has('fixeddt')) dt = 1 / 60;
  G.lastDt = dt;
  G.fps = G.fps ? G.fps * 0.95 + 0.05 / Math.max(1e-3, (now - (G.lastNow || now - 16)) / 1000) : 60; G.lastNow = now;
  const reps = +(Q.get('turbo') || 1);
  const slices = Math.max(1, Math.ceil(dt / (1 / 60)));
  try { for (let i = 0; i < reps; i++) for (let j = 0; j < slices; j++) step(dt / slices, i === reps - 1 && j === slices - 1); } catch (e) { if (G.ctxLost || renderer.getContext().isContextLost()) return; fail(e); throw e; }
  if (splash) splash.update(dt);
  if (player) drivingHints.update({ state: G.state, device: activeInputDevice(), car: player.spec, manual: player.veh.manual, blocked: !!menu?.open || !multiplayer.panel.hidden });
  if (input.handbrake) drivingHints.action('handbrake');
  if (player) {
    const watching = multiplayer.spectating(), selectedDriverVehicle = watching ? remoteCars.get(watching.id)?.veh ?? null : player.veh;
    updateEngineHud(selectedDriverVehicle, { visible: ['race', 'onlineFinished', 'onlineWrecked'].includes(G.state) && !menu?.open && multiplayer.panel.hidden, spectating: !!watching, towLabel: bindingLabel(controls.bindings, 'tow', activeInputDevice()), repairAvailable: G.state === 'race' && !G.towing && !multiplayer.retired && !watching, towCost: inFreeRoam() ? 0 : 5, onRepair: () => tow(player.veh) });
    drivingFeedback.update({ vehicle: selectedDriverVehicle, route: selectedDriverVehicle?.route || route, dir: inFreeRoam() ? undefined : multiplayer.active ? multiplayer.lobby.event?.dir || 1 : G.dir || 1, visible: ['race', 'onlineFinished', 'onlineWrecked'].includes(G.state) && !menu?.open && multiplayer.panel.hidden && !G.towing, spectating: !!watching, driverName: watching?.name || '', units: settings.units, wetGrip: WEATHER.gripScale, endS: !inFreeRoam() && !route?.closed ? G.ev?.r.s1 : undefined });
  }
}

function step(dt, draw = true) {
  // A queued first frame can predate boot's clock reset. Integrators require a positive timestep.
  if (!(dt > 0) || mapSwitch) return;
  if (!world || !player || G.state === 'menu') { readInput(dt); return; }
  G.t += dt; frameN++;
  const bootFrameLog = text => { if (frameN === 1) tlog(text); };
  bootFrameLog('first-frame');
  readInput(dt);
  if (multiplayer.active && inMenu() && G.pFinish == null) { player.veh.vLong = player.veh.vLat = player.veh.w = 0; player.veh.syncWheels(); }
  if (multiplayer.active) multiplayer.update(dt, networkState(player.veh));
  if (!multiplayer.active && grid.length) rival = focusRival(); // the car the HUD gap, audio and slipstream follow
  const pv = player.veh, rv = rival.veh;
  ACTORS[0].veh = pv; ACTORS[1].veh = rv;
  const simulate = G.state !== 'menu' && G.state !== 'garage' && G.state !== 'loading' && G.state !== 'paused' && !(multiplayer.active && inMenu() && G.pFinish == null) && (multiplayer.active || multiplayer.panel.hidden);
  if (!multiplayer.active) tickWorldLife(dt, { running: simulate });
  if (simulate && !multiplayer.active) updateRoadWeather(dt);
  onlineWorldVisibility(multiplayer.active, { people, fx, splash }); setOnlineWeather(multiplayer.active);
  sharedWorld.update(dt);
  if (multiplayer.active && multiplayer.lobby.startAt) signals.t = (multiplayer.now() - multiplayer.lobby.startAt) / 1000 - dt;
  if (simulate || multiplayer.active) signals.update(dt, pv.s, camera.position);
  world?.tyreWalls?.update(simulate ? dt : 0, multiplayer.active);
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
      if (G.state === 'race' && !multiplayer.active && !inFreeRoam()) G.raceT += dt;
      // ---- player
      let pin = input;
      if (G.autodrive && !multiplayer.active && G.state === 'race') { player.ai = player.ai || { lane: 1, u: pv.u, cool: 0 }; pin = aiInput(player, dt, 0.95, grid); }
      if (G.state !== 'race') {
        const dir = G.ev?.r.dir || 1;
        const ahead = route.point(route.closed ? pv.s + dir * Math.max(8, Math.abs(pv.vLong)) : clamp(pv.s + dir * Math.max(8, Math.abs(pv.vLong)), 0, route.length), pv.u);
        const dx = ahead.x - pv.x, dz = ahead.z - pv.z, lat = dx * Math.cos(pv.yaw) - dz * Math.sin(pv.yaw);
        const lon = Math.max(1, -dx * Math.sin(pv.yaw) - dz * Math.cos(pv.yaw));
        pin = { throttle: 0, brake: Math.abs(pv.vLong) > 1 ? 0.8 : 0, steer: clamp(Math.atan(pv.wb * 2 * lat / (lon * lon + lat * lat)) / pv.lockAt(Math.abs(pv.vLong)), -1, 1), handbrake: Math.abs(pv.vLong) <= 1, nitro: false };
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
      const holdingRecovery = recoveryHeld(G.towing, towOffer);
      const recoveryPose = holdingRecovery ? { x: pv.x, z: pv.z, s: pv.s, u: pv.u, yaw: pv.yaw } : null;
      if (holdingRecovery) { pin = { throttle: 0, brake: 1, steer: 0, handbrake: true, nitro: false }; towOffer.hold = Math.max(0, towOffer.hold - dt); }
      pv.dragMul = 1 - 0.32 * (G.draft || 0);
      const snapP = Q.has('nantrap') ? JSON.stringify({ x: pv.x, z: pv.z, s: pv.s, u: pv.u, yaw: pv.yaw, vL: pv.vLong, vLat: pv.vLat, w: pv.w, pin, ai: player.ai }) : '';
      pv.update(dt, pin);
      if (inFreeRoam() && route.closed) pv.s = route.wrap(pv.s); // untimed traffic stays in the same lap coordinates
      // A recovery hold is a time cost even on a slope or with a held throttle; suspension still settles.
      if (recoveryPose) restoreVehicleState(pv, { ...recoveryPose, vLong: 0, vLat: 0, w: 0, lastV: 0 });
      if (Q.has('nantrap') && !G.nanP && !isFinite(pv.x + pv.vLong + pv.w + pv.s)) { G.nanP = 1; console.warn('NaN player after update', snapP); }
      seaCheck(pv, dt);
      stuckCheck(pv, dt);
      if (pv.spec.nitrous === true && !pv.nitroOn) pv.nitro = Math.min(1, pv.nitro + dt * 0.012);
      if (pv.nitroOn && !G.nitroWas) audio.nitroStart();
      G.nitroWas = pv.nitroOn;
      if (!multiplayer.active) {
      updateGrid(dt); // the AI field: racing lines, traffic, red lights (offline)
      }
      // ---- stop lines: camera or police witness, with optional game-time laws
      const D = G.dir || 1, pf = pv.s + D * pv.halfL, rf = rv.s + rv.halfL;
      if (G.state === 'race' && G.pFront !== null && pv.vLong > 0) { const j = crossedDir(G.pFront, pf, D); if (j) onStopLine(j, 'player'); }
      G.pFront = D > 0 ? Math.max(G.pFront ?? pf, pf) : Math.min(G.pFront ?? pf, pf); G.rFront = Math.max(G.rFront ?? rf, rf);
      // ---- traffic + collisions
      const actors = multiplayer.active ? [{ veh: pv, kind: 'player' }] : [{ veh: pv, kind: 'player' }, ...grid.map((c) => c.actor)];
      if (!multiplayer.active) traffic.update(dt, pv.s, actors);
      events.length = 0;
      if ((!multiplayer.active || multiplayer.lobby.traffic || police?.enabled) && !(G.autodrive && player.ai && player.ai.passT > 0)) traffic.collide(actors[0], events, G.t);
      // out of sight a rival is not held up by traffic (they know these roads); in sight they race for real (updateGrid)
      if (!multiplayer.active) for (const c of grid) if (!c.ghost) { const n0 = events.length; traffic.collide(c.actor, events, G.t); for (let k = n0; k < events.length; k++) events[k].racer = c; }
      if (!multiplayer.active) racerCollide(dt);
      else {
        multiplayer.contacts ||= new Map();
        const now = performance.now();
        multiplayer.lastContacts = G.state === 'race' && !holdingRecovery ? resolvePlayerContacts(pv, [...remoteCars].map(([id, car]) => {
          const peer = multiplayer.peers.get(id), member = multiplayer.lobby.players.find(p => p.id === id);
          return { id, vehicle: car.veh, age: peer ? now - peer.at : Infinity, ghost: !member?.loaded || member.connected === false || member.dnf || member.finish != null || !peer?.state || peer.state.recoveryUntil > multiplayer.now() };
        }), dt, now, multiplayer.contacts) : [];
        for (const hit of multiplayer.lastContacts) playerImpactVoice({ kind: 'crash', dv: hit.impulse });
        containOnlineVehicle(pv, route);
      }
      // Online the units are shared (src/mp-shared-world.js); this client judges only its own driver.
      if (police && multiplayer.active && police.enabled && !sharedWorld.authority) traffic.setRacers(actors);
      if (police) for (const e of police.update(dt, { events, racing: G.state === 'race', dir: G.dir || 1, eventId: G.run?.id })) onPolice(e);
      if (Q.has('nantrap') && !G.nanC && !isFinite(pv.x + pv.vLong + rv.x + rv.vLong)) { G.nanC = 1; console.warn('NaN after collisions', pv.s, rv.s); }
      if (G.state === 'race') handleEvents(events);
      for (const h of traffic.honks) handleHonk(h);
      traffic.honks.length = 0;
      handleTrafficSounds();
      if (pv.bumpHit > 0.1) G.shake = Math.max(G.shake, pv.bumpHit * 0.22);
      if (pv.wallHit > 2.5 && G.state === 'race') { playerImpactVoice({ kind: 'wall', dv: pv.wallHit }); audio.scrape(Math.min(1, pv.wallHit / 10)); G.shake = Math.max(G.shake, Math.min(0.6, pv.wallHit / 12)); if (pv.wallHit > 7) player.driver.impulse(0.4); }
      if (pv.wallHit > 3) { fx.sparks(pv, pv.wallHit / 12); controls.rumble(Math.min(1, pv.wallHit / 10), 0.6, 220); }
      if (!multiplayer.active) for (const c of grid) if (c.veh.wallHit > 3) fx.sparks(c.veh, c.veh.wallHit / 12);
      // kerb strikes: a thump (scrape when the tyre rubs along the face), a jolt through the camera
      if (pv.curbHit > 0.12 && G.t - (G.curbT || 0) > 0.08) { G.curbT = G.t; audio.curb(Math.min(1, pv.curbHit * (pv.curbScrape ? 0.7 : 1.2))); if (pv.curbScrape) audio.scrape(0.25); G.shake = Math.max(G.shake, pv.curbHit * 0.3); if (pv.curbHit > 0.5) player.driver.impulse(0.25); controls.rumble(pv.curbScrape ? 0.15 : 0.5 * pv.curbHit, pv.curbScrape ? 0.5 : 0.8 * pv.curbHit, pv.curbScrape ? 140 : 110); }
      pv.wallHit = 0; rv.wallHit = 0; for (const c of grid) c.veh.wallHit = 0;
      // ---- slipstream
      const dd = (rv.s - pv.s) * (G.dir || 1), du = Math.abs(rv.u - pv.u);
      const drafting = (!multiplayer.active || (remoteCars.size > 0 && rival.model.root.visible)) && dd > 4 && dd < 32 && du < 1.6 && pv.vLong > 22;
      G.draft = damp(G.draft || 0, drafting ? 1 - dd / 40 : 0, 3, dt);
      if (drafting && pv.spec.nitrous === true) pv.nitro = Math.min(1, pv.nitro + dt * 0.03);
      // ---- drift scoring
      if (pv.drift > 0.12 && pv.vLong > 14 && G.state === 'race') { G.driftAcc += dt * pv.vLong * pv.drift * 14; G.driftT = 0.7; }
      else if (G.driftT > 0) { G.driftT -= dt; if (G.driftT <= 0 && G.driftAcc > 60) { if (pv.spec.nitrous === true) pv.nitro = Math.min(1, pv.nitro + G.driftAcc / 2500); G.driftAcc = 0; /* a drift tops up the bottle; no points */ } else if (G.driftT <= 0) G.driftAcc = 0; }
      G.topSpeed = Math.max(G.topSpeed, pv.kmh);
      // Wrecks remain in the race: the driver can tow/repair and pay the recovery cost.
      // ---- timing, positions, finish
      if (G.state === 'race' && !multiplayer.active) {
        if (!inFreeRoam()) { window.__ghostLap?.tick(dt); raceTiming(dt); }
      } else if (G.state === 'finished') {
        G.postT += dt;
        for (const c of grid) if (c.finish === null && !EV.isWrecked(c.veh.maxImpactEbs) && prog(c.veh.s) >= G.ev.r.len) c.finish = G.raceT + G.postT + c.pen - (prog(c.veh.s) - G.ev.r.len) / Math.max(1, c.veh.vLong);
        G.finishedT += dt; G.raceT += 0; // clock stopped
        if (G.finishedT > 0.8 && G.cam !== 'orbit') { G.cam = 'orbit'; applyCamMode(); G.orbitA = 0.6; }
        if (G.finishedT > 2.6) showResults();
      } else if (G.state === 'results') {
        G.postT += dt;
        let changed = false;
        for (const c of grid) if (c.finish === null && !EV.isWrecked(c.veh.maxImpactEbs) && prog(c.veh.s) >= G.ev.r.len) { c.finish = G.raceT + G.postT + c.pen; changed = true; }
        if (changed && menu.screen === 'results') showResults();
      }
    }
  }
  // ---- people (they live on during the countdown too)
  if (simulate && !multiplayer.active) { people.update(dt, peopleS(pv.s), ACTORS, camera.position); police?.pedEvents(people.events); handlePeople(); }
  // ---- next traffic light: HUD, green-man ticker, nitro top-up while waiting at red
  {
    const nj = signals.next(pv.s + pv.halfL, 1);
    let info = null;
    if (nj && (G.state === 'race' || G.state === 'countdown')) {
      const d = nj.sF - (pv.s + pv.halfL);
      if (d < 230) {
        const wait = G.state === 'race' && nj.main !== 'G' && d < 40 && pv.kmh < 3;
        if (wait && pv.spec.nitrous === true) { pv.nitro = Math.min(1, pv.nitro + dt * 0.1); if (G.waitJ !== nj.i) { G.waitJ = nj.i; hud.message('RED LIGHT · <i>NITRO CHARGING</i> WHILE YOU WAIT', 2.5); } }
        info = { main: nj.main, d, wait, nitrous: pv.spec.nitrous === true, close: nj.main === 'R' && d < 80 && pv.kmh > 25 };
        if (nj.ped && d < 70) { G.tickT -= dt; if (G.tickT <= 0) { G.tickT = nj.pedLeft < 2.2 ? 0.22 : 0.55; audio.pedTick(nj.pedLeft < 2.2, 0.3); } }
      }
    }
    hud.signal(info);
  }
  bootFrameLog('frame-simulation');
  // ---- visuals
  syncCar(player, simulate ? dt : 0); if (multiplayer.active || !grid.length) syncCar(rival, simulate ? dt : 0); else for (const c of grid) syncCar(c, simulate ? dt : 0);
  if (!multiplayer.active) fx.update(simulate ? dt : 0, [pv, ...grid.map((c) => c.veh)], camera, innerHeight * pixelRatio);
  traffic.sync(pv.s);
  if (police) { police.sync(G.t); policeHud.update(dt); }
  const acc = { x: pv.ay, y: 0, z: -pv.ax };
  // the full cabin only where a camera can see it: cockpit, open tops, close orbit views and camera blends
  player.cockpit.setDetail(!(G.cam === 'chase' || G.cam === 'spectate') || !!player.spec.convertible || cameraBlend.active);
  player.cockpit.update(dt, { vehicle: pv, ignition: ['countdown', 'onlineCountdown', 'race'].includes(G.state), aidsOff: !settings.aids, lowBeam: !!ENV.COND_STATE.headlights, highBeam: !!pv.highBeam, indicator: pv.indicator, hazards: pv.hazards, handbrake: input.handbrake && G.state === 'race', manual: pv.manual, gearChangeEvent: pv.gearChangeEvent, steerInput: pv.steer / Math.max(0.05, pv.lockAt(Math.abs(pv.vLong))) * (0.55 + 0.45 * Math.min(1, pv.lockAt(Math.abs(pv.vLong)) / pv.spec.steer * 2.5)), rpm: pv.rpm, redline: pv.spec.redline, gear: pv.gear, gearLabel: pv.reverse ? 'R' : String(pv.gear), kmh: pv.kmh, nitrous: pv.spec.nitrous === true, nitro: pv.nitro, nitroOn: pv.nitroOn });
  player.driver.update(dt, G.t, pv.vLong, acc, player.cockpit.wheelInfo, pv.steer, pv.pose.heaveV);
  for (const c of !multiplayer.active && grid.length ? grid : [rival]) c.driver.update(dt, G.t, c.veh.vLong, { x: c.veh.ay, y: 0, z: -c.veh.ax }, null, c.veh.steer, 0);
  window.__ghostLap?.visual(dt);
  updateCamera(dt);
  updateRacerMarkers();
  if (towOffer.element) towOffer.element.hidden = G.state !== 'race' || !!menu?.open || !multiplayer.panel.hidden;
  // sun + shadows follow the action
  const fwd = _v2.set(0, 0, -1).applyQuaternion(player.model.root.quaternion);
  ENV.updateSun(sun, _v1.copy(player.model.root.position).addScaledVector(fwd, ENV.shadowRange() * 0.4));
  // crossings painted near us
  if (assets.asphalt && assets.crossings) {
    const u = assets.asphalt.userData.uniforms; let k = 0;
    for (const c of assets.crossings) { if (c > pv.s - (G.dir < 0 ? 900 : 120) && k < 16) u.uCross.value[k++] = c; }
    for (; k < 16; k++) u.uCross.value[k] = -9999;
    k = 0; for (const c of assets.stops || []) { if (c > pv.s - 120 && k < 8) u.uStop.value[k++] = c; }
    for (; k < 8; k++) u.uStop.value[k] = -9999;
  }
  ENV.U.time.value = multiplayer.active && multiplayer.lobby.startAt ? (multiplayer.now() - multiplayer.lobby.startAt) / 1000 : G.t;
  bootFrameLog('frame-visuals');
  // HUD
  let gap = NaN, pos = 1, gapUnit = 's';
  if (!multiplayer.active && G.ev && !inFreeRoam()) ({ gap, pos, gapUnit = 's' } = raceGap());
  updateEventHud(dt);
  G.shiftFlash = Math.max(0, (G.shiftFlash || 0) - dt);
  if (pv.shiftEvent) { G.shiftFlash = 0.25; }
  G.lampTC = pv.tcOn ? 0.35 : Math.max(0, (G.lampTC || 0) - dt); G.lampABS = pv.absOn ? 0.35 : Math.max(0, (G.lampABS || 0) - dt); G.lampESC = pv.escOn ? 0.35 : Math.max(0, (G.lampESC || 0) - dt);
  const st = { damageLabel: pv.engineStalled || pv.drivetrainBroken ? 'ENGINE STOP' : pv.coolantTemp >= ENGINE_HOT_C ? 'OVERHEATING' : pv.damageSignificant ? 'DAMAGE' : '', aidsOff: !settings.aids, tc: G.lampTC > 0, abs: G.lampABS > 0, esc: G.lampESC > 0, pos, time: G.pFinish ?? (G.raceT + G.pen), gap, pen: G.pen, junctions: signals.J, s: pv.s, rs: rv.s, rpm: pv.rpm, redline: pv.spec.redline, kmh: speedIn(pv.kmh), unit: speedUnit(),
    manual: pv.manual, limiter: pv.limiter, canUpshift: !pv.engineStalled && !(pv.engHealth <= 0) && !pv.reverse && pv.gear < pv.spec.gears.length && pv.shiftT <= 0,
    gearLabel: pv.reverse ? 'R' : (G.state === 'countdown' ? 'N' : String(pv.gear)), nitrous: pv.spec.nitrous === true, nitro: pv.nitro, nitroOn: pv.nitroOn, shiftFlash: G.shiftFlash, draft: G.draft || 0,
    x: pv.x, z: pv.z, yaw: pv.yaw, rx: rv.x, rz: rv.z, traffic: traffic.cars, limit: speedLimitAt(map, pv.x, pv.z, pv.s) };
  st.gapUnit = gapUnit;
  if (multiplayer.active) {
    const telemetry = multiplayer.telemetry(pv), watching = multiplayer.spectating(), selected = watching ? remoteCars.get(watching.id) : player;
    pos = telemetry?.pos ?? null; st.pos = pos; st.time = telemetry?.time ?? G.raceT; st.gap = telemetry?.gap ?? NaN; st.gapUnit = telemetry?.gapUnit || 'm'; st.pen = 0;
    if (telemetry?.comparison) $('rivalName').textContent = telemetry.comparison.name;
    if (watching) {
      const v = selected?.veh, spec = selected?.spec;
      Object.assign(st, { s: v?.s ?? telemetry?.state.s ?? multiplayer.lobby.event.s0, rpm: v?.rpm ?? 0, redline: spec?.redline ?? 7000, kmh: speedIn(v?.kmh ?? 0), gearLabel: v ? v.reverse ? 'R' : String(v.gear) : '—', x: v?.x ?? 0, z: v?.z ?? 0, yaw: v?.yaw ?? 0, nitrous: spec?.nitrous === true, nitro: v?.nitro ?? 0, nitroOn: false, tc: false, abs: false, esc: false, damageLabel: '', shiftFlash: 0, limiter: false, canUpshift: false, manual: v?.manual === true, limit: v ? speedLimitAt(map, v.x, v.z, v.s) : 0 });
    }
    st.remotes = [...remoteCars.values()].filter(c => c.model.root.visible).map(c => ({ x: c.veh.x, z: c.veh.z }));
    document.querySelector('#posBox .of').textContent = telemetry?.member.dnf ? '' : '/' + (multiplayer.lobby.results || multiplayer.lobby.players).length;
  }
  if (G.state === 'race' && G.raceT > 5) document.body.classList.add('started');
  document.body.classList.toggle('circuit-race', !!G.run?.r.closed && !multiplayer.active);
  st.objectiveMode = multiplayer.active ? isDrivingMode(multiplayer.lobby?.mode || multiplayer.lobby?.event?.type) : isDrivingMode(G.ev?.def);
  const objectiveDriver = multiplayer.active ? multiplayer.spectating?.() || multiplayer.me : null;
  st.objectiveTarget = st.objectiveMode ? drivingModeTarget(multiplayer.active ? objectiveDriver?.objective : G.run?.objective, multiplayer.active ? multiplayer.lobby.event?.objectiveRoutes : G.run?.routes) : null;
  hud.update(st);
  if (st.gapUnit) $('gap').textContent = !Number.isFinite(st.gap) ? '—' : `${st.gap >= 0 ? '+' : '−'}${Math.abs(st.gap).toFixed(st.gapUnit === 'm' ? 0 : 2)} ${st.gapUnit}`;
  for (const id of ['posBox', 'timeBox', 'gapBox', 'evBox']) { const el = $(id); if (el) { el.hidden = inFreeRoam(); el.style.display = inFreeRoam() ? 'none' : ''; } }
  if (inFreeRoam()) { $('tRace').textContent = '—'; $('posN').textContent = '—'; }
  if (multiplayer.retired && !multiplayer.spectating()) { $('posN').textContent = 'DNF'; $('posSuf').textContent = ''; $('tRace').textContent = '—'; }
  updateLapHud(G.run, !multiplayer.active && !isDrivingMode(G.ev?.def) && !MENU_STATES.includes(G.state));
  const onlineObjective = multiplayer.active && isDrivingMode(multiplayer.lobby?.mode || multiplayer.lobby?.event?.type);
  const watchedObjective = onlineObjective ? multiplayer.spectating?.() : null;
  const objective = onlineObjective ? (watchedObjective || multiplayer.me)?.objective : G.run?.objective;
  const objectiveRoutes = onlineObjective ? multiplayer.lobby.event?.objectiveRoutes : G.run?.routes;
  drivingModeView?.update(objective, objectiveRoutes, ['race', 'onlineFinished', 'onlineWrecked'].includes(G.state) && !menu?.open && multiplayer.panel.hidden);
  if (isDrivingMode(G.ev?.def) || onlineObjective) {
    for (const id of ['posBox', 'gapBox', 'timeBox']) { const el = $(id); if (el) { el.hidden = true; el.style.display = 'none'; } }
    if (onlineObjective) {
      const box = $('evBox'), selectedPose = watchedObjective ? remoteCars.get(watchedObjective.id)?.veh : pv;
      box.innerHTML = drivingModeHud(objective, objectiveRoutes || [], selectedPose); box.classList.toggle('on', !!objective); notifications.dismiss('wrong-way'); objectiveNotice(objective,objectiveRoutes||[],selectedPose);
    }
  }
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
  if (draw && (multiplayer.panel.hidden || G.resultPhotoPending)) render();
  bootFrameLog('frame-done');
}

// Build every material's program behind the loading screen. The main view draws into post's linear HDR target, never
// the sRGB canvas, and the output colour space is part of a program's key: compiled against the canvas, every material
// compiled a second time on its first appearance mid-race (traffic glass, buses: hitches near the Riviera tunnel).
async function compileScene() {
  const target = renderer.getRenderTarget();
  let done;
  try { renderer.setRenderTarget(post?.sceneRT ?? null); done = renderer.compileAsync(scene, camera); }
  catch (e) { /* older drivers: compile on first frame */ }
  finally { renderer.setRenderTarget(target); }
  try { await done; } catch (e) { /* compile on first frame */ }
}

// The shadow depth programs (instanced, skinned, alpha-tested...) compile at load instead of as a hitch when a new kind
// of caster first enters the shadow range (compileAsync never builds them): one shadow pass over every caster on the
// map, the distance-hidden ones included, into a 1×1 map with an empty main view (compile cost, no fill).
function warmShadowPrograms() {
  const shadow = sun.shadow, cam = shadow.camera, saved = { left: cam.left, right: cam.right, top: cam.top, bottom: cam.bottom, near: cam.near, far: cam.far };
  const size = shadow.mapSize.clone(), rt = new THREE.WebGLRenderTarget(1, 1), auto = renderer.shadowMap.autoUpdate, far = camera.far, hidden = [];
  scene.traverse(o => { if (!o.visible) { hidden.push(o); o.visible = true; } });
  shadow.mapSize.set(1, 1); shadow.map?.dispose(); shadow.map = null;
  Object.assign(cam, { left: -30000, right: 30000, top: 30000, bottom: -30000, near: -30000, far: 30000 }); cam.updateProjectionMatrix();
  camera.far = camera.near * 1.001; camera.updateProjectionMatrix(); // nothing in the main view: compileAsync built those programs
  // three draws the shadow map before it sets up the frame's lights, so depth programs are keyed by the light state of
  // the scene's previous render: none after the water reflection (its camera sees no lights), all of them otherwise.
  // Warm both: a render that sees no lights, then two shadow passes.
  try {
    renderer.setRenderTarget(rt);
    const mask = camera.layers.mask; camera.layers.mask = 0; renderer.render(scene, camera); camera.layers.mask = mask;
    renderer.shadowMap.autoUpdate = true; renderer.render(scene, camera); renderer.render(scene, camera);
  }
  catch (e) { console.warn('Shadow shader warm-up skipped:', e?.message || e); } // best effort: they compile on first use
  finally {
    for (const o of hidden) o.visible = false;
    camera.far = far; camera.updateProjectionMatrix();
    renderer.setRenderTarget(null); renderer.shadowMap.autoUpdate = auto; renderer.shadowMap.needsUpdate = true; rt.dispose();
    shadow.mapSize.copy(size); shadow.map?.dispose(); shadow.map = null; Object.assign(cam, saved); cam.updateProjectionMatrix();
  }
}

// reflection probe for the cars: one cube face per frame around the player, PMREM-filtered every full turn
function createProbe() {
  const rt = new THREE.WebGLCubeRenderTarget(128, { type: THREE.HalfFloatType, generateMipmaps: false });
  const cc = new THREE.CubeCamera(0.5, 320, rt);
  for (const c of cc.children) { c.layers.set(ENV.REFLECT_LAYER); c.layers.enable(ENV.PROBE_LAYER); }
  cc.coordinateSystem = renderer.coordinateSystem; cc.updateCoordinateSystem();
  const pmrem = new THREE.PMREMGenerator(renderer);
  // All inputs are 128px. Reusing a 256px seed's PMREM buffers for 128px scene faces corrupts the filter.
  ENV.fillSkyCube(renderer, rt);
  const envRT = pmrem.fromCubemap(rt.texture);
  const p = { rt, cc, pmrem, envRT, face: 0, invalid: false, reset() {
    ENV.fillSkyCube(renderer, rt); pmrem.fromCubemap(rt.texture, envRT); p.face = 0; p.invalid = false;
  } };
  for (const resource of [rt, rt.texture, envRT, envRT.texture]) resource.addEventListener('dispose', () => { p.invalid = true; });
  return p;
}
function updateProbe() {
  const p = probe;
  if (p.face === 0) { p.cc.position.copy(player.model.root.position); p.cc.position.y += 1.8; p.cc.updateMatrixWorld(true); }
  const prevA = renderer.shadowMap.autoUpdate, prevN = renderer.shadowMap.needsUpdate, target = renderer.getRenderTarget();
  renderer.shadowMap.autoUpdate = renderer.shadowMap.needsUpdate = false;
  try { renderer.setRenderTarget(p.rt, p.face); renderer.render(scene, p.cc.children[p.face]); }
  finally { renderer.setRenderTarget(target); renderer.shadowMap.autoUpdate = prevA; renderer.shadowMap.needsUpdate = prevN; }
  p.face = (p.face + 1) % 6;
  if (p.face === 0) p.pmrem.fromCubemap(p.rt.texture, p.envRT);
}

function render() {
  if (!world || mapSwitch || G.state === 'menu') return;
  if (G.ctxLost || renderer.getContext().isContextLost()) return;
  guardLighting();
  const photoCamera = G.resultPhotoPending ? { position: camera.position.clone(), quaternion: camera.quaternion.clone(), fov: camera.fov } : null;
  if (photoCamera) { const v = player.veh; camera.position.set(v.x + Math.cos(v.yaw) * 6 + Math.sin(v.yaw) * 5, v.y + 2.6, v.z - Math.sin(v.yaw) * 6 + Math.cos(v.yaw) * 5); camera.lookAt(v.x, v.y + .65, v.z); camera.fov = 55; camera.updateProjectionMatrix(); }
  renderer.info.autoReset = false; renderer.info.reset();
  ENV.updateWorldBlend(G.lastDt || 1 / 60);
  updateWeather(G.lastDt || 1 / 60);
  // Auxiliary views must never consume a pending main-view shadow update (mirrors hide the player).
  const L = GFX.L, E = GFX.E, shadowEnabled = !!L.shadow, pendingShadow = renderer.shadowMap.needsUpdate;
  renderer.shadowMap.enabled = false;
  if (L.probeEvery && frameN % L.probeEvery === 0) updateProbe();
  if ((frameN % 6) === 0 || camera.position.distanceToSquared(lodAt) > 1e4) updateLod(); // and at once after a teleport / reset
  sky.position.copy(camera.position);
  if (water && E.waterEvery && frameN % E.waterEvery === 0) water.renderReflection(renderer, scene, camera);
  // lower levels: shadow map every n-th frame (graphics.js). The shared rear view feeds the cockpit mirrors and the chase
  // camera's rear-view strip: lower effects levels only lower its resolution / refresh / range (cockpit.js MIRROR_TIERS),
  // only Settings > Mirrors turns it off
  const mirrorsOn = settings.mirrors !== false, rearStrip = mirrorsOn && G.cam === 'chase' && ['race', 'onlineRace'].includes(G.state);
  if (G.cam === 'cockpit' || rearStrip) player.cockpit.renderMirrors(renderer, scene, { enabled: mirrorsOn, quality: GFX.effects });
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
  renderer.shadowMap.enabled = shadowEnabled;
  renderer.shadowMap.autoUpdate = L.shadowEvery === 1;
  renderer.shadowMap.needsUpdate = pendingShadow || !sun.shadow.map || frameN % L.shadowEvery === 0; // drawn by the main pass (the mirrors hide our car)
  post.render(G.lastDt || 1 / 60);
  if (photoCamera) { G.resultPhoto = captureResultFrame(canvas); G.resultPhotoPending = false; camera.position.copy(photoCamera.position); camera.quaternion.copy(photoCamera.quaternion); camera.fov = photoCamera.fov; camera.updateProjectionMatrix(); }
  if (rearStrip) player.cockpit.drawRearStrip(renderer, { exposure: post.comp.uExposure.value, wb: post.u.uWB.value.toArray() });
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
const racerMarkers = new RacerMarkers();
const markerPoint = new THREE.Vector3(), markerView = new THREE.Vector3();
function updateRacerMarkers() {
  const visible = ['race', 'countdown', 'onlineCountdown'].includes(G.state) && !menu?.open && multiplayer.panel.hidden;
  const cars = !visible ? [] : multiplayer.active ? settings.playerMarkers ? [...remoteCars].map(([id, c]) => ({ id, c, name: c.networkName, player: true })) : [] : settings.rivalMarkers ? grid.map((c, i) => ({ id: 'ai-' + i, c, name: c.name, player: false })) : [];
  camera.updateMatrixWorld();
  racerMarkers.update(cars.filter(({ c }) => c.model.root.visible).map(({ id, c, name, player }) => {
    markerPoint.set(c.veh.x, c.veh.y + 2.4, c.veh.z);
    const distance = markerPoint.distanceTo(camera.position);
    markerView.copy(markerPoint).applyMatrix4(camera.matrixWorldInverse); markerPoint.project(camera);
    return { id, name, player, distance, x: markerPoint.x, y: markerPoint.y, behind: markerView.z >= 0, viewX: markerView.x, viewY: markerView.y };
  }));
}
const networkState = v => ({ ...Object.fromEntries(['x', 'y', 'z', 'yaw', 's', 'u', 'vLong', 'vLat', 'steer', 'rpm', 'gear', 'nitro', 'reverse'].map(k => [k, v[k]])), nitro: v.spec.nitrous === true ? v.nitro : 0, braking: input.brake > .3, damage: { ...v.damage }, ...spectatorState(v), paint: player.model.paintColor, driver: { ...player.driver.appearance }, pursuit: police?.online ? police.pursuitCode() : 0 });
function clearDriveInput() { controls.clear(); closeTowOffer(TOW_PROMPT_COOLDOWN); }
function onlineWait() {
  if (!world || !player || !multiplayer.loaded) return;
  document.body.classList.remove('menu-backdrop');
  clearDriveInput(); hud.hideMenu(); hud.count(''); G.state = 'lobby'; G.cam = G.userCam; applyCamMode();
  G.trafficMul = 0; traffic.disabled = true; resetRace(); rival.model.root.visible = false;
  document.body.classList.remove('racing', 'counting');
}
/** MP police: only the host's lobby setting turns them on; after onlineWait's resetRace. */
function startOnlinePolice(lobby) { police?.configureOnline(lobby, multiplayer.me?.gridSlot ?? 0); }
function onlineMembers(members) {
  if (!world || mapSwitch || !multiplayer.loaded) return;
  const ids = new Set(members.map(p => p.id));
  for (const [id, c] of remoteCars) if (!ids.has(id)) { if (c !== rival) disposeCar(c); else c.model.root.visible = false; remoteCars.delete(id); multiplayer.peers.delete(id); }
  for (const p of members) {
    let c = remoteCars.get(p.id);
    if (!c) {
      const spec = CARS.find(c => c.id === p.car) || CARS[0];
      if (![...remoteCars.values()].includes(rival)) { c = rival; c.spec = spec; c.veh.setSpec(spec); disposeCar(c); const built = makeCar(spec, false, p.plate); c.model = built.model; c.driver = built.driver; }
      else c = { spec, veh: new Vehicle(spec, route), ...makeCar(spec, false, p.plate) };
      c.ai = c.ai || { lane: 0, cool: 0 }; c.plate = p.plate || null;
      c.veh.reset(startS, route.laneU(startS, 0)); remoteCars.set(p.id, c);
    }
    if (c.spec.id !== p.car || c.plate !== (p.plate || null)) { const spec = CARS.find(s => s.id === p.car) || CARS[0]; disposeCar(c); const built = makeCar(spec, false, p.plate); c.model = built.model; c.driver = built.driver; c.spec = spec; c.plate = p.plate || null; c.veh.setSpec(spec); c.veh.reset(startS, route.laneU(startS, 0)); }
    if (p.paint && p.paint !== c.model.paintColor) setPaint(c.model, p.paint);
    if (p.driver) c.driver?.setAppearance?.(p.driver);
    c.networkName = p.name; c.model.root.visible = ['countdown', 'race'].includes(multiplayer.lobby.status);
  }
  const first = members[0];
  if (first && remoteCars.get(first.id) !== rival) { const old = rival; rival = remoteCars.get(first.id); if (![...remoteCars.values()].includes(old)) disposeCar(old); }
  $('rivalName').textContent = first?.name || 'WAITING';
}
const multiplayer = new Multiplayer(CARS, {
  appearance: () => player ? { paint: player.model.paintColor, driver: { ...player.driver.appearance } } : {},
  inputOverlayOpen: () => menu?.screen === 'car' && !!menu.data?.onPick,
  clearInput: clearDriveInput, carIndex: () => G.carIdx,
  async mapChanged(id) { await window.__flow.switchMap(id, multiplayer.lobby?.status === 'waiting' ? 'MULTIPLAYER LOBBY' : 'MULTIPLAYER RACE · RESUMING'); if (multiplayer.active) { setCar(Math.max(0, CARS.findIndex(c => c.id === multiplayer.me?.car))); onlineWait(); } else window.__flow.quit(); },
  panelClosed() { G.countWall = performance.now(); if (G.state === 'race') controls.requestMouseLock(); },
  join(car) { graphicsControl.disabled = false; graphicsControl.title = ''; if (world && !mapSwitch && multiplayer.loaded) { setCar(Math.max(0, CARS.findIndex(c => c.id === car))); onlineWait(); } },
  carChanged(car) {
    for (const c of remoteCars.values()) if (c !== rival) disposeCar(c); remoteCars.clear();
    if (world && !mapSwitch && multiplayer.loaded) { setCar(Math.max(0, CARS.findIndex(c => c.id === car))); onlineWait(); }
  },
  wait: onlineWait,
  leave() {
    graphicsControl.disabled = false; graphicsControl.title = '';
    for (const c of remoteCars.values()) if (c !== rival) disposeCar(c); remoteCars.clear();
    if (!world || mapSwitch || !multiplayer.loaded) { showTitle(); return; }
    traffic.disabled = Q.has('notraffic'); setCar(G.carIdx); quitToMenu();
  },
  members: onlineMembers,
  world(snapshot, age) { receiveWorldLife(snapshot, age); },
  sharedWorld(packet) { if (world && !mapSwitch && multiplayer.worldReady) sharedWorld.receive(packet); },
  start(lobby, id, resumeState = null) {
    if (!world || mapSwitch || !multiplayer.loaded) return;
    if (!resumeState) { applyDriving(); }
    beginCameraBlend();
    window.__flow?.prepareEvent({ ...lobby.event, id: lobby.eventId, from: lobby.event.s0, to: lobby.event.s1, traffic: lobby.config.traffic || 0, police: lobby.config.police === true, rules: { ...lobby.event.rules, police: lobby.config.police === true, policeLevel: lobby.config.policeLevel || 'normal', busted: lobby.config.busted !== false }, conditions: { time: lobby.config.time, weather: lobby.config.weather } });
    onlineWait(); G.bestSetup = bestSetup(); G.bestSetupChanged = false; G.result = null; G.resultPhoto = null; G.resultPhotoPending = false; onlineMembers(lobby.players.filter(p => p.id !== id));
    startOnlinePolice(lobby);
    configureWorldLife({ type: lobby.event?.type, conditions: { time: lobby.config.time, weather: lobby.config.weather } }, G.baseCond || window.__conditions());
    if (lobby.world?.raceId === lobby.raceId && lobby.world.generation === lobby.generation) receiveWorldLife(lobby.world.state, Math.max(0, (multiplayer.now() - lobby.world.at) / 1000));
    const grid = (v, i) => { const slot = window.__flow?.gridSlot(i); const s = slot?.s ?? startS - Math.floor(i / 2) * 8; v.reset(s, slot?.u ?? route.laneU(s, Math.min(i % 2, route.lanes(s) - 1)), 0); if (slot) v.yaw = slot.yaw; };
    grid(player.veh, lobby.players.find(p => p.id === id)?.gridSlot ?? lobby.players.findIndex(p => p.id === id)); resetTowOffer();
    for (let i = 0; i < lobby.players.length; i++) { const c = remoteCars.get(lobby.players[i].id); if (c) { grid(c.veh, lobby.players[i].gridSlot ?? i); syncCar(c, 0); } }
    if (resumeState) { const v = new Vehicle(player.veh.spec, route); v.ground = ground; v.reset(resumeState.s, resumeState.u, resumeState.vLong); restoreVehicleState(v, resumeState); if (v.spec.nitrous !== true) { v.nitro = 0; v.nitroOn = false; } v.damageFx(); v.syncWheels(); v.lastV = v.vLong; player.veh = v; }
    if (resumeState?.recoveryUntil > multiplayer.now()) { towOffer.recovering = true; towOffer.hold = (resumeState.recoveryUntil - multiplayer.now()) / 1000; }
    G.state = 'onlineCountdown'; G.cameraStarting = false; controls.requestMouseLock(); G.countShown = -1; G.cam = G.userCam; applyCamMode(); audio.restart(); updateCamera(0, true);
    document.body.classList.add('counting');
    multiplayer.resumeState = null;
    if (lobby.status === 'results') multiplayer.hooks.results();
  },
  remote(peers, dt) {
    for (const [id, c] of remoteCars) {
      const peer = peers.get(id); if (!peer) continue;
      const member = multiplayer.lobby.players.find(p => p.id === id);
      const p = applyRemotePose(peer, c.veh, performance.now(), member?.finish != null || !!member?.dnf), v = c.veh;
      applySpectatorState(v, p);
      if(p.paint && p.paint !== c.model.paintColor)setPaint(c.model,p.paint);
      if(p.driver)c.driver?.setAppearance?.(p.driver);
      c.lastBrake = p.braking === true; c.model.root.visible = member?.connected !== false || performance.now() - peer.at < 3000;
      syncCar(c, dt);
      c.driver?.update?.(dt,G.t,v.vLong,{x:v.ay||0,y:0,z:-(v.ax||0)},c.cockpit?.wheelInfo,v.steer||0,0);
    }
  },
  wrecked() {
    clearDriveInput(); G.pFinish = null;
    controls.releaseMouseLook();
    if (G.state !== 'onlineWrecked' && G.state !== 'onlineResults') hud.message('RETIRED · DNF · CHOOSE A DRIVER TO WATCH', 8);
    if (G.state !== 'onlineResults') G.state = 'onlineWrecked';
    hud.count('');
  },
  clock(elapsed, remaining) {
    if (!world || mapSwitch || !multiplayer.loaded) return;
    if (G.state === 'onlineCountdown') {
      const n = Math.ceil(remaining);
      if (n !== G.countShown) { G.countShown = n; hud.count(n > 0 ? String(n) : 'GO!', n === 0); audio.beep(n === 0); }
      if (remaining <= 0) { G.state = 'race'; document.body.classList.remove('counting'); document.body.classList.add('racing'); }
    }
    if (multiplayer.retired) multiplayer.hooks.wrecked();
    else if (multiplayer.me?.finish !== null && multiplayer.me?.finish !== undefined) {
      const firstFinish = G.pFinish === null;
      if (firstFinish) { hud.message('FINISH · <i>' + fmtTime(multiplayer.me.finish) + '</i> · WAITING FOR OTHER DRIVERS', 8); audio.beep(true); controls.releaseMouseLook(); }
      G.pFinish = multiplayer.me.finish; G.state = 'onlineFinished'; onlinePersonalResult();
      if (firstFinish) { multiplayer.panel.hidden = false; multiplayer.__screens?.schedule(); }
    }
    G.raceT = G.pFinish ?? elapsed;
  },
  results() {
    if (!world || mapSwitch) return;
    G.pFinish = multiplayer.me?.finish ?? null;
    G.raceT = G.pFinish ?? G.raceT; onlinePersonalResult();
    if (G.state !== 'onlineResults') { const won = G.pFinish !== null && multiplayer.ranking()[0]?.id === multiplayer.id; if (won) audio.win(); else audio.lose(); }
    G.state = 'onlineResults'; hud.count('');
    document.body.classList.remove('racing', 'counting');
  },
});
const sharedWorld = new SharedWorld(multiplayer, () => ({ traffic, player, G, remotes: [...remoteCars].map(([id, car]) => ({ id, car, member: multiplayer.lobby?.players.find(p => p.id === id) })) }));
window.__sharedWorld = sharedWorld;
window.__multiplayer = multiplayer;
// Browsers stop rAF in hidden tabs. Keep online cars coasting and broadcasting without drawing.
const onlineBackgroundTimer = setInterval(() => {
  if (!document.hidden || !multiplayer.active || !multiplayer.worldReady || multiplayer.lobby.status === 'waiting') return;
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
