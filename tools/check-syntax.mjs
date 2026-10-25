import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
let count = 0;
async function check(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const path = resolve(dir, e.name);
    if (e.isDirectory()) await check(path);
    else if (/\.[cm]?js$/.test(e.name)) { const r = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8' }); if (r.status !== 0) throw new Error(r.stderr); count++; }
  }
}
for (const dir of ['src', 'server', 'worker', 'apps', 'packages']) await check(resolve(dir));
console.log(`Syntax checked ${count} JavaScript modules.`);
