// SETTINGS: player preferences, persisted to localStorage['paraliaki.settings'].
//   import { settings, setSetting, onSettings } from './settings.js';
//   settings.units            'kmh' | 'mph'
//   settings.master/sfx 0..1 volumes (audio.setVolumes)
//   settings.aids             traction and stability control (TC/ESC/EDL) as fitted; false = off
//   settings.abs              ABS as fitted; independent of the live TC/ESC toggle
//   settings.steeringAssist    null = follow active input; otherwise 'off' | 'light' | 'full'
//   settings.transmission     'auto' | 'manual' (the input system maps the shift keys; Vehicle.setManual)
//   (there is ONE graphics look, src/graphics.js RENDER: no presets, no lighting / effects levels. Owner-locked
//   decision, docs/OWNER-DECISIONS.md. Old 'graphics' / 'lighting' / 'effects' / 'motionBlur' values are dropped on load.)
//   settings.perfClass        'auto' | 'potato' | 'low' | 'med' | 'high': performance only (the 'auto' resolution and
//                             draw ranges, graphics.js PERFORMANCE); set silently by the first-run check, never the look
//   settings.renderScale      'auto' (the performance class's resolution) | 0.5..1 of the screen's pixels (upper bound when dynamic resolution is enabled)
//   settings.pixelRatioCap    legacy, unused
//   settings.frameCap         frame rate limit: 30 | 60 | 120 | 0 (unlimited); high-refresh screens otherwise draw every vsync
//   settings.drawDistance     'auto' (the performance class's) | 300 | 500 | 1000 | 2000 | 4000 metres (src/scenery.js, applies live)
//   settings.mirrors          working in-car rear-view / door mirrors on / off (src/cockpit.js); never in the chase camera
//   settings.ghostEnabled     race against your best ghost (src/ghost-lap.js reads it)
//   onSettings((settings, changedKey) => ...) returns an unsubscribe function

export const AUDIO_VOLUMES = ['master', 'sfx', 'engine', 'tyres', 'ambience', 'traffic', 'voice', 'ui'];
const KEY = 'paraliaki.settings';
const PERF_CLASSES = ['auto', 'potato', 'low', 'med', 'high'];
// removed graphics choices (owner-locked single look): ignored and dropped from saves
const LEGACY_GRAPHICS_KEYS = ['graphics', 'lighting', 'effects', 'motionBlur'];
const LEGACY_GRAPHICS_STORAGE = 'paraliaki.graphics';
export const FRAME_CAPS = [30, 60, 120, 0];
/** Any saved or incoming frame limit as one of FRAME_CAPS (0 = no limit). Unlimited has been written as 0, as null
 *  (JSON.stringify(Infinity)) and as words; a number above 120 means "faster than the highest limit"; other numbers
 *  snap to the nearest limit. Anything unreadable gives `fallback`. */
export function frameCapValue(value, fallback = DEFAULTS.frameCap) {
  if (value === null || value === Infinity || value === false) return 0;
  if (value === true) return fallback;
  if (typeof value === 'string') {
    const word = value.trim().toLowerCase();
    if (/^(unlimited|none|off|max|maximum|no[ _-]?limit|uncapped|inf|infinity)$/.test(word)) return 0;
    if (!word) return fallback;
  }
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  if (n === 0 || n > 120) return 0;
  return [30, 60, 120].reduce((a, b) => Math.abs(b - n) < Math.abs(a - n) ? b : a);
}
const AUDIO_DEFAULT_VERSION = 'paraliaki.audio-default-version';
const TYRE_DEFAULT_VERSION = 'paraliaki.tyre-default-version';
const HUD_MOTION_DEFAULT_VERSION = 'paraliaki.hud-motion-default-version';
export const DEFAULTS = { master: 0.6, sfx: 1, engine: 0.85, tyres: 0.28, ambience: 0.5, traffic: 0.65, voice: 0.65, ui: 0.4, mildLanguage: false, units: 'kmh', aids: true, abs: true, transmission: 'auto', steeringAssist: null, perfClass: 'auto', renderScale: 'auto', dynamicResolution: true, pixelRatioCap: 1.5, frameCap: 60, drawDistance: 'auto', worldDetail: true, mirrors: true, ghostEnabled: true,
  mouseSensitivity: 1, mouseLook: false, invertLookY: false, chaseFov: 58, cockpitFov: 66, speedFov: true, playerMarkers: true, rivalMarkers: true, perfOverlay: false, hudMotion: 'full' };
