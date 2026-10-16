// File bodies and HTTP-compressed payloads: headers/TLS overhead are not included.
import { TEXTURE_MANIFEST } from '../src/texture-manifest.js';
import { readFile, writeFile } from 'node:fs/promises';
import { brotliCompressSync, gzipSync, constants } from 'node:zlib';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..'), rows = [];
for (const [url, entry] of Object.entries(TEXTURE_MANIFEST)) {
  const before = await readFile(resolve(root, url.slice(1))), after = await readFile(resolve(root, entry.url.slice(1)));
  const view = new DataView(after.buffer, after.byteOffset, after.byteLength);
  const width = view.getUint32(20, true), height = view.getUint32(24, true), levels = view.getUint32(40, true);
  let gpuBefore = 0, gpuAfter = 0;
  for (let i = 0; i < levels; i++) { const w = Math.max(1,width >> i), h = Math.max(1,height >> i); gpuBefore += w*h*4; gpuAfter += Math.ceil(w/4)*Math.ceil(h/4)*(entry.mode === 'etc1s' && /_diff\./.test(url) ? 8 : 16); }
  const br = bytes => brotliCompressSync(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 6 } }).length;
  rows.push({ url, selected: entry.enabled, mode: entry.mode, webpBytes: before.length, ktx2Bytes: after.length, webpGzip: gzipSync(before).length, ktx2Gzip: gzipSync(after).length, webpBrotli: br(before), ktx2Brotli: br(after), gpuBefore, gpuAfter, width, height, levels, note: 'GPU estimate assumes BC1 colour / BC3 or BC7 detail. Actual runtime format measured separately.' });
}
await writeFile(resolve(root, '.scratch/perf-2026-10-15/textures-data/textures.json'), JSON.stringify(rows,null,2));
console.log(rows);
