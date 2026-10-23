import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,mkdtemp,rm} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {freeRoamEntryQuery} from '../src/free-roam-entry.js';
import {createTileObservationForDebug} from '../src/world-tile-observation.js';
import {importWithUpdate} from '../src/client-release.js';
import {bundleBrowser,initialChunks} from './bundle-browser.mjs';
const source=await readFile(new URL('../src/game-entry.js',import.meta.url),'utf8');
const body=source.replace(/^import[^\n]*\n/gm,'').replace('export let gameReady','let gameReady').replace("import('./athens-world.js')",'loadFree()').replace("import('./main.js')",'loadRace()');
const dispatch=new Function('URLSearchParams','location','history','freeRoamEntryQuery','createTileObservationForDebug','importWithUpdate','loadFree','loadRace',body+'\nreturn gameReady;');
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('free dispatch preserves the existing converted query and chooses free before any race graph load',async()=>{
 for(const flags of ['', 'simhook','tileLifecycle=1','simhook&tileLifecycle=0','simhook&tileLifecycle=1']){
  const location={search:'?event=free&map=riviera&spawn=120,-80&car=bus&cam=far&'+flags},expected=freeRoamEntryQuery(new URLSearchParams(location.search)),order=[],target={};let cap=null,boots=0;
  const answer=dispatch(URLSearchParams,location,{replaceState(a,b,url){order.push('replace');assert.equal(url,'?'+expected);}},freeRoamEntryQuery,q=>{order.push('observer');cap=createTileObservationForDebug(q,target);return cap;},fn=>fn(),async()=>{order.push('free-import');return{bootAthens({tileObserver}){order.push('free-boot');boots++;assert.equal(tileObserver,cap);return'free-ready';}};},()=>{throw Error('Race graph loaded during free dispatch');});
  assert.equal(await answer,'free-ready');assert.equal(boots,1);assert.deepEqual(order,flags==='simhook&tileLifecycle=1'?['observer','replace','free-import','free-boot']:['replace','free-import','free-boot']);assert.equal(Object.hasOwn(target,'__tileLifecycle'),flags==='simhook&tileLifecycle=1');
 }
});

test('menu, named race, route and lobby dispatch preserve native main gameReady without a second observer factory',async()=>{
 for(const search of ['', '?menu=1&map=athens','?event=penteli-race&map=penteli&simhook&tileLifecycle=1','?routes=1&route=megara-club','?lobby=ROOM']){
  let races=0,reads=0;const result=dispatch(URLSearchParams,{search},{replaceState(){throw Error('Unexpected race URL replacement');}},freeRoamEntryQuery,()=>{throw Error('Race observer belongs to main only');},fn=>fn(),()=>{throw Error('Unexpected free import');},async()=>{races++;return{get gameReady(){reads++;return Promise.resolve('race-ready');}};});assert.equal(await result,'race-ready');assert.equal(races,1);assert.equal(reads,1);
 }
});

test('dispatcher forwards the original import error when the build is unchanged',async()=>{
 const error=Error('missing source chunk'),calls=[],location={search:'?event=free&map=athens',href:'http://fixture.invalid/',reload(){throw Error('Unexpected reload');}},options={document:{querySelector:()=>({content:'same'})},location,fetcher:async(url,init)=>{calls.push({url:String(url),init});return{ok:true,text:async()=>'<meta name="asr-build" content="same">'};},storage:null};
 const pending=dispatch(URLSearchParams,location,{replaceState(){}},freeRoamEntryQuery,()=>{throw Error('No debug flags');},fn=>importWithUpdate(fn,options),async()=>{throw error;},()=>{throw Error('Unexpected race');});await assert.rejects(pending,e=>e===error);assert.equal(calls.length,1);assert.equal(calls[0].init.cache,'no-store');
});

