// node --import ./tools/physics-test/register.mjs tools/maps-test.mjs
// Data/physics checks without a browser; GPU ownership is exercised by maps-browser-test.mjs.
import assert from 'node:assert/strict';
import { readFile, readFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { MAPS, Route, loadMap } from '../src/map.js';
import { Vehicle } from '../src/physics.js';
import { resolve as resolveEvent, targetLabels, medalFor } from '../src/events.js';
import { EventMarkers } from '../src/event-markers.js';
const read = promisify(readFile);
const root = new URL('../', import.meta.url);
const originalFetch = globalThis.fetch;
globalThis.fetch = async path => {
  try { const bytes = await read(new URL(path, root)); return {ok:true,json:async()=>JSON.parse(bytes),arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)}; }
  catch { return {ok:false}; }
};
const carSource = readFileSync(new URL('../src/cars.js', import.meta.url), 'utf8');
const carLiteral = carSource.slice(carSource.indexOf('export const CARS = [') + 'export const CARS = '.length);
let depth = 0, end = 0;
for (let i=0;i<carLiteral.length;i++) { if(carLiteral[i]==='[')depth++;else if(carLiteral[i]===']'&&!--depth){end=i+1;break;} }
const spec = new Function('return '+carLiteral.slice(0,end))()[0];
const circle = {step:2*Math.PI*80/256,closed:true,start:0,finish:2*Math.PI*80,x:[],z:[],y:[],lanes:[],div:[],width:[]};
for(let i=0;i<=256;i++){const a=2*Math.PI*i/256;circle.x.push(80*Math.sin(a));circle.z.push(-80*Math.cos(a));circle.y.push(5+Math.sin(a));circle.lanes.push(2);circle.div.push(0);circle.width.push(11.5);}
const loop = new Route(circle);
for (const s of [-4,0,.1,loop.length-.1,loop.length+3,loop.length*3+10]) {
  const p=loop.point(s,1.2), q=loop.project(p.x,p.z,s-1,6);
  assert.ok(Math.abs(q.s-s)<.04,`periodic projection ${s}: ${q.s}`);
  assert.ok(Math.abs(q.u-1.2)<.02);
  assert.ok(Math.abs(loop.y(s)-loop.y(s+loop.length))<1e-6);
  assert.ok(Math.abs(loop.curv(s)-loop.curv(s+loop.length))<1e-6);
  assert.equal(loop.edge(s),5.75);
}
assert.ok(Math.abs(loop.frame(-.01,{}).grade-loop.frame(.01,{}).grade)<.001,'periodic grade');
assert.ok(Math.abs(loop.curv(0))>.009,'seam curvature retained');
console.log('PASS closed circuit seam, lap projection, width and periodic grade');
// Lap finish stations are unwrapped; a physical timing gantry exists only once.
const arches = [];
loop.fixedGantries = [0];
const markerFixture = { route: loop, clear() { arches.length = 0; }, arch(s) { arches.push(s); }, camera() {} };
EventMarkers.prototype.build.call(markerFixture, { s0: 0, s1: loop.length * 3, dir: 1 }, { start: NaN, finish: NaN });
assert.deepEqual(arches, [], 'multi-lap circuit reuses its authored timing gantry');
EventMarkers.prototype.build.call(markerFixture, { s0: 50, s1: loop.length * 3 + 50, dir: 1 }, { start: NaN, finish: NaN });
assert.equal(arches.length, 2, 'unmarked event endpoints still receive markers');
console.log('PASS periodic authored circuit gantry reuse');
try {
  for (const definition of MAPS) {
    const map=await loadMap(null,'./',definition.id), {route,terrain}=map;
    assert.equal(map.id,definition.id);
    assert.ok(route.length>500);
    assert.ok(terrain.GX>1&&terrain.GZ>1);
    assert.equal(route.closed,definition.type==='circuit');
    assert.equal(map.disposed,false);
    for (const def of map.events) {
      const event = resolveEvent(def, {route, marks: map.data.marks});
      assert.ok(Number.isFinite(event.len) && event.len > 0, `${def.id}: finite distance`);
      assert.ok(targetLabels(def, event, value => String(value)).every(([, label]) => !/NaN|undefined/.test(label)), `${def.id}: valid medal labels`);
      if (def.type === 'sprint') assert.equal(medalFor(def, {time:240,position:1}, event), 'gold', `${def.id}: winner gets gold`);
    }
    for (const key of ['X','Y','Z','K','GR']) assert.ok([...route[key]].every(Number.isFinite),`${map.id} ${key}`);
    let hint=route.start;
    // Traverse a complete centreline lap/run, including the loop seam, with small forward steps.
    const finish=route.closed?route.length*1.02:route.finish;
    for(let s=route.start;s<finish;s+=3){const u=route.localLayout?.contains(s)?route.localLayout.centreU(s,1):0,p=route.point(s,u),q=route.project(p.x,p.z,hint,8);assert.ok(Math.abs(q.s-s)<.3,`${map.id} projection ${s}: ${q.s}`);hint=q.s;}
    // Short physical drive on the actual map: finite state, positive progress, reliable surface profile.
    const car=new Vehicle(spec,route);car.reset(route.start,route.closed?0:route.laneU(route.start,0),0);
    const before=car.s;
    for(let i=0;i<180;i++)car.update(1/60,{throttle:.4,brake:0,steer:0});
    for(const key of ['x','y','z','s','u','vLong'])assert.ok(Number.isFinite(car[key]),`${map.id} physical ${key}`);
    assert.ok(car.s>before,`${map.id} makes progress`);
    map.dispose();map.dispose();assert.equal(map.disposed,true);assert.equal(map.route,null);assert.equal(map.terrain,null);assert.equal(map.data,null);assert.deepEqual(map.events,[]);assert.equal(route._h,null);
    console.log(`PASS ${definition.id}: ${(route.length/1000).toFixed(3)} km, full route traversal, physical drive and idempotent unload`);
  }
} finally {globalThis.fetch=originalFetch;}
