// SETTINGS: player preferences, persisted to localStorage['paraliaki.settings'] (graphics keeps its own
// 'paraliaki.graphics' key, which main.js reads before the renderer is created).
//   import { settings, setSetting, onSettings } from './settings.js';
//   settings.units            'kmh' | 'mph'
//   settings.master/music/sfx 0..1 volumes (audio.setVolumes)
//   settings.aids             traction and stability control (TC/ESC/EDL) as fitted; false = off
//   settings.abs              ABS as fitted; independent of the live TC/ESC toggle
//   settings.steeringAssist    null = follow active input; otherwise 'off' | 'light' | 'full'
//   settings.transmission     'auto' | 'manual' (the input system maps the shift keys; Vehicle.setManual)
//   settings.graphics         preset 'potato' | 'low' | 'med' | 'high' | 'ultra' ('auto' = not chosen yet; graphics.js)
//   settings.lighting         'preset' | 'off' | 'low' | 'med' | 'high' | 'ultra' (shadows, reflection probe)
//   settings.effects          'preset' | 'off' | 'low' | 'med' | 'high' | 'ultra' (post-processing, mirrors, sea reflections, particles)
//   settings.renderScale      'auto' (the preset's resolution) | 0.5..1 of the screen's pixels (fixed, never adaptive)
//   settings.pixelRatioCap    legacy, unused
//   settings.frameCap         frame rate limit: 30 | 60 | 120 | 0 (unlimited); high-refresh screens otherwise draw every vsync
//   settings.drawDistance     'auto' (the preset's) | 300 | 500 | 1000 | 2000 | 4000 metres (src/scenery.js, applies live)
//   settings.motionBlur       camera motion blur on / off (src/post.js)
//   settings.mirrors          working rear-view / door mirrors and the chase rear-view strip on / off (src/cockpit.js)
//   settings.ghostEnabled     race against your best ghost (src/replay.js reads it)
//   onSettings((settings, changedKey) => ...) returns an unsubscribe function

export const AUDIO_VOLUMES = ['master', 'music', 'sfx', 'engine', 'tyres', 'ambience', 'traffic', 'voice', 'ui'];
const KEY = 'paraliaki.settings';
const GRAPHICS_VALUES = ['auto', 'potato', 'low', 'med', 'high', 'ultra'];
const GRAPHICS_LEVELS = ['preset', 'off', 'low', 'med', 'high', 'ultra'];
export const FRAME_CAPS = [30, 60, 120, 0];
const AUDIO_DEFAULT_VERSION = 'paraliaki.audio-default-version';
const TYRE_DEFAULT_VERSION = 'paraliaki.tyre-default-version';
export const DEFAULTS = { master: 0.6, music: 0.55, sfx: 1, engine: 0.85, tyres: 0.28, ambience: 0.5, traffic: 0.65, voice: 0.65, ui: 0.4, mildLanguage: false, showTyreGrip: false, units: 'kmh', aids: true, abs: true, transmission: 'auto', steeringAssist: null, graphics: 'auto', lighting: 'preset', effects: 'preset', renderScale: 'auto', pixelRatioCap: 1.5, frameCap: 60, drawDistance: 'auto', motionBlur: true, mirrors: true, ghostEnabled: true,
  mouseSensitivity: 1, invertLookY: false, chaseFov: 58, cockpitFov: 66, speedFov: true, playerMarkers: true, rivalMarkers: true };
const CAMERA_RANGES = { mouseSensitivity: [0.25, 3], chaseFov: [45, 75], cockpitFov: [45, 90] };
const CAMERA_FLAGS = ['invertLookY', 'speedFov', 'playerMarkers', 'rivalMarkers'];
function cameraValue(key, value) {
  const range = CAMERA_RANGES[key];
  return range ? Math.max(range[0], Math.min(range[1], Number.isFinite(+value) ? +value : DEFAULTS[key])) : value === true;
}
export function resolutionValue(value) {
  if (value === 'auto') return 'auto';
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0.5, Math.min(1, n)) : 'auto';
}
export function pixelRatioCapValue(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(1, Math.min(2, n)) : DEFAULTS.pixelRatioCap;
}
const ls = () => { try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; } };

