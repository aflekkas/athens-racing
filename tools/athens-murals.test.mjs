// Step 6c of the Athens beauty pass: murals on long walls, many in Exarchia, Psyrri and Metaxourgeio (docs/world-beauty.md). No tags, no brands.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { deriveStreetArt, STREET_ART, ART_LIMITS } from '../src/world-tile-street-art.js';
import { inArtQuarter, inOldQuarter } from '../src/athens-quarters.js';
import { AthensSigns, paintMural, MURAL_WORDS, SIGN_LIMITS } from '../src/athens-signs.js';

const fakeContext = () => { const calls = { fill: 0, stroke: 0, text: 0 }, ctx = new Proxy({ measureText: t => ({ width: t.length * 9 }) }, { get: (o, k) => (k in o ? o[k] : k === 'calls' ? calls : (...a) => { if (k === 'fill' || k === 'fillRect') calls.fill++; if (k === 'stroke' || k === 'strokeRect') calls.stroke++; if (k === 'fillText' || k === 'strokeText') calls.text++; }), set: (o, k, v) => { o[k] = v; return true; } }); return ctx; };
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => fakeContext() }) };
test('the street-art quarters are Exarchia, Psyrri and Metaxourgeio, inside the old quarters', () => {
  assert.equal(STREET_ART.murals, true);
  const [exX, exZ] = [263, -890], [psX, psZ] = [-700, 200], [kolX, kolZ] = [1450, 380]; // Exarchia, Psyrri, Kolonaki-ish
  assert.ok(inArtQuarter(exX, exZ) && inArtQuarter(psX, psZ), 'Exarchia and Psyrri'); assert.ok(!inArtQuarter(1000, 3000) && !inArtQuarter(kolX, kolZ)); assert.ok(inOldQuarter(psX, psZ));
});
test('mural sites are the long walls facing a road, at most one per building, never on a wall that has the shop sign', () => {
  const E = [1, 0, 1, 0, 2, 0, 1, 30, 0, 0], P = [20, 5, 100, 180, 5, 100], t = { nodes: new Uint32Array(0), nodePositions: new Float32Array(0), edges: Uint32Array.from(E), edgePoints: Float32Array.from(P), edgeLayers: Int8Array.from([0]) };
  const infos = [{ ring: [[40, 104], [70, 104], [70, 120], [40, 120]], base: 5, top: 20, style: 8, hash: 4001, quarter: true }, { ring: [[90, 104], [120, 104], [120, 120], [90, 120]], base: 5, top: 12, style: 4, hash: 4002, quarter: false }];
  const art = deriveStreetArt(t, { strings: [] }, infos); assert.equal(art.walls.length / 7, 2, 'the pilotis block gets the mural wall, the shop block a shared one'); assert.equal(art.shops.length / 7, 1); const flags = [art.walls[5], art.walls[12]].map(v => v | 0); assert.equal(flags.filter(f => f & 128).length, 1, 'exactly one is flagged as the shop wall (drawn only where no sign was made)');
  for (let i = 0; i < art.walls.length; i += 7) assert.ok(art.walls[i + 3] >= 6.5, 'a wall of 6.5 m or more');
  { const s = new AthensSigns(new THREE.Group()), rows = [], push = (x, f) => rows.push(x, 100, 0, 8, 5, f, 5); push(10, 4 + 16 + 128); push(30, 4 + 16 + 128); push(50, 4 + 16); // two shared walls, one plain
    const shops = Float32Array.from([10, 100, 0, 8, 5, 4 + 16, 0]); s.addTile('0,0', { metadata: { origin: [0, 0, 0], extensions: { worldDetail: { wallSites: 0, shopSites: 1 } } }, arrays: [Float32Array.from(rows), shops] }); const t = s.records(s.tiles.get('0,0')); assert.equal(t.signs.length, 1, 'the generic sign was made at x = 10 (style 4)'); assert.ok(t.murals.every(m => Math.abs(m.x - 10) > 1), 'no mural on the wall the sign has'); }
  assert.ok(ART_LIMITS.walls <= 600);
});
test('twenty-four mural designs paint without throwing, each draws, and the only words are plain Greek ones', () => {
  for (let n = 0; n < 24; n++) { const ctx = fakeContext(); paintMural(ctx, 0, 0, 256, 128, n); assert.ok(ctx.calls.fill > 0 && ctx.calls.fill + ctx.calls.stroke + ctx.calls.text > 3, `design ${n} draws`); }
  assert.ok(MURAL_WORDS.length >= 10); for (const w of MURAL_WORDS) assert.match(w, /^[Α-Ω]+$/, `${w}: Greek capitals only, no Latin tag`);
  const banned = /(adidas|nike|coca|pepsi|fuck|acab|nazi|kke|ndp|syriza|golden)/i; assert.ok(!banned.test(readFileSync(new URL('../src/athens-signs.js', import.meta.url), 'utf8')), 'no brand, tag or slogan in the source');
});
test('murals are many in the street-art quarters, rare elsewhere, one draw call, within 70 m, and hidden with World detail Off', () => {
  globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => fakeContext() }) };
  const group = new THREE.Group(), signs = new AthensSigns(group), site = (i, flags) => [10 + (i % 50) * 3, 100 + Math.floor(i / 50) * 3, 0, 8, 5, flags, (Math.imul(i + 1, 2654435761) >>> 8) & 0xffffff];
  const tile = flags => { const rows = []; for (let i = 0; i < 400; i++) rows.push(...site(i, flags)); return Float32Array.from(rows); };
  const count = flags => { const s = new AthensSigns(new THREE.Group()); s.addTile('0,0', { metadata: { origin: [0, 0, 0], extensions: { worldDetail: { wallSites: 0 } } }, arrays: [tile(flags)] }); const t = s.records(s.tiles.get('0,0')); return t.murals.length; };
  const art = count(4 + 16 + 32), old = count(4 + 32), plain = count(4); assert.ok(art > 130 && art < 210, `${art} in an art quarter`); assert.ok(old < 50 && old > 8, `${old} in an old quarter`); assert.ok(plain < 40 && plain >= 5, `${plain} elsewhere`); assert.ok(art > 4 * plain);
  signs.addTile('0,0', { metadata: { origin: [0, 0, 0], extensions: { worldDetail: { wallSites: 0 } } }, arrays: [tile(4 + 16 + 32)] }); signs.update({ position: { x: 60, z: 100 } });
  assert.ok(signs.stats.murals > 5 && signs.stats.murals <= SIGN_LIMITS.murals && signs.muralMesh.mesh.visible); assert.ok(signs.stats.drawCalls <= 2);
  for (let i = 0; i < signs.muralMesh.mesh.count; i++) { const m = new THREE.Matrix4(); signs.muralMesh.mesh.getMatrixAt(i, m); const p = new THREE.Vector3().setFromMatrixPosition(m); assert.ok(Math.hypot(p.x - 60, p.z - 100) < SIGN_LIMITS.nearArt, 'within range'); }
  signs.setEnabled(false); assert.equal(signs.group.visible, false);
});
