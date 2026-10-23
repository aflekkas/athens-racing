import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {WorldTileStream} from '../src/world-tile-stream.js';
const source=await readFile(new URL('../src/athens-world.js',import.meta.url),'utf8');
const start=source.indexOf(' const spec=CARS.find'),end=source.indexOf(' stream.releaseSpawn();input.setCarSpec(spec);',start);
assert.ok(start>=0&&end>start);
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const initialise=new AsyncFunction('CARS','query','session','stream','roads','barriers','obstacles','AthensRoute','AthensGround','Vehicle','CarModel','scene','offGuidance','guidance','renderer',
 'let player=null,towing=false;\n'+source.slice(start,end)+'\nreturn {player,towing,directSpawn:typeof directSpawn===\'undefined\'?false:directSpawn,spawnAt};');
const laterStart=source.indexOf(" if(!directSpawn){const chosen="),laterEnd=source.indexOf(" if(guidance&&!query.has('spawn'))",laterStart);
const later=laterStart>=0?new AsyncFunction('query','guidance','DEMO_ROUTE','directSpawn','spawnAt',source.slice(laterStart,laterEnd)):null;
function fixture({search='spawn=8,8&car=bus',contactMissing=null,prepareError=null,constructionError=null,cleanupThrows=false,safe=true}={}){
 const calls=[],pose={x:8,y:0,z:8,yaw:0,edgeId:'street-edge',layer:0,surfaceId:'surface:street'},fallback={...pose,x:2568,z:2568},spec={id:'bus',width:2.5,length:12},hash='a'.repeat(64);
 const entry={url:'/world/cells/'+hash+'.bin.gz',sha256:hash,bytes:1,decodedBytes:100,triangles:0,dependencies:[]};
 const manifest={tileVersion:1,tileMetres:512,world:'athens',revision:'synthetic',projection:{lat0:37.98,lon0:23.73,mlat:111320,mlon:87700},spawn:{cell:[5,5],anchor:'default'},tiles:{'0,0':entry,'5,5':entry}};
 const stream=new WorldTileStream(manifest,{pinSpawn:false,nearRing:0,load:async()=>{throw Error('Unexpected synthetic body load');}});
 stream.tiles.set('0,0',{state:'active',reserved:0,bytes:0,controller:new AbortController(),packet:{metadata:{ids:['','street-edge','surface:street'],origin:[0,0,0]},tables:{edges:new Uint32Array([1,0,0,0,0,0,0,0,0,2]),edgeLayers:new Int8Array([0])}}});
 stream.contact=(x,z,options)=>{calls.push({kind:'contact',x,z,options});return contactMissing?.(x,z)?null:{y:0,layer:0,surfaceId:'surface:street'};};
 stream.spawn=async(move,options)=>{calls.push({kind:'default-spawn',options});await move(fallback);};
 const ground={begin(){calls.push({kind:'ground-begin'});},resolve(){calls.push({kind:'ground-resolve'});if(constructionError)throw constructionError;}},preparedRoute={project:()=>({s:0,u:0})};
 let pending=null;
 const session={route:null,ground:null,safePose:(p,footprint)=>{calls.push({kind:'safe',footprint});return safe;},async prepareSpawn(point,options){calls.push({kind:'prepare',point,options});if(pending)await pending;if(prepareError)throw prepareError;this.route=preparedRoute;this.ground=ground;return point.x===fallback.x?fallback:pose;},dispose(){calls.push({kind:'session-dispose'});stream.dispose();if(cleanupThrows)throw Error('cleanup');}};
 class AthensRoute{constructor(p){calls.push({kind:'default-route',p});}project(){return{s:0,u:0};}}
 class AthensGround{constructor(){calls.push({kind:'default-ground'});}begin(){}resolve(){if(constructionError)throw constructionError;}}
 class Vehicle{constructor(car,route){calls.push({kind:'vehicle',car,route});this.route=route;}reset(){}syncWheels(){calls.push({kind:'sync-wheels'});}}
 class CarModel{constructor(){calls.push({kind:'model'});this.root={removeFromParent(){calls.push({kind:'model-remove'});if(cleanupThrows)throw Error('cleanup');}};}}
 const scene={add(){calls.push({kind:'scene-add'});}},guidance={dispose(){calls.push({kind:'guidance-dispose'});}},renderer={dispose(){calls.push({kind:'renderer-dispose'});}},query=new URLSearchParams(search);
 return{calls,pose,fallback,spec,session,stream,query,preparedRoute,ground,guidance,run:()=>initialise([spec],query,session,stream,{}, {}, {},AthensRoute,AthensGround,Vehicle,CarModel,scene,()=>calls.push({kind:'unsubscribe'}),guidance,renderer),block(p){pending=p;}};
}

