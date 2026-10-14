// node --import ./tools/physics-test/register.mjs --test tools/damage-mechanics.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { Vehicle } from '../src/physics.js';
import { damageIncrement, equivalentBarrierSpeed, frontalBarrierSpeed, mechanicalIncrement, impactPowerFactor, isTerminalImpact, WRECK_EBS } from '../src/damage-math.js';
import { damageFeedback } from '../src/driving-feedback-model.js';
import { spectatorState, restoreVehicleState } from '../src/race-lifecycle.js';
const route = { frame: () => ({ tx:0,tz:-1 }), point: (s,u) => ({ x:u,y:0,z:-s }) };
const spec = { mass:1500,wheelbase:2.6,width:1.84,length:4.4,wheelR:.33,drive:'fwd',engine:'turbo4',idle:800,redline:6800,gears:[3.5,2,1],final:4.1 };
const mk = (extra = {}) => new Vehicle({ ...spec,...extra },route);
const wall = (v,kmh,zone='front',extra={}) => v.addDamage(zone,kmh/3.6,{kind:'wall',...extra});
const advance = (v,seconds) => { for(let t=0;t<seconds;t+=.05)v.damageFx(.05); };
const close = (actual,expected) => assert.ok(Math.abs(actual-expected)<1e-9,`${actual} != ${expected}`);

// Explicit expected crush/mechanical percentages, not a second implementation of the curve.
// Angles are degrees away from head-on; input speed is road speed, EBS uses its normal component.
const impacts = [
  [10,0,0,0], [10,30,0,0], [10,60,0,0], [10,80,0,0],
  [20,0,.04092071611253197,0], [20,30,.024936061381074168,0], [20,60,0,0], [20,80,0,0],
  [40,0,.23273657289002556,0], [40,30,.16879795396419442,0], [40,60,.06272972310708164,0], [40,80,0,0],
  [70,0,.760230179028133,.36], [70,30,.564418158567775,.0625], [70,60,.26488605733888765,0], [70,80,.0009196469185308916,0],
];
for(const [kmh,angle,body,mechanical] of impacts)test(`wall ${kmh} km/h at ${angle} degrees: cosmetic and frontal mechanical budgets`,()=>{
  const v=mk(),a=angle*Math.PI/180,zone=angle>=60?'left':'front';
  wall(v,kmh*Math.cos(a),zone,{localNormal:{x:Math.sin(a),y:0,z:Math.cos(a)}});
  close(v.damage[zone],body);close(v.impactMechanical,mechanical);
  assert.equal(v.engineStalled,false);assert.equal(v.radiatorDamage,0);
  assert.equal(isTerminalImpact(v.maxImpactEbs,v.impactMechanical),false);
  advance(v,120);close(v.engHealth,impactPowerFactor(mechanical));
});

test('moderate hits still dent the body; mechanical damage starts softly above 40 km/h',()=>{
  const v=mk();wall(v,30);assert.ok(v.damage.front>.1);assert.equal(v.engHealth,1);
  assert.equal(mechanicalIncrement(40/3.6),0);assert.ok(mechanicalIncrement(41/3.6)>0 && mechanicalIncrement(41/3.6)<.001);
  const high=mk();wall(high,60);close(high.impactMechanical,.16);assert.ok(high.engHealth>.96);
  advance(high,600);assert.equal(high.coolantTemp,90);assert.equal(high.engineStalled,false);
});

test('500 small incidents and glancing scrapes never accumulate engine or steering damage',()=>{
  for(const [kmh,zone]of [[10,'front'],[20,'front'],[30,'front'],[40,'front'],[70,'left'],[70,'rear']]){
    const v=mk({engineZone:'rear'});for(let i=0;i<500;i++)wall(v,kmh,zone);
    advance(v,120);assert.equal(v.engHealth,1);assert.equal(v.impactMechanical,0);assert.equal(v.engineStalled,false);assert.ok(v.cornerDamage.every(d=>d===0));
  }
  const scrape=mk();for(let i=0;i<500;i++)wall(scrape,90*Math.cos(80*Math.PI/180),'left');
  assert.ok(scrape.damage.left>0);assert.equal(scrape.engHealth,1);assert.equal(scrape.maxImpactEbs,0);
});

test('limp and wreck require several big hits or a 90 km/h frontal crash',()=>{
  const v=mk();for(let i=1;i<=7;i++){wall(v,60);if(i<=4)assert.ok(v.engHealth>.7);if(i===5)assert.ok(v.engHealth<=.7&&v.engHealth>0);assert.equal(v.engineStalled,i===7);}
  const big=mk();wall(big,70);wall(big,70);assert.ok(big.engHealth>.7);wall(big,70);assert.equal(big.engineStalled,true);
  const single=mk();wall(single,90);assert.equal(single.engHealth,0);assert.equal(isTerminalImpact(single.maxImpactEbs),true);
  const near=mk();wall(near,89);assert.equal(near.engineStalled,false);assert.equal(isTerminalImpact(near.maxImpactEbs,near.impactMechanical),false);
  assert.equal(WRECK_EBS,90/3.6);
});

