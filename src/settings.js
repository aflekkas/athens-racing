// SETTINGS: player preferences, persisted to localStorage['paraliaki.settings'] (graphics keeps its own
// 'paraliaki.graphics' key, which main.js reads before the renderer is created).
//   import { settings, setSetting, onSettings } from './settings.js';
//   settings.units            'kmh' | 'mph'
//   settings.master/music/sfx 0..1 volumes (audio.setVolumes)
//   settings.aids             true = traction control, ABS and stability control as the car came; false = all off
//   settings.steeringAssist    null = follow active input; otherwise 'off' | 'light' | 'full'
//   settings.transmission     'auto' | 'manual' (the input system maps the shift keys; Vehicle.setManual)
//   settings.graphics         'auto' | 'high' | 'med' | 'low' (applied by reloading the page)
//   settings.ghostEnabled     race against your best ghost (src/replay.js reads it)
//   settings.police           police in Quick Race / free roam (src/police.js reads it)
//   onSettings((settings, changedKey) => ...) returns an unsubscribe function

export const AUDIO_VOLUMES = ['master', 'music', 'sfx', 'engine', 'tyres', 'ambience', 'traffic', 'ui'];
const KEY = 'paraliaki.settings';
export const DEFAULTS = { master: 0.8, music: 0.55, sfx: 1, engine: 0.85, tyres: 0.8, ambience: 0.5, traffic: 0.65, ui: 0.4, units: 'kmh', aids: true, transmission: 'auto', steeringAssist: null, graphics: 'auto', ghostEnabled: true, police: false,
  mouseSensitivity: 1, invertLookY: false, chaseFov: 58, cockpitFov: 66, speedFov: true, playerMarkers: true, rivalMarkers: false };
const CAMERA_RANGES = { mouseSensitivity: [0.25, 3], chaseFov: [45, 75], cockpitFov: [45, 90] };
const CAMERA_FLAGS = ['invertLookY', 'speedFov', 'playerMarkers', 'rivalMarkers'];
function cameraValue(key, value) {
  const range = CAMERA_RANGES[key];
  return range ? Math.max(range[0], Math.min(range[1], Number.isFinite(+value) ? +value : DEFAULTS[key])) : value === true;
}
const ls = () => { try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; } };

function load() {
  const out = { ...DEFAULTS };
  try { Object.assign(out, JSON.parse(ls()?.getItem(KEY) || '{}')); } catch {}
  try { const g = ls()?.getItem('paraliaki.graphics'); if (g) out.graphics = g; } catch {}
  for (const k of AUDIO_VOLUMES) out[k] = Math.max(0, Math.min(1, +out[k] || 0));
  if (!['kmh', 'mph'].includes(out.units)) out.units = 'kmh';
  if (!['auto', 'manual'].includes(out.transmission)) out.transmission = 'auto';
  if (![null, 'off', 'light', 'full'].includes(out.steeringAssist)) out.steeringAssist = null;
  out.aids = out.aids !== false;
  out.ghostEnabled = out.ghostEnabled !== false;
  out.police = out.police === true;
  for (const key of [...Object.keys(CAMERA_RANGES), ...CAMERA_FLAGS]) out[key] = cameraValue(key, out[key]);
  return out;
}

export const settings = load();
const subs = new Set();
export function onSettings(fn) { subs.add(fn); return () => subs.delete(fn); }
export function setSetting(key, value) {
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
