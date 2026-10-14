// Local driver identity: no account, secret, cookie or uniqueness requirement.
import { formatPlate } from './plate.js';
export const DRIVER_NAME_KEY = 'paraliaki.driver';
export function normalizeDriverName(value) {
  const name = String(value ?? '').trim().toUpperCase();
  if (!/^[A-Z0-9-]{3,16}$/.test(name)) throw new Error('Driver name must be 3–16 characters: A–Z, 0–9 or hyphens.');
  const letters = name.replace(/-/g, '').replace(/0/g, 'O').replace(/1/g, 'I').replace(/3/g, 'E').replace(/4/g, 'A').replace(/5/g, 'S').replace(/7/g, 'T');
  if (/FUCK|SHIT|CUNT|NIGGER|NAZI/.test(letters) || /^(ADMIN|ADMINISTRATOR|MODERATOR|SUPPORT|OFFICIAL|SYSTEM|ATHENSSTREETRACERS|ASRSTAFF)/.test(letters)) throw new Error('Please choose another driver name.');
  return name;
}
let current;
const listeners = new Set();
const storage = () => { try { return globalThis.localStorage; } catch { return null; } };
const emit = () => { for (const fn of listeners) fn(current); };
export const driverName = {
  get() {
    if (current) return current;
    try { current = normalizeDriverName(storage()?.getItem(DRIVER_NAME_KEY)); } catch { current = 'GR-' + (1000 + Math.floor(Math.random() * 9000)); }
    try { storage()?.setItem(DRIVER_NAME_KEY, current); storage()?.removeItem('asr.device.v1'); storage()?.removeItem('asr.account-intro.v1'); } catch {}
    return current;
  },
  set(value) { const next = normalizeDriverName(value); if (next !== this.get()) { current = next; try { storage()?.setItem(DRIVER_NAME_KEY, next); } catch {} emit(); } return current; },
  plate() { return formatPlate(this.get()); },
  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
};
if (typeof window !== 'undefined') window.addEventListener('storage', e => { if (e.key !== DRIVER_NAME_KEY) return; try { const next = normalizeDriverName(e.newValue); if (next !== current) { current = next; emit(); } } catch {} });
