import test from 'node:test';
import assert from 'node:assert/strict';
import {engineProfile,gearboxSound} from '../src/audio/engine-profiles.js';
import {ExhaustPulse} from '../src/exhaust-pops.js';
import {validateStateExtras} from '../server/mp-lifecycle.mjs';
const state=()=>({rpm:7500,redline:8500,throttle:1,overrun:false,events:[]});
test('ISR cut and engagement, lift and limiter each emit one synchronized pulse',()=>{
 const p=new ExhaustPulse(),s=state();p.update(.016,s);
 s.events.push({serial:1,type:'shift-start',direction:1});p.update(.016,s);assert.equal(p.kind,2);assert.equal(p.serial,1);assert.equal(p.life,.08);
 p.update(.016,s);assert.equal(p.serial,1);
 s.events.push({serial:2,type:'shift-end',direction:1});p.update(.016,s);assert.equal(p.serial,2);assert.equal(p.kind,1,'engagement gives a small lick, not a second bang');assert.equal(p.life,.06);
 s.events.push({serial:3,type:'limiter-hit'});p.update(.016,s);assert.equal(p.kind,3);
 s.overrun=true;s.throttle=0;p.update(.016,s);assert.equal(p.kind,1);const n=p.serial;
 for(let i=0;i<120;i++)p.update(1/60,s);assert.ok(p.serial>n);assert.equal(p.life,0);
});
test('toggle consumes events silently; low-rpm and downshifts do not flame',()=>{
 const p=new ExhaustPulse(),s=state();s.events.push({serial:1,type:'shift-start',direction:1});p.update(.016,s,false);p.update(.016,s);assert.equal(p.serial,0);
 s.rpm=2500;s.overrun=true;s.events.push({serial:2,type:'limiter-hit'});p.update(.016,s);assert.equal(p.serial,0);
 s.rpm=7000;s.overrun=false;s.events.push({serial:3,type:'shift-start',direction:-1});p.update(.016,s);assert.equal(p.serial,0);
});
test('replicated serial survives packet duplication, rejects unbounded wire fields',()=>{
 const p=new ExhaustPulse();p.update(.1,{exhaustSerial:30,exhaustKind:2});assert.equal(p.serial,0);
 p.update(.1,{exhaustSerial:31,exhaustKind:2});assert.equal(p.serial,1);assert.equal(p.kind,2);
 p.update(.1,{exhaustSerial:31,exhaustKind:2});assert.equal(p.serial,1);
 p.update(.1,{exhaustSerial:32,exhaustKind:2},false);p.update(.1,{exhaustSerial:32,exhaustKind:2});assert.equal(p.serial,1);
 const good=validateStateExtras({exhaustSerial:5,exhaustKind:2,exhaustEnabled:true});assert.equal(good.exhaustSerial,5);assert.equal(good.exhaustEnabled,true);
 const bad=validateStateExtras({exhaustSerial:Infinity,exhaustKind:4,exhaustEnabled:'yes'});assert.equal(bad.exhaustSerial,undefined);assert.equal(bad.exhaustKind,undefined);assert.equal(bad.exhaustEnabled,undefined);
});

test('SVJ has a dedicated naturally aspirated V12 voice and ISR cut envelope',()=>{const spec={id:'aventador_svj',engine:'v12',powertrain:{gearboxType:'amt'}};assert.equal(engineProfile(spec).id,'aventador-svj-v12');assert.equal(engineProfile(spec).turbo,false);assert.equal(engineProfile(spec).cylinders,12);assert.equal(gearboxSound(spec),'amt');});
