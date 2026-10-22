import {RouteRuntime} from './route-runtime.js';
import {worldRecoveryTarget} from './world-recovery.js';
import {RouteRivals} from './route-rivals.js';
import {RouteClosures} from './route-closures.js';
import {WorldSignals} from './world-signals.js';
import {WorldTraffic} from './world-traffic.js';
import {RouteGuidance} from './route-guidance.js';
import {createLegacyGuidance} from './route-guidance/legacy.js';
import {createWorldSession} from './world-session.js';
import {loadUnifiedRoute,loadUnifiedRouteCatalogue} from './unified-routes.js';
import {routeEvent} from './route-events.js';
import {RouteNavigation,returnRoutePoints} from './route-navigation.js';
import {buildRouteGuidanceData} from './route-guidance-data.js';
import {projectEdge} from './route-geometry.js';
import {planWorldTow} from './tow-placement.js';
import {towHeading} from './tow-heading.js';
import { audioLatencyHint, audioLowCost } from './audio/robust.js';
import { PerfGovernor } from './perf-governor.js';
import { syncCameraVehicleView } from './camera-visibility.js';
import { soloStartPosition, raceGridSlot } from './start-placement.js';
import { seatPosition } from './seat-position.js';
import { CpuMetrics } from './cpu-metrics.js';
import { RenderScale } from './render-scale.js';
import { FrameLimiter, dynamicBudgetMs } from './frame-pacing.js';
import { scaleVehicleLod } from './vehicle-lod.js';
import { CHUNK_SCALE, mergeInstancedCells } from './batch.js';
import { importWithUpdate } from './client-release.js';
import { notifications } from './ui/notifications.js';
import { objectiveNotice } from './ui/objective-notice.js';
import { cameraRelativeSource, cameraDirectionPan, syncAudioListener } from './audio-listener.js';
// PARALIAKI: race a rival down the real Athens Riviera coast road, Vouliagmeni -> the lake -> Limanakia -> Varkiza -> Lomvarda.
// World built from OpenStreetMap data (see tools/). Menus boot without a world; direct race URLs load on demand.
import * as THREE from 'three';
import { loadMap, LANE_W } from './map.js';
import { getMap } from './map-catalog.js';
import { menuMapContext, quickMapEvent, initialMapId } from './menu-map.js';
import { waitForBootSession } from './boot-session.js';
import * as ENV from './env.js';
import { configureWorldLife, tickWorldLife, receiveWorldLife } from './world-life-runtime.js';
import { ROAD } from './road.js';
import { CARS, CarModel, setCarEnv, setPaint, catalogueTrafficTypes } from './cars.js';
import { normalizeDriverAppearance } from './driver-appearance-data.js';
import { ENGINE_HOT_C } from './driving-feedback-model.js';
import { inGarage, canonicalCarId, DEFAULT_CAR_ID } from './car-catalog.js';
import { shiftTransmission } from './transmission.js';
import { savedPaint } from './vehicle-paint.js';
import { Vehicle } from './physics.js';
import { RivalAI } from './rival-ai.js';
import {validateRivalPlan} from './rival-plan.js';
import { input as controls } from './input.js';
import { routeVel } from './traffic.js';
import { Police, pursuit } from './police.js';
import { PoliceHud } from './police-hud.js';
import { Cockpit, mirrorsInView } from './cockpit.js';
import {chaseRig} from './vehicle-camera.js';
import { createCameraViews, CAMERA_NAMES, chaseElevation } from './camera-views.js';
import {isRivalCar} from './car-catalog.js';
import { Hud, RacerMarkers, fmtTime } from './hud.js';
import { createHudSway } from './hud-sway.js';
import { PerfOverlay } from './perf-overlay.js';
import { Audio } from './audio.js';
import { VoiceReactions } from './voice.js';
import { PoliceVoice, impactVoiceCue } from './police-voice.js';
import { HumanVoiceEvents } from './human-voice.js';
import { RoadRageDetector } from './road-rage-voice.js';
import { assetMetrics, heapBytes, estimateSceneMemory, setAssetCodecMap } from './asset-metrics.js';
import { configureTextureCodecs } from './compressed-textures.js';
import { createPost } from './post.js';
import { loadTextures, uploadTextures, setAnisotropy } from './tex.js';
import { clamp, lerp, damp, smoothstep, frameYield, RNG } from './util.js';
import { resolveCarPair } from './crash-contact.js';
import { ContactCoordinator, containOnlineVehicle } from './multiplayer-contact.js';
import { applyBalance } from './mp-car-rules.js';
import { SharedWorld } from './mp-shared-world.js';
import { onlineWorldVisibility } from './mp-world-policy.js';
import { setOnlineWeather } from './weather.js';
import { Multiplayer } from './multiplayer.js';
import { applyRemotePose, remoteContactPose } from './remote-timeline.js';
import { personalBestSetup, getPersonalBests, recordPersonalBest, exactBestKey } from './personal-bests.js';
import { captureResultFrame, shareResultCard } from './result-share.js';
import { FinishSpectator } from './finish-spectate.js';
import { updateFinishSpectateHud } from './ui/finish-spectate.js';
import { spectatorState, applySpectatorState, restoreVehicleState } from './race-lifecycle.js';
import { DrivableCorridor, corridorRecovery } from './drivable-corridor.js';
import { buildCourse, observeCourse, courseProgress, courseComplete, courseTowLimits, towCourseTo } from './course.js';
import { routeTowAdapter } from './road-recovery.js';
import { planTow, RoadIndex } from './tow-placement.js';
import { DrivingFeedback } from './driving-feedback.js';
import { driverName } from './driver-name.js';
import * as EV from './events.js';
import { DrivingModeRun, drivingModeDefinition, isDrivingMode, drivingModeHud, drivingModeResults, drivingModeTarget } from './driving-modes.js';
import { DrivingModeView } from './driving-mode-view.js';
import { firstRunPerformanceCheck } from './ui/graphics-onboarding.js';
import { storedPerfCeiling } from './perf-ceiling.js';
import { Menu } from './menu.js';
import { updateLapHud } from './lap-hud.js';
import { settings, setSetting, onSettings, steeringAssistChoice, applySteeringAssist as applyVehicleSteeringAssist, fmtSpeed, fmtDist, speedIn, speedUnit, mirrorQuality } from './settings.js';
import { trackVersion } from './network-track.js';
import { initWeather, updateWeather, updateRoadWeather, disposeWeather } from './weather.js';
import { wetPlanningPace, WEATHER } from './wet-grip.js';
const buildMapWorld = async (...args) => (await importWithUpdate(() => import('./map-world.js'))).buildMapWorld(...args);
import { createBlackout } from './blackout.js';
import { SessionTransitions } from './session-transitions.js';
import { speedLimitAt } from './speed-limit.js';
import { updateSceneryLod, setDrawDistance, drawDistance } from './scenery.js';
import { FarCull, setFarFog } from './far-cull.js';
import { RENDER, resolveGraphics, dynamicFloor, outputRatio, applyRenderResolution, releaseSceneryVariants, trimShadowCasters } from './graphics.js';
import { DistanceDetail } from './batch.js';
import { PARKED_CELL, PARKED_RANGE, fleetModel } from './traffic-fleet.js';
import { initGhostLap } from './ghost-lap-mode.js';
import { loading, errorCode } from './ui/loading.js';
import { kbd, ui, icon } from './ui/components.js';
import { drivingHints } from './ui/driving-hints.js';
import { updateEngineHud } from './engine-hud.js';
import { gearboxMessage, bindingLabel } from './input-labels.js';
import { aidSpec, applyVehicleAids, toggleTractionControl } from './driving-aids.js';

import { towCondition, recoveryHeld, TOW_PROMPT_SECONDS, TOW_PROMPT_COOLDOWN } from './recovery-policy.js';
export let gameReady;
if(new URLSearchParams(location.search).get('map')==='athens'&&!new URLSearchParams(location.search).has('menu')&&new URLSearchParams(location.search).get('routes')!=='1'){
  gameReady=importWithUpdate(()=>import('./athens-world.js')).then(m=>m.bootAthens());
}else{
const recoveryStyle = document.createElement('link'); recoveryStyle.rel = 'stylesheet'; recoveryStyle.href = new URL('./recovery-prompt.css', import.meta.url).href; document.head.append(recoveryStyle);
const Q = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);
// Laws: a police unit that sees you run a red may warn or chase you. Nothing is ever fined.
const RED_GRACE = 0.3; // s at both ends of the red, as the signals' own amber/all-red margins
function lawsEnabled() { return police?.enabled === true && G.ev?.def.rules?.laws !== false; }
const RIVAL_NAME = 'STAVROS';
const RIVAL_BODY = { mini_jcw: 'z4', z4: 'mini_jcw', octavia_rs: 'mini_jcw' };

function fail(e) { console.error(e); const el = $('err'); el.style.display = 'block'; el.textContent = 'Error: ' + (e && e.message || e); }
window.addEventListener('error', (e) => fail(e.error || e.message));
const lstat = (t, f, detail) => {
  const pending = assetMetrics.maps[loading.mapId];
  // World preloading overlaps HUD/sky work. Keep the actual pending operation
  // visible when a builder announces its terrain milestone before awaiting it.
  loading.progress(t === 'BUILDING TERRAIN' && pending && !pending.loadMs ? pending.phase || t : t, f, detail);
};

// ------------------------------------------------------------------ renderer
const cpuMetrics = new CpuMetrics(Q.has('cpuProfile'));
window.__cpuMetrics = cpuMetrics;
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
configureTextureCodecs(renderer);
const gl = renderer.getContext(), gpuInfo = gl.getExtension('WEBGL_debug_renderer_info');
const gpuName = gpuInfo ? gl.getParameter(gpuInfo.UNMASKED_RENDERER_WEBGL) : '';
// first run only: a silent performance check picks the 'auto' resolution / draw distance (never the look)
await firstRunPerformanceCheck({ gpuName });
// ONE graphics look, hard-wired (graphics.js RENDER, owner-locked: docs/OWNER-DECISIONS.md). GFX only carries the
// performance side: resolution and draw ranges.
let GFX = resolveGraphics(settings, { deviceRatio: window.devicePixelRatio, gpuName });
const R = RENDER, sceneryQuality = R.scenery, lowGraphics = R.simple;
setAnisotropy(R.anisotropy);
window.__renderInfo = () => ({ gpu: gpuName, perfClass: GFX.perfClass, lowGraphics, pixelRatio, drawDistance: GFX.drawDistance, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures, fps: G.fps, renderScale: settings.renderScale });
// In-game performance readout (Settings > Graphics, or F3): fps, frame ms, draw calls. Refreshed at 2 Hz.
const perfOverlay = new PerfOverlay(() => ({ calls: renderer.info.render.calls, tris: renderer.info.render.triangles, scale: pixelRatio / Math.min(window.devicePixelRatio || 1, 2), limit: settings.frameCap }));
perfOverlay.setVisible(settings.perfOverlay === true);
onSettings((st, key) => { if (key === 'perfOverlay' || !key) perfOverlay.setVisible(st.perfOverlay === true); });
addEventListener('keydown', (e) => {
  if (e.code !== 'F3' || e.repeat || e.target.closest?.('input, select, textarea, [contenteditable]')) return;
  e.preventDefault(); setSetting('perfOverlay', !(settings.perfOverlay === true));
});
let pixelRatio = GFX.pixelRatio;
let dynamicScale = makeDynamicScale();
function makeDynamicScale() {
  return new RenderScale({ max: GFX.pixelRatio, min: dynamicFloor(GFX.perfClass, GFX.pixelRatio), budgetMs: dynamicBudgetMs(settings.frameCap) });
}
renderer.setPixelRatio(outputRatio(pixelRatio, window.devicePixelRatio));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping; // tone mapping happens in the post pipeline (post.js)
ENV.installAerial(ENV.AP_K); // aerial perspective replaces three's fog in every material
renderer.shadowMap.enabled = false; // no sun shadow maps in the one look (RENDER.shadow)
const scene = new THREE.Scene();
scene.matrixAutoUpdate = false; // never moves; its children update themselves (static world: batch.js freezeStatic)
const drivingFeedback = new DrivingFeedback({ scene, input: controls });
scene.fog = new THREE.FogExp2(new THREE.Color('#c3cdd6'), 0.00011); // only switches USE_FOG on; see ENV.installAerial
const camera = new THREE.PerspectiveCamera(settings.cockpitFov, innerWidth / innerHeight, 0.1, 90000);
renderer.terrainLodCamera = camera; // Auxiliary passes reuse the main view's terrain selection.
const audio = window.__bootAudio || new Audio();
// weaker performance classes get a larger output buffer and fewer simultaneous one-shot voices: continuous sound over reaction time
audio.latencyHint ||= audioLatencyHint(GFX.perfClass, navigator.hardwareConcurrency); if (!audio.ctx) audio.lowCost ??= audioLowCost(GFX.perfClass, navigator.hardwareConcurrency); audio.voiceLimit = GFX.perfClass === 'potato' || GFX.perfClass === 'low' ? 20 : 32;
const voices = new VoiceReactions(audio, { settings });
const playerVoices = new VoiceReactions(audio, { settings });
function carVoicePosition(c) {
  if (c.veh) return { x:c.veh.x, y:c.veh.y + 1.25, z:c.veh.z };
  const p = traffic.route.point(c.s,c.u,new THREE.Vector3()); p.y += 1.25; return p;
}
const policeVoice = new PoliceVoice(voices, carVoicePosition);
const humanVoices = new HumanVoiceEvents(voices, (s,u) => traffic.route.point(s,u,new THREE.Vector3()));
const roadRage = new RoadRageDetector(); let roadRageDt = 0;
function updateRoadRage(dt) {
  if (worldSession || G.state !== 'race' || G.paused) { roadRage.reset(); roadRageDt=0; return; }
  roadRageDt+=dt; if (roadRageDt<.1) return;
  const elapsed=roadRageDt;roadRageDt=0;
  const pv=player.veh, velocity=routeVel(pv,route), cars=[];
  for(const c of traffic?.cars||[]) if(c.active && !c.crash && Math.abs(c.s-pv.s)<45) {
    cars.push({speaker:c,s:c.s,u:c.u,vs:c.cross?c.xvs:c.dir*c.v,halfW:c.wid*.5,halfL:c.len*.5,mode:c.mode,cross:!!c.cross});
  }
  const rivals=multiplayer.active?remoteCars.values():grid;
  for(const c of rivals) if(c.model.root.visible && Math.abs(c.veh.s-pv.s)<45) {
    cars.push({speaker:c,s:c.veh.s,u:c.veh.u,vs:routeVel(c.veh,route).vs,halfW:c.veh.halfW,halfL:c.veh.halfL});
  }
  const anger=roadRage.update(elapsed,{s:pv.s,u:pv.u,vs:velocity.vs,halfW:pv.halfW,halfL:pv.halfL,direction:G.dir || 1},cars,input.brake);
  // Shared player channel refuses overlap and retains the crash per-driver cooldown.
  if(anger) playerBark('rage');
}
function playerBark(cue) {
  const appearance = normalizeDriverAppearance();
  return playerVoices.trigger('driver', player, () => carVoicePosition(player), { cue, gender: appearance.gender || 'male', older: appearance.old });
}
function playerImpactVoice(event) {
  const cue = impactVoiceCue(event); if (!cue || !player) return;
  return playerBark(cue);
}
const voicePoint = new THREE.Vector3(), voiceRotation = new THREE.Quaternion();
function voiceRelative(p) {
  const o=worldSession?.stream.origin;return voicePoint.set(p.x-(o?.x||0), p.y, p.z-(o?.z||0)).sub(camera.position).applyQuaternion(voiceRotation.copy(camera.quaternion).invert()).clone();
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

// ------------------------------------------------------------------ game state
const cameraViews = createCameraViews(['cockpit', 'chase', 'far', 'bumper'].includes(Q.get('cam')) ? Q.get('cam') : null);
const G = {
  state: 'loading', t: 0, raceT: 0, countT: 0, cam: cameraViews.current, userCam: cameraViews.current, carIdx: 0, selIdx: 0, menuFrom: null,
  crashes: 0, topSpeed: 0, pFinish: null, rFinish: null, lastLead: 0, leadT: 0,
  shake: 0, flash: 0, driftAcc: 0, driftT: 0, markIdx: 0, finishedT: 0, orbitA: 0, autodrive: Q.has('autodrive'),
};
canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); G.ctxLost = true; clearDriveInput(); });
canvas.addEventListener('webglcontextrestored', () => { G.ctxLost = false; lightingRecoveryPending = true; });
window.__game = G;
window.__voice = { voices, playerVoices, policeVoice, humanVoices, roadRage, playerImpactVoice, pedestrianVoice, driverVoice };
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
  applyRenderResolution,
  breakLighting() { scene.environment?.dispose(); scene.environment = null; sun.removeFromParent(); probe.envRT.dispose(); post.baseExposure = NaN; },
};

let ground = null, splash = null, fx = null, police = null, policeHud = null;
let drivingModeView = null;
let worldSession=null,routeNavigation=null,routeGuidance=null,guidanceData=null,pilotDriver=null,guidanceTilesOff=null,routeRivals=null,routeClosures=null;
let world = null, mapSwitch = null, lastMapDisposal = null;
const sessionTransitions = new SessionTransitions();
const blackout = createBlackout(() => { G.towing = false; });

const lodList = [];
const lodAt = new THREE.Vector3(1e9, 0, 0);
// Potato on Riviera (graphics.js PERFORMANCE.farCull): the static world beyond a distance is not drawn, and the fog ends it (far-cull.js). Render only.
const farCull = new FarCull(), farCullDistance = () => Q.has('farcull') ? +Q.get('farcull') || 0 : map?.id === 'riviera' ? GFX.farCull : 0; // Riviera only (the long coast road: ~100 calls of the far world; the other maps gain <3%). ?farcull=300 tries a distance on any class and map, ?farcull=0 turns it off
function updateLod() { updateSceneryLod(lodList, camera); farCull.update(camera, farCullDistance()); lodAt.copy(camera.position); }
// render distance (scenery.js): the setting applies live; traffic is drawn out to about half of it
setDrawDistance(+Q.get('draw') || GFX.drawDistance, R.horizon, GFX.detail);
// weaker performance classes cap traffic and pedestrian draw ranges (graphics.js PERFORMANCE); high keeps the full range
// The performance class's CPU budget: offline traffic density, pedestrian count, traffic AI rate, HUD redraw rates. Online the server
// owns the shared traffic, so only the HUD rates apply there.
const applyCpuBudget = () => { G.trafficTier = GFX.traffic; if (people) people.budgetMul = GFX.walkers; hud?.setRates(GFX.hud); };
// Weaker classes draw the instanced props in coarser chunks (batch.js mergeInstancedCells): fewer draw calls, same look.
PARKED_CELL.scale = GFX.chunkScale >= 3 ? 2 : 1; CHUNK_SCALE.value = GFX.chunkScale;
const consolidateWorld = (w) => { if (w && GFX.chunkScale > 1) mergeInstancedCells(w.group, 400 * GFX.chunkScale, { lod: w.lod }); };
const applyDrawDistance = () => { if (traffic) PARKED_RANGE.far = traffic.drawRange = Math.min(GFX.trafficDraw ?? Infinity, clamp(drawDistance() * 0.55, 220, 1150)); if (people) people.drawRadius = Math.min(GFX.crowd, Math.max(60, drawDistance() * 0.35)); };
const GRAPHICS_KEYS = new Set(['perfClass', 'renderScale', 'dynamicResolution', 'frameCap', 'drawDistance']);
/** re-resolve resolution / draw distance and apply them live (no reload, the world is kept); the look never changes */
function applyGraphics() {
  GFX = resolveGraphics(settings, { deviceRatio: window.devicePixelRatio, gpuName });
  for (const c of [...grid, ...remoteCars.values()]) if (c.model) scaleVehicleLod(c.model, GFX.vehicleLod, 40);
  dynamicScale = makeDynamicScale();
  if (GFX.pixelRatio !== pixelRatio) { pixelRatio = GFX.pixelRatio; onResize(); post?.resetHistory(); }
  setDrawDistance(+Q.get('draw') || GFX.drawDistance, R.horizon, GFX.detail); applyDrawDistance(); applyCpuBudget(); setFarFog(farCullDistance()); updateLod();
}
onSettings((s, key) => { if (GRAPHICS_KEYS.has(key)) applyGraphics(); });

let player = null, rival = null; // {veh, model, cockpit, spec}
const keys = controls.keys; // retained for the simulation test hook
const input = controls.state;

