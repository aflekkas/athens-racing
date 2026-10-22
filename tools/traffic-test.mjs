import * as roundaboutHelpers from '../src/roundabouts.js';
// node --import ./tools/physics-test/register.mjs --test tools/traffic-test.mjs
// Run the actual traffic decisions/contact solver without loading the WebGL model library.
import test from 'node:test';
import './ragdoll.test.mjs';
import { impactTarget } from '../src/impact-ragdoll.js';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from './physics-test/three-stub.mjs';
import { RNG, clamp, lerp, smoothstep } from '../src/util.js';
import { damageIncrement, equivalentBarrierSpeed } from '../src/damage-math.js';

const source = readFileSync(new URL('../src/traffic.js', import.meta.url), 'utf8')
  .replace(/^import .*;$/gm, '').replace(/^export /gm, '');
const { Traffic, obbContact, impulse } = new Function(
  'THREE', 'RNG', 'clamp', 'lerp', 'smoothstep', 'ROAD', 'LANE_W', 'damageIncrement', 'equivalentBarrierSpeed', 'impactTarget', 'roundaboutHelpers',
  'const {circulatingPoint,roundaboutRange,entryYieldDistance,ringStation,ringPoint,polylinePoint,polylineStation,trafficRoundaboutRange,roundaboutYield}=roundaboutHelpers;\n'+source + '\nreturn { Traffic, obbContact, impulse };',
)(THREE, RNG, clamp, lerp, smoothstep, { gutter: 0.3 }, 3.5, damageIncrement, equivalentBarrierSpeed, impactTarget, roundaboutHelpers);

function world() {
  const T = Object.create(Traffic.prototype);
  Object.assign(T, {
    route: { lanes: () => 2, laneU: (_, lane) => 1.75 + 3.5 * lane, edge: () => 7,
      urban: () => 1, district: () => 'town', div: () => 0, medHalf: () => 0,
      lin: (a) => a === 'TX' ? 0 : -1, TX: 'TX', TZ: 'TZ',
      frame: () => ({ tx: 0, tz: -1, rx: 1, rz: 0 }) },
    rng: { chance: (p) => p > 0, range: (a, b) => (a + b) / 2 },
    t: 0, dir: 1, cars: [], racers: [], wrecks: [], objs: [], sites: [], cones: [], honks: [], sounds: [],
  });
  const c = { id: 1, s: 1000, u: 1.75, dir: 1, lane: 0, v: 15, len: 4.4, wid: 1.8,
    mass: 1500, I: 1500 * (4.4 ** 2 + 1.8 ** 2) / 12, kind: 'sedan', type: {}, active: true, dmg: 0,
    m: { root: { visible: true }, setDamage() {} }, indL: {}, indR: {}, flash: {},
    drv: { arch: 'normal', agg: 0.3, rt: 0.5, freeze: 0, horn: 1, mirror: 0.35, indicate: 1 },
  };
  T.initDrive(c); T.cars.push(c);
  return { T, c };
}

// Match main.js: both the observation and the player's actor wrapper are new each tick.
const racer = (veh, s, vs = -20, u = 1.75) => ({ a: { veh }, kind: 'player', s, u, vs, vu: 0, hs: 2.2, hu: 0.9 });
function see(T, c, R, dt = 0.1) { T.racers = R ? [R] : []; return T.watchRacers(c, dt, 2, 1); }

test('head-on response waits for reaction time, then swerves, honks, flashes and brakes', () => {
  const { T, c } = world(), veh = {};
  for (let i = 0; i < 4; i++) see(T, c, racer(veh, 1060));
  assert.equal(c.evade, null); assert.equal(T.honks.length, 0);
  for (let i = 0; i < 2; i++) see(T, c, racer(veh, 1060));
  assert.ok(c.evade); assert.ok(c.flashT > 0);
  assert.ok(Math.abs(c.evade.uT - c.u) > 1);
  assert.equal(T.honks[0].reason, 'overtaker');
  assert.ok(see(T, c, racer(veh, 1040)) < -3);
});

