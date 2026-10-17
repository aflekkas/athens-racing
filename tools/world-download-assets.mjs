import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
// Static assets do not consistently honor Range. Small independently cached
// pieces bound recovery replay without changing a byte of the gzip stream.
export const WORLD_DOWNLOAD_PART_BYTES = 1024 * 1024;
export async function writeWorldDownload(dir, name, bytes, assets, partBytes = WORLD_DOWNLOAD_PART_BYTES) {
  const urls = [];
  for (let offset = 0; offset < bytes.length; offset += partBytes) {
    const body = bytes.subarray(offset, offset + partBytes), index = urls.length;
    const file = bytes.length <= partBytes ? name : name.replace(/\.(bin\.gz|meshopt\.gz)$/, `.part-${index}.$1`);
    const url = './data/baked/' + file;
    await writeFile(resolve(dir, file), body);
    assets[url] = { bytes: body.length, sha256: createHash('sha256').update(body).digest('hex') };
    urls.push(url);
  }
  return urls.length === 1 ? urls[0] : urls;
}