export const HUD_MOTION_VALUES = ['off', 'subtle', 'full'];
const reducedMotion = () => { try { return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
const CAMERA_RANGES = { mouseSensitivity: [0.25, 3], chaseFov: [45, 75], cockpitFov: [45, 90] };
const CAMERA_FLAGS = ['mouseLook', 'invertLookY', 'speedFov', 'playerMarkers', 'rivalMarkers'];
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
  const out = { ...DEFAULTS, hudMotion: reducedMotion() ? 'off' : DEFAULTS.hudMotion };
  try {
    const storage = ls(), saved = JSON.parse(storage?.getItem(KEY) || '{}');
    // Owner-locked removal (docs/OWNER-DECISIONS.md): drop the obsolete tyre-grip HUD preference, persisted copies too.
    if (Object.hasOwn(saved, 'showTyreGrip')) {
      delete saved.showTyreGrip;
      try { storage?.setItem(KEY, JSON.stringify(saved)); } catch {}
    }
    const retired = Object.keys(saved).filter(key => /phone.?wheel|music|youtube|playlist/i.test(key));
    for (const key of retired) delete saved[key];
    if (retired.length) { try { storage?.setItem(KEY, JSON.stringify(saved)); } catch {} }
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
    // HUD motion's default moved from Subtle to Full. A stored 'subtle' from before then is the old default, so move it once.
    if (storage?.getItem(HUD_MOTION_DEFAULT_VERSION) !== '1') {
      if (saved?.hudMotion === 'subtle' && !reducedMotion()) {
        saved.hudMotion = out.hudMotion = 'full';
        try { storage?.setItem(KEY, JSON.stringify(saved)); } catch {}
      }
      try { storage?.setItem(HUD_MOTION_DEFAULT_VERSION, '1'); } catch {}
    }
    // One graphics look (owner-locked): the old preset only survives as a performance class (its resolution and draw
    // ranges, never its look); stored presets / lighting / effects / motion blur values are dropped from the save.
    const legacy = storage?.getItem(LEGACY_GRAPHICS_STORAGE), legacyClass = legacy === 'ultra' ? 'high' : legacy;
    if (legacyClass && saved.perfClass == null && PERF_CLASSES.includes(legacyClass) && legacyClass !== 'auto') saved.perfClass = out.perfClass = legacyClass;
    if (legacy != null || LEGACY_GRAPHICS_KEYS.some(k => k in saved)) {
      for (const k of LEGACY_GRAPHICS_KEYS) delete saved[k];
      try { storage?.setItem(KEY, JSON.stringify(saved)); storage?.removeItem(LEGACY_GRAPHICS_STORAGE); } catch {}
    }
  } catch {}
  for (const k of LEGACY_GRAPHICS_KEYS) delete out[k];
  for (const k of AUDIO_VOLUMES) out[k] = Math.max(0, Math.min(1, +out[k] || 0));
  if (!['kmh', 'mph'].includes(out.units)) out.units = 'kmh';
  if (!['auto', 'manual'].includes(out.transmission)) out.transmission = 'auto';
  if (![null, 'off', 'light', 'full'].includes(out.steeringAssist)) out.steeringAssist = null;
  if (!PERF_CLASSES.includes(out.perfClass)) out.perfClass = 'auto';
  out.renderScale = resolutionValue(out.renderScale);
  out.frameCap = frameCapValue(out.frameCap);
  out.pixelRatioCap = pixelRatioCapValue(out.pixelRatioCap);
  out.aids = out.aids !== false;
  out.abs = out.abs !== false;
  out.ghostEnabled = out.ghostEnabled !== false;
  delete out.police; // police are a race / lobby setting only, never a per-browser preference
  out.mildLanguage = out.mildLanguage === true;
  out.dynamicResolution = out.dynamicResolution !== false;
  out.mirrors = out.mirrors !== false;
  out.worldDetail = out.worldDetail !== false;
  if (!HUD_MOTION_VALUES.includes(out.hudMotion)) out.hudMotion = reducedMotion() ? 'off' : DEFAULTS.hudMotion;
  if (![300, 500, 1000, 2000, 4000].includes(+out.drawDistance)) out.drawDistance = 'auto'; else out.drawDistance = +out.drawDistance;
  for (const key of [...Object.keys(CAMERA_RANGES), ...CAMERA_FLAGS]) out[key] = cameraValue(key, out[key]);
  return out;
}

export const settings = load();
const subs = new Set();
export function onSettings(fn) { subs.add(fn); return () => subs.delete(fn); }
export function setSetting(key, value) {
  if (key === 'perfClass' && !PERF_CLASSES.includes(value)) return;
  if (key === 'renderScale') value = resolutionValue(value);
  if (key === 'frameCap') { value = frameCapValue(value, null); if (value === null) return; }
  if (key === 'pixelRatioCap') value = pixelRatioCapValue(value);
  if (key === 'worldDetail' || key === 'dynamicResolution' || key === 'mildLanguage' || key === 'aids' || key === 'abs') value = value === true;
  if (key in CAMERA_RANGES || CAMERA_FLAGS.includes(key)) value = cameraValue(key, value);
  if (AUDIO_VOLUMES.includes(key)) value = Math.max(0, Math.min(1, +value || 0));
  if (!(key in DEFAULTS) || settings[key] === value) return;
  if (key === 'steeringAssist' && ![null, 'off', 'light', 'full'].includes(value)) return;
  if (key === 'hudMotion' && !HUD_MOTION_VALUES.includes(value)) return;
  settings[key] = value;
  try {
    ls()?.setItem(KEY, JSON.stringify(settings));
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