test('evader tracks fresh player snapshots and gives the angry horn when the player passes', () => {
  const { T, c } = world(), veh = {};
  c.seeT = 1; see(T, c, racer(veh, 1060));
  see(T, c, racer(veh, 1030));
  assert.equal(c.evade.R.s, 1030);
  see(T, c, racer(veh, 980));
  assert.equal(c.evade, null); assert.ok(c.shakenT > 0);
  assert.deepEqual(T.honks.map(h => h.reason), ['overtaker', 'shaken']);
});

test('a threat leaving observation lets the evader recover instead of following stale coordinates', () => {
  const { T, c } = world(); c.seeT = 1; see(T, c, racer({}, 1060));
  for (let i = 0; i < 15; i++) see(T, c, null);
  assert.equal(c.evade, null);
  assert.equal(T.honks.filter(h => h.reason === 'shaken').length, 0);
});

test('head-on tracking also works for reverse-direction traffic and police without actor wrappers', () => {
  const { T, c } = world(); c.dir = -1; c.u = -1.75; c.seeT = 1;
  const police = {};
  const R = s => ({ a: police, kind: 'police', s, u: -1.75, vs: 20, vu: 0, hs: 2.2, hu: 0.9 });
  see(T, c, R(940)); assert.ok(c.evade);
  see(T, c, R(1020)); assert.equal(c.evade, null);
  assert.equal(T.honks.at(-1).reason, 'shaken');
});

test('ordinary drivers decide whether to yield once per approach, even with fresh actor wrappers', () => {
  const { T, c } = world(), veh = {}; let choices = 0;
  T.rng.chance = () => { choices++; return false; };
  for (let i = 0; i < 120; i++) see(T, c, racer(veh, 960, 35), 1 / 60);
  assert.equal(choices, 1); assert.equal(c.yieldT, 0); assert.equal(c.lane, 0);
  see(T, c, racer({}, 960, 35)); assert.equal(choices, 2);
  see(T, c, null); see(T, c, racer(veh, 960, 35)); assert.equal(choices, 3);
});

test('courteous drivers indicate and give a closing car the left lane when the right lane is clear', () => {
  const { T, c } = world(); c.drv.arch = 'courteous'; c.drv.mirror = 1;
  see(T, c, racer({}, 960, 35));
  assert.equal(c.lane, 1); assert.equal(c.blinkSide, 1); assert.ok(c.yieldT > 0);
  assert.ok(c.lcDelay <= 0.5);
});

test('driver population keeps distracted drivers rare and preserves courteous/normal variety', () => {
  const { T, c } = world(); T.rng = new RNG(4242);
  c.beh = { a: 1.6, b: 3, T: 1.2, s0: 2.2, vf: 1, latV: 1.5 };
  const counts = {};
  for (let i = 0; i < 10000; i++) { T.personality(c); counts[c.drv.arch] = (counts[c.drv.arch] || 0) + 1; }
  assert.ok(counts.distracted > 350 && counts.distracted < 650);
  assert.ok(counts.courteous > 1800 && counts.normal > 3500);
});

test('off-centre collisions conserve momentum, absorb energy and spin both cars', () => {
  const body = (s, u, vs) => ({ s, u, vs, vu: 0, w: 0, phi: 0, hl: 2.2, hw: 0.9, m: 1500, I: 2800 });
  const A = body(0, 0, 20), B = body(4, 1.2, 0);
  const energy = () => [A, B].reduce((e, b) => e + (b.m * (b.vs ** 2 + b.vu ** 2) + b.I * b.w ** 2) / 2, 0);
  const before = energy(), result = impulse(A, B, obbContact(A, B), 0.15, 0.45);
  assert.ok(result.j > 0); assert.ok(Math.abs(A.w) > 0.1 && Math.abs(B.w) > 0.1);
  assert.ok(Math.abs(A.m * A.vs + B.m * B.vs - 30000) < 1e-8);
  assert.ok(Math.abs(A.m * A.vu + B.m * B.vu) < 1e-8);
  assert.ok(energy() < before);
});

