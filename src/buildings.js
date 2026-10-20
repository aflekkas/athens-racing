// Owner-locked: flat-roof footprint blocks, batched in 500 metre world cells.
import * as THREE from 'three';
import { createFacadeAtlas, attachFacadeAtlas } from './facade-atlas.js';
import { buildingStyle } from './world-detail-policy.js';
import { bakeBlockShade } from './baked-realism.js';
import { REFLECT_LAYER } from './env.js';
import { RNG, GeoBatch, M, pointInPoly, polyArea, polyBounds, clamp } from './util.js';
import { infillStreetIndex } from './infill-streets.js';
import { WORLD_TRIANGLE_BUDGETS, assertWorldBudget } from './world-art-direction.js';
export const BUILDING_PALETTE = Object.freeze(['#f4f5f6','#e9edf1','#ffffff','#d7dfe7','#f0f2f5','#b8d5e6','#c78472','#e2bf72']);
export function facadeMaterial(atlas) { const m=new THREE.MeshStandardMaterial({vertexColors:true,roughness:1}); return atlas?attachFacadeAtlas(m,atlas):m; }
export class LabelAtlas {
  constructor(cols = 4, rows = 64, cw = 512, ch = 80) {
    this.cols = cols; this.rows = rows; this.cw = cw; this.ch = ch; this.n = 0;
    this.canvas = document.createElement('canvas'); this.canvas.width = cols * cw; this.canvas.height = rows * ch;
    this.g = this.canvas.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.canvas); this.tex.colorSpace = THREE.SRGBColorSpace; this.tex.anisotropy = 8;
    this.mat = new THREE.MeshStandardMaterial({ map: this.tex, roughness: 0.55, emissive: '#ffffff', emissiveMap: this.tex, emissiveIntensity: 0.18 });
  }
  add(text, bg, fg, style = 'bold') {
    if (this.n >= this.cols * this.rows) return null;
    const i = this.n++, cx = (i % this.cols) * this.cw, cy = Math.floor(i / this.cols) * this.ch;
    const g = this.g;
    g.fillStyle = bg; g.fillRect(cx, cy, this.cw, this.ch);
    g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
    let px = 60;
    const fam = style === 'serif' ? 'Georgia, serif' : '"Barlow Condensed", "Arial Narrow", sans-serif';
    const wgt = style === 'serif' ? 'italic 700' : '800';
    do { g.font = `${wgt} ${px}px ${fam}`; px -= 2; } while (g.measureText(text).width > this.cw - 36 && px > 20);
    g.fillText(text, cx + this.cw / 2, cy + this.ch / 2 + 3, this.cw - 36);
    g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(cx, cy, this.cw, 4);
    this.tex.needsUpdate = true;
    return [cx / this.canvas.width, 1 - (cy + this.ch) / this.canvas.height, (cx + this.cw) / this.canvas.width, 1 - cy / this.canvas.height];
  }
  plane(rect, w, h) {
    const geo = new THREE.PlaneGeometry(w, h);
    const uv = geo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, rect[0] + (rect[2] - rect[0]) * uv.getX(i), rect[1] + (rect[3] - rect[1]) * uv.getY(i));
    return new THREE.Mesh(geo, this.mat);
  }
}

