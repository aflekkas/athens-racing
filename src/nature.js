// Owner-locked: coast amenities only; no vegetation scenery.
import * as THREE from 'three';
import {assertWorldBudget} from './world-art-direction.js';
import { REFLECT_LAYER } from './env.js';
import { RNG, CellInstances, M, pointInPoly, polyBounds } from './util.js';
import { ROAD } from './road.js';
import { TX, GLSL_HELPERS } from './tex.js';
export function mergeGeos(list) {
  const pos = [], nor = [], uv = [], ao = [];
  for (const g0 of list) {
    const g = g0.index ? g0.toNonIndexed() : g0;
    pos.push(...g.attributes.position.array); nor.push(...g.attributes.normal.array); uv.push(...(g.attributes.uv ? g.attributes.uv.array : new Float32Array(g.attributes.position.count * 2)));
    ao.push(...(g.attributes.aAO ? g.attributes.aAO.array : new Float32Array(g.attributes.position.count).fill(1)));
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  out.setAttribute('aAO', new THREE.Float32BufferAttribute(ao, 1));
  out.computeBoundingSphere();
  return out;
}
export function boatGeo(kind) {
  const L=kind===2?10:8,B=kind===2?3.4:2.7;
  const hull=new THREE.BoxGeometry(B,.9,L).translate(0,.15,0);
  const cabin=new THREE.BoxGeometry(B*.65,1.1,L*.35).translate(0,1.1,0);
  const parts=[hull,cabin];if(kind!==2)parts.push(new THREE.BoxGeometry(.1,L,.1).translate(0,L/2+.6,0));
  return assertWorldBudget('streetProp',mergeGeos(parts));
}
export function buildNature(map, scene, heightC, bld, assets) {
  const {data, route} = map, group = new THREE.Group(), rng = new RNG(2024), pt = new THREE.Vector3(); scene.add(group);
  // ---- 4. piers (concrete decks)
  const concrete = new THREE.MeshStandardMaterial({ color: '#c4beb2', roughness: 0.85 });
  for (const a of data.areas.pier) {
    const p = a.p;
    if (a.c && p.length >= 6) {
      const shape = new THREE.Shape(); for (let i = 0; i < p.length; i += 2) (i ? shape.lineTo(p[i], -p[i + 1]) : shape.moveTo(p[i], -p[i + 1]));
      const g = new THREE.ExtrudeGeometry(shape, { depth: 2.2, bevelEnabled: false }); g.rotateX(-Math.PI / 2); g.translate(0, -1.2, 0);
      const m = new THREE.Mesh(g, concrete); m.receiveShadow = true; m.castShadow = true; m.layers.enable(REFLECT_LAYER); group.add(m);
    } else for (let i = 0; i + 3 < p.length; i += 2) {
      const ax = p[i], az = p[i + 1], bx = p[i + 2], bz = p[i + 3]; const L = Math.hypot(bx - ax, bz - az); if (L < 1) continue;
      const m = new THREE.Mesh(new THREE.BoxGeometry(3.2, 2.2, L + 1), concrete); m.position.set((ax + bx) / 2, 0, (az + bz) / 2); m.rotation.y = Math.atan2(bx - ax, bz - az); m.receiveShadow = true; m.layers.enable(REFLECT_LAYER); group.add(m);
    }
  }

  // ---- 5. marinas: berthed yachts and sailing boats; boats moored in the bays
  const hullMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.35, metalness: 0.05 });
  const boats = [boatGeo(0), boatGeo(1), boatGeo(2)].map((g) => new CellInstances(g, hullMat, { colors: true, cell: 600, far: 3000, shadow: false }));
  const BOATC = [new THREE.Color('#f4f4f2'), new THREE.Color('#f4f4f2'), new THREE.Color('#e9eef3'), new THREE.Color('#1f3d68'), new THREE.Color('#f4f4f2')];
  for (const a of data.areas.marina) {
    if (!a.c) continue;
    const b = polyBounds(a.p);
    // principal axis of the basin
    const ang = Math.atan2(b.z1 - b.z0, b.x1 - b.x0) > 0.78 ? 0 : Math.PI / 2;
    for (let x = b.x0; x < b.x1; x += 5.2) for (let z = b.z0; z < b.z1; z += 16) {
      const jx = x + rng.range(-0.4, 0.4), jz = z + rng.range(-1, 1);
      if (!pointInPoly(jx, jz, a.p) || heightC(jx, jz) > -0.8) continue;
      if (rng.chance(0.18)) continue;
      const k = rng.chance(0.45) ? 0 : rng.chance(0.6) ? 1 : 2;
      boats[k].add(M(jx, 0.05, jz, 0, ang + (rng.chance(0.5) ? Math.PI : 0) + rng.range(-0.05, 0.05), 0, 1), rng.pick(BOATC));
    }
  }
  for (let i = 0; i < 160; i++) {
    const s = rng.range(0, route.length), u = rng.range(60, 900); route.point(s, u, pt);
    const h = heightC(pt.x, pt.z); if (h > -2.5 || h < -26) continue;
    const k = rng.chance(0.5) ? 0 : rng.chance(0.7) ? 2 : 1;
    boats[k].add(M(pt.x, 0.05, pt.z, 0, rng.range(0, 6.28), 0, 1), rng.pick(BOATC));
  }
  for (const c of boats) { c.build(group); for (const m of c.meshes) m.layers.enable(REFLECT_LAYER); }

  // Beach pedestrians use bare ground anchors, independent of removed furniture.
  const beachPeople=[];
  for(const a of data.areas.beach){if(!a.c)continue;const b=polyBounds(a.p);
    for(let x=b.x0+6;x<b.x1;x+=18)for(let z=b.z0+6;z<b.z1;z+=18){
      const h=heightC(x,z);if(h>=.5&&h<=3&&pointInPoly(x,z,a.p))beachPeople.push([x,h,z]);
    }
  }

  // ---- 7. side streets from OSM (asphalt and footpaths draped on the terrain)
  buildSideStreets(map.roadNetwork ? data.sideRoads.filter(r => r.f) : data.sideRoads, group, heightC, route);

  // ---- 8. kiosks (periptero) at the real OSM kiosk positions on the avenue
  for (const poi of data.pois) {
    if (poi.k !== 'shop:kiosk' || Math.abs(poi.u) > 60) continue;
    const side = Math.sign(poi.u) || 1;
    const u = side * (route.edge(poi.s) + ROAD.gutter + Math.min(2.2, ROAD.sidewalk(route, poi.s, side) - 1));
    route.point(poi.s, u, pt);
    const fr = route.frame(poi.s, {});
    const k = makeKiosk(assets.labels, poi.n);
    k.position.set(pt.x, pt.y + ROAD.curbH(route, poi.s), pt.z); k.rotation.y = Math.atan2(fr.tx, fr.tz) + (side > 0 ? -Math.PI / 2 : Math.PI / 2);
    group.add(k);
  }

  // ---- 9. Lake Vouliagmeni water surface
  for (const a of data.areas.lake) {
    if (!a.c || a.p.length < 6) continue;
    const shape = new THREE.Shape(); for (let i = 0; i < a.p.length; i += 2) (i ? shape.lineTo(a.p[i], -a.p[i + 1]) : shape.moveTo(a.p[i], -a.p[i + 1]));
    const g = new THREE.ShapeGeometry(shape); g.rotateX(-Math.PI / 2);
    group.add(assets.water.makeLake(g, 0.3));
  }
  assets.beachPeople = beachPeople;
  return { group };
}

