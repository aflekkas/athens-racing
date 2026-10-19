import test from 'node:test';import assert from 'node:assert/strict';import * as THREE from 'three';
import {athensMaterial,ASPHALT_PERIOD,PAVING_PERIOD,ATHENS_TEXTURES} from '../src/athens-materials.js';import {TX} from '../src/tex.js';
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
