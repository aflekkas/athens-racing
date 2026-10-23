import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {WorldTileStream} from '../src/world-tile-stream.js';
import {TILE_TABLES} from '../src/world-tile-format.js';
import {createTileObservationForDebug,openTileStreamObservation,openTilePoolObservation,observeTileIdleTerminate,observeTileAdmission,observeTilePoolSettle} from '../src/world-tile-observation.js';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const hash=i=>(i+1).toString(16).padStart(64,'0');
function manifest(n=1){const tiles={};for(let i=0;i<n;i++)tiles[`${i},0`]={url:`/world/cells/${hash(i)}.bin.gz`,sha256:hash(i),bytes:10,decodedBytes:100,triangles:0,dependencies:[],source:{regionId:'basin',world:'megara',revision:'b'.repeat(64)}};return{tileVersion:1,tileMetres:512,world:'athens',revision:'a'.repeat(64),projection:{lat0:37.98,lon0:23.73,mlat:111320,mlon:87700},spawn:{cell:[0,0],anchor:'spawn:0'},tiles};}
function packet(cell){const arrays=[],tables={};for(const [k,[type]]of Object.entries(TILE_TABLES)){tables[k]=arrays.length;arrays.push(new globalThis[type](k==='coarseHeights'?1089:0));}return{metadata:{tables,cell},arrays,bytes:80};}
function observed(){const target={},observer=createTileObservationForDebug(new URLSearchParams('simhook&tileLifecycle=1'),target);return{observer,view:target.__tileLifecycle};}
function fakeWorkers(t,{throwPost=false}={}){const old=globalThis.Worker,workers=[],posts=[],terminations=[];globalThis.Worker=class{constructor(){workers.push(this);}postMessage(data){posts.push(data);this.last=data;if(throwPost)throw Error('Tile worker cancelled');}terminate(){terminations.push(this);}reply(extra={}){this.onmessage?.({data:{id:this.last.id,packet:packet(this.last.job.cell),...extra}});}};t.after(()=>{globalThis.Worker=old;});return{workers,posts,terminations,setThrowPost:value=>{throwPost=value;}};}
function stream(m,observer,extra={}){return new WorldTileStream(m,{observer,baseURL:'http://127.0.0.1:8123/data/athens/manifest.json',nearRing:0,pinSpawn:false,concurrency:1,capBytes:1000,now:()=>0,...extra});}
async function complete(s,worker){worker.reply();await tick();await tick();s.activateFrame();}

test('default import and null/partial debug flags allocate no observer registry or handle',async()=>{
 const source=await readFile(new URL('../src/world-tile-observation.js',import.meta.url),'utf8'),Old=globalThis.WeakMap;let maps=0;
 globalThis.WeakMap=class extends Old{constructor(...args){super(...args);maps++;}};
 try{const fresh=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));assert.equal(maps,0);assert.equal(fresh.createTileObservationForDebug(null,{}),null);assert.equal(fresh.createTileObservationForDebug(undefined,{}),null);for(const flags of ['', 'simhook','tileLifecycle=1','simhook&tileLifecycle=0','simhook&tileLifecycle=true']){const target={};assert.equal(fresh.createTileObservationForDebug(new URLSearchParams(flags),target),null);assert.equal(Object.hasOwn(target,'__tileLifecycle'),false);}assert.equal(maps,0);const target={};assert.ok(fresh.createTileObservationForDebug(new URLSearchParams('simhook&tileLifecycle=1'),target));assert.equal(maps,1);assert.deepEqual(Object.keys(target.__tileLifecycle).sort(),['snapshot','status']);assert.ok(Object.isFrozen(target.__tileLifecycle));}finally{globalThis.WeakMap=Old;}
});

