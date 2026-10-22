// Race Setup (owner 2026-10-21: "this is the ui that is chopped"). One track header, one compact records block, the settings
// with CHOOSE CAR, for every Athens route. Browser layout evidence (no inner overflow at 1280x800 and 960x700) is captured by the
// task; these checks hold the markup, copy, dedupe and keyboard contracts that layout depends on.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { routeEvent } from '../src/route-events.js';
import { dedupeHistory, migrateRouteRecords, routeHistory } from '../src/route-migrations.js';
import { getRouteHistoricalTimes } from '../src/personal-bests.js';
import { renderSetupRecords } from '../src/leaderboards-screen.js';
import { TIMES } from '../src/race-setup.js';
// Loaded without a DOM, like the other menu tests: module setup skips browser wiring.
const { Menu } = await import('../src/menu.js');

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const ROUTES = ['riviera-coast', 'megara-club', 'penteli-hill', 'penteli-descent', 'psychiko-faros'];
const memoryStorage = (entries = {}) => { const values = new Map(Object.entries(entries)); return { getItem: k => values.has(k) ? values.get(k) : null, setItem: (k, v) => values.set(k, String(v)), removeItem: k => values.delete(k), key: i => [...values.keys()][i] ?? null, get length() { return values.size; } }; };
// The owner's case: one original Riviera run held by both local stores.
const RUN = { mapId: 'riviera', eventId: 'quick', version: '4718fbec', time: 86.512, car: 'mini', date: '2026-10-21T10:00:00Z', setup: { map: 'riviera', event: 'quick', from: 241, to: 10548, direction: 1, laps: 1, car: 'mini', traffic: 1, time: 'afternoon', weather: 'clear', rivals: 2, police: false, tc: true, abs: true, steering: 'full', gearbox: 'auto' } };
const twoStores = () => memoryStorage({ 'paraliaki.personalBests.v1': JSON.stringify({ version: 1, exact: { [JSON.stringify(RUN.setup)]: RUN }, routes: {} }), 'paraliaki.events.quick': JSON.stringify({ bestTime: RUN.time, version: '4718fbec', car: 'mini', setup: RUN.setup, date: RUN.date }) });

function compiledRoute(id) {
  const d = JSON.parse(read(`data/routes/${id}.route.json`));
  const points = Array.from({ length: 40 }, (_, i) => [Math.cos(i / 6) * 300 + i * 20, 0, Math.sin(i / 6) * 200]);
  return { id: d.id, regionId: d.regionId, lengthM: d.lengthM, geometryHash: 'hash-' + id, sectorsM: [], points, definition: { ...d, events: d.events.map(e => ({ ...e, enabled: true, laps: e.laps || d.laps || 1 })) } };
}
async function renderSetup(id, { data = {}, eventIndex = 0 } = {}) {
  const compiled = compiledRoute(id), def = routeEvent(compiled, compiled.definition.events[eventIndex].id);
  const ctx = { mapId: 'athens', eventId: def.id, events: [def], route: { isWorldRoute: true, compiled, length: compiled.lengthM, closed: compiled.definition.kind === 'circuit', from: compiled.definition.name, to: 'FINISH' } };
  const menu = Object.assign(Object.create(Menu.prototype), { screen: 'test', data: { mode: 'quick', trackTimes: { loading: false, entries: [], history: [], requested: true }, ...data }, h: { ctx: () => ctx, fmtTime: t => String(t) } });
  return { html: menu.r_setup(), def, compiled };
}
async function withBrowserGlobals(fn) {
  const prior = { document: globalThis.document, window: globalThis.window, localStorage: globalThis.localStorage };
  globalThis.document = { baseURI: 'http://localhost/', querySelector: () => null, body: { classList: { contains: () => false } } };
  globalThis.window = {}; globalThis.localStorage = memoryStorage();
  try { return await fn(); } finally { for (const [k, v] of Object.entries(prior)) { if (v === undefined) delete globalThis[k]; else globalThis[k] = v; } }
}

