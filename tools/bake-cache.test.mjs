import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { bakeSourceClosure, bakeCodeKey, bakeMapKey, lookupEntry, publishEntry, pruneEntries } from './bake-cache.mjs';
import { MAPS } from '../src/map-catalog.js';

const root = resolve(import.meta.dirname, '..');

test('the bake key covers what the bake imports and nothing else', async () => {
  const files = await bakeSourceClosure(root);
  for (const needed of ['tools/bake-world.mjs', 'src/terrain.js', 'src/road-network.js', 'src/baked-world-pack.js', 'src/map-catalog.js', 'tools/meshopt-pack.mjs', 'tools/world-download-assets.mjs']) assert.ok(files.includes(needed), `${needed} feeds the bake`);
  assert.ok(!files.includes('src/asset-codec-policy.js'), 'the policy is the bake\'s own output');
  for (const unrelated of ['src/ui/ui.css', 'index.html', 'CHANGELOG.md', 'worker/index.mjs', 'tools/run-tests.mjs']) assert.ok(!files.includes(unrelated), `${unrelated} cannot change a bake`);
});
test('keys are stable, per map and move with the node version', async () => {
  const a = await bakeCodeKey(root), b = await bakeCodeKey(root);
  assert.equal(a.key, b.key);
  assert.notEqual(a.key, (await bakeCodeKey(root, { nodeVersion: 'v0.0.1' })).key);
  const keys = new Set();
  for (const def of MAPS) keys.add((await bakeMapKey(root, a.key, def)).key);
  assert.equal(keys.size, MAPS.length, 'every map has its own entry');
});
test('a map\'s data and terrain files are key inputs', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'asr-bake-key-'));
  try {
    mkdirSync(join(dir, 'data'));
    const def = { id: 'x', dataUrl: 'data/x.json', terrainUrl: 'data/x.bin' };
    writeFileSync(join(dir, 'data/x.json'), '{}'); writeFileSync(join(dir, 'data/x.bin'), 'a');
    const before = (await bakeMapKey(dir, 'code', def)).key;
    assert.equal((await bakeMapKey(dir, 'code', def)).key, before);
    writeFileSync(join(dir, 'data/x.bin'), 'b');
    assert.notEqual((await bakeMapKey(dir, 'code', def)).key, before);
    assert.notEqual((await bakeMapKey(dir, 'other', def)).key, before);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('entries publish atomically, a lost race keeps the first entry, and pruning drops least recently used first within the cap', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'asr-bake-cache-'));
  try {
    const stage = name => { const path = join(dir, `.stage-${name}`); mkdirSync(path); writeFileSync(join(path, 'meta.json'), '{}'); writeFileSync(join(path, 'blob'), Buffer.alloc(1000, name.charCodeAt(0))); return path; };
    assert.equal(await lookupEntry(dir, 'a'), null);
    for (const key of ['a', 'b', 'c', 'd']) await publishEntry(dir, key, stage(key));
    const again = stage('a'); await publishEntry(dir, 'a', again);
    assert.ok(!existsSync(again), 'the loser\'s staging directory is removed');
    assert.ok(await lookupEntry(dir, 'a'));
    const old = (Date.now() - 3600_000) / 1000;
    for (const [i, key] of ['a', 'b', 'c', 'd'].entries()) utimesSync(join(dir, key), old + i, old + i); // a oldest ... d newest
    utimesSync(join(dir, 'a'), old + 10, old + 10); // a was just used: b is now the least recently used
    const result = await pruneEntries(dir, { maxBytes: 2200, keep: 1, minAgeMs: 60_000 });
    assert.deepEqual(result.removed, ['b', 'c']);
    assert.ok(existsSync(join(dir, 'a')) && existsSync(join(dir, 'd')));
    const fresh = await pruneEntries(dir, { maxBytes: 0, keep: 0, minAgeMs: 10 * 3600_000 });
    assert.deepEqual(fresh.removed, [], 'nothing younger than minAge is removed');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
