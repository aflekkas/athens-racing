import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { planJobs, pickJob, countTests, MAX_RETRIES } from './run-tests.mjs';

test('jobs start heaviest first and group limits hold back a second world file', () => {
  const jobs = planJobs({ unit: ['a', 'b'], world: ['w1', 'w2'] }, { b: 5, w1: 100, w2: 90 });
  assert.deepEqual(jobs.map(j => j.file), ['w1', 'w2', 'b', 'a']);
  const running = [jobs[0]], waiting = jobs.slice(1);
  assert.equal(waiting[pickJob(waiting, running, { world: 1 })].file, 'b', 'w2 waits for w1');
  assert.equal(waiting[pickJob(waiting, running, { world: 2 })].file, 'w2');
  assert.equal(pickJob([jobs[1]], running, { world: 1 }), -1);
});
test('test counts are read from both TAP and spec reporters', () => {
  assert.deepEqual(countTests('# tests 7\n# suites 0\n# pass 6\n# fail 1\n'), { tests: 7, pass: 6, fail: 1 });
  assert.deepEqual(countTests('ℹ tests 3\nℹ pass 3\nℹ fail 0\n'), { tests: 3, pass: 3, fail: 0 });
});

function runFixture(files, extra = []) {
  const dir = mkdtempSync(join(tmpdir(), 'asr-run-tests-')), flakyLog = join(dir, 'flaky.jsonl');
  try {
    const groups = {};
    for (const [group, specs] of Object.entries(files)) groups[group] = specs.map(([name, body]) => { const path = join(dir, name); writeFileSync(path, body.replaceAll('$DIR', JSON.stringify(dir))); return path; });
    writeFileSync(join(dir, 'groups.json'), JSON.stringify(groups));
    const run = spawnSync(process.execPath, [resolve(import.meta.dirname, 'run-tests.mjs'), ...extra], {
      encoding: 'utf8', env: { ...process.env, NODE_TEST_CONTEXT: undefined, ASR_TEST_GROUPS_FILE: join(dir, 'groups.json'), ASR_TEST_FLAKY_LOG: flakyLog, ASR_TEST_JOBS: '3' },
    });
    return { ...run, out: run.stdout + run.stderr, flaky: existsSync(flakyLog) ? readFileSync(flakyLog, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [] };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
const passing = "import test from 'node:test'; test('ok', () => {});";
// Fails its first run, passes the next: a load-sensitive assertion.
const flakyOnce = "import test from 'node:test'; import { existsSync, writeFileSync } from 'node:fs'; test('timing', () => { const m = $DIR + '/ran'; if (!existsSync(m)) { writeFileSync(m, '1'); throw new Error('slow under load'); } });";
const alwaysFails = "import test from 'node:test'; test('broken', () => { throw new Error('deterministic'); });";

test('a file that fails once and passes alone passes the run, is reported as flaky and is logged', () => {
  const r = runFixture({ unit: [['good.test.mjs', passing], ['flaky.test.mjs', flakyOnce]] });
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /\[flaky\] .*flaky\.test\.mjs: FAILED under load .* PASSED alone on retry/);
  assert.match(r.out, /slow under load/, 'the first attempt output is kept');
  assert.match(r.out, /\[total\] .* PASS/);
  assert.equal(r.flaky.length, 1);
  assert.match(r.flaky[0].file, /flaky\.test\.mjs$/);
});
test('a deterministic failure fails the run after one retry, and its siblings still run', () => {
  const r = runFixture({ unit: [['good.test.mjs', passing], ['bad.test.mjs', alwaysFails]], physics: [['good2.test.mjs', passing]] });
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /bad\.test\.mjs: failed again .*a real failure/);
  assert.match(r.out, /good\.test\.mjs: ok/);
  assert.match(r.out, /good2\.test\.mjs: ok/);
  assert.match(r.out, /\[summary\] FAILED: .*bad\.test\.mjs/);
  assert.equal(r.flaky.length, 0);
});
test('--no-retry fails a flaky file straight away', () => {
  const r = runFixture({ unit: [['flaky.test.mjs', flakyOnce]] }, ['--no-retry']);
  assert.equal(r.status, 1, r.out);
  assert.doesNotMatch(r.out, /\[retry\]/);
});
test('more failing files than MAX_RETRIES is a breakage, not flakiness: nothing is retried', () => {
  const specs = Array.from({ length: MAX_RETRIES + 1 }, (_, i) => [`bad${i}.test.mjs`, alwaysFails]);
  const r = runFixture({ unit: specs });
  assert.equal(r.status, 1);
  assert.match(r.out, /not flakiness, no retries/);
  assert.doesNotMatch(r.out, /rerunning once/);
});
