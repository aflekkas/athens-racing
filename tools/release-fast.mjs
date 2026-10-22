// Shared fast path for the VPS release train (~/.local/bin/athens-release-train and deploy/athens-release-train.sh).
//
//   node tools/release-fast.mjs gates  --dir D --tree T --sha S [--envs staging,production] [--log FILE] [--train-log FILE] [--no-cache]
//   node tools/release-fast.mjs deploy --dir D --env E --sha S  [--log FILE] [--train-log FILE]
//   node tools/release-fast.mjs prune
//
// gates  runs every CI gate on the unpacked commit D at once instead of one after another: the test pool (tools/run-tests.mjs),
//        the standalone physics regression, events, ghost lap, syntax and browser-import checks, and, in a private copy of D
//        per environment, the deploy build (tools/prepare-deploy.mjs) plus `wrangler deploy --dry-run` on the finished bundle.
//        A check that has already passed on the same git tree (same Node major, same command) is not run again: a re-deploy,
//        a retry after a deploy failure, the sync-merge commit pushed to staging and a release merge commit whose tree equals
//        the tested staging tree all skip straight to deploying. Only passes are cached; failures always rerun.
//        Every check runs even if another fails, so one run reports everything that is wrong.
// deploy uploads the bundle gates built (no second build) with a copy of wrangler.jsonc that has its build step removed. With no
//        prebuilt bundle (gates skipped or never run) it builds first, so it is also safe to call alone.
// prune  caps the shared caches under ~/.cache/athens-release (ASR_CACHE_MAX_BYTES, default 3 GB; bake entries are the big ones).
//
// Exit status 0 = all gates passed (or were already proven). Failure output is copied to --log. --train-log appends timing and
// flaky-test lines ("<utc time> <sha> ...") to the train's own log.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, appendFileSync } from 'node:fs';
import { mkdir, readFile, writeFile, rm, readdir, stat, symlink, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { credentials } from './world-r2.mjs';
import { bakeCacheDir, cacheRoot, pruneEntries, DEFAULT_MAX_BYTES } from './bake-cache.mjs';

export const ACCOUNT_ID = 'd6f3d2dc5817687a91d74ccd257bad9e';
// Build copies and logs live beside the unpacked commit, never inside it: tests scan the tree for credits files, sources and so on.
export const workDir = dir => `${dir}.fast`;
const sh = text => createHash('sha256').update(text).digest('hex');
export const gatesCacheDir = (env = process.env) => resolve(cacheRoot(env), 'gates');
export const nodeMajor = (version = process.version) => version.replace(/^v/, '').split('.')[0];

export const STAB_SHARDS = 4;
/** Checks that only read the unpacked commit. `tests` is the long pole, so it starts first. */
export function staticChecks() {
  return [
    { name: 'tests', cmd: 'node tools/run-tests.mjs', env: { BROWSER_SLOT_POOL: 'release', BROWSER_SLOTS: '2' } },
    // The regression script is split with REGRESS_PART (tools/physics-test/regress.mjs): `rest` plus the stab shards cover exactly what the unsharded run does.
    ...['rest', ...Array.from({ length: STAB_SHARDS }, (_, k) => `stab:${k}/${STAB_SHARDS}`)].map(part => ({ name: `regress-${part.replace(/[:/]/g, '-')}`, cmd: `REGRESS_PART=${part} node --import ./tools/physics-test/register.mjs tools/physics-test/regress.mjs` })),
    { name: 'events', cmd: 'node tools/events-test.mjs' },
    { name: 'ghost-lap', cmd: 'node tools/ghost-lap.test.mjs' },
    { name: 'syntax', cmd: 'node tools/check-syntax.mjs' },
    { name: 'browser-imports', cmd: 'node tools/check-browser-imports.mjs' },
  ];
}
export const checkRecord = (tree, check, major = nodeMajor()) => `${major}-${tree}/${check.name}-${sh(check.cmd).slice(0, 12)}.json`;

/** wrangler.jsonc with every build step removed: gates already ran prepare-deploy for the right environment. */
export function prebuiltConfig(jsonc) {
  const strip = text => { // comments outside strings
    let out = '', i = 0, quoted = false;
    while (i < text.length) {
      const c = text[i], n = text[i + 1];
      if (quoted) { out += c; if (c === '\\') out += text[++i]; else if (c === '"') quoted = false; i++; }
      else if (c === '"') { quoted = true; out += c; i++; }
      else if (c === '/' && n === '/') { while (i < text.length && text[i] !== '\n') i++; }
      else if (c === '/' && n === '*') { i += 2; while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++; i += 2; }
      else { out += c; i++; }
    }
    return out.replace(/,(\s*[}\]])/g, '$1');
  };
  const config = JSON.parse(strip(jsonc));
  delete config.build;
  for (const env of Object.values(config.env || {})) delete env.build;
  return JSON.stringify(config, null, 2) + '\n';
}

