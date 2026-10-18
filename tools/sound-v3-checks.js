// Browser/offline acceptance using the production graph, buses and Audio.update.
import {Audio, TyreVoice} from '../src/audio.js';
import {cameraRelativeSource,syncAudioListener} from '../src/audio-listener.js';
import * as THREE from 'three';
const assert=(ok,label)=>{if(!ok)throw Error(label);};
function energy(buffer){const channels=Array.from({length:buffer.numberOfChannels},(_,i)=>buffer.getChannelData(i));return channels.map(d=>Math.sqrt(d.reduce((a,x)=>a+x*x,0)/d.length));}
async function saveBuffer(save,name,b){const data=new Float32Array(b.length*b.numberOfChannels);for(let i=0;i<b.length;i++)for(let c=0;c<b.numberOfChannels;c++)data[i*b.numberOfChannels+c]=b.getChannelData(c)[i];await save(name+'.f32',data.buffer);return {name,sampleRate:b.sampleRate,channels:b.numberOfChannels,frames:b.length,rms:energy(b)};}
export async function renderSoundComparison(save,prefix='after'){
 const specs=[{id:'huracan',engine:'v10',idle:900,redline:8500},{id:'carrera',engine:'flat6',idle:800,redline:7800},{id:'mini',engine:'turbo4',idle:850,redline:6800},{id:'taxi',engine:'diesel',idle:800,redline:5000}];
 const report=[];
 for(const spec of specs){
  const ctx=new OfflineAudioContext(2,44100*14,44100),a=new Audio();
  // Seed both variants identically, including stochastic transients.
  const random=Math.random;let seed=1337;Math.random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
  try{
   a.start({context:ctx,recordings:false});a.setEngine(spec);await a.engineReady;
   let wait=ctx.suspend(0),render=ctx.startRendering();
   for(let i=0;i<280;i++){
    await wait;const t=ctx.currentTime;
    const rpm=t<2?spec.idle:t<7?spec.idle+(spec.redline*.95-spec.idle)*(t-2)/5:t<8?spec.redline*(.65+(t-7)*.15):t<11?spec.redline*(.80-(t-8)*.13):spec.redline*.30;
    const load=t<2?.06:t<8?.9:t<11?-.35:.2, speed=t<2?0:Math.min(38,(t-2)*5),shift=i===140?1:0;
    const wheels=Array.from({length:4},(_,j)=>({Fz:3500,sx:t>11?j===0?2.3:.5:0.04,sy:t>11?1.5:.1,vgx:speed,vw:speed}));
    a.update({dt:.05,rpm,redline:spec.redline,load,throttle:Math.max(0,load),gear:t<7?2:3,gearRatio:2,shift,boost:/turbo|diesel/.test(spec.engine)?Math.max(0,load)*.8:0,speed,open:true,wheels,surfaces:Array(4).fill(t>12.5?'gravel':'asphalt'),nominalLoad:3500,traffic:[],rivals:[],sea:0,city:0,beach:0,cicadas:0,action:0});
    if(i<279)wait=ctx.suspend((i+1)*.05);await ctx.resume();
   }
   const b=await render,row=await saveBuffer(save,`${prefix}-${spec.id}-rev-load-shift-road`,b);assert(row.rms.every(x=>x>0&&Number.isFinite(x)),'finite audible comparison');report.push(row);
  }finally{Math.random=random;}
 }
 return report;
}
export async function runPanningProof(save){
 const rows=[];
 for(const view of ['chase','cockpit'])for(const yaw of [0,Math.PI/2])for(const side of [-1,1]){
  const camera=new THREE.PerspectiveCamera();camera.position.set(4,view==='chase'?3:1,8);camera.rotation.set(view==='chase'?-.15:0,yaw,.06,'YXZ');camera.updateMatrixWorld(true);
  const right=new THREE.Vector3(1,0,0).applyQuaternion(camera.quaternion),pos=camera.position.clone().addScaledVector(right,12*side);
  const rel=cameraRelativeSource(camera,{vx:0,vz:0},pos.x,pos.y,pos.z);
  const ctx=new OfflineAudioContext(2,44100,44100);const frame=syncAudioListener(ctx,camera);
  const osc=ctx.createOscillator(),g=ctx.createGain(),pan=ctx.createStereoPanner();osc.frequency.value=440;g.gain.value=.15;pan.pan.value=rel.pan;osc.connect(g).connect(pan).connect(ctx.destination);osc.start();
  const b=await ctx.startRendering(),rms=energy(b);assert(rms[side<0?0:1]>rms[side<0?1:0]*100,view+' stereo direction');
  rows.push({...await saveBuffer(save,`${view}-${yaw?'look90':'forward'}-${side<0?'left':'right'}`,b),frame,pan:rel.pan});
 }
 // One heavily sliding wheel must still reach L/R equally, in either camera view.
 for(const index of [0,1,2,3]){
  const ctx=new OfflineAudioContext(2,44100,44100),v=new TyreVoice(ctx,ctx.destination,index);
  v.set({Fz:3500,sx:2,sy:1.5,vgx:20,vw:30},20,'asphalt',3500,0);const b=await ctx.startRendering(),rms=energy(b);
  assert(Math.abs(rms[0]-rms[1])<1e-8,'player tyre '+index+' is centred');rows.push({name:'own-tyre-'+index,rms});
 }
 return rows;
}
