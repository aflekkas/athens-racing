import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Audio} from '../src/audio.js';
import {engineProfile,electricMotorRpm} from '../src/audio/engine-profiles.js';
import {EngineVoice,buildEngineBank} from '../src/audio/engine-synth.js';
import {EngineLifecycle} from '../src/audio/engine-lifecycle.js';
import {createMockContext} from './audio-mock-context.mjs';
import {DistantEngineVoice} from '../src/audio/engine-spatial.js';

test('zero-idle EV constructs without buffers and is silent at rest, including ignition and stop',()=>{
 const spec={wheelR:.3,gears:[1],final:9};
 assert.equal(electricMotorRpm(spec,0),0);
 assert.ok(Math.abs(electricMotorRpm(spec,10)-electricMotorRpm(spec,5)*2)<1e-8);
 const ctx=createMockContext(),bank=buildEngineBank(ctx,'electric',0,10000),v=new EngineVoice(ctx,bank,ctx.destination);
 v.set(0,1,1,0);assert.equal(v.out.gain.value,0);
 v.set(5000,.8,1,1);assert.ok(v.out.gain.value>0);
 v.set(0,0,1,2);assert.equal(v.out.gain.value,0);
 for(const e of ctx.log.scheduled)if(typeof e.args[0]==='number')assert.ok(Number.isFinite(e.args[0]));
 assert.equal(ctx.log.created.BufferSource||0,0);
 const calls=[],host={profile:engineProfile({engine:'electric'}),noise:x=>calls.push(x),tone:x=>calls.push(x)};
 const life=new EngineLifecycle(host);life.start(0);life.stop(1);life.shift({rpm:0},2,true,true);
 assert.equal(calls.length,0);
 const farCtx=createMockContext(),far=new DistantEngineVoice(farCtx,bank,farCtx.destination,{electric:true});
 far.set(0,0,1,0);assert.equal(far.out.gain.value,0);
 assert.equal(farCtx.log.created.Oscillator,1,'distant EV stays a one-source voice');
});
test('stock commuters and SVJ have no exhaust events; actual layouts are preserved',()=>{
 for(const [id,engine]of [['aventador_svj','v12'],['aygo','na3'],['a190','na4'],['qashqai','turbo4'],['corolla','na4'],['jazz_dynamic','na4'],['superb_4x4','turbo4']])
  assert.equal(engineProfile({id,engine}).pops,0,id);
 assert.equal(engineProfile({id:'gr_yaris',engine:'turbo3'}).cylinders,3);
 assert.equal(engineProfile({id:'gla45',engine:'turbo4'}).cylinders,4);
 assert.equal(engineProfile({id:'cle53',engine:'turbo6'}).cylinders,6);
});
test('limiter only cuts; long pulse banks remain finite and never carry baked SVJ pops',()=>{
 const ctx=createMockContext(),b=buildEngineBank(ctx,'v12',900,8500,{pops:0}),v=new EngineVoice(ctx,b,ctx.destination);
 for(const take of [...b.on,...b.off]){
  assert.ok(take.buf.duration>=1.7);
  assert.ok(take.buf.getChannelData(0).every(Number.isFinite));
  assert.ok(Math.max(...take.buf.getChannelData(0))<.83);
 }
 v.set(8500,1,1,0,1,true);
 assert.ok(v.lim.gain.value-Math.abs(v.lfoG.gain.value)>=0);
 assert.ok(v.lim.gain.value+Math.abs(v.lfoG.gain.value)<=1);
});
test('burble is bounded and scheduled ahead on audio time, independent of frame rate',()=>{
 const a=Object.create(Audio.prototype),calls=[];a.eng={};a.noise=a.tone=x=>calls.push(x);
 a.burble(.55,.9);assert.equal(calls.length,10);
 assert.ok(calls.every(x=>x.at>=0&&x.at<1&&x.bus===a.eng));
 assert.ok(calls.at(-1).at>calls[0].at);
});
test('5.2 V10 odd firing produces the characteristic half-firing-order component',()=>{
 const ctx=createMockContext(),b=buildEngineBank(ctx,'v10',900,8500),x=b.on[2].buf.getChannelData(0);
 function energy(order){
  const w=2*Math.PI*b.pts[2]*order/120/ctx.sampleRate;let re=0,im=0;
  for(let i=0;i<x.length;i++){re+=x[i]*Math.cos(w*i);im+=x[i]*Math.sin(w*i);}
  return re*re+im*im;
 }
 // An even 72° pulse train cancels this component; 54°/90° pairing retains it.
 assert.ok(energy(5)/energy(10)>.07);
});
test('downshift exposes the telemetry RPM and rev-match intake; a manual does not invent throttle',()=>{
 for(const gearboxType of ['manual','dct']){
  const ctx=createMockContext(),a=new Audio();a.start({context:ctx,recordings:false});
  a.engineSpec={id:'test',idle:800,redline:7000,powertrain:{gearboxType,revMatch:gearboxType==='dct'}};
  a.profile=engineProfile({engine:'na6'});let received;
  a.engineVoice={set(...x){received=x;}};
  const p={dt:.2,audioTime:1,rpm:4200,redline:7000,load:-.2,speed:20,gear:2,open:true,gearboxType,shiftStart:{serial:1,direction:-1,duration:.25},rivals:[],traffic:[]};
  a.update(p);
  assert.equal(received[0],4200);
  assert.equal(a.shiftCutUntil,1);
  assert.equal(received[1],gearboxType==='dct'?.65:-.2);
 }
});
