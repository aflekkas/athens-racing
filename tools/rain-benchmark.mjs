import * as THREE from 'three';
import {performance} from 'node:perf_hooks';
import {writeFileSync} from 'node:fs';
import {createRain as oldRain,Spray} from '../.scratch/realism/rain-before.mjs';
import {createRain,SprayCards,WaterSplash,rainAtlas} from '../src/rain-overlays.js';
const old=new Spray(new THREE.Scene(),600),after=new SprayCards(new THREE.Scene());old.n=220;old.g.setDrawRange(0,220);
function measure(fn){const a=[];for(let i=0;i<1100;i++){const t=performance.now();fn();if(i>=100)a.push(performance.now()-t);}a.sort((x,y)=>x-y);return {median:a[500],p95:a[950]};}
const cpuBefore=measure(()=>{for(let i=0;i<7;i++)old.emit(i,1,0,10,2,0,.3);old.update(1/60);});
const cpuAfter=measure(()=>{after.begin();for(let i=0;i<18;i++)after.add(i,1,0,30,.3);after.update();});
function cpuBatch(fn){const start=process.cpuUsage();for(let i=0;i<5000;i++)fn();const elapsed=process.cpuUsage(start);return (elapsed.user+elapsed.system)/1000/5000;}
function bytes(g){return Object.values(g.attributes).reduce((n,a)=>n+a.array.byteLength,0)+(g.index?.array.byteLength||0);}
const setup=[],setupCpu=[];for(let i=0;i<30;i++){const m=await import('../src/rain-overlays.js?bench='+i),t=performance.now(),cpu=process.cpuUsage();const tex=m.rainAtlas();const ms=performance.now()-t;if(i>=5){setup.push(ms);const used=process.cpuUsage(cpu);setupCpu.push((used.user+used.system)/1000);}tex.dispose();}setup.sort((a,b)=>a-b);setupCpu.sort((a,b)=>a-b);
const report={atlasStartupMedianMs:setup[12],atlasStartupCpuMedianMs:setupCpu[12],method:'100 warmup + 1000 sampled updates; locked low weather: 9 cars, baseline 7 emissions (~40% of 18), candidate 18 anchored wakes at 30 m/s; CPU only',before:{fallingInstances:1800,sprayParticles:220,allocatedFallingInstances:6000,allocatedSprayParticles:600,drawCalls:2,triangles:3600,geometryBytes:bytes(oldRain(6000).mesh.geometry)+bytes(old.g),textureBytes:0,cpuMs:cpuBefore},after:{fallingLayers:2,sprayCards:18,simulatedParticles:0,drawCalls:2,triangles:40,geometryBytes:bytes(createRain().mesh.geometry)+bytes(after.g),textureBytes:rainAtlas().image.data.byteLength,cpuMs:cpuAfter}};
report.before.cpuBatchMs=cpuBatch(()=>{for(let i=0;i<7;i++)old.emit(i,1,0,10,2,0,.3);old.update(1/60);});
report.after.cpuBatchMs=cpuBatch(()=>{after.begin();for(let i=0;i<18;i++)after.add(i,1,0,30,.3);after.update();});
globalThis.document={createElement:()=>({getContext:()=>({createRadialGradient:()=>({addColorStop(){}}),fillRect(){}})})};
const {Splash}=await import('../.scratch/realism/splash-before.mjs');
const splashBefore=new Splash(new THREE.Scene()),splashAfter=new WaterSplash(new THREE.Scene(),0);
for(const splash of [splashBefore,splashAfter])splash.burst(0,0,10,0,1);
report.splash={before:{particles:420,triangles:80,drawCalls:2,geometryBytes:bytes(splashBefore.pts.geometry)+bytes(splashBefore.ring.geometry),textureBytes:32*32*4*4/3,cpuMs:measure(()=>{if(splashBefore.t>2)splashBefore.burst(0,0,10,0,1);splashBefore.update(1/60);})},after:{particles:0,cards:2,triangles:4,drawCalls:2,geometryBytes:bytes(splashAfter.pts.geometry)+bytes(splashAfter.ring.geometry),extraTextureBytes:0,cpuMs:measure(()=>{if(splashAfter.t>2)splashAfter.burst(0,0,10,0,1);splashAfter.update(1/60);})}};
writeFileSync('.scratch/realism/rain-costs.json',JSON.stringify(report,null,2));console.log(report);
