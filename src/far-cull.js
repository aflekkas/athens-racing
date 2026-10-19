// Far cull (Potato only, graphics.js PERFORMANCE.farCull): the static world beyond a draw distance is not submitted at all.
// Owner 2026-10-19: "stop drawing distant road". The race road, terrain tiles, osm roads, block buildings and the far scenery are
// drawn out to the horizon on every class (a 5 km Riviera is ~100 of the ~200 calls of an empty Potato scene); here they stop at
// `distance` metres from the camera. The fog (env.js apFar, installed by setFarFog) is fully opaque at distance - FOG_MARGIN, so the
// cut edge is always inside the haze: nothing pops, the world just ends in the horizon colour.
// RENDER ONLY: this flips `visible` on meshes; physics, collision, the route, the minimap, traffic and the AI never read it.
import * as THREE from 'three';
import { AP_UNIFORMS } from './env.js';

/** metres inside the cut where the fog is already fully opaque (covers the 6-frame update cadence at 300 km/h: a chunk is shown at most ~14 m late) */
export const FOG_MARGIN = 40;
/** hysteresis: a chunk hidden at `distance + HYSTERESIS` comes back at `distance` */
export const HYSTERESIS = 30;
/** fog fade starts at this fraction of its end, so it reads as haze rather than a wall */
export const FOG_START = 0.3;

/** Set the far fog: opaque at `distance - FOG_MARGIN`, 0 (off) for distance <= 0. Uniform only: no shader recompile, other classes untouched. */
export function setFarFog(distance) {
  const end = distance > 0 ? Math.max(distance - FOG_MARGIN, 60) : 0;
  AP_UNIFORMS.apFar.value[0] = end * FOG_START; AP_UNIFORMS.apFar.value[1] = end;
}

const sphere = new THREE.Sphere(), box = new THREE.Box3();
/** distance from p to the nearest point of the entry's bounds (a lower bound of the distance to any of its vertices) */
function nearest(e, p) {
  let d = Math.max(0, p.distanceTo(e.center) - e.radius);
  if (e.box) d = Math.max(d, e.box.distanceToPoint(p));
  return d;
}

export class FarCull {
  constructor() { this.entries = []; this.lod = new Set(); this.active = 0; this.hidden = 0; }
  /** collect the static meshes of a finished map group. `lod` = the scenery LOD list (it rewrites visible itself every update). */
  bind(group, lod = []) {
    this.release(); this.entries = []; this.lod = new Set(lod);
    group.updateMatrixWorld(true);
    const visit = (o, still) => {
      still = still && o.matrixAutoUpdate === false;
      // userData.farCull: a part that never moves although its parents are not frozen (the signal lamps and halos)
      if ((o.isMesh || o.isPoints || o.isSprite) && (still || o.userData.farCull === true) && o.geometry && !o.userData.noFarCull) {
        const g = o.geometry;
        if (!g.boundingSphere) g.computeBoundingSphere();
        const s = o.boundingSphere || g.boundingSphere;
        if (s && isFinite(s.radius)) {
          sphere.copy(s).applyMatrix4(o.matrixWorld);
          if (o.isSprite) { sphere.center.setFromMatrixPosition(o.matrixWorld); sphere.radius = Math.max(sphere.radius * o.scale.x, 6); } // halos grow with distance (signals.js)
          let b = null; // a tight box where the positions are plain floats: a long thin road chunk has a loose sphere
          const pos = g.attributes.position;
          if (!o.isInstancedMesh && pos && !pos.isInterleavedBufferAttribute && !pos.normalized && pos.array instanceof Float32Array) {
            if (!g.boundingBox) g.computeBoundingBox();
            b = box.copy(g.boundingBox).applyMatrix4(o.matrixWorld).clone();
          }
          this.entries.push({ o, center: sphere.center.clone(), radius: sphere.radius, box: b, far: false, lod: this.lod.has(o) });
        }
      }
      for (const c of o.children) visit(c, still);
    };
    visit(group, true);
    return this.entries.length;
  }
  /** one pass: call after the scenery LOD update (it resets the visibility of its own chunks) */
  update(camera, distance) {
    if (!(distance > 0)) { if (this.active) this.release(); return; }
    this.active = distance; const p = camera.position; let hidden = 0;
    for (const e of this.entries) {
      const d = nearest(e, p);
      e.far = d > distance + HYSTERESIS || (e.far && d > distance);
      if (e.far) { hidden++; if (e.o.visible) { e.o.visible = false; e.hid = true; } }
      else if (e.hid) { if (!e.lod) e.o.visible = true; e.hid = false; }
    }
    this.hidden = hidden;
  }
  /** show everything this hid (class change back to a stronger one, world switch) */
  release() {
    for (const e of this.entries) if (e.hid) { if (!e.lod) e.o.visible = true; e.hid = false; e.far = false; }
    this.active = 0; this.hidden = 0;
  }
}
