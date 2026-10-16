// Rotate comparison builds in one asset directory; never duplicate baked assets or node_modules.
import { cp, rm, readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { bundleBrowser } from './bundle-browser.mjs';
import { buildRelease, publishRelease } from './release-cache.mjs';
import { publishReleaseData } from './release-data.mjs';
export async function variantBuilder(beforeRef, repository) {
  const root = resolve(import.meta.dirname, '..'), out = resolve(root, '.deploy/assets');
  const current = new Map(), before = new Map(), data = new Map();
  async function scan(dir) { for (const entry of await readdir(resolve(root, dir), { withFileTypes: true })) { const path = dir + '/' + entry.name; if (entry.isDirectory()) await scan(path); else current.set(path, await readFile(resolve(root, path))); } }
  await scan('src'); current.set('index.html', await readFile(resolve(root, 'index.html')));
  const git = args => execFileSync('git', ['-C', repository, ...args], { maxBuffer: 32 * 1024 * 1024 });
  for (const path of git(['ls-tree', '-r', '--name-only', beforeRef, '--', 'src', 'index.html']).toString().trim().split('\n')) before.set(path, git(['show', beforeRef + ':' + path]));
  for (const name of await readdir(resolve(out, 'data'))) if (name.endsWith('.json')) data.set(name, await readFile(resolve(out, 'data', name)));
  const legacySource = git(['show', beforeRef + ':tools/bundle-browser.mjs']).toString().replace("from 'esbuild'", `from ${JSON.stringify(import.meta.resolve('esbuild'))}`).replace("from '../src/map-catalog.js'", `from ${JSON.stringify(pathToFileURL(resolve(root, 'src/map-catalog.js')).href)}`);
  const legacy = await import('data:text/javascript;base64,' + Buffer.from(legacySource).toString('base64'));
  async function source(files) {
    await rm(resolve(root, 'src'), { recursive: true, force: true });
    for (const [path, bytes] of files) { await mkdir(dirname(resolve(root, path)), { recursive: true }); await writeFile(resolve(root, path), bytes); }
  }
  return async label => {
    const old = label.startsWith('before-');
    try {
      await source(old ? before : current);
      await rm(resolve(out, 'src'), { recursive: true, force: true });
      await cp(resolve(root, 'src'), resolve(out, 'src'), { recursive: true });
      await writeFile(resolve(out, 'index.html'), (await readFile(resolve(root, 'index.html'), 'utf8')).replace('</head>', '<meta name="asr-environment" content="staging">\n</head>'));
      for (const [name, bytes] of data) await writeFile(resolve(out, 'data', name), bytes);
      const meta = label === 'before-source' ? null : old ? await legacy.bundleBrowser(root, out) : await bundleBrowser(root, out, { three: label === 'after-cdn' ? 'cdn' : 'bundled' });
      // Generated release data is stamped after the content hash, exactly as prepare-deploy does.
      for (const name of ['release.json', 'credits.json']) await rm(resolve(out, name), { force: true });
      const release = await buildRelease(out, { core: [...(meta?.initial || ['/src/']), '/src/offline-cache.js', '/style.css', '/assets/icons/', '/assets/maps/'] });
      await publishRelease(root, out, release);
      await publishReleaseData(root, out, { build: release.build, sha: old ? beforeRef.slice(0, 7) : process.env.ASR_MEASURE_SHA?.slice(0, 7) });
      console.log(JSON.stringify({ variant: label, build: release.build, chunks: meta ? Object.keys(meta.outputs).length : null }));
      return out;
    } finally { await source(current); }
  };
}
