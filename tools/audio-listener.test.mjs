import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cameraRelativeSource,cameraDirectionPan,syncAudioListener} from '../src/audio-listener.js';
function camera(yaw=0,roll=0){const c=Math.cos(yaw),s=Math.sin(yaw),r=Math.cos(roll),t=Math.sin(roll);return {matrixWorld:{elements:[c*r,t,-s*r,0,-c*t,r,s*t,0,s,0,c,0,3,2,4,1]}};}
for(const view of ['chase','cockpit'])test(`${view}: ±90° source pans with camera, including mouse yaw and roll`,()=>{
 for(const yaw of [0,Math.PI/2,-Math.PI/2,Math.PI])for(const roll of [0,.2]){
  const c=camera(yaw,roll),e=c.matrixWorld.elements;
  for(const side of [-1,1]){const rel=cameraRelativeSource(c,{vx:0,vz:0},3+e[0]*10*side,2+e[1]*10*side,4+e[2]*10*side);assert.ok(Math.abs(rel.pan-side)<1e-12);assert.ok(Math.abs(rel.d-10)<1e-12);}
  assert.ok(Math.abs(cameraDirectionPan(c,-e[8],-e[9],-e[10]))<1e-12);
 }
});
test('listener position, forward and up AudioParams are refreshed after mouse look',()=>{
 const listener={};for(const p of ['position','forward','up'])for(const a of 'XYZ')listener[p+a]={setValueAtTime(v,t){this.value=v;this.time=t;}};
 const ctx={listener,currentTime:7};syncAudioListener(ctx,camera());syncAudioListener(ctx,camera(Math.PI/2,.2));
 assert.ok(Math.abs(listener.forwardX.value+1)<1e-12);assert.ok(Math.abs(listener.upZ.value-Math.sin(.2))<1e-12);assert.equal(listener.positionY.value,2);assert.equal(listener.forwardX.time,7);
});
test('legacy listener receives the same camera orientation',()=>{let got;const ctx={currentTime:0,listener:{setPosition(){},setOrientation(...a){got=a;}}};syncAudioListener(ctx,camera(Math.PI/2));assert.ok(Math.abs(got[0]+1)<1e-12);assert.equal(got[4],1);});
