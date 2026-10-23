import {groundIndex} from './world-tile-ground.js';
import {vegetationContactIndex,vegetationRadius,streetTreeHeight} from './vegetation-clearance.js';
// Street trees of the streamed Athens world, derived when a tile is read (src/world-tile-buildings.js addDerivedBuildings): along the quiet streets of
// the tile's own road graph, on the right of every directed edge (a two-way street has both directions, so both kerbs), one tree every 11 to 17 m, a pit
// beyond the carriageway. Athens plants bitter oranges along its residential streets, with the odd palm and cypress. A tree is dropped where it would stand
// in a building, near another road (a crossing, a junction mouth) or near another tree. Rows are tile-local metres: x, y, z, yaw, species * 8 + size.
// Nothing travels on the wire; the rows are about 14 KB for a dense cell. Rendered by src/athens-trees.js, which World detail Off hides.
export const TREE = Object.freeze({ orange: 0, pine: 1, cypress: 2, palm: 3, oleander: 4 });
export const STREET_TREE_LIMIT = 700;
export const CELL = 12, hashN = n => { let h = (n ^ 0x9e3779b9) >>> 0; h = Math.imul(h ^ (h >>> 16), 0x85ebca6b); h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35); return (h ^ (h >>> 16)) >>> 0; };
export const inRing = (ring, x, z) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) if ((ring[i][1] > z) !== (ring[j][1] > z) && x < (ring[j][0] - ring[i][0]) * (z - ring[i][1]) / (ring[j][1] - ring[i][1]) + ring[i][0]) inside = !inside;
  return inside;
};
/** `rings`: the tile's building footprints (arrays of [x, z]); `inQuarter(x, z)`: tile-local point in an old quarter. Returns the Float32Array of rows. */
export function deriveStreetTrees(t, rings, inQuarter = () => false, {blocked = () => false, landSurfaceIds = null, pavedGroundTriangles = null, setbacks = true} = {}) {
  const out = [], n = t.edges.length / 10;
  if (!n) return new Float32Array(0);
  // grids: building rings by cell, road segments by cell
  const bGrid = new Map(), sGrid = new Map(), tGrid = new Map(), add = (grid, x0, z0, x1, z1, item) => { for (let i = Math.floor(Math.min(x0, x1) / CELL); i <= Math.floor(Math.max(x0, x1) / CELL); i++) for (let j = Math.floor(Math.min(z0, z1) / CELL); j <= Math.floor(Math.max(z0, z1) / CELL); j++) { const k = i * 4096 + j; (grid.get(k) || grid.set(k, []).get(k)).push(item); } };
  for (const ring of rings) { let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity; for (const p of ring) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); } add(bGrid, x0, z0, x1, z1, ring); }
  const E = t.edges, P = t.edgePoints;
  // Hosted cells retain full shoulder contacts. Old kerb seeds often fall inside
  // those contacts: find a real clear setback, never weaken the crown contract.
  const hasSurface=setbacks&&!!(t.fineTriangles?.length||t.contactTriangles?.length), ground=hasSurface?groundIndex(t):null, clearance=hasSurface?vegetationContactIndex(t):null;
  // A mapped sidewalk, pedestrian square or deck is not spare garden land,
  // even when its contacts are non-drivable. Only terrain may hold new seeds.
  const landClearance=hasSurface&&landSurfaceIds&&t.fineSurface?vegetationContactIndex({...t,contactTriangles:new Uint32Array(),fineFlags:Uint8Array.from(t.fineSurface,(id,i)=>landSurfaceIds.has(id)&&!pavedGroundTriangles?.[i]?0:1)}):null;
  const buildingClear=(x,z,radius)=>near(bGrid,x,z,radius).every(ring=>{
    if(inRing(ring,x,z))return false;
    for(let i=0;i<ring.length;i++){const a=ring[i],b=ring[(i+1)%ring.length],dx=b[0]-a[0],dz=b[1]-a[1],u=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz||1)));if(Math.hypot(x-a[0]-u*dx,z-a[1]-u*dz)<radius)return false;}
    return true;
  });
  for (let e = 0; e < n; e++) for (let k = E[e * 10 + 3]; k < E[e * 10 + 3] + E[e * 10 + 4] - 1; k++) add(sGrid, P[k * 3], P[k * 3 + 2], P[k * 3 + 3], P[k * 3 + 5], [e, P[k * 3], P[k * 3 + 2], P[k * 3 + 3], P[k * 3 + 5]]);
  const near = (grid, x, z, pad) => { const out2 = []; for (let i = Math.floor((x - pad) / CELL); i <= Math.floor((x + pad) / CELL); i++) for (let j = Math.floor((z - pad) / CELL); j <= Math.floor((z + pad) / CELL); j++) { const l = grid.get(i * 4096 + j); if (l) out2.push(...l); } return out2; };
  for (let e = 0; e < n && out.length < STREET_TREE_LIMIT * 5; e++) {
    const o = e * 10, lanes = E[o + 6], speed = E[o + 7], flags = E[o + 8], first = E[o + 3], count = E[o + 4];
    if ((flags & 6) || (t.edgeLayers && t.edgeLayers[e] !== 0) || lanes > 2 || speed > (setbacks?50:40) || count < 2) continue;
    const half = (lanes >= 2 ? 3.2 : 2.5) + 2.1, id = E[o];
    let length = 0; for (let k = 0; k < count - 1; k++) length += Math.hypot(P[(first + k + 1) * 3] - P[(first + k) * 3], P[(first + k + 1) * 3 + 2] - P[(first + k) * 3 + 2]);
    if (length < 30) continue;
    let s = 8 + (hashN(id) % 700) / 100, walked = 0, seg = 0, segStart = 0;
    while (s < length - 8) {
      while (seg < count - 2 && walked + Math.hypot(P[(first + seg + 1) * 3] - P[(first + seg) * 3], P[(first + seg + 1) * 3 + 2] - P[(first + seg) * 3 + 2]) < s) { walked += Math.hypot(P[(first + seg + 1) * 3] - P[(first + seg) * 3], P[(first + seg + 1) * 3 + 2] - P[(first + seg) * 3 + 2]); seg++; }
      const a = first + seg, ax = P[a * 3], ay = P[a * 3 + 1], az = P[a * 3 + 2], bx = P[a * 3 + 3], by = P[a * 3 + 4], bz = P[a * 3 + 5], l = Math.hypot(bx - ax, bz - az) || 1, f = Math.min(1, Math.max(0, (s - walked) / l));
      const tx = (bx - ax) / l, tz = (bz - az) / l, h = hashN(id * 977 + Math.round(s * 10));
      let x = ax + (bx - ax) * f - tz * half, z = az + (bz - az) * f + tx * half, y = ay + (by - ay) * f;
      const kind = (h >>> 16) % 100, species = kind < 88 ? TREE.orange : kind < 94 ? TREE.palm : TREE.cypress, variant=(h >>> 20) % 8;
      s += 11 + (h % 600) / 100;
      if(clearance){
        const radius=vegetationRadius(species,streetTreeHeight(species,variant));let found=false;
        for(const setback of [half,half+4,half+8,half+12,half+16]){
          const px=ax+(bx-ax)*f-tz*setback,pz=az+(bz-az)*f+tx*setback;
          if(!clearance.clear(px,pz,radius)||landClearance?.intersects(px,pz,radius)||!buildingClear(px,pz,radius))continue;
          // The caller excludes authored gardens with the whole crown square.
          if(blocked(px,pz,radius))continue;
          const py=ground.heightAt(px,pz),ys=[[radius,0],[-radius,0],[0,radius],[0,-radius]].map(([dx,dz])=>ground.heightAt(px+dx,pz+dz));
          if(!Number.isFinite(py)||py<=0||ys.some(v=>!Number.isFinite(v)||Math.abs(v-py)>2))continue;
          x=px;z=pz;y=py;found=true;break;
        }
        if(!found)continue;
      }
      void segStart;
      const quarter = inQuarter(x, z); if ((h >>> 8) % 100 >= (quarter ? 38 : 66)) continue;
      let ok = true;
      for (const ring of near(bGrid, x, z, 2.5)) if (inRing(ring, x, z) || inRing(ring, x + 1.8, z) || inRing(ring, x - 1.8, z) || inRing(ring, x, z + 1.8) || inRing(ring, x, z - 1.8)) { ok = false; break; }
      if (!ok) continue;
      for (const [oe, x0, z0, x1, z1] of near(sGrid, x, z, 6)) { if (oe === e) continue; const dx = x1 - x0, dz = z1 - z0, q = dx * dx + dz * dz, u = q ? Math.max(0, Math.min(1, ((x - x0) * dx + (z - z0) * dz) / q)) : 0; if (Math.hypot(x - x0 - u * dx, z - z0 - u * dz) < 4.4) { ok = false; break; } }
      if (!ok) continue;
      for (const [tx2, tz2] of near(tGrid, x, z, 5)) if (Math.hypot(x - tx2, z - tz2) < 5) { ok = false; break; }
      if (!ok) continue;
      add(tGrid, x, z, x, z, [x, z]);
      out.push(x, y, z, ((h >>> 3) % 628) / 100, species * 8 + variant);
    }
  }
  return Float32Array.from(out.slice(0, STREET_TREE_LIMIT * 5));
}

/** Original proposal stream retained for collision-bearing parking and owned
 * coastal recipes. These seeds need not survive the later visual crown audit. */
export function deriveLegacyStreetTreeSeeds(t,rings,inQuarter=()=>false){
  return deriveStreetTrees(t,rings,inQuarter,{setbacks:false});
}