test('reversing into a parked car reports rear damage; separating overlaps add no impulse or damage', () => {
  const { T, c } = world(); c.s = 996; c.v = 0; c.mode = 'parked';
  const veh = { s: 1000, u: 1.75, x: 1.75, z: -1000, yaw: 0, vLong: -10, vLat: 0, w: 0,
    halfL: 2.2, halfW: 0.9, m: 1500, Iz: 2800 };
  const events = []; T.collide({ veh, kind: 'player' }, events, 0);
  assert.equal(events[0].zone, 'rear'); assert.ok(c.crash?.wreck);
  const separate = world(); separate.c.s = 1004; separate.c.mode = 'parked'; separate.c.v = 0;
  const separating = { ...veh, s: 1000, x: 1.75, z: -1000, vLong: -10 };
  const noEvents = []; separate.T.collide({ veh: separating, kind: 'player' }, noEvents, 1);
  assert.equal(noEvents.length, 0); assert.equal(separate.c.crash, null);
  assert.equal(separating.vLong, -10); assert.equal(separate.c.dmg, 0);
});
test('online traffic reports the applied impulse and cone kick through the multiplayer contact hooks', () => {
  const {T,c}=world();c.s=996;c.v=0;c.mode='parked';let carHit,coneHit;
  T.online={contactCar(...args){carHit=args;},contactCone(...args){coneHit=args;}};
  c.m.setDamageSnapshot=()=>{};
  const veh={s:1000,u:1.75,x:1.75,z:-1000,yaw:0,vLong:-10,vLat:0,w:0,halfL:2.2,halfW:.9,m:1500,Iz:2800};
  T.collide({veh,kind:'player'},[],0);assert.equal(carHit[0],c);assert.ok(carHit[3]>.1);assert.equal(carHit[1].vs,0);assert.ok(carHit[2].vs<0);
  c.active=false;T.cones=[{s:veh.s,u:veh.u,y:0}];T.collide({veh,kind:'player'},[],1);assert.equal(coneHit[1],0);assert.equal(coneHit[0].hit,true);
});
test('online circuit traffic remains solid to a driver on another lap and restores its shared coordinates',()=>{
  const {T,c}=world();T.route.closed=true;T.route.length=2000;c.s=996;c.v=0;c.mode='parked';
  T.online={contactCar(){},contactCone(){}};c.m.setDamageSnapshot=()=>{};
  const veh={s:3000,u:1.75,x:1.75,z:-1000,yaw:0,vLong:-10,vLat:0,w:0,halfL:2.2,halfW:.9,m:1500,Iz:2800},events=[];
  T.collide({veh,kind:'player'},events,0);assert.ok(events.some(e=>e.dv>0));assert.ok(c.crash);assert.ok(c.s<1000);assert.ok(Math.abs(veh.s-3000)<1);
});

test('a hard-hit car settles as a wreck with hazards instead of resuming its drive', () => {
  const { T, c } = world();
  T.hitCar(c, { ...T.carBody(c), vs: 8 }, 5, 'rear', 0);
  for (let i = 0; i < 1200; i++) { T.t += 1 / 60; T.updateCrashed(c, 1 / 60); }
  assert.ok(c.crash?.wreck); assert.equal(c.v, 0);
  assert.ok(Math.hypot(c.crash.vs, c.crash.vu) < 0.1);
  assert.equal(c.indL.emissiveIntensity, c.indR.emissiveIntensity);
});

test('hard bike contact emits one rider ejection and gives the bike its own tumble', () => {
  const {T,c}=world();c.type={id:'moto',scooter:true};
  const B={vs:15,vu:2,w:.5,phi:.1};
  T.hitCar(c,B,2,'front',0);assert.equal(c.rider,null);
  T.hitCar(c,B,8,'left',0);assert.ok(c.rider);assert.ok(c.crash.rollV>1);
  assert.equal(T.sounds.filter(e=>e.kind==='rider-thrown').length,1);
  assert.equal(T.sounds.find(e=>e.kind==='rider-thrown').target,'rider');
  const seed=c.rider;T.hitCar(c,B,10,'front',0);assert.equal(c.rider,seed);
  assert.equal(T.sounds.filter(e=>e.kind==='rider-thrown').length,1);
  T.repair(c);assert.equal(c.rider,null);
});