export function infillBuildings(map, heightC) {
  const { data, route, terrain } = map;
  const rng = new RNG(31);
  const C = 40, boxes = new Map();
  const nearSeg = infillStreetIndex(data);
  const blockers = [...data.buildings.map((b) => [b.p, false]), ...['park', 'pitch', 'parking', 'pool', 'marina', 'fuel', 'golf', 'beach', 'wood'].flatMap((k) => (data.areas[k] || []).filter((a) => a.c).map((a) => [a.p, true]))];
  for (const [p, area] of blockers) {
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; for (let i = 0; i < p.length; i += 2) { x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]); z0 = Math.min(z0, p[i + 1]); z1 = Math.max(z1, p[i + 1]); }
    const rec = { p, area, x0: x0 - 4, x1: x1 + 4, z0: z0 - 4, z1: z1 + 4 };
    for (let i = Math.floor(rec.x0 / C); i <= Math.floor(rec.x1 / C); i++) for (let j = Math.floor(rec.z0 / C); j <= Math.floor(rec.z1 / C); j++) { const k = i * 100003 + j; let l = boxes.get(k); if (!l) boxes.set(k, l = []); l.push(rec); }
  }
  const blocked = (x, z) => {
    const l = boxes.get(Math.floor(x / C) * 100003 + Math.floor(z / C)); if (!l) return false;
    for (const r of l) if (x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1 && (!r.area || pointInPoly(x, z, r.p))) return true;
    return false;
  };
  const out = [];
  let id = 50000;
  for (let s = 0; s < route.length; s += 27) {
    if (route.urban(s) < 0.5) continue;
    for (const side of [-1, 1]) for (let u0 = 34; u0 < 470; u0 += 25) {
      const u = side * (u0 + rng.range(-3, 3)), ss = s + rng.range(-3, 3);
      const c = route.point(ss, u);
      const seaSide = (side > 0 ? route.seaR(ss) : route.seaL(ss)) < 600;
      const okCls = (x, z) => { const k = terrain.cls(x, z); return k === 4 || (k === 8 && !seaSide); };
      if (!okCls(c.x, c.z)) continue;
      const lim = route.edge(ss) + ROAD_CLEAR;
      if (Math.abs(u) < lim) continue;
      // Urban land cover alone does not establish house access (e.g. the lake hillside).
      const ns = nearSeg(c.x, c.z, 45, true);
      if (!ns) continue;
      const dx = ns.sg[2] - ns.sg[0], dz = ns.sg[3] - ns.sg[1], L = Math.hypot(dx, dz) || 1;
      const tx = dx / L, tz = dz / L;
      const W = rng.range(11, 19), D = rng.range(10, 16);
      const nx = -tz, nz = tx;
      const P = [];
      for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) P.push(c.x + tx * a * W / 2 + nx * b * D / 2, c.z + tz * a * W / 2 + nz * b * D / 2);
      let ok = true;
      const test = [[c.x, c.z]]; for (let i = 0; i < 4; i++) { test.push([P[i * 2], P[i * 2 + 1]]); const j = (i + 1) % 4; test.push([(P[i * 2] + P[j * 2]) / 2, (P[i * 2 + 1] + P[j * 2 + 1]) / 2]); }
      for (const [x, z] of test) {
        if (!okCls(x, z) || heightC(x, z) < 1.2 || blocked(x, z)) { ok = false; break; }
        const q = nearSeg(x, z, 3.0); if (q) { ok = false; break; }
        const pr = route.project(x, z, null); if (Math.abs(pr.u) < route.edge(clamp(pr.s, 0, route.length)) + ROAD_CLEAR) { ok = false; break; }
      }
      if (!ok) continue;
      // Consume the original placement RNG sequence unchanged, but derive architecture from the ID.
      // Adjacent accepted parcels advance through different archetypes without shifting any footprints.
      const legacyFloors = rng.chance(0.15) ? 3 : rng.chance(0.55) ? 4 : rng.chance(0.6) ? 5 : 6;
      const roofHeight = rng.range(0.2, 1.2);
      const style = id % 11, k = style === 2 || style === 7 ? 'villa' : style === 5 ? 'shop' : 'apt';
      const lv = k === 'villa' ? 2 : k === 'shop' ? 1 + id % 2 : 2 + (legacyFloors + id) % 3;
      const rec = { p: P, h: lv * 3.1 + roofHeight, lv, k, s: Math.round(ss), u: Math.round(u), id: id++, infill: true };
      out.push(rec);
      // block this footprint for the next candidates
      const r2 = { p: P, x0: Math.min(P[0], P[2], P[4], P[6]) - 3, x1: Math.max(P[0], P[2], P[4], P[6]) + 3, z0: Math.min(P[1], P[3], P[5], P[7]) - 3, z1: Math.max(P[1], P[3], P[5], P[7]) + 3 };
      for (let i = Math.floor(r2.x0 / C); i <= Math.floor(r2.x1 / C); i++) for (let j = Math.floor(r2.z0 / C); j <= Math.floor(r2.z1 / C); j++) { const k = i * 100003 + j; let l = boxes.get(k); if (!l) boxes.set(k, l = []); l.push(r2); }
    }
  }
  // the land around the new blocks is town: mark it urban in the land-cover grid (terrain + vegetation read it)
  const T = terrain.T;
  for (const b of out) {
    const p = b.p; let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; for (let i = 0; i < 8; i += 2) { x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]); z0 = Math.min(z0, p[i + 1]); z1 = Math.max(z1, p[i + 1]); }
    for (let x = x0 - 10; x <= x1 + 10; x += T) for (let z = z0 - 10; z <= z1 + 10; z += T) {
      const i = Math.round((x - terrain.minX) / T), j = Math.round((z - terrain.minZ) / T);
      if (i >= 0 && j >= 0 && i < terrain.GX && j < terrain.GZ && terrain.C[j * terrain.GX + i] === 8) terrain.C[j * terrain.GX + i] = 4;
    }
  }
  return out;
}
const ROAD_CLEAR = 16;


