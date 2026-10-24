// Lossless compact recovery registry. Only requested cells are decoded; the
// authenticated compact object itself remains the published authority.
import { recoveryJSONDataBytes } from './route-road-wire.mjs';
const HEX = /^[a-f0-9]{64}$/;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const LIMIT = 12 * 1024 ** 2;
// One bounded byte/hex decode+canonical re-encode uses at most two 32-entry
// scratch arrays and short text tokens. Reserve 12 KiB for those temporaries,
// plus 768 bytes per retained source/part hash, array slot and duplicate index.
const CELL_TEMPORARIES = 12 * 1024;
export const MAX_RECOVERY_CELL_SCRATCH = CELL_TEMPORARIES + 65 * 768;
const fail = () => { throw Error('Invalid immutable recovery sidecar'); };

export function encodeRecoveryHash(hex) {
  if (typeof hex !== 'string' || hex.length !== 64 || !HEX.test(hex)) fail();
  const bytes = new Array(32); for (let i = 0; i < 32; i++) bytes[i] = String.fromCharCode(parseInt(hex.slice(i * 2, i * 2 + 2), 16));
  const raw = bytes.join('');
  return btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function decodeRecoveryHash(token) {
  if (typeof token !== 'string' || token.length !== 43 || !TOKEN.test(token)) fail();
  let raw; try { raw = atob(token.replace(/-/g, '+').replace(/_/g, '/') + '='); } catch { fail(); }
  if (raw.length !== 32) fail();
  const hexBytes = new Array(32); for (let i = 0; i < 32; i++) hexBytes[i] = raw.charCodeAt(i).toString(16).padStart(2, '0');
  const hex = hexBytes.join('');
  if (encodeRecoveryHash(hex) !== token) fail(); // Reject nonzero unused pad bits.
  return hex;
}

function tokenCount(value) {
  if (typeof value !== 'string' || value.length < 43 || value.length > 65 * 44 - 1 || (value.length + 1) % 44 !== 0) fail();
  const count = (value.length + 1) / 44;
  for (let i = 0; i < count; i++) if (i && value[i * 44 - 1] !== ':' || !TOKEN.test(value.slice(i * 44, i * 44 + 43))) fail();
  return count;
}
export function recoveryCellScratchBytes(manifest, key) {
  if (manifest.schemaVersion !== 2) return 0;
  return CELL_TEMPORARIES + tokenCount(manifest.cells[key]) * 768;
}
export function recoveryCellSourceHash(manifest, key) {
  const value = manifest.cells[key];
  if (manifest.schemaVersion !== 2) return value?.sourceHash;
  tokenCount(value); return decodeRecoveryHash(value.slice(0, 43));
}
export function recoveryCellDescriptor(manifest, key, { maxScratchBytes = MAX_RECOVERY_CELL_SCRATCH } = {}) {
  const value = manifest.cells[key];
  if (manifest.schemaVersion !== 2) return value;
  const count = tokenCount(value), scratch = CELL_TEMPORARIES + count * 768;
  if (!Number.isSafeInteger(maxScratchBytes) || scratch > maxScratchBytes) throw Error('Recovery candidate memory budget exceeded: descriptor decode');
  // The bound is checked before allocating decoded hashes, arrays or an index.
  const sourceHash = decodeRecoveryHash(value.slice(0, 43));
  if (count === 1) return { sourceHash, empty: true };
  const parts = [], seen = new Set();
  for (let i = 1; i < count; i++) {
    const hash = decodeRecoveryHash(value.slice(i * 44, i * 44 + 43));
    if (seen.has(hash)) fail(); seen.add(hash); parts.push(hash);
  }
  return { sourceHash, parts };
}

export function encodeRecoveryManifest(body) {
  // Reserve caller + private legacy copy + compact output and key/decode scratch
  // before cloning. Compression cannot create a larger graph than its source.
  const bytes = recoveryJSONDataBytes(body, LIMIT / 3);
  if (body?.schemaVersion !== 1 || !body.cells || Array.isArray(body.cells)) fail();
  const keys = Object.keys(body.cells), scratch = keys.length * 192 + MAX_RECOVERY_CELL_SCRATCH;
  if (bytes * 3 + scratch > LIMIT) throw Error('Recovery manifest encoding memory budget exceeded');
  const copy = structuredClone(body), cells = {};
  for (const key of keys) {
    const cell = copy.cells[key];
    if (!/^-?\d+,-?\d+$/.test(key) || !cell || !HEX.test(cell.sourceHash || '')) fail();
    let hashes;
    if (cell.empty === true) { if (Object.keys(cell).some(k => !['sourceHash', 'empty'].includes(k))) fail(); if (cell.hash !== undefined || cell.url !== undefined || cell.parts !== undefined) fail(); hashes = []; }
    else if (cell.parts !== undefined) {
      if (Object.keys(cell).some(k => !['sourceHash', 'parts'].includes(k))) fail();
      if (cell.empty !== undefined || cell.hash !== undefined || cell.url !== undefined || !Array.isArray(cell.parts) || !cell.parts.length || cell.parts.length > 64 || cell.parts.some(h => !HEX.test(h)) || new Set(cell.parts).size !== cell.parts.length) fail();
      hashes = cell.parts;
    } else {
      if (Object.keys(cell).some(k => !['sourceHash', 'hash', 'url'].includes(k))) fail();
      if (cell.empty !== undefined || !HEX.test(cell.hash || '') || cell.url !== `/world/recovery/${key}.${cell.hash}.json`) fail(); hashes = [cell.hash];
    }
    cells[key] = [cell.sourceHash, ...hashes].map(encodeRecoveryHash).join(':');
  }
  copy.schemaVersion = 2; copy.cells = cells;
  const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
  return freeze(copy);
}