// ------------------------------------------------------------------ boot
const T0 = performance.now(); const tlog = (n) => { if (Q.has('debug')) console.log(n, Math.round(performance.now() - T0), 'abs', Math.round(performance.now())); };
async function boot() {
  G.carIdx = savedCar(); G.selIdx = G.carIdx;
  initFlow();
  // loaded means the app can respond to a lobby; mapId/version still gate the loaded/ready protocol.
  multiplayer.loaded = true;
  if (window.__bootMenu && menu.open) G.state = 'menu';
  else showTitle();
  last = performance.now(); requestAnimationFrame(frame);
  if(Q.get('routes')==='1'&&Q.has('menu')){await waitForBootSession(multiplayer);const catalogue=await loadUnifiedRouteCatalogue();menu.show('routes',{catalogue});document.body.classList.add('loaded');performance.mark('menu-ready');return;}
  if (SKIP_MENU && !multiplayer.pendingCode) await waitForBootSession(multiplayer);
  if (multiplayer.active) await multiplayer.syncLobby();
  else if (SKIP_MENU && !multiplayer.pendingCode) {
    if(Q.get('routes')==='1')G.unifiedCompiled=await loadUnifiedRoute(Q);
    if(G.unifiedCompiled&&Q.has('car')){const i=CARS.findIndex(c=>c.id===canonicalCarId(Q.get('car')));if(i>=0)G.carIdx=i;}
    await switchMap(G.unifiedCompiled?'athens':initialMapId(Q), Q.get('event') === 'free' ? 'FREE ROAM' : 'QUICK RACE');
    prepareEvent(Q.get('routeEvent') || Q.get('event') || 'quick'); resetRace();
    G.cam = G.userCam; applyCamMode(); updateCamera(0, true);if(G.unifiedCompiled&&Q.has('setup')){G.state='menu';const catalogue=await loadUnifiedRouteCatalogue({allowEmpty:true}).catch(()=>[]);menu.show('setup',{mode:'quick',catalogue});}else startCountdown();
  }
  document.body.classList.add('loaded');
  performance.mark('menu-ready'); tlog('ready');
}

// The pilot binds capabilities to the existing renderer, input, camera, clock and results.
async function loadUnifiedWorld(compiled,{eventId=Q.get('routeEvent')}={}) {
  if(worldSession&&map?.route?.compiled.routeHash===compiled.routeHash&&worldSession.manifest.revision===compiled.worldSetRevision){if(eventId&&map.events.some(e=>e.id===eventId)&&G.ev?.def.id!==eventId){prepareEvent(map.events.find(e=>e.id===eventId));resetUnifiedRace();}return map;}
  loading.show('athens', compiled.definition.name); loading.setRoute?.(compiled); G.state='loading';G.routePreparing=true;
  const started=performance.now(),entryPhases={},stamp=name=>{entryPhases[name]=performance.now()-started;};
  try {
    if(!sky){sky=ENV.createSky();scene.add(sky);const baked=ENV.bakeSky(renderer,sky);probeSeed=baked.cube;scene.environment=baked.env;setCarEnv(baked.env);({sun}=ENV.createLights(scene));}
    const sessionReady=worldSession?Promise.resolve(worldSession):createWorldSession({renderer,scene,resources:GFX.resources,progress:lstat,worldDefinition:{manifestURL:'/data/athens/manifest.json',regionId:compiled.regionId}});
    // An async compile may still be polling these materials on the next frame.
    // Dispose the previous fleet before collecting programs for the new entry.
    traffic?.dispose?.();traffic=null;
    if(!player){route=new RouteRuntime(compiled);setCar(G.carIdx,false);rival.model.root.visible=false;}post ||= createPost(renderer,scene,camera);
    // Weather owns a permanent headlight. Establish its light layout before
    // warming programs; the later world binding retains the same light count.
    if(!worldSession)bindMapWeather();
    const carPrograms=worldSession?Promise.resolve():compileScene();
    worldSession=await sessionReady;stamp('sessionReady');worldSession.metrics.entryPhases=entryPhases;if(Q.has('simhook'))window.__worldSession=worldSession;
    const pendingRoute=route?.compiled===compiled?route:new RouteRuntime(compiled);
    const routeReady=worldSession.prepareRoute(compiled,{cars:[CARS[G.carIdx]],runtime:pendingRoute});await Promise.resolve();
    // Traffic is optional during entry; its models/programs warm in countdown.
    traffic=new WorldTraffic(worldSession,scene,pendingRoute);
    validateRivalPlan(compiled,{required:!['localhost','127.0.0.1','[::1]'].includes(location.hostname)});
    pendingRoute.requireRivalPlan=!!compiled.rivalPlan;
    const linesReady=carPrograms;
    // Fetch/decode the start while initial car programs are pending. Join both
    // before buildGrid can dispose the boot-time rival's compiled materials.
    const prepared=await Promise.allSettled([routeReady,linesReady]);
    for(const result of prepared)if(result.status==='rejected')throw result.reason;
    route=prepared[0].value;stamp('roadsReady');ground=worldSession.ground;
    map={id:'athens',definition:{name:compiled.definition.name},route,marks:[],data:{marks:[],route:{}},events:compiled.definition.events.filter(e=>e.enabled).map(e=>routeEvent(compiled,e.id))};
    world={session:worldSession,map,group:scene,dispose:()=>worldSession.dispose()}; selectedMapId='athens';G.mapId='athens';
    hud?.paintPanel?.remove();$('rticks').replaceChildren();hud=new Hud(map);applyCpuBudget();hud.worldRoads=worldSession.roads;document.querySelector('#posBox .of').textContent='/1';$('rivalName').textContent='BEST';
    post ||= createPost(renderer,scene,camera);window.__post=post;post.setSize(innerWidth,innerHeight,pixelRatio,outputRatio(pixelRatio,window.devicePixelRatio));
    G.unifiedCompiled=compiled;routeNavigation=new RouteNavigation(route);guidanceData=buildRouteGuidanceData(compiled);
    routeClosures?.dispose();routeClosures=new RouteClosures(worldSession,scene,compiled.closures||[]);worldSession.closures=routeClosures;ground.closures=routeClosures;
    traffic.route=route;traffic.closures=routeClosures;traffic.onVoice=(state,transitions)=>policeVoice.observe(state,transitions);signals=new WorldSignals(worldSession,route);traffic.signals=signals;people={onRoad:[],peds:[],events:[]};routeRivals=new RouteRivals(route);policeHud ||= new PoliceHud();
    if(!window.__ghostLap)initGhostLap({G,scene,route,hud,input,player:()=>player,online:()=>false,trackVersion:()=>G.unifiedCompiled.geometryHash,origin:()=>worldSession.stream.origin,routeIdentity:()=>({...G.ev.def,projectionId:'athens-v1',direction:1,laps:G.ev.r.laps,setupKey:exactBestKey(G.bestSetup||bestSetup())})});
    if(player){player.veh.route=route;player.veh.ground=ground;}if(rival)rival.veh.route=route;if(player.spec.id!==CARS[G.carIdx].id)setCar(G.carIdx,false);rival.model.root.visible=false;if(window.__ghostLap)Object.assign(window.__ghostLap.ctx,{route,hud});
    prepareEvent(map.events.find(e=>e.id===eventId)||map.events[0]);resetUnifiedRace();stamp('raceReady');bindMapWeather();G.cam=G.userCam;applyCamMode();updateCamera(0,true);
    guidanceTilesOff?.();routeGuidance?.dispose();routeGuidance=new RouteGuidance(scene,{contact:(x,z,referenceY,layer)=>worldSession.stream.contact(x,z,{referenceY,layer,requiredFlags:1})});routeGuidance.setRoute(guidanceData);guidanceTilesOff=worldSession.subscribeTiles({activated:k=>routeGuidance.onTileActivated(k),removed:k=>routeGuidance.onTileRemoved(k)});hud.routeGuidance=routeGuidance;
    lstat('Preparing roads',0,{worldId:'athens',routeId:compiled.id,selectionToken:worldSession.selectionToken,phase:'warm'});await compileScene();stamp('shadersReady');worldSession.inventory();lstat('Ready',0,{worldId:'athens',routeId:compiled.id,selectionToken:worldSession.selectionToken,phase:'ready'});
    worldSession.metrics.selectionToCountdownMs=performance.now()-started;worldSession.metrics.initialWorldBytes=worldSession.stream.pool?.downloadedBytes??worldSession.stream.metrics.loadedBytes;window.__worldSession=worldSession;
    if(Q.has('simhook'))window.__routePilot={get player(){return player;},get route(){return route;},get run(){return G.run;},get rivals(){return grid;},get traffic(){return traffic;},get closures(){return routeClosures;},get guidance(){return guidanceData;},get visuals(){return routeGuidance?.stats;},session:worldSession,G,scene,renderer,camera,input,step:(dt=1/60,draw=false,visual=true,frameDt=dt)=>step(dt,draw,visual,frameDt),restart:()=>startEvent(G.ev.def),start:def=>startEvent(def),tow:()=>towUnified(),setDriver:fn=>{pilotDriver=fn;}};
    addEventListener('pagehide',()=>{guidanceTilesOff?.();routeGuidance?.dispose();worldSession?.dispose();},{once:true});G.routePreparing=false;loading.hide();return map;
  } catch(error){loading.fail({code:errorCode(error),retry:()=>loadUnifiedWorld(compiled)});throw error;}
}
function resetUnifiedRace(){
  G.run?.abort('restart');notifications.clear();routeNavigation.reset();buildGrid();const pv=player.veh,p=G.unifiedCompiled.grid[0];
  traffic.configure(G.ev.def,{deferFleet:true});policeVoice.reset();routeClosures.setEvent(G.ev.def);resetTowOffer();
  pv.reset(0,0,0);Object.assign(pv,{x:p.x,y:p.y,z:p.z,yaw:p.yaw,vLong:0,vLat:0,w:0,s:-8,u:0,_network:true});pv.ground=ground;ground.begin(pv);ground.resolve(pv,1/240);pv.syncWheels();applyDriving();$('rivalName').textContent='BEST';
  Object.assign(G,{raceT:0,pen:0,crashes:0,topSpeed:0,pFinish:null,rFinish:null,finishedT:0,postT:0,result:null,routeHint:false,streamInterrupted:false,towing:false,bestSetupChanged:false,marksDir:[],markIdx:0});
  G.tP=new Float32Array(Math.ceil(G.ev.r.len/10)+4).fill(NaN);G.tR=new Float32Array(G.tP.length).fill(NaN);
  for(const [i,c]of grid.entries()){const p=G.unifiedCompiled.grid[i+1];c.veh.route=route;c.veh.ground=ground;c.veh.reset(-8*(i+2),0,0);Object.assign(c.veh,{...p,s:-8*(i+2),u:0,vLong:0,vLat:0,w:0,_network:true});ground.begin(c.veh);ground.resolve(c.veh,1/240);c.veh.syncWheels();c.ai={lane:0,u:0,cool:0};c.dir=1;c.finish=null;c.pen=0;c.front=null;c.ghost=false;c.distant=false;c.course=buildCourse(G.ev.r,route);c.ai.controller=new RivalAI(route,c.veh,{driver:c.drv,dir:1,closedRoad:G.ev.def.traffic===0});c.tR=new Float32Array(G.tP.length).fill(NaN);syncCar(c,0);}
  document.querySelector('#posBox .of').textContent='/'+(grid.length+1);syncCar(player,0);
}
async function towUnified(){
  if(G.towing||!worldSession)return;G.towing=true;
  try{const v=player.veh,roads=worldSession.roads,candidates=[];
    const target=worldRecoveryTarget(worldSession,v,{course:G.run?.course,route,halfWidth:v.halfW,halfLength:v.halfL,actors:[...grid.filter(c=>!c.distant).map(c=>c.veh),...traffic.actors]});if(!target)throw Error('No safe loaded road');
    await worldSession.stream.teleport(target,()=>{const nitro=v.nitro;v.reset(target.s,target.u,0);v.nitro=nitro;Object.assign(v,{x:target.x,y:target.y,z:target.z,yaw:target.yaw,s:target.s,u:target.u,vLong:0,vLat:0,w:0});ground.begin(v);ground.resolve(v,1/240);v.syncWheels();if(G.run?.course)towCourseTo(G.run.course,{...v,...v.routeContact,kind:target.kind},G.run.courseClock);G.streamInterrupted=true;G.bestSetupChanged=true;updateCamera(0,true);});
  }catch(error){hud.message('ROAD NOT READY · TRY AGAIN',2);console.warn(error);}finally{G.towing=false;}
}
function stepUnified(dt,visual,frameDt){
 const v=player.veh,simulate=!inMenu()&&!G.towing;
 if(G.towing&&G.state==='race'){G.raceT+=dt;window.__ghostLap?.tick(dt);}const captured=towOffer.recovering&&towOffer.hold>0;if(captured){towOffer.hold=Math.max(0,towOffer.hold-dt);v.vLong=v.vLat=v.w=0;if(!towOffer.hold)towOffer.recovering=false;}
 if(visual){worldSession.setInterest({player:v,actors:[...routeRivals.interests(grid,v),...traffic.actors],routeCursor:{s:v.s}});worldSession.update(frameDt);worldSession.activateFrame();}
 if(simulate){tickWorldLife(dt,{running:true});updateRoadWeather(dt);signals.update();}
 if(simulate&&G.state==='countdown'){
  G.countT+=dt;const n=Math.min(3,Math.floor(G.countT/.4));if(n!==G.countShown){G.countShown=n;hud.count(n<3?String(3-n):'GO!',n===3);audio.beep(n===3);if(n===3){G.state='race';G.raceT=0;G.run.start({field:grid.length+1,grid:grid.map(c=>({id:c.drv.id,name:c.name,car:c.spec.id}))});document.body.classList.remove('counting');document.body.classList.add('racing');}}
  v.rpm=damp(v.rpm,v.spec.idle+input.throttle*v.spec.redline*.7,6,dt);
 }
 if(simulate&&['race','finished'].includes(G.state)){
  if(!ground.ready(v,dt)){if(G.state==='race'){worldSession.metrics.holds++;G.streamInterrupted=true;G.bestSetupChanged=true;if(!G.roadLoading){hud.message('ROAD STILL LOADING',2);G.roadLoading=true;}}}
  else {G.roadLoading=false;const previous={x:v.x,y:v.y,z:v.z,yaw:v.yaw,halfL:v.halfL,...v.routeContact};ground.begin(v);
   try{v.update(dt,G.state==='race'&&!captured?(pilotDriver?.(v,dt)||input):{throttle:0,brake:.5,steer:0,handbrake:false});if(v.wallHit>2.5&&G.t-(G.lastWorldCrash||-10)>.5){G.crashes++;G.lastWorldCrash=G.t;}v.wallHit=0;v.crashDv=0;}catch(error){Object.assign(v,previous,{vLong:0,vLat:0,w:0});worldSession.metrics.missingContacts++;throw error;}
   routeRivals.update(dt,grid,v,{ready:p=>ground.ready(p,dt),safe:(p,o)=>worldSession.safePose(p,o),step:(c,h)=>updateGrid(h,[c]),now:G.raceT+G.postT+dt});
   traffic.crossedRed=G.state==='race'&&G.ev.def.rules?.signals===true?signals.crossed(previous,{...v,...v.routeContact}):null;traffic.update(dt,v,[v,...grid.filter(c=>!c.distant).map(c=>c.veh)]);const contacts=[];traffic.collide({veh:v,kind:'player'},contacts,G.t);for(const c of grid.filter(c=>!c.distant)){traffic.collide(c.actor,contacts,G.t);racerPair(v,c.veh,true);}for(let i=0;i<grid.length;i++)for(let j=i+1;j<grid.length;j++)if(!grid[i].distant&&!grid[j].distant)racerPair(grid[i].veh,grid[j].veh,false);
   if(G.state==='race'){G.raceT+=dt;G.topSpeed=Math.max(G.topSpeed,v.kmh);window.__ghostLap?.tick(dt);raceTiming(dt);}else if(G.state==='finished'){G.postT+=dt;G.finishedT+=dt;advanceRivalCourses(dt);updateFinishView();}
  }
 }
 if(!visual)return;
 traffic.sync();routeClosures.update();for(const c of grid)if(!c.distant)syncCar(c,frameDt);syncCar(player,simulate?frameDt:0);window.__ghostLap?.visual(frameDt);policeHud?.update(frameDt);player.cockpit.setDetail(G.cam==='cockpit');player.cockpit.setVisible(G.cam==='cockpit');player.cockpit.update(frameDt,{vehicle:v,ignition:['race','countdown'].includes(G.state),manual:v.manual,rpm:v.rpm,redline:v.spec.redline,gear:v.gear,gearLabel:String(v.gear),kmh:v.kmh,steerInput:input.steer,handbrake:input.handbrake});
 const finishWatched=watchingDriver();updateFinishSpectateHud({visible:!!finishWatched&&!inMenu(),name:finishWatched?.name,position:finishWatched?.position,time:fmtTime(G.pFinish),ownPosition:G.result?.position??racePosition()});
 updateCamera(frameDt);worldSession.updateView(camera);ENV.U.time.value=G.t;
 const contact=worldSession.stream.contact(v.x,v.z,{referenceY:v.y}),nav=routeNavigation.update({dt:frameDt,position:v,heading:v.yaw,speed:v.vLong,earnedS:G.run?.course.rejoinLimit??G.run?.course.reached??0,time:G.t,contact});hud.routeNotice(nav,G.state==='race');if(simulate&&G.state==='race'){towOffer.cooldown=Math.max(0,towOffer.cooldown-frameDt);if(towCondition({offroad:nav.offRoute,beyond:Math.max(0,Math.abs(nav.u)-route.edge(nav.s)),water:v.water,inverted:Math.abs(v.pose.roll)>1.4,disabled:v.engineStalled||v.drivetrainBroken,speed:Math.hypot(v.vLong,v.vLat)},frameDt,towOffer))offerTow();}
 if(nav.offRoute&&G.t-(G.returnPathAt||-10)>.5){G.returnPathAt=G.t;const rejoin=route.point(nav.rejoinS),path=worldSession.roads.gps(v,{...rejoin,layer:route.edgeAt(nav.rejoinS).layer});G.returnPath=path&&!path.edges.some(id=>routeClosures.blocksEdge(worldSession.roads.graph.edges.get(id).value))?returnRoutePoints(path,worldSession.roads.graph):null;}if(!nav.offRoute)G.returnPath=null;nav.returnPath=G.returnPath;
 const activeCells=new Set([...worldSession.stream.tiles].filter(([,t])=>t.state==='active').map(([k])=>k));routeGuidance?.update({cursorS:nav.s,occurrence:nav.occurrence,lap:G.run?.lap||1,position:v,heading:v.yaw,origin:worldSession.stream.origin,activeCells,isRace:true});
 const nextSignal=G.ev.def.rules?.signals?signals.next(v.s+v.halfL):null;hud.signal(nextSignal&&nextSignal.sF-v.s<230?{main:nextSignal.main,d:nextSignal.sF-v.s-v.halfL,wait:nextSignal.main!=='G'&&v.kmh<3,close:nextSignal.main==='R'&&nextSignal.sF-v.s<80&&v.kmh>25}:null);
 hud.update({s:v.s,rs:0,x:v.x,z:v.z,yaw:v.yaw,pos:racePosition(),time:G.pFinish??G.raceT,gap:raceGap(),pen:0,rpm:v.rpm,redline:v.spec.redline,kmh:speedIn(v.kmh),unit:speedUnit(),gearLabel:G.state==='countdown'?'N':v.reverse?'R':String(v.gear),tc:v.tcOn,abs:v.absOn,esc:v.escOn,aidsOff:!settings.aids,shiftFlash:0,draft:0,nitrous:v.spec.nitrous===true,nitro:v.nitro,nitroOn:v.nitroOn,free:false,limit:null,traffic:traffic.cars.filter(c=>c.active),manual:v.manual,canUpshift:true,offRoute:nav.offRoute,routeCursor:nav});
 document.body.classList.toggle('circuit-race',!!G.run?.r.closed&&!inFreeRoam());updateLapHud(G.run,!inFreeRoam()&&!inMenu()&&!isDrivingMode(G.ev?.def));
 updateWeather(frameDt);if(drawUnifiedAudio())updateAudio(frameDt);if(G.state==='race'&&G.raceT>5)document.body.classList.add('started');
}
function drawUnifiedFrame(dt,draw,visual,frameDt){stepUnified(dt,visual,frameDt);if(draw&&visual)render();}
function drawUnifiedAudio(){return !!audio.ctx&&!!player;}

