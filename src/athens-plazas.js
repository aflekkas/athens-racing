// Paved squares of the streamed Athens world. The ground bake has no class for an OSM square (place=square, a pedestrian area), so it is plain
// earth: Syntagma and Monastiraki read as sand. `assets/athens/plazas.json` (tools/world-gen/plazas.py) holds their outlines, 590 of them in 64 KB;
// near the camera each outline is laid over the streamed ground as paving, a grid of triangles that follow the terrain (2 m within 130 m of the
// camera, 4 m beyond; the grid cells whose centre lies inside the outline, so an edge steps by up to 1 or 2 m, which is paving stones). One mesh, one draw call, rebuilt when the camera has
// moved 60 m or a cell arrived. The outlines are grown 8 m by the extractor (OSM maps the strip beside a square as lines); cells that are carriageway are skipped. The paving is the shared paver scan of the roads. World detail Off hides it.
import * as THREE from 'three';

export const PLAZA_CELL = 512, PLAZA_STEP = 4, PLAZA_FINE_STEP = 2, PLAZA_FINE_RADIUS = 130, PLAZA_RADIUS = 330, PLAZA_LIFT = .05, PLAZA_MAX_TRIANGLES = 30000, PLAZA_REBUILD_METRES = 60;
/** Parse plazas.json into outlines in metres with their bounds, indexed by the 512 m cells they touch. */
export function parsePlazas(json) {
  const u = json.unit, plazas = json.plazas.map(flat => {
    const p = new Float32Array(flat.length); let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (let i = 0; i < flat.length; i += 2) { p[i] = flat[i] * u; p[i + 1] = flat[i + 1] * u; x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]); z0 = Math.min(z0, p[i + 1]); z1 = Math.max(z1, p[i + 1]); }
    let a = 0; for (let i = 0; i < p.length; i += 2) { const j = (i + 2) % p.length; a += p[i] * p[j + 1] - p[j] * p[i + 1]; }
    return { p, x0, z0, x1, z1, area: Math.abs(a) / 2 };
  });
  return plazas;
}
export function pointInPlaza(p, x, z) {
  let inside = false;
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) if ((p[i + 1] > z) !== (p[j + 1] > z) && x < (p[j] - p[i]) * (z - p[i + 1]) / (p[j + 1] - p[i + 1]) + p[i]) inside = !inside;
  return inside;
}
/** Distance from (x, z) to the outline (0 inside). */
export function plazaDistance(p, x, z) {
  if (pointInPlaza(p, x, z)) return 0;
  let best = Infinity;
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
    const ax = p[j], az = p[j + 1], bx = p[i], bz = p[i + 1], dx = bx - ax, dz = bz - az, l = dx * dx + dz * dz, t = l ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l)) : 0;
    best = Math.min(best, Math.hypot(x - ax - t * dx, z - az - t * dz));
  }
  return best;
}
export class AthensPlazas {
  /** `parent`: the group in absolute world metres; `material`: the paving; `groundAt(x, z, y)`: streamed ground height or null; `isRoad(x, z, y)`: is the ground there drivable asphalt. */
  constructor(parent, { enabled = true, groundAt = null, isRoad = null, material, extra = [] } = {}) {
    this.extra = extra; this.groundAt = groundAt; this.isRoad = isRoad; this.enabled = enabled; this.plazas = [...extra]; this.keys = new Set(); this.dirty = true; this.last = { x: Infinity, z: Infinity };
    this.stats = { triangles: 0, plazas: 0, rebuilds: 0, ms: 0 };
    this.position = new THREE.BufferAttribute(new Float32Array(PLAZA_MAX_TRIANGLES * 9), 3); this.position.setUsage(THREE.DynamicDrawUsage);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', this.position); g.setDrawRange(0, 0); g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    material.side = THREE.DoubleSide; material.polygonOffset = true; material.polygonOffsetFactor = -1; material.polygonOffsetUnits = -1;
    this.mesh = new THREE.Mesh(g, material); this.mesh.name = 'athens-plazas'; this.mesh.frustumCulled = false; this.mesh.visible = false; this.mesh.renderOrder = 1; parent.add(this.mesh);
  }
  async load(url) { const r = await fetch(url); if (!r.ok) throw new Error('Athens plaza data is not hosted on this server'); this.setPlazas(parsePlazas(await r.json())); }
  setPlazas(plazas) { this.plazas = [...plazas, ...this.extra]; this.dirty = true; }
  addTile(key) { this.keys.add(key); this.dirty = true; }
  removeTile(key) { this.keys.delete(key); this.dirty = true; }
  setEnabled(on) { this.enabled = on; this.mesh.visible = on && this.stats.triangles > 0; this.dirty = true; }
  /** `ax, az`: the camera's absolute position, `ay` its height (the layer-0 ground is asked for). */
  update(ax, ay, az) {
    if (!this.enabled || !this.plazas.length || !this.groundAt) return;
    if (!this.dirty && Math.hypot(ax - this.last.x, az - this.last.z) < PLAZA_REBUILD_METRES) return;
    this.rebuild(ax, ay, az);
  }
  rebuild(ax, ay, az) {
    const t0 = performance.now(), P = this.position.array, R = PLAZA_RADIUS; let tri = 0, used = 0;
    const loaded = (x, z) => this.keys.has(`${Math.floor(x / PLAZA_CELL)},${Math.floor(z / PLAZA_CELL)}`);
    const near = [];
    for (const pl of this.plazas) {
      if (pl.x1 < ax - R || pl.x0 > ax + R || pl.z1 < az - R || pl.z0 > az + R) continue;
      const d = plazaDistance(pl.p, ax, az); if (d < R) near.push({ pl, d });
    }
    near.sort((a, b) => a.d - b.d);
    for (const { pl, d } of near) {
      const S = pl.area > 60000 ? 6 : d < PLAZA_FINE_RADIUS && pl.area < 30000 ? PLAZA_FINE_STEP : PLAZA_STEP;
      const x0 = Math.floor(Math.max(pl.x0, ax - R) / S) * S, x1 = Math.min(pl.x1, ax + R), z0 = Math.floor(Math.max(pl.z0, az - R) / S) * S, z1 = Math.min(pl.z1, az + R);
      const nx = Math.ceil((x1 - x0) / S) + 1, nz = Math.ceil((z1 - z0) / S) + 1, heights = new Float32Array((nx + 1) * (nz + 1)).fill(NaN);
      const h = (i, j) => { const k = j * (nx + 1) + i; if (Number.isNaN(heights[k])) { const x = x0 + i * S, z = z0 + j * S, y = loaded(x, z) ? this.groundAt(x, z, ay) : null; heights[k] = y === null || !Number.isFinite(y) ? -1e9 : y; } return heights[k]; };
      let any = false;
      for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
        const cx = x0 + (i + .5) * S, cz = z0 + (j + .5) * S; if (Math.hypot(cx - ax, cz - az) > R || !pointInPlaza(pl.p, cx, cz)) continue;
        if (this.isRoad && loaded(cx, cz) && this.isRoad(cx, cz, ay)) continue; // an outline grown over a street (the rim of a square): the carriageway stays asphalt
        const a = h(i, j), b = h(i + 1, j), c = h(i, j + 1), d = h(i + 1, j + 1); if (a < -1e8 || b < -1e8 || c < -1e8 || d < -1e8) continue;
        if (tri + 2 > PLAZA_MAX_TRIANGLES) break;
        const xa = x0 + i * S, xb = xa + S, za = z0 + j * S, zb = za + S, o = tri * 9, y = PLAZA_LIFT;
        P.set([xa, a + y, za, xb, b + y, za, xa, c + y, zb, xb, b + y, za, xb, d + y, zb, xa, c + y, zb], o); tri += 2; any = true;
      }
      if (any) used++;
    }
    this.position.needsUpdate = true; this.mesh.geometry.setDrawRange(0, tri * 3); this.mesh.visible = this.enabled && tri > 0;
    this.last = { x: ax, z: az }; this.dirty = false; this.stats = { triangles: tri, plazas: used, rebuilds: this.stats.rebuilds + 1, ms: performance.now() - t0 };
  }
  dispose() { this.mesh.removeFromParent(); this.mesh.geometry.dispose(); this.mesh.material.dispose(); }
}