test('native stale interest records immutable source identity, distinct epochs and ordered abort/terminate/settle',async t=>{
 const f=fakeWorkers(t),o=observed(),m=manifest(2),s=stream(m,o.observer);s.update({x:1,z:1});await tick();s.update({x:513,z:1});await tick();await tick();
 const snapshot=o.view.snapshot();assert.equal(snapshot.valid,true);const events=snapshot.journal.filter(e=>e.admissionSerial===1);assert.deepEqual(events.map(e=>e.phase),['admit','pool-bind','worker-post','remove','controller-abort','worker-terminate','pool-settle','load-settle']);
 for(const e of events){assert.equal(e.cell,'0,0');assert.equal(e.entrySHA256,hash(0));assert.equal(e.entryURL,m.tiles['0,0'].url);assert.equal(e.resolvedURL,'http://127.0.0.1:8123'+m.tiles['0,0'].url);assert.equal(e.entryBytes,10);assert.equal(e.manifestRevision,m.revision);assert.equal(e.sourceRevision,'b'.repeat(64));assert.ok(Object.isFrozen(e));}
 assert.equal(events[0].admittedInterestEpoch,1);assert.equal(events.find(e=>e.phase==='remove').currentInterestEpoch,2);assert.equal(events[0].poolJobSerial,null);assert.equal(events[1].poolJobSerial,1);assert.equal(events[5].reason,'stale-interest');assert.equal(events[6].detail,'native-cancel');assert.equal(f.terminations.length,1);assert.ok(events.every((e,i)=>!i||e.seq>events[i-1].seq));assert.throws(()=>{snapshot.journal[0].cell='other';},TypeError);s.dispose();await tick();
});

test('actual admission eviction records removal without inventing a completed-worker termination',async t=>{
 const f=fakeWorkers(t),o=observed(),s=stream(manifest(2),o.observer,{capBytes:150});s.update({x:1,z:1});await tick();await complete(s,f.workers[0]);s.update({x:513,z:1});await tick();
 const events=o.view.snapshot().journal.filter(e=>e.admissionSerial===1);assert.equal(events.find(e=>e.phase==='remove').reason,'admission-eviction');assert.ok(events.some(e=>e.phase==='controller-abort'));assert.equal(events.some(e=>e.phase==='worker-terminate'),false);assert.equal(s.metrics.evictions,1);s.dispose();await tick();
});

test('stream disposal cancels native loading while idle cleanup has no cell job identity',async t=>{
 const f=fakeWorkers(t),o=observed(),a=stream(manifest(),o.observer);a.update({x:1,z:1});await tick();a.dispose();await tick();let snap=o.view.snapshot();assert.equal(snap.valid,true);assert.equal(snap.journal.find(e=>e.phase==='worker-terminate').reason,'stream-dispose');assert.equal(snap.retainedContexts,0);
 const b=stream(manifest(),o.observer);b.update({x:1,z:1});await tick();await complete(b,f.workers.at(-1));b.dispose();await tick();snap=o.view.snapshot();const idle=snap.journal.find(e=>e.phase==='idle-worker-terminate');assert.equal(idle.cell,null);assert.equal(idle.poolJobSerial,null);assert.equal(idle.detail,'no-job');assert.equal(idle.reason,'stream-dispose');assert.equal(snap.valid,true);
});

test('abort before native load has no worker serial/post and never invents a network job',async t=>{
 const f=fakeWorkers(t),o=observed(),s=stream(manifest(),o.observer);s.update({x:1,z:1});s.dispose();await tick();const snap=o.view.snapshot();assert.equal(snap.valid,true);assert.equal(f.posts.length,0);assert.equal(snap.journal.some(e=>e.phase==='worker-post'),false);assert.ok(snap.journal.every(e=>e.poolJobSerial===null));assert.equal(snap.retainedContexts,0);
});

test('observer off/on preserve exact native posts, reservation changes and worker outcomes',async t=>{
 const f=fakeWorkers(t),runs=[];for(const on of [false,true]){const o=on?observed():null,s=stream(manifest(),o?.observer);s.update({x:1,z:1});await tick();const w=f.workers.at(-1),post=f.posts.at(-1);assert.deepEqual(Object.keys(post).sort(),['id','job']);assert.deepEqual(Object.keys(post.job).sort(),['cell','entry','revision','url','world']);await complete(s,w);runs.push({post,state:s.tiles.get('0,0').state,resident:s.residentBytes,reserved:s.reservedBytes,transient:s.transientBytes,inflight:s.inflight,failures:s.metrics.failures});s.dispose();await tick();if(o)assert.equal(o.view.status().valid,true);}assert.deepEqual(runs[0],runs[1]);
});

