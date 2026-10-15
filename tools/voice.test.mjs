import './human-voice.test.mjs';
import './police-voice.test.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { VoiceReactions, voiceAcoustics } from '../src/voice.js';
import { VOICE_LINES, VOICE_PROFILES } from '../src/voice-lines.js';
import { AUDIO_DEFAULTS } from '../src/audio.js';
import { DEFAULTS } from '../src/settings.js';

const param = () => ({ value: 0, setValueAtTime(v) { this.value = v; }, setTargetAtTime(v) { this.value = v; } });
function fixture(load) {
  const node = () => ({ connect() {}, disconnect() {}, gain: param(), frequency: param(), Q: param(), playbackRate: param(), positionX: param(), positionY: param(), positionZ: param(), start() {}, stop() {} });
  const ctx = { currentTime: 10, createBufferSource: node, createGain: node, createBiquadFilter: node, createPanner: node };
  const settings = { voice: .65, mildLanguage: false }, audio = { ctx, mix: { buses: { voice: node() } } };
  const v = new VoiceReactions(audio, { settings, random: () => 0, load: load || (async () => ({ duration: 1 })) });
  v.update({ enabled: true, relative: p => p });
  return { v, ctx, settings, speaker: {}, locate: () => ({ x: 0, y: 0, z: -5 }) };
}
test('voice distance curve fades monotonically to silence, with cabin/window loss', () => {
  let prev=1;
  for(let d=0;d<=60;d++) { const a=voiceAcoustics(d); assert.ok(a.gain<=prev);prev=a.gain; }
  assert.ok(voiceAcoustics(25).gain < voiceAcoustics(5).gain / 3);
  assert.equal(voiceAcoustics(50).gain,0);
  assert.ok(voiceAcoustics(5,true,true).gain < voiceAcoustics(5).gain*.4);
  assert.equal(voiceAcoustics(5,true).cutoff,2200);
});
test('assets cover every phrase/profile, retain clean alternatives, fit byte budget', () => {
  const data=JSON.parse(readFileSync(new URL('../assets/audio/voice/lines.json',import.meta.url)));
  assert.equal(data.lines.length,VOICE_LINES.length);let bytes=0;
  for(const cat of ['pedestrian','driver','near','police']) assert.ok(VOICE_LINES.filter(l=>l.category===cat&&!l.strong).length>=8);
  for(const l of data.lines) {assert.ok(l.transliteration && l.meaning);for(const p of VOICE_PROFILES) bytes+=statSync(new URL(`../assets/audio/voice/${l.id}-${p.id}.ogg`,import.meta.url)).size;}
  assert.ok(bytes<4_000_000); assert.equal(DEFAULTS.voice,AUDIO_DEFAULTS.voice);assert.equal(DEFAULTS.mildLanguage,false);
});
test('pending decode and active speech exclude overlap; per-speaker cooldown survives global expiry', async () => {
  let done;const f=fixture(()=>new Promise(r=>done=r));
  const first=f.v.trigger('pedestrian',f.speaker,f.locate);
  assert.equal(await f.v.trigger('driver',{},f.locate),false);
  done({duration:1});assert.equal(await first,true);
  assert.equal(await f.v.trigger('driver',{},f.locate),false);
  f.v.active.src.onended();f.ctx.currentTime+=6;
  assert.equal(await f.v.trigger('pedestrian',f.speaker,f.locate),false);
});
test('pause cancels pending decode, mild setting cancels profane speech and selects clean pool', async () => {
  let done;const f=fixture(()=>new Promise(r=>done=r));const promise=f.v.trigger('pedestrian',{},f.locate);
  f.v.update({enabled:false,relative:p=>p});done({duration:1});assert.equal(await promise,false);assert.equal(f.v.active,null);
  const g=fixture();await g.v.trigger('pedestrian',{},g.locate);assert.equal(g.v.active.line.strong,true);
  g.settings.mildLanguage=true;g.v.update({enabled:true,relative:p=>p});assert.equal(g.v.active,null);
  g.ctx.currentTime+=10;assert.equal(await g.v.trigger('pedestrian',{},g.locate),true);assert.equal(g.v.active.line.strong,false);
});
test('silent/out-of-range/invalid speakers never start; failed fetch recovers', async () => {
  const f=fixture(); assert.equal(await f.v.trigger('near',{},()=>({x:0,y:0,z:-51})),false);
  f.settings.voice=0;assert.equal(await f.v.trigger('near',{},f.locate),false);
  const g=fixture(async()=>{throw Error('offline')});assert.equal(await g.v.trigger('near',{},g.locate),false);assert.equal(g.v.pending,false);assert.equal(g.v.cache.size,0);
});
test('speaker appearance selects a stable matching profile and moving sources apply Doppler', async () => {
  const f=fixture();let z=-10;
  await f.v.trigger('near',f.speaker,()=>({x:0,y:0,z}),{gender:'female',older:true});
  assert.equal(f.v.speakers.get(f.speaker).profile,'female-older');
  const a=f.v.active, initial=a.src.playbackRate.value;
  z=-9;f.ctx.currentTime+=.05;f.v.update({enabled:true,relative:p=>p});
  assert.ok(a.src.playbackRate.value>initial,'approaching source raises pitch');
  assert.equal(a.pan.positionZ.value,-9,'panner follows speaker');
});
