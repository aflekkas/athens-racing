// Browser-only allocation audit for the real Three renderer, installed before main.js.
import * as THREE from 'three';
const allocated = { geometries: new Set(), textures: new Set(), instances: new Set() };
const persistent = { geometries: new Set(), textures: new Set(), instances: new Set() };
const original = THREE.EventDispatcher.prototype.addEventListener;
THREE.EventDispatcher.prototype.addEventListener = function (type, listener) {
  const kind = this.isBufferGeometry && listener.name === 'onGeometryDispose' ? 'geometries'
    : this.isTexture && listener.name === 'onTextureDispose' && !this.isRenderTargetTexture ? 'textures'
    : this.isInstancedMesh && listener.name === 'onInstancedMeshDispose' ? 'instances' : null;
  if (type === 'dispose' && kind && !allocated[kind].has(this)) {
    allocated[kind].add(this);
    original.call(this, 'dispose', function auditDisposal() { allocated[kind].delete(this); });
  }
  return original.call(this, type, listener);
};
function resources(scene) {
  const result = { geometries: new Set(), textures: new Set(), instances: new Set() };
  scene.traverse(o => {
    if (o.geometry) result.geometries.add(o.geometry);
    if (o.isInstancedMesh) result.instances.add(o);
    for (const m of Array.isArray(o.material) ? o.material : o.material ? [o.material] : []) {
      for (const v of Object.values(m)) if (v?.isTexture) result.textures.add(v);
      for (const u of Object.values(m.uniforms || {})) if (u.value?.isTexture) result.textures.add(u.value);
    }
  });
  if (scene.environment) result.textures.add(scene.environment);
  return result;
}
let watching = [];
window.__mapResourceAudit = {
  beforeSwitch(scene) {
    watching = [];
    for (const group of scene.children.filter(o => o.name.startsWith('map-world:') || o.userData.damageDebris)) {
      const owned = resources(group);
      for (const kind of Object.keys(owned)) for (const value of owned[kind]) {
        if (value.userData?.shared || value.isRenderTargetTexture) continue;
        const record = { value, kind, disposed: false };
        value.addEventListener('dispose', () => { record.disposed = true; }); watching.push(record);
      }
    }
  },
  async sample(scene, baseline = false) {
    const { TX } = await import('../src/tex.js'), env = await import('../src/env.js');
    // Imports yield to rendering/LOD updates. Snapshot live resources only once those yields finish,
    // then compare synchronously so a newly uploaded LOD cannot appear as a false orphan.
    const live = resources(scene);
    for (const t of Object.values(TX)) if (t?.isTexture) live.textures.add(t);
    if (env.bakedSky()) live.textures.add(env.bakedSky());
    const counts = {}, orphans = [];
    for (const kind of Object.keys(allocated)) {
      const shared = [...allocated[kind]].filter(v => v.userData?.shared);
      if (baseline) for (const value of allocated[kind]) if (!live[kind].has(value) && !value.userData?.shared) persistent[kind].add(value);
      for (const value of allocated[kind]) if (!live[kind].has(value) && !value.userData?.shared && !persistent[kind].has(value)) orphans.push({ kind, id: value.id, name: value.name, type: value.type, constructor: value.constructor.name, imageClass: value.image?.constructor?.name, width: value.image?.width, height: value.image?.height, depth: !!value.isDepthTexture, renderTarget: !!value.isRenderTargetTexture });
      counts[kind] = { allocated: allocated[kind].size, shared: shared.length, live: [...allocated[kind]].filter(v => live[kind].has(v)).length, persistent: [...persistent[kind]].filter(v => allocated[kind].has(v)).length };
    }
    const missed = watching.filter(r => !r.disposed && !live[r.kind].has(r.value)).map(r => ({ kind: r.kind, id: r.value.id, name: r.value.name }));
    return { counts, orphans, bootPersistent: Object.entries(persistent).flatMap(([kind, values]) => [...values].map(v => ({ kind, id: v.id, type: v.type, name: v.name }))), owned: { watched: watching.length, disposed: watching.filter(r => r.disposed).length, retainedLive: watching.filter(r => !r.disposed && live[r.kind].has(r.value)).length, missed } };
  },
};
