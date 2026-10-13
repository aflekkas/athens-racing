// Offline diagnostic: the actual player voice, without startup/world sounds.
// Import from the audition page. save(name, ArrayBuffer|string) receives artifacts.
import { loadRecordedEngine, RecordedEngineVoice } from '../src/engine-recordings.js';
import { EngineVoice, buildEngineBank } from '../src/audio.js';
import { specs, synthSpecs } from './engine-audio-test.js';
function seeded(seed) {return ()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};}
export async function renderDiagnostic({save,seconds=18,prefix='baseline',cars=[...specs,...synthSpecs],modes=['idle','low','varying'],rates=['steady','jitter'],rpmOverride=null,loadOverride=null,layer=null}={}) {
  const rows=[];
  for(const spec of cars) for(const mode of modes) for(const rate of rates) {
    const ctx=new OfflineAudioContext(1,44100*seconds,44100);
    const recorded=await loadRecordedEngine(ctx,spec);
    // Identical source offsets isolate update timing from random loop phase.
    const random=Math.random;Math.random=seeded(713);
    let voice;
    try {voice=recorded ? new RecordedEngineVoice(ctx,recorded,ctx.destination,spec) : new EngineVoice(ctx,buildEngineBank(ctx,spec.engine,spec.idle,spec.redline),ctx.destination);}
    finally {Math.random=random;}
    const frames=seeded(192),packets=[];
    for(let t=0;t<seconds;) {
      const rpm=rpmOverride ?? (mode==='idle'?spec.idle:mode==='varying'?1500+100*Math.sin(2*Math.PI*.37*t):1500);
      const load=loadOverride ?? (mode==='idle'?0:mode==='varying'?.15+.04*Math.sin(2*Math.PI*.23*t):.15);
      voice.set(rpm,load,1,t,1,false);
      if(layer!==null && recorded)voice.gains.forEach((g,i)=>g.gain.setTargetAtTime(i===layer?1:0,t,.06));
      packets.push({t,rpm,load});
      t+=rate==='steady'?1/60:1/(3+7*frames());
    }
    const buffer=await ctx.startRendering(), data=buffer.getChannelData(0);
    let peak=0,energy=0;
    for(const x of data){if(!Number.isFinite(x))throw Error('Invalid audio sample');peak=Math.max(peak,Math.abs(x));energy+=x*x;}
    const name=`${prefix}-${spec.id}-${mode}-${rate}`;
    await save(`${name}.f32`,data.buffer);
    const row={name,spec,mode,rate,sampleRate:44100,seconds,recorded:!!recorded,layer,peak,rms:Math.sqrt(energy/data.length),packets};
    rows.push(row);
  }
  await save(`${prefix}-renders.json`,JSON.stringify(rows,null,2));
  return rows.map(({packets,...r})=>({...r,frames:packets.length}));
}
