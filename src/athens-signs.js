// Greek signs and murals of the streamed Athens world: blue street-name plates on the corner buildings of junctions (the OSM `name` of the street, as written), shop signs on
// ground-floor facades (an OSM shop or amenity name where assets/athens/pois.json has one, a generic Greek sign otherwise: ΦΑΡΜΑΚΕΙΟ with the green cross, ΠΕΡΙΠΤΕΡΟ, ΚΑΦΕ,
// ΦΟΥΡΝΟΣ and so on) and murals on long walls, many in Exarchia, Psyrri and Metaxourgeio. The sites come from the tile worker (src/world-tile-street-art.js).
//
// Text is baked at run time into a canvas atlas (256 x 64 px per sign, 128 signs, 8 MB with mips, nothing shipped): a sign is painted the first time it comes within range and
// reused after; a mural is one of 24 procedural designs painted once. Signs and murals are instanced quads, one draw call each (two in all), unlit, drawn within 75 m and
// dissolving over the last 16 m by a dither, so the text stays sharp at street level and is gone before it could shimmer. World detail Off hides both.
import * as THREE from 'three';
import { STREET_ART } from './world-tile-street-art.js';

export const SIGN_LIMITS = Object.freeze({ near: 75, nearArt: 70, fade: 16, signs: 420, murals: 260, rebuildMetres: 8 });
export const SLOT = Object.freeze({ w: 256, h: 64, atlasW: 2048, atlasH: 1024 });
const ART_SLOT = Object.freeze({ w: 256, h: 128, atlas: 1024 });

/** A sign's text as Greek shop fronts write it: capitals, no accents. */
export function signText(name) { return String(name).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim(); }
/** What a generic shop front says, by kind (0 other .. 9 clothes, see tools/world-gen/pois.py) and the fraction of facades of each style that get a sign. */
export const GENERIC = Object.freeze([
  ['ΦΑΡΜΑΚΕΙΟ', 1], ['ΠΕΡΙΠΤΕΡΟ', 4], ['ΚΑΦΕ', 2], ['ΦΟΥΡΝΟΣ', 3], ['ΨΗΤΟΠΩΛΕΙΟ', 6], ['ΤΑΒΕΡΝΑ', 6], ['ΣΟΥΠΕΡ ΜΑΡΚΕΤ', 5], ['ΜΙΝΙ ΜΑΡΚΕΤ', 5], ['ΚΟΜΜΩΤΗΡΙΟ', 8], ['ΕΝΔΥΜΑΤΑ', 9],
  ['ΖΑΧΑΡΟΠΛΑΣΤΕΙΟ', 3], ['ΚΑΦΕΝΕΙΟ', 2], ['ΒΙΒΛΙΟΠΩΛΕΙΟ', 0], ['ΟΠΤΙΚΑ', 0], ['ΛΟΥΛΟΥΔΙΑ', 0], ['ΣΙΔΗΡΙΚΑ', 0], ['ΚΡΕΟΠΩΛΕΙΟ', 5], ['ΦΡΟΥΤΑ ΛΑΧΑΝΙΚΑ', 5], ['ΤΥΡΟΠΙΤΑ', 3], ['ΣΟΥΒΛΑΚΙΑ', 6], ['ΕΣΤΙΑΤΟΡΙΟ', 6], ['ΟΥΖΕΡΙ', 6], ['ΥΠΟΔΗΜΑΤΑ', 9], ['ΤΡΑΠΕΖΑ', 7],
]);
const STYLE_SIGN = { 4: .88, 9: .78, 10: .5, 11: .45, 1: .5, 3: .5, 0: .4 };
/** Palettes of the shop kinds: background, text, border. */
const KIND_PAINT = [['#f3efe4', '#27323a', '#8a8576'], ['#f4f7f2', '#157a3a', '#157a3a'], ['#4a3426', '#f6e9d0', '#2a1c14'], ['#f1c24d', '#7a1d12', '#8a5d12'], ['#1f5f3a', '#f4f1e2', '#123a23'], ['#c0392b', '#ffffff', '#7e2219'], ['#f3ead0', '#a52a22', '#7a6a3a'], ['#173a6e', '#f2f5fa', '#0d2547'], ['#7b4f9e', '#fbf3ff', '#4d2f68'], ['#e3d3c6', '#2c2a2a', '#8c7a6c']];
const VARIANT = [[1, 1, 1], [.92, .96, 1.04], [1.04, .98, .9]];

