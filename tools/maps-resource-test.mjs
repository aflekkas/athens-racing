// Deterministic resource-lifecycle edge cases; no browser/GPU required.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const fleet = readFileSync(new URL('../src/traffic-fleet.js', import.meta.url), 'utf8');
const plateCode = fleet.slice(fleet.indexOf('let atlas=null;'), fleet.indexOf('function cloneTemplate('));
const textures = [];
const THREE = {
  CanvasTexture: class {
    constructor() { this.userData = {}; this.disposals = 0; textures.push(this); }
    dispose() { this.disposals++; }
  },
  MeshStandardMaterial: class { constructor(options) { Object.assign(this, options); } },
  SRGBColorSpace: 'srgb',
};
const ctx = { fillRect() {}, fillText() {}, strokeRect() {} };
const document = { createElement() { return { getContext() { return ctx; } }; } };
const plate = new Function('THREE', 'document', plateCode + '\nreturn parkedPlate;')(THREE, document);
const first = plate('AAA 0000');
for (let i = 1; i < 1024; i++) assert.equal(plate('AAA ' + i).material, first.material);
assert.equal(textures[0].userData.shared, true);
assert.equal(textures[0].disposals, 0);
const next = plate('BBB 0000');
assert.notEqual(next.material, first.material);
assert.equal(textures[0].userData.shared, false, 'retired atlas is no longer a persistent cache');
assert.equal(textures[0].disposals, 1, 'retired atlas releases GPU allocation even after an earlier map unload');
assert.equal(textures[1].userData.shared, true);
assert.equal(textures[1].disposals, 0);
assert.deepEqual(next.uv, first.uv, 'new atlas starts at its first slot');
console.log('PASS parked plate atlas rollover releases the prior GPU cache');

const auditSource = readFileSync(new URL('./map-resource-audit.mjs', import.meta.url), 'utf8');
async function sampleWithLateUpload(source) {
  class EventDispatcher { addEventListener() {} }
  const window = {}, nodes = [], scene = { traverse(fn) { nodes.forEach(fn); } };
  let uploaded = false;
  const importModule = async name => {
    if (!uploaded) {
      uploaded = true;
      const geometry = Object.assign(new EventDispatcher(), { isBufferGeometry: true, userData: {}, id: 1 });
      geometry.addEventListener('dispose', function onGeometryDispose() {});
      nodes.push({ geometry });
    }
    return name.endsWith('tex.js') ? { TX: {} } : { bakedSky() {} };
  };
  const body = source.replace("import * as THREE from 'three';", '').replaceAll('await import(', 'await importModule(');
  new Function('THREE', 'window', 'importModule', body)({ EventDispatcher }, window, importModule);
  return window.__mapResourceAudit.sample(scene);
}
// Reproduce the original interleaving against the same actual audit implementation.
const oldOrder = auditSource.replace("    const { TX } = await import('../src/tex.js'), env = await import('../src/env.js');", "    const live = resources(scene), { TX } = await import('../src/tex.js'), env = await import('../src/env.js');").replace('    const live = resources(scene);', '');
assert.equal((await sampleWithLateUpload(oldOrder)).orphans.length, 1, 'old order reproduces a false orphan');
assert.equal((await sampleWithLateUpload(auditSource)).orphans.length, 0, 'live snapshot follows all asynchronous imports');
console.log('PASS allocation audit snapshots atomically after asynchronous imports');
