import test from 'node:test';
import assert from 'node:assert/strict';
import { SharedWorld, applySharedCar } from '../src/mp-shared-world.js';
import { worldPackets } from '../src/shared-world-protocol.js';
import { onlineWorldVisibility } from '../src/mp-world-policy.js';
import { validateStateExtras } from '../server/mp-lifecycle.mjs';
import { ServerClock } from '../src/server-clock.js';

const row = () => [0,10000,300,1200,50,200,100,20,0,300,100,0,1,3,5000,0,400,0,0,0,3,0,0,800];
function fixture() {
  let now=100000;
  const c={id:0,active:false,len:4,wid:2,type:{},m:{root:{visible:false},setDamageSnapshot(z){this.damage={...z};}},indL:{},indR:{},flash:{}};
  const cone={s0:120,u0:3,s:120,u:3,y:0,hit:false},traffic={cars:[c],cones:[cone],reset(){c.active=false;},initDrive(q){q.drv={vf:1};q.cross=null;q.crash=null;},roadSpeed(){return 15;},updateCones(){},update(dt){this.updates=(this.updates||0)+1;for(const q of this.cars)if(q.active)q.s+=(q.crash?.vs||q.v)*dt;},carBody(q){return{s:q.s,u:q.u,vs:q.crash?.vs||q.v,vu:q.crash?.vu||0,w:q.crash?.w||0,phi:q.crash?.yaw||q.yawLC};},hitCar(q,b,dv,z){q.crash={...q.crash,...b};q.dz[z]=Math.min(1,q.dz[z]+dv/30);}};
  const lobby={raceId:'r',generation:2,status:'race',host:'host',config:{traffic:2},players:[{id:'host',loaded:true,connected:true},{id:'guest',loaded:true,connected:true}]},sent=[];
  const mp={id:'guest',lobby,connected:true,now:()=>now,send:p=>sent.push(p)};
  const world=new SharedWorld(mp,()=>({traffic,player:{veh:{s:100}},remotes:[]}));
  const receive=(seq=0,at=now,rows=[row()],cones=[])=>{for(const m of worldPackets({raceId:'r',generation:2,owner:'host',seq,at},rows,cones))world.receive(m);};
  return{world,mp,traffic,c,cone,sent,receive,advance:ms=>{now+=ms;}};
}
test('replicas only apply shared poses, damage and props, with capped extrapolation',()=>{
  const {world,traffic,c,cone,receive,advance}=fixture();receive(0,100000,[row()],[[0,12500,350,20,100,0,0,1571,0,0]]);
  assert.equal(c.s,100);assert.equal(c.m.damage.front,.4);assert.equal(cone.s,125);assert.equal(cone.hit,true);
  advance(1000);world.update(.1);assert.equal(traffic.updates,undefined);assert.equal(c.s,104.2);assert.ok(c.crash.wreck);
  receive(1,101000,[],[]);assert.equal(c.active,false);assert.equal(cone.hit,false);assert.equal(cone.s,cone.s0);
});
test('promotion retains the replicated wreck instead of spawning an unrelated fleet',()=>{
  const {world,mp,traffic,c,sent,receive}=fixture();receive();const before=c.s;
  mp.lobby.players[0].connected=false;world.update(.1);
  assert.equal(world.authority,true);assert.equal(traffic.updates,1);assert.ok(c.crash.wreck);assert.ok(Math.abs(c.s-before)<2);assert.ok(sent.some(p=>p.type==='world-frame'));
});
test('local guest contact prediction is bounded, sent once per cooldown and reconciled from authority',()=>{
  const {world,c,sent,receive,advance}=fixture();receive();c.s=101;
  const before={s:100,u:3,vs:12,vu:0,w:0},after={vs:15,vu:2,w:1};
  world.contactCar(c,before,after,3,'rear',{ebs:6});world.contactCar(c,before,after,3,'rear',{ebs:6});assert.equal(sent.length,1);
  assert.deepEqual(sent[0].body.slice(0,7),[0,100,0,300,200,1000,300]);
  advance(300);const corrected=row();corrected[1]=10700;corrected[17]=300;receive(1,100300,[corrected]);
  assert.equal(c.s,107);assert.equal(c.m.damage.rear,.3);assert.equal(world.predictions.size,0);
});
test('car reconstruction uses the same quantization for both direction and crash heading',()=>{
  const {traffic}=fixture(),r=row();r[12]=-1;r[5]=Math.round((Math.PI+.2)*1000);
  const c=applySharedCar(traffic,r,.2);assert.ok(Math.abs(c.crash.yaw-.22)<.002);assert.equal(c.dir,-1);
});
test('online policy removes pedestrian render instances, impact particles, marks and water splashes',()=>{
  const particle=()=>({life:new Float32Array([1]),alpha:new Float32Array([1]),pos:new Float32Array([1,2,3]),live:1,pts:{visible:true,geometry:{attributes:{position:{},aAlpha:{}}}}});
  const fx={smoke:particle(),grit:particle(),sparkP:particle(),marks:{visible:true},blurPool:[{group:{visible:true}}],clearMarks(){this.cleared=true;}};
  const crowd={n:3,begin(){this.n=0;},end(){}},people={crowd,onRoad:[{}],events:[{}]},splash={life:new Float32Array([1]),pts:{visible:true},ring:{visible:true}};
  onlineWorldVisibility(true,{people,fx,splash});assert.equal(crowd.n,0);assert.equal(people.onRoad.length,0);assert.equal(fx.marks.visible,false);assert.equal(fx.smoke.pts.visible,false);assert.equal(splash.ring.visible,false);assert.equal(splash.pts.visible,false);assert.equal(splash.t,9);
  onlineWorldVisibility(false,{people,fx,splash});assert.equal(fx.marks.visible,true);assert.equal(fx.smoke.live,0);assert.equal(fx.smoke.pts.visible,true);
});
test('remote brake-light and suspension telemetry accepts only bounded values',()=>{
  assert.deepEqual(validateStateExtras({braking:true,bodyHeave:.1,bodyRoll:-.4,bodyPitch:.3}),{braking:true,bodyHeave:.1,bodyPitch:.3,bodyRoll:-.4});
  assert.deepEqual(validateStateExtras({braking:'true',bodyHeave:Infinity,bodyRoll:50,bodyPitch:NaN}),{});
});
test('delayed loading and reconnect stamps cannot override a fresher server clock or low-RTT ping',()=>{
  const c=new ServerClock();assert.equal(c.observe(1000,2000),-1000);
  assert.equal(c.observe(3010,3020),-10,'fresh world stamp fixes an old hello');
  assert.equal(c.observe(4005,4010,4000),0);
  assert.equal(c.observe(4200,5200),0,'delayed resume hello preserves the measured clock');
  assert.equal(c.observe(6200,7000,6000),0,'a slower pong cannot replace the good sample');
  assert.equal(c.observe(NaN,7100),0);
});