export function fitText(ctx, text, width, size, minSize = 15) {
  for (let s = size; s >= minSize; s -= 2) { ctx.font = `700 ${s}px "Arial Narrow", Arial, "DejaVu Sans", "Liberation Sans", sans-serif`; if (ctx.measureText(text).width <= width) return [s, [text]]; }
  const words = text.split(' '); if (words.length > 1) { const half = Math.ceil(words.length / 2), lines = [words.slice(0, half).join(' '), words.slice(half).join(' ')]; for (let s = Math.floor(size * .66); s >= 12; s -= 1) { ctx.font = `700 ${s}px "Arial Narrow", Arial, "DejaVu Sans", "Liberation Sans", sans-serif`; if (lines.every(l => ctx.measureText(l).width <= width)) return [s, lines]; } }
  return [minSize, [text]];
}
const shade = (hex, k) => { const c = new THREE.Color(hex); c.r = Math.min(1, c.r * k[0]); c.g = Math.min(1, c.g * k[1]); c.b = Math.min(1, c.b * k[2]); return '#' + c.getHexString(); };
/** Paint one sign into the slot at (x, y), `w` x `h` px. kind 'plate' is the blue street-name plate; otherwise a shop sign of shop kind `kind`. */
export function paintSign(ctx, x, y, w, h, spec) {
  ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip(); ctx.translate(x, y);
  if (spec.plate) {
    ctx.fillStyle = '#16478f'; ctx.fillRect(0, 0, w, h); ctx.strokeStyle = '#f3f6fb'; ctx.lineWidth = 3; ctx.strokeRect(4, 4, w - 8, h - 8);
    const [size, lines] = fitText(ctx, spec.text, w - 26, 34, 17); ctx.fillStyle = '#f7f9fc'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = `700 ${size}px "Arial Narrow", Arial, "DejaVu Sans", "Liberation Sans", sans-serif`;
    lines.forEach((l, i) => ctx.fillText(l, w / 2, h / 2 + (i - (lines.length - 1) / 2) * size * 1.05 + 1));
  } else {
    const [bg, fg, edge] = KIND_PAINT[spec.kind] || KIND_PAINT[0], v = VARIANT[spec.variant % 3];
    ctx.fillStyle = shade(bg, v); ctx.fillRect(0, 0, w, h); ctx.strokeStyle = edge; ctx.lineWidth = 4; ctx.strokeRect(2, 2, w - 4, h - 4);
    const left = spec.kind === 1 ? 62 : 14;
    if (spec.kind === 1) { ctx.fillStyle = '#17944a'; const cx = 32, cy = h / 2; ctx.fillRect(cx - 7, cy - 22, 14, 44); ctx.fillRect(cx - 22, cy - 7, 44, 14); }
    const [size, lines] = fitText(ctx, spec.text, w - left - 12, 38, 16); ctx.fillStyle = fg; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = `700 ${size}px "Arial Narrow", Arial, "DejaVu Sans", "Liberation Sans", sans-serif`;
    lines.forEach((l, i) => ctx.fillText(l, left + (w - left) / 2 - 2, h / 2 + (i - (lines.length - 1) / 2) * size * 1.05 + 1));
  }
  ctx.restore();
}