test('unknown removal and native errors stay fatal regardless of cancellation-looking messages',async t=>{
 const f=fakeWorkers(t);for(const kind of ['unknown','worker','post','message','custom']){f.setThrowPost(kind==='post');const o=observed(),s=stream(manifest(),o.observer,kind==='custom'?{load:async()=>{throw Error('Tile worker cancelled');}}:{});s.update({x:1,z:1});await tick();if(kind==='unknown')s.remove('0,0');else if(kind==='worker')f.workers.at(-1).onerror({message:'Tile worker cancelled'});else if(kind==='message')f.workers.at(-1).reply({error:'Tile worker cancelled'});await tick();const status=o.view.status();assert.equal(status.valid,false,kind);assert.ok(status.firstFailure.code);if(kind==='custom')assert.equal(status.firstFailure.code,'loader-error');if(kind==='unknown')assert.equal(status.firstFailure.code,'unknown-removal');const first=status.firstFailure;s.dispose();await tick();assert.deepEqual(o.view.status().firstFailure,first);}
});

test('late old callbacks invalidate diagnostics while preserving original native slot/Promise flow',async t=>{
 const f=fakeWorkers(t),o=observed(),s=stream(manifest(2),o.observer);s.update({x:1,z:1});await tick();const w=f.workers[0],old=w.onmessage,id=w.last.id;await complete(s,w);s.update({x:513,z:1});await tick();old({data:{id,packet:packet([0,0])}});assert.equal(o.view.status().firstFailure.code,'late-job-callback');assert.equal(s.pool.slots[0].busy,false);assert.equal(s.inflight,1);s.dispose();await tick(); // Original late callback behavior is observed, not repaired.
});

test('contexts stay charged through transport settle, warmup and active residency until actual removal',async()=>{
 const o=observed();let warm;const warming=new Promise(resolve=>{warm=resolve;}),s=stream(manifest(),o.observer,{load:async job=>packet(job.cell),adapter:{warmup:()=>warming}});s.update({x:1,z:1});await tick();await tick();assert.equal(s.inflight,0);assert.equal(s.tiles.get('0,0').state,'preparing');assert.equal(o.view.status().retainedContexts,1);warm();await tick();s.activateFrame();assert.equal(s.tiles.get('0,0').state,'active');assert.equal(o.view.status().retainedContexts,1);s.dispose();await tick();assert.equal(o.view.status().retainedContexts,0);
});

test('warmup and activation errors are distinct fatal producer failures',async()=>{
 for(const kind of ['warmup','activation']){const o=observed(),s=stream(manifest(),o.observer,{load:async job=>packet(job.cell),adapter:kind==='warmup'?{warmup:async()=>{throw Error('Tile worker cancelled');}}:{prepare(){throw Error('Tile worker cancelled');}}});s.update({x:1,z:1});await tick();await tick();s.activateFrame();assert.equal(o.view.status().firstFailure.code,kind+'-error');assert.equal(s.tiles.get('0,0').state,'failed');s.dispose();await tick();}
});

test('the seventeenth retained context invalidates diagnostics without hiding a native active tile',async()=>{
 const o=observed(),streams=[];for(let i=0;i<17;i++){const s=stream(manifest(),o.observer,{load:async job=>packet(job.cell)});streams.push(s);s.update({x:1,z:1});await tick();await tick();s.activateFrame();assert.equal(s.tiles.get('0,0').state,'active');if(i===15)assert.equal(o.view.status().retainedContexts,16);}assert.equal(o.view.status().firstFailure.code,'context-limit');for(const s of streams)s.dispose();await tick();
});