test('dispatcher retains the existing update-and-navigation wait instead of falling back to the race graph',async()=>{
 let reloads=0,settled=false;const location={search:'?event=free&map=athens',href:'http://fixture.invalid/',reload(){reloads++;}},options={document:{querySelector:()=>({content:'before'})},location,fetcher:async()=>({ok:true,text:async()=>'<meta name="asr-build" content="after-game-entry">'}),storage:null};
 const pending=dispatch(URLSearchParams,location,{replaceState(){}},freeRoamEntryQuery,()=>{throw Error('No flags');},fn=>importWithUpdate(fn,options),async()=>{throw Error('old chunk');},()=>{throw Error('No fallback race graph');});pending.then(()=>{settled=true;},()=>{settled=true;});await tick();assert.equal(reloads,1);assert.equal(settled,false);
});

test('the actual dispatcher static dependency closure contains no graphics, physics or race runtime',async t=>{
 const root=resolve(import.meta.dirname,'..'),seen=new Set();let bytes=0;
 async function visit(path){if(seen.has(path))return;seen.add(path);const text=await readFile(resolve(root,path),'utf8');bytes+=Buffer.byteLength(text);for(const match of text.matchAll(/^\s*(?:import|export)\s+(?:[^;\n]*?\sfrom\s*)?['"]([^'"]+)['"]/gm)){const spec=match[1];assert.ok(spec.startsWith('.'),'Unexpected eager package '+spec);await visit(resolve(dirname(resolve(root,path)),spec).slice(root.length+1));}}
 await visit('src/game-entry.js');for(const forbidden of ['src/main.js','src/athens-world.js','src/cars.js','src/physics.js','src/multiplayer.js','src/menu.js','src/world-tile-stream.js','src/route-runtime.js','src/menu-map.js','src/events.js','src/course.js','src/psychiko-building-data.js','src/coastal-dressing-data.js'])assert.equal(seen.has(forbidden),false,forbidden);
 assert.deepEqual([...source.matchAll(/^import .*? from ['"]([^'"]+)['"]/gm)].map(m=>m[1]),['./free-roam-entry.js','./client-release.js','./world-tile-observation.js']);assert.deepEqual([...seen].sort(),['src/game-entry.js','src/free-roam-entry.js','src/map-entry.js','src/map-catalog.js','src/enabled-maps.js','src/spawn-spots.js','src/client-release.js','src/world-tile-observation.js'].sort());assert.ok(bytes>0);t.diagnostic('Static source closure only: '+seen.size+' files / '+bytes+' bytes; not transfer or load timing.');assert.match(await readFile(new URL('../src/main.js',import.meta.url),'utf8'),/m=>m\.bootAthens\(\{tileObserver\}\)/,'native main compatibility branch remains present');
});

test('real bundler redirects only dispatcher race entry to production boot and leaves boot runtime imports intact',async()=>{
 for(const production of [true,false]){
  const root=await mkdtemp(resolve(process.env.TMPDIR||tmpdir(),'dispatcher-tiny-')),out=resolve(root,'out');try{
   await mkdir(resolve(root,'src'),{recursive:true});await mkdir(resolve(out,'src'),{recursive:true});await writeFile(resolve(out,'index.html'),'<script type="module" src="./src/entry.js"></script>');
   await writeFile(resolve(root,'src/entry.js'),"if(globalThis.desktop){await import('./game-entry.js');}");await writeFile(resolve(root,'src/game-entry.js'),source);
   await writeFile(resolve(root,'src/free-roam-entry.js'),"export const freeRoamEntryQuery=q=>q.get('event')==='free'?new URLSearchParams(q):null;");
   await writeFile(resolve(root,'src/client-release.js'),"export const importWithUpdate=fn=>fn();");await writeFile(resolve(root,'src/world-tile-observation.js'),"export const createTileObservationForDebug=()=>({});");
   await writeFile(resolve(root,'src/athens-world.js'),"export const bootAthens=()=> 'free ready';");await writeFile(resolve(root,'src/main.js'),"export const gameReady=Promise.resolve('race ready');");
   if(production)await writeFile(resolve(root,'src/boot.js'),"export const shell=true;export const runtime=()=>import('./main.js');");
   const meta=await bundleBrowser(root,out),entryOf=name=>Object.entries(meta.outputs).find(([,v])=>v.entryPoint==='src/'+name)?.[0],dispatchOutput=entryOf('game-entry.js'),mainOutput=entryOf('main.js'),freeOutput=entryOf('athens-world.js'),bootOutput=entryOf('boot.js');
   assert.ok(dispatchOutput&&mainOutput&&freeOutput);const imports=meta.outputs[dispatchOutput].imports.filter(i=>i.kind==='dynamic-import').map(i=>i.path);assert.ok(imports.includes(freeOutput));assert.ok(imports.includes(production?bootOutput:mainOutput));if(production){assert.equal(imports.includes(mainOutput),false);assert.ok(meta.outputs[bootOutput].imports.some(i=>i.kind==='dynamic-import'&&i.path===mainOutput));}
   const initial=initialChunks(meta,root,out,dispatchOutput),eager=new Set(Object.entries(meta.outputs).filter(([path])=>initial.includes('/'+resolve(root,path).slice(out.length+1).replaceAll('\\','/'))).flatMap(([,v])=>Object.keys(v.inputs)));for(const f of ['src/main.js','src/boot.js','src/athens-world.js'])assert.equal(eager.has(f),false,f);
   assert.equal(await readFile(resolve(root,'src/game-entry.js'),'utf8'),source);assert.equal((await readFile(resolve(root,'src/entry.js'),'utf8')).includes("import('./game-entry.js')"),true);
  }finally{await rm(root,{recursive:true,force:true});}
 }
});


