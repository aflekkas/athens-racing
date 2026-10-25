import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
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

// Free roam has its own entry; racing audio in main.js cannot cover it.
test('the actual free-roam entry owns a live audio lifecycle, frame update and teardown',async()=>{
 const world=await readFile(new URL('../src/athens-world.js',import.meta.url),'utf8');
 assert.match(world,/createAthensAudio\(/,'free roam must wire sound independently of main.js');
 assert.match(world,/worldAudio\.update\(/,'live render frames must supply vehicle telemetry');
 assert.match(world,/worldAudio\.dispose\(/,'free-roam teardown must release its graph and listeners');
});

test('free-roam audio unlocks once per gesture, follows vehicle and sliders, silences hidden windows and disposes',async()=>{
 const {createAthensAudio}=await import('../src/athens-audio.js');
 const target=new EventTarget(),doc=new EventTarget();doc.hidden=false;
 const events=[],updates=[];let subscriber,removed=0,closed=0;
 const audio={ctx:null,setVolumes:v=>events.push(['vol',v.master]),setEngine:s=>events.push(['engine',s.id]),
  start(){events.push(['start']);this.ctx||={currentTime:5,close:()=>{closed++;return Promise.resolve();}};this.mainOut={gain:{setValueAtTime:v=>events.push(['gain',v])}};},
  update:p=>updates.push({...p,wheels:p.wheels.map(w=>({...w})),traffic:p.traffic.map(t=>({...t}))}),engineOff:()=>events.push(['off']),menuObserver:{disconnect:()=>events.push(['disconnect'])}};
 const settings={master:0,engine:.8},spec={id:'test-car',redline:7000,gearbox:'manual'};
 const lifecycle=createAthensAudio({audio,spec,settings,onSettings:fn=>{subscriber=fn;return()=>removed++;},target,document:doc});
 assert.deepEqual(events,[['vol',0],['engine','test-car']]);
 const v={x:0,z:0,yaw:0,rpm:2345,load:.7,vLong:12,vLat:5,m:1200,ratio:()=>3.5,corners:[{Fz:3333,sx:.2,sy:.3,vw:13}],_S:[{vgx:11}],wheelSurf:['gravel'],manual:true,shiftStartEvent:{serial:7,direction:1},bumpHit:.2};
 lifecycle.update(v,.03);assert.equal(updates.length,0,'a frame cannot bypass gesture unlock');
 target.dispatchEvent(new Event('keydown'));assert.ok(audio.ctx);
 lifecycle.update(v,.03,{camera:'cockpit',input:{throttle:.8},cars:[{active:true,id:9,v:10,vehicle:{x:10,z:0}}]});
 const p=updates.at(-1);assert.equal(p.rpm,2345);assert.equal(p.load,.7);assert.equal(p.speed,13);assert.equal(p.gearRatio,3.5);assert.equal(p.wheels[0].vgx,11);assert.equal(p.wheels[0].Fz,3333);assert.equal(p.surfaces[0],'gravel');assert.equal(p.shiftStart.serial,7);assert.equal(p.cockpit,true);assert.equal(p.traffic[0].id,9);
 subscriber({master:.2});assert.deepEqual(events.at(-1),['vol',.2]);
 lifecycle.update(v,.03,{paused:true});assert.equal(updates.at(-1).muted,true);assert.equal(updates.at(-1).menuOpen,true);
 doc.hidden=true;doc.dispatchEvent(new Event('visibilitychange'));assert.deepEqual(events.at(-1),['gain',0]);
 const starts=events.filter(e=>e[0]==='start').length;target.dispatchEvent(new Event('click'));assert.equal(events.filter(e=>e[0]==='start').length,starts);
 doc.hidden=false;doc.dispatchEvent(new Event('visibilitychange'));assert.ok(events.some(e=>e[0]==='vol'&&e[1]===0),'restores saved master, including zero');
 lifecycle.update(v,.03);assert.equal(updates.at(-1).muted,false);
 lifecycle.dispose();lifecycle.dispose();assert.equal(removed,1);assert.equal(closed,1);
 const count=events.length;target.dispatchEvent(new Event('keydown'));doc.dispatchEvent(new Event('visibilitychange'));subscriber(settings);lifecycle.update(v,.03);assert.equal(events.length,count,'teardown leaves no active listeners or frame work');
});

// Execute the shipped route/free phase control flow at a simulated browser
// boundary. This checks placement/order only; native CI still measures real PCM.
export async function traceDesktopDrivingPhases(source) {
 const begin=source.indexOf('  for (const map of routeIds) {'),end=source.indexOf('  const warmRouteBegan',begin);
 assert.ok(begin>=0&&end>begin,'actual native driving phases must be available');
 const trace=[],state={mode:null,held:false},context={window:{},document:{body:{classList:{contains:()=>true}}},assert,
  routeIds:Array.from({length:6},(_,i)=>'route-probe-'+i),requests:[],results:[],origin:'http://offline.test',evidence:'evidence',resolve:(...a)=>a.join('/'),
  localStorage:{getItem:()=> 'retained'},console:{log(){}},requestAnimationFrame:null};
 let clock=0;context.requestAnimationFrame=fn=>fn(clock+=16);
 const vehicle=()=>({x:0,z:0,kmh:10});
 context.page={
  async goto(url){const u=new URL(url);state.mode=u.searchParams.get('event')==='free'?'free':'race';state.held=false;trace.push(['goto',state.mode]);
   if(state.mode==='race'){context.window={__game:{state:'race',mapId:'athens',unifiedCompiled:{id:u.searchParams.get('route')}},__sim:{player:{veh:vehicle()},renderer:{info:{render:{calls:1,triangles:1},memory:{geometries:1}}}},__worldSession:{metrics:{entryPhases:{}}}};}
   else context.window={__athens:{player:{veh:vehicle()},stats:{frames:30},stream:{inflight:0,transientBytes:0},menu:{open:false},paused:false}};
  },
  async evaluate(fn,arg){return fn(arg);},async waitForFunction(fn,arg){assert.ok(await fn(arg),'phase readiness condition');},async screenshot(){},
  async waitForTimeout(ms){trace.push(['wait',state.mode,ms]);if(state.held){const view=context.window.__athens||context.window.__sim;view.player.veh.x+=ms/1000;}},
  keyboard:{async down(key){assert.equal(key,'w');state.held=true;trace.push(['down',state.mode]);},async up(){state.held=false;trace.push(['up',state.mode]);},async press(key){assert.equal(key,'Escape');context.window.__athens.paused=true;context.window.__athens.menu.open=true;}}
 };
 context.recordFreeAudio=async label=>{assert.equal(state.mode,'free','free-roam PCM check executed outside free-roam mode');assert.equal(state.held,true,'PCM check must run while driving');trace.push(['audio',label]);};
 context.unlockFreeAudio=async()=>{assert.equal(state.mode,'free');trace.push(['unlock']);};
 context.recordFreeAdmission=async(label,disposed)=>{assert.equal(state.mode,'free');trace.push(['admission',label,!!disposed]);};
 context.assertFreeAudioDisposed=async label=>{assert.equal(state.mode,'free');trace.push(['disposed',label]);};
 await vm.runInNewContext('(async()=>{'+source.slice(begin,end)+'})()',context);
 return trace;
}

test('native driving flow completes six race drives before both real free-roam PCM phases',async()=>{
 const source=await readFile(new URL('./check-desktop.mjs',import.meta.url),'utf8'),trace=await traceDesktopDrivingPhases(source);
 assert.deepEqual(trace.filter(e=>e[0]==='goto').map(e=>e[1]),[...Array(6).fill('race'),'free','free']);
 assert.deepEqual(trace.filter(e=>e[0]==='wait'&&e[1]==='race').map(e=>e[2]),Array(6).fill(2500),'six race drives retain their original duration');
 assert.deepEqual(trace.filter(e=>e[0]==='audio').map(e=>e[1]),['first entry driving','second entry driving']);
 assert.deepEqual(trace.filter(e=>e[0]==='disposed').map(e=>e[1]),['first disposal','second disposal']);
});
