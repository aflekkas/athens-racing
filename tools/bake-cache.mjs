// Content-addressed cache for the per-map world bake (tools/bake-world.mjs), the slowest step of tools/prepare-deploy.mjs.
// An entry holds everything a bake produces for one map: the data/baked/* downloads, the map data file with its bakedWorld
// field, and that map's codec policy. The key hashes every input the bake can read, so a hit is byte-identical to a rebake:
//   - the local source closure of tools/bake-world.mjs (esbuild metafile; src/asset-codec-policy.js is the bake's own output
//     and is left out), so any change to terrain, roads, packing or the map catalogue misses;
//   - the map's data and terrain files (the only files the bake reads at run time, via the fetch shim; bake-world.mjs checks this);
//   - the three.js and Node versions (gzip and mesh packing depend on them) and CACHE_VERSION.
// Entries live in $ASR_CACHE_DIR/bake (default ~/.cache/athens-release/bake), are published by atomic rename, and are pruned to
// a size cap, so concurrent trains and agents can share them. ASR_BAKE_CACHE=off bypasses the cache.
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { readFile, readdir, rename, rm, stat, utimes, mkdir } from 'node:fs/promises';
import { resolve, relative, sep } from 'node:path';

export const CACHE_VERSION = 1;
export const DEFAULT_MAX_BYTES = 3 * 1024 ** 3;
const OUTPUT_FILES = new Set(['src/asset-codec-policy.js']);
const slash = path => path.split(sep).join('/');
const sha = (...parts) => { const h = createHash('sha256'); for (const p of parts) h.update(p); return h.digest('hex'); };

export const cacheRoot = (env = process.env) => resolve(env.ASR_CACHE_DIR || resolve(homedir(), '.cache/athens-release'));
export const bakeCacheEnabled = (env = process.env) => !/^(off|0|false|no)$/i.test(env.ASR_BAKE_CACHE || '');

/** Local files (repo-relative) that tools/bake-world.mjs imports, transitively. */
export async function bakeSourceClosure(root, entry = 'tools/bake-world.mjs') {
  const result = await build({ absWorkingDir: root, entryPoints: [entry], bundle: true, write: false, metafile: true, platform: 'node', format: 'esm', packages: 'external', logLevel: 'silent', outdir: resolve(root, '.bake-closure-unused') });
  return Object.keys(result.metafile.inputs).map(slash).filter(path => !OUTPUT_FILES.has(path)).sort();
}
export async function threeVersion(root) { return JSON.parse(await readFile(resolve(root, 'node_modules/three/package.json'), 'utf8')).version; }

/** Hash of the code side of the bake; the same for every map. */
export async function bakeCodeKey(root, { nodeVersion = process.version, zlib = process.versions.zlib } = {}) {
  const files = await bakeSourceClosure(root), parts = [`v${CACHE_VERSION}`, `node ${nodeVersion} zlib ${zlib}`, `three ${await threeVersion(root)}`];
  for (const file of files) parts.push(`${file}\0${sha(await readFile(resolve(root, file)))}`);
  return { key: sha(parts.join('\n')), files };
}
/** Key of one map's entry: the code key plus that map's data and terrain files. */
export async function bakeMapKey(root, codeKey, def) {
  const inputs = [def.dataUrl, def.terrainUrl];
  const parts = [codeKey, def.id];
  for (const input of inputs) parts.push(`${input}\0${sha(await readFile(resolve(root, input)))}`);
  return { key: sha(parts.join('\n')).slice(0, 32), inputs };
}

export const bakeCacheDir = (env = process.env) => resolve(cacheRoot(env), 'bake');
export async function lookupEntry(dir, key) {
  const entry = resolve(dir, key);
  try { await stat(resolve(entry, 'meta.json')); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  const now = new Date(); await utimes(entry, now, now).catch(() => {}); // pruning is least-recently-used
  return entry;
}
/** Publish a finished bake directory under its key. Another process may have won the race; its entry is equivalent. */
export async function publishEntry(dir, key, staged) {
  await mkdir(dir, { recursive: true });
  const entry = resolve(dir, key);
  try { await rename(staged, entry); } catch (e) {
    if (e.code !== 'ENOTEMPTY' && e.code !== 'EEXIST') throw e;
    await rm(staged, { recursive: true, force: true });
  }
  return entry;
}
async function dirBytes(path) {
  let total = 0;
  for (const e of await readdir(path, { withFileTypes: true })) total += e.isDirectory() ? await dirBytes(resolve(path, e.name)) : (await stat(resolve(path, e.name))).size;
  return total;
}
/** Delete least-recently-used entries until the directory fits maxBytes; keeps the newest `keep` entries, and anything younger than minAgeMs (in-flight bakes). */
export async function pruneEntries(dir, { maxBytes = DEFAULT_MAX_BYTES, keep = 4, minAgeMs = 60 * 60 * 1000 } = {}) {
  let names;
  try { names = await readdir(dir); } catch (e) { if (e.code === 'ENOENT') return { removed: [], bytes: 0 }; throw e; }
  const entries = [];
  for (const name of names) {
    const path = resolve(dir, name), info = await stat(path);
    if (info.isDirectory()) entries.push({ name, path, mtime: info.mtimeMs, bytes: await dirBytes(path) });
  }
  entries.sort((a, b) => b.mtime - a.mtime);
  let total = entries.reduce((sum, e) => sum + e.bytes, 0);
  const removed = [], now = Date.now();
  for (const entry of [...entries].reverse()) {
    if (total <= maxBytes) break;
    if (entries.indexOf(entry) < keep || now - entry.mtime < minAgeMs) continue;
    await rm(entry.path, { recursive: true, force: true }); total -= entry.bytes; removed.push(entry.name);
  }
  return { removed, bytes: total };
}
export const relativeTo = (root, path) => slash(relative(root, path));
