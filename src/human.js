import { assertWorldBudget } from './world-art-direction.js';
// Pedestrians use a single skinned mesh nearby, articulated instanced parts at
// medium distance, and a four-batch silhouette LOD beyond 58 metres. Appearance
// is seeded; the 16-bone skeleton shares the pose API used by the people system.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { lerp, clamp, RNG } from './util.js';

// reference body (1.75 m adult), metres
export const HIP_Y = 0.96;
const THIGH = 0.44, SHIN = 0.42, ANKLE = 0.08, UARM = 0.29, FARM = 0.25;
const SH_X = 0.2, SH_Y = 0.445, HIP_X = 0.09;

// Block silhouettes preserve the existing pose and ragdoll joints.
function block(w,h,d,x=0,y=0,z=0){return new THREE.BoxGeometry(w,h,d).translate(x,y,z);}
function colorize(g,c){const a=new Float32Array(g.attributes.position.count*3);for(let i=0;i<a.length;i+=3)a.set(c,i);g.setAttribute('color',new THREE.BufferAttribute(a,3));return g;}
function clean(g){const o=g.index?g.toNonIndexed():g;for(const k of Object.keys(o.attributes))if(!['position','normal','uv','color'].includes(k))o.deleteAttribute(k);return o;}
function merge(list){return mergeGeometries(list.map(clean));}
function deform(g,fn){const p=g.attributes.position,v=new THREE.Vector3();for(let i=0;i<p.count;i++){v.fromBufferAttribute(p,i);fn(v);p.setXYZ(i,v.x,v.y,v.z);}g.computeVertexNormals();return g;}
function limb(L,r0,r1,bulge=0,at=.3,seg=4,flat=1){return block(r0*2,L,r0*2*flat,0,-L/2,0);}
function torsoGeo(female){return block(female?.29:.34,.5,.20,0,.25,0);}
function pelvisGeo(){return block(.29,.19,.2);}
function headGeo(){return colorize(block(.18,.22,.19,0,.10,0),[1,1,1]);}
function hairGeos(){return Array.from({length:5},(_,i)=>block(.19,i===1?.20:.07,.20,0,i===1?.08:.19,-.015));}
function hatGeos(){return {cap:block(.22,.08,.25,0,.23,.025),sun:block(.35,.06,.35,0,.23,0),scarf:block(.22,.23,.22,0,.10,-.02)};}
function glassesGeo(){return block(.13,.025,.008,0,.12,.10);}
function handGeo(){return block(.06,.085,.035,0,-.035,0);}
function footGeo(){return block(.095,.08,.23,0,-.035,.045);}
function cupGeo(){return colorize(block(.07,.13,.07,0,-.08,.035),[1,1,1]);}
function skirtGeo(){return block(.34,.42,.24,0,-.17,0);}

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

