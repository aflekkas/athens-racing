import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { bundleBrowser } from './bundle-browser.mjs';
import { MAPS } from '../src/map-catalog.js';
test('production chunks preserve source-relative resources and lazy imports while dev sources survive', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'asr-bundle-')), out = resolve(root, '.deploy/assets'), previous = globalThis.location;
  try {
    await mkdir(resolve(root, 'src/ui'), { recursive: true }); await mkdir(resolve(out, 'src'), { recursive: true });
    await writeFile(resolve(root, 'package.json'), '{"type":"module"}');
    const source = "import {icon} from './ui/icon.js'; export const urls = [new URL('../assets/audio/world/wind.ogg', import.meta.url).href, icon]; export const lazy = () => import('./lazy.js');";
    await writeFile(resolve(root, 'src/main.js'), source);
    await writeFile(resolve(root, 'src/ui/icon.js'), "export const icon = new URL('../../assets/icon.svg', import.meta.url).href;");
    await writeFile(resolve(root, 'src/lazy.js'), "export const css = new URL('./input.css', import.meta.url).href;");
    for (const [name, value] of Object.entries({ 'main.js': source, 'offline-cache.js': '/* registrar */', 'input.css': 'body{}' })) await writeFile(resolve(out, 'src', name), value);
    await writeFile(resolve(out, 'index.html'), '<script type="module" src="./src/main.js"></script>');
    const meta = await bundleBrowser(root, out), output = Object.entries(meta.outputs).find(([, v]) => v.entryPoint === 'src/main.js')[0];
    globalThis.location = { href: 'https://game.example/index.html' };
    const main = await import(pathToFileURL(resolve(root, output)));
    assert.deepEqual(main.urls, ['https://game.example/assets/audio/world/wind.ogg', 'https://game.example/assets/icon.svg']);
    assert.equal((await main.lazy()).css, 'https://game.example/src/input.css');
    assert.equal(await readFile(resolve(root, 'src/main.js'), 'utf8'), source);
    assert.equal(await readFile(resolve(out, 'src/input.css'), 'utf8'), 'body{}');
    assert.ok((await readdir(resolve(out, 'src'))).includes('offline-cache.js'));
    assert.ok(!(await readdir(resolve(out, 'src'))).includes('main.js'));
    assert.ok((await readFile(resolve(out, 'index.html'), 'utf8')).includes('main-'));
  } finally { if (previous === undefined) delete globalThis.location; else globalThis.location = previous; await rm(root, { recursive: true, force: true }); }
});


test('every map bake points to the published world worker, including Megara', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'asr-worker-bundle-')), out = resolve(root, '.deploy/assets');
  try {
    await mkdir(resolve(root, 'src'), {recursive:true}); await mkdir(resolve(out, 'src'), {recursive:true});
    await writeFile(resolve(root, 'src/main.js'), 'export const boot = true;');
    await writeFile(resolve(root, 'src/world-worker.js'), 'onmessage = () => postMessage({ok:true});');
    await writeFile(resolve(out, 'index.html'), '<script type="module" src="./src/main.js"></script>');
    for (const path of MAPS.map(map => map.dataUrl)) {
      await mkdir(resolve(out, path, '..'), {recursive:true});
      await writeFile(resolve(out, path), JSON.stringify({bakedWorld:{version:1,terrain:'terrain',roads:'roads'}}));
    }
    await bundleBrowser(root, out);
    for (const path of MAPS.map(map => map.dataUrl)) {
      const data = JSON.parse(await readFile(resolve(out, path), 'utf8'));
      assert.match(data.bakedWorld.worker, /^\.\/src\/world-worker-.+\.js$/);
      await readFile(resolve(out, data.bakedWorld.worker));
    }
  } finally { await rm(root, {recursive:true,force:true}); }
});
