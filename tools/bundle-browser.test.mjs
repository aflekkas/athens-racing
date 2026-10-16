import './client-release.test.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { MAPS } from '../src/map-catalog.js';
import { bundleBrowser } from './bundle-browser.mjs';
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
    await writeFile(resolve(root, 'src/ragdoll-worker.js'), 'export const workerMarker = 42;');
    await writeFile(resolve(root, 'src/world-tile-worker.js'), 'export const tileMarker = 43;');
    await writeFile(resolve(root, 'src/world-worker.js'), 'onmessage = () => postMessage({ok:true});');
    await writeFile(resolve(out, 'index.html'), '<script type="module" src="./src/main.js"></script>');
    for (const path of MAPS.map(map => map.dataUrl)) {
      await mkdir(resolve(out, path, '..'), {recursive:true});
      await writeFile(resolve(out, path), JSON.stringify({bakedWorld:{version:1,terrain:'terrain',roads:'roads'}}));
    }
    await bundleBrowser(root, out);
    assert.equal((await import(pathToFileURL(resolve(out, 'src/ragdoll-worker.js')))).workerMarker, 42, 'native worker URL resolves to its published bundle');
    assert.match(await readFile(resolve(out, 'src/world-tile-worker.js'), 'utf8'), /world-tile-worker-[A-Z0-9]+\.js/);
    for (const path of MAPS.map(map => map.dataUrl)) {
      const data = JSON.parse(await readFile(resolve(out, path), 'utf8'));
      assert.match(data.bakedWorld.worker, /^\.\/src\/world-worker-.+\.js$/);
      await readFile(resolve(out, data.bakedWorld.worker));
    }
  } finally { await rm(root, {recursive:true,force:true}); }
});

test('real production graph keeps worlds, simulation and screens lazy and maps private', async () => {
  const { cp, rm: remove } = await import('node:fs/promises');
  const root = await mkdtemp(resolve(tmpdir(), 'asr-real-bundle-')), out = resolve(root, '.deploy/assets');
  try {
    await cp(new URL('../src/', import.meta.url), resolve(root, 'src'), { recursive: true });
    // Resolve pinned dependencies without installing a second copy for this fixture.
    const { symlink } = await import('node:fs/promises');
    await symlink(resolve(import.meta.dirname, '../node_modules'), resolve(root, 'node_modules'));
    await mkdir(resolve(out, 'src'), { recursive: true });
    await writeFile(resolve(out, 'index.html'), '<script type="importmap">{"imports":{"three":"https://cdn.example/three.js"}}</script><script type="module" src="./src/main.js"></script>');
    for (const path of MAPS.map(map => map.dataUrl)) {
      await mkdir(resolve(out, path, '..'), { recursive: true }); await writeFile(resolve(out, path), '{}');
    }
    await mkdir(resolve(out, 'src/ui'), { recursive: true });
    const meta = await bundleBrowser(root, out);
    const initial = new Set(meta.initial.map(path => resolve(out, '.' + path)));
    const eager = Object.entries(meta.outputs).filter(([path]) => initial.has(resolve(root, path))).flatMap(([, output]) => Object.keys(output.inputs));
    for (const file of ['src/main.js', 'src/map-world.js', 'src/car-select.js', 'src/cars.js', 'src/ui/mp-screens.js', 'src/ui/account-screen.js', 'src/maps/riviera.js', 'src/maps/megara.js', 'src/maps/penteli.js', 'src/maps/psychiko.js']) assert.ok(!eager.includes(file), `${file} must not be in the initial menu`);
    for (const file of ['src/maps/riviera.js', 'src/maps/megara.js', 'src/maps/penteli.js', 'src/maps/psychiko.js', 'src/ui/account-screen.js', 'src/ui/mp-screens.js']) assert.ok(Object.values(meta.outputs).some(output => output.entryPoint === file), `${file} needs a lazy entry`);
    assert.ok(Object.keys(meta.inputs).some(path => path.includes('node_modules/three/')), 'three.js and used addons are bundled');
    for (const [path] of Object.entries(meta.outputs)) {
      const text = await readFile(resolve(root, path), 'utf8');
      assert.ok(!text.includes('sourceMappingURL=')); assert.ok(!path.endsWith('.map'));
    }
    assert.ok(!(await readFile(resolve(out, 'index.html'), 'utf8')).includes('importmap'));
    assert.ok((await readdir(resolve(root, '.deploy/sourcemaps/src'))).some(path => path.endsWith('.map')));
    await writeFile(resolve(out, 'index.html'), '<script type="importmap">{"imports":{"three":"https://cdn.example/three.js"}}</script><script type="module" src="./src/main.js"></script>');
    const cdn = await bundleBrowser(root, out, { three: 'cdn' });
    const worker = Object.entries(cdn.outputs).find(([, output]) => output.entryPoint === 'src/world-worker.js');
    assert.ok(worker);
    assert.deepEqual(worker[1].imports.filter(imp => imp.external), [], 'worker cannot rely on the document import map');
    assert.ok((await readFile(resolve(out, 'index.html'), 'utf8')).includes('importmap'));
  } finally { await remove(root, { recursive: true, force: true }); }
});


test('production meshopt worker boots and decodes after Function.toString serialization', async () => {
  const { createContext, runInContext } = await import('node:vm');
  const { MeshoptEncoder } = await import('./vendor/meshopt_encoder.mjs');
  const root = await mkdtemp(resolve(tmpdir(), 'asr-codec-bundle-')), out = resolve(root,'.deploy/assets');
  const oldWorker = globalThis.Worker, oldURL = URL.createObjectURL;
  let blob;
  try {
    await mkdir(resolve(root,'src'),{recursive:true});await mkdir(resolve(out,'src'),{recursive:true});
    await writeFile(resolve(root,'package.json'),'{"type":"module"}');
    const decoder = new URL('../node_modules/three/examples/jsm/libs/meshopt_decoder.module.js',import.meta.url).pathname;
    await writeFile(resolve(root,'src/main.js'),`export {MeshoptDecoder} from ${JSON.stringify(decoder)};`);
    await writeFile(resolve(out,'index.html'),'<script type="module" src="./src/main.js"></script>');
    const meta=await bundleBrowser(root,out), output=Object.entries(meta.outputs).find(([,v])=>v.entryPoint==='src/main.js')[0];
    const main=await import(pathToFileURL(resolve(root,output)));await main.MeshoptDecoder.ready;
    globalThis.Worker=class { postMessage(){} };
    URL.createObjectURL=value=>{blob=value;return oldURL(value);};
    main.MeshoptDecoder.useWorkers(1);
    assert.ok(blob);
    let finish;
    const response=new Promise(resolve=>{finish=resolve;});
    const context=createContext({self:{postMessage:finish}});
    runInContext(await blob.text(),context);await context.ready;
    assert.equal(typeof context.self.onmessage,'function');
    await MeshoptEncoder.ready;
    const source=new Uint8Array(new Float32Array([1,2,3,4,5,6,7,8,9]).buffer),encoded=MeshoptEncoder.encodeVertexBuffer(source,3,12);
    context.self.onmessage({data:{id:1,count:3,size:12,source:encoded,mode:'meshopt_decodeVertexBuffer'}});
    const decoded=await response;
    assert.equal(decoded.action,'resolve');assert.deepEqual([...decoded.value],[...source]);
  } finally { globalThis.Worker=oldWorker;URL.createObjectURL=oldURL;await rm(root,{recursive:true,force:true}); }
});
