import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { prebuiltConfig, unifiedRouteBuildVars, staticChecks, checkRecord, workDir, gates, STAB_SHARDS } from './release-fast.mjs';

const root = resolve(import.meta.dirname, '..');

test('the prebuilt config drops every build step and keeps everything else', () => {
  const source = readFileSync(resolve(root, 'wrangler.jsonc'), 'utf8'), original = JSON.parse(source), config = JSON.parse(prebuiltConfig(source));
  assert.ok(original.build && original.env.staging.build && original.env.production.build, 'the repo config builds');
  assert.equal(config.build, undefined);
  assert.equal(config.env.staging.build, undefined);
  assert.equal(config.env.production.build, undefined);
  const { build, ...rest } = original;
  for (const env of Object.values(rest.env)) delete env.build;
  assert.deepEqual(config, rest);
});
test('the prebuilt config reader accepts comments and trailing commas but never touches strings', () => {
  const config = JSON.parse(prebuiltConfig('{ // note\n "name": "a//b", /* x */ "build": {"command": "c"}, "env": {"s": {"build": {}, "routes": ["x/*y*/",],},},\n}'));
  assert.deepEqual(config, { name: 'a//b', env: { s: { routes: ['x/*y*/'] } } });
});
test('prebuilt staging builds inherit the route flag; production and unconfigured builds stay off', () => {
  const source = readFileSync(resolve(root, 'wrangler.jsonc'), 'utf8');
  assert.deepEqual(unifiedRouteBuildVars(source, 'staging'), { ASR_UNIFIED_ROUTES: 'syntagma-pilot,psychiko-faros,riviera-coast' });
  assert.deepEqual(unifiedRouteBuildVars(source, 'production'), { ASR_UNIFIED_ROUTES: '' });
  assert.deepEqual(unifiedRouteBuildVars('{"env":{"production":{"vars":{"ASR_UNIFIED_ROUTES":"syntagma-pilot"}}}}', 'production'), { ASR_UNIFIED_ROUTES: '' });
  assert.deepEqual(unifiedRouteBuildVars('{}', 'staging'), { ASR_UNIFIED_ROUTES: '' });
});
test('gate records are keyed by node major, tree and the exact command', () => {
  const [tests] = staticChecks();
  const a = checkRecord('tree1', tests, '22'), b = checkRecord('tree2', tests, '22');
  assert.notEqual(a, b); assert.notEqual(a, checkRecord('tree1', tests, '24'));
  assert.notEqual(a, checkRecord('tree1', { ...tests, cmd: tests.cmd + ' --full' }, '22'));
  assert.equal(workDir('/tmp/athens-release-abc.1'), '/tmp/athens-release-abc.1.fast');
});
test('the regression shards cover the same heavy-stability runs the unsharded script runs', () => {
  const source = readFileSync(resolve(root, 'tools/physics-test/regress.mjs'), 'utf8');
  const parts = staticChecks().filter(c => c.name.startsWith('regress-')).map(c => /REGRESS_PART=(\S+)/.exec(c.cmd)[1]);
  assert.deepEqual(parts, ['rest', ...Array.from({ length: STAB_SHARDS }, (_, k) => `stab:${k}/${STAB_SHARDS}`)]);
  assert.match(source, /index % part\.n === part\.k/);
  assert.match(source, /if \(part\.kind === 'all'\) await heavyStability\(catalogue\(\)\)/);
});
test('every CI gate of .github/workflows/ci.yml that the train runs is a check here', () => {
  const ci = readFileSync(resolve(root, '.github/workflows/ci.yml'), 'utf8');
  const runs = [...ci.matchAll(/^\s*- run: (.+)$/gm)].map(m => m[1].trim());
  const mine = new Set(staticChecks().map(c => c.cmd.replace(/^REGRESS_PART=\S+ /, '')));
  assert.ok(mine.has('node tools/run-tests.mjs') && runs.includes('npm test'));
  for (const cmd of runs.filter(c => /^node /.test(c))) assert.ok(mine.has(cmd), `CI runs "${cmd}" but release-fast does not`);
});
test('a passed check is skipped on the same tree and rerun for any other; failures are never recorded', async () => {
  const scratch = mkdtempSync(join(tmpdir(), 'asr-release-fast-')), dir = join(scratch, 'repo'), cache = join(scratch, 'cache');
  try {
    mkdirSync(join(dir, 'tools/physics-test'), { recursive: true });
    const counter = join(scratch, 'count');
    // Stand-ins for every check: each appends to a counter; `tests` fails while the marker exists.
    const stub = name => `import { appendFileSync, existsSync } from 'node:fs'; appendFileSync(${JSON.stringify(counter)}, '${name}\\n'); if ('${name}' === 'tests' && existsSync(${JSON.stringify(join(scratch, 'broken'))})) { console.log('BROKEN'); process.exit(1); }`;
    for (const [file, name] of [['run-tests.mjs', 'tests'], ['events-test.mjs', 'events'], ['ghost-lap.test.mjs', 'ghost'], ['check-syntax.mjs', 'syntax'], ['check-browser-imports.mjs', 'imports'], ['physics-test/register.mjs', 'register'], ['physics-test/regress.mjs', 'regress']]) writeFileSync(join(dir, 'tools', file), stub(name));
    const runGates = (tree, extra = {}) => gates({ dir, tree, sha: 'abc1234', envs: [], logFile: join(scratch, 'fail.log'), cacheDir: cache, ...extra });
    const count = () => (existsSync(counter) ? readFileSync(counter, 'utf8').split('\n').filter(Boolean) : []).filter(n => n !== 'register').length;
    assert.equal((await runGates('t1')).ok, true); assert.equal(count(), 10);
    assert.equal((await runGates('t1')).ok, true); assert.equal(count(), 10, 'same tree: nothing reruns');
    assert.equal((await runGates('t2')).ok, true); assert.equal(count(), 20, 'new tree: everything reruns');
    writeFileSync(join(scratch, 'broken'), '');
    const failed = await runGates('t3');
    assert.equal(failed.ok, false); assert.deepEqual(failed.failed, ['tests']);
    assert.match(readFileSync(join(scratch, 'fail.log'), 'utf8'), /===== tests FAILED =====[\s\S]*BROKEN/);
    const before = count();
    assert.equal((await runGates('t3')).ok, false); assert.equal(count(), before + 1, 'only the failed check reruns; the nine that passed are remembered');
    assert.equal((await runGates('t3', { useCache: false })).ok, false); assert.equal(count(), before + 1 + 10, '--no-cache reruns all');
  } finally { rmSync(scratch, { recursive: true, force: true }); }
});
