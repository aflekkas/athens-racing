// Profiles a clean archive without relying on that archive having the new runner.
// node tools/profile-tests.mjs ARCHIVE OUTPUT_DIRECTORY [FILE_CONCURRENCY=3]
import { readFileSync, readdirSync, mkdirSync, createWriteStream, appendFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
const [archive, output, limit = '3'] = process.argv.slice(2);
if (!archive || !output || !/^[1-9]\d*$/.test(limit)) throw new Error('Usage: node tools/profile-tests.mjs ARCHIVE OUTPUT_DIRECTORY [FILE_CONCURRENCY=3]');
const root = resolve(archive), out = resolve(output), entries = new Map();
const files = ['tools', 'server', 'worker'].flatMap(dir => readdirSync(resolve(root, dir), { recursive: true }).filter(f => f.endsWith('.test.mjs')).map(f => `${dir}/${f}`));
function include(file, loader) {
  if (entries.has(file)) return;
  entries.set(file, loader);
  for (const match of readFileSync(resolve(root, file), 'utf8').matchAll(/^\s*(?:import\s*(?:[^'";]*?\sfrom\s*)?|export\s+[^'";]*?\sfrom\s*)['"](\.[^'"]+)['"]/gm)) {
    const target = relative(root, resolve(root, dirname(file), match[1]));
    if (target.endsWith('.test.mjs')) include(target, loader);
  }
}
const script = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).scripts.test;
if (script === 'node tools/run-tests.mjs') {
  const groups = JSON.parse(readFileSync(resolve(root, 'tools/test-groups.json'), 'utf8'));
  for (const [name, paths] of Object.entries(groups)) for (const file of paths) include(file, name === 'physics' ? './tools/physics-test/register.mjs' : name === 'damage' ? './tools/damage-test-register.mjs' : null);
} else {
  for (const command of script.split(' && ')) {
    const args = command.split(/\s+/), index = args.indexOf('--import'), loader = index < 0 ? null : args[index + 1];
    for (const file of args.filter(s => /^(tools|server|worker)\//.test(s))) {
      if (file.includes('*')) { const [prefix, suffix] = file.split('*'); for (const f of files) if (f.startsWith(prefix) && f.endsWith(suffix)) include(f, loader); }
      else include(file, loader);
    }
  }
}
for (const file of files) if (!entries.has(file)) include(file, null);
mkdirSync(out, { recursive: true });
writeFileSync(resolve(out, 'timings.jsonl'), '');
const queue = [...entries];
await Promise.all(Array.from({ length: Math.min(Number(limit), queue.length) }, async () => {
  while (queue.length) {
    const [file, loader] = queue.shift(), start = performance.now();
    const log = createWriteStream(resolve(out, file.replaceAll('/', '_') + '.log'));
    const child = spawn(process.execPath, [...(loader ? ['--import', loader] : []), '--test', '--test-concurrency=1', file], { cwd: root });
    child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
    const result = await new Promise((accept, reject) => { child.once('error', reject); child.once('close', (code, signal) => accept({ code, signal })); });
    log.end();
    const row = { file, seconds: Number(((performance.now() - start) / 1000).toFixed(3)), loader, ...result };
    appendFileSync(resolve(out, 'timings.jsonl'), JSON.stringify(row) + '\n');
    console.log(JSON.stringify(row));
  }
}));
