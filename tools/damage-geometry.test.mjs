// node --import ./tools/damage-test-register.mjs --test tools/damage-geometry.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { installDamageSystem } from '../src/damage.js';
import { Vehicle } from '../src/physics.js';
const route = { frame: () => ({ tx: 0, tz: -1 }), point: (s,u) => ({ x:u,y:0,z:-s }) };
const spec = { mass:1500,wheelbase:2.6,width:1.84,length:4.4,wheelR:.33,drive:'fwd',engine:'turbo4',idle:800,gears:[3.5,2,1],final:4.1 };
function model({ bakedMirror = false } = {}) {
  const root=new THREE.Group(),body=new THREE.Group();root.add(body);
  const paint=new THREE.MeshStandardMaterial(),panel=new THREE.Mesh(new THREE.BoxGeometry(1.8,.6,4.4,8,4,24),paint);panel.position.y=.55;body.add(panel);
  const bumper=new THREE.Group();bumper.name='bumper_f';bumper.position.set(0,.5,-2.15);bumper.add(new THREE.Mesh(new THREE.BoxGeometry(1.6,.2,.15,8,4,4),paint));body.add(bumper);
  if(bakedMirror){const tag=new THREE.Group();tag.userData.mirrorAssembly=true;tag.userData.mirrorRoot=[-.9,.8,-.5];tag.userData.mirrorTipOffset=[0,0,0];body.add(tag);}
  return installDamageSystem({ root,body,paint,dims:{L:4.4,W:1.84,H:1.5},wheels:[] });
}
test('online absolute damage produces identical geometry after different impact histories and clocks', () => {
  const a=model(),b=model();
  a.setDamage('front',.3,{localPoint:{x:-.6,y:.8,z:-2},ebs:16});a.setDamage('front',.64,{localPoint:{x:.5,y:.6,z:-2},ebs:12});
  b.setDamage('front',.64,{localPoint:{x:.1,y:.4,z:-2},ebs:20});b.setDamage('right',.2,{ebs:8});
  const snapshot={front:.64,rear:.13,left:.28,right:.42};a.setDamageSnapshot(snapshot);b.setDamageSnapshot(snapshot);
  for(let i=0;i<11;i++)a.updateDamage(.1);b.updateDamage(.01);
  assert.deepEqual(a.damageMeshes.map(m=>Array.from(m.geometry.attributes.position.array)),b.damageMeshes.map(m=>Array.from(m.geometry.attributes.position.array)));
  const parts=c=>c.damageParts.map(p=>({id:p.id,state:p.state,visible:p.node.visible,position:p.node.position.toArray(),rotation:p.node.rotation.toArray()}));
  assert.deepEqual(parts(a),parts(b));assert.equal(a.damageDebris.length+b.damageDebris.length,0);
  a.setDamageSnapshot({});b.setDamageSnapshot({});assert.deepEqual(a.damage,b.damage);a.disposeDamage();b.disposeDamage();
});
test('a physical wall crash produces visible deformation, broken parts and repairable state', () => {
  const car=model(),v=new Vehicle(spec,route),rest=car.damageMeshes.map(m=>m.geometry.attributes.position.array.slice());
  v.addDamage('front',60/3.6,{kind:'wall'});
  assert.ok(v.damage.front>.2);assert.ok(v.lastDamage);
  assert.doesNotThrow(()=>car.setDamage('front',v.damage.front,v.lastDamage));
  assert.ok(car.damageMeshes.some((m,k)=>m.geometry.attributes.position.array.some((n,i)=>Math.abs(n-rest[k][i])>1e-5)),'crash cannot silently stop deforming the rendered car');
  assert.notEqual(car.damageParts.find(p=>p.id==='bumper_f').state,'intact');
  v.reset(0,0);car.setDamage('front',0);
  assert.equal(v.engHealth,1);assert.ok(car.damageMeshes.every((m,k)=>m.geometry.attributes.position.array.every((n,i)=>Math.abs(n-rest[k][i])<1e-6)));
  car.disposeDamage();
});
test('far traffic baked mirror tags cannot throw and interrupt damage/repair', () => {
  const car=model({bakedMirror:true});
  assert.doesNotThrow(()=>car.setDamage('rear',.5));
  assert.ok(car.damageMeshes.some(m=>m.geometry.attributes.position.needsUpdate || m.geometry.attributes.position.version>0));
  assert.doesNotThrow(()=>car.setDamage('rear',0));car.disposeDamage();
});