test('one original run held by two local stores and the server is one historical time', () => {
  const local = getRouteHistoricalTimes('riviera-coast', twoStores());
  assert.equal(local.length, 1, 'personal-bests v1 and the event counter describe the same run');
  const me = 'device-me-123', mine = migrateRouteRecords([{ ...RUN, driverId: me, name: 'ME', at: Date.parse(RUN.date) }], { source: 'server-json' })[0];
  const rival = { ...mine, driverId: 'device-other-456', name: 'NIKOS' };
  assert.equal(dedupeHistory([...local, mine], { me }).length, 1, 'the server copy of a run this device submitted is not a second time');
  assert.equal(dedupeHistory([...local, mine, rival], { me }).length, 2, 'another driver with the same time is a different run');
  assert.equal(dedupeHistory([mine, { ...mine, identity: { ...mine.identity, eventId: 'tt-riviera' } }], { me }).length, 2, 'the same time in another event is a different run');
  const slower = { ...local[0], time: 90.1 }, kept = dedupeHistory([slower, ...local, { ...local[0], setup: undefined }]);
  assert.deepEqual(kept.map(r => r.time), [86.512, 90.1], 'fastest first; the copy with its setup is kept');
  assert.ok(kept[0].setup);
  assert.equal(routeHistory([RUN, RUN], 'riviera-coast').length, 1, 'the shared history helper (client and server boards) dedupes too');
  // The owner's '1:26.51 ×2' on production: two deployment smoke clients' runs (server/smoke-session.mjs ids), not players' history.
  const smoke = { ...RUN, driverId: 'smoke-efdad773-8768-43e6', name: 'Deployment smoke', at: 1792606860656 };
  assert.equal(routeHistory(migrateRouteRecords([smoke, { ...smoke, driverId: 'smoke-158b9cd7-d0de', name: 'Deployment smo#2', time: 86.513 }], { source: 'do-sqlite' }), 'riviera-coast').length, 0);
  assert.equal(routeHistory(migrateRouteRecords([{ ...smoke, driverId: 'player-1234567890', name: 'NIKOS' }], { source: 'do-sqlite' }), 'riviera-coast').length, 1, 'a real driver still counts');
});