test('recovery, repair and reset clear ejected rider state and restore the attached rider', () => {
  for (const action of ['initDrive','repair','reset']) {
    const {T,c}=world(), attached={name:'attached-rider',visible:false};
    c.m.root.traverse=fn=>fn(attached);
    const body={kind:'rider',owner:c.id,active:true};
    Object.assign(c,{rider:{age:1},riderDrawn:{},riderBody:body,riderHidden:true});
    T.disabled=true;T.proxies={begin(){},end(){}};T.updateCones=()=>{};
    T[action](action==='reset'?0:c);
    for(const key of ['rider','riderDrawn','riderBody'])assert.equal(c[key],null,action+' '+key);
    assert.equal(body.active,false);assert.equal(c.riderHidden,false);assert.equal(attached.visible,true);
  }
});
test('rider cleanup does not deactivate a pool body reassigned to another owner',()=>{
 const {T,c}=world();c.riderBody={kind:'rider',owner:99,active:true};const b=c.riderBody;
 T.initDrive(c);assert.equal(b.active,true);assert.equal(c.riderBody,null);
});


test('persistent pushing recycles only out of every player view, even when the car is moving', () => {
  const {T,c}=world(); c.v=8; T.drawRange=650;
  for(let i=0;i<50;i++){T.t+=.1;c.contactAt=T.t;assert.equal(T.recoverStuck(c,.1,c.s),false);}
  assert.ok(c.contactT>=4);assert.equal(c.active,true);
  T.onlineFoci=[c.s];assert.equal(T.recoverStuck(c,.1,0),false);
  T.onlineFoci=[];assert.equal(T.recoverStuck(c,.1,0),true);
  assert.equal(c.active,false);assert.equal(c.m.root.visible,false);
  T.initDrive(c);assert.equal(c.contactT,0);assert.equal(c.recoveryT,0);assert.equal(c.contactAt,-Infinity);
});

test('recovery tolerates short contacts, signals, bus tasks and parked or police cars', () => {
  for(const setup of [c=>{},c=>{c.task={kind:'bus'};c.stuckT=30;},c=>{c.mode='parked';c.crash={};},c=>{c.cop={};c.crash={};}]){
    const {T,c}=world();setup(c);
    for(let i=0;i<100;i++){T.t+=.1;assert.equal(T.recoverStuck(c,.1,0),false);}
    assert.equal(c.active,true);
  }
  const {T,c}=world();c.contactAt=0;
  for(let i=0;i<50;i++){T.t+=.1;assert.equal(T.recoverStuck(c,.1,0),false);}
  assert.equal(c.contactT,0);
});

test('unresolved crashes and blocked drivers are recycled; loop copies remain visible',()=>{
  for(const crash of [true,false]){
    const {T,c}=world();if(crash)c.crash={};else c.stuckT=20;
    for(let i=0;i<79;i++){T.t+=.1;assert.equal(T.recoverStuck(c,.1,0),false);}
    assert.equal(T.recoverStuck(c,.2,0),true);assert.equal(c.crash,null);
  }
  const {T,c}=world();T.route.closed=true;T.route.length=2000;c.crash={};c.recoveryT=10;
  assert.equal(T.recoverStuck(c,.1,c.s+2000),false);
});

test('tiny repeated nudges preserve a crashed driver recovery clock',()=>{
  const {T,c}=world();
  const B={vs:0,vu:0,w:0,phi:0};T.hitCar(c,B,.5,'rear',0);
  c.crash.t=4;c.crash.rec=1;
  for(let i=0;i<20;i++)T.hitCar(c,B,.01,'rear',i*.1);
  assert.equal(c.crash.t,4);assert.equal(c.crash.rec,1);
  T.hitCar(c,B,1,'rear',3);assert.equal(c.crash.t,.5);assert.equal(c.crash.rec,0);
});


test('queued racers never make a visible wreck disappear through the old tow timer',()=>{
 const {T,c}=world();c.crash={wreck:true,vs:0,vu:0};T.racers=[racer({},c.s-8,0)];
 for(let i=0;i<150;i++){T.t+=.1;T.trackHeldRacers(.1);assert.equal(T.recoverStuck(c,.1,c.s-8),false);}
 assert.ok(c.heldT>10);assert.equal(c.active,true);
 T.racers=[];assert.equal(T.recoverStuck(c,.1,0),true);assert.equal(c.active,false);
});