test('real traffic fleet near/far graphs survive a crash, isolate geometry and repair',async()=>{
  // Geometry builders only need a canvas texture object; no raster assertions here.
  const previous=globalThis.document,noop=()=>{},gradient={addColorStop:noop};
  const ctx=new Proxy({measureText:()=>({width:50}),createLinearGradient:()=>gradient,createRadialGradient:()=>gradient},{get:(o,k)=>k in o?o[k]:noop,set:(o,k,v)=>(o[k]=v,true)});
  globalThis.document={createElement:()=>({width:0,height:0,getContext:()=>ctx})};
  try{
    const {TRAFFIC_TYPES,trafficModel}=await import('../src/cars.js'),{RNG}=await import('../src/util.js');
    for(const id of ['police','bus']){
      const type=TRAFFIC_TYPES.find(t=>t.id===id),a=trafficModel(type,type.colors[0],new RNG(41)),b=trafficModel(type,type.colors[0],new RNG(42));
      const rest=a.damageMeshes.map(m=>m.geometry.attributes.position.array.slice()),twin=b.damageMeshes.map(m=>m.geometry.attributes.position.array.slice());
      assert.doesNotThrow(()=>a.setDamage('rear',.5),id+' must not throw after far mirror compaction');
      assert.ok(a.damageMeshes.some((m,k)=>m.geometry.attributes.position.array.some((n,i)=>Math.abs(n-rest[k][i])>1e-5)),id+' must visibly deform');
      assert.ok(b.damageMeshes.every((m,k)=>m.geometry.attributes.position.array.every((n,i)=>n===twin[k][i])),id+' twin must remain intact');
      assert.doesNotThrow(()=>a.setDamage('rear',0));
      assert.ok(a.damageMeshes.every((m,k)=>m.geometry.attributes.position.array.every((n,i)=>Math.abs(n-rest[k][i])<1e-6)),id+' repair must restore geometry');
      a.disposeDamage?.();b.disposeDamage?.();
    }
  }finally{globalThis.document=previous;}
});

