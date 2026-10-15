import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Ragdoll, RagdollPool, RAGDOLL_CAP, STEP, LIFE, impactTarget, pedestrianThump } from '../src/impact-ragdoll.js';
import { packCar, validCarRow, WorldAssembler, worldPackets } from '../src/shared-world-protocol.js';
import { applySharedCar } from '../src/mp-shared-world.js';
const ground=()=>0;
const launch=(speed=12)=>({x:0,y:0,z:0,vx:0,vz:-speed,seed:17});
const advance=(b,t)=>{for(let i=0;i<Math.round(t/STEP);i++)b.update(STEP,ground);};
test('joint lengths and opening limits remain bounded through hard landing',()=>{
 const b=new Ragdoll().launch(launch(28));advance(b,3);
 for(const [a,c,min,max] of b.links){const d=Math.hypot(b.p[a]-b.p[c],b.p[a+1]-b.p[c+1],b.p[a+2]-b.p[c+2]);assert(d>=min-.009&&d<=max+.009,`${a}/${c}: ${d} in ${min}..${max}`);}
 for(let i=0;i<16;i++)assert(b.p[i*3+1]>=b.radius[i]-1e-8);
});
test('a low speed knock-down settles, remains for seconds, then expires',()=>{
 const b=new Ragdoll().launch(launch(2));advance(b,5);assert(b.sleeping);assert(b.active);assert(b.p[10]<.3);
 const settled=b.p.slice();advance(b,1);assert.deepEqual(b.p,settled);advance(b,LIFE);assert(!b.active);
});
test('moderate impact folds the torso onto the live bonnet without launching skyward',()=>{
 const car={x:0,y:0,z:0,yaw:0,halfL:2.2,halfW:.9,height:1.4,vz:-10};
 const b=new Ragdoll().launch({...launch(10),x:.1,z:-2.3,car});
 for(let i=0;i<60;i++){car.z-=10*STEP;b.update(STEP,ground);}
 assert(b.p[1]>.75&&b.p[1]<1.4);assert(Math.abs(b.p[10]-b.p[1])<.4);assert(Math.abs(b.p[11]-b.p[2])>.25);
 assert(b.p[2]-car.z<0);assert(Math.max(...b.p.filter((_,i)=>i%3===1))<2.4);
});
test('higher speed reaches windscreen/roof; thrown body travels further than knockdown',()=>{
 const car={x:0,y:0,z:0,yaw:0,halfL:2.2,halfW:.9,height:1.4,vz:-23};const b=new Ragdoll().launch({...launch(23),x:.1,z:-2.3,car});
 for(let i=0;i<60;i++){car.z-=23*STEP;b.update(STEP,ground);}assert(b.p[10]>1.4);
 const low=new Ragdoll().launch(launch(2)),high=new Ragdoll().launch(launch(28));advance(low,2);advance(high,2);assert(Math.abs(high.p[2])>Math.abs(low.p[2])+8);
});
test('one fixed pool caps both riders and pedestrians and reuses oldest body buffers',()=>{
 const pool=new RagdollPool(),buffers=pool.bodies.map(b=>b.p);
 for(let i=0;i<12;i++){pool.spawn({...launch(),kind:i%2?'rider':'pedestrian'});pool.update(.1,ground);}
 assert.equal(pool.bodies.filter(b=>b.active).length,RAGDOLL_CAP);assert.deepEqual(pool.bodies.map(b=>b.p),buffers);pool.clear();assert(pool.bodies.every(b=>!b.active));
});
test('fixed shared seed yields identical motion across frame groupings',()=>{
 const a=new Ragdoll().launch({...launch(22),kind:'rider'}),b=new Ragdoll().launch({...launch(22),kind:'rider'});
 advance(a,1);for(let i=0;i<30;i++)b.update(1/30,ground);assert.deepEqual(a.p,b.p);
});
test('bike source classification is rider, regular vehicles stay vehicles; no scooter scream route',()=>{
 for(const id of ['scooter','moto','delivery','police_moto'])assert.equal(impactTarget({id}),'rider');
 assert.equal(impactTarget({scooter:true}),'rider');assert.equal(impactTarget({id:'sedan'}),'vehicle');
 const main=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');assert(!/e\.car\.type\.scooter\) audio\.scream/.test(main));
 const people=readFileSync(new URL('../src/people.js',import.meta.url),'utf8');assert(people.includes("kind:'hit', target:'pedestrian'"));
});
test('shared car packets preserve immutable ejection seeds and elapsed age through replicas',()=>{
 const r={s:100,u:3,y:2,yaw:.2,vs:15,vu:-3,vy:5,age:.4};
 const c={id:1,s:101,u:3,dir:1,wheel:0,dmg:0,rider:r};
 const row=packCar({carBody:()=>({vs:12,vu:0,phi:0,w:0})},c);assert.equal(row.length,32);assert(validCarRow(row));
 const replica={active:true,type:{},m:{},indL:{},indR:{},flash:{}},traffic={cars:[null,replica],roadSpeed:()=>15};
 const assembler=new WorldAssembler();let frame;for(const p of worldPackets({seq:1,at:100},[row],[]))frame=assembler.accept(p);assert(frame);
 applySharedCar(traffic,frame.rows[0],.1);assert.deepEqual(replica.rider,{...r,age:.5});
 const seed=replica.rider;row[31]=80;applySharedCar(traffic,row);assert.equal(replica.rider,seed);assert.equal(seed.age,.8);
 const bad=row.slice();bad[30]=-1;assert(!validCarRow(bad));applySharedCar(traffic,row.slice(0,24));assert.equal(replica.rider,null);
});

test('pedestrian contact slows both forward and reversing cars and excites suspension feedback',()=>{
 for(const speed of [1,8,30,-8]){
  let kick;const v={vLong:speed,m:1200,yaw:0,bodyKick(...args){kick=args;}};
  const dv=pedestrianThump(v,Math.abs(speed),.5,0);
  assert(dv>0&&dv<=1.6);assert(Math.abs(v.vLong)<Math.abs(speed));assert(v.bumpHit>=.3);assert(kick[0]<0&&kick[1]<0);
 }
});
