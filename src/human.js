// Human figures for the crowd: an articulated body (pelvis, torso, neck, head, upper/lower arms, hands,
// thighs, shins, shoes) with lathe-turned limbs at real-world proportions, drawn as one InstancedMesh per
// body part so a whole crowd costs ~25 draw calls. Poses (walk/run cycles, idles, sitting, lying, swimming,
// cartoon dives) are plain numbers turned into bone matrices each frame.
import * as THREE from 'three';
import { trimMat } from './cockpit.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { lerp, clamp } from './util.js';

const V2 = THREE.Vector2;
// reference body (1.75 m adult), metres
export const HIP_Y = 0.96;
const THIGH = 0.44, SHIN = 0.42, ANKLE = 0.08, UARM = 0.29, FARM = 0.25;
const SH_X = 0.2, SH_Y = 0.445, HIP_X = 0.09;

// ------------------------------------------------------------------ geometry
function lathe(prof, seg) { return new THREE.LatheGeometry(prof.map(([r, y]) => new V2(Math.max(0, r), y)), seg); }
/** a limb hanging from its joint at the origin down -y, tapered with an optional muscle bulge */
function limb(L, r0, r1, bulge = 0, at = 0.3, seg = 9, flat = 1) {
  const p = [];
  for (let k = 0; k <= 2; k++) { const a = k / 2 * Math.PI / 2; p.push([Math.sin(a) * r1, -L - Math.cos(a) * r1 * 0.6]); }
  for (let i = 6; i >= 1; i--) { const t = i / 7; p.push([lerp(r0, r1, t) + bulge * Math.exp(-(((t - at) / 0.22) ** 2)), -t * L]); }
  for (let k = 0; k <= 2; k++) { const a = k / 2 * Math.PI / 2; p.push([Math.cos(a) * r0, Math.sin(a) * r0 * 0.6]); }
  const g = lathe(p, seg); if (flat !== 1) g.scale(1, 1, flat); return g;
}
function colorize(g, c) { const n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) { a[i * 3] = c[0]; a[i * 3 + 1] = c[1]; a[i * 3 + 2] = c[2]; } g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g; }
function clean(g) { const o = g.index ? g.toNonIndexed() : g; for (const k of Object.keys(o.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) o.deleteAttribute(k); if (!o.attributes.uv) o.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(o.attributes.position.count * 2), 2)); return o; }
function merge(list) { return mergeGeometries(list.map(clean)); }
function deform(g, fn) { const p = g.attributes.position, v = new THREE.Vector3(); for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); fn(v); p.setXYZ(i, v.x, v.y, v.z); } g.computeVertexNormals(); return g; }

