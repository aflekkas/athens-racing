import * as C from './ui/components.js';
import { MAPS } from './map-catalog.js';
import { getEvents } from './events.js';
import { CARS } from './cars.js';
import { inGarage } from './car-catalog.js';
import { listPersonalBests } from './personal-bests.js';
import { getLeaderboard } from './leaderboard.js';
import { matchesRecord, recordEvent, carLabel, routeId, routeLabel, setupLabels, recordDate, formatRecordTime } from './leaderboard-records.js';
const { esc } = C;
const ALL = ['', 'ALL'];
export function lastLeaderboardMap() {
  try { const id = localStorage.getItem('paraliaki.lastPlayedMap'); if (MAPS.some(m => m.id === id)) return id; } catch {}
  return window.__flow?.mapId || 'riviera';
}
export function renderBestRecord(r, { rank, global = false, title, compact = false } = {}) {
  if (compact) return C.listRow({ title: `${rank ? `#${rank} · ` : ''}${esc(r.name || 'DRIVER')}`, desc: esc(carLabel(r, CARS)), meta: esc(formatRecordTime(r.time)), focusable: false, go: false });
  const heading = title || `#${rank} · ${formatRecordTime(r.time)}`;
  return C.panel(esc(heading), `<div class="lb-record">
    ${global ? `<b>${esc(r.name || 'DRIVER')}</b>` : ''}<b>${esc(carLabel(r, CARS))}</b>
    <span class="muted">${esc(recordEvent(r).replace(/[-_]/g, ' ').toUpperCase())} · ${esc(routeLabel(r))}</span>
    ${setupLabels(r).map(line => `<span>${esc(line)}</span>`).join('')}
    </div>`, { icon: 'timer', cls: 'lb-entry', right: `<span class="muted">${esc(recordDate(r))}</span>` });
}
// The track preview shares the full board's record presentation and filter semantics.
export function renderTrackTimes(menu, d, filters) {
  const best = listPersonalBests(filters)[0], state = d.trackTimes ||= { loading: true };
  const personal = best ? renderBestRecord(best, { title: `PERSONAL BEST · ${formatRecordTime(best.time)}` }) :
    C.panel('PERSONAL BEST', '<p class="muted">No time yet. Finish a clean race to set one.</p>');
  let global;
  if (state.loading) global = C.spinner();
  else if (state.error) global = `<p>${esc(state.error)}</p>${C.button({ label: 'TRY AGAIN', act: 'trackTimesRetry', size: 'sm' })}`;
  else global = state.entries.length ? state.entries.map((r, i) => renderBestRecord(r, { rank: i + 1, global: true, compact: true })).join('') : '<p class="muted">No times yet. Be the first.</p>';
  queueMicrotask(() => loadTrackTimes(menu, d, state, filters));
  return `${personal}${C.panel('TOP 3', global, { attrs: { 'aria-live': 'polite', 'aria-busy': !!state.loading } })}`;
}
async function loadTrackTimes(menu, d, state, filters) {
  if (menu.screen !== 'mapConfirm' || menu.data !== d || d.trackTimes !== state || state.requested) return;
  state.requested = true;
  try {
    const entries = await getLeaderboard({ ...filters, limit: 3 });
    state.entries = entries.filter(r => matchesRecord(r, filters)).sort((a, b) => a.time - b.time).slice(0, 3);
  } catch (error) { state.error = error.message; }
  finally {
    state.loading = false;
    // An abandoned request cannot repaint another track, setup or the full board.
    if (menu.screen === 'mapConfirm' && menu.data === d && d.trackTimes === state) menu.refresh();
  }
}
export function renderLeaderboards(menu, d) {
  d.tab ||= 'personal'; d.filters ||= { mapId: lastLeaderboardMap() };
  const f = d.filters, local = listPersonalBests({ mapId: f.mapId });
  const known = [...local, ...(d.known || []).filter(r => (r.mapId || 'riviera') === f.mapId)];
  const events = new Map([['quick', 'QUICK RACE'], ...(f.eventId ? [[f.eventId, f.eventId.replace(/[-_]/g, ' ').toUpperCase()]] : []), ...getEvents(f.mapId).map(e => [e.id, e.name]), ...known.map(r => [recordEvent(r), recordEvent(r).replace(/[-_]/g, ' ').toUpperCase()])]);
  const routes = [...new Map(known.filter(r => !f.eventId || recordEvent(r) === f.eventId).map(r => [routeId(r), routeLabel(r)])).entries()];
  const pick = (key, label, options) => C.select({ key, label, value: f[key] || '', options, attrs: { 'data-scope': 'leaderboard' } });
  const filters = pick('mapId', 'TRACK', MAPS.map(m => [m.id, esc(m.name)])) +
    pick('eventId', 'EVENT', [ALL, ...[...events].map(([id, label]) => [id, esc(label)])]) +
    (routes.length ? pick('route', 'ROUTE', [ALL, ...routes.map(([id, label]) => [id, esc(label)])]) : '') +
    pick('car', 'CAR', [ALL, ...CARS.filter(inGarage).map(c => [c.id, esc(c.name)])]) +
    C.button({ label: d.advanced ? 'FEWER FILTERS' : 'WEATHER & ASSISTS', icon: 'sliders-horizontal', act: 'leaderboardAdvanced', block: true, size: 'sm' }) +
    (d.advanced ? pick('weather', 'WEATHER', [ALL, ...['clear', 'overcast', 'rain', 'dynamic'].map(v => [v, v.toUpperCase()])]) +
      pick('tc', 'TC', [ALL, ['true', 'ON'], ['false', 'OFF']]) + pick('abs', 'ABS', [ALL, ['true', 'ON'], ['false', 'OFF']]) +
      pick('steering', 'STEERING', [ALL, ...['off', 'light', 'full'].map(v => [v, v.toUpperCase()])]) +
      pick('gearbox', 'GEARBOX', [ALL, ['auto', 'AUTO'], ['manual', 'MANUAL']]) : '') +
    C.button({ label: 'CLEAR FILTERS', act: 'leaderboardReset', variant: 'ghost', size: 'sm', block: true });
  const rows = (d.tab === 'personal' ? local : d.entries || []).filter(r => matchesRecord(r, f));
  let content;
  // One state at a time in the results column: loading, failed, empty or the ranked list.
  if (d.tab === 'global' && d.loading) content = C.emptyState({ busy: true, title: 'LOADING TIMES' });
  else if (d.tab === 'global' && d.error) content = C.emptyState({ icon: 'triangle-alert', tone: 'bad', title: 'TIMES UNAVAILABLE', text: esc(d.error), action: C.button({ label: 'TRY AGAIN', act: 'leaderboardRetry' }) });
  else content = rows.length ? `<ol class="lb-records" aria-label="Ranked times">${rows.map((r, i) => `<li>${renderBestRecord(r, { rank: i + 1, global: d.tab === 'global' })}</li>`).join('')}</ol>` : C.emptyState({ icon: 'timer', title: 'NO TIMES YET', text: d.tab === 'personal' ? 'Finish a clean race on this track to set one.' : 'No one has set a time with these filters.' });
  // A render schedules one request per filter key. Responses from an abandoned screen are ignored.
  if (d.tab === 'global') queueMicrotask(() => loadGlobal(menu, d));
  return C.browseGrid({ variant: 'filtered', title: 'LEADERBOARDS', kick: 'QUICK RACE', cls: 'scr--leaderboards', hints: [['select', 'SELECT'], ['leftright', 'FILTER'], ['tabs', 'TAB'], ['back', 'BACK']], filters:
    C.tabs({ key: 'leaderboardTab', value: d.tab, options: [['personal', 'PERSONAL BESTS'], ['global', 'ALL DRIVERS']] }), aside: C.panel('', filters), busy: d.tab === 'global' && !!d.loading,
    items: `<p class="muted lb-note">${d.tab === 'personal' ? 'Your fastest clean runs, saved on this device.' : 'The 100 fastest clean runs from all drivers.'}</p>${content}` });
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
