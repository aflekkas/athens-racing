import { canonicalJSON } from '../src/route-definition.js';

const FIELDS = Object.freeze(['edgeId', 'footprints', 'halfLength', 'halfWidth', 'layer', 'leftM', 'offsetM', 'rightM', 'roadId', 'surfaceId', 'x', 'y', 'yaw', 'z']);
const ROOT = ['schemaVersion', 'worldId', 'projectionId', 'worldSetRevision', 'sourceHashes', 'edges', 'anchors'];
const own = (v, k) => Object.hasOwn(v, k);
const objectKeys = (v, fields) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === fields.length && fields.every(k => own(v, k));
const fail = () => { throw Error('Invalid packed recovery artifact'); };
const freeze = v => { if (v && typeof v === 'object' && !Object.isFrozen(v)) { Object.values(v).forEach(freeze); Object.freeze(v); } return v; };

// Deliberately counts repeated references again: the guard is conservative and
// shared certificates must not become a way around expansion accounting.
export function recoveryDataBytes(value, limit = Infinity) {
  let bytes = 0;
  const visit = v => {
    bytes += typeof v === 'string' ? 48 + v.length * 2 : v && typeof v === 'object' ? 96 : 16;
    if (bytes > limit) throw Error('Recovery decoded memory budget exceeded');
    if (v && typeof v === 'object') for (const [key, child] of Object.entries(v)) { bytes += 48 + key.length * 2; visit(child); }
  };
  visit(value); return bytes;
}
// Exact canonical JSON sizes without allocating its complete string/UTF-8
// buffer. Charge both before the authentication helper creates either buffer.
export function recoveryCanonicalSize(value) {
  let codeUnits = 0, bytes = 0, maxTokenCodeUnits = 0;
  const add = (n, b = n) => { codeUnits += n; bytes += b; };
  const string = s => {
    const start = codeUnits;
    add(2);
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c === 34 || c === 92 || [8, 9, 10, 12, 13].includes(c)) add(2);
      else if (c < 32) add(6);
      else if (c >= 0xd800 && c <= 0xdbff && s.charCodeAt(i + 1) >= 0xdc00 && s.charCodeAt(i + 1) <= 0xdfff) { add(2, 4); i++; }
      else if (c >= 0xd800 && c <= 0xdfff) add(6);
      else add(1, c < 128 ? 1 : c < 2048 ? 2 : 3);
    }
    maxTokenCodeUnits = Math.max(maxTokenCodeUnits, codeUnits - start);
  };
  const visit = v => {
    if (typeof v === 'string') string(v);
    else if (v === null || typeof v === 'boolean' || typeof v === 'number') { const n = canonicalJSON(v).length; add(n); maxTokenCodeUnits = Math.max(maxTokenCodeUnits, n); }
    else if (Array.isArray(v)) { add(2 + Math.max(0, v.length - 1)); for (const child of v) visit(child); }
    else if (v && typeof v === 'object') { const keys = Object.keys(v); add(2 + Math.max(0, keys.length - 1) + keys.length); for (const k of keys) { string(k); visit(v[k]); } }
    else fail();
  };
  visit(value); return { codeUnits, bytes, maxTokenCodeUnits };
}
// Write canonical tokens directly into the precharged UTF-8 buffer; never
// retain a complete canonical UTF-16 string beside the parsed/raw forms.
export function recoveryCanonicalBytes(value, size = recoveryCanonicalSize(value)) {
  const output = new Uint8Array(size.bytes), encoder = new TextEncoder(); let offset = 0;
  const write = token => { const { read, written } = encoder.encodeInto(token, output.subarray(offset)); if (read !== token.length) fail(); offset += written; };
  const visit = v => {
    if (typeof v === 'string' || v === null || typeof v === 'boolean' || typeof v === 'number') write(canonicalJSON(v));
    else if (Array.isArray(v)) { write('['); for (let i = 0; i < v.length; i++) { if (i) write(','); visit(v[i]); } write(']'); }
    else { write('{'); const keys = Object.keys(v).sort(); for (let i = 0; i < keys.length; i++) { if (i) write(','); write(JSON.stringify(keys[i])); write(':'); visit(v[keys[i]]); } write('}'); }
  };
  visit(value); if (offset !== output.length) fail(); return output;
}
function validSets(sets) {
  if (!Array.isArray(sets)) fail();
  const seen = new Set();
  for (const set of sets) {
    if (!Array.isArray(set) || !set.length || set.length > 64) fail();
    for (const p of set) if (!objectKeys(p, ['halfWidth', 'halfLength']) || !Number.isFinite(p.halfWidth) || p.halfWidth <= 0 || p.halfWidth > 3 || !Number.isFinite(p.halfLength) || p.halfLength <= 0 || p.halfLength > 12) fail();
    const key = canonicalJSON(set); if (seen.has(key)) fail(); seen.add(key);
  }
}
function checkPacked(body) {
  if (!objectKeys(body, [...ROOT, 'anchorFields', 'footprintSets']) || body.schemaVersion !== 2 || !Array.isArray(body.anchorFields) || body.anchorFields.length !== FIELDS.length || !FIELDS.every((k, i) => body.anchorFields[i] === k) || !Array.isArray(body.anchors) || !body.anchors.length) fail();
  validSets(body.footprintSets);
  const used = new Set();
  for (const row of body.anchors) {
    if (!Array.isArray(row) || row.length !== FIELDS.length || !Object.keys(row).every((k, i) => k === String(i)) || Object.keys(row).length !== FIELDS.length) fail();
    for (let i = 0; i < FIELDS.length; i++) {
      const k = FIELDS[i], v = row[i];
      if (k === 'footprints') { if (v !== null) { if (!Number.isInteger(v) || v < 0 || v >= body.footprintSets.length) fail(); used.add(v); } }
      else if (k === 'roadId') { if (v !== null && (typeof v !== 'string' || !v)) fail(); }
      else if (k === 'edgeId' || k === 'surfaceId') { if (typeof v !== 'string' || !v) fail(); }
      else if (!Number.isFinite(v) || k === 'layer' && !Number.isInteger(v)) fail();
    }
  }
  if (used.size !== body.footprintSets.length) fail();
}
/** Builder API: no rounding, omission, mutation, or inferred certificates.
 * Null is reserved for absent optional footprints/roadId; all other 12 fields
 * are mandatory. Edge objects and every point/property remain unchanged. */
