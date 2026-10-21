import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { quickRaceTracks } from '../src/track-catalog.js';
import { selectMap, renderMapSelect } from '../src/map-select.js';
const ids = ['syntagma-pilot', 'psychiko-faros', 'riviera-coast', 'penteli-hill', 'penteli-descent', 'megara-club'];
const catalogue = ids.map(id => {
  const d = JSON.parse(readFileSync(new URL(`../data/routes/${id}.route.json`, import.meta.url)));
  return { ...d, preview: [[0, 0], [100, 100]], events: d.events };
});
test('one entry per destination; enabled routes replace every legacy twin', () => {
  const tracks = quickRaceTracks([...catalogue, catalogue[0]]);
  assert.deepEqual(tracks.map(t => t.id).sort(), [...ids].sort());
  assert.equal(quickRaceTracks([]).length, 4);
  assert.deepEqual(quickRaceTracks([catalogue[1]]).map(t => t.id).sort(), ['riviera', 'megara', 'penteli', 'psychiko-faros'].sort());
});
for (const track of quickRaceTracks(catalogue)) test(`${track.id}: map card and selection carry the exact route/event to setup`, async () => {
  const before = globalThis.document;
  globalThis.document = { getElementById: () => ({}) };
  try {
    const html = renderMapSelect(track.id, catalogue);
    assert.match(html, new RegExp(`data-confirm-track="" data-map-id="${track.id}"`));
    assert.equal((html.match(/class="mi track-pin /g) || []).length, 6);
    const calls = [], menu = { data: { catalogue }, h: { async selectUnifiedRoute(id, eventId) { calls.push([id, eventId]); } } };
    await selectMap(menu, track.id);
    assert.deepEqual(calls, [[track.id, track.eventId]]);
    assert.equal(menu.mapLoading, false);
  } finally { globalThis.document = before; }
});
test('repeat confirmation is ignored while the selected route loads', async () => {
  let finish, calls = 0;
  const menu = {data:{catalogue},h:{selectUnifiedRoute:()=>{calls++;return new Promise(resolve=>finish=resolve);}}};
  const pending=selectMap(menu,ids[0]);await selectMap(menu,ids[1]);assert.equal(calls,1);finish();await pending;
});
