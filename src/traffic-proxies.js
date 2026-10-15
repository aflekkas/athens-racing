// Distant moving traffic in a handful of draws. An intact car beyond its LOD
// switch (55-65 m, traffic-fleet.js) is drawn from its own far-level geometry,
// but through shared BatchedMeshes keyed by material, across every fleet type:
// ~20 draws for the whole distant fleet instead of ~5 per car. Colour is per
// instance; lamp emission is world state (headlamps) or a running/braking pair.
// Inside the lamp range (110 m) sorted glass and lit indicators stay per car.
// Damaged or crashed cars always use their own model.
import * as THREE from 'three';

export const PROXY_LAMP_RANGE = 110;

const SKIP = new Set(['uuid', 'id', 'name', 'version', 'userData', 'color', '_listeners']);
const ids = new WeakMap(); let nextId = 1;
const identity = v => { if (!ids.has(v)) ids.set(v, nextId++); return ids.get(v); };
/** every property that changes the draw, except the base colour (carried per instance) and a tail's brake level */
function signature(material, tail) {
  const out = [];
  for (const [key, value] of Object.entries(material)) {
    if (SKIP.has(key) || tail && key === 'emissiveIntensity') continue;
    if (value?.isTexture) out.push(key, value.uuid);
    else if (value?.isColor) out.push(key, value.getHexString());
    else if (value?.toArray) out.push(key, value.toArray().join(','));
    else if (value === null || ['boolean', 'number', 'string'].includes(typeof value)) out.push(key, value);
    else if (value?.constructor === Object || Array.isArray(value)) out.push(key, JSON.stringify(value)); // defines, ranges
    else if (value !== undefined) out.push(key, identity(value));
  }
  out.push('compile', identity(material.onBeforeCompile), material.customProgramCacheKey());
  return out.join('|');
}
const layout = g => Object.entries(g.attributes).map(([k, a]) => `${k}:${a.itemSize}:${a.normalized}:${a.array.constructor.name}`).sort().join(',') + (g.index ? ':indexed' : '');

