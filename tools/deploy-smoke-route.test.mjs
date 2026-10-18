import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolveMap } from '../server/map-definitions.mjs';
import { smokeDrive, SMOKE_STEP } from './deploy-smoke-route.mjs';
for (const id of ['riviera', 'megara', 'penteli', 'psychiko']) {
  const path = id === 'riviera' ? '../data/map.json' : `../data/maps/${id}/map.json`;
  const data = JSON.parse(await readFile(new URL(path, import.meta.url)));
  const map = resolveMap({ id }, data);
  for (const event of map.definitions.values()) {
    if (event.type !== 'sprint') continue;
    test(`deployment smoke covers the whole route: ${id}/${event.id}`, () => {
      const drive = smokeDrive(event, map.geometry);
      assert.ok(Number.isFinite(drive.finishedAt));
      assert.ok(drive.samples.every(s => Number.isFinite(s.x) && Number.isFinite(s.y) && Number.isFinite(s.z)));
      assert.ok((drive.samples.at(-1).s - event.s1) * event.dir > 0);
      for (let i = 1; i < drive.samples.length; i++) assert.ok(Math.abs(drive.samples[i].s - drive.samples[i - 1].s) <= SMOKE_STEP + .0001);
    });
  }
}