// Prebuilt releases bypass Wrangler's build command. Read each environment's route flag from
// the same deployment config so its worker catalogue and browser artifacts agree.
export function unifiedRouteBuildVars(jsonc, environment) {
  const config = JSON.parse(prebuiltConfig(jsonc));
  return { ASR_UNIFIED_ROUTES: ['staging', 'production'].includes(environment) ? String(config.env?.[environment]?.vars?.ASR_UNIFIED_ROUTES || '') : '' };
}

function arg(args, name) { const hit = args.find(a => a.startsWith(`--${name}=`)); if (hit) return hit.slice(name.length + 3); const i = args.indexOf(`--${name}`); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : undefined; }
const secs = ms => (ms / 1000).toFixed(1);
const say = text => console.log(`[release-fast] ${text}`);
const trainLine = (file, sha, text) => { if (file) appendFileSync(file, `${new Date().toISOString().replace(/\.\d+Z$/, 'Z')} ${sha} ${text}\n`); };

/** Run `bash -c cmd` in cwd with output to a log file. */
function run(cmd, { cwd, env = {}, log, timeoutMs = 3600_000, nice = 0 }) {
  return new Promise(resolveRun => {
    const start = performance.now(), out = createWriteStream(log);
    const child = spawn(nice ? 'nice' : 'bash', nice ? ['-n', String(nice), 'bash', '-c', cmd] : ['-c', cmd], { cwd, env: { ...process.env, ...env, NODE_TEST_CONTEXT: undefined }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.pipe(out, { end: false }); child.stderr.pipe(out, { end: false });
    const kill = signal => { try { process.kill(-child.pid, signal); } catch (e) { if (e.code !== 'ESRCH') throw e; } };
    groups.add(kill);
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; kill('SIGTERM'); setTimeout(() => kill('SIGKILL'), 5000).unref(); }, timeoutMs);
    const done = (code, signal, error) => { clearTimeout(timer); groups.delete(kill); out.end(`${error ? `\n[release-fast] spawn error: ${error.message}\n` : ''}${timedOut ? `\n[release-fast] timed out after ${secs(timeoutMs)} s\n` : ''}`, () => resolveRun({ ok: !error && !timedOut && code === 0, code, signal, ms: performance.now() - start })); };
    child.once('error', error => done(null, null, error));
    child.once('close', (code, signal) => done(code, signal));
  });
}
// Our own detached process groups only; stopped when the train stops us.
const groups = new Set();
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { for (const kill of groups) kill(signal); setTimeout(() => process.exit(130), 3000).unref(); });

async function copyTree(from, to) {
  await mkdir(to, { recursive: true });
  await new Promise((ok, fail) => {
    const pack = spawn('tar', ['-C', from, '--exclude=./node_modules', '--exclude=./.deploy', '-cf', '-', '.'], { stdio: ['ignore', 'pipe', 'inherit'] });
    const unpack = spawn('tar', ['-C', to, '-xf', '-'], { stdio: ['pipe', 'inherit', 'inherit'] });
    pack.stdout.pipe(unpack.stdin);
    pack.once('error', fail); unpack.once('error', fail);
    unpack.once('close', code => code === 0 ? ok() : fail(new Error(`tar copy failed (${code})`)));
  });
  const modules = resolve(from, 'node_modules');
  if (existsSync(modules)) await symlink(await realpath(modules), resolve(to, 'node_modules'));
}
export const prebuiltDir = (dir, env) => resolve(workDir(dir), env);
async function writePrebuiltConfig(copy) { await writeFile(resolve(copy, 'wrangler.prebuilt.jsonc'), prebuiltConfig(await readFile(resolve(copy, 'wrangler.jsonc'), 'utf8'))); }

/** Build (prepare-deploy) one environment in its own copy of the commit, then dry-run the finished bundle. */
async function buildEnvironment({ dir, env, sha, log }) {
  const copy = prebuiltDir(dir, env);
  await rm(copy, { recursive: true, force: true });
  await copyTree(dir, copy);
  await writePrebuiltConfig(copy);
  const common = { ...unifiedRouteBuildVars(await readFile(resolve(copy, 'wrangler.jsonc'), 'utf8'), env), ASR_GIT_SHA: sha, ASR_BUILD_ENV: env, CLOUDFLARE_ACCOUNT_ID: ACCOUNT_ID };
  // Low priority: this must not slow the tests, and it is a cache hit unless map code or data changed.
  const built = await run('node tools/prepare-deploy.mjs', { cwd: copy, env: common, log, nice: 5 });
  if (!built.ok) return built;
  // A successful bundle is still invalid if its compiled route artifacts name
  // a different world set than the manifest Wrangler is about to deploy.
  if (env === 'staging') {
    const routes = await run('node tools/check-route-release.mjs', { cwd: copy, env: common, log: log + '.routes', nice: 5 });
    if (!routes.ok) return {...routes, ms: built.ms + routes.ms, log: log + '.routes'};
  }
  const dry = await run(`node_modules/.bin/wrangler deploy --env ${env} --config wrangler.prebuilt.jsonc --dry-run`, { cwd: copy, env: common, log: log + '.dry', nice: 5 });
  return { ok: dry.ok, ms: built.ms + dry.ms, built: built.ms, dry: dry.ms };
}

