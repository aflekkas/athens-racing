import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile, stat, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { checkpointSignature, authenticateCheckpoint, openProofWorkspace } from './proof-checkpoint.mjs';
const key = 'a'.repeat(64), binding = 'b'.repeat(64);

test('physical checkpoint HMAC binds every cell result field, key, and source/semantic identity', () => {
  const result = { key: '0,0', descriptor: { sourceHash: 'c'.repeat(64), parts: ['d'.repeat(64)] }, anchorCount: 123, bytes: 456, footprints: [{ halfWidth: 1, halfLength: 2 }] };
  const record = { result, signature: checkpointSignature(key, binding, result) };
  assert.deepEqual(authenticateCheckpoint(record, key, binding), result);
  for (const change of [r => { r.result.key = '1,0'; }, r => { r.result.descriptor.sourceHash = 'e'.repeat(64); }, r => { r.result.descriptor.parts = []; }, r => { r.result.anchorCount = 1; }, r => { r.result.footprints[0].halfWidth = 3; }]) { const tampered = structuredClone(record); change(tampered); assert.throws(() => authenticateCheckpoint(tampered, key, binding), /authentication failed/); }
  assert.throws(() => authenticateCheckpoint(record, 'f'.repeat(64), binding), /authentication failed/);
  assert.throws(() => authenticateCheckpoint(record, key, 'f'.repeat(64)), /authentication failed/);
});

test('proof workspace resumes one private task directory and discards only its own stale binding', async () => {
  const base = await mkdtemp(resolve(tmpdir(), 'athens-checkpoint-test.')); let workspace;
  const out = resolve(base, 'online');
  try {
    workspace = await openProofWorkspace({ out, sourceInventoryHash: 'a'.repeat(64), semanticHash: 'b'.repeat(64) });
    const first = workspace.directory;
    const resumed = await openProofWorkspace({ out, sourceInventoryHash: 'a'.repeat(64), semanticHash: 'b'.repeat(64) });
    assert.equal(resumed.directory, first); assert.equal(resumed.key, workspace.key);
    const other = resolve(base, 'other-online');
    await writeFile(other + '.work.json', await readFile(out + '.work.json'), { mode: 0o600 });
    await assert.rejects(openProofWorkspace({ out: other, sourceInventoryHash: 'a'.repeat(64), semanticHash: 'b'.repeat(64) }), /owner mismatch/);
    await access(first); await rm(other + '.work.json');
    if (process.platform !== 'win32') { assert.equal((await stat(resolve(first, '.owner.json'))).mode & 0o777, 0o600); assert.equal((await stat(out + '.work.json')).mode & 0o777, 0o600); }
    workspace = await openProofWorkspace({ out, sourceInventoryHash: 'a'.repeat(64), semanticHash: 'c'.repeat(64) });
    assert.notEqual(workspace.directory, first); await assert.rejects(access(first));
    const stage = await workspace.publicationStage();
    await writeFile(stage, 'owned interrupted publication');
    const afterCrash = await openProofWorkspace({ out, sourceInventoryHash: 'a'.repeat(64), semanticHash: 'c'.repeat(64) });
    assert.equal(afterCrash.directory, workspace.directory); await assert.rejects(access(stage));
    await workspace.cleanup(); workspace = null; await assert.rejects(access(out + '.work.json'));
  } finally { await workspace?.cleanup(); await rm(base, { recursive: true, force: true }); }
});

test('unowned pointer and missing owner metadata fail closed without deleting or replacing another directory', async () => {
  const base = await mkdtemp(resolve(tmpdir(), 'athens-checkpoint-unowned.')); let workspace;
  const out = resolve(base, 'online'), unrelated = resolve(base, 'unrelated.txt');
  try {
    await writeFile(unrelated, 'keep');
    await writeFile(out + '.work.json', JSON.stringify({ directory: base, id: 'foreign', binding }));
    await assert.rejects(openProofWorkspace({ out, sourceInventoryHash: key, semanticHash: binding }), /not task-owned/);
    assert.equal(await readFile(unrelated, 'utf8'), 'keep');
    await rm(out + '.work.json');
    workspace = await openProofWorkspace({ out, sourceInventoryHash: key, semanticHash: binding });
    const owner = await readFile(resolve(workspace.directory, '.owner.json'));
    await rm(resolve(workspace.directory, '.owner.json'));
    await assert.rejects(openProofWorkspace({ out, sourceInventoryHash: key, semanticHash: binding }), /ENOENT/);
    await writeFile(resolve(workspace.directory, '.owner.json'), owner, { mode: 0o600 });
  } finally { await workspace?.cleanup(); await rm(base, { recursive: true, force: true }); }
});