test('explicit destination prepares its validated road directly without admitting default spawn or constructing early',async()=>{
 const f=fixture();let release;f.block(new Promise(r=>{release=r;}));const pending=f.run();await Promise.resolve();assert.deepEqual(f.calls.map(c=>c.kind),['prepare']);assert.deepEqual(f.calls[0].point,{x:8,z:8});assert.equal(f.calls[0].options.car,f.spec);release();const result=await pending;
 assert.equal(result.directSpawn,true);assert.equal(result.player.veh.route,f.preparedRoute);assert.equal(result.player.veh.ground,f.ground);assert.equal(f.calls.some(c=>c.kind==='default-spawn'||c.kind==='default-route'||c.kind==='default-ground'),false);
 const contacts=f.calls.filter(c=>c.kind==='contact');assert.equal(new Set(contacts.map(c=>c.x+','+c.z)).size,9);assert.ok(contacts.every(c=>c.options.requiredFlags===1&&c.options.layer===0&&c.options.referenceY===0));assert.ok(f.calls.findIndex(c=>c.kind==='vehicle')>f.calls.findLastIndex(c=>c.kind==='contact'));
 assert.ok(f.calls.filter(c=>c.kind==='safe').every(c=>c.footprint.halfWidth===1.25&&c.footprint.halfLength===6));assert.equal(result.player.veh.x,8);assert.equal(result.player.veh.z,8);assert.equal(f.stream.pins.size,0);assert.equal(f.stream.tiles.has('5,5'),false);
 await later(f.query,f.guidance,[[30,0,40]],result.directSpawn,result.spawnAt);assert.equal(f.calls.filter(c=>c.kind==='prepare').length,1);f.session.dispose();
});

test('each of all nine actual native footprint contacts can veto player construction',async()=>{
 for(const x of [6.75,8,9.25])for(const z of [2,8,14]){const f=fixture({contactMissing:(px,pz)=>px===x&&pz===z});await assert.rejects(f.run(),/Route start footprint unavailable/);assert.equal(f.calls.some(c=>c.kind==='vehicle'||c.kind==='model'||c.kind==='scene-add'),false,`${x},${z}`);assert.equal(f.calls.filter(c=>c.kind==='session-dispose').length,1);assert.equal(f.calls.filter(c=>c.kind==='renderer-dispose').length,1);assert.equal(f.stream.pins.size,0);}
});

test('public road, layer and obstacle safety remains the native validation gate',async()=>{
 const f=fixture({safe:false});await assert.rejects(f.run(),/Route start footprint unavailable/);assert.equal(f.calls.some(c=>c.kind==='vehicle'),false);assert.equal(f.stream.pins.size,0);
 const g=fixture();g.stream.tiles.get('0,0').packet.tables.edgeLayers[0]=1;await assert.rejects(g.run(),/Route start edge unavailable/);assert.equal(g.calls.some(c=>c.kind==='vehicle'),false);assert.equal(g.stream.pins.size,0);
});

test('default and invalid explicit coordinates retain default spawn then native re-preparation order',async()=>{
 for(const search of ['car=bus','car=bus&spawn=not-a-coordinate','car=bus&spawn=no,8']){const f=fixture({search}),r=await f.run();assert.equal(r.directSpawn,false);assert.equal(f.calls[0].kind,'default-spawn');assert.equal(f.calls[0].options.timeoutMs,180000);assert.equal(f.calls[0].options.halfWidth,1.25);assert.equal(f.calls[0].options.halfLength,6);assert.equal(f.calls.filter(c=>c.kind==='prepare').length,1);assert.deepEqual(f.calls.find(c=>c.kind==='prepare').point,{x:f.fallback.x,z:f.fallback.z});assert.equal(f.calls.filter(c=>c.kind==='vehicle').length,1);assert.equal(r.player.veh.route,f.preparedRoute);f.session.dispose();}
});

test('guidance without an explicit destination keeps its prior later demo selection',async()=>{
 const f=fixture({search:'car=bus&guidance=1'}),r=await f.run();await later(f.query,f.guidance,[[30,0,40]],r.directSpawn,r.spawnAt);assert.deepEqual(f.calls.filter(c=>c.kind==='prepare').map(c=>c.point),[{x:f.fallback.x,z:f.fallback.z},{x:30,z:40}]);f.session.dispose();
});

test('preparation and construction errors keep their original cause while every owned cleanup is attempted',async()=>{
 const first=Error('original selection failure'),a=fixture({prepareError:first,cleanupThrows:true});await assert.rejects(a.run(),e=>e===first);assert.equal(a.calls.some(c=>c.kind==='default-spawn'||c.kind==='vehicle'),false);for(const kind of ['unsubscribe','guidance-dispose','session-dispose','renderer-dispose'])assert.equal(a.calls.filter(c=>c.kind===kind).length,1);
 const second=Error('original ground failure'),b=fixture({constructionError:second,cleanupThrows:true});await assert.rejects(b.run(),e=>e===second);assert.equal(b.calls.filter(c=>c.kind==='model-remove').length,1);assert.equal(b.calls.filter(c=>c.kind==='renderer-dispose').length,1);assert.equal(b.stream.pins.size,0);
});