test('Race Setup records: single-line empty states, collapsed and deduped history, no cards or inner scroll', async () => {
  await withBrowserGlobals(async () => {
    const history = migrateRouteRecords([RUN, { ...RUN, migration: undefined }], { source: 'event-store', key: 'paraliaki.events.quick' });
    const d = { trackTimes: { loading: false, entries: [], history, requested: true } }, filters = { mapId: 'athens', routeId: 'riviera-coast', eventId: 'quick' };
    let html = renderSetupRecords({ screen: 'test' }, d, filters);
    assert.doesNotMatch(html, /class="panel|scroll-y/, 'records are rows inside the track panel, never nested cards or a scroller');
    assert.match(html, /PERSONAL BEST<\/b><span>No time yet\. Finish a clean race to set one\.<\/span>/, 'an empty PB is one row');
    assert.match(html, /No times yet\. Be the first\./);
    assert.match(html, /ORIGINAL RIVIERA TRACK · 1 TIME/, 'the duplicated original run counts once');
    assert.match(html, /data-act="setupHistory"[^>]*aria-expanded="false"/, 'history starts collapsed');
    assert.doesNotMatch(html, /1:26\.51/, 'collapsed history lists no rows');
    d.showHistory = true; html = renderSetupRecords({ screen: 'test' }, d, filters);
    assert.equal([...html.matchAll(/1:26\.51/g)].length, 1, 'expanded history shows the run once');
    assert.match(html, /recs__rank">1<\/span>YOU</, 'a run from this device is YOU');
    d.trackTimes.history = migrateRouteRecords([3, 4, 5, 6].map(t => ({ ...RUN, time: 86 + t, driverId: `player-${t}-abcdefgh`, name: `DRIVER ${t}`, at: 1792606860656 + t })), { source: 'do-sqlite' });
    html = renderSetupRecords({ screen: 'test' }, d, filters);
    assert.match(html, /DRIVER 3/, 'another driver shows by name, never as YOU');
    assert.equal([...html.matchAll(/recs__rank/g)].length, 3, 'expanded history lists the fastest three, so it fits beside advanced options at 1280x800');
    assert.match(html, /Fastest 3 of 4\./);
    assert.match(html, /aria-expanded="true"/);
    d.trackTimes = { loading: false, error: 'Leaderboard unavailable.', entries: [], requested: true };
    html = renderSetupRecords({ screen: 'test' }, d, { mapId: 'megara', eventId: 'megara-race' });
    assert.match(html, /<div class="recs__line"><span>Leaderboard unavailable\.<\/span><div class="btn btn--ghost btn--sm[^"]*" role="button" data-act="trackTimesRetry"/, 'a failed board is one line with its retry inside');
    assert.doesNotMatch(html, /setupHistory/, 'a track without original times has no history toggle');
    d.trackTimes = { loading: false, entries: [1, 2, 3, 4].map(time => ({ name: `DRIVER ${time}`, car: 'mini', time })), requested: true };
    assert.equal([...renderSetupRecords({ screen: 'test' }, d, { mapId: 'megara', eventId: 'megara-race' }).matchAll(/recs__rank/g)].length, 4, 'every board row the loader kept is listed');
  });
});

test('Race Setup header on every Athens route: name, place, distance, format, region; no FINISH, ROAD or FIELD repeats', async () => {
  await withBrowserGlobals(async () => {
    for (const id of ROUTES) {
      const { html, compiled } = await renderSetup(id), name = compiled.definition.name;
      const head = html.slice(html.indexOf('class="setup-head"'), html.indexOf('class="recs"'));
      assert.match(head, new RegExp(`setup-head__name">${name}<`), id);
      assert.match(head, /class="route-outline"/, `${id} draws its route outline`);
      assert.match(head, /DISTANCE<\/span><b class="stat-tile__v">[\d.]+ KM</, id);
      assert.match(head, compiled.definition.kind === 'circuit' ? /FORMAT<\/span><b class="stat-tile__v">CIRCUIT · \d+ LAPS?</ : /FORMAT<\/span><b class="stat-tile__v">(SPRINT|TIME TRIAL)</, id);
      assert.match(head, /REGION<\/span><b class="stat-tile__v">(ATHENS|PENTELI|MEGARA)</, id);
      assert.match(head, /setup-head__where">[^<]+</, `${id} has a place line`);
      const stage = html.slice(html.indexOf('setup__event'), html.indexOf('setup__form'));
      assert.doesNotMatch(stage, /FINISH|→|arrow-right/, `${id}: no "NAME → FINISH" route line`);
      assert.doesNotMatch(head, />ROAD<|>FIELD<|TRAFFIC</, `${id}: rivals and traffic are settings, not header facts`);
      assert.match(html, /class="recs"/, `${id} shows its records block`);
      assert.match(html, /data-act="setupGo"[^>]*data-default/, `${id}: CHOOSE CAR is the default action`);
      assert.match(html, /class="btn btn--ghost btn--sm btn--block mi setup__more" role="button" data-act="setupAdvanced"/, `${id}: ADVANCED OPTIONS spans the settings column (spatial up / down reaches CHOOSE CAR)`);
    }
    assert.match((await renderSetup('penteli-descent')).html, /Karakanta to Dionysos/, 'the descent reads in its own direction');
  });
});

test('Race Setup controls: every setting kept, TIME OF DAY is a stepper (no dropdown), keyboard hints row', async () => {
  await withBrowserGlobals(async () => {
    for (const id of ROUTES) {
      const { html, def } = await renderSetup(id), adv = (await renderSetup(id, { data: { advanced: true } })).html;
      assert.doesNotMatch(adv, /data-kind="select"|role="combobox"|<select/, `${id}: no dropdowns on Race Setup`);
      assert.match(html, /data-kind="stepper" data-key="time"[^>]*data-options=/, `${id}: TIME OF DAY steps left / right through the list`);
      if (def.type === 'sprint') assert.match(html, /data-kind="stepper" data-key="rivals"/, `${id} rivals`);
      for (const key of ['police', 'traffic']) assert.match(html, new RegExp(`data-key="${key}"`), `${id} ${key}`);
      assert.match(adv, /data-key="weather"/, `${id} weather under advanced`);
      if (JSON.parse(read(`data/routes/${id}.route.json`)).kind === 'circuit') assert.match(adv, /data-kind="stepper" data-key="laps"/, `${id} laps`);
      const hints = html.slice(html.indexOf('class="hints'));
      for (const [, label] of [['updown', 'SELECT'], ['leftright', 'CHANGE'], ['confirm', 'OK'], ['back', 'BACK']]) assert.match(hints, new RegExp(label), `${id} hint ${label}`);
    }
    // Every Athens time of day is still reachable, and a changed one names the default.
    const { html } = await renderSetup('riviera-coast');
    const options = JSON.parse(html.match(/data-key="time"[^>]*data-options="([^"]+)"/)[1].replace(/&quot;/g, '"'));
    assert.deepEqual(options.map(([v]) => v), TIMES.map(([v]) => v));
    globalThis.localStorage.setItem('paraliaki.raceSetup', JSON.stringify({ quick: { time: 'night' } }));
    assert.match((await renderSetup('riviera-coast')).html, /Default: afternoon/);
  });
});

test('Race Setup layout lives in the kit: equal panels, no visible inner scrollbars, compact records', () => {
  const css = read('src/ui/ui.css');
  assert.match(css, /\.setup-layout \{[^}]*align-content: start/, 'the two panels share one content-sized row (equal heights, no half-empty column)');
  assert.match(css, /\.setup__event \{[^}]*scrollbar-width: none/);
  assert.match(css, /\.setup__fields \{[^}]*scrollbar-width: none/);
  assert.match(css, /\.setup__go \{[^}]*border-top/, 'CHOOSE CAR sits on its own foot under the settings');
  assert.match(css, /\.recs \.list-row\.recs__row \{[^}]*min-height: 2\.6rem/, 'record rows are compact');
  assert.doesNotMatch(read('src/menu.js'), /evs__|eventSummary/, 'the old cramped summary is gone');
});
