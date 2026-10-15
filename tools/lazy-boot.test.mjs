import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { MAPS } from '../src/map-catalog.js';
import { menuMapContext, quickMapEvent, initialMapId } from '../src/menu-map.js';
import { resolve } from '../src/events.js';
import { applySetup } from '../src/race-setup.js';

test('catalogue-only setup resolves all tracks without reading map bundles', () => {
  for (const map of MAPS) {
    const ctx = menuMapContext(map.id), def = quickMapEvent(map.id);
    const event = resolve(applySetup(def, {}, { closed: ctx.route.closed }), ctx);
    assert.equal(def.mapId, map.id); assert.ok(event.len > 1000);
    assert.equal(!!event.closed, map.type === 'circuit');
    if (map.type === 'circuit') assert.equal(event.laps, 3);
  }
});
test('direct event URLs select their owning map before any bundle loads', () => {
  for (const [query, id] of [['event=quick','riviera'], ['event=penteli-race','penteli'], ['event=megara-race','megara'], ['event=free:penteli','penteli'], ['map=megara&event=quick','megara']]) assert.equal(initialMapId(new URLSearchParams(query)), id);
});
test('service worker install never fetches map bundles, including an older data core list', async () => {
  const requested = [], callbacks = {}, stored = [];
  class Worker {}
  const self = new Worker(); self.ASR_RELEASE = { build: 'test', files: { '/data/map.json':'map', '/data/terrain.bin':'terrain', '/data/maps/penteli/world.bin':'world' }, core: ['/data/'] };
  self.addEventListener = (type, callback) => { callbacks[type] = callback; }; self.skipWaiting = () => {}; self.location = { origin: 'http://test' };
  const context = { self, ServiceWorkerGlobalScope: Worker, URL, Response, crypto: globalThis.crypto,
    caches: { open: async () => ({ keys: async () => [], put: async (...args) => stored.push(args) }) }, fetch: async (...args) => { requested.push(args); return new Response('data'); } };
  vm.runInNewContext(await fs.readFile(new URL('../src/service-worker.js', import.meta.url), 'utf8'), context);
  let installed; callbacks.install({ waitUntil: promise => { installed = promise; } }); await installed;
  assert.deepEqual(requested, []); assert.deepEqual(stored, []);
});

test('a menu-only client loads the resumed lobby track before loaded/start acknowledgements', async () => {
  const { Multiplayer } = await import('../src/multiplayer.js');
  const sent = [], starts = [], requested = [];
  let release;
  const m = Object.create(Multiplayer.prototype);
  Object.assign(m, { loaded:true, mapId:null, trackVersion:null, connected:true, id:'me', offset:0,
    panel:{hidden:false}, peers:new Map(), pendingResume:true, resumeState:{s:900}, startedRace:null,
    lobby:{code:'ABCDEF',mapId:'penteli',track:{version:'penteli-v1'},status:'race',raceId:'race-1',players:[{id:'me'}]},
    send:packet=>sent.push(packet), renderRoom(){}, status(){}, hidePanel(){}, advanceClock(){},
    stateSender:{reset(){}}, hooks:{clearInput(){},members(){},
      mapChanged:async id=>{requested.push(id);await new Promise(resolve=>{release=resolve;});m.mapId=id;m.trackVersion='penteli-v1';},
      start:(...args)=>starts.push(args)} });
  const preparing=m.syncLobby(); await Promise.resolve();
  assert.deepEqual(requested,['penteli']); assert.equal(m.worldReady,false);
  assert.deepEqual(sent,[]); assert.deepEqual(starts,[]);
  release(); await preparing;
  assert.equal(m.worldReady,true); assert.equal(starts.length,1); assert.deepEqual(starts[0][2],{s:900});
  assert.deepEqual(sent[0],{type:'loaded',loaded:true,mapId:'penteli',version:'penteli-v1'});
});

test('idle saved tokens allow direct solo starts; resumed sessions identify their lobby first', async () => {
  const { waitForBootSession } = await import('../src/boot-session.js');
  for (const active of [false, true]) {
    const ws = new EventTarget(), client = {token:'saved',connected:false,active:false,ws};
    let settled=false;
    const pending=waitForBootSession(client).then(()=>{settled=true;});
    await Promise.resolve();assert.equal(settled,false);
    ws.dispatchEvent(new Event('message'));await Promise.resolve();assert.equal(settled,false);
    client.connected=!active;client.active=active;ws.dispatchEvent(new Event('message'));await pending;
    assert.equal(settled,true);
  }
});

test('an unreachable saved session cannot block an offline direct solo URL indefinitely', async t => {
  const { waitForBootSession } = await import('../src/boot-session.js');
  t.mock.timers.enable({apis:['setTimeout']});
  let settled=false;
  const pending=waitForBootSession({token:'stale',ws:new EventTarget()},8000).then(()=>{settled=true;});
  await Promise.resolve();assert.equal(settled,false);
  t.mock.timers.tick(8000);await pending;assert.equal(settled,true);
});
