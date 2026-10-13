// SETTINGS: player preferences, persisted to localStorage['paraliaki.settings'] (graphics keeps its own
// 'paraliaki.graphics' key, which main.js reads before the renderer is created).
//   import { settings, setSetting, onSettings } from './settings.js';
//   settings.units            'kmh' | 'mph'
//   settings.master/music/sfx 0..1 volumes (audio.setVolumes)
//   settings.aids             true = traction control, ABS and stability control as the car came; false = all off
//   settings.transmission     'auto' | 'manual' (the input system maps the shift keys; Vehicle.setManual)
//   settings.graphics         'auto' | 'high' | 'med' | 'low' (applied by reloading the page)
//   settings.ghostEnabled     race against your best ghost (src/replay.js reads it)
//   settings.police           police in Quick Race / free roam (src/police.js reads it)
//   onSettings((settings, changedKey) => ...) returns an unsubscribe function

const KEY = 'paraliaki.settings';
export const DEFAULTS = { master: 1, music: 1, sfx: 1, units: 'kmh', aids: true, transmission: 'auto', graphics: 'auto', ghostEnabled: true, police: false };
const ls = () => { try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; } };

function load() {
  const out = { ...DEFAULTS };
  try { Object.assign(out, JSON.parse(ls()?.getItem(KEY) || '{}')); } catch {}
  try { const g = ls()?.getItem('paraliaki.graphics'); if (g) out.graphics = g; } catch {}
  for (const k of ['master', 'music', 'sfx']) out[k] = Math.max(0, Math.min(1, +out[k] || 0));
  if (!['kmh', 'mph'].includes(out.units)) out.units = 'kmh';
  if (!['auto', 'manual'].includes(out.transmission)) out.transmission = 'auto';
  out.aids = out.aids !== false;
  out.ghostEnabled = out.ghostEnabled !== false;
  out.police = out.police === true;
  return out;
}

export const settings = load();
const subs = new Set();
export function onSettings(fn) { subs.add(fn); return () => subs.delete(fn); }
export function setSetting(key, value) {
  if (!(key in DEFAULTS) || settings[key] === value) return;
  settings[key] = value;
  try {
    const { graphics, ...rest } = settings;
    ls()?.setItem(KEY, JSON.stringify(rest));
    if (key === 'graphics') ls()?.setItem('paraliaki.graphics', value);
  } catch {}
  for (const fn of [...subs]) { try { fn(settings, key); } catch (e) { console.error('[settings]', e); } }
}

// ------------------------------------------------------------------ units
export const KMH_TO_MPH = 0.621371;
export const speedIn = (kmh) => (settings.units === 'mph' ? kmh * KMH_TO_MPH : kmh);
export const speedUnit = () => (settings.units === 'mph' ? 'MPH' : 'KM/H');
export const fmtSpeed = (kmh) => `${Math.round(speedIn(kmh))} ${speedUnit()}`;
export const fmtDist = (m) => (settings.units === 'mph' ? `${(m / 1609.344).toFixed(1)} MI` : `${(m / 1000).toFixed(1)} KM`);

if (typeof window !== 'undefined') window.__settings = settings;
