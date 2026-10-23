import {forestTree} from './vegetation-forest.js';
import {VegetationFade} from './vegetation-fade.js';
// The trees of the streamed Athens world: bitter oranges along the quiet streets (src/world-tile-trees.js), palms and cypresses among them, and the
// bake's own tree rows and park candidates drawn as Aleppo pines (irregular clustered crowns), cypresses, oleander bushes and orange-style broadleaves.
// One low-poly vertex-colour model per species, drawn instanced near the camera (one draw call per species in view) with a soft contact shadow under
// each tree (one more, alpha-blended): the crowns are lit from the top and darker underneath in their vertex colours (the locked unlit look),
// and the instance tint varies the green. Replaces the box and billboard trees of src/world-detail.js, which only drew with World detail On anyway.
import * as THREE from 'three';
import {speciesOfBakeRow,streetTreeHeight} from './vegetation-clearance.js';
import { TREE } from './world-tile-trees.js';

export { TREE };
export const TREE_LIMITS = Object.freeze({ capacity: 420, near: 170, rebuildMetres: 8 });
const CAPACITY = { [TREE.orange]: 360, [TREE.pine]: 160, [TREE.cypress]: 140, [TREE.palm]: 90, [TREE.oleander]: 120 };
const NEAR = { [TREE.orange]: 150, [TREE.pine]: 190, [TREE.cypress]: 170, [TREE.palm]: 170, [TREE.oleander]: 80 };
/** Height in metres of the model as built: instance scale is height / this. */
const BASE = { [TREE.orange]: 4.3, [TREE.pine]: 8, [TREE.cypress]: 9, [TREE.palm]: 8.5, [TREE.oleander]: 1.7 };

