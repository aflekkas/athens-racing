// First-person interior: dashboard, instrument cluster with live gauges (canvas texture), shift lights,
// steering wheel the driver's hands hold, centre nav screen, working rear-view + door mirrors (render target),
// and an interior shell (headliner, pillars, door cards) generated from the body loft for closed cars.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { clamp } from './util.js';
import { TX, GLSL_HELPERS } from './tex.js';
import { CAR_ENV } from './cars.js';

/**
 * Interior trim: grained soft-touch plastics, perforated / stitched leather and suede-like fabric, sampled
 * tri-planar in object space from the photographed leather scan (normal + roughness) so any shape takes it.
 */
export function trimMat(color, { rough = 0.7, scale = 0.12, nk = 0.7, metal = 0, stitch = 0, side = THREE.FrontSide, sheen = 0 } = {}) {
  const m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, side });
  m.customProgramCacheKey = () => `trim6_${scale}_${nk}_${stitch}_${sheen}`;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, { tLN: { value: TX.leather_nor }, tLR: { value: TX.leather_arm } });
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vOP; varying vec3 vON;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvOP = position; vON = normal;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      uniform sampler2D tLN; uniform sampler2D tLR; varying vec3 vOP; varying vec3 vON; vec2 iUV; vec3 iN; float iR;
      ${GLSL_HELPERS}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
      {
        vec3 an = abs(normalize(vON));
        iUV = (an.y > max(an.x, an.z) ? vOP.xz : an.x > an.z ? vOP.zy : vOP.xy) / ${scale.toFixed(3)};
        iN = texture2D(tLN, iUV).xyz * 2.0 - 1.0;
        iR = texture2D(tLR, iUV).g;
        diffuseColor.rgb *= 0.9 + 0.2 * texture2D(tLR, iUV * 0.37).r;
      }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\nroughnessFactor = clamp(roughnessFactor * (0.75 + 0.5 * iR), 0.05, 1.0);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\nnormal = perturb(-vViewPosition, normal, iUV, iN, ${nk.toFixed(2)});`);
    // suede-like fabrics: a soft rim sheen
    if (sheen > 0) sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      { float nv = abs(dot(normalize(normal), normalize(vViewPosition))); totalEmissiveRadiance += diffuseColor.rgb * pow(1.0 - nv, 3.0) * ${sheen.toFixed(2)}; }`);
  };
  return m;
}
/** a reflection-only layer (additive): glass covers and windscreens that pick up the sky without hiding what's behind */
export function glassSheen(strength = 1) {
  return new THREE.MeshPhysicalMaterial({ color: 0x000000, roughness: 0.04, metalness: 0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, envMapIntensity: strength, specularIntensity: 1 });
}
const TRIM = () => trimMat('#1d1d1f', { rough: 0.62, scale: 0.16, nk: 0.55 });