export const MURAL_WORDS = ['ΑΓΑΠΗ', 'ΕΙΡΗΝΗ', 'ΖΩΗ', 'ΕΛΠΙΔΑ', 'ΑΘΗΝΑ', 'ΜΟΥΣΙΚΗ', 'ΘΑΛΑΣΣΑ', 'ΟΝΕΙΡΟ', 'ΦΩΣ', 'ΠΟΛΗ', 'ΧΑΡΑ', 'ΜΕΛΙ'];
const MURAL_PALETTES = [['#f2e3c6', '#d4472d', '#1e6f8f', '#f2b134'], ['#1f3a4d', '#f08a4b', '#f7e2a0', '#6cc4b0'], ['#e8d9d0', '#2c7a5b', '#c2415d', '#2b2d6e'], ['#f6efe0', '#1d1d1b', '#e0382f', '#2a8fbd'], ['#274c43', '#f4c542', '#f2eadb', '#e0603a'], ['#d9e6ea', '#7b3f8c', '#f0a30a', '#2f5d8a']];
/** Paint mural design `n` (0..23) into the slot at (x, y): a painted panel with one of eight motifs, three palettes each. No tags, no brands: eyes, hearts, birds, cats, owls, suns, mazes and Greek words. */
export function paintMural(ctx, x, y, w, h, n) {
  const motif = n % 8, pal = MURAL_PALETTES[(n * 5 + (n >> 3)) % MURAL_PALETTES.length], [bg, a, b, c] = pal;
  ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip(); ctx.translate(x, y);
  ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h); ctx.strokeStyle = a; ctx.lineWidth = 5; ctx.strokeRect(3, 3, w - 6, h - 6);
  const cx = w / 2, cy = h / 2, dot = (px, py, r, col) => { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.fill(); };
  if (motif === 0) { // an eye
    ctx.fillStyle = '#fff'; ctx.strokeStyle = a; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(30, cy); ctx.quadraticCurveTo(cx, cy - 66, w - 30, cy); ctx.quadraticCurveTo(cx, cy + 66, 30, cy); ctx.fill(); ctx.stroke();
    dot(cx, cy, 30, b); dot(cx, cy, 16, '#101820'); dot(cx - 9, cy - 9, 6, '#fff'); ctx.strokeStyle = a; ctx.lineWidth = 4; for (let i = -3; i <= 3; i++) { ctx.beginPath(); ctx.moveTo(cx + i * 28, cy - 38 + Math.abs(i) * 7); ctx.lineTo(cx + i * 34, cy - 58 + Math.abs(i) * 9); ctx.stroke(); }
  } else if (motif === 1) { // a word in outlined capitals
    const word = MURAL_WORDS[(n * 7) % MURAL_WORDS.length]; let size = 70; ctx.font = `900 ${size}px "Arial Black", Arial, "DejaVu Sans", sans-serif`; while (ctx.measureText(word).width > w - 30 && size > 24) { size -= 4; ctx.font = `900 ${size}px "Arial Black", Arial, "DejaVu Sans", sans-serif`; }
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round'; ctx.lineWidth = 12; ctx.strokeStyle = '#161616'; ctx.strokeText(word, cx + 3, cy + 5); ctx.lineWidth = 6; ctx.strokeStyle = b; ctx.strokeText(word, cx, cy); ctx.fillStyle = c; ctx.fillText(word, cx, cy);
  } else if (motif === 2) { // hearts, stars and a flower
    const heart = (px, py, s, col) => { ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(px, py + s * .3); ctx.bezierCurveTo(px - s, py - s * .4, px - s * .5, py - s, px, py - s * .35); ctx.bezierCurveTo(px + s * .5, py - s, px + s, py - s * .4, px, py + s * .3); ctx.fill(); };
    heart(cx - 62, cy + 6, 46, a); heart(cx + 28, cy - 6, 62, b); heart(cx + 88, cy + 20, 30, c); for (const [px, py] of [[34, 28], [w - 34, 30], [60, h - 26], [w - 50, h - 24]]) dot(px, py, 8, c);
  } else if (motif === 3) { // swallows
    ctx.fillStyle = a; for (const [px, py, s] of [[cx - 60, cy - 14, 1.2], [cx + 20, cy + 14, .9], [cx + 80, cy - 26, .7]]) { ctx.beginPath(); ctx.moveTo(px - 38 * s, py - 12 * s); ctx.quadraticCurveTo(px - 8 * s, py - 6 * s, px, py + 8 * s); ctx.quadraticCurveTo(px + 8 * s, py - 6 * s, px + 38 * s, py - 12 * s); ctx.quadraticCurveTo(px + 12 * s, py + 12 * s, px + 6 * s, py + 16 * s); ctx.lineTo(px + 2 * s, py + 34 * s); ctx.lineTo(px - 4 * s, py + 16 * s); ctx.quadraticCurveTo(px - 12 * s, py + 12 * s, px - 38 * s, py - 12 * s); ctx.fill(); }
    ctx.fillStyle = b; ctx.fillRect(10, h - 22, w - 20, 8);
  } else if (motif === 4) { // a spiral
    ctx.strokeStyle = a; ctx.lineWidth = 8; ctx.beginPath(); for (let t = 0; t < 22; t += .15) { const r = 3 + t * 2.7, ang = t, px = cx + Math.cos(ang) * r * 1.35, py = cy + Math.sin(ang) * r * .95; t === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py); } ctx.stroke(); dot(cx, cy, 8, b); dot(36, 30, 10, c); dot(w - 36, h - 30, 10, c);
  } else if (motif === 5) { // a cat
    ctx.fillStyle = a; ctx.beginPath(); ctx.ellipse(cx, cy + 14, 64, 52, 0, 0, Math.PI * 2); ctx.fill(); for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(cx + s * 24, cy - 30); ctx.lineTo(cx + s * 60, cy - 78); ctx.lineTo(cx + s * 66, cy - 18); ctx.fill(); }
    dot(cx - 26, cy + 4, 12, c); dot(cx + 26, cy + 4, 12, c); dot(cx - 26, cy + 4, 5, '#101010'); dot(cx + 26, cy + 4, 5, '#101010'); ctx.fillStyle = '#e88aa0'; ctx.beginPath(); ctx.moveTo(cx - 8, cy + 24); ctx.lineTo(cx + 8, cy + 24); ctx.lineTo(cx, cy + 34); ctx.fill(); ctx.strokeStyle = bg; ctx.lineWidth = 3; for (const s of [-1, 1]) for (const k of [-6, 6]) { ctx.beginPath(); ctx.moveTo(cx + s * 30, cy + 30 + k); ctx.lineTo(cx + s * 84, cy + 30 + k * 2.4); ctx.stroke(); }
  } else if (motif === 6) { // a sun over waves
    dot(cx, cy - 4, 44, c); ctx.strokeStyle = c; ctx.lineWidth = 7; for (let i = 0; i < 12; i++) { const a2 = i / 12 * Math.PI * 2; ctx.beginPath(); ctx.moveTo(cx + Math.cos(a2) * 54, cy - 4 + Math.sin(a2) * 54); ctx.lineTo(cx + Math.cos(a2) * 74, cy - 4 + Math.sin(a2) * 74); ctx.stroke(); }
    ctx.fillStyle = b; for (let r = 0; r < 3; r++) { ctx.beginPath(); ctx.moveTo(0, h - 8 - r * 14); for (let px = 0; px <= w; px += 8) ctx.lineTo(px, h - 8 - r * 14 + Math.sin(px / 14 + r) * 5); ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.fill(); ctx.fillStyle = r % 2 ? b : a; }
  } else { // stripes and blocks
    for (let i = 0; i < 7; i++) { ctx.fillStyle = [a, b, c][i % 3]; ctx.fillRect(14 + i * 34, 16 + (i % 2) * 20, 26, h - 32 - (i % 2) * 20); } dot(cx, cy, 26, bg); dot(cx, cy, 14, a);
  }
  ctx.restore();
}

