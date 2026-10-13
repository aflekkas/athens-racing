import './register.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
// Stub only rendering imports; use the production collider and impact methods.
const source = readFileSync(new URL('../../src/road.js', import.meta.url), 'utf8'), start = source.indexOf('export const ROAD =');
const roadURL = 'data:text/javascript,' + encodeURIComponent(`import { lerp, smoothstep } from ${JSON.stringify(new URL('../../src/util.js', import.meta.url).href)};\n` + source.slice(start, source.indexOf('\n};', start) + 3));
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(spec, ctx, next) {
  if (ctx.parentURL?.endsWith('/src/ground.js')) {
    if (spec === './road.js') return {url:${JSON.stringify(roadURL)},shortCircuit:true};
    if (spec === './tex.js') return {url:'data:text/javascript,export const TX={};',shortCircuit:true};
  } return next(spec,ctx);
}`), import.meta.url);
const { Ground } = await import('../../src/ground.js');
const { Vehicle } = await import('../../src/physics.js');
const { damageIncrement } = await import('../../src/damage-math.js');
const catalogue = readFileSync(new URL('../../src/cars.js', import.meta.url), 'utf8');
const CARS = Function('return '+catalogue.split('export const CARS = ')[1].split('\n];')[0]+'\n];')();
const route = {closed:true,length:1000,wrap:s=>s,GR:null,frame(s,o){return Object.assign(o,{tx:0,tz:-1,rx:1,rz:0,grade:0,bank:0});},point(s,u){return{x:u,z:-s,y:0};},y:()=>0,bank:()=>0,surfaceY:()=>0,urban:()=>0,edge:()=>900,lin:()=>0,project(x,z){return{s:-z,u:x};}};
const ground = parked => Object.assign(Object.create(Ground.prototype),{HC:20,bh:new Map(),parked,route,out:{},traps:[],heightC:()=>0,terrain:{cls:()=>0},hump:()=>0,limits:(s,r,o)=>Object.assign(o,{min:-900,max:900})});
const impact = metadata => {
  const obstacle={x:0,z:-103,yaw:0,hw:3,hl:.5,...metadata};
  const g=ground([obstacle]),v=new Vehicle(CARS.find(c=>c.id==='z4'),route);
  v.reset(101,0,12);g.resolve(v,1/240);
  return {v,g,obstacle};
};
test('tyre barrier keeps collider metadata through resolve and reduces crush energy',()=>{
  const wall=impact({}),tyre=impact({kind:'tyre',restitution:.3,damageScale:.55});
  assert.ok(Math.abs(wall.v.vLong+1.8)<1e-9,'rigid wall must retain its prior rebound');
  assert.ok(Math.abs(tyre.v.vLong+3.6)<1e-9,'tyre restitution must control the actual rebound');
  assert.equal(wall.v.lastDamage.kind,'wall');assert.equal(tyre.v.lastDamage.kind,'tyre');
  assert.ok(Math.abs(wall.v.damage.front-damageIncrement(12,'front'))<1e-9);
  assert.ok(Math.abs(tyre.v.damage.front-damageIncrement(12*Math.sqrt(.55),'front'))<1e-9);
  assert.ok(tyre.v.damage.front>0&&tyre.v.damage.front<wall.v.damage.front*.56);
  assert.ok(tyre.v.corners.every(c=>c.vw===tyre.v.vLong),'wheel speeds must follow the impact');
  console.log(JSON.stringify({wall:{rebound:wall.v.vLong,damage:wall.v.damage.front},tyre:{rebound:tyre.v.vLong,damage:tyre.v.damage.front}}));
});
test('deepest winning contact supplies metadata; reused output cannot inherit tyre response',()=>{
  const tyre={x:0,z:0,yaw:0,hw:.5,hl:2,kind:'tyre',restitution:.3,damageScale:.55};
  const wall={x:.1,z:0,yaw:0,hw:.5,hl:2};const g=ground([tyre,wall]),out={};
  assert.equal(g.walls(.7,0,.4,out).collider,wall);
  g.parked=[tyre];g._ph=null;assert.equal(g.walls(.7,0,.4,out).collider,tyre);
  g.parked=[wall];g._ph=null;assert.equal(g.walls(.7,0,.4,out).collider,wall);
  assert.equal(out.collider.restitution,undefined);
  assert.equal(g.walls(20,0,.4,out),null);
});
