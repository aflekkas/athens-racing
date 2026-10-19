import test from'node:test';import assert from'node:assert/strict';import{TurntableControl}from'../src/turntable-control.js';
test('dragging crosses full revolutions in either direction',()=>{const t=new TurntableControl(0);assert.ok(t.drag(1200)>Math.PI*4);assert.ok(t.drag(-2400)<-Math.PI*4);});
test('auto-spin completes a full revolution and pauses only during dragging',()=>{const t=new TurntableControl(0);for(let i=0;i<1200;i++)t.advance(1/60);assert.ok(t.angle>Math.PI*2);const at=t.angle;t.dragging=true;t.advance(.05);assert.equal(t.angle,at);t.dragging=false;t.advance(.05);assert.ok(t.angle>at);});

import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../src/car-select.js',import.meta.url),'utf8');
test('showroom viewport has a nonempty morph key',()=>{
 assert.match(source, /class="car-preview-viewport" data-ui-keep="preview"/);
});
test('every pointer type rotates the car by dragging, and a swipe never changes trim',()=>{
 const handlers=source.slice(source.indexOf('  const down = e =>'),source.indexOf("  container.addEventListener('pointerdown'"));
 const factory=new Function('turntable','model','container','renderer','scene','camera','performance','step','frame',`let pointer,pointerX;${handlers};return {down,move,up}`);
 for(const [type,dx,elapsed,event] of [['touch',20,100,'pointerup'],['touch',90,100,'pointerup'],['touch',-90,100,'pointerup'],['touch',90,100,'pointercancel'],['mouse',90,100,'pointerup'],['pen',90,100,'pointerup']]){
  const t=new TurntableControl(0),model={root:{rotation:{y:0}}};let now=0,stepped=0;
  const h=factory(t,model,{classList:{add(){},remove(){}},setPointerCapture(){}},{render(){}},{},{},{now:()=>now},n=>stepped+=n,()=>{});
  const e={pointerId:1,clientX:0,pointerType:type,preventDefault(){}};
  h.down(e);now=elapsed;h.move({...e,clientX:dx});assert.equal(model.root.rotation.y,dx*.012);
  h.up({...e,clientX:dx,type:event});assert.equal(stepped,0,'trim changes only through its own controls');assert.equal(t.dragging,false);
 }
});