export class TrafficProxies {
  constructor(scene, cars) {
    this.group = new THREE.Group(); this.group.name = 'traffic-proxies'; scene.add(this.group);
    this.batches = []; this.individual = []; this.cars = [];
    this.matrix = new THREE.Matrix4(); this.bodyMatrix = new THREE.Matrix4(); this.frame = 0;
    const bins = new Map(), color = new THREE.Color();
    const single = (node, name) => {
      const mesh = new THREE.Mesh(node.geometry, node.material);
      mesh.name = 'traffic-proxy-' + name;
      mesh.castShadow = node.castShadow; mesh.receiveShadow = node.receiveShadow;
      mesh.layers.mask = node.layers.mask; mesh.renderOrder = node.renderOrder;
      mesh.matrixAutoUpdate = false; mesh.visible = false;
      this.group.add(mesh); this.individual.push(mesh); return mesh;
    };
    for (const car of cars) {
      const model = car.m;
      if (!model.farBody || car.police) continue;
      // The far level: the far body plus what both levels share outside the body
      // (a scooter's handlebar cowl). Matrices are relative to the body (pitch) or root.
      const shown = model.root.visible; model.root.visible = true;
      model.setLOD(Infinity); model.root.updateWorldMatrix(true, true);
      const toBody = model.body.matrixWorld.clone().invert(), toRoot = model.root.matrixWorld.clone().invert();
      const accessories = new Set(model.accessories || []), meshes = [];
      model.root.traverseVisible(node => { if (node.isMesh && !accessories.has(node)) meshes.push(node); });
      model.setLOD(0); model.root.visible = shown;
      const inBody = node => { for (let x = node; x; x = x.parent) if (x === model.body) return true; return false; };
      const parts = [];
      for (const node of meshes) {
        const material = node.material;
        if (Array.isArray(material)) throw new Error('traffic proxy: multi-material far mesh on ' + car.type.id);
        const onBody = inBody(node), relative = (onBody ? toBody : toRoot).clone().multiply(node.matrixWorld);
        const plate = material === model.materials.plate, tail = material === model.tail;
        // Headlamps switch at dusk (setLights, every car alike) and tails brake: emission is copied per frame.
        const dynamic = tail || !!node.userData.damagePart?.startsWith('light_f');
        const role = plate ? 'plate' : tail ? 'tail' : dynamic ? 'head' : 'static';
        // A plate is ~8 px wide at the LOD switch: every distant car shares the first plate texture.
        const key = [role, plate ? '' : signature(material, tail), node.castShadow, node.receiveShadow, node.layers.mask, node.renderOrder, layout(node.geometry)].join('#');
        const part = { relative, onBody, source: material, geometry: node.geometry, bins: [] };
        for (const brake of tail ? [false, true] : [false]) {
          const k = key + (brake ? '#brake' : '');
          let bin = bins.get(k);
          if (!bin) bins.set(k, bin = { key: k, role, brake, node, geometries: bins.get(key)?.geometries || new Map(), uses: [] });
          bin.geometries.set(node.geometry.uuid, node.geometry); bin.uses.push(part); part.bins.push(bin);
        }
        // Sorted glass keeps its own draw inside the lamp range.
        if (material.transparent) part.mesh = single(node, 'glass');
        parts.push(part);
      }
      // Indicators and headlight flashers keep their per-driver phases, drawn only while lit (to 110 m).
      for (const node of accessories) parts.push({ relative: (inBody(node) ? toBody : toRoot).clone().multiply(node.matrixWorld), onBody: inBody(node), mesh: single(node, 'signal'), accessory: node.material });
      car.proxyParts = parts; car.proxyFrame = -1;
      this.cars.push(car);
      const setDamage = model.setDamage;
      model.setDamage = (zone, amount, impact) => {
        // Damage's visibility tests and debris snapshots must see the authored
        // far graph, even when the previous frame used the shared batches.
        if (car.proxyActive) { model.root.visible = true; car.proxyActive = false; }
        setDamage(zone, amount, impact);
      };
    }
    for (const bin of bins.values()) {
      const geometries = [...bin.geometries.values()], node = bin.node;
      const vertices = geometries.reduce((n, g) => n + g.attributes.position.count, 0), indices = geometries.reduce((n, g) => n + (g.index?.count || 0), 0);
      const material = node.material.clone();
      material.color?.setHex(0xffffff);
      const mesh = new THREE.BatchedMesh(bin.uses.length, vertices, indices, material);
      mesh.name = 'traffic-proxy-' + bin.role + (bin.brake ? '-brake' : '');
      mesh.castShadow = node.castShadow; mesh.receiveShadow = node.receiveShadow;
      mesh.layers.mask = node.layers.mask; mesh.renderOrder = node.renderOrder;
      // Only glass is culled and sorted per instance: either rewrites the batch's draw list (a texture upload) on every
      // render pass, mirrors and probe faces included. Opaque batches re-upload it only when a car joins or leaves;
      // a far shell off screen costs a few hundred clipped vertices.
      mesh.frustumCulled = false; mesh.perObjectFrustumCulled = mesh.sortObjects = material.transparent;
      const geometryIds = new Map(geometries.map(g => [g.uuid, mesh.addGeometry(g)]));
      const batch = { key: bin.key, mesh, material, role: bin.role, brake: bin.brake, count: 0 };
      for (const part of bin.uses) {
        const id = mesh.addInstance(geometryIds.get(part.geometry.uuid));
        mesh.setColorAt(id, part.source.color ? color.copy(part.source.color) : color.setHex(0xffffff));
        mesh.setVisibleAt(id, false);
        (part.instances ||= []).push({ batch, id });
      }
      mesh.visible = false;
      this.group.add(mesh); this.batches.push(batch);
    }
  }
  begin() {
    this.frame++;
    for (const batch of this.batches) batch.count = 0;
    for (const mesh of this.individual) mesh.visible = false;
  }
  /** draw this far, intact car through the batches; `near` = inside the lamp range */
  add(car, near) {
    const model = car.m;
    model.root.updateMatrix(); model.body.updateMatrix();
    this.bodyMatrix.copy(model.root.matrix).multiply(model.body.matrix);
    const braking = !!car.braking && !car.crash;
    for (const part of car.proxyParts) {
      if (part.accessory && (!near || !(part.accessory.emissiveIntensity > 0))) continue;
      this.matrix.copy(part.onBody ? this.bodyMatrix : model.root.matrix).multiply(part.relative);
      const own = part.mesh && near;
      if (own) { part.mesh.matrix.copy(this.matrix); part.mesh.matrixWorldNeedsUpdate = true; part.mesh.visible = true; }
      if (!part.instances) continue;
      for (const { batch, id } of part.instances) {
        const on = !own && (batch.role !== 'tail' || batch.brake === braking);
        batch.mesh.setVisibleAt(id, on);
        if (!on) continue;
        batch.mesh.setMatrixAt(id, this.matrix); batch.count++;
        // World lamp state (dusk headlamps) and the running/braking tail level.
        if (batch.role !== 'static' && batch.material.emissive) { batch.material.emissive.copy(part.source.emissive); batch.material.emissiveIntensity = part.source.emissiveIntensity; }
      }
    }
    model.root.visible = false;
    car.proxyActive = true; car.proxyFrame = this.frame;
  }
  end() {
    for (const car of this.cars) {
      if (car.proxyFrame === this.frame || car.proxyFrame === -2) continue;
      // no longer drawn through the batches: hide its instances once
      for (const part of car.proxyParts) if (part.instances) for (const { batch, id } of part.instances) batch.mesh.setVisibleAt(id, false);
      car.proxyFrame = -2; car.proxyActive = false;
    }
    for (const batch of this.batches) batch.mesh.visible = batch.count > 0;
  }
}
