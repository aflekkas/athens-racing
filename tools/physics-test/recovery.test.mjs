// Run with --import ./tools/damage-test-register.mjs: real Three, Ground and tyre solver.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
const physicsURL=new URL(process.env.PHYS || '../../src/physics.js',import.meta.url);
const {Vehicle}=await import(physicsURL);
const {Ground}=await import(process.env.GROUND || new URL('./ground.js',physicsURL));
const {WEATHER}=await import(new URL('./wet-grip.js',physicsURL));
const source=readFileSync(new URL('./cars.js',physicsURL),'utf8');
const cars=Function('return '+source.split('export const CARS = ')[1].split('\n];')[0]+'\n];')();
const route={length:1e5,closed:false,frame:(s,o={})=>Object.assign(o,{tx:0,tz:-1,rx:1,rz:0,grade:0,bank:0}),
 point:(s,u)=>({x:u,y:0,z:-s}),project:(x,z)=>({s:-z,u:x}),edge:()=>7,medHalf:()=>0,div:()=>0,
 urban:()=>1,y:()=>0,surfaceY:()=>0,bank:()=>0,lin:()=>0};
const evidence=[];
function vehicle(id,wet,surface){
 const spec=cars.find(c=>c.id===id),v=new Vehicle({...spec,tc:0,esc:0,edl:0},route);
 v.reset(200,12);v.manual=true;v.roadZ=()=>0;
 const g=Object.create(Ground.prototype);Object.assign(g,{route,out:{},limits:()=>({min:-100,max:100}),walls:()=>null});
 g.at=(x,z,s,u,o={})=>Object.assign(o,{y:0,hump:0,surf:surface,water:0});v.ground=g;
 Object.assign(WEATHER,{wet:wet?1:0,gripScale:wet?.76:1});return v;
}
for(const id of ['corolla','carrera','z4','huracan'])for(const wet of [false,true])for(const surf of ['dirt','gravel','scrub','sand','deepsand']) {
 test(`${id} ${wet?'wet':'dry'} ${surf}: ordinary throttle escapes runoff without a permanent rut`,()=>{
  try {
   const v=vehicle(id,wet,surf),z=v.z;let maxDig=0,maxEllipse=0;
   for(let i=0;i<480;i++){
    v.update(1/60,{throttle:.5,brake:0,steer:0});maxDig=Math.max(maxDig,v.dig);
    for(let j=0;j<4;j++){const c=v.corners[j];maxEllipse=Math.max(maxEllipse,Math.hypot(c.Fx/(v._cap[j]*v.muX),c.Fy/v._cap[j]));}
   }
   const distance=Math.abs(v.z-z);evidence.push({id,wet,surf,distance,maxDig,maxEllipse,kmh:v.kmh});
   assert.ok(distance>12,`${distance.toFixed(2)} m in 8 s`);assert.ok(maxDig<=.45);assert.ok(maxEllipse<=1.000001,'tyres stay within the friction ellipse');
   // Flooring then lifting releases a rut without reset/teleport.
   for(let i=0;i<120;i++)v.update(1/60,{throttle:1,brake:0,steer:0});
   for(let i=0;i<120;i++)v.update(1/60,{throttle:0,brake:0,steer:0});
   assert.ok(v.dig<.01,'lifting frees ruts');
  }finally{Object.assign(WEATHER,{wet:0,rain:0,gripScale:1});}
 });
}
for(const id of ['corolla','carrera','huracan'])for(const side of [-1,1])test(`${id}: 8 km/h approach crosses the town kerb ${side}`,()=>{
 const v=vehicle(id,false,'pavement');v.reset(200,side*9,8/3.6);v.yaw=side*Math.PI/2; // facing toward the road
 const g=v.ground;g.at=(x,z,s,u,o={})=>Object.assign(o,{y:Math.abs(u)>7.18?.16:0,hump:0,surf:Math.abs(u)>7.18?'pavement':'asphalt',water:0});
 let minU=Math.abs(v.u);
 for(let i=0;i<240;i++){v.update(1/60,{throttle:.2,brake:0,steer:0});minU=Math.min(minU,Math.abs(v.u));}
 evidence.push({id,scenario:'kerb',side,minU,u:v.u,kmh:v.kmh,wallHit:v.wallHit});
 assert.ok(minU<7,`crossed into road: nearest u ${minU}`);assert.ok(v.wallHit===0);assert.ok(!v.engineStalled);
});
process.on('exit',()=>{mkdirSync('.scratch/handling-playtest3',{recursive:true});writeFileSync('.scratch/handling-playtest3/recovery-ground.json',JSON.stringify(evidence,null,2));});