function buildSideStreets(list, group, heightC, route) {
  const pos = [], col = [], idx = [], shadingRng = new RNG(451);
  const asph = new THREE.Color('#3a3a3c'), foot = new THREE.Color('#b9b1a1');
  for (const r of list) {
    const p = r.p; const n = p.length / 2; if (n < 2) continue;
    const pts = [];
    for (let i = 0; i + 1 < n; i++) {
      const ax = p[i * 2], az = p[i * 2 + 1], bx = p[i * 2 + 2], bz = p[i * 2 + 3]; const L = Math.hypot(bx - ax, bz - az);
      const k = Math.max(1, Math.ceil(L / 8));
      for (let j = 0; j < k; j++) pts.push([ax + (bx - ax) * j / k, az + (bz - az) * j / k]);
    }
    pts.push([p[n * 2 - 2], p[n * 2 - 1]]);
    const hw = r.w / 2, c = r.f ? foot : asph;
    const base = pos.length / 3;
    let rows = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      let tx = b[0] - a[0], tz = b[1] - a[1]; const L = Math.hypot(tx, tz) || 1; tx /= L; tz /= L;
      const rx = -tz, rz = tx;
      for (const sd of [-1, 1]) {
        const x = pts[i][0] + rx * hw * sd, z = pts[i][1] + rz * hw * sd;
        const h = heightC(x, z);
        pos.push(x, Math.max(h, 0.1) + 0.06, z);
        const sh = shadingRng.range(0.9, 1.05); col.push(c.r * sh, c.g * sh, c.b * sh);
      }
      if (i > 0) { const v = base + (rows - 1) * 2; idx.push(v, v + 2, v + 1, v + 1, v + 2, v + 3); }
      rows++;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx);
  g.computeVertexNormals();
  // the strips may wind either way: force normals up
  const nn = g.attributes.normal; for (let i = 0; i < nn.count; i++) if (nn.getY(i) < 0) nn.setXYZ(i, -nn.getX(i), -nn.getY(i), -nn.getZ(i));
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  // textured: worn asphalt for streets, concrete paving slabs for footpaths (vertex colour tells them apart)
  mat.customProgramCacheKey = () => 'side6';
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, { tAD: { value: TX.asphalt_diff }, tAN: { value: TX.asphalt_nor }, tPD: { value: TX.paver_diff }, tPN: { value: TX.paver_nor } });
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vSW;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvSW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      uniform sampler2D tAD; uniform sampler2D tAN; uniform sampler2D tPD; uniform sampler2D tPN; varying vec3 vSW; vec3 sN; vec2 sUV;
      ${GLSL_HELPERS}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
      {
        float foot = step(0.3, vColor.r);
        sUV = vSW.xz / (foot > 0.5 ? 3.2 : 4.2);
        vec3 a = texNoTile(tAD, sUV).rgb, pv = texture2D(tPD, sUV).rgb;
        sN = (foot > 0.5 ? texture2D(tPN, sUV).xyz : texNoTile(tAN, sUV).xyz) * 2.0 - 1.0;
        diffuseColor.rgb = foot > 0.5 ? pv * 1.05 : mix(vec3(dot(a, vec3(0.333))), a, 0.5) * 1.5 * (0.8 + 0.4 * fbm2(vSW.xz * 0.05));
      }`)
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nvec3 upV = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz); if (dot(normal, upV) < 0.0) normal = -normal;\nnormal = perturb(-vViewPosition, normal, sUV, sN, 1.0);');
  };
  const m = new THREE.Mesh(g, mat); m.receiveShadow = true; group.add(m);
}

function makeKiosk(labels, name) {
  const group=new THREE.Group(),mat=new THREE.MeshStandardMaterial({color:'#d8cbbb',roughness:1});
  const body=new THREE.Mesh(new THREE.BoxGeometry(2.4,2.6,2),mat);body.position.y=1.3;group.add(body);
  const face=new THREE.Mesh(new THREE.BoxGeometry(1.8,.8,.025),new THREE.MeshStandardMaterial({color:'#42545b',roughness:1}));face.position.set(0,1.7,1.02);group.add(face);
  return group;
}
