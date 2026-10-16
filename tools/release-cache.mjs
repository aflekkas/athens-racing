// Deploy-time caching for the static assets (used by tools/prepare-deploy.mjs; see src/service-worker.js):
//  - every cacheable file is also published content-addressed at /_c/<sha256-16><ext>, served `immutable`
//  - /sw.js = the release manifest + src/service-worker.js (a new release = a new worker = changed files re-fetched)
//  - index.html gets <meta name="asr-build"> and the registration script (src/offline-cache.js)
// The plain paths keep Cloudflare's default revalidation (ETag), so nothing is ever served stale without the worker.
import { readdir, readFile, writeFile, mkdir, copyFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, relative, extname, sep } from 'node:path';

// streamed (range requests), crawler-only, or not used by the game at runtime
export const UNCACHED = [/^\/assets\/changelog\//, /^\/assets\/audio\/music\//, /^\/assets\/share\//, /^\/data\/raw\//, /\.(md|txt)$/i, /^\/src\/service-worker\.js$/, /^\/(index\.html|robots\.txt|sitemap\.xml|_headers|sw\.js)$/];
export const CACHE_HEADERS = '/src/KTX2Loader-*\n  Cache-Control: public, max-age=31536000, immutable\n/src/meshopt_decoder.module-*\n  Cache-Control: public, max-age=31536000, immutable\n/assets/codecs/basis/*\n  Cache-Control: public, max-age=31536000, immutable\n/assets/tex/ktx2/*\n  Cache-Control: public, max-age=31536000, immutable\n/data/baked/*\n  Cache-Control: public, max-age=31536000, immutable\n/_c/*\n  Cache-Control: public, max-age=31536000, immutable\n/sw.js\n  Cache-Control: no-cache\n';
export const hash16 = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 16);

async function walk(dir, out = []) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = resolve(dir, e.name);
    if (e.isDirectory()) await walk(p, out); else if (e.isFile()) out.push(p);
  }
  return out;
}
/** hash the deploy directory, publish the /_c/ copies; core = URL prefixes the worker precaches at install */
export async function buildRelease(out, { core = [] } = {}) {
  const files = {}, written = new Set();
  for (const abs of (await walk(out)).sort()) {
    const path = '/' + relative(out, abs).split(sep).join('/');
    if (path.startsWith('/_c/') || UNCACHED.some(re => re.test(path))) continue;
    const h = hash16(await readFile(abs)); files[path] = h;
    const dest = resolve(out, '_c', h + extname(path).toLowerCase());
    if (!written.has(dest)) { written.add(dest); await mkdir(resolve(out, '_c'), { recursive: true }); await copyFile(abs, dest); }
  }
  const build = hash16(JSON.stringify(files)).slice(0, 12);
  return { build, files, core, copies: written.size };
}
/** write /sw.js and wire index.html to the release */
export async function publishRelease(root, out, release) {
  const sw = await readFile(resolve(root, 'src/service-worker.js'), 'utf8');
  await writeFile(resolve(out, 'sw.js'), `self.ASR_RELEASE = ${JSON.stringify(release)};\n${sw}`);
  const indexPath = resolve(out, 'index.html'), html = await readFile(indexPath, 'utf8');
  if (!html.includes('</head>')) throw new Error('index.html has no </head>');
  await writeFile(indexPath, html.replace('</head>', `<meta name="asr-build" content="${release.build}" />\n<script type="module" src="./src/offline-cache.js"></script>\n</head>`));
  return (await stat(resolve(out, 'sw.js'))).size;
}
