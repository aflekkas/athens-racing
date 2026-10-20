import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AUDIO_DEFAULTS, externalEngineWeights } from '../src/audio.js';
import { DEFAULTS } from '../src/settings.js';
import { Audio, AudioMix } from '../src/audio.js';
import { outputCeiling } from '../src/audio/contact-sound.js';
import { createMockContext } from './audio-mock-context.mjs';

test('output ceiling is transparent below the knee, monotone, symmetric and bounded', () => {
  const curve = outputCeiling();
  for (let i = 0; i < curve.length; i++) {
    const x = 2 * i / (curve.length - 1) - 1;
    assert.ok(Math.abs(curve[i]) < .84);
    assert.ok(Math.abs(curve[i] + curve[curve.length - 1 - i]) < 1e-7);
    if (i) assert.ok(curve[i] >= curve[i - 1]);
    if (Math.abs(x) < .68) assert.ok(Math.abs(curve[i] - x) < 1e-7);
  }
  const ctx = createMockContext(), mix = new AudioMix(ctx);
  assert.ok(mix.limiter.connections.includes(mix.ceiling));
  assert.ok(mix.ceiling.connections.includes(ctx.destination));
});

test('zero/invalid impact is silent and recorded severity has no loudness floor', () => {
  const calls = [], a = Object.create(Audio.prototype);
  a.ctx = {}; a.sample = (name, opts) => { calls.push({name,...opts}); return true; };
  a.noise = a.tone = opts => calls.push(opts);
  for (const severity of [0, -1, NaN]) a.crash('heavy', severity, {glass:true,metal:true});
  assert.equal(calls.length, 0);
  a.crash('light', .01); const soft = calls.find(c=>c.name)?.gain; calls.length=0;
  a.crash('light', 1); const hard = calls.find(c=>c.name)?.gain;
  assert.ok(hard > soft * 20, 'gentle contact is much quieter than a full impact');
});

test('sustained scrape reuses one source and releases without any further frame', () => {
  const ctx = createMockContext(), a = new Audio(); a.start({context:ctx,recordings:false});
  const before = ctx.log.created.BufferSource;
  for (let i=0;i<240;i++) { ctx.currentTime=i/60; a.scrape(.7, i<120?'wall':'metal'); }
  assert.equal(ctx.log.created.BufferSource-before, 1);
  assert.equal(a.voices.admitted, 0, 'contact does not consume the one-shot budget');
  const v = a.contactSound.voice;
  assert.ok(v.src.stopped > ctx.currentTime && v.src.stopped < ctx.currentTime+1);
  assert.ok(ctx.log.scheduled.some(e=>e.node.born===v.out.born && e.param==='gain' && e.kind==='target' && e.args[0]===0));
  v.src.onended(); assert.equal(a.contactSound.voice,null);
});

test('audio graph and stored preferences use the same comfortable defaults', () => {
  assert.equal(AUDIO_DEFAULTS.master, 0.6);
  assert.equal(AUDIO_DEFAULTS.tyres, 0.28);
  for (const [key, value] of Object.entries(AUDIO_DEFAULTS)) assert.equal(DEFAULTS[key], value);
});

test('six nearest external engines share one budget across pools, independent of input order', () => {
  const rivals = Array.from({ length: 8 }, (_, id) => ({ id, d: 5 + id * 10 }));
  const traffic = Array.from({ length: 8 }, (_, id) => ({ id, d: 10 + id * 10 }));
  const budget = externalEngineWeights([...rivals].reverse(), [...traffic].reverse());
  assert.equal([...budget.rivals.values(), ...budget.traffic.values()].filter(v => v === 1).length, 6);
  for (const kind of ['rivals', 'traffic']) {
    assert.equal(budget[kind].get(0), 1, 'nearest voices stay clear');
    assert.equal(budget[kind].get(7), 0.18, 'distant voices remain subordinate');
  }
  assert.deepEqual(rivals.map(r => r.d), [5, 15, 25, 35, 45, 55, 65, 75], 'telemetry is not reordered');
});

test('external budget handles absent lists, legacy distance and invalid telemetry', () => {
  const budget = externalEngineWeights([{ id: 'near', dist: 2 }, { id: 'far', d: 500 }, { id: 'invalid', d: NaN }]);
  assert.deepEqual([...budget.rivals], [['near', 1]]);
  assert.equal(budget.traffic.size, 0);
  assert.equal(externalEngineWeights().rivals.size, 0);
});

