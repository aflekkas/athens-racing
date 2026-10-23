// Offline diagnostic only. Never install these wrappers in a rendered scene.
import * as THREE from 'three';

const typed = a => ArrayBuffer.isView(a) && !(a instanceof DataView);
function attribute(a, label) {
  if (!a) throw Error(`missing ${label}`);
  if (a.isInstancedBufferAttribute || a.data?.isInstancedInterleavedBuffer) throw Error(`instanced ${label} unsupported`);
  if (a.isInterleavedBufferAttribute) {
    if (!typed(a.data?.array)) throw Error(`interleaved ${label} has no CPU array`);
    const data = new THREE.InterleavedBuffer(a.data.array, a.data.stride);
    return new THREE.InterleavedBufferAttribute(data, a.itemSize, a.offset, !!a.normalized);
  }
  if (!typed(a.array)) throw Error(`${label} has no CPU array (GPU-only/unsupported)`);
  if (!Number.isInteger(a.itemSize) || a.itemSize < 1 || a.array.length % a.itemSize) throw Error(`invalid ${label} layout`);
  return new THREE.BufferAttribute(a.array, a.itemSize, !!a.normalized);
}
function visible(object) {
  for (let p = object; p; p = p.parent) if (!p.visible) return false;
  return true;
}

/** Shares source typed arrays read-only; owns only new CPU wrapper objects. */
export function wrapProbeMesh(source, {geometry = source.geometry} = {}) {
  if (!source.isMesh || source.isInstancedMesh || source.isSkinnedMesh) throw Error('non-ordinary mesh unsupported');
  const old = geometry;
  if (!old || Object.values(old.morphAttributes || {}).some(a => a.length)) throw Error('missing/morph geometry unsupported');
  if ((Array.isArray(source.material) ? source.material : [source.material]).some(m => m?.isShaderMaterial) && !source.userData.terrainDecode) throw Error('custom shader vertex transform unsupported');
  const materials=Array.isArray(source.material)?source.material:[source.material];
  if(materials.some(m=>m?.transparent||m?.opacity<1||m?.alphaTest>0||m?.alphaMap||m?.displacementMap||m?.clippingPlanes?.length))throw Error('fragment transparency/discard or vertex displacement unsupported');
  const g = new THREE.BufferGeometry();
  try {
    for (const [name, a] of Object.entries(old.attributes)) g.setAttribute(name, attribute(a, name));
    if (!g.attributes.position || g.attributes.position.itemSize !== 3) throw Error('position XYZ required');
    if (old.index) g.setIndex(attribute(old.index, 'index'));
    const decode = source.userData.terrainDecode;
    if (decode) {
      if (decode.version !== 1 || decode.offset?.length !== 3 || decode.scale?.length !== 3) throw Error('unsupported terrain decode');
      const p = g.attributes.position, residual = g.attributes.aHeightResidual;
      if (!residual || residual.count !== p.count || p.normalized) throw Error('terrain residual/layout mismatch');
      const xyz = new Float32Array(p.count * 3);
      for (let i = 0; i < p.count; i++) for (let axis = 0; axis < 3; axis++) {
        const raw = axis === 0 ? p.getX(i) : axis === 1 ? p.getY(i) : p.getZ(i);
        const high = Math.fround(decode.offset[axis] + raw * decode.scale[axis]);
        xyz[i * 3 + axis] = axis === 1 ? Math.fround(high + residual.getX(i)) : high;
      }
      g.setAttribute('position', new THREE.BufferAttribute(xyz, 3));
    }
    for (const group of old.groups || []) g.addGroup(group.start, group.count, group.materialIndex);
    g.setDrawRange(old.drawRange?.start || 0, old.drawRange?.count ?? Infinity);
    const proxy = new THREE.Mesh(g, source.material);
    proxy.matrixAutoUpdate = false;
    proxy.matrixWorld.copy(source.matrixWorld);
    proxy.layers.mask = source.layers.mask;
    proxy.visible = source.visible;
    return {source, proxy, dispose: () => g.dispose()}; // Never dispose source geometry/material.
  } catch (error) { g.dispose(); throw error; }
}

