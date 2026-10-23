import test from 'node:test';import assert from 'node:assert/strict';import * as THREE from 'three';
import {athensMaterial,ASPHALT_PERIOD,PAVING_PERIOD,URBAN_PERIOD,ATHENS_TEXTURES} from '../src/athens-materials.js';import {TX} from '../src/tex.js';
const compile=m=>{const shader={uniforms:{},vertexShader:'#include <common>\n#include <begin_vertex>',fragmentShader:'#include <common>\n#include <color_fragment>'};m.onBeforeCompile(shader);return shader;};
test('tile-local planar UVs repeat a whole number of times per 512 m cell, so scans never seam at tile borders',()=>{
  assert.equal(512/ASPHALT_PERIOD,122);assert.equal(512/PAVING_PERIOD,160);assert.ok(Math.abs(ASPHALT_PERIOD-4.2)<.01,'same scale as the hand-tuned maps');
});
test('asphalt and paving use the shared library scans, no new textures',()=>{
  TX.asphalt_diff=new THREE.Texture();TX.paver_diff=new THREE.Texture();assert.deepEqual(ATHENS_TEXTURES,['asphalt_diff','paver_diff']);
  const a=athensMaterial('asphalt',[.05,.06,.07],false),sa=compile(a);assert.equal(sa.uniforms.scanMap.value,TX.asphalt_diff);
  assert.match(sa.vertexShader,/position\.xz\/4\.19\d+/);assert.match(sa.fragmentShader,/mix\(vec3\(grain\),scan,\.5\)/);assert.deepEqual(a.color.toArray().map(v=>+v.toFixed(2)),[.05,.06,.07]);
  const p=athensMaterial('paving',[.4,.4,.4],false),sp=compile(p);assert.equal(sp.uniforms.scanMap.value,TX.paver_diff);assert.match(sp.vertexShader,/position\.xz\/3\.2/);
  assert.notEqual(a.customProgramCacheKey(),p.customProgramCacheKey());
  assert.equal(athensMaterial('asphalt',[.3,.3,.3],false).customProgramCacheKey(),a.customProgramCacheKey(),'concrete/asphalt tints share one program');
  for(const m of [a,p])m.dispose();
});
test('markings are drawn over the asphalt without z-fighting; other surfaces stay plain unlit',()=>{
  const m=athensMaterial('marking',[.8,.8,.8],false);assert.equal(m.polygonOffset,true);assert.ok(m.polygonOffsetFactor<0&&m.polygonOffsetUnits<0);
  const b=athensMaterial('basic',[1,1,1],true);assert.equal(b.isMeshBasicMaterial,true);assert.equal(b.vertexColors,true);assert.equal(b.polygonOffset,false);
});
test('ground between buildings uses the paving scan over its vertex colour, softened, with seamless tone drift',()=>{
  TX.paver_diff=new THREE.Texture();assert.equal(512/URBAN_PERIOD,80);
  const u=athensMaterial('urban',[1,1,1],true),s=compile(u);assert.equal(u.vertexColors,true,'keeps the muted urban vertex colour');assert.equal(s.uniforms.scanMap.value,TX.paver_diff);
  assert.match(s.vertexShader,/position\.xz\/6\.4/);assert.match(s.fragmentShader,/mix\(vec3\(1\.\),mix\(vec3\(grain\),scan,\.5\)[^;]*,0\.700\)/,'blended at 70%, not full contrast');
  // Drift wavelengths divide the 80 texture units of a tile, so the tone does not jump at tile borders.
  const [, u1, v1] = s.fragmentShader.match(/vScanUV\.x\*6\.283185\/([\d.]+)\+sin\(vScanUV\.y\*6\.283185\/([\d.]+)\)/).slice(0,3).map((x,i)=>i?Number(x):x);
  assert.equal(80%u1,0);assert.equal(80%v1,0);
  const p=athensMaterial('paving',[.4,.4,.4],false);assert.notEqual(u.customProgramCacheKey(),p.customProgramCacheKey());
  for(const m of [u,p])m.dispose();
});

// Execute the scalar GLSL helper emitted by the real material, rather than a
// second hand-written implementation. Independent supersampling supplies the
// expected unresolved coverage. GPU shader compilation follows in browser proof.
const smoothstep=(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
function limestoneKernel(){
 const material=athensMaterial('coastalGround',[1,1,1],true);
 try{
  const shader={uniforms:{},vertexShader:THREE.ShaderLib.basic.vertexShader,fragmentShader:THREE.ShaderLib.basic.fragmentShader};
  material.onBeforeCompile(shader);
  const source=shader.fragmentShader;
  const body=source.match(/float coastFissure\(float phase,float footprint\)\{([^}]+)\}/)?.[1];
  assert.ok(body,'real material contains the footprint-filtered fissure kernel');
  const evaluate=Function('smoothstep','min','abs','sin','mix',`return (phase,footprint)=>{${body.replace(/\bfloat\b/g,'let')}}`)(smoothstep,Math.min,Math.abs,Math.sin,(a,b,k)=>a+(b-a)*k);
  const phase=source.match(/float phase=([^;]+);/)?.[1];assert.ok(phase);
  return {evaluate,phase:Function('p','mid',`return ${phase};`)};
 }finally{material.dispose();}
}

