// Dependency-free WebP checks for release media. Image bytes never enter the JavaScript/HTML bundle.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseVersion } from '../src/release-notes.js';

export const MAX_IMAGE_BYTES = 150000;
/** Read lossy WebP's actual frame dimensions (not its optional canvas metadata). */
export function webpDimensions(bytes) {
  if (bytes.length < 30 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WEBP') throw new Error('not a WebP image');
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const type = bytes.toString('ascii', offset, offset + 4), size = bytes.readUInt32LE(offset + 4), start = offset + 8;
    if (start + size > bytes.length) throw new Error('truncated WebP image');
    if (type === 'VP8 ') {
      if (size < 10 || bytes.toString('hex', start + 3, start + 6) !== '9d012a') throw new Error('invalid WebP frame');
      return { width: bytes.readUInt16LE(start + 6) & 0x3fff, height: bytes.readUInt16LE(start + 8) & 0x3fff };
    }
    offset = start + size + (size % 2);
  }
  throw new Error('use a still, lossy WebP screenshot (quality about 75), not lossless or animated WebP');
}

/** Verify all references, and enrich their small metadata records for stable lazy-loading layouts. */
export async function validateChangelogImages(root, log) {
  const images = [...(log.unreleasedImages || []), ...log.releases.flatMap(release => release.images || [])];
  for (const image of images) {
    if (!image.alt?.trim()) throw new Error('Changelog images require alt text');
    const match = /^assets\/changelog\/([\d.]+)\/[a-zA-Z0-9_-]+\.webp$/.exec(image.src || '');
    if (!match || !parseVersion(match[1])) throw new Error(`Invalid changelog image path: ${image.src}`);
    const bytes = await readFile(resolve(root, image.src)).catch(() => { throw new Error(`Missing changelog image: ${image.src}`); });
    if (bytes.length >= MAX_IMAGE_BYTES) throw new Error(`${image.src}: must be under 150 KB`);
    const dimensions = webpDimensions(bytes);
    if (dimensions.width < 960 || dimensions.width > 1280 || dimensions.height < 200 || dimensions.height > 1280) throw new Error(`${image.src}: screenshots must be about 1280 px wide (960–1280), and no taller than 1280 px`);
    Object.assign(image, dimensions);
  }
  return images;
}

/** Non-blocking warning; the release train owns cutting versions, not contributors. */
export const missingPicturesWarning = log => log.unreleased.length && !log.unreleasedImages?.length
  ? 'WARNING: CHANGELOG.md Unreleased has player changes but NO SCREENSHOTS. Add Markdown images before the release train cuts the next version (deploy/README.md).'
  : null;
