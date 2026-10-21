// Shared presentation/filter logic. Missing historical settings stay unknown.
import { canonicalCarId } from './car-ids.js';
export const SETUP_FIELDS = ['time', 'weather', 'traffic', 'rivals', 'police', 'tc', 'abs', 'steering', 'gearbox'];
export const recordSetup = r => r?.setup || {};
export const recordMap = r => r.setup?.map || r.mapId || 'riviera';
export const recordEvent = r => r.setup?.event || r.eventId || 'unknown';
export const recordCar = r => canonicalCarId(r.setup?.car || r.car);
export function matchesRecord(r, filters = {}) {
  const s = recordSetup(r);
  return (!filters.routeId||(r.routeId||s.routeId||r.identity?.routeId)===filters.routeId)&&(!filters.edition||(r.edition||s.edition||r.identity?.edition)===filters.edition)&&(!filters.mapId || recordMap(r) === filters.mapId) &&
    (!filters.eventId || recordEvent(r) === filters.eventId) &&
    (!filters.route || routeId(r) === filters.route) &&
    (!filters.car || recordCar(r) === canonicalCarId(filters.car)) &&
    ['time','weather', 'tc', 'abs', 'steering', 'gearbox'].every(k => filters[k] === undefined || filters[k] === '' || String(s[k]) === String(filters[k])) &&
    (filters.traffic === undefined || (typeof filters.traffic === 'boolean' ? (s.traffic !== undefined ? s.traffic > 0 : r.traffic) === filters.traffic : s.traffic === filters.traffic));
}
export const routeId = r => JSON.stringify([recordEvent(r), r.setup?.from ?? r.routeKey ?? null, r.setup?.to ?? null, r.setup?.direction ?? null, r.setup?.laps ?? null]);
export function setupLabels(r) {
  const s = recordSetup(r), text = v => v == null ? 'Unknown' : String(v).toUpperCase();
  const flag = (k, label) => `${label} ${s[k] == null ? 'unknown' : s[k] ? 'on' : 'off'}`;
  const traffic = s.traffic == null ? (r.traffic == null ? 'unknown' : r.traffic ? 'on (density unknown)' : 'off') : s.traffic === 0 ? 'off' : `${s.traffic}×`;
  return [`${text(s.time)} · ${text(s.weather)}`, `Traffic ${traffic} · Rivals ${s.rivals ?? 'unknown'} · ${flag('police', 'Police')}`,
    `${flag('tc', 'TC')} · ${flag('abs', 'ABS')} · Steering ${text(s.steering)} · Gearbox ${text(s.gearbox)}`];
}
export function carLabel(r, cars = []) {
  const spec = cars.find(c => c.id === recordCar(r));
  return r.carName || r.setup?.carName || spec?.name || recordCar(r) || 'Unknown car';
}
export function routeLabel(r) {
  const s = recordSetup(r);
  const distance = s.from != null && s.to != null ? `${Math.round(s.from)} to ${Math.round(s.to)} m` : r.routeKey || 'Route details unavailable';
  return `${distance}${s.laps != null ? ` · ${s.laps} ${s.laps === 1 ? 'lap' : 'laps'}` : ''}`;
}
export function recordDate(r) {
  const date = new Date(r.date || r.at);
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : 'Date unknown';
}
export function formatRecordTime(t) {
  const ticks = Math.round(t * 100);
  return `${Math.floor(ticks / 6000)}:${((ticks % 6000) / 100).toFixed(2).padStart(5, '0')}`;
}