/** The text atlas: a canvas of fixed slots, painted on demand. */
export class SlotAtlas {
  constructor(width, height, slotW, slotH, anisotropy = 4) {
    this.canvas = document.createElement('canvas'); this.canvas.width = width; this.canvas.height = height; this.ctx = this.canvas.getContext('2d');
    this.cols = Math.floor(width / slotW); this.rows = Math.floor(height / slotH); this.slotW = slotW; this.slotH = slotH; this.width = width; this.height = height;
    this.slots = new Map(); this.free = []; for (let i = this.cols * this.rows - 1; i >= 0; i--) this.free.push(i); this.dirty = false;
    this.texture = new THREE.CanvasTexture(this.canvas); this.texture.colorSpace = THREE.SRGBColorSpace; this.texture.generateMipmaps = true; this.texture.minFilter = THREE.LinearMipmapLinearFilter; this.texture.magFilter = THREE.LinearFilter; this.texture.anisotropy = anisotropy; this.texture.flipY = false;
  }
  get capacity() { return this.cols * this.rows; }
  /** Slot of `key`, painted by `paint(ctx, x, y, w, h)` the first time; null when the atlas is full (the caller drops that sign this round). */
  slot(key, paint) {
    let s = this.slots.get(key); if (s) return s;
    if (!this.free.length) return null;
    const i = this.free.pop(), x = (i % this.cols) * this.slotW, y = Math.floor(i / this.cols) * this.slotH; paint(this.ctx, x, y, this.slotW, this.slotH);
    s = { i, rect: [(x + 1) / this.width, (y + 1) / this.height, (this.slotW - 2) / this.width, (this.slotH - 2) / this.height] }; this.slots.set(key, s); this.dirty = true; return s;
  }
  /** Forget every sign not in `keep` (a Set of keys) so their slots can be repainted. */
  prune(keep) { for (const [k, s] of this.slots) if (!keep.has(k)) { this.slots.delete(k); this.free.push(s.i); } }
  flush() { if (this.dirty) { this.texture.needsUpdate = true; this.dirty = false; } }
  dispose() { this.texture.dispose(); this.slots.clear(); }
}

