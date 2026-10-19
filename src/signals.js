// Working traffic lights at the real signalised junctions of the avenue (OSM highway=traffic_signals nodes,
// clustered per junction). Each junction runs a fixed-time plan, green -> amber -> red, coordinated as a
// "green wave" for ~80 km/h, so cruising traffic flows and racers who outrun the wave meet red.
// During the main-road red, pedestrians get a green man and side-street cross traffic goes.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ROAD } from './road.js';
import { RNG, clamp, canvasTex } from './util.js';

export const CYCLE = 28, GREEN = 16, AMBER = 3; // red = 9 s
const RED0 = GREEN + AMBER;
export const STOP_OFF = 12, ZEBRA_OFF = 8.5;
const WAVE_V = 80 / 3.6;
const PED0 = RED0 + 1, PED1 = CYCLE - 2.5; // green man window (inside the main red)

/** cluster the OSM signal nodes into junctions on the route, and find which side streets meet there */
export function findJunctions(map) {
  const { route, data } = map;
  const sig = data.furniture.filter((f) => f.t === 'traffic_signals').sort((a, b) => a.s - b.s);
  const groups = [];
  for (const f of sig) { const g = groups[groups.length - 1]; if (g && f.s - g[g.length - 1].s < 60) g.push(f); else groups.push([f]); }
  const rng = new RNG(97);
  const out = [];
  for (const g of groups) {
    const main = g.filter((f) => Math.abs(f.u) < route.edge(f.s) + 6);
    const use = main.length ? main : g;
    const s = use.reduce((a, f) => a + f.s, 0) / use.length;
    if (s < 40 || s > route.length - 40) continue;
    const fr = route.frame(s, {});
    const acc = { L: [0, 0], R: [0, 0] };
    for (const rd of data.sideRoads) {
      if (rd.f) continue; // footways do not bring cars
      const p = rd.p;
      for (let i = 0; i < p.length; i += 2) {
        const dx = p[i] - fr.x, dz = p[i + 1] - fr.z, d = Math.hypot(dx, dz);
        if (d < 18 || d > 45) continue;
        const along = dx * fr.tx + dz * fr.tz, lat = dx * fr.rx + dz * fr.rz;
        if (Math.abs(along) > 14 || Math.abs(lat) < 15) continue;
        const a = acc[lat > 0 ? 'R' : 'L']; a[0] += along; a[1]++;
      }
    }
    const sides = { L: acc.L[1] ? clamp(acc.L[0] / acc.L[1], -4, 4) : null, R: acc.R[1] ? clamp(acc.R[0] / acc.R[1], -4, 4) : null };
    const arrive = (s - route.start) / WAVE_V + 5;
    const pf = route.point(s - STOP_OFF, route.medHalf(s) + 2, new THREE.Vector3());
    out.push({ i: out.length, s, sF: s - STOP_OFF, sO: s + STOP_OFF, zF: s - ZEBRA_OFF, zO: s + ZEBRA_OFF, sides, off: 6 - arrive + rng.range(-3, 3),
      x: pf.x, z: pf.z, main: 'G', tau: 0, redT: -1, ped: false, cross: false, left: 0, spawnT: { L: rng.range(0, 1.5), R: rng.range(0, 1.5) } });
  }
  return out;
}

function pedIcon(walk, col) {
  return canvasTex(64, 96, (g, w, h) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
    g.fillStyle = col; g.strokeStyle = col; g.lineCap = 'round'; g.lineWidth = 9;
    g.beginPath(); g.arc(32, 16, 8, 0, Math.PI * 2); g.fill();
    g.beginPath();
    if (walk) { g.moveTo(32, 30); g.lineTo(30, 58); g.moveTo(30, 58); g.lineTo(18, 86); g.moveTo(30, 58); g.lineTo(44, 84); g.moveTo(31, 36); g.lineTo(18, 54); g.moveTo(31, 36); g.lineTo(46, 50); }
    else { g.moveTo(32, 30); g.lineTo(32, 60); g.moveTo(26, 60); g.lineTo(26, 88); g.moveTo(38, 60); g.lineTo(38, 88); g.moveTo(24, 34); g.lineTo(20, 60); g.moveTo(40, 34); g.lineTo(44, 60); }
    g.stroke();
  }, { mips: false });
}
function glowTex() {
  return canvasTex(64, 64, (g) => {
    const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.25, 'rgba(255,255,255,.55)'); r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r; g.fillRect(0, 0, 64, 64);
  }, { mips: false });
}