function load() {
  const out = { ...DEFAULTS };
  try {
    const storage = ls(), saved = JSON.parse(storage?.getItem(KEY) || '{}');
    Object.assign(out, saved);
    // Preserve the old all-aids-off choice when separating ABS from TC/ESC.
    if (saved.abs === undefined) out.abs = saved.aids !== false;
    // Migrate the old default once. A later deliberate choice of 0.8 must survive reloads.
    if (storage?.getItem(AUDIO_DEFAULT_VERSION) !== '1') {
      if (saved?.master != null && +saved.master === 0.8) {
        saved.master = DEFAULTS.master;
        out.master = DEFAULTS.master;
        try { storage?.setItem(KEY, JSON.stringify(saved)); } catch {}
      }
      try { storage?.setItem(AUDIO_DEFAULT_VERSION, '1'); } catch {}
    }
    // Independently version tyre defaults: don't repeat the earlier master migration.
    if (storage?.getItem(TYRE_DEFAULT_VERSION) !== '1') {
      if (saved?.tyres != null && +saved.tyres === 0.8) {
        saved.tyres = out.tyres = DEFAULTS.tyres;
        try { storage?.setItem(KEY, JSON.stringify(saved)); } catch {}
      }
      try { storage?.setItem(TYRE_DEFAULT_VERSION, '1'); } catch {}
    }
  } catch {}
  try { const g = ls()?.getItem('paraliaki.graphics'); if (g) out.graphics = g; } catch {}
  for (const k of AUDIO_VOLUMES) out[k] = Math.max(0, Math.min(1, +out[k] || 0));
  if (!['kmh', 'mph'].includes(out.units)) out.units = 'kmh';
  if (!['auto', 'manual'].includes(out.transmission)) out.transmission = 'auto';
  if (![null, 'off', 'light', 'full'].includes(out.steeringAssist)) out.steeringAssist = null;
  if (!GRAPHICS_VALUES.includes(out.graphics)) out.graphics = 'auto';
  for (const k of ['lighting', 'effects']) if (!GRAPHICS_LEVELS.includes(out[k])) out[k] = 'preset';
  out.renderScale = resolutionValue(out.renderScale);
  out.frameCap = FRAME_CAPS.includes(+out.frameCap) ? +out.frameCap : DEFAULTS.frameCap;
  out.pixelRatioCap = pixelRatioCapValue(out.pixelRatioCap);
  out.aids = out.aids !== false;
  out.abs = out.abs !== false;
  out.ghostEnabled = out.ghostEnabled !== false;
  delete out.police; // police are a race / lobby setting only, never a per-browser preference
  out.mildLanguage = out.mildLanguage === true;
  out.showTyreGrip = out.showTyreGrip === true;
  out.motionBlur = out.motionBlur !== false;
  out.mirrors = out.mirrors !== false;
  if (![300, 500, 1000, 2000, 4000].includes(+out.drawDistance)) out.drawDistance = 'auto'; else out.drawDistance = +out.drawDistance;
  for (const key of [...Object.keys(CAMERA_RANGES), ...CAMERA_FLAGS]) out[key] = cameraValue(key, out[key]);
  return out;
}

export const settings = load();
const subs = new Set();
export function onSettings(fn) { subs.add(fn); return () => subs.delete(fn); }
export function setSetting(key, value) {
  if (key === 'graphics' && !GRAPHICS_VALUES.includes(value)) return;
  if ((key === 'lighting' || key === 'effects') && !GRAPHICS_LEVELS.includes(value)) return;
  if (key === 'renderScale') value = resolutionValue(value);
  if (key === 'frameCap') { value = +value; if (!FRAME_CAPS.includes(value)) return; }
  if (key === 'pixelRatioCap') value = pixelRatioCapValue(value);
  if (key === 'mildLanguage' || key === 'showTyreGrip' || key === 'aids' || key === 'abs') value = value === true;
  if (key in CAMERA_RANGES || CAMERA_FLAGS.includes(key)) value = cameraValue(key, value);
  if (AUDIO_VOLUMES.includes(key)) value = Math.max(0, Math.min(1, +value || 0));
  if (!(key in DEFAULTS) || settings[key] === value) return;
  if (key === 'steeringAssist' && ![null, 'off', 'light', 'full'].includes(value)) return;
  settings[key] = value;
  try {
    const { graphics, ...rest } = settings;
    ls()?.setItem(KEY, JSON.stringify(rest));
    if (key === 'graphics') ls()?.setItem('paraliaki.graphics', value);
  } catch {}
  for (const fn of [...subs]) { try { fn(settings, key); } catch (e) { console.error('[settings]', e); } }
}

export const STEERING_ASSIST = Object.freeze({ off: 0, light: 0.35, full: 1 });
export function steeringAssistChoice(preference = settings.steeringAssist, device = 'keyboard') {
  return Object.hasOwn(STEERING_ASSIST, preference) ? preference : device === 'gamepad' || device === 'wheel' ? 'light' : 'full';
}
export function applySteeringAssist(vehicle, device = 'keyboard', preference = settings.steeringAssist) {
  const value = STEERING_ASSIST[steeringAssistChoice(preference, device)];
  if (vehicle) vehicle.steerAssist = value;
  return value;
}

// ------------------------------------------------------------------ units
export const KMH_TO_MPH = 0.621371;
export const speedIn = (kmh) => (settings.units === 'mph' ? kmh * KMH_TO_MPH : kmh);
export const speedUnit = () => (settings.units === 'mph' ? 'MPH' : 'KM/H');
export const fmtSpeed = (kmh) => `${Math.round(speedIn(kmh))} ${speedUnit()}`;
export const fmtDist = (m) => (settings.units === 'mph' ? `${(m / 1609.344).toFixed(1)} MI` : `${(m / 1000).toFixed(1)} KM`);

if (typeof window !== 'undefined') window.__settings = settings;
