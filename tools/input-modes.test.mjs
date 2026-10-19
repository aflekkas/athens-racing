import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Input } from '../src/input.js';
const cars=Function('return '+readFileSync(new URL('../src/cars.js',import.meta.url),'utf8').split('export const CARS = ')[1].split('\n];')[0]+'\n];')();
const source=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
const poll=source.slice(source.indexOf('function readInput(dt)'),source.indexOf('// ------------------------------------------------------------------ events, modes & menus'));
// Input modes on a desktop: keyboard MODE taps, the nitrous hint following the selected car, and no touch UI whatever the device
// (2026-10-19, docs/plans/desktop-only.md: the on-screen driving controls were removed with phone support).
class Element extends EventTarget {
 constructor(){super();this.children=[];this.dataset={};this.hidden=false;this.classes=new Set();this.classList={add:c=>this.classes.add(c),remove:c=>this.classes.delete(c),contains:c=>this.classes.has(c)};}
 append(...nodes){for(const n of nodes)this.children.push(n);}
}
function setup({maxTouchPoints=0}={}){
 const body=new Element(),head=new Element(),hint=new Element(),target=new EventTarget(),document={body,head,hidden:false,createElement:()=>new Element(),getElementById:()=>null,querySelectorAll:selector=>selector==='[data-nitrous]'?[hint]:[],addEventListener(){},removeEventListener(){}};
 const input=new Input({target,navigator:{maxTouchPoints,getGamepads:()=>[]},document,storage:null}),player={veh:{spec:null,vLong:0}},mode={inMenu:false};
 const readInput=Function('window','document','G','controls','player','multiplayer','ui','syncSteeringAssist','menu','settings','input','drivingHints','flowAction','shiftTransmission',poll+';return readInput;')({__flow:{inMenu:()=>mode.inMenu}},document,{state:'race'},input,player,{panel:{hidden:true}},{hintDevice:d=>d},()=>false,null,{},input.state,{action(){}},()=>{},()=>{});
 const frame=spec=>{player.veh.spec=spec;readInput(1/60);};
 return{input,mode,frame,body,hint};
}
test('no touch controls are mounted, even on a touchscreen laptop',()=>{
 const{input,body,frame}=setup({maxTouchPoints:10});
 try{frame(cars[0]);assert.equal(input.touchUI,undefined);assert.equal(input.touch,undefined);assert.equal(body.classes.has('touch-driving'),false);assert.notEqual(body.dataset.input,'touch');assert.equal(body.children.length,0);}
 finally{input.destroy();}
});
test('the nitrous key hint follows the selected car, on every car',()=>{
 const{input,frame,hint}=setup();
 try{
  const seat=cars.find(c=>c.id==='ibiza'),mini=cars.find(c=>c.id==='mini');
  assert.equal(seat.nitrous,true);
  frame(seat);assert.equal(hint.hidden,false);frame(mini);assert.equal(hint.hidden,true);
  for(const car of cars){frame(car);assert.equal(hint.hidden,car.nitrous!==true,car.id);}
 }finally{input.destroy();}
});
test('car switch while paused and resume discard stale nitrous and MODE presses',()=>{
 const{input,mode,frame}=setup();
 try{
  frame({nitrous:true,transmission:'both'});input.pending.add('transmission');input.state.nitro=true;
  mode.inMenu=true;frame(cars.find(c=>c.id==='mini'));assert.equal(input.state.nitro,false);
  mode.inMenu=false;frame(cars.find(c=>c.id==='mini'));assert.equal(input.state.transmission,false);assert.equal(input.state.nitro,false);
  frame(cars.find(c=>c.id==='ibiza'));assert.equal(input.state.nitro,false,'switching back cannot revive a stale boost press');
 }finally{input.destroy();}
});
test('every car accepts keyboard MODE taps',()=>{
 const{input,frame}=setup();
 try{
  for(const car of cars){
   frame(car);
   for(const type of ['keydown','keyup']){const event=new Event(type,{cancelable:true});Object.assign(event,{code:'KeyL',repeat:false});input.target.dispatchEvent(event);}
   frame(car);assert.equal(input.state.transmission,true,car.id);frame(car);assert.equal(input.state.transmission,false,car.id);
  }
 }finally{input.destroy();}
});
