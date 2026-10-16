// Production-only ESM bundle; native source remains the development path.
import { build } from 'esbuild';
import { preserveCodecWorkerSource } from './serialized-codec-workers.mjs';
import { MAPS } from '../src/map-catalog.js';
import { readFile, writeFile, readdir, unlink, mkdir } from 'node:fs/promises';
import { resolve, relative, sep } from 'node:path';
const slash = path => path.split(sep).join('/');
export function initialChunks(meta, root, out, entry) {
  const seen = new Set();
  function visit(path) {
    if (seen.has(path)) return;
    seen.add(path);
    for (const imp of meta.outputs[path]?.imports || []) if (!imp.external && imp.kind === 'import-statement') visit(imp.path);
  }
  visit(entry);
  return [...seen].map(path => '/' + slash(relative(out, resolve(root, path))));
}
export async function bundleBrowser(root, out, { three = process.env.ASR_THREE_MODE || 'bundled' } = {}) {
  if (!['bundled', 'cdn'].includes(three)) throw new Error('ASR_THREE_MODE must be bundled or cdn');
  const exists = path => readFile(resolve(root, path)).then(() => true, () => false);
  const entry = await exists('src/boot.js') ? 'src/boot.js' : 'src/main.js';
  const auxiliaries = [];
  for (const path of ['src/world-tile-worker.js', 'src/ragdoll-worker.js']) if (await exists(path)) auxiliaries.push(path);
  const hasWorker = await exists('src/world-worker.js');
  const hasWheel = await exists('src/ui/phone-wheel-controller.js');
  const options = {
    absWorkingDir: root, entryPoints: [entry, ...(three === 'bundled' ? auxiliaries : []), ...(hasWheel ? ['src/ui/phone-wheel-controller.js'] : []), ...(hasWorker && three === 'bundled' ? ['src/world-worker.js'] : [])], outdir: resolve(out, 'src'),
    entryNames: '[name]-[hash]', chunkNames: '[name]-[hash]', bundle: true, splitting: true,
    format: 'esm', platform: 'browser', target: 'es2022', minify: true, keepNames: true,
    sourcemap: 'external', sourcesContent: true, write: false,
    external: three === 'cdn' ? ['three', 'three/*'] : [],
    metafile: true, legalComments: 'eof',
    plugins: [{ name: 'source-resources-and-catalogue', setup(build) {
      // Keep the authoritative catalogue in cars.js (server/tool parsers use it). Production
      // consumers of only CARS share a data module without importing procedural car models.
      build.onResolve({ filter: /^asr:car-data$/ }, () => ({ path: 'car-data', namespace: 'asr' }));
      build.onLoad({ filter: /.*/, namespace: 'asr' }, async () => {
        const source = await readFile(resolve(root, 'src/cars.js'), 'utf8');
        const catalogue = source.match(/export const CARS = \[[\s\S]*?^\];/m)?.[0];
        const defaults = source.match(/export function defaultTrafficWeight\(car\) \{[\s\S]*?^\}/m)?.[0];
        if (!catalogue || !defaults) throw new Error('Car catalogue boundaries changed');
        return { contents: catalogue + '\n' + defaults + '\nfor (const car of CARS) car.trafficWeight ??= defaultTrafficWeight(car);', loader: 'js' };
      });
      build.onLoad({ filter: /\.js$/ }, async args => {
        const path = slash(relative(root, args.path));
        const codec = /\/(?:KTX2Loader|meshopt_decoder\.module)\.js$/.test(args.path);
        if (!path.startsWith('src/') && !codec) return;
        let source = await preserveCodecWorkerSource(args.path, await readFile(args.path, 'utf8'));
        if (path === 'src/cars.js') source = source.replace(/export const CARS = \[[\s\S]*?^\];/m, "import { CARS } from 'asr:car-data'; export { CARS };");
        source = source.replace(/(import\s*\{\s*CARS\s*\}\s*from\s*)['"]\.\/?cars\.js['"]/g, "$1'asr:car-data'");
        return { contents: source.replace(/\bimport\.meta\.url\b/g, `new URL(${JSON.stringify('/' + path)}, globalThis.location.href).href`), loader: 'js', resolveDir: resolve(args.path, '..') };
      });
    } }],
  };
  const result = await build(options);
  // Document import maps do not apply inside module workers. Even the CDN fallback
  // needs a self-contained worker, so its bare three.js imports never escape.
  if (three === 'cdn') {
    for (const entryPoint of [...auxiliaries, ...(hasWorker ? ['src/world-worker.js'] : [])]) {
    const worker = await build({ ...options, entryPoints: [entryPoint], external: [], splitting: false });
    result.outputFiles.push(...worker.outputFiles);
    Object.assign(result.metafile.inputs, worker.metafile.inputs);
    Object.assign(result.metafile.outputs, worker.metafile.outputs);
    }
  }
  // External maps have no sourceMappingURL and are private upload artifacts, never CDN assets.
  for (const file of result.outputFiles) {
    const map = file.path.endsWith('.map');
    const destination = map ? resolve(root, '.deploy/sourcemaps', relative(out, file.path)) : file.path;
    await mkdir(resolve(destination, '..'), { recursive: true }); await writeFile(destination, file.contents);
  }
  for (const path of Object.keys(result.metafile.outputs)) if (path.endsWith('.map')) delete result.metafile.outputs[path];
  const outputs = new Set(Object.keys(result.metafile.outputs).map(p => resolve(root, p)));
  async function prune(dir) {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const p = resolve(dir, e.name);
      if (e.isDirectory()) await prune(p);
      else if (e.name.endsWith('.js') && e.name !== 'offline-cache.js' && !outputs.has(p)) await unlink(p);
    }
  }
  await prune(resolve(out, 'src'));
  const tileWorker = Object.entries(result.metafile.outputs).find(([, v]) => v.entryPoint === 'src/world-tile-worker.js')?.[0];
  if (tileWorker) await writeFile(resolve(out, 'src/world-tile-worker.js'), `import './${relative(resolve(out,'src'),resolve(root,tileWorker)).split(sep).join('/')}';\n`);
  const ragdoll = Object.entries(result.metafile.outputs).find(([, v]) => v.entryPoint === 'src/ragdoll-worker.js')?.[0];
  if (ragdoll) await writeFile(resolve(out, 'src/ragdoll-worker.js'), `export * from './${slash(relative(resolve(out, 'src'), resolve(root, ragdoll)))}';\n`);
  const main = Object.entries(result.metafile.outputs).find(([, v]) => v.entryPoint === entry)?.[0];
  if (!main) throw new Error('Browser bundle entry missing');
  const path = './' + slash(relative(out, resolve(root, main)));
  const index = resolve(out, 'index.html'), html = await readFile(index, 'utf8');
  if (!html.includes('src="./src/main.js"')) throw new Error('Browser module entry missing from index');
  const bundledHtml = html.replace('src="./src/main.js"', `src="${path}"`);
  await writeFile(index, three === 'cdn' ? bundledHtml : bundledHtml.replace(/<script type="importmap">[\s\S]*?<\/script>/, ''));
  if (hasWheel) {
    const wheel = Object.entries(result.metafile.outputs).find(([, output]) => output.entryPoint === 'src/ui/phone-wheel-controller.js')?.[0];
    if (!wheel) throw new Error('Phone wheel bundle entry missing');
    const wheelHtml = resolve(out, 'src/ui/phone-wheel.html');
    const html = await readFile(wheelHtml, 'utf8');
    if (!html.includes('/src/ui/phone-wheel-controller.js')) throw new Error('Phone wheel source entry missing');
    await writeFile(wheelHtml, html.replace('/src/ui/phone-wheel-controller.js', '/' + slash(relative(out, resolve(root, wheel)))));
  }
  const worker = Object.entries(result.metafile.outputs).find(([, v]) => v.entryPoint === 'src/world-worker.js')?.[0];
  if (worker) for (const path of MAPS.map(map => resolve(out, map.dataUrl))) {
    const data = JSON.parse(await readFile(path, 'utf8'));
    if (data.bakedWorld) { data.bakedWorld.worker = './' + slash(relative(out, resolve(root, worker))); await writeFile(path, JSON.stringify(data)); }
  }
  result.metafile.initial = initialChunks(result.metafile, root, out, main);
  if (resolve(out) === resolve(root, '.deploy/assets')) await writeFile(resolve(root, '.deploy/browser-metafile.json'), JSON.stringify(result.metafile));
  console.log(`Bundled browser (${three} three.js): ${Object.keys(result.metafile.inputs).length} inputs, ${Object.keys(result.metafile.outputs).length} ESM chunks, ${Object.values(result.metafile.outputs).reduce((sum, o) => sum + o.bytes, 0)} bytes`);
  return result.metafile;
}
