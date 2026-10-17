import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {createRain,rainAtlas,SprayCards,WaterSplash,RAIN_BUDGET} from '../src/rain-overlays.js';
test('rain uses bounded depth streaks and spray stays bounded at two cards per nine cars',()=>{
 const rain=createRain(),spray=new SprayCards(new THREE.Scene());
 assert.equal(rain.mesh.geometry.instanceCount,RAIN_BUDGET.lowStreaks);assert.equal(rain.mesh.geometry.index.count,6);
 spray.begin();for(let i=0;i<100;i++)spray.add(i,0,0,30,.3);spray.update();assert.equal(spray.g.instanceCount,18);
 spray.begin();spray.update();assert.equal(spray.g.instanceCount,0);
 assert.equal(rainAtlas().image.data.byteLength,RAIN_BUDGET.textureBytes);assert.equal(rainAtlas().generateMipmaps,false);assert.equal(rainAtlas().userData.shared,true);
 assert.equal(rain.mesh.geometry.attributes.aSeed.count,RAIN_BUDGET.streaks);
 assert.equal(rain.mat.depthWrite,false);assert.equal(rain.mat.depthTest,true);
 assert.equal(spray.mat.uniforms.uMap.value,rainAtlas());
});
test('water splash has two quads, fades and supports the multiplayer reset contract',()=>{
 const s=new WaterSplash(new THREE.Scene(),0);s.burst(2,3,5,5);assert.ok(s.pts.visible);
 assert.equal(s.pts.geometry.index.count+s.ring.geometry.index.count,12);
 for(let i=0;i<200;i++)s.update(1/60);assert.equal(s.pts.visible,false);assert.equal(s.ring.visible,false);
 s.burst(2,3,0,0);s.t=9;s.life.fill(0);s.pts.visible=s.ring.visible=false;s.update(.1);assert.equal(s.pts.visible,false);
});
test('rain overlays cannot add light, shadow, reflection, post or AO passes',()=>{
 const s=readFileSync(new URL('../src/rain-overlays.js',import.meta.url),'utf8');
 assert.doesNotMatch(s,/new THREE\.(?:Points|.*Light|.*RenderTarget)|shadowMap|castShadow\s*=\s*true|EffectComposer|SSAOPass|GTAO|Bloom|DOF|requestAnimationFrame/);
 const weather=readFileSync(new URL('../src/weather.js',import.meta.url),'utf8');
 assert.doesNotMatch(weather,/class Spray|function createRain|W\.spray\.emit|instanceCount = low \? 1800/);
 const wet=weather.split('const WX_WET =')[1].split('// after the scene lights')[0];
 assert.match(wet,/texture2D/);assert.match(wet,/roughnessFactor/);assert.doesNotMatch(wet,/normal\s*=|wxTime/);
});