test('coastal limestone fissure coverage is continuous across 512m tile resets',()=>{
 const {evaluate,phase}=limestoneKernel();
 let maximum=0;
 // The repeating mid-noise value is identical at either side of a tile reset.
 // Sweep many material phases, not only endpoints where sin happens to be zero.
 for(let i=0;i<1024;i++){
  const y=i*3.17,mid={b:(i*.61803398875)%1};
  maximum=Math.max(maximum,Math.abs(evaluate(phase({y},mid),0)-evaluate(phase({y:y+512},mid),0)));
 }
 assert.ok(maximum<1e-9,`visible fissure discontinuity ${maximum} across a tile reset`);
});

test('unresolved limestone fissures converge to area coverage instead of phase aliasing',()=>{
 const {evaluate}=limestoneKernel(),phases=4096;
 let reference=0,minimum=Infinity,maximum=-Infinity,nearMin=Infinity,nearMax=-Infinity;
 for(let i=0;i<phases;i++){
  const phase=2*Math.PI*(i+.5)/phases;
  reference+=smoothstep(.86,.98,Math.abs(Math.sin(phase)))/phases;
  for(const footprint of [1.5,3,12]){const value=evaluate(phase,footprint);minimum=Math.min(minimum,value);maximum=Math.max(maximum,value);}
  const near=evaluate(phase,0);nearMin=Math.min(nearMin,near);nearMax=Math.max(nearMax,near);
 }
 assert.ok(nearMax-nearMin>.95,'resolved fissures retain local contrast');
 assert.ok(maximum-minimum<.01,`unresolved camera-phase variation ${maximum-minimum}`);
 assert.ok(Math.abs((minimum+maximum)/2-reference)<.02,'far brightness retains the independently supersampled fissure coverage');
});