function torsoGeo(female) {
  const prof = female
    ? [[0, -0.03], [0.118, -0.005], [0.112, 0.06], [0.122, 0.14], [0.142, 0.22], [0.148, 0.28], [0.14, 0.34], [0.148, 0.4], [0.138, 0.45], [0.1, 0.495], [0.05, 0.515], [0, 0.52]]
    : [[0, -0.03], [0.13, -0.005], [0.13, 0.07], [0.142, 0.16], [0.158, 0.26], [0.166, 0.34], [0.17, 0.4], [0.158, 0.455], [0.11, 0.5], [0.05, 0.52], [0, 0.525]];
  const g = lathe(prof, 14);
  g.scale(female ? 1.08 : 1.13, 1, female ? 0.66 : 0.64);
  return deform(g, (v) => {
    // flatter back, chest forward, shoulder slope
    if (v.z < 0) v.z *= 0.88;
    if (female && v.z > 0) v.z += 0.042 * Math.exp(-(((v.y - 0.29) / 0.055) ** 2)) * Math.exp(-(((Math.abs(v.x) - 0.06) / 0.07) ** 2));
    if (!female && v.z > 0) v.z += 0.012 * Math.exp(-(((v.y - 0.33) / 0.07) ** 2));
    if (v.y > 0.42) v.y -= Math.abs(v.x) * 0.25 * (v.y - 0.42) / 0.1;
  });
}
function pelvisGeo() {
  const g = lathe([[0, -0.11], [0.09, -0.1], [0.145, -0.055], [0.16, 0.0], [0.15, 0.05], [0.13, 0.085], [0, 0.095]], 14);
  g.scale(1, 1, 0.7); return g;
}
function headGeo() {
  const skin = [1, 1, 1], dark = [0.08, 0.07, 0.07], lip = [0.82, 0.55, 0.52], white = [1.6, 1.6, 1.6];
  const skull = new THREE.SphereGeometry(0.1, 16, 12);
  deform(skull, (v) => { v.x *= 0.88; v.y *= 1.12; if (v.y < 0) { v.x *= 1 - 0.32 * (-v.y / 0.11); v.z = v.z * (1 - 0.15 * (-v.y / 0.11)) + 0.012 * (-v.y / 0.11); } if (v.z < 0) v.z *= 1.06; });
  skull.translate(0, 0.1, 0);
  const parts = [colorize(skull, skin)];
  const nose = new THREE.ConeGeometry(0.017, 0.045, 8); nose.rotateX(Math.PI / 2 + 0.5); nose.translate(0, 0.09, 0.098); parts.push(colorize(nose, skin));
  for (const sx of [-1, 1]) {
    const ear = new THREE.SphereGeometry(0.022, 8, 6); ear.scale(0.45, 1.1, 0.8); ear.translate(sx * 0.087, 0.1, -0.005); parts.push(colorize(ear, skin));
    const eyeW = new THREE.SphereGeometry(0.0125, 8, 6); eyeW.scale(1.3, 0.8, 0.6); eyeW.translate(sx * 0.031, 0.118, 0.083); parts.push(colorize(eyeW, white));
    const eye = new THREE.SphereGeometry(0.0075, 6, 5); eye.translate(sx * 0.031, 0.118, 0.089); parts.push(colorize(eye, dark));
    const brow = new THREE.BoxGeometry(0.03, 0.006, 0.008); brow.rotateZ(sx * -0.12); brow.translate(sx * 0.032, 0.137, 0.088); parts.push(colorize(brow, dark));
  }
  const lips = new THREE.BoxGeometry(0.034, 0.008, 0.01); lips.translate(0, 0.052, 0.09); parts.push(colorize(lips, lip));
  return merge(parts);
}
function hairGeos() {
  const cap = () => { const g = new THREE.SphereGeometry(0.108, 14, 7, 0, Math.PI * 2, 0, Math.PI * 0.5); g.rotateX(-0.42); g.scale(0.93, 1.12, 1.03); g.translate(0, 0.104, -0.01); return g; };
  const back = () => { const g = new THREE.SphereGeometry(0.106, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.4); g.rotateX(-Math.PI * 0.62); g.scale(0.95, 1.1, 1.05); g.translate(0, 0.098, -0.014); return g; };
  const short = merge([cap(), back()]);
  const long = merge([cap(), back(), (() => { const g = new THREE.CapsuleGeometry(0.08, 0.17, 4, 10); g.scale(1.15, 1, 0.5); g.translate(0, -0.02, -0.065); return g; })()]);
  const bun = merge([cap(), back(), (() => { const g = new THREE.SphereGeometry(0.048, 10, 8); g.translate(0, 0.2, -0.075); return g; })()]);
  const pony = merge([cap(), back(), (() => { const g = new THREE.CapsuleGeometry(0.03, 0.14, 4, 8); g.rotateX(0.35); g.translate(0, 0.07, -0.13); return g; })()]);
  const curly = (() => { const g = new THREE.SphereGeometry(0.125, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.58); deform(g, (v) => { const n = 1 + 0.06 * Math.sin(v.x * 90) * Math.sin(v.y * 80) * Math.sin(v.z * 85); v.multiplyScalar(n); }); g.scale(1, 1.05, 1.05); g.translate(0, 0.1, -0.012); return g; })();
  return [short, long, bun, pony, curly];
}
function hatGeos() {
  const crown = () => { const g = new THREE.SphereGeometry(0.113, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.5); g.scale(0.95, 0.9, 1.05); g.translate(0, 0.12, -0.004); return g; };
  const brim = new THREE.CylinderGeometry(0.09, 0.09, 0.012, 14, 1, false, -Math.PI / 2, Math.PI); brim.scale(1, 1, 1.1); brim.translate(0, 0.13, 0.06);
  const cap = merge([crown(), brim]);
  const sunBrim = new THREE.CylinderGeometry(0.21, 0.22, 0.012, 22); sunBrim.translate(0, 0.15, 0);
  const sunCrown = new THREE.CylinderGeometry(0.085, 0.105, 0.11, 16); sunCrown.translate(0, 0.2, 0);
  const sun = merge([sunBrim, sunCrown, crown()]);
  const scarf = (() => { const g = new THREE.SphereGeometry(0.118, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.72); g.rotateX(-0.45); g.scale(0.95, 1.1, 1.05); g.translate(0, 0.1, -0.02); return g; })();
  return { cap, sun, scarf };
}
function glassesGeo() {
  const l = [];
  for (const sx of [-1, 1]) { const g = new THREE.BoxGeometry(0.036, 0.022, 0.006); g.translate(sx * 0.031, 0.118, 0.097); l.push(g); }
  const br = new THREE.BoxGeometry(0.03, 0.005, 0.005); br.translate(0, 0.122, 0.098); l.push(br);
  for (const sx of [-1, 1]) { const g = new THREE.BoxGeometry(0.004, 0.005, 0.09); g.translate(sx * 0.05, 0.12, 0.055); l.push(g); }
  return merge(l);
}
function handGeo() {
  const palm = new THREE.SphereGeometry(1, 8, 6); palm.scale(0.04, 0.075, 0.021); palm.translate(0, -0.065, 0.004);
  const thumb = new THREE.CapsuleGeometry(0.011, 0.035, 3, 6); thumb.rotateZ(0.4); thumb.translate(0.03, -0.045, 0.012);
  return merge([palm, thumb]);
}
function footGeo() {
  const g = new THREE.SphereGeometry(1, 10, 7); g.scale(0.048, 0.05, 0.135); g.translate(0, -0.035, 0.045);
  return deform(g, (v) => { if (v.y < -ANKLE) v.y = -ANKLE; if (v.z < -0.03) v.x *= 0.85; });
}
function skirtGeo() { const g = lathe([[0.26, -0.52], [0.25, -0.5], [0.215, -0.3], [0.185, -0.12], [0.168, 0.0], [0, 0.0]], 16); g.scale(1, 1, 0.85); return g; }
function cupGeo() {
  const c = new THREE.CylinderGeometry(0.042, 0.032, 0.15, 10); c.translate(0, -0.08, 0.035);
  const straw = new THREE.CylinderGeometry(0.004, 0.004, 0.12, 4); straw.rotateX(0.2); straw.translate(0.01, 0.02, 0.04);
  return merge([colorize(c, [1, 1, 1]), colorize(straw, [0.25, 0.9, 0.5])]);
}