import { AudioCadence } from '../src/audio-cadence.js';
test('ambient scheduling is bounded at 30 Hz, preserves elapsed dt and reacts immediately to mute',()=>{
 const cadence=new AudioCadence();let updates=0,seconds=0;
 for(let i=0;i<121;i++)if(cadence.sample(i/120,1/120)){updates++;seconds+=cadence.dt;}
 assert.equal(updates,31);assert.ok(Math.abs(seconds-121/120)<1e-12);
 assert.equal(cadence.sample(1.001,.001,true),true);assert.equal(cadence.dt,.001);
 assert.equal(cadence.sample(0,.01),true,'audio context clock restart');
});

import { tyreParameters } from '../src/audio.js';
import { EngineVoice, buildEngineBank } from '../src/audio/engine-synth.js';
test('procedural engines keep responding between half and full load at fixed rpm', () => {
  const ctx=createMockContext(), voice=new EngineVoice(ctx,buildEngineBank(ctx,'na6',800,7000),ctx.destination);
  voice.set(4000,.5,1,0);const half={drive:voice.pre.gain.value,level:voice.out.gain.value,tone:voice.lp.frequency.value};
  voice.set(4000,1,1,1);
  assert.ok(voice.pre.gain.value>half.drive*1.1);
  assert.ok(voice.out.gain.value>half.level*1.15);
  assert.ok(voice.lp.frequency.value>half.tone*1.15);
});
test('cobbles add body rumble without turning soft ground into tyre squeal', () => {
  const wheel={Fz:3500,sx:0,sy:0,vgx:25,vw:25};
  const smooth=tyreParameters(wheel,25,'asphalt'),stone=tyreParameters(wheel,25,'cobbles');
  assert.ok(stone.roll>smooth.roll);assert.ok(stone.rumble>0);assert.equal(smooth.rumble,0);
  for(const surface of ['grass','gravel']) assert.equal(tyreParameters({...wheel,sy:3},25,surface).squeal,0);
});
test('recovery and result acknowledgements use the UI bus and no scheduled music phrases', () => {
  const calls=[],a=Object.create(Audio.prototype);a.ctx={};a.uiBus={};a.noise=a.tone=p=>calls.push(p);
  for(const method of ['win','lose','finish','gameOver','recovery']){
    calls.length=0;a[method]();assert.equal(calls.length,2);
    assert.ok(calls.every(p=>p.bus===a.uiBus&&p.dur<=.18&&!p.at));
  }
});
test('holding the handbrake never repeats its cabin control sound', () => {
  const ctx=createMockContext(),a=new Audio();a.start({context:ctx,recordings:false});let events=[];a.handbrake=p=>events.push(p);
  const p={dt:1/30,speed:0,rpm:800,load:0,open:false,cockpit:true,handbrake:false,rivals:[],traffic:[],wheels:[]};
  a.update(p);for(let i=0;i<10;i++){ctx.currentTime+=1/30;a.update({...p,handbrake:true});}
  assert.deepEqual(events,[true]);ctx.currentTime+=1/30;a.update(p);assert.deepEqual(events,[true,false]);
});
test('damaged exhaust follows the engine bus and cannot queue a burst after a slow frame', () => {
  const a=Object.create(Audio.prototype),hits=[];a.eng={};a.noise=p=>hits.push(p);
  const p={rpm:4200,redline:7000,load:.6,damage:{rear:1}};
  a.updateExhaustRattle(p,1);a.updateExhaustRattle(p,1.01);assert.equal(hits.length,1);
  a.updateExhaustRattle(p,50);assert.equal(hits.length,2);
  for(const extra of [{muted:true},{rpm:0},{damage:{rear:.5}}])a.updateExhaustRattle({...p,...extra},60);
  assert.equal(hits.length,2);assert.ok(hits.every(h=>h.bus===a.eng&&h.gain<.4&&h.dur<.06));
});

test('police outcomes preserve radio timing without note sequences, and near misses are passing air', () => {
  const a=Object.create(Audio.prototype),radio=[],results=[],air=[];
  a.ctx={};a.radioBurst=(...args)=>{radio.push(args);return 3.3;};
  a.result=value=>results.push(value);a.noise=params=>air.push(params);
  a.tone=()=>assert.fail('incidental events must not add a pitched phrase');
  assert.equal(a.copBusted(),3.3);a.copEvaded();
  assert.deepEqual(results,[false,true]);assert.deepEqual(radio,[[2.2,.34,.6],[.8,.2]]);
  a.nearMiss(5,-.4);
  assert.equal(air.length,1);assert.equal(air[0].pan,-.4);assert.equal(air[0].type,'bandpass');
  assert.equal(Audio.prototype.pluck,undefined);
});