const LAMP_COL = ['#ff2a14', '#ffa800', '#14ff6a'];
const LAMP_OFF = ['#2a0705', '#2a1c03', '#03240e'];

export class Signals {
  constructor(map, scene, staticGroup, junctions) {
    this.route = map.route; this.J = junctions; this.t = 0;
    const route = this.route;
    const darkMetal = new THREE.MeshStandardMaterial({ color: '#2e3236', metalness: 0.6, roughness: 0.5 });
    const housingMat = new THREE.MeshStandardMaterial({ color: '#16181a', roughness: 0.55, side: THREE.DoubleSide });
    const yellow = new THREE.MeshStandardMaterial({ color: '#e2b51c', roughness: 0.5 });
    const cabinet = new THREE.MeshStandardMaterial({ color: '#8d9496', roughness: 0.6, metalness: 0.2 });
    const glow = glowTex();
    const icR = pedIcon(false, '#ff2a14'), icG = pedIcon(true, '#14ff6a');
    // template geometry (head front faces +z)
    const housing = new THREE.BoxGeometry(0.34, 1.0, 0.26);
    const back = new THREE.BoxGeometry(0.6, 1.26, 0.03); back.translate(0, 0, -0.15);
    const visors = [];
    for (let i = 0; i < 3; i++) { const v = new THREE.CylinderGeometry(0.135, 0.135, 0.2, 4, 1, true, Math.PI / 2, Math.PI); v.rotateX(Math.PI / 2); v.translate(0, 0.32 - i * 0.32, 0.23); visors.push(v); }
    const visorG = mergeGeometries(visors.map((v) => v.toNonIndexed()));
    const disc = new THREE.CircleGeometry(0.105, 18);
    const pedBox = new THREE.BoxGeometry(0.3, 0.62, 0.2);
    const pedFace = new THREE.PlaneGeometry(0.2, 0.26);
    const button = new THREE.BoxGeometry(0.1, 0.16, 0.08);
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(), V = new THREE.Vector3(), S = new THREE.Vector3(1, 1, 1);
    const trs = (x, y, z, yaw, sx = 1, sy = 1, sz = 1) => M.compose(V.set(x, y, z), Q.setFromEuler(E.set(0, yaw, 0)), S.set(sx, sy, sz));
    const put = (list, geo, m) => { const g = geo.index ? geo.toNonIndexed() : geo.clone(); for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k); if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2)); g.applyMatrix4(m); list.push(g); };
    const pt = new THREE.Vector3();
    this.dyn = new THREE.Group(); scene.add(this.dyn);

    for (const j of junctions) {
      const s0 = j.s;
      const fr = route.frame(s0, {});
      const yawF = Math.atan2(-fr.tx, -fr.tz), yawO = Math.atan2(fr.tx, fr.tz); // heads facing forward / oncoming traffic
      const yawAcrossR = Math.atan2(-fr.rx, -fr.rz), yawAcrossL = Math.atan2(fr.rx, fr.rz);
      const L = { metal: [], housing: [], R: [], A: [], G: [], pR: [], pG: [], yellow: [], cab: [] };
      j.heads = [];
      const head = (s, u, y, yaw, halo) => {
        route.point(s, u, pt); const base = pt.y;
        const m0 = trs(pt.x, base + y, pt.z, yaw).clone();
        put(L.housing, housing, m0); put(L.housing, back, m0); put(L.housing, visorG, m0);
        const lampPos = [];
        ['R', 'A', 'G'].forEach((k, i) => {
          const lm = new THREE.Matrix4().makeTranslation(0, 0.32 - i * 0.32, 0.132); lm.premultiply(m0);
          put(L[k], disc, lm);
          lampPos.push(new THREE.Vector3(0, 0.32 - i * 0.32, 0.3).applyMatrix4(m0));
        });
        if (halo) j.heads.push(lampPos);
      };
      const pedHead = (s, u, y, yaw) => {
        route.point(s, u, pt);
        const m0 = trs(pt.x, pt.y + y, pt.z, yaw).clone();
        put(L.housing, pedBox, m0);
        put(L.pR, pedFace, new THREE.Matrix4().makeTranslation(0, 0.15, 0.101).premultiply(m0));
        put(L.pG, pedFace, new THREE.Matrix4().makeTranslation(0, -0.15, 0.101).premultiply(m0));
        put(L.yellow, button, new THREE.Matrix4().makeTranslation(0, -1.25, 0.08).premultiply(m0));
      };
      const pole = (s, u, h) => { route.point(s, u, pt); const g = new THREE.BoxGeometry(0.075*2, h, 0.1*2); g.translate(0, h / 2, 0); put(L.metal, g, trs(pt.x, pt.y + ROAD.curbH(route, s), pt.z, 0)); };
      const curbY = (s) => ROAD.curbH(route, s);
      for (const dir of [1, -1]) {
        const sStop = dir > 0 ? j.sF : j.sO, sFar = s0 + dir * 13;
        const yaw = dir > 0 ? yawF : yawO;
        const uCurb = route.edge(sFar) + ROAD.gutter + 0.9;
        // far-side mast arm over this carriageway (what you watch from the stop line)
        const H = 6.7;
        pole(sFar, dir * uCurb, H);
        const uEnd = route.medHalf(sFar) + 0.4;
        const armLen = uCurb - uEnd;
        const mid = route.point(sFar, dir * (uCurb + uEnd) / 2, new THREE.Vector3());
        const arm = new THREE.BoxGeometry(armLen, 0.16, 0.16);
        route.point(sFar, dir * uCurb, pt);
        put(L.metal, arm, trs(mid.x, pt.y + curbY(sFar) + H - 0.3, mid.z, Math.atan2(fr.tx, fr.tz)));
        const nl = route.lanes(sFar);
        for (let l = 0; l < nl; l++) head(sFar, dir * route.laneU(sFar, l), curbY(sFar) + H - 0.3 - 0.62, yaw, dir > 0);
        // near-side post at the stop line, and one on the median
        const sNear = sStop - dir * 1.4, uN = route.edge(sNear) + ROAD.gutter + 0.75;
        pole(sNear, dir * uN, 3.6);
        head(sNear, dir * uN, curbY(sNear) + 3.0, yaw, dir > 0);
        if (route.div(s0) > 0.5 && route.medHalf(s0) > 0.6) { pole(sFar, dir * 0.25, 3.6); head(sFar, dir * 0.25, 0.2 + 3.0, yaw, dir > 0); }
        // pedestrian heads look across the road from both kerbs
        pedHead(sNear, dir * (uN + 0.02), curbY(sNear) + 2.45, dir > 0 ? yawAcrossR : yawAcrossL);
        pedHead(sFar, dir * (uCurb + 0.02), curbY(sFar) + 2.45, dir > 0 ? yawAcrossR : yawAcrossL);
        // controller cabinet
        if (dir > 0) { const cb = new THREE.BoxGeometry(0.7, 1.3, 0.45); cb.translate(0, 0.65, 0); route.point(sNear - 3, uN + 0.9, pt); put(L.cab, cb, trs(pt.x, pt.y + curbY(sNear), pt.z, Math.atan2(fr.tx, fr.tz))); }
      }
      // static parts go to the batched road group
      const addStatic = (list, mat, shadow) => { if (!list.length) return; const m = new THREE.Mesh(mergeGeometries(list), mat); m.castShadow = shadow; m.receiveShadow = true; staticGroup.add(m); };
      addStatic(L.metal, darkMetal, true); addStatic(L.housing, housingMat, true); addStatic(L.yellow, yellow, false); addStatic(L.cab, cabinet, true);
      // lamps: per-junction materials, switched as the plan runs
      const g = new THREE.Group(); this.dyn.add(g); j.vis = g;
      j.mats = LAMP_COL.map((c, i) => new THREE.MeshStandardMaterial({ color: LAMP_OFF[i], emissive: c, emissiveIntensity: 0, roughness: 0.25 }));
      ['R', 'A', 'G'].forEach((k, i) => { const m = new THREE.Mesh(mergeGeometries(L[k]), j.mats[i]); g.add(m); });
      j.pmats = [new THREE.MeshStandardMaterial({ color: '#000', emissive: '#ffffff', emissiveMap: icR, emissiveIntensity: 0, roughness: 0.4 }),
        new THREE.MeshStandardMaterial({ color: '#000', emissive: '#ffffff', emissiveMap: icG, emissiveIntensity: 0, roughness: 0.4 })];
      g.add(new THREE.Mesh(mergeGeometries(L.pR), j.pmats[0]), new THREE.Mesh(mergeGeometries(L.pG), j.pmats[1]));
      // soft halos so the lit lamp reads from far away and from the cockpit
      j.haloMat = new THREE.SpriteMaterial({ map: glow, color: LAMP_COL[2], transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
      j.halos = j.heads.map(() => { const sp = new THREE.Sprite(j.haloMat); sp.scale.setScalar(1.15); g.add(sp); return sp; });
      for (const o of g.children) o.userData.farCull = true; // the lamp parts and halos of a junction never move: Potato's far cull (far-cull.js) may stop drawing them when far away
      j.main = null; this.paint(j);
    }
  }

  reset() { this.t = -1.35; for (const j of this.J) { j.main = null; j.spawnT.L = j.spawnT.R = 0.5; } this.update(0, 0); }

  paint(j) {
    const k = j.main === 'R' ? 0 : j.main === 'A' ? 1 : 2;
    j.mats.forEach((m, i) => { m.emissiveIntensity = i === k ? 7 : 0.0; });
    j.haloMat.color.set(LAMP_COL[k]);
    j.halos.forEach((sp, h) => sp.position.copy(j.heads[h][k]));
  }

  update(dt, ps, cam) {
    this.t += dt;
    for (const j of this.J) {
      const tau = j.hold !== undefined ? j.hold : (((this.t + j.off) % CYCLE) + CYCLE) % CYCLE; // hold: debug pin
      const main = tau < GREEN ? 'G' : tau < RED0 ? 'A' : 'R';
      j.tau = tau; j.redT = main === 'R' ? tau - RED0 : -1;
      j.left = main === 'G' ? GREEN - tau : main === 'A' ? RED0 - tau : CYCLE - tau;
      j.toGreen = main === 'G' ? 0 : CYCLE - tau;
      j.ped = tau >= PED0 && tau < PED1; j.pedLeft = j.ped ? PED1 - tau : 0;
      j.cross = tau >= PED0 && tau < CYCLE - 3;
      if (main !== j.main) { j.main = main; this.paint(j); }
      // green man flashes before it ends
      const pg = j.ped && (j.pedLeft > 2.2 || Math.sin(this.t * 14) > 0);
      j.pmats[0].emissiveIntensity = j.ped ? 0 : 2.4; j.pmats[1].emissiveIntensity = pg ? 2.4 : 0;
      j.vis.visible = Math.abs(j.s - ps) < 900;
      // halos grow with distance so a lit lamp still reads from a few hundred metres (and from the cockpit)
      if (cam && j.vis.visible) for (const sp of j.halos) sp.scale.setScalar(0.9 + Math.min(4, sp.position.distanceTo(cam) * 0.014));
    }
  }

  /** the next junction whose stop line is still ahead of `front` for travel direction dir */
  next(front, dir = 1) {
    if (dir > 0) { for (const j of this.J) if (j.sF > front) return j; return null; }
    for (let k = this.J.length - 1; k >= 0; k--) if (this.J[k].sO < front) return this.J[k];
    return null;
  }

  /** distance to a stop line this vehicle must respect, or null. memo keeps the amber go/stop decision. */
  stopFor(front, dir, v, memo, decel = 3.0) {
    const j = this.next(front, dir); if (!j) return null;
    const d = ((dir > 0 ? j.sF : j.sO) - front) * dir;
    if (d > 170) return null;
    if (j.main === 'G') { if (memo.sigJ === j.i) memo.sigJ = -1; return null; }
    if (memo.sigJ !== j.i) {
      memo.sigJ = j.i;
      // amber: keep going only if we clear the line before red, or simply cannot stop in time
      memo.sigGo = j.main === 'A' ? (d < v * v / (2 * decel) + 1.5 && d / Math.max(1, v) < j.left + 0.6) || d < v * v / (2 * 7) : d < 0.6;
    }
    return memo.sigGo ? null : d;
  }

  /** junctions whose forward stop line was crossed between two front-bumper positions */
  crossed(prev, now) {
    for (const j of this.J) if (prev < j.sF && now >= j.sF) return j;
    return null;
  }
}