// ------------------------------------------------------------------ looks
const C = (h) => new THREE.Color(h);
const SKIN = ['#f3d0b5', '#ecc3a2', '#e3b08c', '#d79f78', '#c78a63', '#b0754f', '#94603f', '#744832', '#f2b4a2'].map(C);
const HAIR = ['#14100d', '#241812', '#3a2617', '#56391f', '#7a5530', '#b48c5c', '#d8bb83', '#8a8a86', '#d4d2cc', '#7b301a'].map(C);
const TOPS = ['#f4f2ec', '#e6e1d4', '#1f2638', '#2d4a70', '#6c9dcc', '#b6d4ea', '#1b1b1d', '#b3372f', '#e8a13a', '#3d6a49', '#d4a3b3', '#f3d99c', '#76508a', '#d86b49', '#4aa2a4', '#ffffff', '#e7c6c4', '#9db99e', '#f6e7c8', '#2a6f97'].map(C);
const BOTTOMS = ['#2e3e5b', '#3b5276', '#c8b795', '#a49171', '#1c1c1f', '#e8e5db', '#5a5e66', '#24324c', '#7c6147', '#6d7f8f'].map(C);
const SHOES = ['#f1f1ee', '#1b1b1b', '#5a3a24', '#c9a27a', '#2d4b8a', '#d84a3a', '#e9e2d0'].map(C);
const SWIM = ['#e8452c', '#1f6fb4', '#f2c230', '#141414', '#2fae8f', '#e45a9a', '#f8f8f8', '#ff8a00', '#7a3fa0', '#0f8fbf'].map(C);
const DRESS = ['#f4f2ec', '#e9c46a', '#2a9d8f', '#e76f51', '#264653', '#c8a2c8', '#f4a6a6', '#1d3557', '#fefefe', '#bfd8f2', '#f1d3b3', '#d62828'].map(C);
const HATS = ['#f1ede2', '#1f2a44', '#b3372f', '#d8c49a', '#2e2e2e', '#f2f2f2', '#3d6a49'].map(C);

