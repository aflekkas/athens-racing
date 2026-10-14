import test from 'node:test';
import assert from 'node:assert/strict';
import { generatedWorld } from '../src/generated-world-cache.js';
const map = { id: 'riviera', data: { bakedWorld: { worker: '/world.js', terrain: '/terrain-123', roads: '/roads-456' } } };
const version = '/terrain-123|/roads-456';
function globals(fn) {
  const names = ['Worker', 'indexedDB', 'localStorage', 'location'], previous = Object.fromEntries(names.map(n => [n, Object.getOwnPropertyDescriptor(globalThis, n)]));
  return Promise.resolve().then(fn).finally(() => { for (const n of names) { if (previous[n]) Object.defineProperty(globalThis, n, previous[n]); else delete globalThis[n]; } });
}
test('cold generation starts synchronously before yielding for HUD/sky work', () => globals(async () => {
  let created = 0, terminated = 0, reads = 0;
  globalThis.location = { search: '' }; globalThis.localStorage = { getItem: () => null };
  globalThis.indexedDB = { open() { reads++; throw new Error('storage unavailable'); } };
  globalThis.Worker = class { constructor() { created++; } postMessage() { queueMicrotask(() => this.onmessage({ data: { terrain: new ArrayBuffer(8), roads: new ArrayBuffer(8) } })); } terminate() { terminated++; } };
  const pending = generatedWorld(map);
  assert.equal(created, 1); assert.equal(reads, 0, 'cold worker must start before any async storage read');
  assert.equal((await pending).terrain.byteLength, 8); assert.equal(terminated, 1);
}));
test('a known committed version uses IndexedDB and never starts a worker', () => globals(async () => {
  const buffers = { terrain: new ArrayBuffer(8), roads: new ArrayBuffer(8) }; let closed = 0;
  globalThis.location = { search: '' }; globalThis.localStorage = { getItem: () => version };
  globalThis.Worker = class { constructor() { assert.fail('warm cache must skip generation'); } };
  globalThis.indexedDB = { open() { const request = {}; queueMicrotask(() => { request.result = { close() { closed++; }, transaction() { return { objectStore() { return { get() { const req = {}; queueMicrotask(() => { req.result = { version, buffers }; req.onsuccess(); }); return req; } }; } }; } }; request.onsuccess(); }); return request; } };
  assert.equal(await generatedWorld(map), buffers); assert.equal(closed, 1);
}));
