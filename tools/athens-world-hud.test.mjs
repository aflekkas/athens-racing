import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Input} from '../src/input.js';
import {pickedAthensArea,pollFreeRoam,freeRoamHud,freeRoamJSBytes} from '../src/athens-free-roam.js';
import {loading,freeRoamLoadingTitle,FREE_ROAM_TIPS} from '../src/ui/loading.js';

const rig=()=>{
 const target=new EventTarget(),input=new Input({target,navigator:{getGamepads:()=>[]},storage:null,document:null});
 const key=(type,code)=>{const e=new Event(type,{cancelable:true});Object.assign(e,{code,repeat:false});target.dispatchEvent(e);};
 const actions=[],menu={open:false,action(name){actions.push('menu:'+name);if(name==='back')this.open=false;}};
 const poll=()=>pollFreeRoam(input,1/30,{speed:10,menu,blocked:false,action(name){actions.push(name);if(name==='pause')menu.open=true;}});
 return {input,key,menu,poll,actions};
};
test('Athens spawn polls live keyboard drive state; pause can resume and drive again',()=>{
 const r=rig();try{
  for(const code of ['KeyW','ArrowUp']){r.key('keydown',code);for(let i=0;i<20;i++)r.poll();assert.equal(r.input.state.throttle,1);r.key('keyup',code);for(let i=0;i<20;i++)r.poll();}
  for(const code of ['KeyS','ArrowDown']){r.key('keydown',code);for(let i=0;i<20;i++)r.poll();assert.equal(r.input.state.brake,1);r.key('keyup',code);}
  for(const [code,sign]of [['KeyA',-1],['ArrowLeft',-1],['KeyD',1],['ArrowRight',1]]){r.key('keydown',code);for(let i=0;i<20;i++)r.poll();assert.equal(Math.sign(r.input.state.steer),sign);r.key('keyup',code);}
  r.key('keydown','Space');r.poll();assert.equal(r.input.state.handbrake,true);r.key('keyup','Space');
  r.key('keydown','Escape');r.poll();assert.equal(r.menu.open,true);assert.equal(r.input.state.throttle,0);r.key('keyup','Escape');r.poll();
  r.key('keydown','Escape');r.poll();assert.equal(r.menu.open,false,'Escape must still be polled while physics is paused');r.key('keyup','Escape');r.poll();
  r.key('keydown','KeyW');for(let i=0;i<20;i++)r.poll();assert.equal(r.input.state.throttle,1);
  for(const code of ['KeyC','KeyT','KeyR']){r.key('keydown',code);r.poll();r.key('keyup',code);r.poll();}assert.ok(r.actions.includes('camera'));assert.ok(r.actions.includes('tow'));
 }finally{r.input.destroy();}
});
test('free roam paints the streamed street minimap and shared tachometer without race guidance',()=>{
 const calls=[],dial={mini:{width:300,height:300},mctx:{},drawTacho:s=>calls.push(['tacho',s]),drawWorldMinimap:(g,w,h,s)=>calls.push(['map',s])};
 freeRoamHud(dial,{x:10,z:20,yaw:1,vLong:10,gear:2},{map:true,tacho:true,spec:{redline:7000},aidsOff:false});
 assert.deepEqual(calls.map(c=>c[0]),['tacho','map']);assert.equal(calls[1][1].free,true);assert.equal(calls[0][1].kmh,36);
});
test('loading uses only the picked Athens area and clears stale Riviera metadata',()=>{
 assert.equal(pickedAthensArea(new URLSearchParams('spawn=1,2&spawnArea=Piraeus')),'Piraeus');
 assert.equal(pickedAthensArea(new URLSearchParams('spawnArea=Vouliagmeni')),'');
 assert.equal(freeRoamLoadingTitle('Piraeus'),'ATHENS · PIRAEUS');assert.equal(freeRoamLoadingTitle(''),'ATHENS');
 const ids=Object.fromEntries(['ldName','ldSub','ldKind','ldLen','ldArt'].map(k=>[k,{textContent:'Vouliagmeni',replaceChildren(){this.cleared=true;}}])),previous=globalThis.document;
 globalThis.document={getElementById:id=>ids[id]};try{loading.setFreeRoam('Piraeus');assert.equal(ids.ldName.textContent,'ATHENS · PIRAEUS');assert.equal(ids.ldKind.textContent,'FREE ROAM');assert.equal(ids.ldLen.textContent,'');assert.equal(ids.ldArt.cleared,true);assert.doesNotMatch(ids.ldSub.textContent,/Vouliagmeni/);assert.equal(loading.tips,FREE_ROAM_TIPS);}finally{globalThis.document=previous;}
});
test('a transient heap measurement never counts live scene and tile buffers twice',()=>{
 const MiB=1024*1024;assert.equal(freeRoamJSBytes(220*MiB,35*MiB,28*MiB,4*MiB),220*MiB);assert.ok(freeRoamJSBytes(220*MiB,35*MiB,28*MiB,4*MiB)<256*MiB);assert.equal(freeRoamJSBytes(20,35,28,4),67);
});
test('the shipped Athens entry wires shared input, HUD, settings and picked loading copy',async()=>{
 const world=await readFile(new URL('../src/athens-world.js',import.meta.url),'utf8'),hud=await readFile(new URL('../src/hud.js',import.meta.url),'utf8'),picker=await readFile(new URL('../src/spawn-select.js',import.meta.url),'utf8');
 assert.match(world,/dial=Object\.assign\(Object\.create\(Hud\.prototype\),\{tacho,tctx:/);assert.match(world,/freeRoamHud\(dial,v/);assert.match(world,/pollFreeRoam\(input,delta/);assert.match(world,/new Menu\(/);assert.match(world,/openSettings/);assert.match(world,/pickedAthensArea\(query\)/);assert.match(world,/freeRoam:true,area/);assert.match(picker,/params\.set\('spawnArea', choice\.areaName/);
 assert.doesNotMatch(world,/blocked:paused\|\|/);assert.doesNotMatch(world,/\['posBox','mapBox'/);
 for(const method of ['tachoBase','fontsReady','drawTacho'])assert.match(hud,new RegExp('\\n  '+method+'\\('));
});
test('after a unified free-roam spawn, real keyboard input accelerates and steers the Vehicle on AthensGround',async()=>{
 const [{Vehicle},{AthensRoute,AthensGround},{catalogue}]=await Promise.all([import('../src/physics.js'),import('../src/athens-ground.js'),import('./physics-test/powertrain.mjs')]);
 const route=new AthensRoute({x:1000,y:0,z:2000}),v=new Vehicle(catalogue().find(c=>c.id==='mini_jcw'),route);
 const stream={readyAt:()=>true,contact:()=>({y:0,nx:0,nz:0,flags:1,layer:0,surfaceId:1})};
 v.ground=new AthensGround(stream,route,{resolve:()=>false},{contact:()=>null});v.reset(0,0,0);Object.assign(v,{x:1000,y:0,z:2000,yaw:0,vLong:0,vLat:0,w:0,_network:true});v.syncWheels();
 const r=rig();try{assert.equal(v.vLong,0);r.key('keydown','KeyW');
  for(let frame=0;frame<150;frame++){if(frame===100)r.key('keydown','KeyD');r.poll();for(let i=0;i<8;i++){v.ground.begin(v);v.update(1/240,r.input.state);}}
  assert.ok(v.vLong>5,'throttle drives the actual spawned car');assert.ok(Math.hypot(v.x-1000,v.z-2000)>10,'the car moves through world coordinates');assert.ok(Math.abs(v.yaw)>.02,'keyboard steering changes heading');
 }finally{r.input.destroy();}
});