test('parent entry handoff changes only the desktop dynamic target and retains actual gate/prefetch behavior',async()=>{
 const original=await readFile(new URL('../src/entry.js',import.meta.url),'utf8'),needle="await import('./main.js');",candidate=original.includes(needle)?original.replace(needle,"await import('./game-entry.js');"):original;
 if(original.includes(needle))assert.equal(candidate.replace("await import('./game-entry.js');",needle),original);
 assert.deepEqual([...candidate.matchAll(/^import .*$/gm)].map(m=>m[0]),["import { deviceBlockReason, readDevice, showDeviceGate } from './device-gate.js';"]);
 for(const mobile of [true,false]){
  const dir=await mkdtemp(resolve(process.env.TMPDIR||tmpdir(),'dispatcher-gate-')),keys=['document','location','matchMedia','fetch','navigator','__authPrefetch','__routeEntryPrefetch','__gateImported','__gatePrefetch'],saved=new Map(keys.map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)])),requests=[];
  try{
   await writeFile(resolve(dir,'package.json'),'{"type":"module"}');await writeFile(resolve(dir,'entry.js'),candidate);await writeFile(resolve(dir,'device-gate.js'),await readFile(new URL('../src/device-gate.js',import.meta.url),'utf8'));
   await writeFile(resolve(dir,'game-entry.js'),"globalThis.__gateImported++; export const gameReady=Promise.resolve();");await writeFile(resolve(dir,'route-entry-prefetch.js'),"export function prefetchDirectRace(){globalThis.__gatePrefetch++;return null;}");
   for(const k of ['__authPrefetch','__routeEntryPrefetch'])delete globalThis[k];
   Object.assign(globalThis,{document:{documentElement:{dataset:{}}},location:{search:'?event=megara-tt'},matchMedia:q=>({matches:q==='(pointer: coarse)'?mobile:q==='(any-pointer: fine)'?!mobile:false}),fetch:path=>{requests.push(path);return Promise.resolve(new Response('{}',{headers:{'Content-Type':'application/json'}}));},__gateImported:0,__gatePrefetch:0});
   Object.defineProperty(globalThis,'navigator',{configurable:true,value:{userAgent:mobile?'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile Safari':'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',platform:mobile?'iPhone':'Win32',maxTouchPoints:mobile?5:0}});
   await import(pathToFileURL(resolve(dir,'entry.js')).href);await globalThis.__routeEntryPrefetch;await Promise.allSettled(Object.values(globalThis.__authPrefetch||{}));assert.equal(globalThis.__gateImported,mobile?0:1);assert.equal(globalThis.__gatePrefetch,mobile?0:1);assert.deepEqual(requests,mobile?[]:['/api/auth/config','/api/auth/session']);
  }finally{for(const [k,d]of saved)d?Object.defineProperty(globalThis,k,d):delete globalThis[k];await rm(dir,{recursive:true,force:true});}
 }
});