export function encodeRecoverySidecar(body) {
  if (!objectKeys(body, ROOT) || body.schemaVersion !== 1 || !Array.isArray(body.anchors) || !body.anchors.length) fail();
  canonicalJSON(body); // Reject non-JSON values rather than silently dropping them.
  const copy = structuredClone(body), footprintSets = [], ids = new Map();
  const anchors = copy.anchors.map(a => {
    if (!a || typeof a !== 'object' || Array.isArray(a) || Object.keys(a).some(k => !FIELDS.includes(k)) || FIELDS.some(k => !['footprints', 'roadId'].includes(k) && !own(a, k))) fail();
    return FIELDS.map(k => {
      if (!own(a, k)) return null;
      if (a[k] === null) fail();
      if (k !== 'footprints') return a[k];
      const key = canonicalJSON(a[k]);
      if (!ids.has(key)) { ids.set(key, footprintSets.length); footprintSets.push(a[k]); }
      return ids.get(key);
    });
  });
  const packed = { ...copy, schemaVersion: 2, anchorFields: [...FIELDS], footprintSets, anchors };
  checkPacked(packed); return freeze(packed);
}
/** Internal codec, only after packed authentication. Request-owned parsed rows
 * may be consumed in place; caller-owned objects use the conservative two-form
 * path. Charge the newly allocated anchor before releasing its old tuple. */
export function decodeRecoverySidecar(body, { maxCombinedBytes = Infinity, liveBufferBytes = 0, consume = false } = {}) {
  checkPacked(body);
  const packedBytes = recoveryDataBytes(body, maxCombinedBytes);
  const expanded = consume ? body : { schemaVersion: 1, worldId: body.worldId, projectionId: body.projectionId, worldSetRevision: body.worldSetRevision, sourceHashes: body.sourceHashes, edges: body.edges, anchors: [] };
  let currentBytes = packedBytes + liveBufferBytes, peakBytes = currentBytes;
  const valueAt = (row, i) => FIELDS[i] === 'footprints' ? body.footprintSets[row[i]] : row[i];
  const anchorBytes = row => {
    let bytes = 96;
    for (let i = 0; i < FIELDS.length; i++) if (row[i] !== null) bytes += 48 + FIELDS[i].length * 2 + recoveryDataBytes(valueAt(row, i));
    return bytes;
  };
  const check = bytes => { peakBytes = Math.max(peakBytes, bytes); if (bytes > maxCombinedBytes) throw Error('Recovery combined expansion memory budget exceeded'); };
  if (!consume) {
    // Precharge both complete forms before allocating any expanded anchor.
    currentBytes += recoveryDataBytes(expanded);
    for (let n = 0; n < body.anchors.length; n++) currentBytes += 48 + String(n).length * 2 + anchorBytes(body.anchors[n]);
    check(currentBytes);
  } else check(currentBytes);
  for (let n = 0; n < body.anchors.length; n++) {
    const row = body.anchors[n], bytes = anchorBytes(row);
    if (consume) check(currentBytes + bytes);
    const anchor = {};
    for (let i = 0; i < FIELDS.length; i++) if (row[i] !== null) anchor[FIELDS[i]] = valueAt(row, i);
    expanded.anchors[n] = anchor;
    if (consume) currentBytes += bytes - recoveryDataBytes(row);
  }
  if (consume) { expanded.schemaVersion = 1; delete expanded.anchorFields; delete expanded.footprintSets; }
  return { body: expanded, metrics: Object.freeze({ packedBytes, expandedBytes: recoveryDataBytes(expanded), peakBytes, liveBufferBytes, consumed: consume }) };
}