export class Cockpit {
  constructor(spec, model, mirrorTex) {
    this.spec = spec; this.model = model;
    const g = this.group = new THREE.Group();
    model.body.add(g);
    const eye = model.seat.clone();
    this.eye = eye;
    const wheelC = this.wheelC = eye.clone().add(new THREE.Vector3(0, -0.33, -0.43));
    const accent = new THREE.Color(spec.color);
    const trim = TRIM(), soft = trimMat('#252427', { rough: 0.78, scale: 0.2, nk: 0.5, side: THREE.DoubleSide });
    const alu = new THREE.MeshStandardMaterial({ color: '#a7acb2', metalness: 1, roughness: 0.28, envMap: CAR_ENV.tex });
    const paintTrim = new THREE.MeshPhysicalMaterial({ color: accent, roughness: 0.35, clearcoat: 1, metalness: 0.3, envMap: CAR_ENV.tex });
    const leatherTop = trimMat('#2a2624', { rough: 0.55, scale: 0.09, nk: 0.8, });
    // ---- windscreen base & dash geometry
    let wsZ, wsY, W;
    if (spec.body === 'mini') { wsZ = -0.6; wsY = 0.985; W = 1.36; }
    else { const sh = model.shape; wsZ = -sh.ws[1] * sh.L / 2 + 0.05; wsY = sh.belt + 0.03; W = sh.W * 0.92; }
    const topY = Math.min(eye.y - 0.21, wsY + 0.06), faceZ = wheelC.z - 0.15;
    // dash: extruded side profile (z,y) across the width
    const prof = new THREE.Shape();
    prof.moveTo(wsZ - 0.05, wsY - 0.04);
    prof.quadraticCurveTo((wsZ + faceZ) / 2, topY + 0.04, faceZ + 0.02, topY);
    prof.quadraticCurveTo(faceZ + 0.1, topY - 0.05, faceZ + 0.06, topY - 0.22);
    prof.lineTo(faceZ - 0.02, topY - 0.5);
    prof.lineTo(wsZ - 0.05, topY - 0.5);
    prof.closePath();
    const dashGeo = new THREE.ExtrudeGeometry(prof, { depth: W, bevelEnabled: false, curveSegments: 12 });
    // shape x -> world z, shape y -> world y, extrusion -> world x (axis swap flips winding: render double-sided)
    dashGeo.applyMatrix4(new THREE.Matrix4().set(0, 0, 1, -W / 2, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1));
    dashGeo.computeVertexNormals();
    const dash = new THREE.Mesh(dashGeo, soft); g.add(dash);
    // stitched accent strip along the dash edge
    const strip = new THREE.Mesh(new THREE.BoxGeometry(W * 0.96, 0.012, 0.012), paintTrim); strip.position.set(0, topY - 0.02, faceZ + 0.07); g.add(strip);
    // leather-wrapped, stitched dash top pad and a brushed-aluminium inlay across the fascia
    const pad = new THREE.Mesh(new RoundedBoxGeometry(W * 0.9, 0.035, 0.22, 2, 0.015), leatherTop); pad.position.set(0, topY - 0.005, faceZ - 0.06); pad.rotation.x = 0.08; g.add(pad);
    const inlay = new THREE.Mesh(new THREE.BoxGeometry(W * 0.86, 0.022, 0.006), alu); inlay.position.set(0, topY - 0.17, faceZ + 0.075); g.add(inlay);
    // ---- instrument binnacle + cluster
    const ctex = this.clusterCanvas = document.createElement('canvas'); ctex.width = 1024; ctex.height = 384;
    this.clusterTex = new THREE.CanvasTexture(ctex); this.clusterTex.colorSpace = THREE.SRGBColorSpace; this.clusterTex.anisotropy = 4;
    const cw = 0.4, ch = 0.15;
    const cluster = new THREE.Mesh(new THREE.PlaneGeometry(cw, ch), new THREE.MeshBasicMaterial({ map: this.clusterTex, toneMapped: false }));
    cluster.position.set(eye.x, topY + 0.02, faceZ - 0.03); cluster.rotation.x = -0.3; g.add(cluster);
    const cglass = new THREE.Mesh(new THREE.PlaneGeometry(cw * 1.04, ch * 1.08), glassSheen(0.8)); cglass.position.copy(cluster.position).add(new THREE.Vector3(0, 0.004, 0.012)); cglass.rotation.x = -0.36; g.add(cglass);
    const hood = new THREE.Mesh(new THREE.CylinderGeometry(0.23, 0.23, 0.18, 24, 1, true, -Math.PI / 2, Math.PI), trim);
    hood.material.side = THREE.DoubleSide; hood.rotation.x = Math.PI / 2 - 0.12; hood.scale.set(1, 1, 0.42); hood.position.set(eye.x, topY + 0.02, faceZ - 0.05); g.add(hood);
    // shift lights
    this.shiftLeds = [];
    for (let i = 0; i < 9; i++) {
      const m = new THREE.MeshBasicMaterial({ color: i < 4 ? '#36ff6a' : i < 7 ? '#ffcc22' : '#ff2a2a', toneMapped: false, transparent: true, opacity: 0.12 });
      const led = new THREE.Mesh(new THREE.CircleGeometry(0.0075, 10), m);
      led.position.set(eye.x + (i - 4) * 0.02, topY + 0.105, faceZ - 0.035); led.rotation.x = -0.3; g.add(led); this.shiftLeds.push(m);
    }
    // ---- centre console + nav screen
    const cons = new THREE.Mesh(new RoundedBoxGeometry(0.26, 0.36, 0.5, 2, 0.03), trim); cons.position.set(0, topY - 0.42, faceZ + 0.28); cons.rotation.x = 0.35; g.add(cons);
    const ncan = this.navCanvas = document.createElement('canvas'); ncan.width = 256; ncan.height = 160;
    this.navTex = new THREE.CanvasTexture(ncan); this.navTex.colorSpace = THREE.SRGBColorSpace;
    const nav = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.125), new THREE.MeshBasicMaterial({ map: this.navTex, toneMapped: false }));
    nav.position.set(0, topY - 0.13, faceZ + 0.08); nav.rotation.x = -0.32; g.add(nav);
    const navBezel = new THREE.Mesh(new RoundedBoxGeometry(0.22, 0.145, 0.02, 2, 0.008), new THREE.MeshStandardMaterial({ color: '#0b0b0c', roughness: 0.3, metalness: 0.5 })); navBezel.position.copy(nav.position).add(new THREE.Vector3(0, 0, -0.012)); navBezel.rotation.x = -0.32; g.add(navBezel);
    // vents
    for (const sx of [-1, 1]) {
      const v = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.03, 18), alu); v.rotation.x = Math.PI / 2 - 0.25; v.position.set(sx * (W / 2 - 0.12), topY - 0.1, faceZ + 0.08); g.add(v);
    }
    // gear lever
    const lever = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.012, 0.18, 8), alu); lever.position.set(0, topY - 0.25, faceZ + 0.45); lever.rotation.x = -0.3; g.add(lever);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.03, 14, 10), new THREE.MeshStandardMaterial({ color: '#111', roughness: 0.25, metalness: 0.4 })); knob.position.set(0, topY - 0.16, faceZ + 0.42); g.add(knob);
    this.lever = lever; this.knob = knob;
    // ---- steering wheel
    const wheel = this.wheel = new THREE.Group();
    wheel.position.copy(wheelC); wheel.rotation.order = 'XYZ';
    this.wheelTilt = -0.36;
    const spin = this.wheelSpin = new THREE.Group(); wheel.add(spin);
    const r = 0.18;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(r, 0.018, 16, 64), trimMat('#161514', { rough: 0.5, scale: 0.05, nk: 0.9, }));
    spin.add(rim);
    const topMark = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.04, 0.038), paintTrim); topMark.position.set(0, r, 0); spin.add(topMark);
    for (const a of [0, Math.PI, -Math.PI / 2]) {
      const sp = new THREE.Mesh(new THREE.BoxGeometry(r * 0.9, 0.03, 0.014), alu); sp.position.set(Math.cos(a) * r * 0.5, Math.sin(a) * r * 0.5, -0.01); sp.rotation.z = a; spin.add(sp);
    }
    const hub = new THREE.Mesh(new RoundedBoxGeometry(0.15, 0.1, 0.05, 3, 0.02), trimMat('#141416', { rough: 0.6, scale: 0.1, nk: 0.5 })); hub.position.z = -0.02; spin.add(hub);
    const badge = new THREE.Mesh(new THREE.CircleGeometry(0.025, 20), paintTrim); badge.position.z = 0.007; spin.add(badge);
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 0.28, 12), trim); col.rotation.x = Math.PI / 2; col.position.z = -0.15; wheel.add(col);
    // paddles
    for (const sx of [-1, 1]) { const pd = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.06, 0.005), trim); pd.position.set(sx * 0.12, 0.03, -0.05); wheel.add(pd); }
    wheel.rotation.x = this.wheelTilt;
    g.add(wheel);
    // ---- mirrors (render-target views)
    this.mirrorMat = new THREE.MeshBasicMaterial({ map: mirrorTex, toneMapped: true });
    const mirrorGeo = new THREE.PlaneGeometry(0.22, 0.062);
    const uv = mirrorGeo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i)); // mirrored
    let mY, mZ;
    if (spec.body === 'mini') { mY = 1.31; mZ = -0.36; }
    else { const sh = model.shape; mY = sh.H - 0.1; mZ = -sh.roofT[1] * sh.L / 2 + 0.06; }
    const mirror = new THREE.Mesh(mirrorGeo, this.mirrorMat); mirror.position.set(0, mY, mZ); mirror.rotation.y = 0.12; mirror.rotation.x = -0.05;
    const mframe = new THREE.Mesh(new RoundedBoxGeometry(0.236, 0.076, 0.03, 2, 0.012), new THREE.MeshStandardMaterial({ color: '#0e0e0f', roughness: 0.4 }));
    mframe.position.set(0, mY, mZ - 0.017); mframe.rotation.copy(mirror.rotation);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.08, 6), mframe.material); stem.position.set(0, mY + 0.05, mZ - 0.02);
    g.add(mirror, mframe, stem);
    // door mirrors on the body show the same view (cropped)
    for (const k of ['mirrorL', 'mirrorR']) {
      const m = model[k]; if (!m) continue;
      const mg = m.geometry.clone(); const u2 = mg.attributes.uv;
      for (let i = 0; i < u2.count; i++) { const x = u2.getX(i); u2.setX(i, k === 'mirrorL' ? 0.55 - x * 0.45 : 1 - x * 0.45); }
      m.geometry = mg; m.material = this.mirrorMat; m.scale.set(1.25, 1.35, 1);
    }
    // ---- door cards / A-pillars / headliner from the loft (closed cars)
    if (model.bodyMesh) {
      const shellMat = [trimMat('#3a3836', { rough: 0.95, scale: 0.05, nk: 0.35, side: THREE.BackSide, sheen: 0.25 }),
        new THREE.MeshPhysicalMaterial({ color: 0x000000, roughness: 0.03, transparent: true, blending: THREE.AdditiveBlending, side: THREE.BackSide, depthWrite: false, envMap: CAR_ENV.tex, envMapIntensity: 0.6 }),
        trimMat('#1f1e1d', { rough: 0.8, scale: 0.16, nk: 0.5, side: THREE.BackSide })];
      const shell = new THREE.Mesh(model.bodyMesh.geometry, shellMat); shell.scale.setScalar(0.995); shell.position.y = 0.003;
      g.add(shell); this.shell = shell;
    }
    // door top rails + grab handles for all
    for (const sx of [-1, 1]) {
      const rail = new THREE.Mesh(new RoundedBoxGeometry(0.08, 0.05, 1.1, 2, 0.02), spec.body === 'mini' ? soft : trim);
      rail.position.set(sx * (W / 2 + 0.03), (spec.body === 'mini' ? 0.97 : model.shape.belt + 0.02), eye.z - 0.15); g.add(rail);
    }
    g.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = true; } });
    this.wheelEuler = new THREE.Euler(this.wheelTilt, 0, 0, 'XYZ');
    this.wheelInfo = { pos: wheelC, angle: 0, euler: this.wheelEuler, r };
    this.frame = 0;
  }
  /** steer: front wheel angle (rad) */
  update(dt, st) {
    const ang = -st.steerInput * 2.35;
    this.wheelSpin.rotation.z = ang; this.wheelInfo.angle = ang;
    // shift lights
    const k = clamp((st.rpm / st.redline - 0.7) / 0.27, 0, 1);
    const blink = st.rpm > st.redline * 0.97 && Math.sin(performance.now() * 0.05) > 0;
    this.shiftLeds.forEach((m, i) => { m.opacity = blink ? 1 : (i / 8 < k ? 1 : 0.1); });
    this.knob.position.x = this.lever.position.x = (st.gear % 2 ? -1 : 1) * 0.015;
    if ((this.frame++ & 1) === 0) this.drawCluster(st);
  }
  /** analogue instruments: the static faces are painted once, needles and the digital centre every other frame */
  drawCluster(st) {
    const c = this.clusterCanvas, g = c.getContext('2d'); const W = c.width, H = c.height;
    const T0 = Math.PI * 0.75, T1 = Math.PI * 2.25; // 270 degree sweep
    const vmax = Math.max(200, Math.ceil((this.spec.vmax + 20) / 40) * 40);
    const rmax = Math.ceil(st.redline * 1.1 / 1000) * 1000;
    const dials = [{ x: 220, y: 196, R: 168, max: rmax, major: 1000, minor: 250, label: (v) => String(v / 1000), red: st.redline, unit: 'x1000 r/min' },
      { x: 804, y: 196, R: 168, max: vmax, major: vmax > 260 ? 40 : 20, minor: 10, label: (v) => String(v), red: Infinity, unit: 'km/h' }];
    if (!this.faceCache || this.faceKey !== rmax + '/' + vmax) {
      const fc = this.faceCache = document.createElement('canvas'); fc.width = W; fc.height = H; this.faceKey = rmax + '/' + vmax;
      const f = fc.getContext('2d');
      const bg = f.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, '#0d0e10'); bg.addColorStop(1, '#030304');
      f.fillStyle = bg; f.fillRect(0, 0, W, H);
      for (const d of dials) {
        // bezel and face
        const bz = f.createLinearGradient(d.x - d.R, d.y - d.R, d.x + d.R, d.y + d.R); bz.addColorStop(0, '#d9dde2'); bz.addColorStop(0.5, '#5c6168'); bz.addColorStop(1, '#c4c9cf');
        f.beginPath(); f.arc(d.x, d.y, d.R + 10, 0, Math.PI * 2); f.fillStyle = bz; f.fill();
        const fg = f.createRadialGradient(d.x, d.y - d.R * 0.3, d.R * 0.1, d.x, d.y, d.R); fg.addColorStop(0, '#1b1d21'); fg.addColorStop(1, '#060607');
        f.beginPath(); f.arc(d.x, d.y, d.R, 0, Math.PI * 2); f.fillStyle = fg; f.fill();
        // red zone
        if (d.red < d.max) { f.beginPath(); f.arc(d.x, d.y, d.R - 14, T0 + (T1 - T0) * d.red / d.max, T1); f.lineWidth = 16; f.strokeStyle = '#c4161c'; f.stroke(); }
        // ticks + numerals
        f.textAlign = 'center'; f.textBaseline = 'middle';
        for (let v = 0; v <= d.max + 0.1; v += d.minor) {
          const a = T0 + (T1 - T0) * v / d.max, major = Math.abs(v / d.major - Math.round(v / d.major)) < 1e-6;
          const r0 = d.R - (major ? 30 : 18), r1 = d.R - 6;
          f.beginPath(); f.moveTo(d.x + Math.cos(a) * r0, d.y + Math.sin(a) * r0); f.lineTo(d.x + Math.cos(a) * r1, d.y + Math.sin(a) * r1);
          f.lineWidth = major ? 5 : 2.5; f.strokeStyle = v >= d.red ? '#ff4a4a' : '#eef1f4'; f.stroke();
          if (major) { f.fillStyle = v >= d.red ? '#ff5a5a' : '#f2f4f6'; f.font = '600 30px "Barlow", Arial, sans-serif'; f.fillText(d.label(v), d.x + Math.cos(a) * (d.R - 56), d.y + Math.sin(a) * (d.R - 56)); }
        }
        f.fillStyle = '#8d949c'; f.font = '600 17px "Barlow", Arial, sans-serif'; f.fillText(d.unit, d.x, d.y + d.R * 0.42);
      }
      // centre display frame
      f.fillStyle = '#07080a'; f.strokeStyle = '#2a2d33'; f.lineWidth = 3;
      f.beginPath(); f.roundRect(418, 70, 188, 250, 18); f.fill(); f.stroke();
    }
    g.drawImage(this.faceCache, 0, 0);
    // digital centre: gear, speed, nitro
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = '#ffffff'; g.font = '700 118px "Barlow Condensed", Arial, sans-serif'; g.fillText(st.gearLabel, 512, 158);
    g.fillStyle = '#9fd8ff'; g.font = '600 40px "Barlow", Arial, sans-serif'; g.fillText(String(Math.round(st.kmh)), 512, 248);
    g.fillStyle = '#5c6670'; g.font = '600 16px "Barlow", Arial, sans-serif'; g.fillText('NITRO', 512, 282);
    g.fillStyle = '#1b1e24'; g.fillRect(442, 294, 140, 8);
    g.fillStyle = st.nitroOn ? '#9ff0ff' : '#2aa8ff'; g.fillRect(442, 294, 140 * clamp(st.nitro, 0, 1), 8);
    // needles (with a soft glow) and caps
    const val = [clamp(st.rpm, 0, dials[0].max), clamp(st.kmh, 0, dials[1].max)];
    dials.forEach((d, i) => {
      const a = T0 + (T1 - T0) * val[i] / d.max;
      g.save(); g.translate(d.x, d.y); g.rotate(a);
      g.shadowColor = 'rgba(255,90,40,0.9)'; g.shadowBlur = 14;
      g.fillStyle = '#ff5a24'; g.beginPath(); g.moveTo(-26, -5); g.lineTo(d.R - 18, -1.5); g.lineTo(d.R - 18, 1.5); g.lineTo(-26, 5); g.closePath(); g.fill();
      g.restore();
      const cap = g.createRadialGradient(d.x - 6, d.y - 6, 2, d.x, d.y, 24); cap.addColorStop(0, '#5a5f66'); cap.addColorStop(1, '#141518');
      g.beginPath(); g.arc(d.x, d.y, 22, 0, Math.PI * 2); g.fillStyle = cap; g.fill();
    });
    this.clusterTex.needsUpdate = true;
  }
  setVisible(v) { this.group.visible = v; }
}