/** Remove the least significant footprint corners, retaining its principal silhouette. */
export function blockFootprint(points) {
  const p = points.slice();
  if(p.length>6 && p[0]===p.at(-2) && p[1]===p.at(-1))p.splice(-2);
  while(p.length>20){
    let best=0,area=Infinity,n=p.length/2;
    for(let i=0;i<n;i++){const a=(i+n-1)%n,b=(i+1)%n;
      const v=Math.abs((p[i*2]-p[a*2])*(p[b*2+1]-p[a*2+1])-(p[i*2+1]-p[a*2+1])*(p[b*2]-p[a*2]));
      if(v<area){area=v;best=i;}
    }p.splice(best*2,2);
  }return p;
}
export function buildingBlockGeometry(points,height) {
  const p=blockFootprint(points),shape=new THREE.Shape();
  for(let i=0;i<p.length;i+=2)i?shape.lineTo(p[i],-p[i+1]):shape.moveTo(p[i],-p[i+1]);
  const g=new THREE.ExtrudeGeometry(shape,{depth:height,steps:1,bevelEnabled:false,curveSegments:1});
  g.rotateX(-Math.PI/2);g.clearGroups();assertWorldBudget('building',g);return g;
}
export function buildBuildings(map,scene,heightC,labels,infill=[]) {
  const group=new THREE.Group();group.name='block-buildings';scene.add(group);
  const chunks=new Map(),roofs=[],footprints=[];
  const palette=BUILDING_PALETTE;
  for(const b of [...(map.data.buildings||[]),...infill]){
    if(!b.p||b.p.length<6)continue;
    const p=Array.isArray(b.p[0])?b.p.flat():b.p,bb=polyBounds(p),cx=(bb.x0+bb.x1)/2,cz=(bb.z0+bb.z1)/2;
    let lo=Infinity,hi=-Infinity;for(let i=0;i<p.length;i+=2){const h=heightC(p[i],p[i+1]);lo=Math.min(lo,h);hi=Math.max(hi,h);}
    if(!Number.isFinite(lo)||hi<.2)continue;
    const h=Math.max(2.6,Number(b.h||b.height)||5.5),base=lo-.6,top=hi+h;
    const g=buildingBlockGeometry(p,top-base);g.translate(0,base,0);
    const key=Math.floor(cx/500)+','+Math.floor(cz/500);if(!chunks.has(key))chunks.set(key,new GeoBatch());
    const batch=chunks.get(key),start=batch.count;
    batch.add(g,M(0,0,0),b.color || palette[Math.abs(Number(b.id)||0)%palette.length]);
    bakeBlockShade(batch,start,base,top);
    batch.facade ||= [];const style=buildingStyle(b);
    for(let i=start;i<batch.count;i++){
      const j=i*3,nx=batch.nor[j],ny=batch.nor[j+1],nz=batch.nor[j+2];
      batch.facade.push(((batch.pos[j]-cx)*nz-(batch.pos[j+2]-cz)*nx)/(b.windowBay||5.5),(batch.pos[j+1]-base)/(b.storeyHeight?(top-base)/(b.lv||2):3.1),style,Math.abs(ny)>.5?1:0);
    }
    g.dispose();
    footprints.push({p,bb});roofs.push({...b,p,bb,cx,cz,gmin:lo,top,area:Math.abs(polyArea(p)),roofOccupied:[]});
  }
  const material=facadeMaterial(typeof document==='undefined'?null:createFacadeAtlas());
  for(const [key,batch] of chunks){const g=batch.build();g.setAttribute('aFacade',new THREE.Float32BufferAttribute(batch.facade,4));const m=new THREE.Mesh(g,material);m.name='building-blocks:'+key;m.castShadow=true;m.receiveShadow=true;m.layers.enable(REFLECT_LAYER);g.computeBoundingSphere();m.boundingSphere=g.boundingSphere;m.userData={lod:true,far:6000,impostor:false,worldCategory:'building'};group.add(m);}
  return {group,roofs,inBuilding:(x,z,pad=0)=>footprints.some(b=>x>=b.bb.x0-pad&&x<=b.bb.x1+pad&&z>=b.bb.z0-pad&&z<=b.bb.z1+pad&&pointInPoly(x,z,b.p))};
}
