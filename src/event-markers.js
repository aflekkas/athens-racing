import { twoSidedSignGeometry } from './sign-mount.js';
import { gantryLegFrame } from './gantry-legs.js';
import { signFace } from './world-prop-geometries.js';
// Event markers in the world: start / finish arches for events that don't use the fixed gantries of the full
// route (segments, reverse runs), and speed-camera posts for speed-trap events. Rebuilt per event, cheap.
import * as THREE from 'three';

export function bannerTex(text, bg, fg) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 96;
  const g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, 512, 96);
  // chequered ends
  for (let i = 0; i < 6; i++) for (let j = 0; j < 3; j++) { g.fillStyle = (i + j) % 2 ? '#111' : '#f4f4f4'; g.fillRect(i * 16, j * 32, 16, 32); g.fillRect(512 - 96 + i * 16, j * 32, 16, 32); }
  g.fillStyle = fg; g.font = 'italic 900 64px "Barlow Condensed", Arial Narrow, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 256, 52, 288);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

export class EventMarkers {
  constructor(scene, route) { this.scene = scene; this.route = route; this.group = new THREE.Group(); this.group.name = 'event-markers'; scene.add(this.group); }
  clear() {
    for (const o of [...this.group.children]) { this.group.remove(o); o.traverse((m) => { m.geometry?.dispose(); if (m.material) { m.material.map?.dispose(); m.material.dispose(); } }); }
  }
  /** r = resolved event (events.js resolve); fixed = { start, finish } s of the gantries road.js already built */
  build(r, fixed) {
    this.clear();
    const near = (s, f) => {
      if (!Number.isFinite(f)) return false;
      const d = Math.abs(this.route.closed ? this.route.wrap(s) - this.route.wrap(f) : s - f);
      return (this.route.closed ? Math.min(d, this.route.length - d) : d) < 4;
    };
    const fixedAt = (s) => near(s, fixed.start) || near(s, fixed.finish) || (this.route.fixedGantries || []).some(f => near(s, f));
    // an arch where the event starts / ends, unless a matching gantry already stands there (for reverse runs the
    // fixed gantries face the other way and say the opposite, so we add ours alongside)
    if (r.reverse || !fixedAt(r.s0)) this.arch(r.s0, 'START', '#ff3d2e', r.dir, r.reverse ? 6 : 0);
    if (r.reverse || !fixedAt(r.s1)) this.arch(r.s1, 'FINISH', '#f2f2f2', r.dir, r.reverse ? -6 : 0);
    for (const [i, t] of (r.traps || []).entries()) this.camera(t.s, i + 1, r.dir);
  }
  arch(s, text, tint, dir, offset = 0) {
    s += offset * dir;
    const route = this.route, half = route.edge(s) + 1.2;
    const poleM = new THREE.MeshStandardMaterial({ color: tint, roughness: 0.5, metalness: 0.3 });
    const g = gantryLegFrame(route, s, poleM, 'event', dir);
    const tex = bannerTex(text, text === 'START' ? '#d8261d' : '#0c0f14', '#ffffff');
    const ban = new THREE.Mesh(twoSidedSignGeometry(half * 2, half * .38, .45), new THREE.MeshBasicMaterial({ map: tex, side: THREE.FrontSide }));
    ban.position.y = 6.4; g.add(ban);
    this.group.add(g);
  }
  camera(s, n, dir) {
    const route = this.route, f = route.frame(s, {});
    const side = dir; // on the kerb of the racers' carriageway
    const u = side * (route.edge(s) + 1.4), p = route.point(s, u);
    const g = new THREE.Group(); g.position.copy(p); g.rotation.y = Math.atan2(f.tx, f.tz) + (dir > 0 ? Math.PI : 0);
    const metal = new THREE.MeshStandardMaterial({ color: '#c9ced4', roughness: 0.4, metalness: 0.6 });
    const pole = new THREE.Mesh(new THREE.BoxGeometry(0.07*2, 3.2, 0.09*2), metal); pole.position.y = 1.6; g.add(pole);
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.6, 0.7), new THREE.MeshStandardMaterial({ color: '#f2c200', roughness: 0.5 }));
    box.position.y = 3.3; g.add(box);
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.14, 16), new THREE.MeshBasicMaterial({ color: '#1a2633' })); lens.position.set(0, 3.32, -0.36); lens.rotation.y = Math.PI; g.add(lens);
    const tex = bannerTex('CAMERA ' + n, '#0b4ea2', '#ffffff');
    const sign = new THREE.Mesh(twoSidedSignGeometry(1.6, .3, .18), new THREE.MeshBasicMaterial({ map: tex, side: THREE.FrontSide })); sign.position.y = 2.6; g.add(sign);
    // a painted line across the racing carriageway
    const w = route.edge(s), line = new THREE.Mesh(new THREE.PlaneGeometry(w, 0.5), new THREE.MeshBasicMaterial({ color: '#f2c200', transparent: true, opacity: 0.75, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
    const lp = route.point(s, dir * w / 2); line.position.set(lp.x, lp.y + 0.03, lp.z);
    line.rotation.order = 'YXZ'; line.rotation.y = Math.atan2(f.tx, f.tz); line.rotation.x = -Math.PI / 2;
    this.group.add(line);
    this.group.add(g);
  }
}
