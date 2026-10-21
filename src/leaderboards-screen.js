import * as C from './ui/components.js';
import { MAPS } from './map-catalog.js';
import { getEvents } from './events.js';
import { CARS } from './cars.js';
import { inGarage } from './car-catalog.js';
import {historicalEdition,historicalEditionLabel,dedupeHistory} from './route-migrations.js';
import {getRouteHistoricalTimes, listPersonalBests } from './personal-bests.js';
import { getLeaderboard, driverId } from './leaderboard.js';
import { matchesRecord, recordEvent, carLabel, routeId, routeLabel, setupLabels, recordDate, formatRecordTime } from './leaderboard-records.js';
const { esc } = C;
const ALL = ['', 'ALL'];
export function lastLeaderboardMap() {
  try { const id = localStorage.getItem('paraliaki.lastPlayedMap'); if (MAPS.some(m => m.id === id)) return id; } catch {}
  return window.__flow?.mapId || 'riviera';
}
export function renderBestRecord(r, { rank, global = false, title, compact = false, historical = false } = {}) {
  if (compact) return C.listRow({ title: `${rank ? `#${rank} · ` : ''}${esc(r.name || 'DRIVER')}`, desc: esc(carLabel(r, CARS)), meta: esc(formatRecordTime(r.time)), focusable: false, go: false });
  const heading = title || `#${rank} · ${formatRecordTime(r.time)}`, car = carLabel(r, CARS), date = recordDate(r);
  return C.panel(esc(heading), `<div class="lb-record">
    ${global ? `<b>${esc(r.name || 'DRIVER')}</b>` : ''}${!/^unknown(?: car)?$/i.test(car.trim()) ? `<b>${esc(car)}</b>` : ''}
    ${historical ? '' : `<span class="muted">${esc(recordEvent(r).replace(/[-_]/g, ' ').toUpperCase())} · ${esc(routeLabel(r))}</span>`}
    ${setupLabels(r).map(line => `<span>${esc(line)}</span>`).join('')}
    </div>`, { icon: 'timer', cls: 'lb-entry', right: date === 'Date unknown' ? '' : `<span class="muted">${esc(date)}</span>` });
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
  const history=trackHistory(filters,state);
  return `${personal}${C.panel('TOP 3',global,{attrs:{'aria-live':'polite','aria-busy':!!state.loading}})}${filters.routeId?C.panel('HISTORICAL TIMES',history.length?history.map(r=>{const time=r.time??r.bestTime;return renderBestRecord({...r,time},{historical:true,title:`${historicalEditionLabel(r.identity?.edition)} · ${formatRecordTime(time)}`});}).join(''):'<p class="muted">Verified earlier course times stay in their historical edition. This road course has a separate board.</p>'):''}`;
}
// This device's original runs plus the server's: a run this device submitted is in both and is shown once.
function trackHistory(filters, state) {
  if (!filters.routeId) return [];
  const edition = filters.historyEdition || historicalEdition(filters.routeId);
  return dedupeHistory([...getRouteHistoricalTimes(filters.routeId, undefined, { edition }), ...(state.history || []).filter(r => r.identity?.edition === edition)], { me: driverId() });
}
const HISTORY_ROWS = 3;
/** Race Setup's records: one compact block that never needs its own scrollbar. PB and Top 3 are rows (an empty one is a single
 *  line), and the original-course times sit behind one toggle (`d.showHistory`), fastest three shown. */
export function renderSetupRecords(menu, d, filters) {
  const best = listPersonalBests(filters)[0], state = d.trackTimes ||= { loading: true };
  const row = (title, desc, meta, cls = '') => C.listRow({ title, desc, meta, cls: `recs__row ${cls}`, focusable: false, go: false });
  const pb = best ? row('PERSONAL BEST', esc([carLabel(best, CARS), recordDate(best)].filter(t => t && t !== 'Date unknown').join(' · ')), esc(formatRecordTime(best.time)), 'recs__row--pb')
    : row('PERSONAL BEST', 'No time yet. Finish a clean race to set one.', '', 'recs__row--empty');
  let top;
  if (state.loading) top = `<div class="recs__line">${C.spinner()}<span>Loading times</span></div>`;
  else if (state.error) top = `<div class="recs__line"><span>${esc(state.error)}</span>${C.button({ label: 'TRY AGAIN', act: 'trackTimesRetry', size: 'sm', variant: 'ghost' })}</div>`;
  else top = state.entries.length ? state.entries.map((r, i) => row(`<span class="recs__rank">${i + 1}</span>${esc(r.name || 'DRIVER')}`, esc(carLabel(r, CARS)), esc(formatRecordTime(r.time)))).join('') : '<div class="recs__line">No times yet. Be the first.</div>';
  queueMicrotask(() => loadTrackTimes(menu, d, state, filters));
  const history = trackHistory(filters, state), edition = filters.historyEdition || historicalEdition(filters.routeId);
  const old = history.length ? `<div class="recs__group recs__group--history">${C.button({ label: `${esc(historicalEditionLabel(edition).toUpperCase())} · ${history.length} ${history.length === 1 ? 'TIME' : 'TIMES'}`, icon: 'timer', iconRight: d.showHistory ? 'chevron-up' : 'chevron-down', variant: 'ghost', size: 'sm', act: 'setupHistory', cls: 'recs__toggle', attrs: { 'aria-expanded': String(!!d.showHistory) } })}
    ${d.showHistory ? `<div class="recs__list">${history.slice(0, HISTORY_ROWS).map((r, i) => row(`<span class="recs__rank">${i + 1}</span>${esc(r.name || 'YOU')}`, esc([carLabel(r, CARS), recordDate(r)].filter(t => t && t !== 'Date unknown').join(' · ')), esc(formatRecordTime(r.time ?? r.bestTime)))).join('')}${history.length > HISTORY_ROWS ? `<div class="recs__line">Fastest ${HISTORY_ROWS} of ${history.length}.</div>` : ''}</div>` : ''}</div>` : '';
  return `<section class="recs" aria-label="Times">${pb}<div class="recs__group" aria-live="polite" aria-busy="${!!state.loading}"><h4 class="recs__k">TOP 3</h4>${top}</div>${old}</section>`;
}
async function loadTrackTimes(menu, d, state, filters) {
  if (!['mapConfirm','setup'].includes(menu.screen) || menu.data !== d || d.trackTimes !== state || state.requested) return;
  state.requested = true;
  try {
    const entries = await getLeaderboard({ ...filters, limit: 3 });if(filters.routeId)state.history=await getLeaderboard({...filters,mapId:undefined,edition:filters.historyEdition||historicalEdition(filters.routeId),history:true,limit:100});
    state.entries = entries.filter(r => matchesRecord(r, filters)).sort((a, b) => a.time - b.time).slice(0, 3);
  } catch (error) { state.error = error.message; }
  finally {
    state.loading = false;
    // An abandoned request cannot repaint another track, setup or the full board.
    if (['mapConfirm','setup'].includes(menu.screen) && menu.data === d && d.trackTimes === state) menu.refresh();
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
