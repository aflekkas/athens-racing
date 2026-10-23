// Quick Race → a route with a race and a time trial: the picker opens its race, and Race Setup's EVENT row (the kit's
// segmented control) switches between them. Each event keeps its own options, saved setup and records; CHOOSE CAR starts
// the event shown; Back still leaves the screen. Generic over every route definition, no route is named in menu.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { routeEvent } from '../src/route-events.js';
const { Menu } = await import('../src/menu.js');

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const memoryStorage = () => { const v = new Map(); return { getItem: k => v.has(k) ? v.get(k) : null, setItem: (k, x) => v.set(k, String(x)), removeItem: k => v.delete(k) }; };
function compiledRoute(id) {
  const d = JSON.parse(read(`data/routes/${id}.route.json`));
  const points = Array.from({ length: 40 }, (_, i) => [Math.cos(i / 6) * 300 + i * 20, 0, Math.sin(i / 6) * 200]);
  // like the compiler: only enabled events reach the world
  return { id: d.id, regionId: d.regionId, lengthM: d.lengthM, geometryHash: 'hash-' + id, sectorsM: [], points, definition: { ...d, events: d.events.filter(e => e.enabled !== false).map(e => ({ ...e, enabled: true, laps: e.laps || d.laps || 1 })) } };
}
function setupMenu(id) {
  const compiled = compiledRoute(id), events = compiled.definition.events.map(e => routeEvent(compiled, e.id)), def = events.find(e => e.type === 'sprint') || events[0];
  const ctx = { mapId: 'athens', eventId: def.id, events, route: { isWorldRoute: true, compiled, length: compiled.lengthM, closed: compiled.definition.kind === 'circuit', from: compiled.definition.name, to: 'FINISH' } };
  const opened = [];
  const menu = Object.assign(Object.create(Menu.prototype), { screen: 'setup', data: { mode: 'quick', eventId: def.id, def, trackTimes: { loading: false, entries: [], history: [], requested: true } },
    h: { ctx: () => ctx, fmtTime: t => String(t), openEvent: d => opened.push(d) }, refresh() {} });
  return { menu, events, opened, change: (key, value) => menu.onChange({ key, value, el: { dataset: { scope: 'setup' } } }) };
}
async function withBrowserGlobals(fn) {
  const prior = { document: globalThis.document, window: globalThis.window, localStorage: globalThis.localStorage };
  globalThis.document = { baseURI: 'http://localhost/', querySelector: () => null, body: { classList: { contains: () => false } } };
  globalThis.window = {}; globalThis.localStorage = memoryStorage();
  try { return await fn(); } finally { for (const [k, v] of Object.entries(prior)) { if (v === undefined) delete globalThis[k]; else globalThis[k] = v; } }
}
const eventRow = html => html.match(/<div class="mi field[^"]*" data-kind="[^"]*" data-key="event"[\s\S]*?<\/small><\/div>/)?.[0] || '';

test('a route with a race and a time trial offers both on Race Setup; the race is the default', async () => {
  await withBrowserGlobals(async () => {
    const { menu } = setupMenu('megara-club'), html = menu.r_setup(), row = eventRow(html);
    assert.ok(row, 'EVENT row');
    assert.match(row, /data-kind="choice"/, 'the kit segmented control, with its sliding selection');
    assert.match(row, /data-value="megara-race"/);
    assert.match(row, /RACE[\s\S]*TIME TRIAL/);
    assert.ok(html.indexOf('data-key="event"') < html.indexOf('data-key="rivals"'), 'EVENT leads the options');
    assert.match(html, /data-kind="stepper" data-key="rivals"/, 'the race has rivals');
  });
});

test('switching to the time trial keeps the screen, drops rivals, keeps laps, and starts the time trial', async () => {
  await withBrowserGlobals(async () => {
    const { menu, opened, change } = setupMenu('megara-club');
    change('rivals', 1);
    change('event', 'megara-tt');
    assert.equal(menu.screen, 'setup');
    assert.equal(menu.data.def.id, 'megara-tt'); assert.equal(menu.data.eventId, 'megara-tt');
    assert.equal(menu.data.trackTimes, null, 'records reload for the time-trial board');
    const html = menu.r_setup(), adv = (menu.data.advanced = true, menu.r_setup());
    assert.match(eventRow(html), /data-value="megara-tt"/);
    assert.doesNotMatch(html, /data-key="rivals"/, 'a time trial has no rivals');
    assert.match(html, /FORMAT<\/span><b class="stat-tile__v">TIME TRIAL · 3 LAPS</);
    assert.match(adv, /data-kind="stepper" data-key="laps"[^>]*data-value="3"/);
    change('laps', 5);
    menu.startSetup();
    const run = opened.at(-1);
    assert.equal(run.type, 'timetrial'); assert.equal(run.baseId, 'megara-tt'); assert.equal(run.laps, 5); assert.equal(run.rivalCount, undefined);
    change('event', 'megara-race');
    menu.startSetup();
    const race = opened.at(-1);
    assert.equal(race.type, 'sprint'); assert.equal(race.baseId, 'megara-race'); assert.equal(race.laps, 3, 'the race keeps its own laps');
    assert.equal(race.rivalCount, 1, 'and its own saved rivals');
  });
});

test('single-event routes, disabled events and reverse variants add no EVENT row', async () => {
  await withBrowserGlobals(async () => {
    for (const id of ['riviera-coast', 'penteli-descent', 'psychiko-faros', 'syntagma-pilot']) assert.equal(eventRow(setupMenu(id).menu.r_setup()), '', id);
    const { menu, events } = setupMenu('penteli-hill');
    assert.deepEqual(menu.setupEvents().map(e => e.type), ['sprint', 'timetrial']);
    events.push({ ...events[0], id: 'penteli-race-rev', reverse: true });
    assert.equal(menu.setupEvents().length, 2, 'a reverse run is the DIRECTION option, not another event');
    assert.equal(menu.setupEvents({ type: 'free' }).length, 0, 'free roam and map events have no event choice');
  });
});

test('the event choice is generic: no route is named in the setup code', () => {
  const src = read('src/menu.js'), body = src.slice(src.indexOf('setupEvents(def'), src.indexOf('setupKey()'));
  assert.doesNotMatch(body, /kifiss|megara|penteli|psychiko|riviera|syntagma/i);
});