test('authenticated physical rows reject mixed legacy geometry, bad deck/rider data and reserved bits',async()=>{
 const {validCarRow,validWorldCarRow,validWorldConeRow,validWorldPart}=await import('../src/shared-world-protocol.js');
 const r=[...row(),...Array(8).fill(0),-3245678,30546,-1091750,0,1200,100,1,0];assert.ok(validCarRow(r));assert.ok(validWorldCarRow(r));
 for(const [at,value]of [[32,1e7+1],[33,1e6+1],[35,17],[36,20001],[38,4],[39,1],[24,1]]){const bad=r.slice();bad[at]=value;assert.equal(validWorldCarRow(bad),false,`${at}`);}
 const rider=r.slice();rider[38]=3;rider.splice(24,8,123456,-234567,35000,314,-100,300,-200,500);assert.ok(validWorldCarRow(rider));rider[31]=-1;assert.equal(validWorldCarRow(rider),false);
 const cone=[0,0,0,0,0,0,0,0,0,0,-3245678,30546,-1091750,0,1200,100,1,0];assert.ok(validWorldConeRow(cone));cone[17]=1;assert.equal(validWorldConeRow(cone),false);
 assert.equal(validWorldPart({type:'world-frame',seq:1,at:1,total:1,part:0,rows:[r],cones:[]}),false,'world poses require authenticated route binding');
});
test('world parts retain exact immutable identity and cannot assemble parts from another edition',async()=>{
 const {WorldAssembler,validWorldPart}=await import('../src/shared-world-protocol.js'),hash='a'.repeat(64),routeIdentity={worldId:'athens',routeId:'kifissia-kefalari',routeHash:hash,geometryHash:hash,worldSetRevision:hash,projectionId:'athens-v1',onlineGridHash:hash},r=[...row(),...Array(8).fill(0),-3245678,30546,-1091750,0,1200,100,1,0],base={raceId:'r',generation:1,owner:'host',seq:1,at:1,mapId:routeIdentity.routeId,routeIdentity};
 const p=worldPackets(base,[r],[])[0];assert.deepEqual(p.routeIdentity,routeIdentity);assert.ok(validWorldPart(p));assert.equal(validWorldPart({...p,mapId:'other'}),false);assert.equal(validWorldPart({...p,rows:[row()]}),false);
 const a=new WorldAssembler(),first={...p,total:2,part:0};assert.equal(a.accept(first),null);assert.equal(a.accept({...p,total:2,part:1,routeIdentity:{...routeIdentity,onlineGridHash:'b'.repeat(64)}}),null);assert.equal(a.accept({...p,total:2,part:1}),null,'cross-edition part cannot complete prior half frame');
});
test('full physical fleet and all displaced cones fit bounded packets and thirty messages per second without trimming',async()=>{
 const {WORLD_IDS,worldFrameIntervalMs,validWorldPart}=await import('../src/shared-world-protocol.js'),hash='f'.repeat(64),routeIdentity={worldId:'athens',routeId:'kifissia-kefalari',routeHash:hash,geometryHash:hash,worldSetRevision:hash,projectionId:'athens-v1',onlineGridHash:hash};
 const rows=Array.from({length:WORLD_IDS},(_,id)=>{const r=[...row(),-3245678,-1091750,30546,3141,-19999,19999,-19999,359999,-3245678,30546,-1091750,-16,-19999,19999,3,0];r[0]=id;return r;}),cones=Array.from({length:256},(_,id)=>[id,1234567,99999,9999,-19999,19999,-19999,12345,-12345,12345,-3245678,30546,-1091750,-16,-19999,19999,1,0]);
 const packets=worldPackets({raceId:'r'.repeat(36),generation:123,owner:'p'.repeat(36),seq:12345,at:1792750000000,now:1792750000000,mapId:routeIdentity.routeId,routeIdentity},rows,cones);
 assert.ok(packets.length>8&&packets.length<=24);assert.ok(packets.every(validWorldPart));assert.ok(packets.every(p=>Buffer.byteLength(JSON.stringify(p))<=3700));assert.equal(packets.flatMap(p=>p.rows).length,74);assert.equal(packets.flatMap(p=>p.cones).length,256);assert.ok(packets.length*1000/worldFrameIntervalMs(packets.length)<=30+1e-8);
});