class Geo {
  constructor() { this.p = []; this.c = []; }
  tri(a, b, c, ca, cb, cc) { const u=b.map((v,i)=>v-a[i]),v=c.map((v,i)=>v-a[i]);if(Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0])<1e-10)return;for (const [v, col] of [[a, ca], [b, cb], [c, cc]]) { this.p.push(...v); this.c.push(col.r, col.g, col.b); } }
  quad(a, b, c, d, ca, cb, cc, cd) { this.tri(a, b, c, ca, cb, cc); this.tri(a, c, d, ca, cc, cd); }
  geometry() { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.p), 3)); g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.c), 3)); g.computeBoundingSphere(); return g; }
  get triangles() { return this.p.length / 9; }
  /** Tapered prism, `sides` sides, no caps. */
  trunk(x, z, y0, h, r0, r1, sides, c0, c1) { for (let i = 0; i < sides; i++) { const a = i / sides * Math.PI * 2, b = (i + 1) / sides * Math.PI * 2; this.quad([x + Math.cos(a) * r0, y0, z + Math.sin(a) * r0], [x + Math.cos(b) * r0, y0, z + Math.sin(b) * r0], [x + Math.cos(b) * r1, y0 + h, z + Math.sin(b) * r1], [x + Math.cos(a) * r1, y0 + h, z + Math.sin(a) * r1], c0, c0, c1, c1); } }
  /** Low-poly ellipsoid: `rings` bands of `sides` quads closed by a cap fan at the top and a flat bottom, shaded dark below to light on top and a little toward the NW sun; `speckle` (hash 0..1) tints some vertices. */
  blob(cx, cy, cz, rx, ry, rz, sides, rings, dark, light, { speckle = 0, tint = null, seed = 1 } = {}) {
    const col = (u, v, k, key) => { const c = dark.clone().lerp(light, Math.min(1, Math.max(0, u * .95 + (v * -.6 + k * -.8) * .3 - .08)) ** 1.35); if (speckle && tint && u > .2 && u < .95) { const sv = Math.sin((key * 12.9898 + seed * 78.233)) * 43758.5453; if (sv - Math.floor(sv) < speckle) c.lerp(tint, .65); } return c; };
    const ringPts = r => { const t = r / rings, phi = -Math.PI / 2 + Math.PI * t * (rings / (rings + 0)), y = Math.sin(phi), w = Math.cos(phi); return Array.from({ length: sides }, (_, i) => { const a = i / sides * Math.PI * 2 + r * .5; return { p: [cx + Math.cos(a) * w * rx, cy + y * ry, cz + Math.sin(a) * w * rz], n: [Math.cos(a) * w, y, Math.sin(a) * w] }; }); };
    const bands = []; for (let r = 0; r <= rings; r++) bands.push(ringPts(r));
    for (let r = 0; r < rings; r++) for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides, A = bands[r][i], B = bands[r][j], Cc = bands[r + 1][j], D = bands[r + 1][i], u = r / rings, u1 = (r + 1) / rings;
      this.quad(A.p, B.p, Cc.p, D.p, col(u, A.n[0], A.n[2], r * 31 + i), col(u, B.n[0], B.n[2], r * 31 + j), col(u1, Cc.n[0], Cc.n[2], (r + 1) * 31 + j), col(u1, D.n[0], D.n[2], (r + 1) * 31 + i));
    }
  }
}
const C = hex => new THREE.Color(hex);
function orangeTree() { // a bitter orange: 3 to 5 m, a short trunk and a round crown
  const g = new Geo(); g.trunk(0, 0, 0, 1.5, .14, .1, 5, C('#6b5338'), C('#7a6045'));
  g.blob(0, 2.7, 0, 1.75, 1.55, 1.75, 10, 4, C('#0d2415'), C('#74a64a'));
  return g;
}
function pineTree() { // Aleppo/stone pine mix: a bent bole and three overlapping, rounded needle masses.
  const g = new Geo(); g.trunk(0, 0, 0, 5.9, .32, .16, 4, C('#61574b'), C('#817364'));
  // Bend the bole before adding the crowns; instance lean and unequal horizontal scale vary the silhouette.
  for(let i=0;i<g.p.length;i+=3)g.p[i]+=.8*(g.p[i+1]/5.9)**2;
  g.blob(-.9, 5.6, .2, 2.5, 2.0, 2.2, 6, 4, C('#162f2c'), C('#4c6b5b'));
  g.blob(1.0, 7.0, -.4, 2.4, 2.1, 2.1, 5, 4, C('#203b34'), C('#587564'));
  g.blob(2.2, 5.3, .8, 1.9, 1.8, 1.9, 6, 3, C('#1a352f'), C('#496955'));
  return g;
}
function cypressTree() { // narrow flame
  const g = new Geo(); g.trunk(0, 0, 0, .8, .14, .14, 5, C('#5a4733'), C('#5a4733'));
  g.blob(0, 4.6, 0, .95, 4.4, .95, 7, 4, C('#1f3a24'), C('#3f6a3a'));
  return g;
}
function palmTree() {
  const g = new Geo(); g.trunk(0, 0, 0, 7.4, .3, .2, 6, C('#8a7860'), C('#a28f72'));
  const dark = C('#2f5a2e'), light = C('#6c9a45');
  for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2, c = Math.cos(a), s = Math.sin(a), up = i % 2 ? 7.9 : 8.3;
    g.tri([0, 7.7, 0], [c * 2.9 - s * .55, up - .9, s * 2.9 + c * .55], [c * 2.9 + s * .55, up - .9, s * 2.9 - c * .55], dark, light, light);
    g.tri([0, 7.7, 0], [c * 2.9 + s * .55, up - .9, s * 2.9 - c * .55], [c * 2.9 - s * .55, up - .9, s * 2.9 + c * .55], dark, light, light); }
  return g;
}
function oleander() {
  const g = new Geo();
  g.blob(0, .75, 0, 1.15, .8, 1.0, 6, 2, C('#2d5230'), C('#6b9a48'), { speckle: .22, tint: C('#e06f98') });
  g.blob(.7, .55, .3, .7, .55, .65, 5, 2, C('#2f5a33'), C('#78a54f'), { speckle: .25, tint: C('#f0a0b8'), seed: 4 });
  return g;
}
function mountainMaquis(){const g=new Geo();for(const[x,y,z,rx,ry,rz]of [[0,.65,0,1.25,.8,1.1],[.85,.45,.3,.9,.6,.8],[-.65,.4,.55,.85,.55,.75],[.2,.7,-.55,.75,.7,.7]])g.blob(x,y,z,rx,ry,rz,7,3,C('#354632'),C('#849268'));return g;}
const BUILD = { [TREE.orange]: orangeTree, [TREE.pine]: pineTree, [TREE.cypress]: cypressTree, [TREE.palm]: palmTree, [TREE.oleander]: oleander };
export const treeTriangles = species => BUILD[species]().triangles;