/** ctx: street, beach, cafe, jogger, cyclist, child or elder. */
export function makeLook(rng, ctx = 'street') {
  const female = rng.chance(0.5);
  const active = ctx === 'jogger' || ctx === 'cyclist';
  const kid = !active && ctx !== 'elder' && (ctx === 'child' || (ctx === 'beach' ? rng.chance(0.14) : rng.chance(0.04)));
  const old = !kid && !active && (ctx === 'elder' || rng.chance(ctx === 'cafe' ? 0.22 : 0.12));
  const pick = (a) => rng.pick(a).clone();
  const skin = pick(SKIN);
  let h = female ? rng.range(1.56, 1.76) : rng.range(1.67, 1.92); if (kid) h = rng.range(1.05, 1.42); if (old) h -= 0.04;
  const L = {
    female, kid, old, role: ctx, h, k: h / 1.75, headS: kid ? 1.28 : 1, wT: rng.range(0.88, 1.27) * (old ? 1.05 : 1), dep: rng.range(0.95, old ? 1.3 : 1.18), wH: female ? rng.range(1.04, 1.16) : rng.range(0.94, 1.04), wL: rng.range(0.92, 1.12),
    hair: -1, hat: null, glasses: rng.chance(ctx === 'beach' ? 0.45 : 0.3), skirt: false, cup: !kid && rng.chance(ctx === 'cafe' ? 0.35 : 0.16),
    speed: old ? rng.range(0.75, 1.0) : kid ? rng.range(1.1, 1.5) : rng.range(1.15, 1.55), pitch: kid ? rng.range(1.7, 2.1) : female ? rng.range(1.35, 1.7) : rng.range(0.8, 1.1),
    col: {}, swim: false, shorts: false, sleeveless: false, longSleeve: false,
    bag: !active && !kid && rng.chance(0.27), towel: ctx === 'beach' && rng.chance(0.48), umbrella: ctx === 'beach' && rng.chance(0.09), phone: !kid && !active && rng.chance(0.35),
    face: rng.range(0.94, 1.06),
  };
  const c = L.col;
  c.skin = skin; c.hair = old ? pick(HAIR.slice(7, 9)) : pick(HAIR.slice(0, 7)); if (!old && rng.chance(0.06)) c.hair = HAIR[9].clone();
  c.shoe = pick(SHOES); c.cup = new THREE.Color('#c79a6b'); c.hat = pick(HATS); c.glasses = new THREE.Color('#121212');
  L.hair = female ? rng.pick([1, 1, 2, 3, 0, 4]) : (rng.chance(0.12) && !kid ? -1 : rng.pick([0, 0, 0, 4]));
  if (ctx === 'beach' && !old) {
    L.swim = true; L.shorts = true; L.sleeveless = true; L.bag = false; L.phone = false;
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
  const shorts = active || rng.chance(old ? 0.15 : 0.45);
  L.shorts = shorts; L.sleeveless = active || sleeve < 0.15; L.longSleeve = !active && sleeve > 0.84;
  c.thigh = c.bottom.clone(); c.shin = shorts ? skin.clone() : c.bottom.clone();
  if (female && !active) {
    const r = rng.next();
    if (r < 0.35) { const d = pick(DRESS); c.top = d; c.bottom = d.clone(); c.skirt = d.clone(); L.skirt = true; c.sleeve = rng.chance(0.5) ? skin.clone() : d.clone(); c.fore = skin.clone(); c.thigh = skin.clone(); c.shin = skin.clone(); }
    else if (r < 0.55) { c.skirt = pick(DRESS); L.skirt = true; c.bottom = c.skirt.clone(); c.thigh = skin.clone(); c.shin = skin.clone(); }
    if (rng.chance(0.18)) L.hat = 'sun';
  } else if (rng.chance(0.18)) L.hat = 'cap';
  if (old && female && rng.chance(0.5)) { // the classic yiayia in black
    const blk = new THREE.Color('#1a1a1c'); c.top = blk; c.bottom = blk.clone(); c.skirt = blk.clone(); L.skirt = true; c.sleeve = blk.clone(); c.fore = blk.clone(); c.thigh = skin.clone(); c.shin = new THREE.Color('#2a2622'); c.shoe = blk.clone(); L.hat = 'scarf'; c.hat = blk.clone(); L.hair = 2;
  } else if (old && !female && rng.chance(0.5)) { c.top = new THREE.Color('#f2f0ea'); c.bottom = new THREE.Color('#5d5f63'); c.thigh = c.bottom.clone(); c.shin = c.bottom.clone(); L.hat = 'cap'; c.hat = new THREE.Color('#4b4136'); }
  if (kid) { L.shorts = true; c.top = pick(SWIM); c.bottom = pick(BOTTOMS); c.thigh = c.bottom.clone(); c.shin = skin.clone(); L.glasses = false; }
  if (active) {
    L.cup = false; L.bag = false; L.hat = ctx === 'cyclist' ? 'cap' : (rng.chance(0.4) ? 'cap' : null); L.hair = female ? 3 : 0; L.skirt = false;
    c.top = pick(SWIM); c.sleeve = skin.clone(); c.fore = skin.clone(); c.bottom = new THREE.Color('#28313d'); c.thigh = c.bottom.clone(); c.shin = skin.clone();
    L.speed = ctx === 'cyclist' ? rng.range(3.8, 5.2) : rng.range(2.2, 3.1);
  }
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
  else if (variant === 'phone') { P.shA[1] = 0.35; P.shR[1] = 0.12; P.elb[1] = 1.5; P.hYaw *= 0.3; P.hPitch = 0.28; P.tRoll -= 0.04; }
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
export function armsPanic(P, t) {
  const flinch = Math.exp(-t * 2.4);
  for (let i = 0; i < 2; i++) { P.shR[i] = 0.48 + flinch * 0.35; P.shA[i] = 0.72 + flinch * 0.22; P.elb[i] = 1.4 + flinch * 0.4; }
  P.tPitch += 0.12; P.hPitch = 0.16;
}
export function armsFist(P, t) { P.shA[1] = 1.12 + 0.08 * Math.sin(t * 5); P.shR[1] = 0.3; P.elb[1] = 1.65; P.tPitch += 0.04; }
export function armsWave(P, t) { P.shR[1] = 1.65; P.shA[1] = 0.22; P.elb[1] = 0.9 + 0.17 * Math.sin(t * 6); }
/** A protective airborne tuck; retained name for existing reaction callers. */
export function starfish(P, t) {
  for (let i = 0; i < 2; i++) { P.hipA[i] = i ? 0.62 : 0.35; P.hipR[i] = 0.12; P.knee[i] = i ? 1.25 : 0.88; P.foot[i] = -0.08; P.shR[i] = 0.4; P.shA[i] = 1.15 + 0.08 * Math.sin(t * 4); P.elb[i] = 0.7; }
  P.pelY = HIP_Y; P.tPitch = 0.18; P.hPitch = 0.22;
}
export function poseCycle(P, ph) {
  P.pelY = 1.015; P.tPitch = 0.32; P.tRoll = 0; P.tYaw = 0; P.pelYaw = 0; P.pelRoll = 0; P.cyclePh = ph;
  for (let i = 0; i < 2; i++) {
    const phase=ph+i*Math.PI, targetY=0.35+0.155*Math.sin(phase)+ANKLE, targetZ=0.155*Math.cos(phase)-0.045;
    const down=P.pelY-0.02-targetY, d2=down*down+targetZ*targetZ;
    const knee=Math.acos(clamp((d2-THIGH*THIGH-SHIN*SHIN)/(2*THIGH*SHIN),-1,1));
    const hip=Math.atan2(targetZ,down)+Math.atan2(SHIN*Math.sin(knee),THIGH+SHIN*Math.cos(knee));
    P.hipA[i]=hip;P.knee[i]=knee;P.hipR[i]=0;P.foot[i]=knee-hip;
    P.shA[i] = 0.8; P.shR[i] = 0.06; P.elb[i] = 0.38;
  }
  P.hPitch = -0.2; P.hYaw = 0;
}

// ------------------------------------------------------------------ the crowd renderer
// Every frame the visible people are packed into the instance buffers (begin / draw... / end), so each
// part only ever draws as many instances as there are people using it.
const SHADOW = new Set(['pelvis', 'torsoM', 'torsoF', 'head', 'thigh', 'shin', 'skirt', 'uarm', 'hair1']);
const NEAR_RIGS = 3, NEAR_RIG_DIST = 15, NEAR_RIG_CACHE = 16;
export class Crowd {
  constructor(scene, max) {
    this.max = max; this.scene = scene; this.near = new Map(); this.nearCount = 0; this.nearBuilt = 0; this.frame = 0;
    this.nearMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.82, vertexColors: true });
    // woven fabric (micro-normal + sheen) for clothes, a softer sheen for skin; colours come per instance
    const mat = new THREE.MeshStandardMaterial({color:0xffffff,roughness:1});
    const skinM = new THREE.MeshStandardMaterial({color:0xffffff,roughness:1});
    const matV = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, metalness: 0, vertexColors: true });
    const hairM = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0.05 });
    const glassM = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.1, metalness: 0.6 });
    const hair = hairGeos(), hats = hatGeos();
    const def = {
      bicycle: [bicycleGeo(), matV, 1],
      farBody: [block(.34,.5,.20), mat, 1], farHead: [block(.18,.22,.19), mat, 1],
      farLimb: [limb(0.8,0.055,0.031,0,0.3,4), mat, 2], farArm: [limb(0.52,0.044,0.025,0,0.3,4), mat, 2],
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
      im.count = 0; im.visible = false; // drawn only while it holds instances: end() shows it
      scene.add(im);
      this.parts[name] = { im, mult, n: 0 };
    }
    this.W0 = new THREE.Matrix4(); this.Wp = new THREE.Matrix4(); this.Wt = new THREE.Matrix4(); this.Ws = new THREE.Matrix4(); this.Wf = new THREE.Matrix4();
    this.Wto = new THREE.Matrix4(); this.Wn = new THREE.Matrix4(); this.Wh = new THREE.Matrix4(); this.Wa = new THREE.Matrix4(); this.Wfa = new THREE.Matrix4(); this.Wha = new THREE.Matrix4();
    this.T = new THREE.Matrix4(); this.O = new THREE.Matrix4(); this.E = new THREE.Euler(); this.S = new THREE.Vector3();
    warmHumanRig(this.nearMaterial);
  }
  /** which parts a look uses (cached on the look) */
  uses(L) {
    if (L.u) return L.u;
    const u = { torso: L.female ? 'torsoF' : 'torsoM', hair: L.hair >= 0 && L.hat !== 'scarf' ? 'hair' + L.hair : null, hat: L.hat, glasses: L.glasses, skirt: L.skirt, cup: L.cup };
    if (L.hat === 'cap' && L.hair === 1) u.hair = 'hair0';
    return (L.u = u);
  }
  begin() { this.frame++; this.nearCount = 0; this.nearBuilt = 0; for (const rig of this.near.values()) rig.mesh.visible = false; for (const p of Object.values(this.parts)) p.n = 0; }
  _bone(out, parent, x, y, z, rx, ry, rz, order) { this.E.set(rx, ry, rz, order); this.T.makeRotationFromEuler(this.E); this.T.setPosition(x, y, z); out.multiplyMatrices(parent, this.T); return out; }
  _put(name, i, M, col, sx = 1, sy = 1, sz = 1) {
    const p = this.parts[name], idx = p.n * p.mult + i;
    this.O.copy(M); if (sx !== 1 || sy !== 1 || sz !== 1) this.O.scale(this.S.set(sx, sy, sz));
    p.im.setMatrixAt(idx, this.O); p.im.setColorAt(idx, col);
    if (i === p.mult - 1) p.n++;
  }
  draw(P, L, distance = 0) {
    // Skinned close-up rigs are the expensive LOD: only the few people right next to you get one.
    if (distance < NEAR_RIG_DIST && this.nearCount < NEAR_RIGS) {
      let rig = this.near.get(L);
      // Spread cold geometry work across frames. Waiting actors remain visible
      // through the instanced LOD; cached rigs have no construction penalty.
      if (!rig && this.nearBuilt < 1) {
        this.nearBuilt++;
        if (this.near.size >= NEAR_RIG_CACHE) {
          let oldest; for (const entry of this.near) if (entry[1].lastFrame !== this.frame && (!oldest || entry[1].lastFrame < oldest[1].lastFrame)) oldest = entry;
          if (oldest) { this.scene.remove(oldest[1].mesh); oldest[1].mesh.geometry.dispose(); for (const p of oldest[1].pedals) { p.pedal.geometry.dispose(); p.crank.geometry.dispose(); } oldest[1].skeleton.dispose(); this.near.delete(oldest[0]); }
        }
        rig = createHumanRig(L, this.nearMaterial); this.near.set(L, rig); this.scene.add(rig.mesh);
      }
      if (rig) { this.nearCount++; rig.lastFrame = this.frame; rig.mesh.visible = true; poseHumanRig(rig, P, L); return; }
    }
    if (distance > 58) { this._far(P, L); return; }
    const u = this.uses(L), c = L.col;
    const k = L.k, pv = P.pivot * k;
    // root: rotate about the pivot (hips) so lying / flipping bodies turn around their centre
    this.E.set(P.pitch, P.yaw, P.roll, 'YZX');
    const W0 = this.W0.makeRotationFromEuler(this.E);
    const e = W0.elements;
    const tx = P.x - e[4] * pv, ty = P.y + pv - e[5] * pv, tz = P.z - e[6] * pv;
    W0.scale(this.S.set(k, k, k)); W0.setPosition(tx, ty, tz);
    if (L.role === 'cyclist') this._put('bicycle', 0, W0, this.nearMaterial.color);
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
  _far(P, L) {
    const c=L.col, k=L.k, pv=P.pivot*k;
    this.E.set(P.pitch,P.yaw,P.roll,'YZX'); const root=this.W0.makeRotationFromEuler(this.E), e=root.elements;
    const x=P.x-e[4]*pv,y=P.y+pv-e[5]*pv,z=P.z-e[6]*pv; root.scale(this.S.set(k,k,k));root.setPosition(x,y,z);
    if(L.role==='cyclist')this._put('bicycle',0,root,this.nearMaterial.color);
    const pel=this._bone(this.Wp,root,0,P.pelY,0,0,P.pelYaw,P.pelRoll,'YXZ');
    const torso=this._bone(this.Wto,pel,0,0.30,0,P.tPitch,P.tYaw,P.tRoll,'YXZ'); this._put('farBody',0,torso,c.top,L.wT,1,L.dep*0.7);
    this._put('farHead',0,this._bone(this.Wh,torso,0,0.38,0,0,P.hYaw,0,'YXZ'),c.skin,L.headS,L.headS*1.1,L.headS);
    for(let i=0;i<2;i++) {
      const sign=i===0?1:-1;
      this._put('farLimb',i,this._bone(this.Wt,pel,sign*HIP_X*L.wH,-0.02,0,-P.hipA[i]*0.55,0,sign*P.hipR[i],'ZXY'),L.shorts?c.skin:c.bottom,L.wL,1,L.wL);
      this._put('farArm',i,this._bone(this.Wa,torso,sign*SH_X*L.wT,0.19,0,-P.shA[i],0,sign*P.shR[i],'ZXY'),c.skin);
    }
  }
  end() {
    for (const p of Object.values(this.parts)) {
      p.im.count = p.n * p.mult; p.im.visible = p.im.count > 0; // an empty InstancedMesh still costs a draw call
      if (p.n) { p.im.instanceMatrix.needsUpdate = true; p.im.instanceColor.needsUpdate = true; p.im.instanceMatrix.clearUpdateRanges(); p.im.instanceMatrix.addUpdateRange(0, p.n * p.mult * 16); p.im.instanceColor.clearUpdateRanges(); p.im.instanceColor.addUpdateRange(0, p.n * p.mult * 3); }
    }
  }
}

