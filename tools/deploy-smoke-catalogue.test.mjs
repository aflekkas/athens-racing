import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { getMap } from '../src/map-catalog.js';
import { resolveMap } from '../server/map-definitions.mjs';
import { verifySessionCatalogue } from './deploy-smoke-catalogue.mjs';

for (const id of ['riviera', 'penteli']) {
  const meta = getMap(id), data = JSON.parse(await readFile(new URL('../' + meta.dataUrl, import.meta.url)));
  const map = resolveMap(meta, data), events = [...map.definitions.values()];
  const offered = { track: map.track, events };
  test(`${id}: smoke selects canonical Quick Race and verifies Free Roam too`, () => {
    const { event, definition } = verifySessionCatalogue(meta, data, offered);
    assert.equal(event.type, 'sprint'); assert.equal(event.id, id === 'riviera' ? 'quick' : 'penteli-race');
    assert.equal(definition.id, event.id);
  });
  test(`${id}: old shortest sprint / time trial catalogue fails before lobby creation`, () => {
    for (const event of [{ ...events[0], id: 'classic-cup', len: 1 }, { ...events[0], type: 'timetrial' }]) {
      assert.throws(() => verifySessionCatalogue(meta, data, { ...offered, events: [event, events[1]] }), /catalogue mismatch|expected exactly/);
    }
    assert.throws(() => verifySessionCatalogue(meta, data, { ...offered, events: events.slice(0, 1) }), /catalogue mismatch/);
  });
  test(`${id}: matching IDs with mismatched route geometry cannot start a smoke race`, () => {
    assert.throws(() => verifySessionCatalogue(meta, data, { ...offered, events: [{ ...events[0], s0: events[0].s0 + 1 }, events[1]] }), /catalogue s0 mismatch/);
  });
}