/** Marble slabs painted on the plaza: 1.2 m slabs with dark joints (faded out where they would shimmer), each slab a little lighter or darker, a few big stains. */
export function plazaMaterial() {
  const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(.5, .485, .45) });
  m.customProgramCacheKey = () => 'athens-plaza-v1';
  m.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vPlazaP;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvPlazaP=position.xz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
varying vec2 vPlazaP;float ph(vec2 c){return fract(sin(dot(c,vec2(12.9898,78.233)))*43758.5453);}`).replace('#include <color_fragment>', `#include <color_fragment>
{vec2 g=vPlazaP/1.2,c=floor(g),f=abs(fract(g)-.5);float joint=smoothstep(.465,.5,max(f.x,f.y))*(1.-smoothstep(.12,.4,max(fwidth(g.x),fwidth(g.y))));
float big=ph(floor(vPlazaP/9.));diffuseColor.rgb*=(.93+.14*ph(c))*(.94+.1*big)*(1.-.22*joint)*mix(1.,.9,smoothstep(.12,.4,max(fwidth(g.x),fwidth(g.y))));}`);
  };
  return m;
}

/** Lawn for the garden outlines (assets/athens/lawns.json): the grass colour of the bake's ground class with soft patches and a fine grain, so it sits in the lawns around it. */
export function lawnMaterial() {
  const m = new THREE.MeshBasicMaterial({ color: new THREE.Color('#8ba352') });
  m.customProgramCacheKey = () => 'athens-lawn-v1';
  m.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vLawnP;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvLawnP=position.xz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
varying vec2 vLawnP;float lh(vec2 c){return fract(sin(dot(c,vec2(12.9898,78.233)))*43758.5453);}
float ln(vec2 p){vec2 i=floor(p),f=fract(p),u=f*f*(3.-2.*f);return mix(mix(lh(i),lh(i+vec2(1,0)),u.x),mix(lh(i+vec2(0,1)),lh(i+vec2(1,1)),u.x),u.y);}`).replace('#include <color_fragment>', `#include <color_fragment>
{float blotch=ln(vLawnP/7.),fine=ln(vLawnP*1.7);float fade=smoothstep(.1,.35,max(fwidth(vLawnP.x),fwidth(vLawnP.y)));diffuseColor.rgb*=mix((.82+.3*blotch)*(.94+.12*fine),.94,fade);}`);
  };
  return m;
}