/** ctx: 'street' | 'beach' | 'cafe' */
export function makeLook(rng, ctx = 'street') {
  const female = rng.chance(0.5);
  const kid = ctx === 'beach' ? rng.chance(0.14) : rng.chance(0.04);
  const old = !kid && rng.chance(ctx === 'cafe' ? 0.22 : 0.12);
  const pick = (a) => rng.pick(a).clone();
  const skin = pick(SKIN);
  let h = female ? rng.range(1.56, 1.76) : rng.range(1.67, 1.92); if (kid) h = rng.range(1.05, 1.42); if (old) h -= 0.04;
  const L = {
    female, kid, old, h, k: h / 1.75, headS: kid ? 1.28 : 1, wT: rng.range(0.92, 1.12) * (old ? 1.05 : 1), dep: rng.range(0.95, old ? 1.3 : 1.18), wH: female ? rng.range(1.04, 1.16) : rng.range(0.94, 1.04), wL: rng.range(0.92, 1.12),
    hair: -1, hat: null, glasses: rng.chance(ctx === 'beach' ? 0.45 : 0.3), skirt: false, cup: !kid && rng.chance(ctx === 'cafe' ? 0.35 : 0.16),
    speed: old ? rng.range(0.75, 1.0) : kid ? rng.range(1.1, 1.5) : rng.range(1.15, 1.55), pitch: kid ? rng.range(1.7, 2.1) : female ? rng.range(1.35, 1.7) : rng.range(0.8, 1.1),
    col: {}, swim: false,
  };
  const c = L.col;
  c.skin = skin; c.hair = old ? pick(HAIR.slice(7, 9)) : pick(HAIR.slice(0, 7)); if (!old && rng.chance(0.06)) c.hair = HAIR[9].clone();
  c.shoe = pick(SHOES); c.cup = new THREE.Color('#c79a6b'); c.hat = pick(HATS); c.glasses = new THREE.Color('#121212');
  L.hair = female ? rng.pick([1, 1, 2, 3, 0, 4]) : (rng.chance(0.12) && !kid ? -1 : rng.pick([0, 0, 0, 4]));
  if (ctx === 'beach' && !old) {
    L.swim = true;
    const sw = pick(SWIM);
    c.top = female ? sw : skin.clone(); c.bottom = sw; c.thigh = skin.clone(); c.shin = skin.clone();
    c.sleeve = skin.clone(); c.fore = skin.clone(); c.shoe = rng.chance(0.5) ? skin.clone().multiplyScalar(0.95) : pick(SWIM);
    if (rng.chance(0.3)) L.hat = female ? 'sun' : 'cap';
    L.cup = false;
    return L;
  }
  c.top = pick(TOPS); c.bottom = pick(BOTTOMS);
  const sleeve = rng.next();
  c.sleeve = sleeve < 0.15 ? skin.clone() : c.top.clone(); c.fore = sleeve > 0.84 ? c.top.clone() : skin.clone();
  const shorts = rng.chance(old ? 0.15 : 0.45);
  c.thigh = c.bottom.clone(); c.shin = shorts ? skin.clone() : c.bottom.clone();
  if (female) {
    const r = rng.next();
    if (r < 0.35) { const d = pick(DRESS); c.top = d; c.bottom = d.clone(); c.skirt = d.clone(); L.skirt = true; c.sleeve = rng.chance(0.5) ? skin.clone() : d.clone(); c.fore = skin.clone(); c.thigh = skin.clone(); c.shin = skin.clone(); }
    else if (r < 0.55) { c.skirt = pick(DRESS); L.skirt = true; c.bottom = c.skirt.clone(); c.thigh = skin.clone(); c.shin = skin.clone(); }
    if (rng.chance(0.18)) L.hat = 'sun';
  } else if (rng.chance(0.18)) L.hat = 'cap';
  if (old && female && rng.chance(0.5)) { // the classic yiayia in black
    const blk = new THREE.Color('#1a1a1c'); c.top = blk; c.bottom = blk.clone(); c.skirt = blk.clone(); L.skirt = true; c.sleeve = blk.clone(); c.fore = blk.clone(); c.thigh = skin.clone(); c.shin = new THREE.Color('#2a2622'); c.shoe = blk.clone(); L.hat = 'scarf'; c.hat = blk.clone(); L.hair = 2;
  } else if (old && !female && rng.chance(0.5)) { c.top = new THREE.Color('#f2f0ea'); c.bottom = new THREE.Color('#5d5f63'); c.thigh = c.bottom.clone(); c.shin = c.bottom.clone(); L.hat = 'cap'; c.hat = new THREE.Color('#4b4136'); }
  if (kid) { c.top = pick(SWIM); c.bottom = pick(BOTTOMS); c.thigh = c.bottom.clone(); c.shin = skin.clone(); L.glasses = false; }
  return L;
}

