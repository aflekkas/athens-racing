// npm test: every test file in tools/test-groups.json runs in its own `node --test` process from one work pool.
//   - The pool is as wide as the machine (ASR_TEST_JOBS or --jobs=N; default min(CPUs, 8)). Files start heaviest first
//     (tools/test-weights.json, CPU seconds measured on a clean archive) so one long file never trails the run.
//   - A failing file never stops the others: every failure is reported.
//   - A file that fails is rerun once, alone, after the pool drains. Passing the rerun means it failed only under load:
//     the run passes, but the first attempt's output is printed under "[flaky]" and appended to $ASR_TEST_FLAKY_LOG
//     (JSON lines) so the release train can record it. Failing twice is a real failure and fails the run.
//     More than MAX_RETRIES failing files is not flakiness, so nothing is retried. --no-retry (ASR_TEST_RETRY=0) turns retry off.
//   - Group limits keep memory-heavy files from running together (world fixtures are ~2 GB each).
// Usage: node tools/run-tests.mjs [--full] [--only=<substring>] [--jobs=N] [--no-retry] [--list]
import { spawn } from 'node:child_process';
import { readFileSync, appendFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

// ASR_TEST_GROUPS_FILE points the runner at another group file (tools/run-tests.test.mjs runs fixtures through the real runner).
export const testGroups = JSON.parse(readFileSync(process.env.ASR_TEST_GROUPS_FILE || new URL('./test-groups.json', import.meta.url), 'utf8'));
export const loaders = { physics: './tools/physics-test/register.mjs', damage: './tools/damage-test-register.mjs' };
export const groupLimits = { world: 2, damage: 1, physics: 3 };
export const MAX_RETRIES = 12;
const root = fileURLToPath(new URL('../', import.meta.url));
const readJson = name => { try { return JSON.parse(readFileSync(new URL(name, import.meta.url), 'utf8')); } catch { return {}; } };

/** Every file as a job, heaviest first. */
export function planJobs(groups = testGroups, weights = readJson('./test-weights.json'), only = '') {
  const jobs = [];
  for (const [group, files] of Object.entries(groups)) for (const file of files) if (!only || file.includes(only)) jobs.push({ group, file, weight: weights[file] || 0 });
  return jobs.sort((a, b) => b.weight - a.weight || a.file.localeCompare(b.file));
}
/** Next job to start: the heaviest waiting one whose group is under its limit. */
export function pickJob(waiting, running, limits = groupLimits) {
  return waiting.findIndex(job => !limits[job.group] || running.filter(r => r.group === job.group).length < limits[job.group]);
}
export const countTests = text => {
  const totals = {};
  for (const [, name, n] of text.matchAll(/^(?:ℹ |# )(tests|pass|fail|cancelled|skipped|todo) (\d+)\s*$/gm)) totals[name] = (totals[name] || 0) + Number(n);
  return totals;
};

function runFile(job, { full, timeoutMs, children }) {
  return new Promise(resolveRun => {
    const start = performance.now(), chunks = [];
    const args = [...(loaders[job.group] ? ['--import', loaders[job.group]] : []), '--test', '--test-concurrency=1', job.file];
    const child = spawn(process.execPath, args, { cwd: root, detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ASR_TEST_FULL: full ? '1' : '0', NODE_TEST_CONTEXT: undefined } }); // inside another node --test run this variable would make the child execute without reporting
    children.add(child);
    for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => chunks.push(chunk));
    let timedOut = false, finished = false;
    const killGroup = signal => { try { process.kill(-child.pid, signal); } catch (e) { if (e.code !== 'ESRCH') throw e; } };
    const timer = setTimeout(() => { timedOut = true; killGroup('SIGTERM'); setTimeout(() => killGroup('SIGKILL'), 5000).unref(); }, timeoutMs);
    const finish = (code, signal, error) => {
      if (finished) return;
      finished = true; clearTimeout(timer); children.delete(child);
      if (timedOut) killGroup('SIGKILL'); // nested simulations belong to this file's group only
      const output = Buffer.concat(chunks).toString('utf8');
      resolveRun({ job, ok: !error && !timedOut && code === 0, code, signal, error, timedOut, ms: performance.now() - start, output, counts: countTests(output) });
    };
    child.once('error', error => finish(null, null, error));
    child.once('close', (code, signal) => finish(code, signal));
  });
}
const why = r => r.error ? r.error.message : r.timedOut ? 'timed out' : r.signal || `exit ${r.code}`;
const seconds = ms => (ms / 1000).toFixed(1);
const printOutput = (r, label) => { for (const line of r.output.split('\n')) if (line) process.stdout.write(`[${r.job.group}] ${line}\n`); console.log(`[${r.job.group}] ${r.job.file}: ${label}`); };

async function main() {
  const args = process.argv.slice(2), flags = new Set(args.filter(a => !a.includes('=')));
  const option = name => args.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  const known = new Set(['--full', '--no-retry', '--list']);
  if (args.some(a => !known.has(a) && !/^--(only|jobs)=.+$/.test(a))) throw new Error('Usage: node tools/run-tests.mjs [--full] [--only=<substring>] [--jobs=N] [--no-retry] [--list]');
  const full = flags.has('--full'), retry = !flags.has('--no-retry') && process.env.ASR_TEST_RETRY !== '0';
  const jobsWide = Math.max(1, Number(option('jobs') || process.env.ASR_TEST_JOBS) || Math.min(availableParallelism(), 8));
  const timeoutMs = Number(process.env.ASR_TEST_FILE_TIMEOUT_MS) || 15 * 60 * 1000;
  const waiting = planJobs(testGroups, undefined, option('only') || '');
  if (flags.has('--list')) { for (const j of waiting) console.log(`${j.group}\t${j.weight}\t${j.file}`); return; }
  if (!waiting.length) throw new Error('No test files match --only');
  const total = waiting.length, started = performance.now(), children = new Set(), running = [], results = [];
  let stopping = false;
  const stop = signal => {
    if (stopping) return; stopping = true;
    for (const child of children) { try { process.kill(-child.pid, signal); } catch (e) { if (e.code !== 'ESRCH') throw e; } }
    setTimeout(() => { for (const child of children) { try { process.kill(-child.pid, 'SIGKILL'); } catch {} } process.exit(130); }, 5000).unref();
  };
  process.once('SIGINT', () => stop('SIGINT')); process.once('SIGTERM', () => stop('SIGTERM'));
  console.log(`[runner] ${total} test files, ${jobsWide} at a time, heaviest first${full ? ', full' : ''}${retry ? ', failed files retried once alone' : ''}`);
  const beat = setInterval(() => console.log(`[progress] ${results.length}/${total} files done after ${seconds(performance.now() - started)} s; running: ${running.map(j => j.file.replace(/^.*\//, '')).join(', ')}`), 60000);
  beat.unref();
  await new Promise(resolveAll => {
    const pump = () => {
      while (!stopping && running.length < jobsWide) {
        const index = pickJob(waiting, running);
        if (index < 0) break;
        const [job] = waiting.splice(index, 1); running.push(job);
        runFile(job, { full, timeoutMs, children }).then(result => {
          running.splice(running.indexOf(job), 1); results.push(result);
          const counts = result.counts;
          if (result.ok) console.log(`[${job.group}] ${job.file}: ok, ${counts.tests ?? '?'} tests, ${seconds(result.ms)} s`);
          else printOutput(result, `FAILED (${why(result)}) after ${seconds(result.ms)} s`);
          if (process.env.ASR_TEST_VERBOSE === '1' && result.ok) printOutput(result, 'output above');
          pump();
        });
      }
      if (!running.length && (!waiting.length || stopping)) resolveAll();
    };
    pump();
  });
  clearInterval(beat);
  const failed = results.filter(r => !r.ok), flaky = [], hard = [];
  if (failed.length && !stopping) {
    if (!retry) hard.push(...failed);
    else if (failed.length > MAX_RETRIES) { console.log(`[retry] ${failed.length} files failed (more than ${MAX_RETRIES}): not flakiness, no retries`); hard.push(...failed); }
    else for (const first of failed) {
      console.log(`[retry] ${first.job.file}: failed (${why(first)}, ${seconds(first.ms)} s); rerunning once, alone`);
      const second = await runFile(first.job, { full, timeoutMs, children });
      if (second.ok) {
        flaky.push({ first, second });
        console.log(`[flaky] ${first.job.file}: FAILED under load (${why(first)}, ${seconds(first.ms)} s), PASSED alone on retry (${seconds(second.ms)} s). First attempt's output follows.`);
        printOutput(first, 'first attempt (flaky)');
      } else {
        console.log(`[retry] ${first.job.file}: failed again (${why(second)}, ${seconds(second.ms)} s): a real failure`);
        printOutput(second, `FAILED twice (${why(first)}, then ${why(second)})`);
        hard.push(second);
      }
    }
  } else hard.push(...failed);
  const log = process.env.ASR_TEST_FLAKY_LOG;
  for (const { first, second } of flaky) {
    const record = { at: new Date().toISOString(), file: first.job.file, group: first.job.group, firstFailure: why(first), firstMs: Math.round(first.ms), retryMs: Math.round(second.ms) };
    if (log) appendFileSync(log, JSON.stringify(record) + '\n');
    if (process.env.GITHUB_ACTIONS) console.log(`::warning title=Flaky test::${first.job.file} failed under load and passed alone on retry`);
  }
  const sum = key => results.reduce((n, r) => n + (r.counts[key] || 0), 0);
  const seconds_ = (performance.now() - started) / 1000;
  const verdict = stopping ? 'INTERRUPTED' : hard.length ? 'FAIL' : 'PASS';
  console.log(`[summary] ${results.length}/${total} files, ${sum('tests')} tests, ${sum('pass')} pass, ${sum('fail')} fail in first attempts, ${sum('skipped')} skipped; ${flaky.length} flaky (passed on isolated retry), ${hard.length} failed`);
  for (const { first } of flaky) console.log(`[summary] flaky: ${first.job.file}`);
  for (const r of hard) console.log(`[summary] FAILED: ${r.job.file} (${why(r)})`);
  console.log(`[total] ${seconds_.toFixed(1)} s; ${verdict}`);
  process.exitCode = verdict === 'PASS' ? 0 : 1;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