// Close LOD. One material and one SkinnedMesh per person; joints have a soft
// transition between the parent and child bones. Clothing is an outer shell,
// with hems, collars, straps and cuffs rather than a colour swap on bare skin.
function box(w, h, d, x = 0, y = 0, z = 0) { const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); return g; }
function tubeBetween(a, b, radius = 0.012, segments = 6) {
  const d = new THREE.Vector3().subVectors(b, a), g = new THREE.CylinderGeometry(radius, radius, d.length(), segments);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2); return g;
}
function bicycleGeo() {
  const all = [], V = (y, z) => new THREE.Vector3(0, y, z);
  for (const z of [-0.51, 0.55]) {
    const tyre = new THREE.TorusGeometry(0.31, 0.025, 6, 20); tyre.rotateY(Math.PI / 2); tyre.translate(0, 0.34, z); all.push(colorize(tyre, [0.035, 0.04, 0.048]));
    const rim = new THREE.TorusGeometry(0.278, 0.009, 4, 20); rim.rotateY(Math.PI / 2); rim.translate(0, 0.34, z); all.push(colorize(rim, [0.6, 0.63, 0.66]));
    for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI; all.push(colorize(tubeBetween(V(0.34 - Math.sin(a) * 0.275, z - Math.cos(a) * 0.275), V(0.34 + Math.sin(a) * 0.275, z + Math.cos(a) * 0.275), 0.003, 3), [0.5, 0.5, 0.5])); }
  }
  const pts = [V(0.34, -0.51), V(0.35, 0), V(0.84, -0.14), V(0.87, 0.39), V(0.34, 0.55)];
  for (const [a, b] of [[0,1],[0,2],[1,2],[2,3],[1,3],[3,4]]) all.push(colorize(tubeBetween(pts[a], pts[b], 0.018), [0.045, 0.24, 0.29]));
  all.push(colorize(box(0.2, 0.04, 0.22, 0, 0.92, -0.14), [0.03, 0.035, 0.04]));
  all.push(colorize(tubeBetween(V(0.84,-0.14),V(0.92,-0.14),0.013),[0.5,0.5,0.5]));
  all.push(colorize(tubeBetween(V(0.87,0.39),V(1.04,0.45),0.014),[0.5,0.5,0.5]));
  all.push(colorize(box(0.48,0.027,0.045,0,1.04,0.45),[0.04,0.04,0.04]));
  return merge(all);
}
let bicycleTemplate;
// This cache has a fixed set of geometry keys, independent of crowd size.
const rigTemplates = new Map();
let rigHairTemplates, rigHatTemplates;
function rigTemplate(key, build) {
  let g = rigTemplates.get(key);
  if (!g) { g = build(); rigTemplates.set(key, g); }
  return g.clone();
}
function rigLimb(...args) { args[5] = Math.max(args[5] || 9, 16); return rigTemplate('limb:' + args.join(','), () => limb(...args)); }
function rigHair(index) {
  rigHairTemplates ||= hairGeos().map(clean);
  return rigHairTemplates[index].clone();
}
function rigHat(name) {
  rigHatTemplates ||= Object.fromEntries(Object.entries(hatGeos()).map(([key, g]) => [key, clean(g)]));
  return rigHatTemplates[name].clone();
}
let rigWarmed = false;
function warmHumanRig(material) {
  if (rigWarmed) return;
  // Build once during level loading, never in the scene. This warms immutable
  // templates and the binding/merge path before the first nearby person arrives.
  // An independent seed leaves the actual crowd's random sequence untouched.
  const look = makeLook(new RNG(137), 'street');
  Object.assign(look, { female: false, skirt: false, shorts: false, swim: false,
    sleeveless: false, longSleeve: false, hair: 0, hat: 'cap' });
  const rig = createHumanRig(look, material);
  rig.mesh.geometry.dispose(); rig.skeleton.dispose();
  for (const p of rig.pedals) { p.pedal.geometry.dispose(); p.crank.geometry.dispose(); }
  rigWarmed = true;
}
export function createHumanRig(L, material) {
  const bones = [], bind = [], names = {}, c = L.col, parts = [];
  function bone(name, parent, x, y, z) {
    const b = new THREE.Bone(); b.name = name; b.position.set(x,y,z);
    names[name] = bones.length; bones.push(b); if (parent !== null) bones[parent].add(b); return bones.length - 1;
  }
  const pelvis = bone('pelvis',null,0,HIP_Y,0), torso = bone('torso',pelvis,0,0.075,0), neck = bone('neck',torso,0,0.475,0.004), head = bone('head',neck,0,0.045,0.01);
  const legs = [], arms = [];
  for (let i=0;i<2;i++) {
    const sign=i===0?1:-1;
    const thigh=bone('thigh'+i,pelvis,sign*HIP_X*L.wH,-0.02,0), shin=bone('shin'+i,thigh,0,-THIGH,0), foot=bone('foot'+i,shin,0,-SHIN,0);
    legs.push([thigh,shin,foot]);
    const upper=bone('upper'+i,torso,sign*SH_X*L.wT,SH_Y,-0.005), lower=bone('lower'+i,upper,0,-UARM,0), hand=bone('hand'+i,lower,0,-FARM,0);
    arms.push([upper,lower,hand]);
  }
  bones[0].updateMatrixWorld(true);
  for (const b of bones) bind.push(b.matrixWorld.clone());
  function add(geometry, bi, color, scale = [1,1,1], blend = false, chain = null) {
    const g=clean(geometry); g.scale(...scale);
    const pos=g.attributes.position, indices=new Uint16Array(pos.count*4), weights=new Float32Array(pos.count*4);
    const colors=g.attributes.color, col=new Float32Array(pos.count*3);
    const parent=bones[bi].parent?.isBone ? bones.indexOf(bones[bi].parent) : bi;
    for(let j=0;j<pos.count;j++) {
      const w=chain ? clamp((chain.joint-pos.getY(j)+0.05)/0.1,0,1) : blend ? 0.38*clamp((pos.getY(j)+0.065)/0.09,0,1) : 0;
      indices[j*4]=bi; indices[j*4+1]=chain ? chain.child : parent; weights[j*4]=1-w; weights[j*4+1]=w;
      col[j*3]=(colors?colors.getX(j):1)*color.r; col[j*3+1]=(colors?colors.getY(j):1)*color.g; col[j*3+2]=(colors?colors.getZ(j):1)*color.b;
      if (bi === head && colors && colors.getX(j) > 1.3) { col[j*3]=0.72;col[j*3+1]=0.72;col[j*3+2]=0.68; }
    }
    g.setAttribute('color',new THREE.Float32BufferAttribute(col,3));
    g.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(indices,4)); g.setAttribute('skinWeight',new THREE.Float32BufferAttribute(weights,4));
    g.applyMatrix4(bind[bi]); parts.push(g);
  }
  add(pelvisGeo(),pelvis,c.bottom,[L.wH,1,L.wH]);
  add(torsoGeo(L.female),torso,c.top,[L.wT,1,L.wT*L.dep]);
  add(limb(.08,.045,.045).translate(0,.075,0),neck,c.skin);
  add(headGeo(),head,c.skin,[L.headS*L.face,L.headS,L.headS]);
  if(L.hair>=0)add(rigHair(L.hair),head,c.hair);
  if(L.hat)add(rigHat(L.hat),head,c.hat);
  if(L.glasses)add(glassesGeo(),head,c.glasses);
  if(L.skirt)add(skirtGeo(),pelvis,c.skirt||c.bottom);
  for(let i=0;i<2;i++){
    const [thigh,shin,foot]=legs[i],[upper,lower,hand]=arms[i];
    add(limb(THIGH,.075,.05),thigh,c.thigh,[L.wL,1,L.wL]);
    add(limb(SHIN,.05,.035),shin,c.shin,[L.wL,1,L.wL]);
    add(footGeo(),foot,c.shoe);
    add(limb(UARM,.05,.04),upper,c.sleeve);
    add(limb(FARM,.035,.03),lower,c.fore);
    add(handGeo(),hand,c.skin);
    if(i===1&&L.cup)add(cupGeo(),hand,c.cup);
    if(i===1&&L.phone)add(block(.054,.097,.009,0,-.04,.027),hand,new THREE.Color('#24262b'));
  }
  if(L.bag)add(block(.17,.23,.09,-.22,0,0),torso,new THREE.Color('#996c41'));
  // The bicycle follows the world root rather than the pedalling hips.
  let bicycle=null; const pedals=[];
  if(L.role==='cyclist') {
    bicycleTemplate ||= bicycleGeo(); bicycle=new THREE.Mesh(bicycleTemplate,material); bicycle.castShadow=true;
    for(let i=0;i<2;i++) {
      const pedal=new THREE.Mesh(colorize(box(0.12,0.016,0.075),[0.04,0.04,0.045]),material);
      const crank=new THREE.Mesh(colorize(new THREE.CylinderGeometry(0.011,0.011,0.155,6),[0.4,0.4,0.4]),material);
      bicycle.add(pedal,crank);pedals.push({pedal,crank});
    }
  }
  const geometry=mergeGeometries(parts); assertWorldBudget('pedestrian',geometry); for(const part of parts)part.dispose();
  const mesh=new THREE.SkinnedMesh(geometry,material), skeleton=new THREE.Skeleton(bones);
  mesh.add(bones[0]); mesh.bind(skeleton); mesh.frustumCulled=false; mesh.castShadow=true; mesh.receiveShadow=true;
  if(bicycle)mesh.add(bicycle);
  return {mesh,skeleton,bones,names,legs,arms,pedals,pivot:new THREE.Vector3(),lastFrame:0};
}
function poseHumanRig(rig,P,L) {
  const {mesh,bones,names,legs,arms}=rig;
  mesh.rotation.set(P.pitch,P.yaw,P.roll,'YZX'); mesh.scale.setScalar(L.k);
  const pivot=rig.pivot.set(0,P.pivot*L.k,0).applyEuler(mesh.rotation);
  mesh.position.set(P.x-pivot.x,P.y+P.pivot*L.k-pivot.y,P.z-pivot.z);
  for(let i=0;i<rig.pedals.length;i++) {
    const phase=(P.cyclePh||0)+i*Math.PI, sign=i===0?1:-1, {pedal,crank}=rig.pedals[i];
    pedal.position.set(sign*0.105,0.35+0.155*Math.sin(phase),0.155*Math.cos(phase));
    crank.position.set(sign*0.075,0.35+0.0775*Math.sin(phase),0.0775*Math.cos(phase)); crank.rotation.x=Math.PI/2-phase;
  }
  bones[0].position.y=P.pelY; bones[0].rotation.set(0,P.pelYaw,P.pelRoll,'YXZ');
  bones[names.torso].rotation.set(P.tPitch,P.tYaw,P.tRoll,'YXZ');
  bones[names.neck].rotation.set(P.hPitch*0.35,P.hYaw*0.3,0,'YXZ'); bones[names.head].rotation.set(P.hPitch*0.65,P.hYaw*0.7,0,'YXZ');
  for(let i=0;i<2;i++) {
    const sign=i===0?1:-1, [thigh,shin,foot]=legs[i], [upper,lower]=arms[i];
    bones[thigh].rotation.set(-P.hipA[i],0,sign*P.hipR[i],'ZXY'); bones[shin].rotation.x=P.knee[i]; bones[foot].rotation.x=-P.foot[i];
    bones[upper].rotation.set(-P.shA[i],0,sign*P.shR[i],'ZXY'); bones[lower].rotation.x=-P.elb[i];
  }
}
