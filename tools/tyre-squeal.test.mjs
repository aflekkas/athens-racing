import {test} from 'node:test';
import assert from 'node:assert/strict';
import {tyreParameters,tyreSquealActive} from '../src/audio.js';
const wheel={Fz:3500,sx:0,sy:.9,vgx:27.78,vw:27.78};
const params=(slip,extra={},speed=27.78,surface='asphalt')=>tyreParameters({...wheel,sy:slip,...extra},speed,surface);
test('ordinary steering has no scrub or howl; road roll stays a subtle bed',()=>{
 for(const slip of [0,.4,.7,.82]){const p=params(slip);assert.equal(p.scrub,0);assert.equal(p.howl,0);assert.ok(p.roll<.008);}
});
test('90% grip has soft scrub and exactly zero squeal, including combined slip',()=>{
 for(const Fz of [700,2200,3500,4800,7000]){const p=params(.9,{Fz});assert.equal(p.squeal,0);assert.ok(p.scrub>0&&p.scrub<.1);assert.ok(p.howl<.04);}
 assert.equal(params(.72,{sx:.54}).squeal,0);assert.equal(params(1.1).squeal,0);
});
test('squeal needs meaningful contact, speed and a hard surface',()=>{
 for(const p of [params(2,{Fz:699}),params(2,{},25/3.6),params(2,{vw:50},0),params(2,{},27.78,'gravel')]){assert.equal(p.squeal,0);assert.equal(tyreSquealActive(true,p),false);}
 assert.ok(params(1.2,{Fz:700},7).squeal>0);
});
test('hysteresis rejects repeated threshold crossings; excess still controls volume',()=>{
 let active=false,transitions=0;for(const slip of [1.11,1.13,1.12,1.15,1.13,1.11,1.13,1.07,1.05,1.13]){const next=tyreSquealActive(active,params(slip));transitions+=Number(next!==active);active=next;}
 assert.equal(transitions,2);assert.equal(active,false);
 const levels=[1.15,1.3,1.5,1.75].map(s=>params(s).squeal);assert.ok(levels.every((v,i)=>i===0||v>levels[i-1]));
});