test('equal-mass normal traffic contacts and side-swipes stay cosmetic',()=>{
  const side=mk();side.addDamage('left',5,{sev:20/3.6,kind:'bump',car:{mass:1500},localNormal:{x:1,y:0,z:0}});
  assert.equal(side.damage.left,0);assert.equal(side.impactMechanical,0);
  const normal=mk();normal.addDamage('front',15,{sev:90/3.6,kind:'crash',car:{mass:1500}});
  close(normal.impactMechanical,.01);assert.ok(normal.engHealth>.999);assert.equal(normal.engineStalled,false);
  for(let i=0;i<100;i++)normal.addDamage('right',20,{sev:90/3.6,kind:'crash',car:{mass:12000}});
  close(normal.impactMechanical,.01);assert.equal(normal.engineStalled,false);
  assert.equal(equivalentBarrierSpeed(20,1500,1500),10);
  assert.ok(equivalentBarrierSpeed(20,1500,12000)>10);assert.ok(equivalentBarrierSpeed(20,12000,1500)<10);
});

test('ground-contact metadata is never an impact; tyres and glancing front corners cannot damage engine',()=>{
  const v=mk();for(const kind of ['kerb','curb','ground','suspension','landing','bump-road'])assert.equal(wall(v,120,'front',{kind}),0);
  assert.equal(v.engHealth,1);assert.equal(v.lastDamage,null);
  assert.equal(frontalBarrierSpeed(40,'front',{localNormal:{x:1,y:0,z:.2}}),0);
  assert.equal(frontalBarrierSpeed(40,'front',{localNormal:{x:NaN,z:1}}),0);
  assert.equal(frontalBarrierSpeed(40,'front',{kind:'tyre'}),0);
  assert.equal(frontalBarrierSpeed(40,'rear'),0);
});

test('a big frontal strike affects only nearby wheels; metadata is copied',()=>{
  const v=mk(),p={x:-v.track/2,y:.4,z:-v.a},n={x:0,y:0,z:1};wall(v,70,'front',{localPoint:p,localNormal:n});
  assert.ok(v.cornerDamage[0]>v.cornerDamage[1]*3);assert.ok(v.cornerDamage[0]>v.cornerDamage[2]*10);assert.ok(v.toePull<0);
  p.x=99;n.x=99;assert.notEqual(v.lastDamage.localPoint.x,p.x);assert.equal(v.lastDamage.localNormal.x,0);
});

test('only heavily damaged cooling systems heat up; cosmetic/front-moderate hits never leak',()=>{
  const v=mk();wall(v,88);assert.ok(v.radiatorDamage>.4);assert.equal(v.coolantTemp,90);assert.equal(v.steamAmount,0);
  advance(v,60);assert.ok(v.coolantTemp>110);assert.ok(v.engHealth<.5);
  for(const kmh of [10,20,40,60,70]){const clean=mk();wall(clean,kmh);advance(clean,120);assert.equal(clean.coolantTemp,90);assert.equal(clean.smoke,false);}
});

test('reset/tow repairs cosmetics and all mechanical consequences; restored telemetry survives damageFx',()=>{
  const source=mk();wall(source,60);source.engineDamage=.2;
  const snapshot={damage:{...source.damage},...spectatorState(source)},restored=mk();
  restoreVehicleState(restored,snapshot);restored.damageFx();close(restored.impactMechanical,.16);close(restored.engineDamage,.2);assert.equal(restored.maxImpactEbs,source.maxImpactEbs);
  const v=mk();for(let i=0;i<250;i++)wall(v,70);v.damageFx(NaN);v.damageFx(Infinity);
  assert.ok(Object.values(v.damage).every(n=>Number.isFinite(n)&&n>=0&&n<=1));assert.ok(v.cornerDamage.every(n=>Number.isFinite(n)&&n>=0&&n<=1));assert.ok(v.dmgDrag<1.2);
  const serial=v.lastDamage.serial;v.reset(0,0);assert.equal(v.impactMechanical,0);assert.equal(v.engHealth,1);assert.equal(v.engineDamage,0);assert.equal(v.radiatorDamage,0);assert.equal(v.coolantTemp,90);assert.equal(v.engineStalled,false);assert.equal(v.drivetrainBroken,false);assert.ok(v.cornerDamage.every(d=>d===0));assert.equal(v.lastDamage,null);
  wall(v,30);assert.equal(v.lastDamage.serial,serial+1);
});

test('damage feedback distinguishes cosmetic dents, powertrain loss and limp',()=>{
  const light=mk();wall(light,30);assert.equal(damageFeedback(light).title,'BODY DAMAGE');assert.match(damageFeedback(light).effect,/Cosmetic.*full engine power/);assert.doesNotMatch(damageFeedback(light).effect,/steering|reducing/);
  const big=mk();wall(big,60);assert.match(damageFeedback(big).cause,/Frontal impact/);assert.match(damageFeedback(big).effect,/97%/);
  for(let i=0;i<4;i++)wall(big,60);assert.equal(damageFeedback(big).title,'LIMP MODE');
});

test('malformed and separating inputs cannot cause damage or a wreck',()=>{
  const v=mk();for(const speed of [NaN,Infinity,-1,0])assert.equal(wall(v,speed),0);
  assert.equal(v.addDamage('front',5,{sev:-2}),0);for(const zone of ['constructor','__proto__','missing']){assert.equal(v.addDamage(zone,5),0);assert.equal(damageIncrement(10,zone),0);}
  for(const value of [NaN,Infinity,-1,0,undefined])assert.equal(isTerminalImpact(value),false);
  assert.equal(isTerminalImpact(0,2),false);assert.equal(isTerminalImpact(0,.98),true);
});