// ------------------------------------------------------------------ pose
export function newPose() {
  return { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, pivot: HIP_Y, pelY: HIP_Y, pelYaw: 0, pelRoll: 0, tPitch: 0, tYaw: 0, tRoll: 0, hYaw: 0, hPitch: 0,
    hipA: [0, 0], hipR: [0, 0], knee: [0, 0], foot: [0, 0], shA: [0, 0], shR: [0.08, 0.08], elb: [0.15, 0.15], ground: true };
}
/** pelvis height that keeps the lower foot on the floor */
export function groundLegs(P) {
  let m = 0;
  for (let i = 0; i < 2; i++) {
    const a = P.hipA[i], s = a - P.knee[i], fw = s + P.foot[i];
    const ext = THIGH * Math.cos(a) + SHIN * Math.cos(s) + ANKLE + Math.max(0, -fw) * 0.15;
    if (ext > m) m = ext;
  }
  P.pelY = m + 0.02;
}
export function poseWalk(P, ph, amp = 1, run = false) {
  const A = run ? 0.72 : 0.4;
  for (let i = 0; i < 2; i++) {
    const p = ph + i * Math.PI, s = Math.sin(p), sw = Math.max(0, Math.cos(p + 0.5));
    const hip = A * amp * s + (run ? 0.18 : 0.02);
    const knee = amp * (run ? 0.3 + 1.55 * sw * sw : 0.07 + 0.95 * sw * sw + 0.1 * Math.max(0, Math.sin(p - 0.6)));
    const fw = amp * (0.2 * s - 0.6 * Math.max(0, -s) * sw * 1.4);
    P.hipA[i] = hip; P.knee[i] = knee; P.foot[i] = fw - (hip - knee); P.hipR[i] = 0.02;
    const as = -s;
    P.shA[i] = (run ? 0.75 : 0.34) * amp * as + (run ? 0.2 : 0.04);
    P.shR[i] = run ? 0.16 : 0.07;
    P.elb[i] = run ? 1.45 + 0.2 * as : 0.16 + 0.32 * amp * Math.max(0, as);
  }
  const sL = Math.sin(ph);
  P.pelYaw = -0.11 * amp * sL; P.tYaw = 0.2 * amp * sL; P.pelRoll = 0.035 * amp * Math.sin(ph); P.tRoll = -0.02 * amp * sL;
  P.tPitch = run ? 0.2 : 0.04; P.hYaw = -(P.pelYaw + P.tYaw) * 0.8; P.hPitch = run ? -0.15 : 0.02;
  groundLegs(P);
  if (run) P.pelY += 0.04 * Math.abs(Math.cos(ph));
}
export function poseStand(P, t, sd, variant = 'idle') {
  const sh = Math.sin(t * 0.55 + sd * 7);
  P.hipA[0] = 0.02 + 0.03 * sh; P.hipA[1] = 0.02 - 0.03 * sh; P.knee[0] = 0.05 + 0.08 * Math.max(0, sh); P.knee[1] = 0.05 + 0.08 * Math.max(0, -sh);
  P.foot[0] = -(P.hipA[0] - P.knee[0]); P.foot[1] = -(P.hipA[1] - P.knee[1]); P.hipR[0] = P.hipR[1] = 0.06;
  P.pelRoll = 0.04 * sh; P.pelYaw = 0; P.tRoll = -0.03 * sh; P.tYaw = 0; P.tPitch = 0.02 + 0.01 * Math.sin(t * 1.7);
  for (let i = 0; i < 2; i++) { P.shA[i] = 0.04 + 0.02 * Math.sin(t * 1.1 + i); P.shR[i] = 0.1; P.elb[i] = 0.14 + 0.04 * Math.sin(t * 0.9 + i * 2); }
  P.hYaw = 0.55 * Math.sin(t * 0.31 + sd * 3) * Math.sin(t * 0.13 + sd); P.hPitch = 0.05 * Math.sin(t * 0.4 + sd);
  if (variant === 'chat') { P.shA[1] = 0.55 + 0.25 * Math.sin(t * 2.9 + sd); P.shR[1] = 0.25; P.elb[1] = 1.25 + 0.45 * Math.sin(t * 4.1 + sd); P.hPitch += 0.08 * Math.sin(t * 5); }
  else if (variant === 'phone') { P.shA[1] = 0.32; P.shR[1] = 0.42; P.elb[1] = 2.55; P.hYaw *= 0.3; P.hPitch = 0.12; P.tRoll -= 0.04; }
  else if (variant === 'cross') { for (let i = 0; i < 2; i++) { P.shA[i] = 0.42; P.shR[i] = 0.04; P.elb[i] = 1.95; } }
  else if (variant === 'hips') { for (let i = 0; i < 2; i++) { P.shA[i] = -0.15; P.shR[i] = 0.55; P.elb[i] = 1.55; } }
  else if (variant === 'look') { P.hYaw = 0.9 * Math.sin(t * 0.8 + sd); }
  groundLegs(P);
}
export function poseSit(P, t, sd, chat = true) {
  for (let i = 0; i < 2; i++) { P.hipA[i] = 1.42 + (i ? 0.05 : -0.04); P.knee[i] = 1.42 + (i ? -0.1 : 0.08); P.foot[i] = 0; P.hipR[i] = 0.1; }
  P.pelY = 0.5; P.pelYaw = 0; P.pelRoll = 0; P.tPitch = -0.06 + 0.04 * Math.sin(t * 0.7 + sd); P.tYaw = 0; P.tRoll = 0;
  P.shA[0] = 0.55; P.shR[0] = 0.12; P.elb[0] = 1.05;
  P.shA[1] = chat ? 0.6 + 0.3 * Math.sin(t * 2.2 + sd) : 0.55; P.shR[1] = 0.15; P.elb[1] = chat ? 1.3 + 0.5 * Math.max(0, Math.sin(t * 1.3 + sd)) : 1.05;
  P.hYaw = 0.45 * Math.sin(t * 0.37 + sd * 5); P.hPitch = 0.05 * Math.sin(t * 3 + sd);
}
export function poseLie(P, t, sd) {
  for (let i = 0; i < 2; i++) { P.hipA[i] = 0; P.knee[i] = 0; P.foot[i] = -0.6; P.hipR[i] = 0.08; }
  if (sd > 0.5) { P.hipA[1] = 0.65; P.knee[1] = 1.25; P.foot[1] = 0.6; }
  P.pelY = HIP_Y; P.pelYaw = 0; P.pelRoll = 0; P.tPitch = -0.05; P.tYaw = 0; P.tRoll = 0;
  for (let i = 0; i < 2; i++) { if (sd > 0.3) { P.shA[i] = 2.75; P.shR[i] = 0.45; P.elb[i] = 2.1; } else { P.shA[i] = 0.0; P.shR[i] = 0.12; P.elb[i] = 0.1; } }
  P.hYaw = 0.3 * Math.sin(t * 0.2 + sd * 9); P.hPitch = -0.15;
}
export function poseSwim(P, t) {
  for (let i = 0; i < 2; i++) { const k = Math.sin(t * 7 + i * Math.PI); P.hipA[i] = -0.1 + 0.18 * k; P.knee[i] = 0.15 + 0.15 * Math.max(0, k); P.foot[i] = -0.9; P.hipR[i] = 0.05; }
  P.pelY = HIP_Y; P.tPitch = 0; P.tYaw = 0.2 * Math.sin(t * 2.2); P.tRoll = 0; P.pelYaw = 0; P.pelRoll = 0;
  for (let i = 0; i < 2; i++) { P.shA[i] = (t * 2.2 + i * Math.PI) % (Math.PI * 2); P.shR[i] = 0.2; P.elb[i] = 0.4; }
  P.hYaw = 0.35 * Math.sin(t * 2.2); P.hPitch = -0.95;
}
/** overlays on top of a base pose */
export function armsPanic(P, t) { for (let i = 0; i < 2; i++) { const w = Math.sin(t * 15 + i * 2.1); P.shR[i] = 2.45 + 0.3 * w; P.shA[i] = 0.35 + 0.2 * w; P.elb[i] = 0.55 + 0.4 * Math.sin(t * 15 + i); } P.hPitch = -0.12; }
export function armsFist(P, t) { P.shA[1] = 2.2 + 0.25 * Math.sin(t * 13); P.shR[1] = 0.28; P.elb[1] = 1.0 + 0.35 * Math.sin(t * 13); P.shA[0] = -0.15; P.shR[0] = 0.55; P.elb[0] = 1.55; P.tPitch += 0.06; }
export function armsWave(P, t) { P.shR[1] = 2.65; P.shA[1] = 0.25; P.elb[1] = 0.45 + 0.4 * Math.sin(t * 10); }
export function starfish(P, t) {
  for (let i = 0; i < 2; i++) { P.hipA[i] = 0.25 * Math.sin(t * 9 + i * 3); P.hipR[i] = 0.55; P.knee[i] = 0.35; P.foot[i] = -0.3; P.shR[i] = 2.35 + 0.35 * Math.sin(t * 18 + i); P.shA[i] = 0.2; P.elb[i] = 0.3; }
  P.pelY = HIP_Y; P.tPitch = -0.1; P.hPitch = -0.2;
}

