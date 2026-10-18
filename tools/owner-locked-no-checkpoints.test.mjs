// Owner decision 2026-10-18 (docs/OWNER-DECISIONS.md): no checkpoints. Tow to the latest valid on-road
// position; progress is validated invisibly. Do not restore checkpoints without a new owner decision.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile, access } from 'node:fs/promises';
const LOCK = 'Owner-locked decision, see docs/OWNER-DECISIONS.md. Ask the owner before changing.';
const root = new URL('../', import.meta.url);
async function* files(dir) {
  for (const entry of await readdir(new URL(dir, root), { withFileTypes: true })) {
    const path = dir + entry.name;
    if (entry.isDirectory()) yield* files(path + '/');
    else if (/\.(?:[cm]?js|html|css)$/.test(path) && !/\.test\.mjs$|-browser\.mjs$/.test(path)) yield path;
  }
}
test('owner lock: no checkpoint module, banner, notice, message or wording ships in the game', async () => {
  await assert.rejects(access(new URL('src/checkpoints.js', root)), `src/checkpoints.js must not return. ${LOCK}`);
  await assert.rejects(access(new URL('src/ui/checkpoint-banner.js', root)), `the missed-checkpoint banner must not return. ${LOCK}`);
  // `index.html` and every runtime source: no banner element, no wording, no checkpoint message type or hook.
  const sources = ['index.html'];
  for (const dir of ['src/', 'server/', 'worker/']) for await (const path of files(dir)) sources.push(path);
  for (const path of sources) {
    const text = await readFile(new URL(path, root), 'utf8');
    assert.doesNotMatch(text, /MISSED CHECKPOINT|TURN BACK · FOLLOW THE ROUTE|checkpoint-banner|race-checkpoint|applyCheckpoint|type: 'checkpoint'|type==='checkpoint'|courseStatus|GATE_SPACING|\.gates\b/, `${path}: ${LOCK}`);
    if (!/^worker\/(?:index|arena-diagnostics)|ragdoll/.test(path)) assert.doesNotMatch(text.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, ''), /checkpoint/i, `${path}: checkpoint wording in code or UI. ${LOCK}`);
  }
});
test('owner lock: a tow lands on the latest valid on-road pose, and the decision is recorded in the owner words', async () => {
  const course = await readFile(new URL('src/course.js', root), 'utf8'), main = await readFile(new URL('src/main.js', root), 'utf8');
  const recovery = await readFile(new URL('server/race-recovery.mjs', root), 'utf8'), lifecycle = await readFile(new URL('src/race-lifecycle.js', root), 'utf8');
  assert.match(course, /export function courseRecoveryPose/, LOCK);
  assert.match(main, /courseRecoveryPose\(course\)/, `solo tow must use the latest valid pose. ${LOCK}`);
  assert.match(recovery, /courseRecoveryPose\(driver\.course\)/, `server recovery must use the latest valid pose. ${LOCK}`);
  assert.doesNotMatch(lifecycle, /nextCheckpoint/, LOCK);
  const decisions = await readFile(new URL('docs/OWNER-DECISIONS.md', root), 'utf8');
  assert.match(decisions, /there are not meant to be checkpoints, you're supposed to get towed to the latest world/);
});