const VERTEX = `attribute vec4 aUV;varying vec2 vUv;varying float vD;
void main(){vUv=aUV.xy+vec2(uv.x,1.-uv.y)*aUV.zw;vec4 mv=modelViewMatrix*instanceMatrix*vec4(position,1.);vD=-mv.z;gl_Position=projectionMatrix*mv;}`;
const FRAGMENT = `uniform sampler2D map;uniform float uFar;uniform float uShade;varying vec2 vUv;varying float vD;
void main(){float f=smoothstep(uFar-${SIGN_LIMITS.fade}.,uFar,vD);if(f>.001){float b=fract(52.9829189*fract(dot(gl_FragCoord.xy,vec2(.06711056,.00583715))));if(f>b)discard;}
vec4 c=texture2D(map,vUv,-.4);gl_FragColor=vec4(c.rgb*uShade,1.);}`;
function quadMaterial(texture, far) {
  return new THREE.ShaderMaterial({ vertexShader: VERTEX, fragmentShader: FRAGMENT, uniforms: { map: { value: texture }, uFar: { value: far }, uShade: { value: .94 } }, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, side: THREE.FrontSide, fog: false });
}

export class AthensSigns {
  /** `parent`: the group in absolute world metres (the rebased detail root). */
  constructor(parent, { enabled = true } = {}) {
    this.enabled = enabled; this.tiles = new Map(); this.pois = null; this.last = { x: Infinity, z: Infinity }; this.stats = { signs: 0, murals: 0, drawCalls: 0, rebuilds: 0, slotsUsed: 0 };
    this.group = new THREE.Group(); this.group.name = 'athens-signs'; this.group.visible = enabled; parent.add(this.group);
    this.atlas = new SlotAtlas(SLOT.atlasW, SLOT.atlasH, SLOT.w, SLOT.h, 4); this.art = STREET_ART.murals ? new SlotAtlas(ART_SLOT.atlas, ART_SLOT.atlas, ART_SLOT.w, ART_SLOT.h, 4) : null;
    const quad = new THREE.PlaneGeometry(1, 1);
    const make = (atlas, count, far, name) => {
      const geometry = quad.clone(), uv = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4); uv.setUsage(THREE.DynamicDrawUsage); geometry.setAttribute('aUV', uv);
      const mesh = new THREE.InstancedMesh(geometry, quadMaterial(atlas.texture, far), count); mesh.count = 0; mesh.visible = false; mesh.frustumCulled = false; mesh.name = name; mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.group.add(mesh); return { mesh, uv, count };
    };
    this.signMesh = make(this.atlas, SIGN_LIMITS.signs, SIGN_LIMITS.near, 'athens-signs:text'); this.muralMesh = this.art ? make(this.art, SIGN_LIMITS.murals, SIGN_LIMITS.nearArt, 'athens-signs:murals') : null;
    if (this.art) { for (let n = 0; n < 24; n++) this.art.slot('mural:' + n, (ctx, x, y, w, h) => paintMural(ctx, x, y, w, h, n)); this.art.flush(); }
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._e = new THREE.Euler(); this._p = new THREE.Vector3(); this._s = new THREE.Vector3();
  }
  /** Fetch assets/athens/pois.json (named shops and amenities); tiles read before it arrives are matched when it does. */
  async load(url) {
    const r = await fetch(url); if (!r.ok) throw new Error('Athens shop names are not hosted on this server');
    const j = await r.json(), grid = new Map(), u = j.unit || 1;
    for (let i = 0; i < j.rows.length; i += 4) { const x = j.rows[i] * u, z = j.rows[i + 1] * u, k = Math.floor(x / 32) * 4096 + Math.floor(z / 32); (grid.get(k) || grid.set(k, []).get(k)).push({ x, z, kind: j.rows[i + 2], name: j.names[j.rows[i + 3]] }); }
    this.pois = grid; for (const t of this.tiles.values()) t.signs = null; this.last.x = Infinity;
  }
  poiNear(x, z, r = 15) { if (!this.pois) return null; let best = null, bd = r; for (let gx = Math.floor((x - r) / 32); gx <= Math.floor((x + r) / 32); gx++) for (let gz = Math.floor((z - r) / 32); gz <= Math.floor((z + r) / 32); gz++) for (const p of this.pois.get(gx * 4096 + gz) || []) { const d = Math.hypot(p.x - x, p.z - z); if (d < bd && !p.taken) { bd = d; best = p; } } return best; }
  addTile(key, packet) {
    this.removeTile(key);
    const ext = packet.metadata.extensions?.worldDetail, o = packet.metadata.origin; if (!ext) return;
    const rows = k => (ext[k] != null ? packet.arrays[ext[k]] : null);
    this.tiles.set(key, { o, plates: rows('streetPlates'), names: ext.plateNames || [], shops: rows('shopSites'), walls: rows('wallSites'), signs: null, murals: null }); this.last.x = Infinity;
  }
  removeTile(key) { const t = this.tiles.get(key); if (t) { for (const p of t.taken || []) p.taken = false; this.tiles.delete(key); this.last.x = Infinity; } }
  setEnabled(on) { if (this.enabled === on) return; this.enabled = on; this.group.visible = on; this.last.x = Infinity; }
  /** The sign and mural records of a tile (absolute metres), made once. */
  records(t) {
    if (t.signs) return t;
    const [ox, , oz] = t.o, signs = [], murals = [], signed = new Set(); t.taken = [];
    if (t.plates) for (let i = 0; i < t.plates.length; i += 7) { const w = t.plates[i + 4]; signs.push({ x: t.plates[i] + ox, y: t.plates[i + 1], z: t.plates[i + 2] + oz, yaw: t.plates[i + 3], w, h: w / 4, key: 'plate:' + t.names[t.plates[i + 5]], spec: { plate: true, text: signText(t.names[t.plates[i + 5]]) } }); }
    if (t.shops) for (let i = 0; i < t.shops.length; i += 7) {
      const x = t.shops[i] + ox, z = t.shops[i + 1] + oz, len = t.shops[i + 3], flags = t.shops[i + 5] | 0, hash = t.shops[i + 6] | 0, style = flags & 15, poi = this.poiNear(x, z);
      let text, kind;
      if (poi) { poi.taken = true; t.taken.push(poi); text = signText(poi.name); kind = poi.kind; }
      else { if ((hash % 1000) / 1000 >= (STYLE_SIGN[style] ?? .4)) continue; const g = GENERIC[((hash >>> 4) + (flags & 32 ? 1 : 3) * 7) % (flags & 32 ? 12 : GENERIC.length)]; text = g[0]; kind = g[1]; }
      const chars = text.length, w = Math.max(1.2, Math.min(len - .6, 4.2, .2 * chars + .9)), variant = (hash >>> 8) % 3;
      signs.push({ x, y: t.shops[i + 4] + 2.6, z, yaw: t.shops[i + 2], w, h: w / 4, key: `shop:${kind}:${variant}:${text}`, spec: { kind, text, variant } }); signed.add(Math.round((t.shops[i]) * 10) + ':' + Math.round(t.shops[i + 1] * 10));
    }
    if (t.walls) for (let i = 0; i < t.walls.length; i += 7) {
      const flags = t.walls[i + 5] | 0, hash = t.walls[i + 6] | 0, art = flags & 16, p = art ? .42 : flags & 32 ? .07 : .04; if ((hash % 1000) / 1000 >= p) continue;
      if ((flags & 128) && signed.has(Math.round(t.walls[i] * 10) + ':' + Math.round(t.walls[i + 1] * 10))) continue; // the shop sign has this wall
      const len = t.walls[i + 3], w = Math.min(len - .8, art ? 3.6 + (hash >>> 5) % 24 / 10 : 2.6 + (hash >>> 5) % 12 / 10, 6), h = w / 2, design = (hash >>> 9) % 24;
      murals.push({ x: t.walls[i] + ox, y: t.walls[i + 4] + .25 + h / 2, z: t.walls[i + 1] + oz, yaw: t.walls[i + 2], w, h, key: 'mural:' + design });
    }
    t.signs = signs; t.murals = murals; return t;
  }
  update(camera) {
    if (!this.enabled) return; const p = camera.position || camera;
    if (Math.hypot(p.x - this.last.x, p.z - this.last.z) >= SIGN_LIMITS.rebuildMetres) this.rebuild(p.x, p.z);
  }
  rebuild(x, z) {
    const near = (list, far) => { const out = []; for (const r of list) { const d = Math.hypot(r.x - x, r.z - z); if (d < far) out.push({ r, d }); } return out.sort((a, b) => a.d - b.d); };
    const signs = [], murals = []; for (const t of this.tiles.values()) { this.records(t); for (const r of t.signs) signs.push(r); for (const r of t.murals) murals.push(r); }
    const S = near(signs, SIGN_LIMITS.near), A = this.art ? near(murals, SIGN_LIMITS.nearArt) : [];
    // slots: the signs in range keep theirs; the atlas is cleared of the others when it runs out
    const keep = new Set(S.map(e => e.r.key)); if (this.atlas.free.length < 8) this.atlas.prune(keep);
    const M = this._m, Q = this._q, E = this._e, V = this._p, Sc = this._s;
    const fill = (target, list, atlas, limit, paint) => {
      let n = 0;
      for (const { r } of list) {
        if (n >= limit) break; const slot = atlas.slot(r.key, (ctx, sx, sy, sw, sh) => paint(ctx, sx, sy, sw, sh, r)); if (!slot) continue;
        M.compose(V.set(r.x, r.y, r.z), Q.setFromEuler(E.set(0, r.yaw, 0)), Sc.set(r.w, r.h, 1)); target.mesh.setMatrixAt(n, M); target.uv.set(slot.rect, n * 4); n++;
      }
      target.mesh.count = n; target.mesh.visible = n > 0; if (n) { target.mesh.instanceMatrix.needsUpdate = true; target.uv.needsUpdate = true; } atlas.flush(); return n;
    };
    const ns = fill(this.signMesh, S, this.atlas, SIGN_LIMITS.signs, (ctx, sx, sy, sw, sh, r) => paintSign(ctx, sx, sy, sw, sh, r.spec)), nm = this.art ? fill(this.muralMesh, A, this.art, SIGN_LIMITS.murals, () => {}) : 0;
    this.last = { x, z }; this.stats = { signs: ns, murals: nm, drawCalls: (ns > 0) + (nm > 0), rebuilds: this.stats.rebuilds + 1, slotsUsed: this.atlas.slots.size };
  }
  dispose() { this.group.removeFromParent(); for (const m of [this.signMesh, this.muralMesh]) if (m) { m.mesh.geometry.dispose(); m.mesh.material.dispose(); m.mesh.dispose(); } this.atlas.dispose(); this.art?.dispose(); this.tiles.clear(); }
}
