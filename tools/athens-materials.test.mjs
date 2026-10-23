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
