import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { mobileDevice, tiltAxis, requestTiltPermission, enterDrivingScreen } from '../src/mobile.js';
import { resolveGraphics, detectPerfClass, RENDER, RESOURCE_BUDGETS } from '../src/graphics.js';
import { Input } from '../src/input.js';
import { encodeGeometryPack, decodeGeometryPack } from '../src/baked-geometry.js';
import { RoadNetwork } from '../src/road-network-surface.js';
import { estimateSceneMemory } from '../src/asset-metrics.js';
const source = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

test('phone auto resolution and draw ranges are bounded without changing the owner look', () => {
  for (const ua of ['iPhone Safari Mobile', 'Android Chrome Mobile', 'iPad']) {
    assert(mobileDevice(ua)); assert.equal(detectPerfClass('Apple GPU', ua), 'low');
    for (const perfClass of ['auto', 'potato', 'low', 'med', 'high']) for (const renderScale of ['auto', .5, 1]) {
      const g = resolveGraphics({ perfClass, renderScale }, { deviceRatio: 3, userAgent: ua });
      assert(g.pixelRatio <= 1); assert(g.drawDistance <= 500); assert.equal(g.R, RENDER);
    }
    assert.equal(resolveGraphics({ drawDistance: 2000 }, { userAgent: ua }).drawDistance, 2000, 'explicit range remains available');
  }
  assert.equal(resolveGraphics({perfClass:'high'}, {deviceRatio:3,userAgent:'desktop'}).pixelRatio, 1.5);
});

test('shared resource budgets bound phone allocations and admit one dense cell decode', () => {
  const MiB=1024*1024;
  for(const perfClass of ['potato','low','med','high']) {
    const desktop=resolveGraphics({perfClass},{userAgent:'desktop'}).resources;
    assert.equal(desktop,RESOURCE_BUDGETS[perfClass]);
    assert(Object.isFrozen(desktop));assert(Object.isFrozen(desktop.stream));
    assert(desktop.stream.capBytes+desktop.stream.transientBytes<desktop.jsBytes);
    const mobile=resolveGraphics({perfClass},{userAgent:'iPhone Mobile'}).resources;
    assert(mobile.jsBytes<=256*MiB);assert(mobile.gpuBytes<=192*MiB);
    assert.equal(mobile.stream.concurrency,1);
    assert(mobile.stream.transientBytes>=2*20*MiB+4*MiB);
  }
});

test('tilt follows the lateral axis in both landscape directions and portrait', () => {
  assert.equal(tiltAxis({gamma:15,beta:0},0),.5);
  assert(Math.abs(tiltAxis({gamma:70,beta:15},90)-.5)<1e-10);
  assert(Math.abs(tiltAxis({gamma:70,beta:15},-90)+.5)<1e-10);
  assert.equal(tiltAxis({gamma:null,beta:null}),null);
});

test('iOS permission is invoked synchronously inside the tap and denial is recoverable', async () => {
  let gesture=true,called=false;
  const permission=requestTiltPermission({DeviceOrientationEvent:{requestPermission(){assert(gesture);called=true;return Promise.resolve('granted');}}});
  gesture=false;assert(called);assert(await permission);
  assert.equal(await requestTiltPermission({DeviceOrientationEvent:{requestPermission(){throw Error('denied');}}}),false);
  assert.equal(await requestTiltPermission({}),false);
});

test('saved tilt is reauthorized by a gesture; denied permission falls back to screen steering', async () => {
  const target=new EventTarget();let calls=0;
  target.DeviceOrientationEvent={requestPermission(){calls++;return Promise.resolve('denied');}};
  const input=new Input({target,document:null,navigator:{},storage:null});input.toast=()=>{};
  try {
    input.configure({touchSteering:'tilt'});assert.equal(calls,0);
    target.dispatchEvent(new Event('pointerdown'));assert.equal(calls,1);
    await new Promise(resolve=>setImmediate(resolve));assert.equal(input.settings.touchSteering,'screen');assert.equal(input.tiltAllowed,false);
  }finally{input.destroy();}
});

test('fullscreen begins in the gesture and unavailable orientation lock is harmless', async () => {
  let called=false;
  const promise=enterDrivingScreen({documentElement:{requestFullscreen(){called=true;return Promise.resolve();}}},{orientation:{lock(){throw Error('unsupported');}}});
  assert(called);await promise;await enterDrivingScreen({documentElement:{}},{});
  let exited=false;await enterDrivingScreen({fullscreenElement:{},exitFullscreen(){exited=true;}},{});assert(exited);
});

test('game viewport prevents zoom and callouts without disabling scrollable menu panels', () => {
  assert.match(source('index.html'),/name="viewport"[^>]+maximum-scale=1[^>]+user-scalable=no[^>]+viewport-fit=cover/);
  const css=source('style.css');assert.match(css,/overscroll-behavior: none/);assert.match(css,/-webkit-touch-callout: none/);assert.match(css,/touch-action: pan-x pan-y/);
  assert.match(source('src/input.css'),/min-height: 44px/);
  assert.match(source('src/boot.js'),/addEventListener\('touchend', unlock/);
  assert.match(source('src/main.js'),/addEventListener\('touchend', \(\) => audio.start/);
});

test('consuming a mixed shuffled pack keeps one backing store with bit-exact values', () => {
  const arrays=[new Float32Array([Math.PI, -1.5, 0, Infinity]), new Uint8Array([1,2,3]), new Float64Array([1.1,3.3])];
  const buffer=encodeGeometryPack({},arrays,[true,false,true]);
  const decoded=decodeGeometryPack(buffer,{consume:true});
  decoded.arrays.forEach((a,i)=>{assert.deepEqual(a,arrays[i]);assert.equal(a.buffer,buffer);});
  const original=encodeGeometryPack({},arrays,[true,false,true]),copy=original.slice(0);decodeGeometryPack(original);assert.deepEqual(original,copy,'default API remains non-destructive');
});

test('road contact index uses compact offsets and preserves triangle order, slope, kerb and gaps', () => {
  const network=Object.create(RoadNetwork.prototype);
  const positions=new Float32Array([0,1,0, 8,3,0, 0,5,8, 0,10,0, 8,10,0, 0,10,8]);
  const col=new Float32Array(18);col[0]=1;
  network.installSurface([{positions,col}]);
  const groups=network.surfaceCells.get('0,0');assert(groups[0].indices instanceof Uint32Array);assert.equal(groups[0].p,positions);assert.deepEqual([...groups[0].indices],[0,9]);
  assert(Math.abs(network.meshHeight(2,2)-(2.5-.14))<1e-6);
  assert.equal(network.meshHeight(7,7),null);assert.equal(network.meshHeight(-1,-1),null);
});

test('memory estimate includes shared shader textures, cube faces and instance buffers once', () => {
  const scene=new THREE.Scene(),texture=new THREE.Texture({width:512,height:512});texture.generateMipmaps=false;
  const geometry=new THREE.BoxGeometry(),material=new THREE.ShaderMaterial({uniforms:{t:{value:texture}}});
  const mesh=new THREE.InstancedMesh(geometry,material,10);scene.add(mesh,new THREE.Mesh(geometry,material));
  const memory=estimateSceneMemory(scene);
  assert.equal(memory.textureBytes,512*512*4);
  assert.equal(memory.geometryBytes,Object.values(geometry.attributes).reduce((n,a)=>n+a.array.byteLength,0)+geometry.index.array.byteLength+10*16*4);
});