// ------------------------------------------------------------------ the crowd renderer
// Every frame the visible people are packed into the instance buffers (begin / draw... / end), so each
// part only ever draws as many instances as there are people using it.
const SHADOW = new Set(['pelvis', 'torsoM', 'torsoF', 'head', 'thigh', 'shin', 'skirt', 'uarm', 'hair1']);
export class Crowd {
  constructor(scene, max) {
    this.max = max;
    // woven fabric (micro-normal + sheen) for clothes, a softer sheen for skin; colours come per instance
    const mat = trimMat('#ffffff', { rough: 0.85, scale: 0.025, nk: 0.55, sheen: 0.22 });
    const skinM = trimMat('#ffffff', { rough: 0.5, scale: 0.02, nk: 0.15, sheen: 0.1 });
    const matV = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, metalness: 0, vertexColors: true });
    const hairM = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0.05 });
    const glassM = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.1, metalness: 0.6 });
    const hair = hairGeos(), hats = hatGeos();
    const def = {
      pelvis: [pelvisGeo(), mat, 1], torsoM: [torsoGeo(false), mat, 1], torsoF: [torsoGeo(true), mat, 1],
      neck: [limb(0.1, 0.05, 0.055, 0, 0.5, 8), skinM, 1], head: [headGeo(), matV, 1],
      hair0: [hair[0], hairM, 1], hair1: [hair[1], hairM, 1], hair2: [hair[2], hairM, 1], hair3: [hair[3], hairM, 1], hair4: [hair[4], hairM, 1],
      cap: [hats.cap, mat, 1], sun: [hats.sun, mat, 1], scarf: [hats.scarf, mat, 1], glasses: [glassesGeo(), glassM, 1], skirt: [skirtGeo(), mat, 1], cup: [cupGeo(), matV, 1],
      uarm: [limb(UARM, 0.05, 0.04, 0.008, 0.3, 8), mat, 2], farm: [limb(FARM, 0.041, 0.03, 0.006, 0.25, 7), mat, 2], hand: [handGeo(), skinM, 2],
      thigh: [limb(THIGH, 0.082, 0.052, 0.006, 0.25, 9), mat, 2], shin: [limb(SHIN, 0.054, 0.035, 0.012, 0.28, 8), mat, 2], foot: [footGeo(), mat, 2],
    };
    this.parts = {};
    for (const [name, [geo, m, mult]] of Object.entries(def)) {
      const im = new THREE.InstancedMesh(geo, m, max * mult);
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.setColorAt(0, new THREE.Color(1, 1, 1)); im.instanceColor.setUsage(THREE.DynamicDrawUsage);
      im.frustumCulled = false; im.castShadow = SHADOW.has(name); im.receiveShadow = true;
      im.count = 0;
      scene.add(im);
      this.parts[name] = { im, mult, n: 0 };
    }
    this.W0 = new THREE.Matrix4(); this.Wp = new THREE.Matrix4(); this.Wt = new THREE.Matrix4(); this.Ws = new THREE.Matrix4(); this.Wf = new THREE.Matrix4();
    this.Wto = new THREE.Matrix4(); this.Wn = new THREE.Matrix4(); this.Wh = new THREE.Matrix4(); this.Wa = new THREE.Matrix4(); this.Wfa = new THREE.Matrix4(); this.Wha = new THREE.Matrix4();
    this.T = new THREE.Matrix4(); this.O = new THREE.Matrix4(); this.E = new THREE.Euler(); this.S = new THREE.Vector3();
  }
  /** which parts a look uses (cached on the look) */
  uses(L) {
    if (L.u) return L.u;
    const u = { torso: L.female ? 'torsoF' : 'torsoM', hair: L.hair >= 0 && L.hat !== 'scarf' ? 'hair' + L.hair : null, hat: L.hat, glasses: L.glasses, skirt: L.skirt, cup: L.cup };
    if (L.hat === 'cap' && L.hair === 1) u.hair = 'hair0';
    return (L.u = u);
  }
  begin() { for (const p of Object.values(this.parts)) p.n = 0; }
  _bone(out, parent, x, y, z, rx, ry, rz, order) { this.E.set(rx, ry, rz, order); this.T.makeRotationFromEuler(this.E); this.T.setPosition(x, y, z); out.multiplyMatrices(parent, this.T); return out; }
  _put(name, i, M, col, sx = 1, sy = 1, sz = 1) {
    const p = this.parts[name], idx = p.n * p.mult + i;
    this.O.copy(M); if (sx !== 1 || sy !== 1 || sz !== 1) this.O.scale(this.S.set(sx, sy, sz));
    p.im.setMatrixAt(idx, this.O); p.im.setColorAt(idx, col);
    if (i === p.mult - 1) p.n++;
  }
  draw(P, L) {
    const u = this.uses(L), c = L.col;
    const k = L.k, pv = P.pivot * k;
    // root: rotate about the pivot (hips) so lying / flipping bodies turn around their centre
    this.E.set(P.pitch, P.yaw, P.roll, 'YZX');
    const W0 = this.W0.makeRotationFromEuler(this.E);
    const e = W0.elements;
    const tx = P.x - e[4] * pv, ty = P.y + pv - e[5] * pv, tz = P.z - e[6] * pv;
    W0.scale(this.S.set(k, k, k)); W0.setPosition(tx, ty, tz);
    const Wp = this._bone(this.Wp, W0, 0, P.pelY, 0, 0, P.pelYaw, P.pelRoll, 'YXZ');
    this._put('pelvis', 0, Wp, c.bottom, L.wH, 1, L.wH);
    if (u.skirt) this._put('skirt', 0, this._bone(this.Wt, Wp, 0, 0.075, 0, 0.04 + (P.hipA[0] + P.hipA[1]) * 0.25, 0, 0, 'XYZ'), c.skirt, L.wH * 0.95, 1, L.wH * 0.95);
    for (let i = 0; i < 2; i++) {
      const sx = i === 0 ? 1 : -1;
      const Wt = this._bone(this.Wt, Wp, sx * HIP_X * L.wH, -0.02, 0, -P.hipA[i], 0, sx * P.hipR[i], 'ZXY');
      this._put('thigh', i, Wt, c.thigh, L.wL, 1, L.wL);
      const Ws = this._bone(this.Ws, Wt, 0, -THIGH, 0, P.knee[i], 0, 0, 'XYZ');
      this._put('shin', i, Ws, c.shin, L.wL, 1, L.wL);
      const Wf = this._bone(this.Wf, Ws, 0, -SHIN, 0, -P.foot[i], 0, 0, 'XYZ');
      this._put('foot', i, Wf, c.shoe);
    }
    const Wto = this._bone(this.Wto, Wp, 0, 0.075, 0, P.tPitch, P.tYaw, P.tRoll, 'YXZ');
    this._put(u.torso, 0, Wto, c.top, L.wT, 1, L.wT * L.dep);
    const Wn = this._bone(this.Wn, Wto, 0, 0.475, 0.004, P.hPitch * 0.35, P.hYaw * 0.3, 0, 'YXZ');
    this._put('neck', 0, this._bone(this.Wfa, Wn, 0, 0.075, 0, 0, 0, 0, 'XYZ'), c.skin, L.headS > 1 ? 1.1 : 1, 1, 1);
    const hs = L.headS;
    const Wh = this._bone(this.Wh, Wn, 0, 0.045, 0.01, P.hPitch * 0.65, P.hYaw * 0.7, 0, 'YXZ');
    if (hs !== 1) Wh.scale(this.S.set(hs, hs, hs));
    this._put('head', 0, Wh, c.skin);
    if (u.hair) this._put(u.hair, 0, Wh, c.hair);
    if (u.hat) this._put(u.hat, 0, Wh, c.hat);
    if (u.glasses) this._put('glasses', 0, Wh, c.glasses);
    for (let i = 0; i < 2; i++) {
      const sx = i === 0 ? 1 : -1;
      const Wa = this._bone(this.Wa, Wto, sx * SH_X * L.wT, SH_Y, -0.005, -P.shA[i], 0, sx * P.shR[i], 'ZXY');
      this._put('uarm', i, Wa, c.sleeve, L.wL, 1, L.wL);
      const Wfa = this._bone(this.Wfa, Wa, 0, -UARM, 0, -P.elb[i], 0, 0, 'XYZ');
      this._put('farm', i, Wfa, c.fore, L.wL, 1, L.wL);
      const Wha = this._bone(this.Wha, Wfa, 0, -FARM, 0, 0, sx * 0.25, 0, 'XYZ');
      this._put('hand', i, Wha, c.skin);
      if (i === 1 && u.cup) this._put('cup', 0, Wha, c.cup);
    }
  }
  end() {
    for (const p of Object.values(this.parts)) {
      p.im.count = p.n;
      if (p.n) { p.im.instanceMatrix.needsUpdate = true; p.im.instanceColor.needsUpdate = true; p.im.instanceMatrix.clearUpdateRanges(); p.im.instanceMatrix.addUpdateRange(0, p.n * p.mult * 16); p.im.instanceColor.clearUpdateRanges(); p.im.instanceColor.addUpdateRange(0, p.n * p.mult * 3); }
    }
  }
}