test('journal, retained-copy and read-count bounds fail before unbounded snapshot allocation',()=>{
 const setup=()=>{const o=observed(),s=openTileStreamObservation(o.observer,manifest(),'http://127.0.0.1/manifest.json'),p=openTilePoolObservation(s);return{...o,p};};
 const a=setup();for(let i=0;i<512;i++)observeTileIdleTerminate(a.p,'stream-dispose');assert.equal(a.view.status().events,512);observeTileIdleTerminate(a.p,'stream-dispose');assert.equal(a.view.status().firstFailure.code,'journal-limit');
 const b=setup();for(let i=0;i<512;i++)observeTileIdleTerminate(b.p,'stream-dispose');assert.equal(b.view.snapshot().valid,true);const failed=b.view.snapshot();assert.equal(failed.firstFailure.code,'retained-budget');assert.equal(b.view.snapshot(),failed);assert.ok(Object.isFrozen(failed.firstFailure));
 const c=observed();for(let i=0;i<64;i++)assert.equal(c.view.status().valid,true);assert.equal(c.view.status().firstFailure.code,'read-limit');const d=observed();for(let i=0;i<4;i++)assert.equal(d.view.snapshot().valid,true);assert.equal(d.view.snapshot().firstFailure.code,'read-limit');
});

test('duplicate settlement is recorded as invalid, never as new authoritative work',()=>{
 const o=observed(),m=manifest(),s=openTileStreamObservation(o.observer,m,'http://127.0.0.1/manifest.json'),j=observeTileAdmission(s,m.tiles['0,0'],'0,0','http://127.0.0.1'+m.tiles['0,0'].url,1,true);observeTilePoolSettle(j,false);observeTilePoolSettle(j,false);assert.equal(o.view.status().firstFailure.code,'duplicate-pool-settle');
});

test('unsupported URL strings fail before event/context retention without copying credentials or queries',async()=>{
 for(const suffix of ['?token=SECRET','#SECRET','/SECRET']){const o=observed(),m=manifest();m.tiles['0,0'].url+=suffix;const s=stream(m,o.observer,{load:async job=>packet(job.cell)});s.update({x:1,z:1});await tick();const status=o.view.status();assert.equal(status.firstFailure.code,'entry-identity');assert.equal(JSON.stringify(status).includes('SECRET'),false);assert.equal(s.tiles.get('0,0').state,'ready');s.dispose();await tick();}
 for(const raw of ['https://SECRET:SECRET@example.test/world/cells/'+hash(0)+'.bin.gz','x'.repeat(513)]){const o=observed(),m=manifest();m.tiles['0,0'].url=raw;const s=stream(m,o.observer,{load:async job=>packet(job.cell)});s.update({x:1,z:1});await tick();assert.equal(o.view.status().firstFailure.code,'entry-identity');assert.equal(JSON.stringify(o.view.status()).includes('SECRET'),false);s.dispose();await tick();}
});

test('observer clock exceptions and reentrancy invalidate only diagnostics, never native game flow',async()=>{
 const old=Object.getOwnPropertyDescriptor(globalThis,'performance');try{for(const reentrant of [false,true]){const o=observed();Object.defineProperty(globalThis,'performance',{configurable:true,value:{now(){if(reentrant){o.view.snapshot();return 1;}throw Error('observer only');}}});const s=stream(manifest(),o.observer,{load:async job=>packet(job.cell)});s.update({x:1,z:1});await tick();await tick();s.activateFrame();assert.equal(s.tiles.get('0,0').state,'active');assert.equal(s.metrics.failures,0);assert.equal(o.view.status().firstFailure.code,reentrant?'reentrant-observer':'observer-fault');s.dispose();await tick();}}finally{Object.defineProperty(globalThis,'performance',old);}
});