export async function gates({ dir, tree, sha, envs = [], logFile, trainLog, useCache = true, cacheDir = gatesCacheDir() }) {
  const started = performance.now();
  const logs = resolve(workDir(dir), 'logs');
  await mkdir(logs, { recursive: true });
  const results = [], flakyLog = resolve(logs, 'flaky.jsonl');
  const record = async (name, task) => {
    say(`${name}: started`);
    const r = await task();
    results.push({ name, ...r });
    say(`${name}: ${r.ok ? 'ok' : 'FAILED'}${r.cached ? ' (already passed on this tree, not rerun)' : ` in ${secs(r.ms)} s`}`);
  };
  const jobs = [];
  for (const check of staticChecks()) {
    const log = resolve(logs, `${check.name}.log`), file = resolve(cacheDir, checkRecord(tree, check));
    jobs.push(record(check.name, async () => {
      if (useCache && tree && existsSync(file)) { const prev = JSON.parse(await readFile(file, 'utf8')); return { ok: true, cached: true, ms: 0, log, prev }; }
      const r = await run(check.cmd, { cwd: dir, env: { ...check.env, ASR_TEST_FLAKY_LOG: flakyLog }, log });
      if (r.ok && tree) { await mkdir(resolve(file, '..'), { recursive: true }); await writeFile(file, JSON.stringify({ at: new Date().toISOString(), sha, ms: Math.round(r.ms) })); }
      return { ...r, log };
    }));
  }
  for (const env of envs) {
    const log = resolve(logs, `build-${env}.log`);
    jobs.push(record(`build-${env}`, async () => { const result = await buildEnvironment({ dir, env, sha, log }); return {...result, log: result.log || log}; }));
  }
  await Promise.all(jobs);
  const failed = results.filter(r => !r.ok);
  if (existsSync(flakyLog)) for (const line of (await readFile(flakyLog, 'utf8')).split('\n').filter(Boolean)) { const f = JSON.parse(line); say(`FLAKY ${f.file}: failed under load (${f.firstFailure}), passed alone on retry`); trainLine(trainLog, sha, `flaky test ${f.file}: failed under load (${f.firstFailure}, ${f.firstMs} ms), passed alone on retry (${f.retryMs} ms)`); }
  if (failed.length && logFile) {
    let text = '';
    for (const r of failed) {
      const body = await readFile(r.log, 'utf8').catch(() => '');
      const dry = await readFile(r.log + '.dry', 'utf8').catch(() => '');
      text += `===== ${r.name} FAILED =====\n${(body + (dry ? `\n--- wrangler dry run ---\n${dry}` : '')).slice(-1_500_000)}\n`;
    }
    await writeFile(logFile, text);
  }
  const slow = [...results].sort((a, b) => b.ms - a.ms).slice(0, 3).map(r => `${r.name} ${secs(r.ms)} s`).join(', ');
  say(failed.length ? `FAILED: ${failed.map(r => r.name).join(', ')}` : `all gates passed (${results.filter(r => r.cached).length} already proven on this tree)`);
  trainLine(trainLog, sha, `gates ${failed.length ? `FAILED (${failed.map(r => r.name).join(', ')})` : 'passed'} in ${secs(performance.now() - started)} s; ${results.filter(r => r.cached).length} of ${results.length} already proven on this tree; slowest: ${slow}`);
  return { ok: !failed.length, results, failed: failed.map(r => r.name) };
}

