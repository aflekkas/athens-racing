// Production-only ESM bundle. Keep module-relative resource URLs anchored to their original source locations.
import { build } from 'esbuild';
import { readFile, writeFile, readdir, unlink } from 'node:fs/promises';
import { resolve, relative, sep } from 'node:path';
export async function bundleBrowser(root, out) {
  const result = await build({
    absWorkingDir: root, entryPoints: ['src/main.js'], outdir: resolve(out, 'src'),
    entryNames: '[name]-[hash]', chunkNames: 'chunk-[hash]', bundle: true, splitting: true,
    format: 'esm', platform: 'browser', target: 'es2022', minify: true, keepNames: true,
    metafile: true, legalComments: 'eof',
    plugins: [{ name: 'source-resource-urls', setup(build) {
      build.onLoad({ filter: /\.js$/ }, async args => {
        const path = relative(root, args.path).split(sep).join('/');
        if (!path.startsWith('src/')) return;
        const source = await readFile(args.path, 'utf8');
        return { contents: source.replace(/\bimport\.meta\.url\b/g, `new URL(${JSON.stringify('/' + path)}, globalThis.location.href).href`), loader: 'js', resolveDir: resolve(args.path, '..') };
      });
    } }],
  });
  // CSS and resources remain at the source URL. Only the small service-worker registrar remains unbundled.
  const outputs = new Set(Object.keys(result.metafile.outputs).map(p => resolve(root, p)));
  async function prune(dir) {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const p = resolve(dir, e.name);
      if (e.isDirectory()) await prune(p);
      else if (e.name.endsWith('.js') && e.name !== 'offline-cache.js' && !outputs.has(p)) await unlink(p);
    }
  }
  await prune(resolve(out, 'src'));
  const main = Object.entries(result.metafile.outputs).find(([, v]) => v.entryPoint === 'src/main.js')?.[0];
  if (!main) throw new Error('Browser bundle entry missing');
  const path = './' + relative(out, resolve(root, main)).split(sep).join('/');
  const index = resolve(out, 'index.html'), html = await readFile(index, 'utf8');
  if (!html.includes('src="./src/main.js"')) throw new Error('Browser module entry missing from index');
  await writeFile(index, html.replace('src="./src/main.js"', `src="${path}"`));
  await writeFile(resolve(root, '.deploy/browser-metafile.json'), JSON.stringify(result.metafile));
  console.log(`Bundled browser: ${Object.keys(result.metafile.inputs).length} inputs, ${Object.keys(result.metafile.outputs).length} ESM chunks, ${Object.values(result.metafile.outputs).reduce((sum, o) => sum + o.bytes, 0)} bytes`);
  return result.metafile;
}