/** Species of a bake row: 0 tree, 1 tree row, 2 park candidate, by its seed. */
export {speciesOfBakeRow};
export const COAST_FAR_LIMITS=Object.freeze({pine:1400,scrub:1400,range:750});
const GREENS = ['#ffffff', '#f2fbe8', '#e3f0d4', '#fbf6e2', '#d8e8c8'];

export class AthensTrees {
  /** `parent`: the group in absolute world metres (the rebased detail root). */
  constructor(parent, { enabled = true } = {}) {
    this.fade=new VegetationFade();this.enabled = enabled; this.tiles = new Map(); this.near = []; this.last = { x: Infinity, z: Infinity }; this.stats = { instances: 0, drawCalls: 0, triangles: 0, rebuilds: 0 };
    this.group = new THREE.Group(); this.group.name = 'athens-trees'; this.group.visible = enabled; parent.add(this.group);
    this.meshes = new Map(); this.tris = {};
    const material = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
    for (const species of Object.values(TREE)) {
      const model = BUILD[species](), cap = CAPACITY[species], mesh = new THREE.InstancedMesh(model.geometry(), material, cap);
      mesh.count = 0; mesh.visible = false; mesh.frustumCulled = false; mesh.name = 'athens-trees:' + species; mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.group.add(mesh); this.meshes.set(species, { mesh, cap }); this.tris[species] = model.triangles;
    }
    // Two camera-facing silhouette batches keep woodland dense beyond the detailed tree range.
    this.coastFar=new Map();
    for(const [species,cap]of [[TREE.pine,6000],[TREE.oleander,COAST_FAR_LIMITS.scrub]]){
      const pine=species===TREE.pine,g=new Geo(),dark=C(pine?'#203b34':'#4e5d49'),light=C(pine?'#587564':'#74806a');
      // A rounded cluster silhouette in one quad, with analytic needle/maquis colour variation.
      // No texture allocation, no lighting pass and no flat umbrella polygon at distance.
      g.quad([-4.7,0,0],[4.7,0,0],[4.7,pine?9.2:2.5,0],[-4.7,pine?9.2:2.5,0],dark,dark,light,light);
      const farMaterial=material.clone();farMaterial.customProgramCacheKey=()=> 'coast-clusters-'+species;
      farMaterial.onBeforeCompile=shader=>{
        shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec2 vCluster;varying float vTreeSeed;').replace('#include <begin_vertex>','#include <begin_vertex>\nvCluster=position.xy;vTreeSeed=fract(sin(dot(instanceMatrix[3].xz,vec2(12.9898,78.233)))*43758.5453);');
        shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying vec2 vCluster;varying float vTreeSeed;').replace('#include <color_fragment>',`#include <color_fragment>
          vec2 p=vCluster;float seed=vTreeSeed;
          ${pine?`float lean=(seed-.5)*.18;p.x-=p.y*lean;
          float stone=step(.73,seed);p.y=mix(p.y,(p.y-6.)*1.35+6.,stone);
          float a=length((p-vec2(-1.25,5.4))/vec2(2.45,2.0));
          float b=length((p-vec2(.5,7.0))/vec2(2.55,2.05));
          float c=length((p-vec2(2.0,5.4))/vec2(2.1,1.9));
          float crown=min(a,min(b,c));bool trunk=abs(p.x-.12*p.y)<.23-.012*p.y && p.y<6.;
          if(crown>1. && !trunk)discard;
          if(crown>1.)diffuseColor.rgb=vec3(.115,.09,.065);else diffuseColor.rgb*=.8+.22*(1.-crown)+.04*sin(p.x*2.3)*sin(p.y*3.1);`:
          `float a=length((p-vec2(-2.0,.55))/vec2(2.1,1.2));float b=length((p-vec2(.25,.8))/vec2(2.4,1.65));float c=length((p-vec2(2.4,.4))/vec2(1.85,1.05));float crown=min(a,min(b,c));if(crown>1.)discard;diffuseColor.rgb*=.85+.05*sin(p.x*2.1)*sin(p.y*2.7)+.15*(1.-crown);`}
        `);
      };
      const mesh=new THREE.InstancedMesh(g.geometry(),farMaterial,cap);mesh.count=0;mesh.visible=false;mesh.frustumCulled=false;mesh.name='athens-coast-far:'+species;mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);this.group.add(mesh);this.coastFar.set(species,{mesh,cap,triangles:g.triangles});
    }
    this.standardShrubGeometry=this.meshes.get(TREE.oleander).mesh.geometry;const maquis=mountainMaquis();this.mountainShrubGeometry=maquis.geometry();this.maquisTriangles=maquis.triangles;
    const disc = new THREE.CircleGeometry(1, 9); disc.rotateX(-Math.PI / 2);
    const shadowMaterial = new THREE.MeshBasicMaterial({ color: 0x0c0f08, transparent: true, opacity: .3, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.shadow = new THREE.InstancedMesh(disc, shadowMaterial, TREE_LIMITS.capacity); this.shadow.count = 0; this.shadow.visible = false; this.shadow.frustumCulled = false; this.shadow.name = 'athens-tree-shadows'; this.shadow.renderOrder = 2; this.shadow.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.group.add(this.shadow);
    for(const {mesh,cap}of [...this.meshes.values(),...this.coastFar.values()])this.fade.attach(mesh,cap);this.fade.attach(this.shadow,TREE_LIMITS.capacity);
    material.dispose();shadowMaterial.dispose();
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._e = new THREE.Euler(); this._p = new THREE.Vector3(); this._s = new THREE.Vector3(); this._c = new THREE.Color();
  }
  /** Read a decoded tile: the bake's vegetation rows and the derived street trees (`worldDetail.streetTrees`). */
  addTile(key, packet) {for(const _ of this.addTileSteps(key,packet))void _;}
  *addTileSteps(key, packet) {
    this.removeTile(key);
    const ext = packet.metadata.extensions?.worldDetail, o = packet.metadata.origin, records = [];
    const veg = ext?.vegetation;
    if (veg) { const p = packet.arrays[veg.positionHeight], k = packet.arrays[veg.kind], seed = packet.arrays[veg.seed];
      for (let i = 0; i < k.length; i++) {records.push({ species: speciesOfBakeRow(k[i], seed[i]), x: p[i * 4] + o[0], y: p[i * 4 + 1], z: p[i * 4 + 2] + o[2], height: Math.min(10, Math.max(3, p[i * 4 + 3])), yaw: (seed[i] % 628) / 100, variant: seed[i] % 8 });if(i%32===31)yield {stage:'trees'};} }
    if (ext?.streetTrees != null) { const r = packet.arrays[ext.streetTrees];
      for (let i = 0; i < r.length; i += 5) { const code = r[i + 4] | 0, species = code >> 3, v = code & 7; records.push({ species, mountain:ext.penteli===true, coastal:i/5>=r.length/5-(ext.coastalTreeCount||0), x: r[i] + o[0], y: r[i + 1], z: r[i + 2] + o[2], height: streetTreeHeight(species,v,ext.penteli===true), yaw: r[i + 3], variant: v });if(i%160===155)yield {stage:'trees'}; } }
    this.tiles.set(key, records); this.last.x = Infinity;
  }
  view(camera,origin){if(!this.forest)return;const d=camera.getWorldDirection(this._view??=new THREE.Vector3()),length=Math.hypot(d.x,d.z)||1,dx=d.x/length,dz=d.z/length;if(!this.viewDirection||dx*this.viewDirection.x+dz*this.viewDirection.z<.998){this.viewDirection={x:dx,z:dz};this.rebuild(camera.position.x+origin.x,camera.position.z+origin.z);}}
  setMountainForest(asset){this.forest=asset;const shrub=this.meshes.get(TREE.oleander).mesh;const fade=shrub.geometry.getAttribute('aVegetationFade');shrub.geometry=asset?this.mountainShrubGeometry:this.standardShrubGeometry;if(fade)shrub.geometry.setAttribute('aVegetationFade',fade);this.tris[TREE.oleander]=asset?this.maquisTriangles:treeTriangles(TREE.oleander);this.last.x=Infinity;}
  removeTile(key) { if (this.tiles.delete(key)) this.last.x = Infinity; }
  setEnabled(on) {
    if (this.enabled === on) return;
    this.enabled = on; this.group.visible = on; this.last.x = Infinity;
    if (!on) {
      // These instances/geometries are constructed privately by this layer.
      // Keep CPU placement, matrices and fade state; only release owned GPU
      // uploads and lazy colours. Dispose before clearing instanceColor so
      // Three removes its old attribute buffer. The next render re-registers
      // the same objects and rebuild() repopulates their colours/matrices.
      const geometries = new Set([this.standardShrubGeometry, this.mountainShrubGeometry]);
      for (const mesh of [...this.meshes.values(), ...this.coastFar.values()].map(slot => slot.mesh).concat(this.shadow)) {
        geometries.add(mesh.geometry); mesh.dispose(); mesh.instanceColor = null;
      }
      for (const geometry of geometries) geometry.dispose();
    }
  }
  update(camera) {
    if (!this.enabled) return; const p = camera.position || camera;this.fade.update(p.x,p.z);
    if (Math.hypot(p.x - this.last.x, p.z - this.last.z) >= TREE_LIMITS.rebuildMetres) this.rebuild(p.x, p.z);
  }
  rebuild(x, z) {
    this.fade.update(x,z);this.fade.begin();
    const out = []; for (const records of this.tiles.values()) for (const r of records) { const d = Math.hypot(r.x - x, r.z - z); if (d < (r.coastal?(r.species===TREE.pine?65:32):NEAR[r.species])) out.push({ r, d }); }
    out.sort((a, b) => a.d - b.d); if (out.length > TREE_LIMITS.capacity) out.length = TREE_LIMITS.capacity;
    const M = this._m, Q = this._q, E = this._e, V = this._p, S = this._s, Cc = this._c, used = new Map(),nearRecords=new Set(); let n = 0, shadowCount=0, tris = 0;
    for (const { r } of out) {
      const slot = this.meshes.get(r.species), k = used.get(r.species) || 0; if (k >= slot.cap) continue; used.set(r.species, k + 1);nearRecords.add(r);
      const s = r.height / BASE[r.species], w = s * (r.species === TREE.cypress ? .9 + (r.variant & 3) * .05 : r.coastal&&r.species===TREE.pine?1.3:1);
      M.compose(V.set(r.x, r.y, r.z), Q.setFromEuler(E.set(r.species===TREE.pine?(r.variant-3)*.018:0, r.yaw, r.species===TREE.pine?(r.variant%3-1)*.065:0)), S.set(w*(r.species===TREE.pine?.84+r.variant*.035:1), s, w)); slot.mesh.setMatrixAt(k, M);this.fade.write(slot.mesh,k,r,0,r.coastal?(r.species===TREE.pine?65:32):NEAR[r.species],r.coastal?20:35); slot.mesh.setColorAt(k, Cc.set(GREENS[r.variant % GREENS.length]));
      const radius = (r.species === TREE.cypress ? 1.2 : r.species === TREE.oleander ? 1.5 : r.species === TREE.pine ? 3.4 : r.species === TREE.palm ? 2.2 : 1.9) * w;
      M.compose(V.set(r.x + radius * .15, r.y + .05, r.z + radius * .1), Q.identity(), S.set(radius, 1, radius)); if(!r.mountain){this.fade.write(this.shadow,shadowCount,r,0,r.coastal?(r.species===TREE.pine?65:32):NEAR[r.species],r.coastal?20:35);this.shadow.setMatrixAt(shadowCount++, M);}n++; tris += this.tris[r.species];
    }
    let calls = 0,farCount=0;
    const far=[];for(const records of this.tiles.values())for(const r of records){if(!r.coastal||!this.coastFar.has(r.species))continue;const d=Math.hypot(r.x-x,r.z-z);if(d<(r.mountain?240:COAST_FAR_LIMITS.range))far.push({r,d});}far.sort((a,b)=>a.d-b.d);
    const farUsed=new Map();for(const {r}of far){const slot=this.coastFar.get(r.species),k=farUsed.get(r.species)||0;if(k>=(r.mountain?slot.cap:r.species===TREE.pine?COAST_FAR_LIMITS.pine:slot.cap))continue;farUsed.set(r.species,k+1);const scale=r.height/BASE[r.species];M.compose(V.set(r.x,r.y,r.z),Q.setFromEuler(E.set(0,Math.atan2(x-r.x,z-r.z),0)),S.set(scale*(.8+r.variant*.05)*(r.species===TREE.oleander?.44:1),scale*(r.species===TREE.oleander?.62:1),scale));slot.mesh.setMatrixAt(k,M);this.fade.write(slot.mesh,k,r,nearRecords.has(r)?(r.species===TREE.pine?45:12):0,r.mountain?240:COAST_FAR_LIMITS.range,20);farCount++;tris+=slot.triangles;}
    // Four overlapping Aleppo crowns per 32 m terrain square. The ground is
    // interpolated from the loaded horizon, not a second placement/object cache.
    if(this.forest?.metadata.forest){
      const {arrays:a,metadata:m}=this.forest,{array,nx,nz}=m.forest,mask=a[array],pos=a[0],step=m.spacing,candidates=[];
      for(let iz=0;iz<nz-1;iz++)for(let ix=0;ix<nx-1;ix++){const i=iz*nx+ix;if(!mask[i]||!mask[i+1]||!mask[i+nx]||!mask[i+nx+1])continue;const d=Math.hypot(pos[i*3]+16-x,pos[i*3+2]+16-z);if(d>175&&d<1500&&(!this.viewDirection||((pos[i*3]+16-x)*this.viewDirection.x+(pos[i*3+2]+16-z)*this.viewDirection.z)>d*.5))candidates.push({i,d});}
      candidates.sort((a,b)=>a.d-b.d);const slot=this.coastFar.get(TREE.pine);let k=farUsed.get(TREE.pine)||0;
      for(const {i}of candidates){for(let j=0;j<4;j++){if(k>=slot.cap)break;const {x:px,y:py,z:pz,scale,seed}=forestTree(this.forest,i,j);if(mask[i]===2&&seed%4!==0)continue;
        const safe=m.forest.clearanceArray;if(safe==null||!(a[safe][i]&(1<<j)))continue;if(Math.hypot(px-x,pz-z)<200)continue;
        M.compose(V.set(px,py,pz),Q.setFromEuler(E.set(0,Math.atan2(x-px,z-pz),0)),S.set(scale*1.4,scale,scale));slot.mesh.setMatrixAt(k,M);this.fade.write(slot.mesh,k++,0x80000000+i*4+j,200,1500,40);farCount++;tris+=slot.triangles;
      }if(k>=slot.cap)break;}farUsed.set(TREE.pine,k);
    }
    for(const [species,{mesh}]of this.coastFar){const count=farUsed.get(species)||0;mesh.count=count;mesh.visible=count>0;if(count){calls++;mesh.instanceMatrix.needsUpdate=true;}}

    for (const [species, { mesh }] of this.meshes) { const c = used.get(species) || 0; mesh.count = c; mesh.visible = c > 0; if (c) { calls++; mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true; } }
    this.shadow.count = shadowCount; this.shadow.visible = shadowCount > 0; if (shadowCount) { calls++; this.shadow.instanceMatrix.needsUpdate = true; }
    this.fade.end();this.last = { x, z }; this.stats = { instances: n, distant:farCount, drawCalls: calls, triangles: tris, rebuilds: this.stats.rebuilds + 1 };
  }
  dispose() { this.group.removeFromParent(); const material = [...this.meshes.values()][0].mesh.material; for (const { mesh } of this.meshes.values()) { mesh.geometry.dispose();mesh.material.dispose(); mesh.dispose(); } for(const {mesh}of this.coastFar.values()){mesh.geometry.dispose();mesh.material.dispose();mesh.dispose();}material.dispose(); this.shadow.geometry.dispose(); this.shadow.material.dispose(); this.shadow.dispose(); this.standardShrubGeometry.dispose();this.mountainShrubGeometry.dispose();this.tiles.clear(); }
}