// From the seat the exterior shell and the glass are hidden and the cockpit draws its own bonnet, pillars and mirror mounts
// (owner 2026-10-20: "I can't see the damage from within my car"): the same lattice has to move those, and the windscreen cracks show as a decal.
function cockpitModel({ glass = false } = {}) {
  const root = new THREE.Group(), body = new THREE.Group(); root.add(body);
  const paint = new THREE.MeshStandardMaterial(), panel = new THREE.Mesh(new THREE.BoxGeometry(1.8, .6, 4.4, 8, 4, 24), paint); panel.position.y = .55; body.add(panel);
  for (const [id, x] of [['mirror_l', -.95], ['mirror_r', .95]]) { const g = new THREE.Group(); g.name = id; g.position.set(x, .95, -.6); g.add(new THREE.Mesh(new THREE.BoxGeometry(.2, .12, .1), paint)); body.add(g); }
  if (glass) { const g = new THREE.Group(); g.name = 'glass_windscreen'; g.add(new THREE.Mesh(new THREE.PlaneGeometry(1.4, .6), paint)); g.position.set(0, 1.1, -.9); body.add(g); }
  const car = installDamageSystem({ root, body, paint, dims: { L: 4.4, W: 1.84, H: 1.5 }, wheels: [] });
  // the cockpit is built after the damage system, as in the game (cars.js), and hangs off the car as `cockpit.structure`
  const structure = new THREE.Group(); structure.name = 'cockpit-structure'; body.add(structure); car.cockpit = { structure };
  const part = (geo, role, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, paint); m.userData.cockpitStructure = role; m.position.set(x, y, z); structure.add(m); return m; };
  const corners = [[-.8, .9, -.9], [.8, .9, -.9], [.72, .66, -2.0], [-.72, .66, -2.0]];
  const deckGeo = new THREE.BufferGeometry(); deckGeo.setAttribute('position', new THREE.Float32BufferAttribute(corners.flat(), 3)); deckGeo.setIndex([0, 1, 2, 0, 2, 3]);
  const deck = part(deckGeo, 'deck'), pillar = part(new THREE.BoxGeometry(.04, .7, .03), 'pillar', -.8, 1.1, -.9), dash = part(new THREE.BoxGeometry(1.4, .2, .3), 'dashboard', 0, .8, -.5);
  const mount = part(new THREE.BoxGeometry(.03, .3, .03), 'mirror-mount', -.9, .9, -.6);
  return { car, deck, pillar, dash, mount, structure, body };
}
test('the cockpit bonnet, pillars and mirror mounts take the same dents; the mirror bends then goes, and clean cars pay nothing', () => {
  const { car, deck, pillar, dash, mount } = cockpitModel(), n0 = car.damageMeshes.length, deckRest = deck.geometry.attributes.position.count;
  assert.equal(deckRest, 4, 'untouched until the first impact');
  car.setDamage('front', .7, { localPoint: { x: -.3, y: .55, z: -2.1 }, localNormal: { x: .1, y: 0, z: .99 }, ebs: 16 });
  assert.ok(car.damageMeshes.length >= n0 + 3, 'deck, pillar and mount registered');
  assert.ok(!car.damageMeshes.includes(dash), 'the dashboard keeps its authored shape');
  assert.ok(deck.geometry.attributes.position.count > 100, 'the deck panel was cut finer so it can crumple');
  const ys = Array.from(deck.geometry.attributes.position.array).filter((_, i) => i % 3 === 1);
  assert.ok(Math.max(...ys) - Math.min(...ys) > .2, 'the bonnet buckles: its height now varies by more than the 0.24 m it had flat');
  const z = Array.from(deck.geometry.attributes.position.array).filter((_, i) => i % 3 === 2);
  const nose = z.filter(v => v < -1.7);assert.ok(nose.reduce((t, v) => t + v, 0) / nose.length > -1.95, 'and the nose is pushed back (its average was -2.0 flat)');
  // a side hit bends the pillar on that side
  const bent = pillar.geometry.attributes.position.array.slice();
  car.setDamage('left', .8, { localPoint: { x: -.92, y: .9, z: -.9 }, localNormal: { x: 1, y: 0, z: 0 }, ebs: 14 });
  assert.notDeepEqual(Array.from(pillar.geometry.attributes.position.array), Array.from(bent), 'the pillar moves with a door hit');
  // mirror: bent below the tear-off point, gone (with its cockpit mount) above it
  car.setDamage('left', 0);
  const m = car.damageParts.find(p => p.id === 'mirror_l'), hitL = { localPoint: { x: -.95, y: .95, z: -.6 }, localNormal: { x: 1, y: 0, z: 0 }, ebs: 14 };
  assert.equal(mount.visible, true); car.setDamage('left', .15, hitL);
  assert.equal(m.state, 'bent'); assert.ok(Math.abs(m.node.rotation.y - m.rotation.y) > .1, 'a knocked mirror turns on its arm'); assert.equal(m.node.visible, true);
  car.setDamage('left', .5, hitL);
  assert.equal(m.state, 'detached'); assert.equal(m.node.visible, false); assert.equal(mount.visible, false, 'the mount goes with the mirror');
  // repair brings it all back
  car.setDamage('front', 0); car.setDamage('left', 0);
  assert.equal(mount.visible, true);
  const back = Array.from(deck.geometry.attributes.position.array);
  assert.ok(Math.max(...back.filter((_, i) => i % 3 === 1)) <= .9 + 1e-6 && Math.min(...back.filter((_, i) => i % 3 === 2)) >= -2.0 - 1e-6, 'flat again after the repair');
  car.disposeDamage();
});
test('a cracked windscreen also shows from the seat as a decal that appears in the cockpit view only', () => {
  const had = globalThis.document, ctx = new Proxy({}, { get: () => () => {}, set: () => true });
  globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) };
  try {
    const { car: sys, body } = cockpitModel({ glass: true });
    sys.setDamage('front', .7, { localPoint: { x: 0, y: .55, z: -2.1 }, ebs: 16 });
    assert.ok(sys.crackedGlass && sys.crackedGlassPov, 'cracks on the glass and on the seat decal');
    sys.cockpitView = false; sys.updateDamage(.016); assert.equal(sys.crackedGlassPov.visible, false);
    sys.cockpitView = true; sys.updateDamage(.016); assert.equal(sys.crackedGlassPov.visible, true);
    const mine = sys.crackedGlassPov.matrix.clone(); body.updateMatrixWorld(true); const world = new THREE.Vector3().setFromMatrixPosition(body.matrixWorld.clone().multiply(mine));
    assert.ok(Math.abs(world.y - 1.1) < 1e-6 && Math.abs(world.z + .9) < 1e-6, 'the decal sits where the glass is');
    sys.setDamage('front', 0); assert.equal(sys.crackedGlassPov, null);
  } finally { if (had === undefined) delete globalThis.document; else globalThis.document = had; }
});