/** Fail closed: unsupported eligible meshes prevent any owner classification. */
export function pickProbeMeshes({objects, camera, pixel, viewport, origin = {x: 0, z: 0}, wrapMesh = wrapProbeMesh}) {
  const expected = new THREE.Matrix4().compose(camera.position, camera.quaternion, camera.scale);
  if (camera.parent) expected.premultiply(camera.parent.matrixWorld);
  if (expected.elements.some((v, i) => Math.abs(v - camera.matrixWorld.elements[i]) > 1e-6)) throw Error('camera matrixWorld stale');
  const ray = new THREE.Raycaster(); ray.near = camera.near; ray.far = camera.far; ray.layers.mask = camera.layers.mask;
  ray.setFromCamera(new THREE.Vector2(pixel[0] / viewport[0] * 2 - 1, 1 - pixel[1] / viewport[1] * 2), camera);
  const unsupported = [], candidates = [];
  for (const source of objects) {
    if (!visible(source) || !source.layers.test(camera.layers)) continue;
    let wrapper;
    try {
      wrapper = wrapMesh(source);
      for (const hit of ray.intersectObject(wrapper.proxy, false)) {
        const projected = hit.point.clone().project(camera);
        const projectedPixel = [(projected.x + 1) * viewport[0] / 2, (1 - projected.y) * viewport[1] / 2];
        const projectionErrorPx = Math.hypot(projectedPixel[0] - pixel[0], projectedPixel[1] - pixel[1]);
        if (projectionErrorPx > 1e-5 || projected.z < -1 || projected.z > 1) throw Error('hit does not project to requested visible pixel');
        const position = wrapper.proxy.geometry.attributes.position;
        const vertices = ['a', 'b', 'c'].map(k => new THREE.Vector3().fromBufferAttribute(position, hit.face[k]).applyMatrix4(source.matrixWorld));
        const barycentric = THREE.Triangle.getBarycoord(hit.point, ...vertices, new THREE.Vector3());
        if (!barycentric || Math.min(...barycentric.toArray()) < -1e-6) throw Error('hit outside source triangle');
        const world = p => [p.x + origin.x, p.y, p.z + origin.z];
        const material = Array.isArray(source.material) ? source.material[hit.face.materialIndex] : source.material;
        if(material.visible===false)continue;
        candidates.push({source, distance: hit.distance, faceIndex: hit.faceIndex, materialIndex: hit.face.materialIndex,
          materialSide: material.side, worldXYZ: world(hit.point), vertices: vertices.map(world), projectedPixel, projectionErrorPx});
      }
    } catch (error) { unsupported.push({name: source.name, type: source.type, reason: error.message}); }
    finally { wrapper?.dispose(); }
  }
  candidates.sort((a, b) => a.distance - b.distance);
  return {complete: unsupported.length === 0, unsupported, hits: unsupported.length ? [] : candidates,
    partialCandidateCount: candidates.length};
}

/** Read-only receipt; an origin is not used as a proxy for player or stream focus. */
export function cameraNeighborhoodReceipt(stream, cameraPoint, playerPose) {
  const cx = Math.floor(cameraPoint.x / 512), cz = Math.floor(cameraPoint.z / 512), cells = [];
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
    const key = `${cx + dx},${cz + dz}`, entry = stream.entry(key), tile = stream.tiles.get(key);
    const dependencies = [...stream.dependencies(key)].map(k => ({key:k, state:stream.tiles.get(k)?.state || 'absent'}));
    cells.push({key, manifestPresent:!!entry, sha256:entry?.sha256 || null,
      state:tile?.state || 'absent', dependencies, active:!!entry && tile?.state === 'active' && dependencies.every(d => d.state === 'active')});
  }
  return {cameraPoint:{...cameraPoint}, playerPose:playerPose ? {...playerPose} : null,
    streamPosition:stream.position ? {...stream.position} : null, origin:{...stream.origin},
    cameraToPlayerM:playerPose ? Math.hypot(cameraPoint.x-playerPose.x,cameraPoint.z-playerPose.z) : null,
    cameraToStreamPositionM:stream.position ? Math.hypot(cameraPoint.x-stream.position.x,cameraPoint.z-stream.position.z) : null,
    completeNine:cells.every(c => c.active), cells};
}
