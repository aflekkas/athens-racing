import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Input } from '../src/input.js';
const cars=Function('return '+readFileSync(new URL('../src/cars.js',import.meta.url),'utf8').split('export const CARS = ')[1].split('\n];')[0]+'\n];')();
const source=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
const poll=source.slice(source.indexOf('function readInput(dt)'),source.indexOf('// ------------------------------------------------------------------ events, modes & menus'));
class Element extends EventTarget {
 constructor(tag='div'){super();this.tag=tag;this.children=[];this.dataset={};this.hidden=false;this.classes=new Set();this.classList={add:c=>this.classes.add(c),remove:c=>this.classes.delete(c),contains:c=>this.classes.has(c)};}
 append(...nodes){for(const n of nodes){n.parent=this;this.children.push(n);}}
 setAttribute(){}setPointerCapture(){}
 remove(){this.parent?.children.splice(this.parent.children.indexOf(this),1);}
 querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
 querySelectorAll(selector){const all=this.children.flatMap(n=>[n,...n.querySelectorAll('*')]);if(selector==='*')return all;const action=/data-action="([^"]+)"/.exec(selector)?.[1];return action?all.filter(n=>n.dataset.action===action):[];}
}
function setup(){
 const body=new Element(),head=new Element(),target=new EventTarget(),document={body,head,hidden:false,createElement:t=>new Element(t),getElementById:id=>[body,head,...body.querySelectorAll('*'),...head.querySelectorAll('*')].find(e=>e.id===id)||null,querySelectorAll:()=>[],addEventListener(){},removeEventListener(){}};
 const input=new Input({target,navigator:{maxTouchPoints:1,getGamepads:()=>[]},document,storage:null}),player={veh:{spec:null,vLong:0}},mode={inMenu:false};
 const readInput=Function('window','document','G','controls','player','multiplayer','ui','syncSteeringAssist','menu','settings','input','drivingHints','flowAction','shiftTransmission',poll+';return readInput;')({__flow:{inMenu:()=>mode.inMenu}},document,{state:'race'},input,player,{panel:{hidden:true}},{hintDevice:d=>d},()=>false,null,{},input.state,{action(){}},()=>{},()=>{});
 const frame=spec=>{player.veh.spec=spec;readInput(1/60);};
 const button=action=>input.touchUI.querySelector(`[data-action="${action}"]`);
 return{input,mode,frame,button};
}
test('touch TC/ESC emits one toggle while held and its label follows settings',()=>{
 const {input,frame,button}=setup();
 try{
  frame(cars[0]);const tc=button('tractionControl');assert.ok(tc);assert.equal(tc.hidden,false);assert.equal(tc.textContent,'TC ON');
  const event=new Event('pointerdown',{cancelable:true});Object.assign(event,{pointerId:1});tc.dispatchEvent(event);
  frame(cars[0]);assert.equal(input.state.tractionControl,true);frame(cars[0]);assert.equal(input.state.tractionControl,false);
  input.setAidsEnabled(false);assert.equal(tc.textContent,'TC OFF');input.setAidsEnabled(true);assert.equal(tc.textContent,'TC ON');
 }finally{input.destroy();}
});
test('production selected-car polling shows SEAT nitrous, hides MINI nitrous and keeps MODE on every car',()=>{
 const{input,frame,button}=setup();
 try{
  const seat=cars.find(c=>c.id==='ibiza'),mini=cars.find(c=>c.id==='mini');
  assert.equal(seat.nitrous,true);assert.equal(Object.hasOwn(mini,'transmission'),false);
  frame(seat);assert.equal(button('nitro').hidden,false);assert.equal(button('transmission').hidden,false);assert.equal(input.touchUI.dataset.auxColumns,'5');
  frame(mini);assert.equal(button('nitro').hidden,true);assert.equal(button('transmission').hidden,false);assert.equal(input.touchUI.dataset.auxColumns,'5');
  for(const car of cars){frame(car);assert.equal(button('nitro').hidden,car.nitrous!==true,car.id);assert.equal(button('transmission').hidden,false,car.id);}
 }finally{input.destroy();}
});
test('car switch while paused and resume discard stale touch nitrous and MODE presses',()=>{
 const{input,mode,frame,button}=setup();
 try{
  frame({nitrous:true,transmission:'both'});input.touch.nitro=1;input.touch.transmission=1;input.pending.add('transmission');
  mode.inMenu=true;frame(cars.find(c=>c.id==='mini'));assert.equal(input.touchUI.hidden,true);assert.equal(input.touch.nitro,0);assert.equal(input.touch.transmission,0);assert.equal(input.state.nitro,false);
  mode.inMenu=false;frame(cars.find(c=>c.id==='mini'));assert.equal(input.touchUI.hidden,false);assert.equal(button('nitro').hidden,true);assert.equal(button('transmission').hidden,false);assert.equal(input.state.transmission,false);
  frame(cars.find(c=>c.id==='ibiza'));assert.equal(button('nitro').hidden,false);assert.equal(input.state.nitro,false,'switching back cannot revive a stale boost press');
  frame({transmission:'both'});assert.equal(button('transmission').hidden,false);assert.equal(button('nitro').hidden,true);
 }finally{input.destroy();}
});

test('every car accepts keyboard MODE taps',()=>{
 const{input,frame}=setup();
 try{
  const mini=cars.find(c=>c.id==='mini');frame(mini);
  for(const type of ['keydown','keyup']){const event=new Event(type,{cancelable:true});Object.assign(event,{code:'KeyL',repeat:false});input.target.dispatchEvent(event);}
  frame(mini);assert.equal(input.state.transmission,true);frame(mini);assert.equal(input.state.transmission,false);
 }finally{input.destroy();}
});

test('touch MODE and both gear buttons emit independent edges on every car',()=>{
 const{input,frame,button}=setup();
 try{for(const car of cars)for(const action of ['transmission','shiftUp','shiftDown']){
  frame(car);assert.equal(button(action).hidden,false);
  const down=new Event('pointerdown',{cancelable:true});Object.assign(down,{pointerId:1});button(action).dispatchEvent(down);
  frame(car);assert.equal(input.state[action],true);frame(car);assert.equal(input.state[action],false);
  const up=new Event('pointerup',{cancelable:true});Object.assign(up,{pointerId:1});button(action).dispatchEvent(up);frame(car);
 }}finally{input.destroy();}
});
