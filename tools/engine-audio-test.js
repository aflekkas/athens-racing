import { ENGINE_RECORDINGS, loadRecordedEngine, RecordedEngineVoice, rpmBlend } from '../src/engine-recordings.js';
import { Audio, ENGINE_SOUND } from '../src/audio.js';
import { ExternalEngines } from '../src/audio/engine-spatial.js';
export const specs = [
  { id: 'mini', engine: 'turbo4', idle: 850, redline: 6800 },
  { id: 'z4', engine: 'turbo6', idle: 750, redline: 7000 },
  { id: 'taxi', engine: 'diesel', idle: 800, redline: 5000 },
];
export const synthSpecs = [
  { id: 'huracan', engine: 'v10', idle: 900, redline: 8500, cylinders: 10 },
  { id: 'e36', engine: 'na6', idle: 750, redline: 6500, cylinders: 6 },
  { id: 'carrera', engine: 'flat6', idle: 800, redline: 7800, cylinders: 6 },
  { id: 'gr_yaris', engine: 'turbo3', idle: 850, redline: 7200, cylinders: 3 },
  { id: 'gtv', engine: 'na4', idle: 850, redline: 6500, cylinders: 4 },
];
function assert(condition, message) { if (!condition) throw new Error(message); }
function stats(data) {
  let square = 0, peak = 0;
  for (const x of data) { assert(Number.isFinite(x), 'Non-finite audio sample'); square += x*x; peak = Math.max(peak, Math.abs(x)); }
  return { rms: Math.sqrt(square/data.length), peak };
}
function manager(seconds = 1) {
  const a = new Audio(), ctx = new OfflineAudioContext(1, 44100*seconds, 44100);
  a.ctx = ctx; a.eng = ctx.createGain(); a.ext = ctx.createGain();
  a.mk = { filt: (type, f, q) => { const n=ctx.createBiquadFilter();n.type=type;n.frequency.value=f;n.Q.value=q;return n; } };
  // Radio is independently owned; this fixture isolates engine restart behavior.
  return a;
}
export async function runAudioTests() {
  const report = { assets: 0, renders: [], synthRenders: [], lifecycle: [], fallback: null };
  assert(ENGINE_SOUND.turbo6.cyl === 6, 'Z4 fallback must be a six-cylinder');
  for (const spec of specs) {
    const ctx = new OfflineAudioContext(1, 44100*5, 44100);
    const bank = await loadRecordedEngine(ctx, spec);
    for (const buffer of [bank.start, ...bank.loops.map(s=>s.buffer)]) {
      const s=stats(buffer.getChannelData(0));
      assert(s.rms>.01 && s.peak<.99, `${spec.id}: silent or clipping asset`); report.assets++;
    }
    for (const sample of bank.loops) {
      const x=sample.buffer.getChannelData(0);
      let diff=0;for(let i=1;i<x.length;i++)diff+=(x[i]-x[i-1])**2;
      const seam=Math.abs(x[0]-x.at(-1));
      assert(seam<Math.max(.025,Math.sqrt(diff/x.length)*7), `${spec.id}: audible loop discontinuity`);
    }
    const points=bank.loops.map(l=>l.rpm);
    for (let rpm=spec.idle;rpm<=spec.redline;rpm+=25) {
      const w=rpmBlend(points,rpm);
      assert(Math.abs(w.reduce((s,n)=>s+n*n,0)-1)<2e-7,'RPM blend loses energy beyond Float32 rounding');
      assert(w.filter(n=>n>0).length<=2,'More than two adjacent RPM bands active');
    }
    const voice = new RecordedEngineVoice(ctx,bank,ctx.destination,spec,.65);
    for (let t=0;t<5;t+=1/60) {
      const rpm=spec.idle+(spec.redline-spec.idle)*Math.min(1,t/3.8);
      voice.set(rpm,t<3?.8:-.2,1,t,1,t>4.3);
    }
    const rendered=await ctx.startRendering(), s=stats(rendered.getChannelData(0));
    assert(s.rms>.02 && s.peak<1, `${spec.id}: bad engine output`);
    report.renders.push({ car: spec.id, rms: +s.rms.toFixed(4), peak: +s.peak.toFixed(4), loops: bank.loops.length });
  }
  for (const spec of synthSpecs) {
    const a=manager(5);a.eng.connect(a.ctx.destination);
    a.setEngine(spec);await a.engineReady;
    const voice=a.engineVoice, bank=voice.bank;
    assert(a.recordingState==='procedural' && !a.recordedBank, `${spec.id}: mislabeled as a recording`);
    assert(bank.type===spec.engine && bank.E.cyl===spec.cylinders, `${spec.id}: wrong engine fallback`);
    assert(bank.pts.length===4 && voice.src.length===8, `${spec.id}: missing load/RPM layers`);
    assert(Math.abs(bank.pts[3]/.88-spec.redline)<10, `${spec.id}: incorrect redline calibration`);
    for (let t=0;t<5;t+=1/60) {
      const rpm=spec.idle+(spec.redline-spec.idle)*Math.min(1,t/3.8);
      voice.set(rpm,t<3?.8:-.2,1,t,1,t>4.3);
    }
    const s=stats((await a.ctx.startRendering()).getChannelData(0));
    assert(s.rms>.015 && s.peak<1, `${spec.id}: silent or clipping synthesized voice`);
    report.synthRenders.push({car:spec.id,engine:bank.type,cylinders:bank.E.cyl,rms:+s.rms.toFixed(4),peak:+s.peak.toFixed(4)});
  }
  const a=manager();
  a.setEngine(specs[0]);const first=a.engineReady;
  a.setEngine(specs[2]);const second=a.engineReady;
  a.setEngine(specs[1]);const third=a.engineReady;
  await Promise.all([first,second,third]);
  assert(a.engineSpec.id==='z4'&&a.recordedBank.engine==='turbo6','Slow download selected wrong engine');
  assert(a.engineVoice instanceof RecordedEngineVoice,'Recorded voice not installed');
  report.lifecycle.push('Rapid MINI → taxi → Z4 selects only Z4');
  assert(a.ignitionSource && a.engineStartLevel(0)===0,'Ignition not played / running engine overlaps crank');
  assert(a.engineStartLevel(2)===1,'Running engine failed to fade in');
  a.cancelIgnition();assert(!a.ignitionSource,'Ignition failed to cancel');
  a.pendingIgnition=-10;a.playPendingIgnition();assert(!a.ignitionSource,'Late ignition replayed');
  a.lastSpeed=15;a.pendingIgnition=0;a.playPendingIgnition();assert(!a.ignitionSource,'Ignition replayed while driving');
  a.restart();assert(a.ignitionSource,'Restart does not replay ignition');
  const start=a.ignitionSource;a.requestIgnition();assert(a.ignitionSource===start,'Duplicate ignition in one frame');
  report.lifecycle.push('Ignition cancellation, catch fade, delayed-load suppression, moving-car suppression, restart and deduplication');
  a.cancelIgnition();a.engineVoice.stop();a.engineVoice.stop();
  report.lifecycle.push('Repeated stop is safe');
  // Real network failure on a fresh context; no mocked WebAudio decoder.
  const original=ENGINE_RECORDINGS.mini.loops[0];
  ENGINE_RECORDINGS.mini.loops[0]={...original,url:new URL('./intentionally-missing-audio.wav',import.meta.url).href};
  try {
    const b=manager();b.setEngine(specs[0]);await b.engineReady;
    assert(b.recordingState==='fallback'&&!b.recordedBank,'Failed download did not preserve fallback');
    assert(b.engineVoice.bank.E.cyl===4&&b.pendingIgnition==null,'Fallback silenced or wrong engine');
    b.restart();assert(b.engineStartLevel(0)===1,'Restart muted fallback while no recording can load');
    b.engineVoice.stop(); report.fallback='404 handled; procedural engine remains available';
  } finally { ENGINE_RECORDINGS.mini.loops[0]=original; }
  // The unified pool replaces the old traffic-only and legacy-rival voices.
  const trafficAudio = manager(), ctx = trafficAudio.ctx;
  const pool = new ExternalEngines(ctx, ctx.destination);
  const packet={id:99,kind:'car',electric:true,d:8,pan:0,vr:0,v:15,acc:0};
  pool.update([], [packet], 0);
  const slot=pool.slots.find(v=>v.id===99);
  assert(slot.spec.engine==='electric' && !slot.bank.recorded,'EV retained combustion recordings');
  packet.electric=false; pool.update([], [packet], 1);
  assert(slot.spec.engine==='turbo4','Petrol profile not restored');
  packet.electric=true; pool.update([], [packet], 2);
  assert(slot.spec.engine==='electric' && !slot.bank.recorded,'Reused EV retained combustion recordings');
  packet.electric=false;packet.kind='scooter';pool.update([], [packet], 3);
  assert(slot.spec.engine==='bike','Scooter profile not restored');
  const worldLoop={buffer:ctx.createBuffer(1,88200,44100),loopStart:.05,loopEnd:1.95};
  for(const name of ['bus-idle','diesel-engine','scooter-idle','scooter-run']) pool.attachWorld(name,worldLoop);
  packet.kind='bus';pool.update([], [packet], 4);
  assert(slot.bank.recorded && slot.voice.sources[0].loopStart===.05,'Bus recording lost its loop guard');
  packet.kind='scooter';pool.update([], [packet], 5);
  assert(slot.bank.recorded && slot.voice.sources[0].loopEnd===1.95,'Scooter recording lost its loop guard');
  pool.update([], [], 6);
  assert(pool.slots.every(v=>!v.voice),'Retired pool voices did not stop');
  report.traffic='Unified bounded pool restores electric, petrol and motorcycle profiles on reuse';

  const rattle = manager(), hits=[];
  rattle.chassis={};rattle.noise=event=>hits.push(event);
  const damaged={damage:{rear:1},rpm:3500,redline:7000,load:.5,bump:.3};
  for(const rear of [undefined,0,.5,NaN]) rattle.updateExhaustRattle({...damaged,damage:{rear}},0);
  assert(hits.length===0,'Healthy car rattles');
  rattle.updateExhaustRattle(damaged,1);assert(hits.length===1,'Damaged exhaust silent');
  rattle.updateExhaustRattle(damaged,1.01);assert(hits.length===1,'Rattle not rate-limited');
  rattle.updateExhaustRattle(damaged,50);assert(hits.length===2,'Long frame queued a rattle burst');
  for(const p of [{...damaged,muted:true},{...damaged,rpm:0},{...damaged,damage:{rear:0}}]) rattle.updateExhaustRattle(p,60);
  rattle.updateExhaustRattle(damaged,61,0);
  assert(hits.length===2,'Rattle during garage, stopped engine, repaired damage or ignition');
  assert(hits.every(h=>h.gain>0 && h.gain<=.032 && h.dur<=.05 && h.bus===rattle.chassis),'Rattle exceeds level/duration or wrong bus');
  rattle.nextExhaustRattle=100;rattle.restart();assert(rattle.nextExhaustRattle===0,'Restart retained rattle timer');
  // Render the actual primitive, not just the gating logic.
  const renderedRattle=manager(), rctx=renderedRattle.ctx;
  renderedRattle.chassis=rctx.createGain();renderedRattle.chassis.connect(rctx.destination);
  renderedRattle.white=rctx.createBuffer(1,88200,44100);
  const noise=renderedRattle.white.getChannelData(0);for(let i=0;i<noise.length;i++)noise[i]=Math.random()*2-1;
  renderedRattle.updateExhaustRattle(damaged,0);
  const rattleStats=stats((await rctx.startRendering()).getChannelData(0));
  assert(rattleStats.peak>1e-5 && rattleStats.peak<.05,'Rattle silent or too loud');
  report.damage='Rear >50% only; bounded level/rate; no rattle after repair, while muted/stopped or during ignition';
  return report;
}