async function loadFirstMap(id) {
  setAssetCodecMap(id);
  const texReady = loadTextures(); // decodes in parallel with the world building below
  map = await loadMap(undefined, './', id, { worldProgress: lstat });
  route = map.route;
  startS = route.start;
  hud?.paintPanel?.remove(); $('rticks').replaceChildren();
  hud = new Hud(map); applyCpuBudget();
  hud.onPaint = (id, color) => { if (player?.spec.id === id) setPaint(player.model, color); }; // garage paint picker (hud.showPaint)
  hud.drawOverview($('overview'));
  tlog('map');
  lstat('BUILDING TERRAIN', 0.25); await frameYield();
  if (!sky) {
    sky = ENV.createSky(); scene.add(sky);
    const baked = ENV.bakeSky(renderer, sky); probeSeed = baked.cube; scene.environment = baked.env;
    ({ sun } = ENV.createLights(scene));
  }
  world = await buildMapWorld(map, { scene, sky, skyCube: probeSeed, lowGraphics, quality: sceneryQuality, progress: lstat });
  bindMapWorld(world);
  policeHud ||= new PoliceHud();
  post ||= createPost(renderer, scene, camera); window.__post = post;
  post.setSize(innerWidth, innerHeight, pixelRatio, outputRatio(pixelRatio, window.devicePixelRatio)); // the scene's own ratio; the canvas may be larger (graphics.js outputRatio)
  probe ||= createProbe();
  setCarEnv(probe.envRT.texture);
  bindMapWeather(); // time of day + weather (?tod=&wx=)
  tlog('traffic+post');
  // ?car= takes a 1-based number or a car id (?car=2, ?car=z4); anything else falls back to the saved car
  const qCar = canonicalCarId(Q.get('car')), qIdx = qCar == null ? -1 : /^\d+$/.test(qCar) ? clamp(+qCar - 1, 0, CARS.length - 1) : CARS.findIndex((c) => c.id === qCar);
  setCar(qIdx >= 0 ? qIdx : savedCar(), false);
  prepareEvent('quick');
  resetRace();
  updateCamera(0, true);
  lstat('WARMING TYRES', 0.95);
  const textureWaitStarted = performance.now();
  await texReady; assetMetrics.textureWaitMs = performance.now() - textureWaitStarted;
  lstat('UPLOADING TEXTURES', .96); await frameYield(); uploadTextures(renderer);
  tlog('textures');
  updateLod();
  lstat('PREPARING SHADERS', .98); await frameYield();
  const compileStarted = performance.now(); await compileScene();
  assetMetrics.compileSceneMs = performance.now() - compileStarted;
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
  ({ map, water, assets, signals, people, traffic, ground, splash, fx, markers } = next); applyDrawDistance(); applyCpuBudget();
  for (const c of traffic.cars || []) if (c.m?.root && !c.m.root.userData.shadowTrimmed) { trimShadowCasters(c.m.root); c.m.root.userData.shadowTrimmed = true; }
  route = map.route; startS = route.start;
  ground.corridor = new DrivableCorridor(route, ground.network, map.terrain);
  drivingModeView?.dispose(); drivingModeView = new DrivingModeView(scene, route);
  lodList.splice(0, lodList.length, ...next.lod);
  farCull.bind(next.group, lodList); setFarFog(farCullDistance());
  traffic.disabled = Q.has('notraffic') || route.closed;
  { const base = traffic.density.bind(traffic); traffic.density = (s) => base(s) * (G.trafficMul ?? 1) * (multiplayer.active ? 1 : G.trafficTier ?? 1); }
  police = new Police(traffic, route); window.__police = police;
  policeVoice.reset(); humanVoices.reset(); police.onVoice = (state, transitions) => policeVoice.observe(state, transitions);
  notifications.mirrorView = () => ({camera, mirrors: G.cam==='cockpit'||cameraBlend.active ? player?.cockpit?.mirrors||[] : []});
  window.__sim = { signals, people, traffic, route, ground, fx, G, input, look, camera, cameraBlend, towOffer, farCull, get player() { return player; } };
  if (Q.has('simhook')) {
    Object.assign(window.__sim, { scene, renderer, canvas, keys, render: () => render(), step: (n = 1, dt = 1 / 60) => { for (let i = 0; i < n; i++) step(dt, false); } });
    // World binding precedes post creation/car selection; diagnostics must read current owners after a swap.
    Object.defineProperties(window.__sim, { post: { get: () => post }, cars: { get: () => [player, ...grid] } });
  }
  G.mapId = map.id || 'riviera';
}
function bindMapWeather() {
  initWeather({ renderer, scene, camera, sky, water, sun, post, probe, traffic, assets, audio, quality: R.particles, cars: () => worldSession ? [player,...grid] : [player, rival], cam: () => G.cam });
}
/** Menu/lobby contract: await switchMap(id), then prepare/start the selected event. */
async function switchMap(id = 'riviera', context = 'QUICK RACE') {
  if (mapSwitch) { await mapSwitch; return switchMap(id, context); }
  if (world && map?.id === id) return map;
  if(worldSession&&id!=='athens'){guidanceTilesOff?.();routeGuidance?.dispose();worldSession.dispose();const url=new URL(location.href);url.search='?menu=1&map='+encodeURIComponent(id);location.assign(url);throw Error('Leaving route pilot');}
  if(id==='athens'&&G.unifiedCompiled){if(worldSession&&map?.route?.compiled.routeHash===G.unifiedCompiled.routeHash)return map;return loadUnifiedWorld(G.unifiedCompiled);}
  getMap(id); selectedMapId = id; setAssetCodecMap(id);
  loading.show(id, context);
  mapSwitch = (async () => {
    const priorState = G.state, priorPaused = G.paused;
    sessionTransitions.cancel(); controls.clear(); G.cameraStarting = false; G.towing = false; G.paused = null;
    blackout(false);
    voices.reset(); audio.menuRequested = true; audio.syncMenu(); audio.engineOff?.(); G.state = 'loading';
    if (!world) {
      try { return await loadFirstMap(id); }
      catch (error) { map?.dispose?.(); map = route = null; G.state = 'menu'; throw error; }
    }
    let nextMap, nextWorld;
    try {
      nextMap = await loadMap(undefined, './', id, { worldProgress: lstat });
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
    hud = new Hud(map); applyCpuBudget(); hud.onPaint = (car, color) => { if (player?.spec.id === car) setPaint(player.model, color); };
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
  // A failed load stays on the loading screen as a calm, recoverable pause (Retry / Return to menu); callers may attach their own retry.
  try { const loaded = await mapSwitch; selectedMapId = loaded.id; loading.hide(); return loaded; }
  catch (error) { loading.fail({ code: errorCode(error) }); throw error; }
  finally { mapSwitch = null; }
}
window.__switchMap = switchMap;
window.__mapRuntime = () => ({ mapId: map?.id, switching: !!mapSwitch, worlds: scene.children.filter(o => o.name.startsWith('map-world:')).map(o => o.name), lastDisposal: lastMapDisposal, memory: { ...renderer.info.memory }, weatherWidgets: document.querySelectorAll('#police-hud').length });

// ------------------------------------------------------------------ cars
function makeCar(spec, isPlayer, plate) {
  // The plate is the local driver name (driverName.plate()), a remote driver's
  // lobby plate, or undefined for a random registration. Single player shows
  // the driver name; multiplayer shows every driver's name.
  const model = new CarModel(spec, { plate });
  if (!isPlayer) scaleVehicleLod(model, GFX.vehicleLod, 40); // rivals and online drivers stay detailed at close chase distance
  scene.add(model.root);
  trimShadowCasters(model.root);
  return { model };
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
  (c.cockpit||c.model?.cockpit)?.disposeMirrors();
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
  // A balanced lobby handicaps the local car authoritatively: the server's
  // per-player ballast / power cap applies here, so the effect is real pace.
  // Solo play (or an unbalanced lobby) returns the catalogue entry untouched.
  const spec = applyBalance(CARS[idx], window.__multiplayer?.me?.balance);
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
  const waiting = gridSlot(multiplayer.me?.gridSlot ?? 0, s0), spare = gridSlot(1, s0);
  placeVeh(player.veh, waiting.s, waiting.u, G.ev.r.dir);
  placeVeh(rival.veh, spare.s, spare.u, G.ev.r.dir);
  for (const v of [player.veh, rival.veh]) { v.nitro = v.spec.nitrous === true ? 0.4 : 0; v.dragMul = 1; v.wallHit = 0; v.safe = null; v.water = 0; }
  G.sinkT = 0; G.sinkFade = false; G.stuckT = 0; G.stuckHint = false; G.towing = false; resetTowOffer();
  if (fx) fx.clearMarks();
  rival.ai = { lane: 0, u: route.laneU(s0 + 9, 0), cool: 0, mistakeT: 20 + Math.random() * 20, sigJ: -1 };
  if (player.ai) player.ai.sigJ = -1;
  signals.reset();
  traffic.reset(s0);
  people.reset(s0); voices.reset();
  Object.assign(G, { raceT: 0, crashes: 0, topSpeed: 0, pFinish: null, rFinish: null, lastLead: 0, leadT: 0, driftAcc: 0, driftT: 0, shake: 0, flash: 0, finishedT: 0, rivalBanner: false, routeHint: false, cones: 0,
    pen: 0, scared: 0, postT: 0, pFront: null, rFront: null, tickT: 0, waitJ: -1 });
  const n = Math.ceil((route.finish - startS) / 10) + 2;
  G.tP = new Float32Array(n).fill(NaN); G.tR = new Float32Array(n).fill(NaN);
  G.markIdx = map.data.marks.findIndex((m) => m.s > s0 + 50); if (G.markIdx < 0) G.markIdx = map.data.marks.length;
  syncCar(player, 0); syncCar(rival, 0);
}
/** Free roam starts where the player chose on the spawn picker (owner decision 2026-10-19): the nearest drivable road to that
 *  point, by the tow placement (src/tow-placement.js), so the car is centred in a lane, faces along the road, is clear of
 *  traffic and obstacles and sits at road level. Free roam has no route to prefer, so the nearest road is the road. */
function spawnOnRoad(pv, spawn) {
  const kit = towRoadKit(), plan = planTow({ x: spawn.x, z: spawn.z, yaw: spawn.yaw ?? 0, route: kit.adapter, index: kit.index, dir: 1, course: null, clear: towClearance(pv) });
  pv.reset(plan.s, plan.kind === 'road' ? 0 : plan.u, 0); pv.yaw = plan.yaw;
  if (plan.kind === 'road') { pv.x = plan.x; pv.z = plan.z; pv.y = ground.network.height(plan.x, plan.z); pv.u = plan.u; pv._network = true; }
  pv.safe = { s: plan.s, u: plan.u };
  return plan;
}
/** offline reset onto the active event: the grid, traffic in the event's direction and density, timing */
function resetEvent() {
  if(worldSession)return resetUnifiedRace();
  world?.tyreWalls?.reset();
  notifications.clear();
  const { def, r } = G.ev, dir = r.dir;
  buildGrid();
  traffic.disabled = Q.has('notraffic') || !((def.traffic ?? 1) > 0); G.trafficMul = def.traffic ?? 1;
  const base = Q.has('s') ? +Q.get('s') : r.s0;
  const solo = !grid.length;
  const spawn = solo && def.type === 'free' ? def.spawn : null; // where the player chose to start (spawn picker, 2026-10-19)
  if (spawn) spawnOnRoad(player.veh, spawn);
  else if (solo) { const p = soloStartPosition(route, base, dir, def.type === 'free' || isDrivingMode(def)); placeVeh(player.veh, p.s, p.u, dir); }
  else { const g = gridSlot(grid.length, base); placeVeh(player.veh, g.s, g.u, dir); }
  player.dir = dir;
  for (const [i, c] of grid.entries()) {
    const g = gridSlot(i, base); placeVeh(c.veh, g.s, g.u, dir); c.dir = dir;
    c.ai = { lane: g.lane, u: g.u, cool: 0, mistakeT: (20 + Math.random() * 20) / c.drv.mistakes, sigJ: -1 };
    c.course = buildCourse(r, route);
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
  if (spawn) { spawnOnRoad(player.veh, spawn); resetTowOffer(); } // again, now that this session's traffic is out: clear of it
  Object.assign(G, { raceT: 0, crashes: 0, topSpeed: 0, pFinish: null, rFinish: null, lastLead: 0, leadT: 0, driftAcc: 0, driftT: 0, shake: 0, flash: 0, finishedT: 0, rivalBanner: false, routeHint: false, cones: 0,
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

// Recovery costs the time spent leaving the road and the short placement transition.
// Police capture has its own hold and never uses the ordinary tow duration.
const towOffer = { element: null, cooldown: 0, offT: 0, safe: null, hold: 0, recovering: false, elapsed: 0, stuckT: 0, severeT: 0 };
function closeTowOffer(delay = 0) {
  notifications.dismiss('tow');
  if (towOffer.element) { towOffer.element.remove(); towOffer.element = null; }
  towOffer.cooldown = Math.max(towOffer.cooldown, delay);
}
function resetTowOffer() {
  clearCorridorWarning(); towOffer.corridorT = 0;
  closeTowOffer(); Object.assign(towOffer, { cooldown: 0, offT: 0, hold: 0, recovering: false, elapsed: 0, stuckT: 0, severeT: 0, rearm: 0 });
  towOffer.safe = player ? { s: player.veh.s, u: player.veh.u } : null;
}
function offerTow() {
  if (towOffer.element || towOffer.cooldown > 0) return;
  const el = document.createElement('aside'); el.className = 'tow-prompt ui-prompt'; el.id = 'tow-prompt';
  el.setAttribute('role', 'region'); el.setAttribute('aria-label', 'Tow assistance');
  const recoveryKey = kbd(esc(bindingLabel(controls.bindings, activeInputDevice() === 'gamepad' ? 'down' : 'tow', activeInputDevice()).split(' / ')[0]), activeInputDevice() === 'gamepad') + (activeInputDevice() === 'gamepad' ? icon('chevron-right') + kbd(esc(bindingLabel(controls.bindings,'confirm','gamepad').split(' / ')[0]),true) : '');
  el.innerHTML = '<strong>NEED A TOW?</strong><p>' + 'Return to the road.' + '</p><div class="tow-actions"><button type="button" data-tow="accept">' + recoveryKey + ' Tow to the road</button><button type="button" data-tow="dismiss">Keep driving</button></div>';
  el.querySelector('[data-tow=accept]').onclick = () => { el.querySelector('button').blur(); tow(player.veh); };
  el.querySelector('[data-tow=dismiss]').onclick = () => { el.querySelector('[data-tow=dismiss]').blur(); closeTowOffer(TOW_PROMPT_COOLDOWN); };
  if (!inFreeRoam() && !multiplayer.active) {
    const retire = document.createElement('button'); retire.type = 'button'; retire.textContent = 'RETIRE · DNF';
    retire.onclick = () => { closeTowOffer(); if (multiplayer.active) multiplayer.retire(); else finishRace('retired'); };
    el.querySelector('.tow-actions').append(retire);
  }
  const chip = document.createElement('button'); chip.type = 'button'; chip.className = 'tow-chip'; chip.innerHTML = recoveryKey + ' Tow to the road'; chip.setAttribute('aria-label', 'Tow to road'); chip.onclick = () => tow(player.veh); el.append(chip);
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
// Tow, reset and automatic recovery put the car on the nearest road (owner decision 2026-10-18, src/tow-placement.js).
// Online the server's pose is authoritative; offline it is planned here from the car as it is right now.
const towKit = { route: null, adapter: null, network: null, index: null };
function towRoadKit() {
  if (towKit.route !== route) { towKit.route = route; towKit.adapter = routeTowAdapter(route); }
  if (towKit.network !== ground.network) { towKit.network = ground.network; towKit.index = ground.network?.segments?.length ? new RoadIndex(ground.network.segments) : null; }
  return towKit;
}
// A spot is clear when no building, parked car, traffic car or rival is on the car's footprint.
function towClearance(pv) {
  const w = {}, r = pv.halfW + .05, spot = {}, others = [...traffic.cars.filter(c => c.active && !c.crash).map(c => traffic.point(c, spot) && { x: spot.x, z: spot.z }), ...grid.map(c => c.veh)];
  return pose => {
    const fx = -Math.sin(pose.yaw), fz = -Math.cos(pose.yaw);
    for (const k of [pv.halfL - r, -(pv.halfL - r)]) if (ground.walls(pose.x + fx * k, pose.z + fz * k, r + .5, w)) return false;
    return !others.some(o => Math.hypot(o.x - pose.x, o.z - pose.z) < pv.halfL + 3.2);
  };
}
function backOnRoad(pv, recovery = null, { reset = false } = {}) {
  const online = multiplayer.active, dir = online ? multiplayer.lobby.event?.dir || 1 : G.dir || 1;
  const kit = towRoadKit(), course = !online && !inFreeRoam() && G.run?.course;
  let plan;
  if (Number.isFinite(recovery?.s) && Number.isFinite(recovery.u)) {
    // The server's road pose is used as it is; its route pose is re-derived so the first physics projection keeps its leg.
    const f = Number.isFinite(recovery.yaw) ? kit.adapter.centre(route.closed ? route.wrap(recovery.s) : clamp(recovery.s, 0, route.length)) : null;
    const d = f ? (-Math.sin(recovery.yaw) * f.tx - Math.cos(recovery.yaw) * f.tz >= 0 ? 1 : -1) : dir;
    plan = recovery.kind === 'road' && Number.isFinite(recovery.x) && Number.isFinite(recovery.z) ? { kind: 'road', ...recovery } : { kind: 'route', ...kit.adapter.pose(recovery.s, d, dir) };
  } else plan = planTow({ x: pv.x, z: pv.z, yaw: towHeading(pv), route: kit.adapter, index: kit.index, dir, course: course ? courseTowLimits(course) : null, clear: towClearance(pv) });
  const nitro = pv.nitro; beginCameraBlend();
  pv.reset(plan.s, plan.kind === 'road' ? 0 : plan.u, 0); pv.yaw = plan.yaw;
  // A side street is not on the route: the car sits on that street's own surface.
  if (plan.kind === 'road') { pv.x = plan.x; pv.z = plan.z; pv.y = ground.network.height(plan.x, plan.z); pv.u = plan.u; pv._network = true; }
  if (online && !recovery) multiplayer.stateSender.discontinuity();
  pv.nitro = nitro; pv.safe = { s: plan.s, u: plan.u }; towOffer.safe = { s: plan.s, u: plan.u };
  if (G.run?.course) towCourseTo(G.run.course, { s: plan.s, u: plan.u, x: pv.x, y: pv.y, z: pv.z, kind: plan.kind }, G.run.courseClock);
  // reset() clears contact history and marks the suspension fresh; the next update settles each wheel.
  G.sinkT = 0; G.sinkFade = false; look.yaw = look.pitch = look.targetYaw = look.targetPitch = look.yawV = look.pitchV = 0;
  syncCar(player, 0); updateCamera(0, true);
}
function clearCorridorWarning() {
  document.body.classList.remove('offtrack-warning'); notifications.dismiss('offtrack');
}
function corridorCheck(pv, dt) {
  if (G.state !== 'race' || G.towing || multiplayer.retired || towOffer.hold > 0 || towOffer.rearm > 0) {
    towOffer.corridorT = 0; clearCorridorWarning(); return false;
  }
  const distance = ground.corridor.distance(pv.x, pv.z);
  const q = ground.network?.project(pv.x, pv.z) || route.project(pv.x, pv.z, null);
  const drop = route.surfaceY(q.s, clamp(q.u, -route.edge(q.s), route.edge(q.s))) - pv.y;
  const result = corridorRecovery({ distance, bounds: ground.corridor.outsideBounds(pv.x,pv.z), mapId: map.id, freeRoam: inFreeRoam(), drop }, dt, towOffer);
  if (result.tow) { clearCorridorWarning(); tow(pv, { automatic: true }); return true; }
  if (result.warning) {
    document.body.classList.add('offtrack-warning');
    const countdown = towOffer.corridorT > 0 ? `Automatic recovery in ${Math.ceil(result.remaining)} s` : 'Follow the road';
    notifications.post({title:'RETURN TO THE ROAD',text:countdown, id: 'offtrack', kind: 'hud', tone: 'bad', priority: 70, persistent: true });
  } else clearCorridorWarning();
  return false;
}
function stuckCheck(pv, dt) {
  towOffer.rearm = Math.max(0, (towOffer.rearm || 0) - dt);
  if (corridorCheck(pv, dt)) return;
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
  const q = pv.rigid?.q || pv.bodyQ;
  const inverted = pv.bodyDynamic && q ? 1 - 2 * (q[0] ** 2 + q[2] ** 2) < .35 :
    Math.abs(pv.pose.roll) > Math.PI / 2 || Math.abs(pv.pose.pitch) > Math.PI / 2;
  const disabled = pv.engineStalled || pv.drivetrainBroken || EV.isWrecked(pv.maxImpactEbs);
  // Only on-road poses advance the recovery anchor; a circuit excursion cannot skip ahead.
  if (!offroad && !inverted && !disabled && !pv.bodyDynamic && !pv.air && !G.towing && towOffer.hold <= 0) {
    if (!pv._network && Math.abs(pv.u) + pv.halfW <= route.edge(pv.s)) towOffer.safe = { s: pv.s, u: pv.u }; closeTowOffer(); towOffer.offT = towOffer.stuckT = towOffer.severeT = G.stuckT = 0; return;
  }
  const needed = towCondition({ offroad, beyond, water: pv.water, inverted, disabled, speed: Math.hypot(pv.speed, pv.vy || 0, pv.angularSpeed || 0) }, dt, towOffer);
  G.stuckT = towOffer.stuckT;
  if (needed && towOffer.hold <= 0) offerTow();
}
function tow(pv, { reset = false, automatic = false, capture = false } = {}) {
  if(pv.route?.isWorldRoute)return towUnified();
  if (G.state !== 'race' || G.towing || multiplayer.retired || !capture && (towOffer.hold > 0 || towOffer.rearm > 0)) return;
  // Without a connection there is nobody to answer: say so instead of fading to black for nothing.
  if (multiplayer.active && !multiplayer.connected) { hud.message('Reconnecting… recovery needs the connection back.', 3); return; }
  G.towing = true; G.stuckT = 0; towOffer.corridorT = 0; clearCorridorWarning(); closeTowOffer(TOW_PROMPT_COOLDOWN);
  controls.releaseMouseLook(); blackout(true, { onTimeout: true });
  const raceId = multiplayer.lobby?.raceId;
  sessionTransitions.after(320, async current => {
    let recovery = null;
    try {
      try { if (multiplayer.active) recovery = await multiplayer.recover({ capture }); }
      catch (error) { G.towing = false; blackout(false); if (current()) hud.message(error.message, 4); return; }
      if (!current()) { blackout(false); return; }
      G.towing = false;
      if (G.state !== 'race' || player.veh !== pv || multiplayer.retired || multiplayer.lobby?.raceId !== raceId) { blackout(false); return; }
      // Both controls put the car on the nearest road; online keeps the server's pose.
      backOnRoad(pv, recovery, { reset });
      audio.recovery();
      towOffer.hold = multiplayer.active && recovery ? Math.max(0, (recovery.until - multiplayer.now()) / 1000) : 0;
      towOffer.recovering = towOffer.hold > 0; towOffer.rearm = .8;
      towOffer.offT = towOffer.stuckT = towOffer.severeT = 0;
      if (automatic) notifications.toast('Recovered to road', { id: 'recovered', kind: 'card', label: 'RECOVERY', tone: 'good', ms: 3000 });
      else hud.message(`<i>${reset ? 'RESET' : 'TOWED'}</i> · BACK ON THE ROAD`, 3);
      sessionTransitions.after(120, () => blackout(false));
    } catch (error) { G.towing = false; blackout(false); console.error('Recovery failed', error); }
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
  if (multiplayer.active) { tow(player.veh, { capture: true }); hud.message('<i>PULLED OVER</i> · RECOVERY HOLD', 4); return; }
  if (G.ev?.def.type === 'pursuit') { finishRace('busted'); return; }
  // Pulled over: held at the roadside while the clock runs (no fine, no added seconds), then you drive on.
  if(worldSession)traffic.configure(G.ev.def);else police?.reset(police.enabled);
  towOffer.recovering = true; towOffer.hold = inFreeRoam() ? 3 : CAPTURE_HOLD;
  hud.message(`<i>PULLED OVER</i> · HELD ${towOffer.hold} s`, 4);
}

const inFreeRoam = () => !multiplayer.active && G.ev?.def.type === 'free';
const CAPTURE_HOLD = 10; // s held at the roadside after a solo arrest, on the race clock
function startCountdown() {
  G.routePreparing=false;
  document.body.classList.remove('menu-backdrop');
  G.cameraStarting = false; G.paused = null;
  syncSteeringAssist();
  if(worldSession){
    const warmingTraffic=traffic,generation=warmingTraffic.warmGeneration=(warmingTraffic.warmGeneration||0)+1;
    const warm=()=>{
      if(traffic!==warmingTraffic||warmingTraffic.warmGeneration!==generation)return;
      if(G.paused){requestAnimationFrame(warm);return;}
      if(!['countdown','race'].includes(G.state))return;
      worldSession.warmOptional();
      warmingTraffic.warmFleet(()=>traffic===warmingTraffic&&!G.paused&&['countdown','race'].includes(G.state)).catch(error=>{if(!warmingTraffic.disposed)console.warn('Countdown fleet preparation',error);});
    };
    // Paint the grid/countdown first; a menu transition cancels stale warming.
    requestAnimationFrame(()=>requestAnimationFrame(warm));
  }
  G.state = 'countdown'; G.countT = 0; G.countShown = -1; G.countWall = 0;
  document.body.classList.remove('racing'); document.body.classList.add('counting');
  hud.hideMenu();
  menu?.hide();
  if (!multiplayer.active && G.ev) {
    if (G.run && !G.run.done) G.run.abort('restart');
    try { localStorage.setItem('paraliaki.lastPlayedMap', map.id); } catch {}
    G.bestSetup = bestSetup(); G.bestSetupChanged = false; G.result = null; G.resultPhoto = null; G.resultPhotoPending = false;
    G.run = isDrivingMode(G.ev.def) ? new DrivingModeRun(G.ev.def, evCtx(), { car: player.spec.id, map }) : new EV.EventRun(G.ev.def, evCtx(), { car: player.spec.id });
    if (inFreeRoam()) {
      G.state = 'race'; G.run.start({ field: 1, grid: [] }); hud.count('');
      document.body.classList.remove('counting'); document.body.classList.add('racing', 'started');
      hud.banner('FREE ROAM', map.definition?.name || map.id); return;
    }
    const r = G.ev.r; hud.banner(G.ev.def.name, r.closed ? `CIRCUIT · ${r.laps} ${r.laps === 1 ? 'LAP' : 'LAPS'} · ${fmtDist(r.len)}` : `${r.fromName} TO ${r.toName} · ${EV.TYPES[G.ev.def.type].label}`);
  }
}

function restart(idx = G.carIdx) {
  if (multiplayer.active) return;
  sessionTransitions.cancel(); G.towing = false;
  G.cameraStarting = true; controls.requestMouseLock(); beginCameraBlend();
  blackout(true);
  sessionTransitions.after(280, () => {
    if (multiplayer.active) { blackout(false); return; }
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
    blackout(false);
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
addEventListener('pointerdown', e => { G.inputDevice = 'keyboard'; audio.start(); });
addEventListener('click', () => audio.start());

function readInput(dt) {
  const inMenu = window.__flow.inMenu();
  const blocked = G.ctxLost || document.hidden || G.state === 'loading' && !menu?.open && multiplayer.panel.hidden;
  controls.setCarSpec(player?.veh.spec);
  controls.update(dt, { speed: player ? Math.abs(player.veh.vLong) : 0, inMenu, blocked, retainMouseLock: !!G.cameraStarting });
  const pad = controls.pad;
  if (controls.keys.size) G.inputDevice = 'keyboard';
  else if (pad && (pad.buttons?.some(b => (b.value || 0) > 0.05) || pad.axes?.some(a => Math.abs(a) > controls.settings.deadzone))) G.inputDevice = 'gamepad';
  else if (!G.inputDevice || G.inputDevice === 'gamepad' && !pad) G.inputDevice = pad ? 'gamepad' : 'keyboard';
  { const hint = ui.hintDevice(G.inputDevice); if (document.body.dataset.input !== hint) document.body.dataset.input = hint; } // device-aware key hints (ui.css)
  if (syncSteeringAssist() && menu?.screen === 'settings' && settings.steeringAssist === null) menu.refreshValues();
  for (const name of controls.actions) {
    if (!inMenu && name === 'back' && notifications.action(name, {gamepad: activeInputDevice() === 'gamepad'})) continue;
    // Shared defaults (Escape, Enter, A/B) have different meanings in a menu and while driving.
    if ((inMenu && name === 'restart' && input.confirm) || (inMenu && name === 'pause' && input.back) || (!inMenu && name === 'back')) continue;
    if (!inMenu) drivingHints.action(name);
    flowAction(name);
    // Enter also emits confirm: opening results must consume the rest of this press.
    if (!inMenu && window.__flow.inMenu()) break;
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
let grid = []; // the offline AI field: [{ spec, veh, model, ai, drv, name, dir, pen, reds, finish, tR, actor }]; grid[0] === rival
let markers = null, menu = null;
const soloFinishSpectator = new FinishSpectator();
function soloSpectatorDrivers() {
  const ranked = EV.rankRacers([{ me: true, prog: earnedProgress(), finish: G.pFinish }, ...grid.map(c => ({ c, prog: earnedProgress(c), finish: c.finish, dnf: rivalDnf(c) }))]);
  return ranked.flatMap((row, i) => row.c ? [{ id: String(grid.indexOf(row.c)), name: row.c.name, position: i + 1, progress: row.prog, finish: row.c.finish, dnf: row.dnf, car: row.c }] : []);
}
function watchingDriver() {
  return multiplayer.active ? multiplayer.spectating() : G.state === 'finished' ? soloFinishSpectator.update({ raceId: G.run, finished: true, drivers: soloSpectatorDrivers(), complete: G.postT >= 600 }) : null;
}
function finishViewResults() {
  controls.clear(); controls.releaseMouseLook();
  if (multiplayer.active) { multiplayer.selection?.skip(); multiplayer.hooks.results(); multiplayer.panel.hidden = false; multiplayer.__screens?.schedule(); }
  else { soloFinishSpectator.skip(); showResults(); }
}
function updateFinishView() {
  const watching = watchingDriver();
  if ((G.state === 'finished' && !watching) || (G.state === 'onlineFinished' && multiplayer.selection?.phase === 'results')) finishViewResults();
}

function bestSetup(def = G.ev?.def, r = G.ev?.r, car = player?.spec.id) {
  return personalBestSetup({ mapId: map?.id, def, route: r, car: car || CARS[G.carIdx]?.id, carSpec: CARS.find(c => c.id === (car || player?.spec.id)), conditions: window.__conditions?.(),
    assists: { tc: settings.aids, abs: settings.abs, steering: settings.steeringAssist ?? (['gamepad', 'wheel'].includes(activeInputDevice()) ? 'light' : 'full'), gearbox: settings.transmission } });
}
function rememberResult(res) {
  res.date ||= new Date().toISOString();
  const setup = G.bestSetup || bestSetup();
  const eligible = (res.leaderboardValid ?? res.valid) && !Q.has('notraffic') && !G.bestSetupChanged && exactBestKey(setup) === exactBestKey(bestSetup());
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
    routeName: r.closed ? `${r.laps} LAPS · ${r.reverse ? 'REVERSE' : 'FORWARD'}` : `${r.fromName} TO ${r.toName}`,
    carName: res.carName || player.spec.name, time: res.time, position: multiplayer.active ? multiplayer.ranking().findIndex(p => p.id === multiplayer.id) + 1 : res.position,
    field: multiplayer.active ? multiplayer.lobby.players.length : res.field, pb: res.personalBest, date: res.date, url: new URL(document.querySelector('link[rel="canonical"]')?.href || location.href).host })); }
  catch (error) { ui.toast(error.message, { tone: 'bad' }); }
}
const MENU_STATES = ['menu', 'paused', 'results', 'garage'];
let selectedMapId = initialMapId(Q);
const evCtx = () => ({ map, mapId: map.id, route, marks: map.marks||map.data.marks, events: map.events,eventId:G.ev?.def.baseId||G.ev?.def.id });
const menuCtx = () => map?.id === selectedMapId ? evCtx() : menuMapContext(selectedMapId);
function selectMenuMap(id) { getMap(id); selectedMapId = id; setAssetCodecMap(id); }
const activeInputDevice = () => controls.drivingSource;
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
const SKIP_MENU = !Q.has('menu') && ['routes','simhook', 'autodrive', 'car', 's', 'event', 'quick', 'fixeddt', 'turbo'].some((k) => Q.has(k));
const defaultCar = () => Math.max(0, CARS.findIndex((c) => c.id === DEFAULT_CAR_ID));
function savedCar() { try { const i = CARS.findIndex((c) => c.id === canonicalCarId(localStorage.getItem('paraliaki.car'))); return i >= 0 && inGarage(CARS[i]) ? i : defaultCar(); } catch { return defaultCar(); } } // a removed trim maps to its model's top trim; anything else unknown falls back to the default
function initFlow() {
  let plate = driverName.plate();
  driverName.onChange(() => { const next = driverName.plate(); if (next !== plate) { plate = next; player?.model.setPlate(next); } });
  const handlers = {
    selectUnifiedRoute:async (id,eventId)=>{const url=new URL(location.href);url.searchParams.set('routes','1');url.searchParams.set('route',id);if(eventId)url.searchParams.set('routeEvent',eventId);else url.searchParams.delete('routeEvent');url.searchParams.delete('menu');url.searchParams.set('setup','1');const compiled=await loadUnifiedRoute(url.searchParams);G.unifiedCompiled=compiled;await loadUnifiedWorld(compiled,{eventId});history.replaceState(null,'',url);G.state='menu';menu.show('setup',{mode:'quick',eventId:G.ev.def.id,def:G.ev.def},true);},
    quickRace: () => openEvent('quick'), openEvent, startFree: def => startEvent(def, { car: G.carIdx }), multiplayer: () => multiplayer.open(), garage: openGarage, selectMap: selectMenuMap, switchMap,
    chooseCar: (index, def, garage) => {
      try { localStorage.setItem('paraliaki.car', CARS[index].id); } catch {}
      if (menu.data.inFreeRoam) { const onPick = menu.data.onPick; menu.back(); onPick?.(CARS[index].id); return; }
      if (garage) { if (player && world) setCar(index); else G.carIdx = G.selIdx = index; menu.back(); return; }
      if (!def) return;
      startEvent(def, { car: index });
    },
    openCarPicker, freeRoamCar: () => openCarPicker({ inFreeRoam: true, onPick: switchRoamCar }), roamConditions: openRoamConditions, roamLandmarks: openRoamLandmarks, roamTow: () => { resume(); tow(player.veh); },
    // RACE AGAIN on the results: the same event with the same car, at once. CHANGE CAR (restart) opens the car picker first.
    resume, restart: () => openEvent(G.ev.def), raceAgain: () => startEvent(G.ev.def, { car: G.carIdx }), changeCar: () => openEvent(G.ev.def, G.carIdx, true), quit: quitToMenu, next: (id) => openEvent(id),
    ctx: menuCtx, inputDevice: activeInputDevice, carName: () => CARS[G.carIdx].name, carSpec: () => CARS[G.carIdx], manual: () => player?.veh.manual ?? settings.transmission === 'manual', fmtTime, ui: (fwd) => audio.ui?.(fwd),
    personalBests: (def, r, car) => getPersonalBests(bestSetup(def, r, car)), shareResult,
    bindings: (el) => controls.openBindings?.(el), cancelBindings: () => controls.cancelCapture?.(),
  };
  menu = window.__bootMenu || new Menu($('ui'), handlers);
  Object.assign(menu.h, handlers);
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
  importWithUpdate(() => import('./leaderboard.js')).then((m) => { if (m?.submitResult) EV.events.on('finish', (r) => { try { m.submitResult(r); } catch (e) { console.warn(e); } }); }).catch(() => {});
}

function mapEvent(id) {
  if(worldSession){const def=typeof id==='object'?id:map.events.find(e=>e.id===id)||(id==='quick'?map.events[0]:null);if(def?.routeId!==G.unifiedCompiled.id||!['sprint','timetrial'].includes(def.type)||def.reverse||def.from!==0||def.to!==route.length)return null;if(!def.pilot)return def;return !(def.rivalCount??def.rivals)&&!def.traffic&&!def.rules?.police&&def.conditions?.time==='afternoon'&&def.conditions?.weather==='clear'?def:null;}
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
  if(worldSession){configureWorldLife(def,G.baseCond||window.__conditions());ENV.setConditions(def.conditions);post?.setConditions(ENV.COND_STATE);hud.setRange(r.s0,r.s1);document.body.dataset.mode=def.type;return r;}
  routeGuidance?.dispose();routeGuidance=null;
  if(def.type!=='free'&&!isDrivingMode(def))routeGuidance=createLegacyGuidance(scene,map,r,signals.J,ground);
  traffic.dir = r.dir;
  hud.setRange(r.s0, r.s1);
  world?.roadworks?.setEvent(def);
  traffic.allowClosedRoam = def.type === 'free';
  markers.group.visible = def.type !== 'free' && !isDrivingMode(def);
  // Free roam has no start or finish (owner decision 2026-10-18): the map's timing gantries and start stripes hide too.
  for (const mark of route.timingMarks || []) mark.visible = def.type !== 'free';
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
  return raceGridSlot(route, base, G.ev.r.dir, i, player?.spec.length || 4.4);
}
function placeVeh(veh, s, u, dir) { veh.reset(s, u, 0); if (dir < 0) veh.yaw += Math.PI; }
const prog = (s) => (s - G.ev.r.s0) * G.ev.r.dir;
const earnedProgress = (car = player) => car === player ? courseProgress(G.run?.course) : courseProgress(car.course);
function advanceRivalCourses(dt, now = G.raceT + G.postT) {
  for (const c of grid) {
    c.course ||= buildCourse(G.ev.r, route);
    if (c.finish !== null) continue;
    if(c.distant)continue;observeCourse(c.course, {...c.veh,...c.veh.routeContact}, now, { route });
    if (!EV.isWrecked(c.veh.maxImpactEbs) && courseComplete(c.course)) {
      c.finish = (c.course.finishedAt ?? now) + c.pen;
      if (G.state === 'race' && G.pFinish === null && !G.rivalBanner) { G.rivalBanner = true; hud.pop('info cyan', c.name + ' FINISHED'); }
    }
  }
}

/** the AI field for the active event (rebuilt only when the event or your car changes) */
function buildGrid() {
  if (multiplayer.active) return;
  const def = G.ev.def, drivers = def.type === 'sprint' ? EV.gridFor(def) : [];
  const key = def.id + '|' + player.spec.id + '|' + drivers.map((d) => d.id).join(',');
  if (key === G.gridKey && !rival.networkName) return;
  G.gridKey = key;
  for (const c of grid) if (c !== rival) disposeCar(c);
  grid = [];
  const specs=gridCarSpecs(def,drivers);
  for (const [i, d] of drivers.entries()) {
    const spec = specs[i];
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
function gridCarSpecs(def,drivers){
  const cars=CARS.filter(c=>isRivalCar(c)&&inGarage(c)),ids=cars.map(c=>c.id);
  return drivers.map(d=>cars.find(c=>c.id===(def.car&&ids.includes(def.car)?def.car:EV.driverCar(d,ids,player.spec.id)))||cars[0]);
}
/** drop the offline AI field (going online): extras are disposed, `rival` is left to the online code */
function hideGrid() {
  for (const c of grid) if (c !== rival) disposeCar(c);
  grid = []; G.gridKey = null;
}
/** the rival the HUD gap, audio and slipstream follow: the nearest car ahead, else the nearest behind */
function focusRival() {
  if (!grid.length) return rival;
  const pp = earnedProgress(); let best = null, bd = 1e9;
  for (const c of grid) { const d = earnedProgress(c) - pp, k = d >= -3 ? d : 400 - d; if (k < bd) { bd = k; best = c; } }
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
  const idx = car == null ? G.carIdx : typeof car === 'number' ? clamp(Math.floor(car), 0, CARS.length - 1) : Math.max(0, CARS.findIndex(c => c.id === canonicalCarId(car)));
  const mapId = def.mapId || selectedMapId;
  menu?.hide();
  try {
    await switchMap(mapId, def.type === 'free' ? 'FREE ROAM' : def.quick || def.id === 'quick' ? 'QUICK RACE' : def.name);
    if (token !== soloStart || multiplayer.active) return;
    if(worldSession){G.routePreparing=true;G.state='loading';loading.show('athens',G.unifiedCompiled.definition.name);loading.setRoute(G.unifiedCompiled);route=await worldSession.prepareRoute(G.unifiedCompiled,{cars:[CARS[idx]]});ground=worldSession.ground;ground.closures=routeClosures;traffic.route=route;signals.route=route;routeRivals=new RouteRivals(route);map.route=route;player.veh.route=route;player.veh.ground=ground;routeNavigation=new RouteNavigation(route);hud.setRoute(G.unifiedCompiled);loading.hide();}
    G.pendingEvent = def; restart(idx);
  } catch (error) {
    G.routePreparing=false;console.error('[map] start failed', error); showTitle();
    if (loading.open) loading.fail({ retry: () => startEvent(id, opts) });
    else ui.toast('COULD NOT LOAD THIS TRACK · PLEASE TRY AGAIN', { icon: 'triangle-alert', tone: 'bad' });
  }
}
function openEvent(id, index = G.carIdx, browse = false) {
  if (multiplayer.active) { multiplayer.open(); return; }
  const def = mapEvent(id); if (!def) return;
  const idx = def.car ? Math.max(0, CARS.findIndex(c => c.id === canonicalCarId(def.car))) : index;
  // Keep the paused/result state so BACK from the picker restores a working menu.
  if (!['paused', 'results'].includes(G.state)) G.state = 'menu'; controls.clear();
  // It opens on that car, ready to go: Enter races it, Back shows the whole garage (owner 2026-10-20: fewer steps).
  // CHANGE CAR on the results means another car, so it opens on the garage grid.
  if (browse) menu.show('car', { def, index: idx }, true); else menu.pickCar({ def, index: idx });
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
  const idx = CARS.findIndex(c => c.id === canonicalCarId(carId)); if (idx < 0) return false;
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
  const kept = player.veh.damageSnapshot();
  beginCameraBlend(0.8); placeVeh(player.veh, mark.s, route.closed ? 0 : route.laneU(mark.s, 0), 1); player.veh.restoreDamageSnapshot(kept);
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
  menu.hide(); if (G.paused && !G.paused.online) G.state = G.paused.state; if (G.paused) G.cam = G.paused.cam; G.countWall = performance.now(); G.paused = null; G.cameraStarting = false;
  // A retired or finished online driver spectates with the cursor (pick a driver on the live board); only drivers look by mouse.
  if (!(multiplayer.active && (multiplayer.retired || multiplayer.me?.finish != null))) controls.requestMouseLock();
}
function openSettings() {
  if (['race', 'countdown', 'finished', 'onlineCountdown', 'onlineFinished', 'onlineWrecked'].includes(G.state) && !G.paused) pauseGame();
  menu.show('settings', { from: menu.screen || 'pause', tab: 'audio' }, true);
}

function quitToMenu(screen = 'title') {
  if(worldSession){guidanceTilesOff?.();routeGuidance?.dispose();worldSession.dispose();const url=new URL(location.href);url.search='?menu=1';location.assign(url);return;}
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
  audio.menuRequested = true; audio.syncMenu(); audio.engineOff?.();
  G.cam = 'orbit'; applyCamMode(); G.orbitA = 0.4; updateCamera(0, true); post.resetHistory?.();
  // The static menu backdrop keeps idle menus free of world rendering work.
  document.body.classList.add('menu-backdrop');
  blackout(true);
  sessionTransitions.after(260, () => {
    menu.show(screen === 'events' ? 'events' : 'title');
    blackout(false);
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
  if (menu.accounts?.blocked) { menu.action(name); return true; }
  if (!menu.open && multiplayer.panel.hidden && (G.state === 'finished' || G.state === 'onlineFinished')) {
    if (name === 'reset' || name === 'tow') return true; // the parked finished car needs no recovery
    if (['pause', 'back', 'confirm', 'restart'].includes(name)) { finishViewResults(); return true; }
    if (name === 'left' || name === 'right') {
      const direction = name === 'left' ? -1 : 1;
      if (multiplayer.active) multiplayer.stepSpectator(direction);
      else soloFinishSpectator.step(direction, G.run, soloSpectatorDrivers().filter(p => p.finish == null && !p.dnf));
      return true;
    }
  }
  if (ui.action(name)) return true; // an open prompt / dropdown (src/ui/components.js) takes the input first
  if (!multiplayer.panel.hidden) return window.__lobbyUiAction?.(name) ?? true;
  if (name === 'garage' && G.state === 'menu' && (menu.screen === 'title' || menu.screen === 'events')) { audio.ui(true); openGarage(); return true; }
  if (name === 'transmission') {
    setSetting('transmission', settings.transmission === 'manual' ? 'auto' : 'manual');
    controls.toast(settings.transmission === 'manual' ? 'MANUAL' : 'AUTOMATIC', { id: 'gearbox-mode', ms: 1400 }); return true;
  }
  if (menu.open) return menu.action(name);
  if (MENU_STATES.includes(G.state)) return true;
  if (notifications.action(name, {gamepad: activeInputDevice() === 'gamepad'})) return true;
  switch (name) {
    case 'camera':
    case 'cameraPosition':
      G.cam = name === 'camera' ? cameraViews.toggle() : cameraViews.cycle(); G.userCam = G.cam;
      look.targetYaw = look.targetPitch = look.yaw = look.pitch = 0; look.yawV = look.pitchV = 0; look.idleT = 9;
      applyCamMode(); hud.message(`<i>${CAMERA_NAMES[G.cam]}</i> CAM`, 1.2); return true;
    case 'tow': tow(player.veh); return true;
    case 'map': hud?.toggleBigMap(); return true;
    case 'tractionControl':
      if (G.state === 'race' || G.state === 'countdown' || G.state === 'onlineCountdown')
        toggleTractionControl({ toast: (text, options) => controls.toast(text, options) });
      return true;
    case 'reset': resetCar(); return true;
    case 'restart': if (G.state === 'race' || G.state === 'countdown' || G.state === 'finished') openEvent(G.ev.def); return true;
    case 'pause': pauseGame(); return true;
    case 'garage': if (multiplayer.active) multiplayer.open(); else pauseGame(); return true; // the garage lives in the menus; mid-race G pauses
  }
  return false;
}
const inMenu = () => !!menu?.open || !multiplayer.panel.hidden || MENU_STATES.includes(G.state) || ui.modalOpen;
window.__flow = {
  get menu() { return menu; }, shareResult,
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
function updateGrid(dt, selection = grid) {
  const len = G.ev.r.len;
  aiField.length = 0; if (G.pFinish === null) aiField.push(player); for (const c of grid) aiField.push(c);
  for (const c of selection) {
    const v = c.veh;
    let pace = 1; // RivalAI applies each driver's pace and a mild gap-to-player band.
    if (c.finish !== null) pace = prog(v.s) > len + 120 ? 0 : 0.3;
    const rin = aiInput(c, dt, pace, aiField);
    if (pace === 0) { rin.throttle = 0; rin.brake = v.vLong > 1 ? 0.7 : 0; rin.handbrake = v.vLong <= 1; }
    if(worldSession&&G.ev.def.rules?.signals===true){const e=worldSession.roads.graph.edges.get(route.edgeAt(v.s).edgeId)?.value;if(e&&worldSession.props.hold({...v,edge:e.id},e.points)){rin.throttle=0;rin.brake=Math.max(rin.brake,.7);}}
    c.lastBrake = rin.brake > 0.2;
    v.dragMul = 1 - 0.32 * (c.ai.controller?.draft || 0); // the same slipstream tow the player gets
    // Well away from the player (out of any close view) a rival integrates at 120 Hz instead of 240: half the cost,
    // within 0.3% on lap time (tools/ai-driving.test.mjs far-rival-substep).
    v.subH = Math.hypot(v.x - player.veh.x, v.z - player.veh.z) > 150 ? 1 / 120 : 0;
    if(worldSession){if(!ground.ready(v,dt))continue;ground.begin(v);}
    v.update(dt, rin);
    if (v.spec.nitrous === true && !v.nitroOn) v.nitro = Math.min(1, v.nitro + dt * 0.012);
    // stop lines
    const f = v.s + G.dir * v.halfL;
    if (!worldSession && G.state === 'race' && c.front !== null && v.vLong > 0 && c.finish === null) { const j = crossedDir(c.front, f, G.dir); if (j) onStopLine(j, 'rival'); }
    c.front = c.front === null ? f : G.dir > 0 ? Math.max(c.front, f) : Math.min(c.front, f);
    c.ghost = false; // Traffic and collision rules apply throughout the race.
  }
}

// ---- timing, positions, splits, cameras, the finish (offline, state 'race')
function raceTiming(dt) {
  const pv = player.veh, run = G.run, r = G.ev.r, def = G.ev.def;
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
  const raceEvents = run.update(dt, { t: def.type === 'pursuit' && def.rules?.goal === 'survive' ? G.raceT : G.raceT + G.pen, s: pv.s, u: pv.u, x: pv.x, y: pv.y, z: pv.z, yaw:pv.yaw,...pv.routeContact, kmh: pv.kmh });
  advanceRivalCourses(dt, G.raceT);
  const pp = earnedProgress();
  const iP = Math.floor(pp / 10);
  if (iP >= 0 && iP < G.tP.length && isNaN(G.tP[iP])) for (let i = iP; i >= 0 && isNaN(G.tP[i]); i--) G.tP[i] = G.raceT;
  for (const c of grid) {
    const cp = earnedProgress(c), iR = Math.floor(cp / 10);
    if (iR >= 0 && iR < c.tR.length && isNaN(c.tR[iR])) for (let i = iR; i >= 0 && isNaN(c.tR[i]); i--) c.tR[i] = G.raceT;
  }
  // positions and overtakes
  if (grid.length) {
    const pos = racePosition();
    if (G.raceT > 2 && G.lastPos && pos !== G.lastPos && G.t - G.leadT > 1.2) {
      G.leadT = G.t;
      if (pos < G.lastPos) audio.ui(true); // brief acknowledgement; the position box shows the change
    }
    G.lastPos = pos;
  }
  // splits (a brief delta pop in time trials only), the finish, the pursuit survive clock
  for (const e of raceEvents) {
    if (e.kind === 'split' && !e.last) {
      const dl = e.delta;
      if (def.type === 'timetrial') hud.pop('split ' + (dl === null ? '' : dl <= 0 ? 'good' : 'bad'), e.name, fmtTime(e.time) + (dl === null ? '' : ` · ${dl <= 0 ? '−' : '+'}${Math.abs(dl).toFixed(2)}`));
    } else if (e.kind === 'finish') { G.pFinish = e.time ?? G.raceT + G.pen; G.raceT = G.pFinish - G.pen; finishRace(); return; }
    else if (e.kind === 'timeup') { finishRace('timeup'); return; }
  }
  // Progress is tracked invisibly. Past the line without the whole route covered (a shortcut, or a cut
  // that was never driven back), say so once instead of silently withholding the finish.
  if (!G.routeHint && prog(pv.s) >= G.ev.r.len + 5 && !courseComplete(G.run.course)) {
    G.routeHint = true;
    notifications.toast('Part of the route was skipped. Drive back to where you left it', { id: 'route-incomplete', kind: 'card', label: 'ROUTE', tone: 'bad', ms: 7000 });
  }
  // district banners, in the direction of travel
  const marks = G.marksDir;
  while (G.markIdx < marks.length && pp >= prog(marks[G.markIdx].s)) { const m = marks[G.markIdx++]; hud.banner(m.name, m.sub.toUpperCase()); }
}
const rivalDnf = c => !!(c.dnf || c.retired || EV.isWrecked(c.veh.maxImpactEbs) || c.veh.engineStalled || c.veh.drivetrainBroken);
function racePosition() {
  if (!grid.length) return 1;
  const me = { me: true, prog: earnedProgress(), finish: G.pFinish };
  const ranked = EV.rankRacers([me, ...grid.map((c) => ({ c, prog: earnedProgress(c), finish: c.finish, dnf: rivalDnf(c) }))]);
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
  const me = { me: true, prog: earnedProgress(), finish: G.pFinish };
  const ranked = EV.rankRacers([me, ...grid.map(c => ({ c, prog: earnedProgress(c), finish: c.finish, dnf: rivalDnf(c) }))]);
  const index = ranked.indexOf(me), comparison = ranked[index - 1] || ranked[index + 1];
  const who = comparison?.c;
  const timed = G.pFinish !== null && comparison?.finish != null;
  const gapUnit = timed ? 's' : 'm';
  const gap = comparison ? timed ? G.pFinish - comparison.finish : comparison.prog - me.prog : NaN;
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
  const res = run.finish({ time: G.pFinish, position: wrecked || retired ? null : busted ? grid.length + 1 : pos, field: grid.length + 1, penalties: G.pen, carName: player.spec.name, setup: G.bestSetup, leaderboardValid: !G.autodrive && !Q.has('s') && !Q.has('notraffic') && !dnf && !G.bestSetupChanged && exactBestKey(G.bestSetup) === exactBestKey(bestSetup()), topSpeed: G.topSpeed, crashes: G.crashes, busted, wrecked, retired, how, valid: !G.autodrive && !Q.has('s') && !dnf && !G.streamInterrupted });
  G.result = res; rememberResult(res);
  G.won = !dnf && (isDrivingMode(def) ? res.completed > 0 : def.type === 'sprint' ? pos === 1 : !!res.medal);
  if (G.won) audio.win(); else audio.lose();
  if(!worldSession)hud.pop(G.won ? 'info good' : 'info bad', isDrivingMode(def) ? 'SESSION COMPLETE' : wrecked ? 'WRECKED' : busted ? 'BUSTED!' : how === 'evaded' ? 'LOST THEM!' : how === 'timeup' ? 'SURVIVED!' : def.type === 'sprint' ? (pos === 1 ? 'FINISH!' : 'P' + pos) : 'FINISH!', '');
  // the per-car best of the full route (garage card)
  if (!worldSession && G.pFinish !== null && !isDrivingMode(def) && def.type !== 'pursuit' && Math.round(r.s0) === Math.round(route.start) && Math.round(r.s1) === Math.round(route.finish)) {
    try { const key = 'paraliaki.best.' + player.spec.id; const prev = +localStorage.getItem(key) || 0;
    if (!prev || G.pFinish < prev) localStorage.setItem(key, G.pFinish.toFixed(3)); } catch {}
  }
  controls.clear(); controls.releaseMouseLook();
  soloFinishSpectator.reset(G.run);
  if (how === 'finish' && G.pFinish !== null) {
    player.veh.vLong = player.veh.vLat = player.veh.w = 0;
    updateFinishView();
  } else showResults();
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
        EV.saveRecord(def.recordId||def.id, res.record);
      }
    }
  }
  const T = (t) => (t == null ? '—' : fmtTime(t)), sign = (d) => (d <= 0 ? '−' : '+') + Math.abs(d).toFixed(2);
  const avgKmh = res.time ? (G.run?.maxProg || 0) / res.time * 3.6 : 0, avg = res.time ? fmtSpeed(avgKmh) : '—';
  // the vehicle keeps its own top speed too; a teleported test car never moves, so never show a top below the average
  const topKmh = Math.max(G.topSpeed || 0, player.veh.topSpeed || 0), top = topKmh >= avgKmh && topKmh > 0 ? fmtSpeed(topKmh) : '—';
  const kick = r.closed ? `${map.definition?.name || def.name} · ${r.laps} ${r.laps === 1 ? 'LAP' : 'LAPS'} · ${fmtDist(r.len)}` : `${def.name} · ${r.fromName} TO ${r.toName} · ${fmtDist(r.len)}`;
  const splits = run.splits.map((t, i) => { const b = prev.bestSplits?.[i]; const cp = r.sectors[i]; return { name: cp.name, time: fmtTime(t), delta: b != null ? sign(t - b) : '', cls: b == null ? '' : t <= b ? 'good' : 'bad' }; });
  const best = res.record?.bestTime ?? prev.bestTime;
  const info = [['TOP SPEED', top], ['AVG SPEED', avg], ['CRASHES', G.crashes]];
  if (res.laps > 1 && res.bestLap != null) info.unshift(['BEST LAP', T(res.bestLap)]);
  let title, sub, rows, field = null;
  if (res.retired) {
    title = 'RETIRED'; sub = 'Did not finish.';
    rows = [['RESULT', 'DNF'], ['TIME', T(G.raceT + G.pen)], [G.ev.def.pilot?'PILOT BEST':'EVENT BEST', T(best)], ...info];
  } else if (res.wrecked) {
    title = 'WRECKED'; sub = 'Did not finish.';
    rows = [['RESULT', 'DNF'], ['TIME', T(G.raceT + G.pen)], [G.ev.def.pilot?'PILOT BEST':'EVENT BEST', T(best)], ...info];
  } else if (res.busted) {
    title = 'BUSTED'; sub = 'The ΕΛ.ΑΣ. got you. Did not finish.';
    rows = [['RESULT', 'DNF'], ['TIME', T(G.raceT + G.pen)], [G.ev.def.pilot?'PILOT BEST':'EVENT BEST', T(best)], ...info];
  } else if (def.type === 'sprint') {
    const pos = res.position;
    const winner = grid.filter((c) => c.finish !== null).sort((a, b) => a.finish - b.finish)[0];
    title = pos === 1 ? 'VICTORY' : `P${pos} OF ${res.field}`;
    const gap = pos === 1 ? (winner ? winner.finish - res.time : null) : winner ? res.time - winner.finish : null;
    sub = pos === 1 ? (gap != null ? `Won by <b>${gap.toFixed(2)} s</b>.` : '') : `<b>${gap != null ? gap.toFixed(2) : '?'} s</b> behind <b>${esc(winner?.name || '')}</b>.`;
    rows = [['POSITION', `P${pos} / ${res.field}`], ['YOUR TIME', T(res.time)], [pos === 1 ? 'MARGIN' : 'GAP TO WINNER', gap != null ? (pos === 1 ? '−' : '+') + gap.toFixed(2) + ' S' : '—'], [G.ev.def.pilot?'PILOT BEST':'EVENT BEST', T(best), res.newBest], ...info];
  } else {
    const d = prev.bestTime != null && res.time != null ? res.time - prev.bestTime : null;
    title = T(res.time);
    sub = def.type === 'pursuit' ? (res.how === 'timeup' ? 'Survived with the police on your tail.' : 'Lost the police.') : d === null ? 'First run on the board.' : d < 0 ? `New best by <b>${Math.abs(d).toFixed(2)} s</b>.` : `<b>${d.toFixed(2)} s</b> off your best.`;
    rows = [['YOUR TIME', T(res.time)], [G.ev.def.pilot?'PILOT BEST':'EVENT BEST', T(best), res.newBest], ...info];
  }
  if (def.type === 'sprint') {
    const all = [{ name: 'YOU', car: player.spec.short, finish: res.time, prog: earnedProgress(), me: true, dnf: !!(res.busted || res.wrecked || res.retired) }, ...grid.map(c => ({ name: c.name, car: c.spec.short, finish: c.finish, prog: earnedProgress(c), dnf: rivalDnf(c) }))];
    // Finishers are ordered by time; a car a lap or more down on a circuit shows +N LAPS, others still driving RUNNING, retired DNF.
    const lapsDown = (f) => r.closed && r.lapLength ? Math.floor(Math.max(0, r.len - f.prog) / r.lapLength) : 0;
    field = EV.rankRacers(all).map((f, i) => ({ pos: i + 1, name: f.name, car: f.car, me: f.me, time: f.finish != null ? fmtTime(f.finish) : f.dnf ? 'DNF' : lapsDown(f) >= 1 ? `+${lapsDown(f)} ${lapsDown(f) === 1 ? 'LAP' : 'LAPS'}` : 'RUNNING', running: f.finish == null && !f.dnf }));
  }
  if (field?.some(f => f.running)) sub += ' Rivals still racing · standings update as they cross the course.';
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
  for (const p of people?.onRoad||[]) rec(p.s, p.u, 0.6, 0.5, p);
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
    signals: route.closed || worldSession&&!G.ev.def.rules?.signals ? null : signals, pace: pace * wetPlanningPace(), closeRacing: Q.has('closeracing'), gapToPlayer: (veh.s - player.veh.s) * (car.dir || 1) });
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
  if(worldSession){c.model.root.position.x-=worldSession.stream.origin.x;c.model.root.position.z-=worldSession.stream.origin.z;}
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
  if (!far) c.model.update(dt, v.vLong, v.steer, (c === player ? input.brake > 0.3 : c.lastBrake) || false, v.bodyDynamic ? (v._rigidVisualPose ||= { heave: 0, pitch: 0, roll: 0 }) : v.pose, v.corners || v.wheel, v.bodyDynamic ? 0 : v.w);
  v.fxWheels = c.model.wheels; // Fx owns burnout tread deformation; the model keeps its normal wheel rig.
  if (c !== player) {
    const distance = camera.position.distanceTo(c.model.root.position);
    (c.model.detail ??= new DistanceDetail(c.model.root)).update(distance); // batch.js

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
  if (grid.length) { const all = G.pFinish === null ? [player, ...grid] : grid; for (let i = 0; i < all.length; i++) for (let k = i + 1; k < all.length; k++) racerPair(all[i].veh, all[k].veh, i === 0); return; }
  if (G.pFinish === null) racerPair(player.veh, rival.veh, true);
}
function racerPair(a, b, mine) {
  if(worldSession?Math.hypot(b.x-a.x,b.z-a.z)>12:Math.abs(b.s-a.s)>8)return;
  // a rigid-body contact between the two cars (src/crash-contact.js): at the contact point, with both masses and yaw inertias,
  // restitution by closing speed and friction along the face, so an offset hit spins them and a glancing one scrubs speed
  const r = resolveCarPair(a, b, { route });
  if (!r) return;
  const sev = r.vn;
  if (sev > 2.2) {
    const n = r.c;
    for (const [v, other, hit, sign] of [[a, b, r.hitA, 1], [b, a, r.hitB, -1]]) {
      if (!hit) continue;
      const c = Math.cos(v.yaw), s = Math.sin(v.yaw), nx = n.nx * sign, nz = n.nz * sign;
      const localPoint = { x: clamp(hit.py, -v.halfW, v.halfW), y: .55, z: clamp(-hit.px, -v.halfL, v.halfL) };
      const localNormal = { x: nx * c - nz * s, y: 0, z: nx * s + nz * c };
      const zone = Math.abs(localNormal.x) > Math.abs(localNormal.z) ? (localNormal.x > 0 ? 'left' : 'right') : (localNormal.z > 0 ? 'front' : 'rear');
      v.addDamage?.(zone, sev * .6, { kind: 'crash', sev, car: { mass: other.m }, localPoint, localNormal });
    }
  }
  if (mine) { const dv = Math.max(r.hitA?.dv ?? 0, r.hitB?.dv ?? 0); G.shake = Math.max(G.shake, clamp(dv / 16, 0, 0.7)); }
  if (sev > 1.5 && mine && G.t - (G.paintT || 0) > 1.2) { G.paintT = G.t; hud.pop('info cyan', 'TRADING PAINT!'); audio.crash(sev > 9 ? 'heavy' : 'light', Math.min(1, (sev / 12) ** 1.4)); }
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
      audio.crash(e.heavy ? 'heavy' : 'light', Math.min(1, Math.pow((player.veh.lastDamage?.ebs || e.sev) / 16, 2)), { glass: (player.veh.lastDamage?.ebs || 0) > 7, metal: true });
      controls.rumble(big ? 1 : 0.5, big ? 0.8 : 0.4, big ? 450 : 200);
      if (big) {
        if (!multiplayer.active) audio.opa(1.1);
        hud.pop('opa', 'OPA!', '', (Math.random() - 0.5) * 10);
      } else hud.pop('info bad', e.car.type.bus ? 'BUS BUMP!' : 'BUMP!');
      if (!multiplayer.active && e.target !== 'rider' && Math.random() < 0.6) audio.horn(e.car.type.bus, 0.9, -e.side * 0.4, 0.25);
    } else if (e.kind === 'scrape') { audio.scrape(Math.min(1, e.sev / 4), 'metal'); G.shake = Math.max(G.shake, 0.15); }
    else if (e.kind === 'cone') {
      G.cones++; audio.tone({ f: 380 + Math.random() * 200, slide: 900, dur: 0.18, gain: 0.08, type: 'triangle' }); audio.noise({ dur: 0.08, f: 1200, type: 'bandpass', gain: 0.12 });
    }
  }
}

// ------------------------------------------------------------------ audio feed
const _fr = {}, _av = new THREE.Vector3(), _aw = new THREE.Vector3(), _ar = new THREE.Vector3(), _ap = new THREE.Vector3();
// Per-frame audio-feed scratch: updateAudio runs every frame, so its traffic / rival / wheel descriptors and the
// parameter block are reused instead of allocated (the audio graph reads them synchronously within update()).
const _tl = [], _rivals = [], _wheelArgs = [{}, {}, {}, {}];
const _actors = [{ veh: null, kind: 'player' }], _fxVehs = [], REMOTE_FX_RANGE = 160; // m: other drivers' tyre effects are drawn this close
let _actorsInit = false;
let _tlN = 0, _rivN = 0;
const _audioRival = {}, _audioParam = { rival: _audioRival, wheels: _wheelArgs };
const audioListener = { x: 0, z: 0, vx: 0, vz: 0, ready: false, camera: null };
function listenerRel(x, y, z, vx, vz) {
  const o=worldSession?.stream.origin;return cameraRelativeSource(camera, audioListener, x-(o?.x||0), y, z-(o?.z||0), vx, vz);
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
  updateRoadRage(dt);
  if (!police?.enabled) policeVoice.reset();
  else if (voiceFrame.enabled) policeVoice.tick();
  if (voiceFrame.enabled) humanVoices.tick();

  if (!audio.ctx) return;
  syncAudioListener(audio.ctx, camera);
  const pv = player.veh, rv = rival.veh;
  const cp = camera.position, al = audioListener, moved = Math.hypot(cp.x - al.x, cp.z - al.z);
  const continuous = al.ready && al.camera === G.cam && dt > 0 && dt < 0.2 && moved < 15;
  al.vx = continuous ? clamp((cp.x - al.x) / dt, -120, 120) : 0;
  al.vz = continuous ? clamp((cp.z - al.z) / dt, -120, 120) : 0;
  al.x = cp.x; al.z = cp.z; al.ready = true; al.camera = G.cam;
  // where is the sea? (the shore side relative to the way the car is pointing)
  const seaR = worldSession?1e6:route.seaR(pv.s), seaL = worldSession?1e6:route.seaL(pv.s), seaD = Math.min(seaR, seaL);
  const shoreFrame = route.frame(pv.s, _fr);
  const seaPan = (seaR <= seaL ? 1 : -1) * 0.75 * cameraDirectionPan(camera, shoreFrame.rx, 0, shoreFrame.rz);
  const zone = traffic?.zone(pv.s)||'town';
  // nearby traffic, relative to the listener (camera): distance, pan, closing speed for doppler
  _tlN = 0;
  for (const c of traffic?.cars||[]) {
    const siren = !!(c.cop && (worldSession?traffic.hm.active:c.cop.siren) && !c.crash);
    if (!c.active || (c.mode === 'parked' && !siren) || Math.abs(c.s - pv.s) > (siren ? 420 : 150) || (c.crash && c.crash.y > 1)) continue;
    const p = worldSession?c.vehicle:route.point(c.s, c.u, _ap), f = worldSession?{tx:-Math.sin(p.yaw),tz:-Math.cos(p.yaw),rx:Math.cos(p.yaw),rz:-Math.sin(p.yaw)}:route.frame(c.s, _fr);
    const vs = worldSession?c.v:c.crash ? c.crash.vs : c.cross ? c.xvs : c.dir * c.v, vu = c.crash ? c.crash.vu : c.cross ? c.xvu : (c.uv || 0);
    const L = listenerRel(p.x, p.y, p.z, f.tx * vs + f.rx * vu, f.tz * vs + f.rz * vu);
    if (L.d > (siren ? 400 : 130)) continue;
    const t = _tlN < _tl.length ? _tl[_tlN] : (_tl[_tlN] = {});
    _tlN++;
    t.id = c.id; t.spec = c.type.catalogueCar; t.kind = c.kind; t.electric = !!c.type.electric; t.cop = !!c.cop;
    t.siren = siren; t.d = L.d; t.pan = L.pan; t.vr = L.vr; t.v = Math.hypot(vs, vu); t.acc = c.acc || 0;
  }
  _tl.length = _tlN;
  _tl.sort((a, b) => a.d - b.d);
  const tl = _tl;
  const rw = rv.velocityWorld(_av), RL = listenerRel(rv.x, rv.y, rv.z, rw.x, rw.z);
  const racing = G.state === 'race' || G.state === 'countdown';
  const counting = G.state === 'countdown';
  _rivN = 0;
  const _pushRival = (id, c, load) => {
    const v = c.veh, vel = v.velocityWorld(_av), rel = listenerRel(v.x, v.y, v.z, vel.x, vel.z);
    const r = _rivN < _rivals.length ? _rivals[_rivN] : (_rivals[_rivN] = {});
    _rivN++;
    r.id = id; r.spec = c.spec; r.rpm = v.rpm; r.limiter = v.limiter; r.load = load;
    r.d = rel.d; r.pan = rel.pan; r.vr = rel.vr; r.v = Math.hypot(v.vLong, v.vLat);
  };
  if (multiplayer.active) {
    for (const [id, c] of remoteCars) if (c.model.root.visible) _pushRival(id, c, 0.4);
  } else {
    for (let i = 0; i < grid.length; i++) {
      const c = grid[i]; if (!c.model.root.visible) continue;
      _pushRival(`ai-${i}`, c, c.lastBrake ? -0.3 : c.veh.load);
    }
  }
  _rivals.length = _rivN;
  const rivals = _rivals;
  for (let i = 0; i < 4; i++) Object.assign(_wheelArgs[i], pv.corners[i], { vgx: pv._S?.[i]?.vgx ?? pv.vLong });
  _audioRival.rpm = rv.rpm; _audioRival.load = rival.lastBrake ? -0.3 : counting ? (G.countT > 1 ? 0.7 : 0.1) : rv.load;
  _audioRival.dist = RL.d; _audioRival.pan = RL.pan; _audioRival.vr = RL.vr;
  _audioParam.dt = dt; _audioParam.damage = pv.damage; _audioParam.rpm = pv.rpm; _audioParam.redline = pv.spec.redline;
  _audioParam.load = counting ? input.throttle * 0.9 - 0.1 : racing ? pv.load : Math.min(pv.load, 0.3);
  _audioParam.throttle = input.throttle;
  _audioParam.handbrake = input.handbrake;
  _audioParam.cockpit = G.cam === 'cockpit'; _audioParam.manual = pv.manual;
  _audioParam.gearboxType = pv.powertrain?.gearboxType || pv.spec.gearboxType || pv.spec.gearbox;
  _audioParam.overrun = pv.overrun; _audioParam.shifting = pv.shiftT > 0; _audioParam.stalled = pv.engineStalled;
  _audioParam.shiftStart = pv.shiftStartEvent; _audioParam.shiftEnd = pv.shiftEndEvent;
  _audioParam.shiftGrind = pv.shiftGrind; _audioParam.shiftDuration = pv.gearChangeEvent?.duration;
  _audioParam.gear = pv.gear; _audioParam.gearRatio = pv.ratio(); _audioParam.shift = pv.shiftEvent;
  _audioParam.limiter = pv.limiter || (counting && pv.rpm > pv.spec.redline * 0.97); _audioParam.boost = pv.boost;
  // _audioParam.wheels / .rival / .rivals(?) reuse the module scratch (assigned once at declaration)
  _audioParam.surfaces = pv.wheelSurf;
  _audioParam.nominalLoad = pv.m * 9.81 / 4; _audioParam.rivals = rivals;
  _audioParam.menuOpen = !['race', 'countdown', 'onlineRace', 'onlineCountdown', 'onlineSpectating'].includes(G.state);
  _audioParam.speed = Math.hypot(pv.vLong, pv.vLat); _audioParam.skid = pv.skid;
  _audioParam.wheelspin = pv.wheelspin; _audioParam.lockup = pv.lockup; _audioParam.bump = pv.bumpHit;
  _audioParam.rough = pv.rough; _audioParam.offroad = pv.offroad; _audioParam.nitro = pv.nitroOn; _audioParam.wb = pv.wb;
  _audioParam.open = player.spec.convertible || G.cam !== 'cockpit';
  _audioParam.muted = G.state === 'garage' || G.state === 'paused' || (!multiplayer.active && !multiplayer.panel.hidden);
  _audioParam.sea = 1 - smoothstep(30, 300, seaD); _audioParam.seaPan = seaPan;
  _audioParam.city = route.urban(pv.s) * (zone === 'town' ? 0.85 : 0.45);
  _audioParam.beach = zone === 'beach' || zone === 'cove' ? 1 : 0; _audioParam.cliff = zone === 'cliff' ? 1 : 0;
  _audioParam.cicadas = 1 - route.urban(pv.s) * 0.7 + (zone === 'cliff' ? 0.4 : 0);
  _audioParam.action = clamp((pv.kmh - 110) / 160, 0, 1) * 0.6 + Math.min(0.5, G.shake);
  _audioParam.traffic = tl;
  audio.update(_audioParam);
}

// ------------------------------------------------------------------ cameras
const camState = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: settings.cockpitFov, vel: new THREE.Vector3() };
// Raw mouse movement works without a click. Race/resume gestures request lock; cursor offset is the fallback.
const look = { yaw: 0, pitch: 0, targetYaw: 0, targetPitch: 0, yawV: 0, pitchV: 0, idleT: 9, back: 0, backV: 0, dragging: false };
// The mouse never pans the view by itself (Settings > Camera > Mouse look is off by default): holding the right button, the
// right stick or free look moves it, and it returns to the road quickly once that stops.
const LOOK_RECENTRE_DELAY = 0.15, FREE_LOOK_RECENTRE_DELAY = 0.6, STALE_DRAG_RECENTRE_DELAY = 0.75;
const canLook = () => G.state === 'race' && !menu?.open && multiplayer.panel.hidden;
function moveLook(dx, dy, k = 0.0028) {
  look.targetYaw = clamp(look.targetYaw - dx * k * settings.mouseSensitivity, -Math.PI * 2 / 3, Math.PI * 2 / 3);
  look.targetPitch = clamp(look.targetPitch + dy * k * settings.mouseSensitivity * (settings.invertLookY ? -1 : 1), -0.25, 0.24);
  look.idleT = 0;
}
controls.mountMouseLook(canvas, { enabled: canLook, free: () => settings.mouseLook === true, move: moveLook,
  drag(on) { look.dragging = on; if (!on) look.idleT = Math.max(look.idleT, LOOK_RECENTRE_DELAY); },
  unlock() { if (G.state === 'race' && !towOffer.element) pauseGame(); },
});
canvas.addEventListener('contextmenu', e => { if (canLook()) e.preventDefault(); });
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
  if (!settings.mouseLook) controls.releaseMouseLook();
  const recentre = look.dragging ? STALE_DRAG_RECENTRE_DELAY : settings.mouseLook ? FREE_LOOK_RECENTRE_DELAY : LOOK_RECENTRE_DELAY;
  if (look.idleT > recentre) { look.targetYaw = damp(look.targetYaw, 0, 9, dt); look.targetPitch = damp(look.targetPitch, 0, 9, dt); }
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
const previousCameraQuat = new THREE.Quaternion();
function finishCamera(dt, trackedRoot = player.model.root) {
  if (cameraBlend.active) {
    // Keep a moving car framed while easing between views. A reset/swap rebases the anchor without moving it.
    const delta = _v2.copy(trackedRoot.position).sub(cameraBlend.trackPos);
    if (dt > 0 && cameraBlend.trackRoot === trackedRoot && delta.lengthSq() < 625) cameraBlend.pos.add(delta);
    cameraBlend.trackRoot = trackedRoot; cameraBlend.trackPos.copy(trackedRoot.position);
    cameraBlend.elapsed += dt;
    const t = clamp(cameraBlend.elapsed / cameraBlend.duration, 0, 1), ease = t * t * t * (10 + t * (-15 + 6 * t)); // zero velocity and acceleration at each end
    _v1.copy(camera.position);
    camera.position.lerpVectors(cameraBlend.pos, _v1, ease);
    _blendQ.copy(camera.quaternion);
    camera.quaternion.slerpQuaternions(cameraBlend.quat, _blendQ, ease);
    camera.fov = lerp(cameraBlend.fov, camera.fov, ease);
    if (t >= 1) cameraBlend.active = false;
  }
  if (G.cam !== 'cockpit') ground?.constrainCamera?.(camera.position, trackedRoot.position);
  // Apply the same angular response through the blend boundary, avoiding a one-frame change in turn speed.
  if (G.cameraReady && dt > 0) {
    const angle = previousCameraQuat.angleTo(camera.quaternion);
    const alpha = Math.min(-Math.expm1(-20 * dt), angle > 1e-6 ? 4.5 * dt / angle : 1);
    _blendQ.copy(camera.quaternion);
    camera.quaternion.slerpQuaternions(previousCameraQuat, _blendQ, alpha);
  }
  camera.updateProjectionMatrix(); G.cameraReady = true;
}
const _qForward = new THREE.Vector3();
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _m = new THREE.Matrix4();
const _blendQ = new THREE.Quaternion(); // finishCamera / cockpit-camera scratch: no per-frame clones
function applyCamMode() {
  if (!player) return;
  if (camState.mode !== G.cam) { beginCameraBlend(); camState.mode = G.cam; }
  document.body.dataset.cameraView = G.cam;
  const cock = G.cam === 'cockpit';
  player.cockpit.setVisible(cock);
  camera.near = cock ? 0.05 : 0.25; camera.updateProjectionMatrix(); // as far out as the cabin allows: depth precision at range
}
function noise1(t) { return Math.sin(t * 1.7) * 0.5 + Math.sin(t * 3.1 + 1.3) * 0.3 + Math.sin(t * 7.3 + 0.7) * 0.2; }
function updateCamera(dt, snap = false) {
  // Menus retain the rendered view exactly; no look spring, blend, or terrain constraint advances.
  if (G.state === 'paused' || multiplayer.active && inMenu()) return;
  previousCameraQuat.copy(camera.quaternion);
  snap ||= !!camState.retarget; camState.retarget = false;
  const watching = watchingDriver();
  if (watching) controls.releaseMouseLook(); // choosing whom to watch needs the pointer
  const targetCar = watching && (multiplayer.active ? remoteCars.get(watching.id) : watching.car);
  if (targetCar?.model.root.visible) {
    if (G.cam !== 'spectate') { G.cam = 'spectate'; applyCamMode(); }
    if (G.spectateId && G.spectateId !== watching.id) beginCameraBlend();
    // MP owner: keep remote visual pose sampling before this view; follow model.root rather than packet positions.
    const v = targetCar.veh, visible = targetCar.model.root.position, { back, up, targetY } = chaseRig(targetCar.spec, clamp(v.kmh / 260, 0, 1.2));
    const behind = _v2.set(0, 0, 1).applyQuaternion(targetCar.model.root.quaternion);
    const target = _v1.copy(visible).addScaledVector(behind, back); target.y = visible.y + up;
    const changed = G.spectateId !== watching.id; G.spectateId = watching.id;
    target.y = Math.max(target.y, route.surfaceY(v.s, v.u) + 0.6); springPosition(target, dt, snap || changed);
    camera.position.copy(camState.pos);
    camera.lookAt(visible.x, visible.y + targetY, visible.z); camera.fov = settings.chaseFov; camera.updateProjectionMatrix();
    // Keep your cockpit mirror out of the spectator view.
    finishCamera(dt, targetCar.model.root); return;
  }
  G.spectateId = null;
  if (G.cam === 'spectate') { G.cam = G.userCam; applyCamMode(); }
  const veh = player.veh, body = player.model.body, root = player.model.root, viewX=veh.x-(worldSession?.stream.origin.x||0),viewZ=veh.z-(worldSession?.stream.origin.z||0);
  root.updateMatrixWorld(true);
  const kmh = veh.kmh, sk = clamp(kmh / 260, 0, 1.2);
  G.shake = Math.max(0, G.shake - dt * 1.8);
  const rough = (veh.offroad ? 0.6 : 0.06) * sk + G.shake * 0.9;
  const t = G.paused?.t ?? G.t;
  updateLook(dt);
  if (G.cam === 'cockpit') {
    const eye = player.cockpit.eye, seat = seatPosition(player.spec.id);
    _v1.set(eye.x - veh.ay * 0.0025, eye.y + seat.height + noise1(t * 23) * 0.004 * rough, eye.z - seat.position + clamp(veh.ax, -12, 12) * 0.0035);
    body.localToWorld(_v1);
    camera.position.copy(_v1);
    body.getWorldQuaternion(_q);
    const lookYaw = -player.veh.steer * 0.12 - veh.w * 0.04 + clamp(look.yaw, -2.2, 2.2) + look.back;
    _e.set((player.cockpit.eyePitch ?? -0.045) - clamp(veh.ax, -12, 12) * 0.0012 - look.pitch * 0.8 + noise1(t * 31 + 5) * 0.004 * rough, lookYaw, noise1(t * 19 + 9) * 0.004 * rough + G.shake * Math.sin(t * 40) * 0.02, 'YXZ');
    camera.quaternion.copy(_q).multiply(_blendQ.setFromEuler(_e));
    // Mirror-fit is a model-inspection view; racing keeps the player's chosen vertical FOV.
    const baseFov = Q.has('mirrorfit') ? Math.max(settings.cockpitFov, player.cockpit.mirrorFov(camera.aspect)) : settings.cockpitFov;
    const fov = baseFov + (settings.speedFov ? Math.min(3, sk * 2 + (veh.nitroOn ? 1 : 0)) : 0);
    camState.fov = snap ? fov : damp(camState.fov, fov, 3, dt);
  } else if (G.cam === 'chase' || G.cam === 'far') {
    // Mouse orbit is temporary; the selected chase distance is controlled by the position key.
    const {back,up,targetY}=chaseRig(player.spec,sk);
    const distanceScale = G.cam === 'far' ? 1.55 : 1;
    const dist = Math.hypot(back, up) * distanceScale, el = chaseElevation(up, back, look.pitch);
    if (snap || camState.followYaw === undefined) { camState.followYaw = veh.yaw; camState.followYawV = 0; }
    const yawTarget = camState.followYaw + Math.atan2(Math.sin(veh.yaw - camState.followYaw), Math.cos(veh.yaw - camState.followYaw));
    spring(camState, 'followYaw', 'followYawV', yawTarget, 12, dt);
    const hd = camState.followYaw + look.yaw + look.back, hx = Math.sin(hd), hz = Math.cos(hd); // forward is (-sin yaw, -cos yaw): behind is +
    const target = _v1.set(viewX + hx * Math.cos(el) * dist, veh.y + Math.sin(el) * dist, viewZ + hz * Math.cos(el) * dist);
    // Follow translation directly; the spring damps the camera offset, keeping its distance natural at speed.
    if (!snap && camState.carX !== undefined) { camState.pos.x += viewX - camState.carX; camState.pos.z += viewZ - camState.carZ; }
    target.y = Math.max(target.y, route.surfaceY(veh.s, veh.u) + 0.6);
    springPosition(target, dt, snap, look.idleT < 1.5 || look.back > 0.01 ? 16 : 10);
    camera.position.copy(camState.pos);
    // look ahead of the car when behind it; at the car itself once swung round to the side / front
    const ahead = 5 * Math.max(0, Math.cos(look.yaw + look.back)) * clamp(1 - look.pitch, 0, 1);
    const lk = _v2.set(viewX, veh.y + targetY, viewZ).addScaledVector(_qForward.set(-Math.sin(camState.followYaw), 0, -Math.cos(camState.followYaw)), ahead);
    camera.lookAt(lk);
    const fov = settings.chaseFov + (settings.speedFov ? Math.min(3, sk * 2 + (veh.nitroOn ? 1 : 0)) : 0);
    camState.fov = snap ? fov : damp(camState.fov, fov, 3, dt);
  } else if (G.cam === 'bumper' || G.cam === 'hood') {
    const fx = -Math.sin(veh.yaw), fz = -Math.cos(veh.yaw);
    const forward = Math.max(1, (player.spec.length || 4) * (G.cam === 'bumper' ? 0.51 : 0.36));
    const height = G.cam === 'bumper' ? clamp((player.spec.height || 1.5) * 0.52, 0.68, 1.05) : clamp((player.spec.height || 1.5) * 0.85, 1.18, 2.5);
    camera.position.set(viewX + fx * forward, veh.y + height, viewZ + fz * forward);
    const facing = veh.yaw + look.back + look.yaw;
    camera.lookAt(camera.position.x - Math.sin(facing) * 24, camera.position.y + 0.15 - look.pitch * 8, camera.position.z - Math.cos(facing) * 24);
    const fov = settings.chaseFov + (settings.speedFov ? Math.min(3, sk * 2 + (veh.nitroOn ? 1 : 0)) : 0);
    camState.fov = snap ? fov : damp(camState.fov, fov, 3, dt);
  } else { // orbit
    G.orbitA += dt * 0.25;
    const r = 6.8, a = G.orbitA + veh.yaw;
    const target = _v1.set(viewX + Math.sin(a) * r, veh.y + 1.7, viewZ + Math.cos(a) * r);
    target.y = Math.max(target.y, route.surfaceY(veh.s, veh.u) + 0.6); springPosition(target, dt, snap, 8);
    camera.position.copy(camState.pos);
    camera.lookAt(viewX, veh.y + 0.7, viewZ);
    camState.fov = damp(camState.fov, 50, 3, dt);
  }
  camState.carX = viewX; camState.carZ = viewZ;
  camera.fov = camState.fov; finishCamera(dt);
  // debug view relative to the player car: ?view=right,up,back,lookAhead
  if (DBG_VIEW) {
    const f = veh.forward(_v2), rx = Math.cos(veh.yaw), rz = -Math.sin(veh.yaw);
    camera.position.set(viewX + rx * DBG_VIEW[0] - f.x * DBG_VIEW[2], veh.y + DBG_VIEW[1], viewZ + rz * DBG_VIEW[0] - f.z * DBG_VIEW[2]);
    camera.lookAt(viewX + f.x * DBG_VIEW[3] + rx * (DBG_VIEW[4] || 0), veh.y + (DBG_VIEW[5] ?? 1), viewZ + f.z * DBG_VIEW[3] + rz * (DBG_VIEW[4] || 0));
  }
}
const DBG_VIEW = Q.has('view') ? Q.get('view').split(',').map(Number) : null;

// ------------------------------------------------------------------ main loop
let last = 0, frameN = 0;
const frameLimiter = new FrameLimiter();
const perfGovernor = new PerfGovernor({ ceiling: storedPerfCeiling() });
window.__perfGovernor = perfGovernor;
const MAX_SLICES = 10; // a half-second hitch is caught up in at most 10 slices, not 30
const events = [];
const ACTORS = [{ veh: null, kind: 'player' }, { veh: null, kind: 'rival' }];
const sunScreen = new THREE.Vector3();
const bootFrameLog = text => { if (frameN === 1) tlog(text); };
function frame(now) {
  requestAnimationFrame(frame);
  // The hidden-online timer owns simulation until visibility returns. Ignore a queued older frame.
  if (multiplayer.active && (document.hidden || now < last)) return;
  // Frame rate limit (Settings > Graphics, default 60): skip vsync callbacks that arrive early, so a 120 Hz laptop
  // screen doesn't simulate and draw everything twice as often (heat, fan noise, battery). NO LIMIT (0) never skips:
  // every requestAnimationFrame callback, at the display's refresh, simulates and draws.
  perfOverlay.tick();
  if (!Q.has('fixeddt') && !frameLimiter.allow(now, settings.frameCap)) return;
  const cpuFrameStart = cpuMetrics.start(), frameStart = performance.now();
  const wallDt = Math.max(0, (now - last) / 1000);
  let dt = Math.min(0.5, wallDt); last = now;
  if (Q.has('fixeddt')) dt = 1 / 60;
  G.lastDt = dt;
  G.simNow = now - dt * 1000; // the clock the simulation state stands at: slices advance it, and the online sender stamps samples with it
  if (settings.dynamicResolution && !document.hidden && !Q.has('fixeddt') && (G.state === 'race' || G.state === 'onlineRace')) {
    const ratio = dynamicScale.sample(wallDt * 1000);
    if (ratio !== null && ratio !== pixelRatio) { pixelRatio = ratio; onResize(); post?.resetHistory(); }
  }
  perfOverlay.frame(wallDt);
  G.fps = G.fps ? G.fps * 0.95 + 0.05 / Math.max(1e-3, (now - (G.lastNow || now - 16)) / 1000) : 60; G.lastNow = now;
  const reps = +(Q.get('turbo') || 1);
  // A long frame is simulated in <= 1/60 s slices (physics, AI, traffic), but the HUD, audio, camera and visuals run once
  // per displayed frame (the last slice, with the whole frame's time). They used to run in every slice, so a slow frame
  // (a weak laptop at 20 fps = 3 slices) cost 3x the HUD / audio / sync work and got slower still: the lag spiral.
  const slices = Math.min(MAX_SLICES, Math.max(1, Math.ceil(dt / (1 / 60) - 1e-6)));
  try { for (let i = 0; i < reps; i++) for (let j = 0; j < slices; j++) { const last = i === reps - 1 && j === slices - 1; step(dt / slices, last, last, dt); } } catch (e) { if (G.ctxLost || renderer.getContext().isContextLost()) return; fail(e); throw e; }
  if (splash) splash.update(dt);
  if (player) drivingHints.update({ state: G.state, device: activeInputDevice(), car: player.spec, manual: player.veh.manual, blocked: !!menu?.open || !multiplayer.panel.hidden });
  if (input.handbrake) drivingHints.action('handbrake');
  if (player) {
    const watching = multiplayer.spectating(), selectedDriverVehicle = watching ? remoteCars.get(watching.id)?.veh ?? null : player.veh;
    updateEngineHud(selectedDriverVehicle, { visible: ['race', 'onlineFinished', 'onlineWrecked'].includes(G.state) && !menu?.open && multiplayer.panel.hidden, spectating: !!watching, towLabel: bindingLabel(controls.bindings, activeInputDevice() === 'gamepad' ? 'down' : 'tow', activeInputDevice()), gamepad: activeInputDevice() === 'gamepad', confirmLabel: bindingLabel(controls.bindings,'confirm',activeInputDevice()), repairAvailable: G.state === 'race' && !G.towing && !multiplayer.retired && !watching, towCost: 0, onRepair: () => tow(player.veh) });
    drivingFeedback.update({ vehicle: selectedDriverVehicle, route: selectedDriverVehicle?.route || route, dir: inFreeRoam() ? undefined : multiplayer.active ? multiplayer.lobby.event?.dir || 1 : G.dir || 1, visible: ['race', 'onlineFinished', 'onlineWrecked'].includes(G.state) && !menu?.open && multiplayer.panel.hidden && !G.towing, spectating: !!watching, driverName: watching?.name || '', units: settings.units, wetGrip: WEATHER.gripScale, endS: !inFreeRoam() && !route?.closed ? G.ev?.r.s1 : undefined });
  }
  cpuMetrics.frame(cpuFrameStart);
  // Frame governor: a machine that keeps missing its budget (and where dynamic resolution cannot help) drops a performance class.
  if (!document.hidden && !Q.has('fixeddt') && (G.state === 'race' || G.state === 'onlineRace' || G.state === 'countdown') && !menu?.open) {
    const pixelBound = settings.dynamicResolution && dynamicScale.ratio > dynamicScale.min * 1.02 && dynamicScale.holdT <= 0;
    const next = perfGovernor.sample(wallDt * 1000, performance.now() - frameStart, 1000 / (settings.frameCap || 60), GFX.perfClass, { dt: wallDt, pixelBound });
    if (next) { console.info(`performance class ${GFX.perfClass} -> ${next}`, perfGovernor.last); setSetting('perfClass', next); }
  }
}

function step(dt, draw = true, visual = true, frameDt = dt) {
  // A queued first frame can predate boot's clock reset. Integrators require a positive timestep.
  if (!(dt > 0) || mapSwitch) return;
  if(G.routePreparing){readInput(dt);return;}
  if (menu?.accounts?.blocked) { readInput(dt); return; }
  if (!world || !player || G.state === 'menu') { readInput(dt); return; }
  G.t += dt; frameN++;
  bootFrameLog('first-frame');
  readInput(dt);
  if(worldSession){try{drawUnifiedFrame(dt,draw,visual,frameDt);}catch(error){G.state='loading';G.routePreparing=true;loading.show('athens',G.unifiedCompiled.definition.name);loading.setRoute(G.unifiedCompiled);loading.fail({code:errorCode(error),retry:()=>location.reload(),fallback:()=>quitToMenu()});console.error(error);}return;}
  if (multiplayer.active && inMenu() && G.pFinish == null) { player.veh.vLong = player.veh.vLat = player.veh.w = 0; player.veh.syncWheels(); }
  if (multiplayer.active) multiplayer.update(dt, networkState(player.veh), G.simNow);
  if (G.state === 'onlineFinished') updateFinishView();
  G.simNow += dt * 1000;
  if (!multiplayer.active && grid.length) rival = focusRival(); // the car the HUD gap, audio and slipstream follow
  const pv = player.veh, rv = rival.veh;
  ACTORS[0].veh = pv; ACTORS[1].veh = rv;
  const simulate = G.state !== 'menu' && G.state !== 'garage' && G.state !== 'loading' && G.state !== 'paused' && !(multiplayer.active && inMenu() && G.pFinish == null) && (multiplayer.active || multiplayer.panel.hidden);
  if (!multiplayer.active) tickWorldLife(dt, { running: simulate });
  if (simulate && !multiplayer.active) updateRoadWeather(dt);
  onlineWorldVisibility(multiplayer.active, { people, fx, splash }); setOnlineWeather(multiplayer.active);
  sharedWorld.update(dt);
  if (multiplayer.active && multiplayer.lobby.startAt) signals.t = (multiplayer.now() - multiplayer.lobby.startAt) / 1000 - dt;
  const cpuSignals = cpuMetrics.start();
  if (simulate || multiplayer.active) signals.update(dt, pv.s, camera.position);
  cpuMetrics.end('signals', cpuSignals);
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
      const cpuPhysics = cpuMetrics.start();
      if (G.pFinish === null) pv.update(dt, pin);
      else { pv.vLong = pv.vLat = pv.w = 0; pv.syncWheels(); }
      cpuMetrics.end('playerPhysics', cpuPhysics);
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
      const cpuRivals = cpuMetrics.start();
      updateGrid(dt); // the AI field: racing lines, traffic, red lights (offline)
      cpuMetrics.end('rivals', cpuRivals);
      }
      // ---- stop lines: camera or police witness, with optional game-time laws
      const D = G.dir || 1, pf = pv.s + D * pv.halfL, rf = rv.s + rv.halfL;
      if (G.state === 'race' && G.pFront !== null && pv.vLong > 0) { const j = crossedDir(G.pFront, pf, D); if (j) onStopLine(j, 'player'); }
      G.pFront = D > 0 ? Math.max(G.pFront ?? pf, pf) : Math.min(G.pFront ?? pf, pf); G.rFront = Math.max(G.rFront ?? rf, rf);
      // ---- traffic + collisions
      _actors[0].veh = pv;
      _actors.length = multiplayer.active ? 1 : 1 + grid.length;
      if (!multiplayer.active) for (let i = 0; i < grid.length; i++) _actors[i + 1] = grid[i].actor;
      const actors = _actors;
      const cpuTraffic = cpuMetrics.start();
      // the lowest class runs the traffic AI at 30 Hz (it accumulates the skipped steps' time); everyone else every step
      if (!multiplayer.active) { G.trafficAcc = (G.trafficAcc || 0) + dt; if (G.trafficAcc >= 1 / (GFX.trafficHz ?? 60) - 1e-4) { traffic.update(G.trafficAcc, pv.s, G.pFinish === null ? actors : actors.slice(1)); G.trafficAcc = 0; } }
      cpuMetrics.end('traffic', cpuTraffic);
      events.length = 0;
      if (G.pFinish === null && (!multiplayer.active || multiplayer.lobby.traffic || police?.enabled) && !(G.autodrive && player.ai && player.ai.passT > 0)) traffic.collide(actors[0], events, G.t);
      // out of sight a rival is not held up by traffic (they know these roads); in sight they race for real (updateGrid)
      if (!multiplayer.active) for (const c of grid) if (!c.ghost) { const n0 = events.length; traffic.collide(c.actor, events, G.t); for (let k = n0; k < events.length; k++) events[k].racer = c; }
      if (!multiplayer.active) racerCollide(dt);
      else {
        multiplayer.contacts ||= new Map();
        const now = performance.now(), simNow = Number.isFinite(G.simNow) && Math.abs(G.simNow - now) < 1000 ? G.simNow : now;
        if (contactCoordinator.raceId !== multiplayer.lobby.raceId) contactCoordinator.reset(multiplayer.lobby.raceId);
        // Contacts are tested against where the other car most likely is NOW (not its delayed drawn pose), and reported so the
        // other driver applies the matching impulse (src/multiplayer-contact.js).
        multiplayer.lastContacts = G.state === 'race' && !holdingRecovery ? contactCoordinator.step(pv, [...remoteCars].map(([id, car]) => {
          const peer = multiplayer.peers.get(id), member = multiplayer.lobby.players.find(p => p.id === id);
          // At the time THIS physics slice stands at (a slow frame runs several slices at one wall-clock time): the other car then moves
          // between slices too, so a long frame cannot tunnel through it.
          const pose = peer?.state && remoteContactPose(peer, simNow, member?.finish != null || !!member?.dnf), proxy = car.contactProxy ||= {};
          if (pose) Object.assign(proxy, { x: pose.x, y: pose.y, z: pose.z, yaw: pose.yaw, vLong: pose.vLong, vLat: pose.vLat, stale: pose.stale === true, halfW: car.veh.halfW, halfL: car.veh.halfL, m: car.veh.m, hcg: car.veh.hcg });
          return { id, vehicle: pose ? proxy : car.veh, age: pose?.parked ? 0 : peer ? now - peer.at : Infinity, ghost: !pose || !member?.loaded || member.connected === false || member.dnf || member.finish != null || peer.state.recoveryUntil > multiplayer.now() };
        }), dt, now, { rtt: multiplayer.latency }) : [];
        for (const hit of multiplayer.lastContacts) {
          playerImpactVoice({ kind: 'crash', dv: hit.impulse });
          if (hit.impulse > 1.5 && G.t - (G.mpHitT || 0) > 0.25) { G.mpHitT = G.t; G.shake = Math.max(G.shake, clamp(0.08 + hit.impulse / 16, 0, 0.8)); audio.crash(hit.impulse > 8 ? 'heavy' : 'light', Math.min(1, (hit.impulse / 14) ** 1.4)); controls.rumble(Math.min(1, hit.impulse / 12), 0.6, 220); }
        }
        containOnlineVehicle(pv, route);
      }
      // Online the units are shared (src/mp-shared-world.js); this client judges only its own driver.
      if (police && multiplayer.active && police.enabled && !sharedWorld.authority) traffic.setRacers(actors);
      const cpuPolice = cpuMetrics.start();
      if (police) for (const e of police.update(dt, { events, racing: G.state === 'race', dir: G.dir || 1, eventId: G.run?.id })) onPolice(e);
      cpuMetrics.end('police', cpuPolice);
      if (Q.has('nantrap') && !G.nanC && !isFinite(pv.x + pv.vLong + rv.x + rv.vLong)) { G.nanC = 1; console.warn('NaN after collisions', pv.s, rv.s); }
      if (G.state === 'race') handleEvents(events);
      for (const h of traffic.honks) handleHonk(h);
      traffic.honks.length = 0;
      handleTrafficSounds();
      if (pv.bumpHit > 0.1) G.shake = Math.max(G.shake, pv.bumpHit * 0.22);
      // a racing wheel's force feedback (when the browser lets the wheel rumble): grip limit and kerbs, ~8 times a second
      if (G.state === 'race' && controls.wheelActive) controls.wheelFeedback(() => ({ frontSlip: pv.tyreTelemetry?.front?.slipDemand ?? 0, kerb: Math.max(pv.curbHit || 0, pv.bumpHit || 0), speed: Math.abs(pv.vLong) }));
      if (pv.wallHit > 2.5 && G.state === 'race') { playerImpactVoice({ kind: 'wall', dv: pv.wallHit }); audio.scrape(Math.min(1, pv.wallHit / 10)); G.shake = Math.max(G.shake, Math.min(0.85, 0.06 + (pv.crashDv || pv.wallHit) / 16)); }
      if (pv.scrapeDv > 0 && G.state === 'race') audio.scrape(Math.min(1, Math.hypot(pv.vLong, pv.vLat) / 22), pv.scrapeMaterial);
      if (pv.wallHit > 3) { fx.sparks(pv, pv.wallHit / 12); controls.rumble(Math.min(1, pv.wallHit / 10), 0.6, 220); }
      if (!multiplayer.active) for (const c of grid) if (c.veh.wallHit > 3) fx.sparks(c.veh, c.veh.wallHit / 12);
      // kerb strikes: a thump (scrape when the tyre rubs along the face), a jolt through the camera
      if (pv.curbHit > 0.12 && G.t - (G.curbT || 0) > 0.08) { G.curbT = G.t; audio.curb(Math.min(1, pv.curbHit * (pv.curbScrape ? 0.7 : 1.2))); if (pv.curbScrape) audio.scrape(0.25); G.shake = Math.max(G.shake, pv.curbHit * 0.3); controls.rumble(pv.curbScrape ? 0.15 : 0.5 * pv.curbHit, pv.curbScrape ? 0.5 : 0.8 * pv.curbHit, pv.curbScrape ? 140 : 110); }
      pv.wallHit = 0; rv.wallHit = 0; pv.crashDv = 0; rv.crashDv = 0; pv.scrapeDv = 0; for (const c of grid) { c.veh.wallHit = 0; c.veh.crashDv = 0; }
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
        advanceRivalCourses(dt);
        G.finishedT += dt; G.raceT += 0; // clock stopped
        updateFinishView();
      } else if (G.state === 'results') {
        G.postT += dt;
        let changed = false;
        const finishCount = grid.filter(c => c.finish !== null).length;
        advanceRivalCourses(dt); changed = grid.filter(c => c.finish !== null).length !== finishCount;
        if (changed && menu.screen === 'results') showResults();
      }
    }
  }
  // ---- people (they live on during the countdown too)
  if (simulate && !multiplayer.active) { const cpuPeople = cpuMetrics.start(); people.update(dt, peopleS(pv.s), ACTORS, camera.position); police?.pedEvents(people.events); handlePeople(); cpuMetrics.end('people', cpuPeople); }
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
        if (nj.ped && d < 70) { G.tickT -= dt; if (G.tickT <= 0) { G.tickT = nj.pedLeft < 2.2 ? 0.22 : 0.55; audio.pedTick(nj.pedLeft < 2.2, 0.3, Math.max(0, 1 - d / 60) ** 2); } }
      }
    }
    hud.signal(info);
  }
  bootFrameLog('frame-simulation');
  if (!visual) return; // an earlier slice of a long frame: the last one updates the picture, HUD and sound
  dt = frameDt;
  // ---- visuals
  syncCar(player, simulate ? dt : 0); if (multiplayer.active || !grid.length) syncCar(rival, simulate ? dt : 0); else for (const c of grid) syncCar(c, simulate ? dt : 0);
  // Tyre smoke, rubber marks, grit and sparks run online too: this driver's own car and every nearby visible rival.
  _fxVehs.length = 0; _fxVehs.push(pv);
  if (multiplayer.active) { for (const c of remoteCars.values()) if (c.veh !== pv && c.model.root.visible && Math.hypot(c.veh.x - pv.x, c.veh.z - pv.z) < REMOTE_FX_RANGE) _fxVehs.push(c.veh); }
  else for (let i = 0; i < grid.length; i++) _fxVehs.push(grid[i].veh);
  fx.update(simulate ? dt : 0, _fxVehs, camera, innerHeight * pixelRatio);
  traffic.sync(pv.s);
  if (police) { police.sync(G.t); policeHud.update(dt); }
  // Select own-car glass/structure visibility; the empty cabin stays visible outside.
  player.cockpit.setDetail(G.cam === 'cockpit');
  player.cockpit.setVisible(G.cam === 'cockpit');
  player.cockpit.update(dt, { vehicle: pv, ignition: ['countdown', 'onlineCountdown', 'race'].includes(G.state), aidsOff: !settings.aids, lowBeam: !!ENV.COND_STATE.headlights, highBeam: !!pv.highBeam, indicator: pv.indicator, hazards: pv.hazards, handbrake: (input.handbrake || pv.handbrakeInput === true) && G.state === 'race', manual: pv.manual, gearChangeEvent: pv.gearChangeEvent, steerInput: pv.steer / Math.max(0.05, pv.lockAt(Math.abs(pv.vLong))) * (0.55 + 0.45 * Math.min(1, pv.lockAt(Math.abs(pv.vLong)) / pv.spec.steer * 2.5)), rpm: pv.rpm, redline: pv.spec.redline, gear: pv.gear, gearLabel: pv.reverse ? 'R' : String(pv.gear), kmh: pv.kmh, nitrous: pv.spec.nitrous === true, nitro: pv.nitro, nitroOn: pv.nitroOn });
  window.__ghostLap?.visual(dt);
  updateCamera(dt);
  const finishWatched = watchingDriver();
  updateFinishSpectateHud({ visible: !!finishWatched && !inMenu(), name: finishWatched?.name, position: multiplayer.active ? multiplayer.ranking().findIndex(p => p.id === finishWatched?.id) + 1 : finishWatched?.position, time: fmtTime(G.pFinish), ownPosition: multiplayer.active ? multiplayer.ranking().findIndex(p => p.id === multiplayer.id) + 1 : racePosition() });
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
  const cpuHud = cpuMetrics.start();
  // HUD
  let gap = NaN, pos = 1, gapUnit = 's';
  if (!multiplayer.active && G.ev && !inFreeRoam()) ({ gap, pos, gapUnit = 's' } = raceGap());
  updateEventHud(dt);
  G.shiftFlash = Math.max(0, (G.shiftFlash || 0) - dt);
  if (pv.shiftEvent) { G.shiftFlash = 0.25; }
  G.lampTC = pv.tcOn ? 0.35 : Math.max(0, (G.lampTC || 0) - dt); G.lampABS = pv.absOn ? 0.35 : Math.max(0, (G.lampABS || 0) - dt); G.lampESC = pv.escOn ? 0.35 : Math.max(0, (G.lampESC || 0) - dt);
  const st = { damageLabel: pv.engineStalled || pv.drivetrainBroken ? 'ENGINE STOP' : pv.coolantTemp >= ENGINE_HOT_C ? 'OVERHEATING' : pv.engHealth <= .55 ? 'LIMP MODE' : pv.damageSignificant ? 'DAMAGE' : '', aidsOff: !settings.aids, tc: G.lampTC > 0, abs: G.lampABS > 0, esc: G.lampESC > 0, pos, time: G.pFinish ?? (G.raceT + G.pen), gap, pen: G.pen, junctions: signals.J, s: pv.s, rs: rv.s, rpm: pv.rpm, redline: pv.spec.redline, kmh: speedIn(pv.kmh), unit: speedUnit(),
    manual: pv.manual, limiter: pv.limiter, canUpshift: !pv.engineStalled && !(pv.engHealth <= 0) && !pv.reverse && pv.gear < pv.spec.gears.length && pv.shiftT <= 0,
    gearLabel: pv.reverse ? 'R' : (G.state === 'countdown' ? 'N' : String(pv.gear)), nitrous: pv.spec.nitrous === true, nitro: pv.nitro, nitroOn: pv.nitroOn, shiftFlash: G.shiftFlash, draft: G.draft || 0,
    free: inFreeRoam(), x: pv.x, z: pv.z, yaw: pv.yaw, rx: grid.length || multiplayer.active ? rv.x : null, rz: grid.length || multiplayer.active ? rv.z : null, traffic: traffic.cars, limit: speedLimitAt(map, pv.x, pv.z, pv.s) };
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
  if (!multiplayer.active && finishWatched?.car) {
    const v = finishWatched.car.veh, spec = finishWatched.car.spec;
    // The frozen player progress must not leak into the gap: the watched driver trails the race leader.
    let leaderProg = earnedProgress(), leaderName = 'YOU';
    for (const c of grid) { const p = earnedProgress(c); if (p > leaderProg) { leaderProg = p; leaderName = c.name; } }
    if (leaderName) $('rivalName').textContent = leaderName;
    Object.assign(st, { pos: finishWatched.position, time: G.raceT + G.postT, gap: leaderProg - earnedProgress(finishWatched.car), gapUnit: 'm', kmh: speedIn(v.kmh), rpm: v.rpm, redline: spec.redline, gearLabel: v.reverse ? 'R' : String(v.gear), x: v.x, z: v.z, yaw: v.yaw, s: v.s, manual: false, canUpshift: false, damageLabel: '', tc: false, abs: false, esc: false, nitrous: spec.nitrous === true, nitro: v.nitro, nitroOn: v.nitroOn });
  }
  routeGuidance?.update({cursorS:(pv.s-G.ev.r.s0)*G.ev.r.dir,position:pv,isRace:!inFreeRoam()&&!isDrivingMode(G.ev?.def)&&['race','countdown','onlineCountdown'].includes(G.state)});
  hud.update(st);
  const watched = multiplayer.active ? multiplayer.spectating() : null;
  const swayCar = (watched && remoteCars.get(watched.id)?.veh) || pv;
  swayInput.active = (G.state === 'race' || G.state === 'countdown' || G.state === 'onlineCountdown') && !inMenu() && !G.paused;
  swayInput.cam = G.cam; swayInput.mode = settings.hudMotion;
  swayInput.ax = swayCar.ax; swayInput.ay = swayCar.ay; swayInput.heave = swayCar.pose?.heave;
  swayInput.lookYaw = look.yaw + look.back; swayInput.lookPitch = look.pitch;
  hudSway.update(dt, swayInput);
  if (st.gapUnit) $('gap').textContent = !Number.isFinite(st.gap) ? '—' : `${st.gap >= 0 ? '+' : '−'}${Math.abs(st.gap).toFixed(st.gapUnit === 'm' ? 0 : 2)} ${st.gapUnit}`;
  for (const id of ['posBox', 'timeBox', 'gapBox', 'evBox']) { const el = $(id); if (el) { const hidden = inFreeRoam(); if (el.hidden !== hidden) el.hidden = hidden; const display = hidden ? 'none' : ''; if (el.style.display !== display) el.style.display = display; } }
  if (inFreeRoam()) { $('tRace').textContent = '—'; $('posN').textContent = '—'; }
  if (multiplayer.retired && !multiplayer.spectating()) { $('posN').textContent = 'DNF'; $('posSuf').textContent = ''; $('tRace').textContent = '—'; }
  updateLapHud(G.run, !finishWatched && !multiplayer.active && !isDrivingMode(G.ev?.def) && !MENU_STATES.includes(G.state));
  const onlineObjective = multiplayer.active && isDrivingMode(multiplayer.lobby?.mode || multiplayer.lobby?.event?.type);
  const watchedObjective = onlineObjective ? multiplayer.spectating?.() : null;
  const objective = onlineObjective ? (watchedObjective || multiplayer.me)?.objective : G.run?.objective;
  const objectiveRoutes = onlineObjective ? multiplayer.lobby.event?.objectiveRoutes : G.run?.routes;
  drivingModeView?.update(objective, objectiveRoutes, ['race', 'onlineFinished', 'onlineWrecked'].includes(G.state) && !menu?.open && multiplayer.panel.hidden);
  if (isDrivingMode(G.ev?.def) || onlineObjective) {
    for (const id of ['posBox', 'gapBox', 'timeBox']) { const el = $(id); if (el) { el.hidden = true; el.style.display = 'none'; } }
    if (onlineObjective) {
      const box = $('evBox'), selectedPose = watchedObjective ? remoteCars.get(watchedObjective.id)?.veh : pv;
      const content = drivingModeHud(objective, objectiveRoutes || [], selectedPose); if (box._objectiveHtml !== content || box._objectiveNode !== box.firstChild) { box.innerHTML = content; box._objectiveHtml = content; box._objectiveNode = box.firstChild; } box.classList.toggle('on', !!objective); notifications.dismiss('wrong-way'); objectiveNotice(objective,objectiveRoutes||[],selectedPose);
    }
  }
  if (G.cam === 'cockpit' && (frameN & 3) === 0) { const c = player.cockpit; hud.drawMinimap(c.navCanvas.getContext('2d'), c.navCanvas.width, c.navCanvas.height, st, 3.4, true); c.navTex.needsUpdate = true; }
  cpuMetrics.end('hud', cpuHud);
  bootFrameLog('frame-hud');
  // audio
  const cpuAudio = cpuMetrics.start();
  updateAudio(dt);
  cpuMetrics.end('audio', cpuAudio);
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
  const cpuRender = cpuMetrics.start();
  if (draw && (multiplayer.panel.hidden || G.resultPhotoPending)) render();
  cpuMetrics.end('renderSubmission', cpuRender);
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

function render() {
  if (!world || mapSwitch || G.state === 'menu') return;
  if (G.ctxLost || renderer.getContext().isContextLost()) return;
  guardLighting();
  const photoCamera = G.resultPhotoPending ? { position: camera.position.clone(), quaternion: camera.quaternion.clone(), fov: camera.fov } : null;
  if (photoCamera) { const v = player.veh; camera.position.set(v.x + Math.cos(v.yaw) * 6 + Math.sin(v.yaw) * 5, v.y + 2.6, v.z - Math.sin(v.yaw) * 6 + Math.cos(v.yaw) * 5); camera.lookAt(v.x, v.y + .65, v.z); camera.fov = 55; camera.updateProjectionMatrix(); }
  // Camera blends and result photos can be outside while the selected mode is POV.
  const cockpitInView = syncCameraVehicleView(player.model, camera, G.cam, !!photoCamera);
  renderer.info.autoReset = false; renderer.info.reset();
  ENV.updateWorldBlend(G.lastDt || 1 / 60);
  if(!worldSession)updateWeather(G.lastDt || 1 / 60);
  // The one look (graphics.js RENDER): no shadow maps, no car reflection probe re-renders, no sea reflection pass.
  if ((frameN % 6) === 0 || camera.position.distanceToSquared(lodAt) > 1e4) updateLod(); // and at once after a teleport / reset
  sky.position.copy(camera.position);
  // In-car mirrors only (Settings > Graphics > Mirrors: Off / Low / High). Owner-locked: the chase / third-person
  // camera never renders a mirror or a rear-view strip, and never pays for the mirror pass (docs/OWNER-DECISIONS.md).
  const mirrorQ = mirrorQuality(settings.mirrors, GFX.perfClass);
  if (mirrorsInView(G.cam)) { if (cockpitInView) player.cockpit.renderMirrors(renderer, scene, { enabled: mirrorQ !== 'off', quality: mirrorQ }); }
  // post: depth of field for the orbit cameras
  const orbit = G.cam === 'orbit';
  post.comp.uDof.value = orbit ? 5.5 : 0;
  if (orbit) post.comp.uFocus.value = camera.position.distanceTo(_v1.set(player.veh.x, player.veh.y + 0.7, player.veh.z));
  post.render(G.lastDt || 1 / 60);
  const metric = assetMetrics.maps[map.id];
  if (metric && metric.firstRaceFrameMs == null && ['race', 'onlineRace'].includes(G.state)) {
    metric.firstRaceFrameMs = performance.now() - metric.started;
    metric.peakHeapBytes = Math.max(metric.peakHeapBytes || 0, heapBytes() || 0) || null;
    metric.gpu = estimateSceneMemory(scene);
  }
  if (photoCamera) { G.resultPhoto = captureResultFrame(canvas); G.resultPhotoPending = false; camera.position.copy(photoCamera.position); camera.quaternion.copy(photoCamera.quaternion); camera.fov = photoCamera.fov; camera.updateProjectionMatrix(); syncCameraVehicleView(player.model, camera, G.cam); }
}

function onResize() {
  const w = innerWidth, h = innerHeight;
  const out = outputRatio(pixelRatio, window.devicePixelRatio);
  renderer.setPixelRatio(out); renderer.setSize(w, h);
  camera.aspect = w / h; camera.updateProjectionMatrix();
  if (post) post.setSize(w, h, pixelRatio, out);
  if (water) water.setSize(w * pixelRatio, h * pixelRatio);
}
addEventListener('resize', onResize);

// Multiplayer owns the online state machine; offline racing retains its AI rival.
const remoteCars = new Map();
const racerMarkers = new RacerMarkers();
const hudSway = createHudSway({ near: [$('hudMotionCluster'), $('hudMotionMap')], far: [$('hudMotionFar')] });
const swayInput = { active: false, cam: 'cockpit', mode: 'subtle', ax: 0, ay: 0, heave: 0, lookYaw: 0, lookPitch: 0 };
const markerPoint = new THREE.Vector3(), markerView = new THREE.Vector3();
const _markerItems = [];
function updateRacerMarkers() {
  const visible = ['race', 'countdown', 'onlineCountdown'].includes(G.state) && !menu?.open && multiplayer.panel.hidden;
  camera.updateMatrixWorld();
  let n = 0;
  const pushMarker = (id, c, name, player) => {
    if (!c.model.root.visible) return;
    markerPoint.set(c.veh.x, c.veh.y + 2.4, c.veh.z);
    const distance = markerPoint.distanceTo(camera.position);
    markerView.copy(markerPoint).applyMatrix4(camera.matrixWorldInverse); markerPoint.project(camera);
    const m = n < _markerItems.length ? _markerItems[n] : (_markerItems[n] = {});
    n++;
    m.id = id; m.name = name; m.player = player; m.distance = distance;
    m.x = markerPoint.x; m.y = markerPoint.y; m.behind = markerView.z >= 0;
    m.viewX = markerView.x; m.viewY = markerView.y;
  };
  if (visible) {
    if (multiplayer.active) {
      if (settings.playerMarkers) for (const [id, c] of remoteCars) pushMarker(id, c, c.networkName, true);
    } else if (settings.rivalMarkers) {
      for (let i = 0; i < grid.length; i++) pushMarker('ai-' + i, grid[i], grid[i].name, false);
    }
  }
  _markerItems.length = n;
  racerMarkers.update(_markerItems);
}
const networkState = v => ({ recordMeta: { tc: settings.aids, abs: settings.abs, steering: steeringAssistChoice(settings.steeringAssist, activeInputDevice()), gearbox: v.manual ? 'manual' : 'auto', carName: v.spec.name },  ...Object.fromEntries(['x', 'y', 'z', 'yaw', 's', 'u', 'vLong', 'vLat', 'steer', 'rpm', 'gear', 'nitro', 'reverse'].map(k => [k, v[k]])), nitro: v.spec.nitrous === true ? v.nitro : 0, braking: input.brake > .3, damage: { ...v.damage }, ...spectatorState(v), paint: player.model.paintColor, pursuit: police?.online ? police.pursuitCode() : 0 });
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
      if (![...remoteCars.values()].includes(rival)) { c = rival; c.spec = spec; c.veh.setSpec(spec); disposeCar(c); const built = makeCar(spec, false, p.plate); c.model = built.model; }
      else c = { spec, veh: new Vehicle(spec, route), ...makeCar(spec, false, p.plate) };
      c.ai = c.ai || { lane: 0, cool: 0 }; c.plate = p.plate || null;
      c.veh.reset(startS, route.laneU(startS, 0)); remoteCars.set(p.id, c);
    }
    if (c.spec.id !== p.car || c.plate !== (p.plate || null)) { const spec = CARS.find(s => s.id === p.car) || CARS[0]; disposeCar(c); const built = makeCar(spec, false, p.plate); c.model = built.model; c.spec = spec; c.plate = p.plate || null; c.veh.setSpec(spec); c.veh.reset(startS, route.laneU(startS, 0)); }
    if (p.paint && p.paint !== c.model.paintColor) setPaint(c.model, p.paint);
    c.networkName = p.name; c.model.root.visible = ['countdown', 'race'].includes(multiplayer.lobby.status);
  }
  const first = members[0];
  if (first && remoteCars.get(first.id) !== rival) { const old = rival; rival = remoteCars.get(first.id); if (![...remoteCars.values()].includes(old)) disposeCar(old); }
  $('rivalName').textContent = first?.name || 'WAITING';
}
const multiplayer = new Multiplayer(CARS, {
  appearance: () => player ? { paint: player.model.paintColor } : {},
  inputOverlayOpen: () => menu?.screen === 'car' && !!menu.data?.onPick,
  clearInput: clearDriveInput, carIndex: () => G.carIdx,
  async mapChanged(id) { await window.__flow.switchMap(id, multiplayer.lobby?.status === 'waiting' ? 'MULTIPLAYER LOBBY' : 'MULTIPLAYER RACE · RESUMING'); if (multiplayer.active) { setCar(Math.max(0, CARS.findIndex(c => c.id === multiplayer.me?.car))); onlineWait(); } else window.__flow.quit(); },
  panelClosed() { G.countWall = performance.now(); if (G.state === 'race') controls.requestMouseLock(); },
  join(car) { if (world && !mapSwitch && multiplayer.loaded) { setCar(Math.max(0, CARS.findIndex(c => c.id === car))); onlineWait(); } },
  carChanged(car) {
    for (const c of remoteCars.values()) if (c !== rival) disposeCar(c); remoteCars.clear();
    if (world && !mapSwitch && multiplayer.loaded) { setCar(Math.max(0, CARS.findIndex(c => c.id === car))); onlineWait(); }
  },
  wait: onlineWait,
  leave() {
    for (const c of remoteCars.values()) if (c !== rival) disposeCar(c); remoteCars.clear();
    if (!world || mapSwitch || !multiplayer.loaded) { showTitle(); return; }
    traffic.disabled = Q.has('notraffic'); setCar(G.carIdx); quitToMenu();
  },
  members: onlineMembers,
  world(snapshot, age) { receiveWorldLife(snapshot, age); },
  sharedWorld(packet) { if (world && !mapSwitch && multiplayer.worldReady) sharedWorld.receive(packet); },
  start(lobby, id, resumeState = null) {
    try { localStorage.setItem('paraliaki.lastPlayedMap', lobby.mapId); } catch {}
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
      c.lastBrake = p.braking === true; c.model.root.visible = member?.connected !== false || performance.now() - peer.at < 3000;
      syncCar(c, dt);
    }
  },
  // The other driver reported a contact with this car: apply the matching impulse unless it was already resolved here.
  contact(event) {
    if (G.state !== 'race' || !player || multiplayer.retired || recoveryHeld(G.towing, towOffer)) return;
    if (contactCoordinator.raceId !== multiplayer.lobby.raceId) contactCoordinator.reset(multiplayer.lobby.raceId);
    const member = multiplayer.lobby.players.find(p => p.id === event.from);
    const known = multiplayer.peers.get(event.from)?.state;
    const hit = contactCoordinator.receive(event, player.veh, performance.now(), { ghost: !member?.loaded || member.connected === false || member.dnf || member.finish != null, rtt: multiplayer.latency,
      knownVelocity: known ? { x: -Math.sin(known.yaw) * known.vLong + Math.cos(known.yaw) * known.vLat, z: -Math.cos(known.yaw) * known.vLong - Math.sin(known.yaw) * known.vLat } : null });
    if (hit) { multiplayer.lastContacts = [hit]; playerImpactVoice({ kind: 'crash', dv: hit.impulse }); }
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
      G.pFinish = multiplayer.me.finish;
      if (G.state !== 'onlineResults') G.state = 'onlineFinished';
      onlinePersonalResult();
      if (firstFinish) { player.veh.vLong = player.veh.vLat = player.veh.w = 0; multiplayer.panel.hidden = true; }
      if (G.state === 'onlineFinished') updateFinishView();
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
const contactCoordinator = new ContactCoordinator({ send: event => multiplayer.sendContact(event), serverNow: () => multiplayer.now() });
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
if (Q.has('debug')) { window.__vehicle = () => player?.veh; window.__onlineCars = () => [...remoteCars].map(([id, c]) => ({ id, car: c.spec.id, visible: c.model.root.visible, s: c.veh.s, x: c.veh.x, y: c.veh.y, z: c.veh.z, yaw: c.veh.yaw, vLong: c.veh.vLong })); }

gameReady = boot().catch(error => { fail(error); throw error; });

}
