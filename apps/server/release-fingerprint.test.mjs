import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { runtimeReleaseHash } from './release-fingerprint.mjs';

test('same shared game release accepts LF/CRLF native backend checkouts but rejects executable or data changes', async () => {
  const temp = await mkdtemp(resolve(tmpdir(), 'athens-release-hash.'));
  try {
    const gameRoot = resolve(temp, 'game'); await mkdir(resolve(gameRoot, 'src'), { recursive: true }); await mkdir(resolve(gameRoot, 'data/athens'), { recursive: true });
    await writeFile(resolve(gameRoot, 'src/entry.js'), 'export const game = 1;\n'); await writeFile(resolve(gameRoot, 'desktop-manifest.json'), '{"build":"shared-artifact"}\n'); await writeFile(resolve(gameRoot, 'catalogue.json'), '{"routes":[]}\n'); await writeFile(resolve(gameRoot, 'data/athens/manifest.json'), '{"revision":"world"}\n');
    const codeRoots = [resolve(temp, 'linux'), resolve(temp, 'windows')];
    for (const [i, root] of codeRoots.entries()) for (const path of ['server/core.mjs', 'server/nested/authority.mjs', 'packages/contracts/desktop.mjs', 'apps/server/runtime.mjs', 'apps/server/release-fingerprint.mjs']) { await mkdir(resolve(root, path, '..'), { recursive: true }); await writeFile(resolve(root, path), ('export const version = 1;\n// same source\n').replace(/\n/g, i ? '\r\n' : '\n')); }
    const native = async codeRoot => runtimeReleaseHash({ gameRoot, codeRoot });
    const baseline = await native(codeRoots[0]); assert.equal(await native(codeRoots[1]), baseline);
    await writeFile(resolve(codeRoots[1], 'server/core.mjs'), 'export const version = 2;\r\n'); assert.notEqual(await native(codeRoots[1]), baseline);
    await writeFile(resolve(gameRoot, 'catalogue.json'), '{"routes":[]}\r\n'); assert.notEqual(await native(codeRoots[0]), baseline, 'data is never line-ending normalized');
    await writeFile(resolve(gameRoot, 'catalogue.json'), '{"routes":[]}\n');
    await writeFile(resolve(gameRoot, 'src/entry.js'), 'export const game = 1;\r\n'); assert.notEqual(await native(codeRoots[0]), baseline, 'shared game artifact bytes remain exact');
  } finally { await rm(temp, { recursive: true, force: true }); }
});