function streamedFixture(){
 const hash='a'.repeat(64),routeIdentity={worldId:'athens',routeId:'test-route',routeHash:hash,geometryHash:hash,worldSetRevision:hash,projectionId:'athens-v1',onlineGridHash:hash},c={id:0,active:false,len:4,wid:2,mass:1200,m:{root:{visible:false},setDamageSnapshot(z){this.damage=z;}},indL:{},indR:{},flash:{},type:{}},traffic={cars:[c],t:0,route:{project:(x,z)=>({s:-z,u:x})},session:{roads:{graph:{nearest:()=>({edge:'actual-road',offsetM:20})}},safePose:()=>true},pool:{cones:[],initDrive(c){c.drv={};},carBody(c){return{vs:c.v||0,vu:0,phi:0,w:0};},damageCar(c,zone,dv){c.dz||={};c.dz[zone]=(c.dz[zone]||0)+dv/100;}},update(){this.updates=(this.updates||0)+1;},warmFleet(){throw Error('unexpected warm');}};
 let now=100000;const lobby={mapId:'test-route',routeIdentity,raceId:'r',generation:1,status:'race',host:'host',config:{traffic:1},players:[{id:'host',loaded:true,connected:true},{id:'guest',loaded:true,connected:true}]},sent=[],mp={id:'guest',lobby,active:true,connected:true,peers:new Map(),now:()=>now,send:p=>sent.push(p)};
 return{traffic,c,mp,lobby,sent,advance:ms=>now+=ms,routeIdentity};
}
test('streamed replicas keep actual world pose and deck without running private NPC simulation',async()=>{
 const {StreamedSharedWorld}=await import('../src/mp-world-traffic.js'),f=streamedFixture(),world=new StreamedSharedWorld(f.mp,()=>({traffic:f.traffic,player:{veh:{x:10,y:300,z:20}},remotes:[]})),r=[...row(),...Array(8).fill(0),-3245678,30546,-1091750,2,1200,100,1,0];
 for(const p of worldPackets({raceId:'r',generation:1,owner:'host',seq:0,at:100000,mapId:f.lobby.mapId,routeIdentity:f.routeIdentity},[r],[]))world.receive(p);
 f.advance(100);world.update(.1);assert.equal(f.traffic.updates,undefined);assert.equal(f.c.vehicle.x,-32455.579999999998);assert.equal(f.c.vehicle.y,305.46);assert.equal(f.c.point.layer,2);assert.equal(f.c.m.damage.front,.4);assert.equal(f.c.vehicle.yaw,.2);
 f.lobby.host='guest';world.update(.1);assert.equal(f.traffic.updates,1);assert.ok(f.sent.some(p=>p.type==='world-frame'&&p.routeIdentity===f.routeIdentity));
});
test('streamed host promotion refuses an unproved local footprint and guest impacts use physical deltas',async()=>{
 const {StreamedSharedWorld,applyWorldTrafficCar}=await import('../src/mp-world-traffic.js'),f=streamedFixture(),r=[...row(),...Array(8).fill(0),1000,30000,2000,1,0,0,1,0];
 f.traffic.session.safePose=()=>false;assert.equal(applyWorldTrafficCar(f.traffic,r,{promote:true}),null);assert.equal(f.c.active,false);f.traffic.session.safePose=()=>true;applyWorldTrafficCar(f.traffic,r);
 const world=new StreamedSharedWorld(f.mp,()=>({traffic:f.traffic,player:{veh:{}},remotes:[]}));world.configure();const before=world.beforeCollide();f.c.vehicle.vLong=5;world.afterCollide(before);assert.equal(f.sent.length,1);assert.equal(f.sent[0].type,'world-contact');assert.equal(f.sent[0].body.length,9);assert.ok(Math.abs(f.sent[0].body[3])+Math.abs(f.sent[0].body[4])>0);assert.equal(world.stats.contactsSent,1);
});
