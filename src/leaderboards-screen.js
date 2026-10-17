import * as C from './ui/components.js';
import { MAPS } from './map-catalog.js';
import { getEvents } from './events.js';
import { CARS } from './cars.js';
import { listPersonalBests } from './personal-bests.js';
import { getLeaderboard } from './leaderboard.js';
import { matchesRecord, recordEvent, carLabel, routeId, routeLabel, setupLabels, recordDate, formatRecordTime } from './leaderboard-records.js';
const { esc } = C;
const ALL = ['', 'ALL'];
export function lastLeaderboardMap() {
  try { const id = localStorage.getItem('paraliaki.lastPlayedMap'); if (MAPS.some(m => m.id === id)) return id; } catch {}
  return window.__flow?.mapId || 'riviera';
}
export function renderBestRecord(r, { rank, global = false, title } = {}) {
  const heading = title || `#${rank} · ${formatRecordTime(r.time)}`;
  return C.panel(esc(heading), `<div class="lb-record">
    ${global ? `<b>${esc(r.name || 'DRIVER')}</b>` : ''}<b>${esc(carLabel(r, CARS))}</b>
    <span class="muted">${esc(recordEvent(r).replace(/[-_]/g, ' ').toUpperCase())} · ${esc(routeLabel(r))}</span>
    ${setupLabels(r).map(line => `<span>${esc(line)}</span>`).join('')}
    </div>`, { icon: 'timer', cls: 'lb-entry', right: `<span class="muted">${esc(recordDate(r))}</span>` });
}
export function renderLeaderboards(menu, d) {
  d.tab ||= 'personal'; d.filters ||= { mapId: lastLeaderboardMap() };
  const f = d.filters, local = listPersonalBests({ mapId: f.mapId });
  const known = [...local, ...(d.known || []).filter(r => (r.mapId || 'riviera') === f.mapId)];
  const events = new Map([['quick', 'QUICK RACE'], ...getEvents(f.mapId).map(e => [e.id, e.name]), ...known.map(r => [recordEvent(r), recordEvent(r).replace(/[-_]/g, ' ').toUpperCase()])]);
  const routes = [...new Map(known.filter(r => !f.eventId || recordEvent(r) === f.eventId).map(r => [routeId(r), routeLabel(r)])).entries()];
  const pick = (key, label, options) => C.select({ key, label, value: f[key] || '', options, attrs: { 'data-scope': 'leaderboard' } });
  const filters = pick('mapId', 'TRACK', MAPS.map(m => [m.id, esc(m.name)])) +
    pick('eventId', 'EVENT', [ALL, ...[...events].map(([id, label]) => [id, esc(label)])]) +
    (routes.length ? pick('route', 'ROUTE', [ALL, ...routes.map(([id, label]) => [id, esc(label)])]) : '') +
    pick('car', 'CAR', [ALL, ...CARS.map(c => [c.id, esc(c.name)])]) +
    C.button({ label: d.advanced ? 'FEWER FILTERS' : 'WEATHER & ASSISTS', icon: 'sliders-horizontal', act: 'leaderboardAdvanced', block: true, size: 'sm' }) +
    (d.advanced ? pick('weather', 'WEATHER', [ALL, ...['clear', 'overcast', 'rain', 'dynamic'].map(v => [v, v.toUpperCase()])]) +
      pick('tc', 'TC', [ALL, ['true', 'ON'], ['false', 'OFF']]) + pick('abs', 'ABS', [ALL, ['true', 'ON'], ['false', 'OFF']]) +
      pick('steering', 'STEERING', [ALL, ...['off', 'light', 'full'].map(v => [v, v.toUpperCase()])]) +
      pick('gearbox', 'GEARBOX', [ALL, ['auto', 'AUTO'], ['manual', 'MANUAL']]) : '') +
    C.button({ label: 'CLEAR FILTERS', act: 'leaderboardReset', variant: 'ghost', size: 'sm', block: true });
  const rows = (d.tab === 'personal' ? local : d.entries || []).filter(r => matchesRecord(r, f));
  let content;
  if (d.tab === 'global' && d.loading) content = C.panel('LOADING TIMES', C.spinner(), { attrs: { role: 'status' } });
  else if (d.tab === 'global' && d.error) content = C.panel('GLOBAL TIMES UNAVAILABLE', `<p>${esc(d.error)}</p>${C.button({ label: 'TRY AGAIN', act: 'leaderboardRetry' })}`, { attrs: { role: 'status' } });
  else content = rows.length ? `<ol class="lb-records" aria-label="Ranked times">${rows.map((r, i) => `<li>${renderBestRecord(r, { rank: i + 1, global: d.tab === 'global' })}</li>`).join('')}</ol>` : C.panel('NO TIMES YET', '<p>No records match these filters. Try another setup or complete a race on this track.</p>', { attrs: { role: 'status' } });
  // A render schedules one request per filter key. Responses from an abandoned screen are ignored.
  if (d.tab === 'global') queueMicrotask(() => loadGlobal(menu, d));
  return C.screen({ title: 'LEADERBOARDS', kick: 'PURE TIME', cls: 'scr--leaderboards', hints: [['select', 'SELECT'], ['leftright', 'FILTER'], ['tabs', 'TAB'], ['back', 'BACK']], body:
    C.tabs({ key: 'leaderboardTab', value: d.tab, options: [['personal', 'PERSONAL BESTS', 'timer'], ['global', 'GLOBAL', 'globe']] }) +
    `<div class="lb-layout"><aside>${C.panel('FILTER TIMES', filters)}</aside><div class="lb-results" aria-live="polite" aria-busy="${d.tab === 'global' && !!d.loading}">${C.panel('COMPARE TIMES', `<p>${d.tab === 'personal' ? 'Your fastest clean run for each setup · saved on this device.' : 'Fastest runs from all drivers · up to 100 matching times.'} Different routes and setups are ranked together unless filtered.</p>`)}${content}</div></div>` });
}
async function loadGlobal(menu, d) {
  if (menu.screen !== 'leaderboards' || menu.data !== d) return;
  const filters = Object.fromEntries(Object.entries(d.filters).filter(([, v]) => v !== ''));
  const key = JSON.stringify(filters);
  if (d.requestKey === key) return;
  d.requestKey = key; d.loading = true; d.error = null; menu.refresh();
  try {
    const entries = await getLeaderboard({ ...filters, limit: 100 });
    if (menu.screen !== 'leaderboards' || menu.data !== d || d.requestKey !== key) return;
    d.entries = entries;
    d.known = [...new Map([...(d.known || []), ...entries].map(r => [JSON.stringify([r.mapId, routeId(r)]), r])).values()];
  } catch (error) { if (d.requestKey === key) d.error = error.message; }
  finally { if (menu.screen === 'leaderboards' && menu.data === d && d.requestKey === key) { d.loading = false; menu.refresh(); } }
}
export function leaderboardChange(menu, key, value) {
  const d = menu.data;
  if (key === 'leaderboardTab') d.tab = value;
  else {
    d.filters[key] = value;
    if (key === 'mapId' || key === 'eventId') delete d.filters.route;
    if (key === 'mapId') { delete d.filters.eventId; d.known = []; }
  }
  menu.refresh();
}
// Screen CSS only arranges shared components.
if (typeof document !== 'undefined' && !document.getElementById('leaderboards-css')) {
  const link = document.createElement('link'); link.id = 'leaderboards-css'; link.rel = 'stylesheet'; link.href = new URL('./leaderboards.css', import.meta.url).href; document.head.append(link);
}