/** Fail closed against the actual production bucket before uploading a Worker pointer. */
export async function checkProductionWorld(jsonc, { token, fetcher = fetch } = {}) {
  const config = JSON.parse(prebuiltConfig(jsonc)), production = config.env?.production;
  const key = production?.vars?.ATHENS_WORLD_MANIFEST;
  const bucket = production?.r2_buckets?.find(b => b.binding === 'ATHENS_WORLD')?.bucket_name;
  if (bucket !== 'athens-racing-world' || !/^manifests\/[a-f0-9]{64}\.json$/.test(key || '')) throw Error('Production world guard: invalid bucket or manifest binding');
  const response = await fetcher(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/r2/buckets/${bucket}/objects/${key}`, {
    headers: { Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw Error(`Production world guard: ${bucket}/${key} HTTP ${response.status}; copy and checksum world objects before deploying`);
  const body = Buffer.from(await response.arrayBuffer());
  if (sh(body) !== key.slice(10, -5)) throw Error(`Production world guard: manifest checksum mismatch in ${bucket}/${key}`);
}

export async function deploy({ dir, env, sha, logFile, trainLog }) {
  const copy = prebuiltDir(dir, env), ready = existsSync(resolve(copy, '.deploy/assets')) && existsSync(resolve(copy, 'wrangler.prebuilt.jsonc'));
  const logs = resolve(workDir(dir), 'logs'); await mkdir(logs, { recursive: true });
  const common = { ASR_GIT_SHA: sha, ASR_BUILD_ENV: env, CLOUDFLARE_ACCOUNT_ID: ACCOUNT_ID };
  if (!ready) {
    say(`no prebuilt ${env} bundle: building it now`);
    const built = await buildEnvironment({ dir, env, sha, log: resolve(logs, `build-${env}.log`) });
    if (!built.ok) { if (logFile) await writeFile(logFile, await readFile(resolve(logs, `build-${env}.log`), 'utf8').catch(() => 'build failed')); return { ok: false }; }
  }
  if (env === 'production') {
    try {
      process.env.CLOUDFLARE_ACCOUNT_ID = ACCOUNT_ID;
      await checkProductionWorld(await readFile(resolve(copy, 'wrangler.prebuilt.jsonc'), 'utf8'), { token: await credentials() });
    } catch (error) {
      const message = `Production deployment blocked: ${error.message}`;
      say(message); trainLine(trainLog, sha, message);
      if (logFile) await writeFile(logFile, message + '\n');
      return { ok: false };
    }
  }
  const r = await run(`node_modules/.bin/wrangler deploy --env ${env} --config wrangler.prebuilt.jsonc`, { cwd: copy, env: common, log: resolve(logs, `deploy-${env}.log`), timeoutMs: 2700_000 });
  if (!r.ok && logFile) await writeFile(logFile, await readFile(resolve(logs, `deploy-${env}.log`), 'utf8').catch(() => 'deploy failed'));
  say(`deploy ${env}: ${r.ok ? 'ok' : 'FAILED'} in ${secs(r.ms)} s`);
  trainLine(trainLog, sha, `wrangler deploy ${env} ${r.ok ? 'finished' : 'FAILED'} in ${secs(r.ms)} s${ready ? ' (prebuilt bundle)' : ' (built just now)'}`);
  return r;
}

export async function prune(env = process.env) {
  const max = Number(env.ASR_CACHE_MAX_BYTES) || DEFAULT_MAX_BYTES;
  const bake = await pruneEntries(bakeCacheDir(env), { maxBytes: max, minAgeMs: 10 * 60 * 1000 });
  // Gate records are tiny; drop the ones older than 30 days.
  let dropped = 0;
  const dir = gatesCacheDir(env);
  for (const name of await readdir(dir).catch(() => [])) {
    const info = await stat(resolve(dir, name));
    if (Date.now() - info.mtimeMs > 30 * 24 * 3600 * 1000) { await rm(resolve(dir, name), { recursive: true, force: true }); dropped++; }
  }
  // Work dirs the train's cleanup trap missed (a killed run): older than six hours, beside the unpacked commits in /tmp.
  for (const name of await readdir('/tmp').catch(() => [])) {
    if (!/^athens-release-.*\.fast$/.test(name)) continue;
    const info = await stat(resolve('/tmp', name));
    if (Date.now() - info.mtimeMs > 6 * 3600 * 1000) await rm(resolve('/tmp', name), { recursive: true, force: true });
  }
  say(`cache pruned: ${bake.removed.length} bake entries removed (${(bake.bytes / 1e6).toFixed(0)} MB left), ${dropped} old gate records removed`);
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  const dir = resolve(arg(args, 'dir') || '.'), sha = arg(args, 'sha') || '', logFile = arg(args, 'log');
  if (command === 'gates') {
    const envs = (arg(args, 'envs') || '').split(',').filter(Boolean);
    const r = await gates({ dir, tree: arg(args, 'tree') || '', sha, envs, logFile, trainLog: arg(args, 'train-log'), useCache: !args.includes('--no-cache') });
    process.exitCode = r.ok ? 0 : 1;
  } else if (command === 'deploy') {
    const env = arg(args, 'env');
    if (!['staging', 'production'].includes(env)) throw new Error('deploy needs --env=staging|production');
    process.exitCode = (await deploy({ dir, env, sha, logFile, trainLog: arg(args, 'train-log') })).ok ? 0 : 1;
  } else if (command === 'prune') await prune();
  else throw new Error('Usage: node tools/release-fast.mjs gates|deploy|prune (see the header of this file)');
}
if (process.argv[1] === fileURLToPath(import.meta.url)) await main().catch(e => { console.error(e.message); process.exitCode = 2; });