test('bootstrap installs the double-opt-in hook before free-entry replacement/import and preserves flags',async()=>{
 const main=await readFile(new URL('../src/main.js',import.meta.url),'utf8'),{freeRoamEntryQuery}=await import('../src/free-roam-entry.js');const block=main.slice(main.indexOf('export let gameReady;'),main.indexOf('}else{',main.indexOf('export let gameReady;'))+1).replace('export let','let');
 for(const flags of ['simhook&tileLifecycle=1','simhook','tileLifecycle=1','']){const target={},order=[],location={search:'?map=riviera&event=free&'+flags},run=new Function('createTileObservationForDebug','URLSearchParams','location','freeRoamEntryQuery','history','importWithUpdate',block+';return {gameReady,tileObserver};');const result=run(q=>{order.push('factory');return createTileObservationForDebug(q,target);},URLSearchParams,location,freeRoamEntryQuery,{replaceState(a,b,url){order.push('replace');assert.equal(new URLSearchParams(url.slice(1)).get('tileLifecycle'),new URLSearchParams(location.search).get('tileLifecycle'));assert.equal(new URLSearchParams(url.slice(1)).has('simhook'),new URLSearchParams(location.search).has('simhook'));}},()=>{order.push('import');return Promise.resolve({bootAthens({tileObserver}){order.push('boot');assert.equal(tileObserver,result.tileObserver);return tileObserver;}});});assert.deepEqual(order,flags==='simhook&tileLifecycle=1'?['factory','replace','import']:['replace','import']);await result.gameReady;assert.deepEqual(order,flags==='simhook&tileLifecycle=1'?['factory','replace','import','boot']:['replace','import','boot']);assert.equal(Object.hasOwn(target,'__tileLifecycle'),flags==='simhook&tileLifecycle=1');}
 const standalone=await readFile(new URL('../src/athens-world.js',import.meta.url),'utf8'),session=await readFile(new URL('../src/world-session.js',import.meta.url),'utf8');assert.match(standalone,/bootAthens\(\{tileObserver=null\}=\{\}\)/);assert.match(standalone,/createWorldSession\(\{tileObserver,/);assert.match(main,/createWorldSession\(\{tileObserver,/);assert.match(session,/signal,tileObserver=null/);assert.match(session,/new WorldTileStream\(manifest,\{[^\n]*observer:tileObserver,/);assert.equal(main.indexOf('const tileObserver=')<main.indexOf('const freeEntry='),true);
});


test('ignored wrong-job messages preserve busy slot and settle only the current real native job',async t=>{
 const f=fakeWorkers(t),o=observed(),s=stream(manifest(2),o.observer);s.update({x:1,z:1});await tick();const w=f.workers[0],oldId=w.last.id;await complete(s,w);s.update({x:513,z:1});await tick();assert.equal(w.last.id,oldId+1);
 w.onmessage({data:{id:oldId,packet:packet([0,0])}});assert.equal(o.view.status().firstFailure.code,'late-job-callback');assert.equal(s.pool.slots[0].busy,true);assert.equal(s.inflight,1);
 w.reply();await tick();await tick();s.activateFrame();assert.equal(s.tiles.get('1,0').state,'active');assert.equal(s.inflight,0);assert.equal(s.metrics.failures,0);s.dispose();await tick();
});

test('direct pump uses epoch zero and custom load receives only an opaque optional context',async()=>{
 const o=observed(),received=[],s=stream(manifest(),o.observer,{load:async(...args)=>{received.push(args);return packet(args[0].cell);}});s.wanted.set('0,0',0);s.pump();await tick();await tick();const snap=o.view.snapshot();assert.equal(snap.valid,true);const admission=snap.journal.find(e=>e.phase==='admit');assert.equal(admission.admittedInterestEpoch,0);assert.equal(admission.currentInterestEpoch,0);assert.equal(admission.transport,'custom');assert.equal(admission.poolJobSerial,null);assert.equal(received[0].length,3);assert.deepEqual(Object.keys(received[0][2]),[]);assert.ok(Object.isFrozen(received[0][2]));assert.equal(snap.journal.some(e=>e.phase==='worker-post'),false);s.update({x:1,z:1});s.update({x:1,z:1});const recalculated=o.view.snapshot();assert.equal(recalculated.contexts[0].admittedInterestEpoch,0);assert.equal(recalculated.contexts[0].currentInterestEpoch,2);assert.equal(s.generation,1);s.dispose();await tick();
 const calls=[],plain=stream(manifest(),null,{load:async(...args)=>{calls.push(args);return packet(args[0].cell);}});plain.update({x:1,z:1});await tick();assert.equal(calls[0].length,2);plain.dispose();await tick();
});


test('default native stream calls no producer factories and allocates no observer WeakMap/context',async t=>{
 const source=await readFile(new URL('../src/world-tile-stream.js',import.meta.url),'utf8'),names=source.match(/^import \{([^}]+)\}/)[1].split(',');
 const stub=names.map(n=>'export const '+n+'=()=>{globalThis.__tileObservationTestCalls++;throw Error("Unexpected observer call");};').join('\n');
 let rewritten=source.replace(/'\.\/world-tile-observation.js'/,JSON.stringify('data:text/javascript;base64,'+Buffer.from(stub).toString('base64')));
 for(const file of ['world-tile-format.js','world-tile-contact.js'])rewritten=rewritten.replaceAll("'./"+file+"'",JSON.stringify(new URL('../src/'+file,import.meta.url).href));
 rewritten=rewritten.replace("new URL('./world-tile-worker.js',import.meta.url)",'new URL('+JSON.stringify(new URL('../src/world-tile-worker.js',import.meta.url).href)+')');
 const {WorldTileStream:Native}=await import('data:text/javascript;base64,'+Buffer.from(rewritten).toString('base64')),old=globalThis.WeakMap,previous=Object.getOwnPropertyDescriptor(globalThis,'__tileObservationTestCalls');let maps=0;globalThis.__tileObservationTestCalls=0;globalThis.WeakMap=class extends old{constructor(...args){super(...args);maps++;}};
 const f=fakeWorkers(t);try{const s=new Native(manifest(),{baseURL:'http://127.0.0.1/',pinSpawn:false,nearRing:0});s.update({x:1,z:1});await tick();await complete(s,f.workers[0]);s.dispose();await tick();assert.equal(globalThis.__tileObservationTestCalls,0);assert.equal(maps,0);}finally{globalThis.WeakMap=old;if(previous)Object.defineProperty(globalThis,'__tileObservationTestCalls',previous);else delete globalThis.__tileObservationTestCalls;}
});


test('pool binding verifies the exact admitted native job before post, with no change to actual payload',async t=>{
 const f=fakeWorkers(t),o=observed(),m=manifest(),s=stream(m,o.observer);s.update({x:1,z:1});m.tiles['0,0'].sha256=hash(8);await tick();assert.equal(o.view.status().firstFailure.code,'pool-binding');assert.equal(f.posts[0].job.entry.sha256,hash(8));await complete(s,f.workers[0]);assert.equal(s.tiles.get('0,0').state,'active');s.dispose();await tick();
});

test('an unknown job in an observed native pool invalidates diagnostics rather than inventing identity',async t=>{
 const f=fakeWorkers(t),o=observed(),m=manifest(),s=stream(m,o.observer),entry=m.tiles['0,0'];const p=s.pool.load({url:'http://127.0.0.1:8123'+entry.url,entry,world:entry.source.world,revision:entry.source.revision,cell:[0,0]},new AbortController().signal);assert.equal(o.view.status().firstFailure.code,'unknown-job');f.workers[0].reply();assert.equal((await p).bytes,80);s.dispose();
});


test('standalone pool disposal and duplicate debug installation cannot be mistaken for known stream cancellation',async t=>{
 const f=fakeWorkers(t),o=observed(),s=stream(manifest(),o.observer);s.update({x:1,z:1});await tick();s.pool.dispose();await tick();assert.equal(o.view.status().firstFailure.code,'unclassified-worker-abort');assert.equal(s.metrics.failures,1);assert.equal(f.terminations.length,1);s.dispose();await tick();
 const target={},query=new URLSearchParams('simhook&tileLifecycle=1');createTileObservationForDebug(query,target);const original=target.__tileLifecycle;createTileObservationForDebug(query,target);assert.equal(target.__tileLifecycle,original);assert.equal(original.status().firstFailure.code,'duplicate-hook');assert.equal(original.snapshot().firstFailure.code,'duplicate-hook');
});
