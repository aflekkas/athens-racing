import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

export const testGroups = JSON.parse(readFileSync(new URL('./test-groups.json', import.meta.url), 'utf8'));
const loaders = { physics: './tools/physics-test/register.mjs', damage: './tools/damage-test-register.mjs' };

async function main() {
  if (process.argv.slice(2).some(arg => arg !== '--full')) throw new Error('Usage: node tools/run-tests.mjs [--full]');
  const started = performance.now(), children = new Set();
  let failed = false, cleanup = Promise.resolve();
  const abort = (signal, failedPid) => {
    const groups = new Set([...children].map(child => child.pid));
    if (failedPid) groups.add(failedPid);
    const stop = nextSignal => {
      for (const pid of groups) {
        if (!pid) continue;
        try { process.kill(-pid, nextSignal); } catch (e) { if (e.code !== 'ESRCH') throw e; }
      }
    };
    // Detached groups belong only to this runner, including nested simulations.
    stop(signal);
    cleanup = new Promise(resolve => setTimeout(() => { stop('SIGKILL'); resolve(); }, 5000));
  };
  const interrupted = signal => { if (!failed) { failed = true; abort(signal); } };
  const sigint = () => interrupted('SIGINT'), sigterm = () => interrupted('SIGTERM');
  process.once('SIGINT', sigint); process.once('SIGTERM', sigterm);
  await Promise.all(Object.entries(testGroups).map(([name, files]) => new Promise(resolve => {
    const start = performance.now();
    const concurrency = name === 'world' || name === 'damage' ? 1 : 2;
    const args = [...(loaders[name] ? ['--import', loaders[name]] : []), '--test', `--test-concurrency=${concurrency}`, ...files];
    const child = spawn(process.execPath, args, {
      cwd: fileURLToPath(new URL('../', import.meta.url)), detached: true, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ASR_TEST_FULL: process.argv.includes('--full') ? '1' : '0' },
    });
    children.add(child);
    for (const [stream, target] of [[child.stdout, process.stdout], [child.stderr, process.stderr]]) {
      let pending = '';
      stream.setEncoding('utf8');
      stream.on('data', chunk => { pending += chunk; const lines = pending.split('\n'); pending = lines.pop(); for (const line of lines) target.write(`[${name}] ${line}\n`); });
      stream.on('end', () => { if (pending) target.write(`[${name}] ${pending}\n`); });
    }
    let finished = false;
    const finish = (code, signal, error) => {
      if (finished) return;
      finished = true;
      children.delete(child);
      console.log(`[${name}] ${(performance.now() - start).toFixed(0)} ms; ${error ? error.message : signal || `exit ${code}`}`);
      if (error || code !== 0) {
        if (!failed) { failed = true; abort('SIGTERM', child.pid); }
      }
      resolve();
    };
    child.once('error', error => finish(null, null, error));
    child.once('close', (code, signal) => finish(code, signal));
  })));
  await cleanup;
  process.removeListener('SIGINT', sigint); process.removeListener('SIGTERM', sigterm);
  console.log(`[total] ${((performance.now() - started) / 1000).toFixed(1)} s; ${failed ? 'FAIL' : 'PASS'}`);
  process.exitCode = failed ? 1 : 0;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