test('complete coastal material shaders keep shared samples and compile detail out when disabled',async()=>{
 const {setSetting,settings}=await import('../src/settings.js');
 const original=settings.worldDetail;
 const expand=source=>source.replace(/#include <([\w\d_]+)>/g,(_,name)=>{assert.equal(typeof THREE.ShaderChunk[name],'string',`known Three shader chunk ${name}`);return expand(THREE.ShaderChunk[name]);});
 try{
  for(const detail of [true,false]){
   setSetting('worldDetail',detail);
   for(const surface of ['coastalGround','coastalUrban','coastalDetail']){
    const material=athensMaterial(surface,[.3,.35,.25],true);
    try{
     assert.equal(material.isMeshBasicMaterial,true,'locked unlit look');
     const shader={uniforms:{},vertexShader:THREE.ShaderLib.basic.vertexShader,fragmentShader:THREE.ShaderLib.basic.fragmentShader};
     material.onBeforeCompile(shader);
     for(const source of [expand(shader.vertexShader),expand(shader.fragmentShader)]){assert.doesNotMatch(source,/#include|undefined|\$\{/);assert.match(source,/void main\(\)/);}
     if(detail){
      assert.equal((shader.fragmentShader.match(/texture2D\(detailMap/g)||[]).length,10,'same six generic-ground and four limestone lookups');
      assert.deepEqual(Object.keys(shader.uniforms).sort(),surface==='coastalUrban'?['detailMap','scanMap','uWorldDetail']:['detailMap','uWorldDetail']);
      assert.match(shader.fragmentShader,/coastFissure\(phase,fwidth\(phase\)\)/);
     }else{
      assert.doesNotMatch(shader.fragmentShader,/coastLimestone|coastFissure|detailMap/);
      assert.equal(shader.uniforms.detailMap,undefined);
     }
    }finally{material.dispose();}
   }
  }
 }finally{setSetting('worldDetail',original);}
});

test('material proof waits paused for complete admission then takes exactly the same physics steps',async()=>{
 const {readFile}=await import('node:fs/promises'),{runInNewContext}=await import('node:vm');
 const source=await readFile(new URL('./terrain-material.browser.mjs',import.meta.url),'utf8');
 const body=source.split('// BEGIN readiness protocol (also executed by source-only synthetic checks).')[1].split('// END readiness protocol')[0];
 const exercise=async({admitAfter=1,initial=0,holdAt=-1}={})=>{
  let activations=0,steps=0,now=0;const trace=[],tiles=new Map();
  const stream={tiles,wanted:new Map(),pins:new Set(),position:{x:0,z:0},origin:{x:0,z:0},metrics:{activationStepMax:{}},entry:key=>({sha256:key}),contact:()=>({y:0}),readyAt:()=>activations>=admitAfter,activateFrame(){activations++;if(activations>=admitAfter)for(let x=-1;x<=1;x++)for(let z=-1;z<=1;z++)tiles.set(`${x},${z}`,{state:'active'});}};
  const a={paused:false,menu:{close(){}},camera:{layers:{mask:7}},stream,stats:{simulationSeconds:initial},player:{veh:{x:0,y:0,z:0,vLong:0,vLat:0,ground:{ready:()=>activations>=admitAfter,footprint:()=>[{x:0,z:0}]}}},setPaused(p){this.paused=p;},setCameraHook(){},render(dt){trace.push({kind:'render',dt,paused:this.paused,elapsed:this.stats.simulationSeconds});},step(dt){trace.push({kind:'step',active:tiles.size,paused:this.paused});if(steps++!==holdAt)this.stats.simulationSeconds+=dt;}};
  const fn=runInNewContext(body+';prepareTerrainView',{__athens:a,performance:{now:()=>now},document:{getElementById:()=>({})},getComputedStyle:()=>({display:'none',opacity:'0'}),setTimeout:resolve=>{now+=30;resolve();}});
  let result,error;try{result=await fn({camera:{position:[0,0,0],lookAt:[0,0,1]}});}catch(e){error=e;}
  assert.equal(a.camera.layers.mask,7,'camera layers restored even on failure');assert.equal(a.paused,false,'public pause restored');
  return {result,error,trace,steps,a};
 };
 for(const admitAfter of [1,4,11]){
  const {result,error,trace,steps}=await exercise({admitAfter});assert.ifError(error);assert.equal(result.ready,true);assert.equal(steps,24);assert.equal(result.warmup.simulationSeconds,0);assert.ok(Math.abs(result.last.simulationSeconds-.1)<1e-10);
  assert.ok(trace.filter(t=>t.kind==='step').every(t=>t.active===9&&!t.paused),'no physics starts against a partial graph');
  assert.ok(trace.filter(t=>t.kind==='render'&&t.paused).every(t=>t.dt===0&&t.elapsed===0),'warmup admits cells without elapsed simulation');
 }
 const nonzero=await exercise({initial:.01});assert.match(nonzero.error.message,/zero elapsed/);assert.equal(nonzero.steps,0);
 const held=await exercise({admitAfter:3,holdAt:7});assert.ifError(held.error);assert.equal(held.result.ready,false);assert.match(held.result.failure,/held or failed: 7/);assert.equal(held.steps,8,'stop first failed physics step');
});

test('read-only native draw inventory accounts groups, instancing, double-sided passes and NPC ancestry',async()=>{
 const {readFile}=await import('node:fs/promises');
 const source=await readFile(new URL('./terrain-material.browser.mjs',import.meta.url),'utf8');
 const body=source.slice(source.indexOf('const list=r.renderLists.get(a.scene,0)'),source.indexOf('return{jpeg,samples,inventory'));
 const root={visible:true,name:'npc-model'},parent={visible:true,parent:root};
 const material={type:'MeshBasicMaterial',name:'paint',customProgramCacheKey:()=> 'shared',transparent:true,side:2,forceSinglePass:false};
 const geometry={type:'InstancedBufferGeometry',index:{count:120},attributes:{position:{count:40}},drawRange:{start:6,count:60},isInstancedBufferGeometry:true,instanceCount:5,_maxInstanceCount:3};
 const object={name:'panel',type:'Mesh',isMesh:true,visible:true,parent};
 const item={object,geometry,material,group:{start:12,count:24}};
 let getCalls=0;const r={renderLists:{get(scene,depth){getCalls++;assert.equal(scene,'native-scene');assert.equal(depth,0);return {opaque:[],transmissive:[],transparent:[item]};}}};
 const car={id:4,type:{id:'sedan'},kind:'sedan',active:true,m:{root},point:{edge:'road-2'},vehicle:{x:1,y:2,z:3,yaw:.4,vLong:7}};
 const inventory=Function('a','r',body+'return inventory;')({scene:'native-scene',traffic:[car]},r);
 assert.equal(getCalls,1);assert.equal(inventory.draws.length,1);assert.equal(inventory.draws[0].start,12);assert.equal(inventory.draws[0].count,24);assert.equal(inventory.draws[0].instances,3);assert.equal(inventory.draws[0].passes,2);assert.equal(inventory.draws[0].nominalTriangles,48);assert.equal(inventory.draws[0].npcId,4);
 assert.equal(inventory.traffic[0].nominalTriangles,48);assert.deepEqual(inventory.traffic[0].pose,{x:1,y:2,z:3,yaw:.4,vLong:7});assert.equal(object.onBeforeRender,undefined,'no callback installed');assert.equal(root.visible,true,'native scene visibility untouched');
 object.isInstancedMesh=true;object.count=2;material.forceSinglePass=true;
 const second=Function('a','r',body+'return inventory;')({scene:'native-scene',traffic:[car]},r);
 assert.equal(second.draws[0].instances,2);assert.equal(second.draws[0].nominalTriangles,16);
});
