import test from 'node:test';import assert from 'node:assert/strict';import * as THREE from 'three';
import {roadNetworkMaterial,buildRoadNetwork} from '../src/road-network.js';import {RoadNetwork} from '../src/road-network-surface.js';import {TX} from '../src/tex.js';
test('network asphalt binds shared scans and world coordinates in both street policies',()=>{
 TX.asphalt_diff=new THREE.Texture();TX.asphalt_nor=new THREE.Texture();
 for(const psychiko of[false,true]){const mat=roadNetworkMaterial(psychiko),shader={uniforms:{},vertexShader:'#include <common>\n#include <begin_vertex>',fragmentShader:'#include <common>\n#include <color_fragment>\n#include <normal_fragment_maps>'};mat.onBeforeCompile(shader);assert.equal(shader.uniforms.roadAlbedo.value,TX.asphalt_diff);assert.equal(shader.uniforms.roadNormal.value,TX.asphalt_nor);assert.match(shader.vertexShader,/modelMatrix\*vec4\(position,1\.\)/);assert.match(shader.fragmentShader,/roadAsphaltNormal\(-vViewPosition/);assert.match(shader.fragmentShader,/nHalfWidth-abs\(nUV.x\)/);mat.dispose();}
});
