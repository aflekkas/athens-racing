import test from 'node:test';
import assert from 'node:assert/strict';
import { SharedWorld, applySharedCar } from '../src/mp-shared-world.js';
import { worldPackets } from '../src/shared-world-protocol.js';

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
