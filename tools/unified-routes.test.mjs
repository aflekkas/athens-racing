import test from 'node:test';import assert from 'node:assert/strict';import {loadUnifiedRoute} from '../src/unified-routes.js';import {unifiedRouteConfig} from '../server/route-definitions.mjs';
test('route flags default off and a query cannot enable a disabled or unknown route',async()=>{assert.deepEqual(unifiedRouteConfig().routes,[]);assert.equal(await loadUnifiedRoute(new URLSearchParams(),{fetcher:()=>{throw Error('unexpected download');}}),null);for(const config of [{environment:'unknown',routes:[{id:'syntagma-pilot'}]},{environment:'staging',routes:[]}])await assert.rejects(loadUnifiedRoute(new URLSearchParams('routes=1'),{fetcher:async()=>({ok:true,json:async()=>config})}),/unavailable/);assert.deepEqual(unifiedRouteConfig({environment:'production',enabled:'',routes:[{id:'syntagma-pilot'}]}).routes,[]);});
test('the backend tuple must match the downloaded immutable route',async()=>{let calls=0;const entry={id:'syntagma-pilot',routeHash:'a'.repeat(64),geometryHash:'b'.repeat(64),worldSetRevision:'c'.repeat(64),url:'/data/routes/pilot.json'};await assert.rejects(loadUnifiedRoute(new URLSearchParams('routes=1'),{fetcher:async()=>({ok:true,json:async()=>++calls===1?{environment:'staging',routes:[entry]}:{...entry,worldSetRevision:'d'.repeat(64)}})}),/mismatch/);});
test('the generated picker includes newly authored enabled entries and rejects tuple drift',async()=>{const {enabledRouteCatalogue}=await import('../src/unified-routes.js'),base={routeHash:'a'.repeat(64),geometryHash:'b'.repeat(64),worldSetRevision:'c'.repeat(64)},one={...base,id:'syntagma-pilot',url:'/one.json',name:'SYNTAGMA'},two={...base,id:'new-json-file',url:'/two.json',name:'A NEW ROUTE'},index={schemaVersion:1,routes:[one,two]};assert.deepEqual(enabledRouteCatalogue({environment:'staging',routes:[one,two]},index).map(r=>r.name),['SYNTAGMA','A NEW ROUTE']);assert.throws(()=>enabledRouteCatalogue({environment:'staging',routes:[{...two,routeHash:'f'.repeat(64)}]},index),/mismatch/);});
test('resident artifacts skip repeat transfer but refresh authorization and invalidate on release changes',async()=>{
 let entry={id:'pilot',routeHash:'a',geometryHash:'b',worldSetRevision:'c',url:'/route.json'},enabled=true,configReads=0,artifactReads=0;
 const fetcher=async url=>({ok:true,json:async()=>{if(url==='/api/routes'){configReads++;return {environment:'staging',routes:enabled?[entry]:[]};}artifactReads++;return {...entry};}}),query=new URLSearchParams('routes=1&route=pilot');
 const first=await loadUnifiedRoute(query,{fetcher});assert.equal(await loadUnifiedRoute(query,{fetcher}),first);assert.equal(configReads,2);assert.equal(artifactReads,1);
 entry={...entry,routeHash:'new',worldSetRevision:'next'};assert.notEqual(await loadUnifiedRoute(query,{fetcher}),first);assert.equal(artifactReads,2);
 enabled=false;await assert.rejects(loadUnifiedRoute(query,{fetcher}),/unavailable/);assert.equal(artifactReads,2);
});

for(const environment of ['staging','production'])test(`explicitly enabled ${environment} routes retain opt-in and release binding`,async()=>{
 const entry={id:'syntagma-pilot',routeHash:'a',geometryHash:'b',worldSetRevision:'c',url:'/data/routes/pilot.json'};
 const config=unifiedRouteConfig({environment,enabled:entry.id,routes:[entry,{...entry,id:'disabled'}]});
 config.routes[0].url=entry.url;assert.equal(config.routes.length,1);assert.equal(config.online,false);assert.equal(config.world,false);
 const fetcher=async url=>({ok:true,json:async()=>url==='/api/routes'?config:entry});
 assert.equal(await loadUnifiedRoute(new URLSearchParams(),{fetcher}),null);
 assert.equal((await loadUnifiedRoute(new URLSearchParams('routes=1&route=syntagma-pilot'),{fetcher})).routeHash,entry.routeHash);
 await assert.rejects(loadUnifiedRoute(new URLSearchParams('routes=1&route=disabled'),{fetcher}),/not enabled/);
});

test('normal Quick Race opens the map with enabled routes without URL parameters',async()=>{
 const {Menu}=await import('../src/menu.js');
 const priorDocument=globalThis.document,priorWindow=globalThis.window,priorFetch=globalThis.fetch;
 globalThis.document={baseURI:'http://localhost/',querySelector:()=>null,querySelectorAll:()=>[],addEventListener(){},body:{classList:{contains:()=>false}}};globalThis.window={addEventListener(){}};
 try {
  const entry={id:'psychiko-faros',name:'FAROS',lengthM:1200,preview:[[0,0],[100,100]],events:[{id:'faros-race',laps:3,rivals:5}],routeHash:'a',geometryHash:'b',worldSetRevision:'c',url:'/faros.json'};
  const reads=[];
  globalThis.fetch=async url=>{reads.push(url);return{ok:true,json:async()=>url==='/api/routes'?{environment:'production',routes:[entry]}:{schemaVersion:1,routes:[entry]}};};
  const menu={screen:'mode',data:{},show(screen,data,push){Object.assign(this,{screen,data,push});}};
  await Menu.prototype.openQuickRace.call(menu);
  assert.equal(menu.screen,'maps');assert.equal(menu.push,true);assert.deepEqual(menu.data.catalogue,[entry]);
  assert.deepEqual(reads,['/api/routes','/data/routes/index.json']);
  globalThis.document.getElementById=()=>({}); const html=Menu.prototype.r_routes.call(menu,menu.data);
  assert.match(html,/data-map-id="psychiko-faros"/);assert.doesNotMatch(html,/classicTracks/);
  // Navigating away while the catalogue loads must not reopen the picker.
  let finish;globalThis.fetch=()=>new Promise(resolve=>{finish=resolve;});
  menu.screen='mode';menu.data={};const pending=Menu.prototype.openQuickRace.call(menu);menu.screen='title';
  finish({ok:true,json:async()=>({environment:'production',routes:[]})});await pending;assert.equal(menu.screen,'title');
  // A development release with no enabled routes keeps its original picker.
  globalThis.fetch=async()=>({ok:true,json:async()=>({environment:'production',routes:[]})});menu.screen='mode';
  await Menu.prototype.openQuickRace.call(menu);assert.equal(menu.screen,'maps');assert.equal(menu.data.mode,'quick');
 } finally {globalThis.document=priorDocument;globalThis.window=priorWindow;globalThis.fetch=priorFetch;}
});

test('compatibility race URLs resolve only enabled Athens routes, including descent and future catalogue ids',async()=>{
 const {loadRaceRoute,raceRouteQuery}=await import('../src/unified-routes.js');
 const entries=['riviera-coast','psychiko-faros','penteli-hill','penteli-descent','megara-club','kifissia-kefalari'].map(id=>({id,routeHash:id,geometryHash:'geometry-'+id,worldSetRevision:'release',url:'/'+id+'.json'}));
 const reads=[],fetcher=async url=>{reads.push(url);return {ok:true,json:async()=>url==='/api/routes'?{environment:'production',routes:entries}:entries.find(e=>e.url===url)};};
 for(const [mapId,id]of Object.entries({riviera:'riviera-coast',psychiko:'psychiko-faros',penteli:'penteli-hill',megara:'megara-club'}))assert.equal((await loadRaceRoute({mapId},{fetcher})).id,id);
 assert.equal((await loadRaceRoute({mapId:'penteli',eventId:'penteli-descent-tt'},{fetcher})).id,'penteli-descent');
 assert.equal((await loadRaceRoute({routeId:'kifissia-kefalari'},{fetcher})).id,'kifissia-kefalari');
 assert.equal(raceRouteQuery({routeId:'future-route'}).get('route'),'future-route');
 await assert.rejects(loadRaceRoute({routeId:'disabled-route'},{fetcher}),/not enabled/);
 assert.ok(reads.every(url=>!url.includes('/data/maps/')&&!url.includes('/data/map.json')),'race resolution never downloads authored whole-map inputs');
});

test('all compatibility free-roam launches enter one Athens world with geographic spawn preserved',async()=>{
 const {freeRoamEntryQuery}=await import('../src/free-roam-entry.js'),{MAP_PROJECTIONS,athensFromLonLat}=await import('../src/spawn-spots.js');
 for(const [mapId,p]of Object.entries(MAP_PROJECTIONS)){
  const q=freeRoamEntryQuery(new URLSearchParams(`map=${mapId}&event=free&spawn=120,-80&car=mini&guest=1&route=old&routeEvent=old&setup=1&s=500`));
  assert.equal(q.get('map'),'athens');assert.equal(q.get('car'),'mini');assert.equal(q.get('guest'),'1');
  const expected=athensFromLonLat(p.lon0+120/p.mlon,p.lat0+80/p.mlat),actual=q.get('spawn').split(',').map(Number);
  assert.ok(Math.hypot(actual[0]-expected[0],actual[1]-expected[1])<.08,mapId);
  for(const key of ['event','route','routeEvent','routes','setup','menu','s'])assert.equal(q.has(key),false,key);
  const named=freeRoamEntryQuery(new URLSearchParams(`map=${mapId}&event=free`));assert.equal(named.get('spawn').split(',').length,2);
 }
 const selected=freeRoamEntryQuery(new URLSearchParams('menu=1&routes=1&route=old'),{type:'free',mapId:'athens',spawn:{x:123,z:-456,name:'MY STREET'}});
 assert.equal(selected.get('spawn'),'123,-456');assert.equal(selected.get('spawnArea'),'MY STREET');assert.equal(selected.has('menu'),false);
 for(const query of ['menu=1&map=athens','routes=1&map=athens','map=megara&event=megara-race',''])assert.equal(freeRoamEntryQuery(new URLSearchParams(query)),null,query);
 assert.throws(()=>freeRoamEntryQuery(new URLSearchParams('event=free&map=unknown')),/unavailable/);
});

async function certifiedGridFixture(){
 const {onlineGridHash}=await import('../src/online-grid.js');
 const compiled={id:'test-grid',routeHash:'a'.repeat(64),geometryHash:'b'.repeat(64),worldSetRevision:'c'.repeat(64),startPose:{x:0,y:0,z:0},runIn:[[0,0,80],[0,0,0]]};
 const body={schemaVersion:1,projectionId:'athens-v1',routeId:compiled.id,routeHash:compiled.routeHash,geometryHash:compiled.geometryHash,worldSetRevision:compiled.worldSetRevision,capacity:8,footprint:{halfWidth:1.3,halfLength:6,clearanceM:.2},poses:Array.from({length:8},(_,slot)=>({slot,s:-8-13*slot,x:0,y:0,z:8+13*slot,yaw:0,edgeId:'approach',layer:0,surfaceId:'asphalt'})),approach:{points:[[0,0,120,-120,5,5],[0,0,0,0,5,5]],occurrences:[{edgeId:'approach',layer:0,surfaceId:'asphalt',s0:-120,s1:0}]}};
 return {compiled,body,expectedHash:await onlineGridHash(body)};
}
test('separate grid authentication preserves competitive geometry and supports eight full-length buses',async()=>{
 const {validateOnlineGrid,onlineGridPose}=await import('../src/online-grid.js'),{compiled,body,expectedHash}=await certifiedGridFixture(),original=JSON.stringify(compiled);
 const grid=await validateOnlineGrid(body,compiled,{expectedHash,car:{width:2.55,length:12}});
 assert.equal(grid,body);assert.ok(Object.isFrozen(grid.poses[0]));assert.equal(JSON.stringify(compiled),original);
 for(let slot=0;slot<8;slot++)assert.equal(onlineGridPose(grid,slot,{width:2.55,length:12}).slot,slot);
 for(const slot of [-1,8,1.5,NaN])assert.throws(()=>onlineGridPose(grid,slot),/unavailable/);
 assert.throws(()=>onlineGridPose(grid,0,{width:2.55,length:12.5}),/footprint/);
});
test('grid hash, tuple, slots, approach and clearance all fail closed independently',async()=>{
 const {validateOnlineGrid,onlineGridHash}=await import('../src/online-grid.js'),f=await certifiedGridFixture();
 await assert.rejects(validateOnlineGrid(f.body,f.compiled,{expectedHash:'f'.repeat(64)}),/mismatch/);
 await assert.rejects(validateOnlineGrid(f.body,f.compiled),/mismatch/);
 for(const mutate of [b=>{b.routeHash='d'.repeat(64);},b=>{b.worldSetRevision='d'.repeat(64);},b=>{b.capacity=3;},b=>{b.poses[7].slot=6;},b=>{b.poses[7].z=b.poses[6].z;},b=>{b.footprint.clearanceM=0;},b=>{b.approach.points[1][0]=1;},b=>{b.approach.points[0][3]=-119;},b=>{b.poses[0].layer=.5;},b=>{b.poses[0].yaw=Infinity;},b=>{b.clientGeometry=[];}]){
  const body=structuredClone(f.body);mutate(body);
  let hash;try{hash=await onlineGridHash(body);}catch{continue;}
  await assert.rejects(validateOnlineGrid(body,f.compiled,{expectedHash:hash}),/unavailable|mismatch/);
 }
});

test('recovery registry rejects omitted, substituted and mixed-world cells including empty cells',async()=>{
 const {recoveryWorldRegistry,assertRecoveryCoverage}=await import('./build-world-recovery.mjs');
 const manifest={revision:'a'.repeat(64),tiles:{'0,0':{sha256:'b'.repeat(64)},'1,0':{sha256:'c'.repeat(64)}}},registry=recoveryWorldRegistry(manifest),root={worldSetRevision:manifest.revision,cells:{'0,0':{sourceHash:'b'.repeat(64),hash:'d'.repeat(64)},'1,0':{sourceHash:'c'.repeat(64),empty:true}}};
 assert.doesNotThrow(()=>assertRecoveryCoverage(root,registry));
 for(const edit of [r=>delete r.cells['1,0'],r=>r.cells['1,0'].sourceHash='f'.repeat(64),r=>r.cells['2,0']={sourceHash:'e'.repeat(64),empty:true},r=>r.worldSetRevision='e'.repeat(64)]){const bad=structuredClone(root);edit(bad);assert.throws(()=>assertRecoveryCoverage(bad,registry),/complete active world/);}
 assert.throws(()=>recoveryWorldRegistry({...manifest,tiles:{'bad':manifest.tiles['0,0']}}),/Invalid recovery source/);
});
test('recovery certificates preserve incomparable vehicle envelopes without combining dimensions',async()=>{
 const {paretoFootprints}=await import('./build-world-recovery.mjs'),wide={halfWidth:1.5,halfLength:2},long={halfWidth:1,halfLength:6};
 assert.deepEqual(paretoFootprints([wide,long,{halfWidth:.8,halfLength:1},wide]),[long,wide]);
 assert.equal(paretoFootprints([wide,long]).some(p=>p.halfWidth>=1.4&&p.halfLength>=5),false);
});
test('recovery survey certifies each vehicle against actual contact safety and fails closed on unsurveyable roads',async()=>{
 const {proveRecoveryCell}=await import('./build-world-recovery.mjs');
 const edge={id:'test-road',from:'n0',to:'n1',flags:1,layer:0,surface:'surface:road',points:[[20,0,20],[60,0,20]]},packet={roadGraph:{edges:[edge]}},small={halfWidth:1,halfLength:2},bus={halfWidth:1.3,halfLength:6},calls=[];
 const graph={edges:new Map([[edge.id,{value:edge}]]),outgoing:new Map()},world={tiles:new Map([['0,0',{packet}]]),manifest:{revision:'a'.repeat(64),tiles:{'0,0':{sha256:'b'.repeat(64)}}},roads:{graph},contacts:{contact:()=>({y:0,layer:0,surfaceId:edge.surface}),width:()=>({left:3,right:3}),safe:(p,o)=>{calls.push(o);return o.halfLength<=2;}}};
 const body=proveRecoveryCell('0,0',world,[small,bus]);assert.equal(body.anchors.length,11);assert.equal(body.edges.length,1);assert.deepEqual(body.sourceHashes,[['0,0','b'.repeat(64)]]);
 for(const a of body.anchors)assert.deepEqual(a.footprints,[small]);assert.ok(calls.some(p=>p.halfLength===6));
 world.contacts.safe=()=>false;assert.throws(()=>proveRecoveryCell('0,0',world,[small,bus]),/roads but no certified/);
 const stages=[];world.contacts.contact=()=>null;assert.throws(()=>proveRecoveryCell('0,0',world,[small],{onSample:r=>stages.push(r)}),/roads but no certified/);assert.equal(stages.filter(r=>r.stage==='sample').length,11);assert.equal(stages.filter(r=>r.stage==='noContact').length,11);assert.ok(stages.every(r=>r.edgeId==='test-road'));
 world.contacts.contact=()=>({y:0,layer:0,surfaceId:'wrong-surface'});stages.length=0;assert.throws(()=>proveRecoveryCell('0,0',world,[small],{onSample:r=>stages.push(r)}),/roads but no certified/);assert.equal(stages.filter(r=>r.stage==='surfaceMismatch').length,11);assert.ok(stages.filter(r=>r.stage==='surfaceMismatch').every(r=>r.contact.surfaceId==='wrong-surface'));
 packet.roadGraph.edges=[];assert.equal(proveRecoveryCell('0,0',world,[small]),null);
 assert.throws(()=>proveRecoveryCell('0,0',world,[small],{spacingM:8}),/at most four/);
});

async function networkReleaseFixture(){
 const f=await certifiedGridFixture();Object.assign(f.compiled,{schemaVersion:1,worldId:'athens',lengthM:100,definition:{kind:'sprint',name:'TEST GRID'},points:[[0,0,0,0,5,5],[0,0,-100,100,5,5]],occurrences:[{edgeId:'course',layer:0,surfaceId:'asphalt',s0:0,s1:100}],grid:f.body.poses.slice(0,3)});
 const {routeNetworkIdentity}=await import('../src/route-network.js'),{sha256}=await import('../src/route-definition.js');const identity=routeNetworkIdentity(f.compiled,f.expectedHash),onlineGrid={schemaVersion:1,capacity:8,hash:f.expectedHash,url:`/data/routes/${f.compiled.id}.online-grid.${f.expectedHash}.json`},entry={id:f.compiled.id,routeHash:f.compiled.routeHash,geometryHash:f.compiled.geometryHash,worldSetRevision:f.compiled.worldSetRevision,url:`/data/routes/${f.compiled.id}.${f.compiled.routeHash}.json`,onlineGrid},lobby={mapId:f.compiled.id,routeIdentity:identity,track:{routeIdentity:identity,version:`${f.compiled.routeHash}:${f.expectedHash}`},players:f.body.poses.map((gridPose,id)=>({id:String(id),gridSlot:id,gridPose}))},manifest={revision:f.compiled.worldSetRevision,tiles:{'0,0':{sha256:'d'.repeat(64)}}},root={schemaVersion:1,worldId:'athens',projectionId:'athens-v1',worldSetRevision:manifest.revision,footprints:[{halfWidth:1.3,halfLength:6}],cells:{'0,0':{sourceHash:'d'.repeat(64),empty:true}}},rootHash=await sha256(root),recovery={schemaVersion:1,streamed:true,hash:rootHash,url:`/world/recovery/manifest.${rootHash}.json`};
 const proof={schemaVersion:1,recoveryWorld:{worldSetRevision:manifest.revision,sourceHashes:[['0,0','d'.repeat(64)]]},routeRoads:[{hash:rootHash,body:root}],routeGrids:[{hash:f.expectedHash,body:f.body}],routes:[{id:f.compiled.id,routeHash:f.compiled.routeHash,onlineGrid,recovery}]};
 return {...f,entry,lobby,manifest,proof,config:{environment:'staging',online:true,routes:[entry]}};
}
test('client network entry authenticates exact geometry and all eight individually assigned poses',async()=>{
 const {loadNetworkRoute,assignedNetworkPose}=await import('../src/network-route-client.js'),f=await networkReleaseFixture(),reads=[],fetcher=async url=>{reads.push(url);return {ok:true,json:async()=>url==='/api/routes'?f.config:url===f.entry.url?f.compiled:f.body};};
 const result=await loadNetworkRoute(f.lobby,{fetcher,car:{width:2.55,length:12}});assert.equal(result.runtime.compiled,f.compiled);assert.equal(result.onlineGrid,f.body);assert.equal(result.runtime.frame(-99).z,99);assert.equal(assignedNetworkPose(f.lobby,result.onlineGrid,f.lobby.players[7]).s,-99);assert.equal(reads.length,3);assert.ok(reads.every(url=>!url.includes('/data/maps/')));
});
test('client rejects disabled/stale route, spoofed grid pose, duplicate slots and mixed reconnect identity',async()=>{
 const {loadNetworkRoute}=await import('../src/network-route-client.js');
 for(const mutate of [f=>f.config.online=false,f=>f.config.routes=[],f=>f.entry.onlineGrid.hash='e'.repeat(64),f=>f.lobby.players[7].gridPose={...f.lobby.players[7].gridPose,yaw:1},f=>f.lobby.players[7].gridSlot=6,f=>f.lobby.routeIdentity={...f.lobby.routeIdentity,worldSetRevision:'e'.repeat(64)},f=>f.compiled.geometryHash='e'.repeat(64)]){
  const f=await networkReleaseFixture();mutate(f);const fetcher=async url=>({ok:true,json:async()=>url==='/api/routes'?f.config:url===f.entry.url?f.compiled:f.body});await assert.rejects(loadNetworkRoute(f.lobby,{fetcher}),/release|capacity|pose|slot/);
 }
});
test('build package binds the full active world, every grid and one shared recovery root before online enable',async()=>{
 const {validateOnlineRouteRelease,bindOnlineRouteRelease}=await import('./online-route-release.mjs'),f=await networkReleaseFixture();
 const release=await validateOnlineRouteRelease(f.proof,{compiled:[f.compiled],manifest:f.manifest});assert.equal(bindOnlineRouteRelease(f.config,release).online,false);assert.equal(bindOnlineRouteRelease(f.config,release,{enable:true}).online,true);assert.throws(()=>bindOnlineRouteRelease(f.config,null,{enable:true}),/unavailable/);
 for(const mutate of [p=>p.recoveryWorld.sourceHashes=[],p=>p.routeGrids=[],p=>p.routes[0].routeHash='f'.repeat(64),p=>p.routes[0].recovery.hash='f'.repeat(64),p=>p.routeRoads[0].body.cells['1,0']={sourceHash:'e'.repeat(64),empty:true}]){const proof=structuredClone(f.proof);mutate(proof);await assert.rejects(validateOnlineRouteRelease(proof,{compiled:[f.compiled],manifest:f.manifest}),/Incomplete|mismatch|manifest/);}
 await assert.rejects(validateOnlineRouteRelease(f.proof,{compiled:[f.compiled],manifest:{...f.manifest,tiles:{...f.manifest.tiles,'1,0':{sha256:'e'.repeat(64)}}}}),/active world/);
});

test('desktop direct race metadata overlaps chunk startup while idle menu/free/lobby performs no prefetch',async()=>{
 const {prefetchDirectRace}=await import('../src/route-entry-prefetch.js');let routeReads=0,worldReads=0;const entry={id:'megara-club',routeHash:'a',geometryHash:'b',worldSetRevision:'c',url:'/route.json'},fetcher=async url=>{routeReads++;return{ok:true,json:async()=>url==='/api/routes'?{environment:'staging',routes:[entry]}:entry};},worldLoader=async()=>{worldReads++;return{manifest:{revision:'c'}};};
 for(const query of ['menu=1&map=megara','map=athens','event=free','event=free:penteli','lobby=ABCDEF','map=megara',''])assert.equal(prefetchDirectRace(new URLSearchParams(query),{fetcher,worldLoader}),null,query);
 assert.equal(routeReads,0);assert.equal(worldReads,0);const early=prefetchDirectRace(new URLSearchParams('map=megara&event=megara-race'),{fetcher,worldLoader,baseURL:'https://game.test/'});assert.equal(routeReads,1);assert.equal(worldReads,1);assert.equal((await early.route).id,'megara-club');assert.equal((await early.world).manifest.revision,'c');assert.equal(early.manifestURL,'https://game.test/data/athens/manifest.json');
 const {freeRoamEntryQuery}=await import('../src/free-roam-entry.js');assert.equal(freeRoamEntryQuery(new URLSearchParams('event=free:penteli')).get('map'),'athens');
});

test('native and exported recovery prefer remembered travel direction over a closer opposite lane',async()=>{
 const {worldTowCandidates}=await import('../src/world-recovery.js'),{proveRecoveryCell}=await import('./build-world-recovery.mjs'),{planWorldTow}=await import('../src/tow-placement.js'),{recoveryRoadGroup}=await import('../src/world-road-group.js');
 const forward={id:'forward',from:'a',to:'b',flags:0,layer:0,surface:'asphalt',points:[[20,0,60],[20,0,20]]},reverse={...forward,id:'reverse',from:'b',to:'a',points:[...forward.points].reverse()},graph={edges:new Map([[forward.id,{value:forward}],[reverse.id,{value:reverse}]]),outgoing:new Map([['a',new Set(['forward'])],['b',new Set(['reverse'])]])},contact=()=>({y:0,layer:0,surfaceId:'asphalt'}),roads={graph,width:()=>({left:4,right:4,width:8})},packet={roadGraph:{edges:[forward,reverse]}},world={manifest:{revision:'a'.repeat(64),tiles:{'0,0':{sha256:'b'.repeat(64)}}},tiles:new Map([['0,0',{packet}]]),roads,stream:{contact},safePose:()=>true,contacts:{contact,width:roads.width,safe:()=>true}},pose={x:18,y:0,z:40,yaw:0,towHeading:0,s:0};
 const native=worldTowCandidates(world,pose,{halfWidth:1,halfLength:2}),body=proveRecoveryCell('0,0',world,[{halfWidth:1,halfLength:2}]),select=candidates=>planWorldTow({pose,route:null,roadCandidates:candidates});
 assert.ok(body.anchors.some(p=>p.edgeId==='reverse'&&Math.hypot(p.x-pose.x,p.z-pose.z)<.01),'opposite lane is physically closer');assert.equal(select(native).edgeId,'forward');assert.equal(select(body.anchors).edgeId,'forward');assert.deepEqual(select(body.anchors).roadId,'forward|reverse');assert.deepEqual(body.edges.map(e=>e.id),['forward','reverse']);
 const extra={...reverse,id:'aaa-reverse'};graph.edges.set(extra.id,{value:extra});graph.outgoing.get('b').add(extra.id);assert.equal(recoveryRoadGroup(graph,forward).twinId,'aaa-reverse');graph.outgoing.set('b',new Set(['aaa-reverse','reverse']));assert.equal(recoveryRoadGroup(graph,forward).twinId,'aaa-reverse');
 const complete=proveRecoveryCell('0,0',world,[{halfWidth:1,halfLength:2}]);assert.deepEqual(complete.edges.map(e=>e.id),['aaa-reverse','forward','reverse']);assert.ok(complete.anchors.filter(a=>a.edgeId==='forward').every(a=>a.roadId==='aaa-reverse|forward'));
 const loop={...forward,id:'loop',from:'self',to:'self'};assert.equal(recoveryRoadGroup({edges:new Map([['loop',{value:loop}]]),outgoing:new Map([['self',new Set(['loop'])]])},loop),null);assert.equal(recoveryRoadGroup(graph,{...forward,from:''}),null);
});
test('layered offline caches read unchanged cells without copying and fail closed on corrupt higher-priority bytes',async()=>{
 const fs=await import('node:fs/promises'),{resolve}=await import('node:path'),{createHash}=await import('node:crypto'),{readEmittedCellBytes}=await import('./emitted-route-world.mjs'),directory=await fs.mkdtemp(resolve(import.meta.dirname,'fixtures/.cache-layer-test-'));
 try{const derived=resolve(directory,'derived'),original=resolve(directory,'original');await fs.mkdir(derived);await fs.mkdir(original);const bytes=Buffer.from('hash verified emitted bytes'),sha256=createHash('sha256').update(bytes).digest('hex'),entry={sha256,bytes:bytes.length,url:'https://world.test/world/cells/'+sha256+'.bin.gz'},name=sha256+'.bin.gz';await fs.writeFile(resolve(original,name),bytes);
 assert.deepEqual(await readEmittedCellBytes(entry,{cells:[derived,original]}),bytes);assert.deepEqual(await fs.readdir(derived),[]);assert.deepEqual(await readEmittedCellBytes({...entry,url:'cells/'+name},{cells:derived+':'+original}),bytes);
 await fs.writeFile(resolve(derived,name),'corrupt');await assert.rejects(readEmittedCellBytes(entry,{cells:[derived,original]}),/hash mismatch/);assert.deepEqual(await fs.readFile(resolve(original,name)),bytes);
 await fs.rm(resolve(derived,name));await fs.rm(resolve(original,name));assert.equal(await readEmittedCellBytes(entry,{cells:[derived,original]}),null);
 }finally{await fs.rm(directory,{recursive:true,force:true});}
});


test('online sprint and TT finishes never read or write solo PB/event/ghost stores', async () => {
 const {readFile}=await import('node:fs/promises'),{runInNewContext}=await import('node:vm');
 const main=await readFile(new URL('../src/main.js',import.meta.url),'utf8');
 const code=main.slice(main.indexOf('function rememberResult(res)'),main.indexOf('async function shareResult()'));
 for(const type of ['sprint','timetrial']) {
  let writes=0,reads=0;
  const G={ev:{def:{type}},result:null,autodrive:false},multiplayer={active:true,me:{finish:61.5,dnf:false},lobby:{raceId:'online-'+type}};
  const ctx={G,multiplayer,player:{spec:{name:'MINI'}},Q:new URLSearchParams(),bestSetup(){reads++;throw Error('solo setup read');},recordPersonalBest(){writes++;throw Error('solo write');}};
  runInNewContext(code+';onlinePersonalResult();onlinePersonalResult();',ctx);
  assert.equal(reads,0);assert.equal(writes,0);assert.equal(G.result.source,'online');assert.equal(G.result.time,61.5);assert.equal(G.result.personalBest,null);assert.equal(G.result.valid,true);assert.equal(G.resultPhotoPending,true);
  // Delayed result handling after leaving a lobby must still retain its source.
  multiplayer.active=false;runInNewContext(code+';rememberResult(G.result);',ctx);assert.equal(reads,0);assert.equal(writes,0);
 }
 const G={bestSetup:{key:'solo'},bestSetupChanged:false},res={valid:true,time:62};let recorded=0;
 runInNewContext(code+';rememberResult(res);',{G,res,multiplayer:{active:false},Q:new URLSearchParams(),bestSetup:()=>G.bestSetup,exactBestKey:s=>s.key,recordPersonalBest(s,r){recorded++;assert.equal(r.valid,true);return {newBest:true};}});
 assert.equal(recorded,1);assert.equal(res.personalBest.newBest,true);
});


test('export admission checks original wire bytes, server budgets and every neighbor source hash',async()=>{
 const {admitRecoveryCell}=await import('./build-world-recovery.mjs'),{canonicalJSON,sha256}=await import('../src/route-definition.js');
 const revision='a'.repeat(64),source='b'.repeat(64),edge={id:'lane',from:'a',to:'b',flags:1,layer:0,surface:'asphalt',points:[[0,0,0],[0,0,40]]};
 const anchor={edgeId:'lane',offsetM:20,x:0,y:0,z:20,yaw:-Math.PI,layer:0,surfaceId:'asphalt',leftM:4,rightM:4,halfWidth:1,halfLength:2,footprints:[{halfWidth:1,halfLength:2}]};
 const body={schemaVersion:1,worldId:'athens',projectionId:'athens-v1',worldSetRevision:revision,sourceHashes:[['0,0',source]],edges:[edge],anchors:[anchor]},manifest={revision,tiles:{'0,0':{sha256:source}}},hash=await sha256(body),raw=canonicalJSON(body);
 const metrics=await admitRecoveryCell(raw,{key:'0,0',manifest,hash});assert.equal(metrics.bytes,Buffer.byteLength(raw));assert.ok(metrics.decodedBytes>0);assert.equal(JSON.stringify(body).includes('points'),true);
 await assert.rejects(admitRecoveryCell(raw.replace('"offsetM":20','"offsetM":21'),{key:'0,0',manifest,hash}),/Invalid authoritative/);
 await assert.rejects(admitRecoveryCell(raw,{key:'0,0',manifest:{...manifest,tiles:{...manifest.tiles,'1,0':{sha256:'c'.repeat(64)}}},hash}),/exact active neighborhood/);
 await assert.rejects(admitRecoveryCell(raw,{key:'0,0',manifest:{...manifest,tiles:{'0,0':{sha256:'c'.repeat(64)}}},hash}),/exact active neighborhood/);
 await assert.rejects(admitRecoveryCell('['+'0,'.repeat(100000)+'0]',{key:'0,0',manifest,hash}),/memory budget/);
});


test('opposite explicit one-way carriageways never share heading preference groups',async()=>{
 const {worldTowCandidates}=await import('../src/world-recovery.js'),{proveRecoveryCell}=await import('./build-world-recovery.mjs'),{planWorldTow}=await import('../src/tow-placement.js'),{recoveryRoadGroup}=await import('../src/world-road-group.js'),{admitRecoverySidecar}=await import('../server/route-road-stream.mjs'),{sha256}=await import('../src/route-definition.js');
 const forward={id:'forward',from:'a',to:'b',flags:1,layer:0,surface:'asphalt',points:[[22,0,60],[22,0,20]]},reverse={...forward,id:'reverse',from:'b',to:'a',points:[[18,0,20],[18,0,60]]},graph={edges:new Map([[forward.id,{value:forward}],[reverse.id,{value:reverse}]]),outgoing:new Map([['a',new Set(['forward'])],['b',new Set(['reverse'])]])};
 // Neither direction may opt a one-way member into a physical two-way street.
 for(const [a,b] of [[1,1],[0,1],[1,0]]){forward.flags=a;reverse.flags=b;assert.equal(recoveryRoadGroup(graph,forward),null);assert.equal(recoveryRoadGroup(graph,reverse),null);}forward.flags=reverse.flags=1;
 const contact=()=>({y:0,layer:0,surfaceId:'asphalt'}),roads={graph,width:()=>({left:4,right:4,width:8})},world={manifest:{revision:'a'.repeat(64),tiles:{'0,0':{sha256:'b'.repeat(64)}}},tiles:new Map([['0,0',{packet:{roadGraph:{edges:[forward,reverse]}}}]]),roads,stream:{contact},safePose:()=>true,contacts:{contact,width:roads.width,safe:()=>true}},pose={x:18,y:0,z:40,yaw:-Math.PI,towHeading:0,s:0},select=roadCandidates=>planWorldTow({pose,route:null,roadCandidates});
 const {legalLanePoint}=await import('./build-online-grids.mjs'),{edgePoint}=await import('../src/route-geometry.js');
 for(const [a,b] of [[1,1],[0,1],[1,0]]){forward.flags=a;reverse.flags=b;for(const e of [forward,reverse]){const p=legalLanePoint(world,{...edgePoint(e,20),leftM:4,rightM:4},{halfWidth:1,halfLength:2});assert.equal(p.x,e.points[0][0],'mixed one-way pair must not shift to a two-way lane');}}forward.flags=reverse.flags=1;
 const native=worldTowCandidates(world,pose,{halfWidth:1,halfLength:2}),body=proveRecoveryCell('0,0',world,[{halfWidth:1,halfLength:2}]);
 assert.ok(native.every(a=>a.roadId===undefined));assert.ok(body.anchors.every(a=>a.roadId===undefined));assert.equal(select(native).edgeId,'reverse');assert.equal(select(body.anchors).edgeId,'reverse');
 const admitted=await admitRecoverySidecar(JSON.stringify(body),{expectedHash:await sha256(body),worldSetRevision:world.manifest.revision});assert.equal(select(admitted.body.anchors).edgeId,'reverse');
 const bad=structuredClone(body);for(const a of bad.anchors)a.roadId='forward|reverse';assert.equal(select(bad.anchors).edgeId,'forward','negative control reproduces the farther wrong-way carriageway preference');await assert.rejects(admitRecoverySidecar(JSON.stringify(bad),{expectedHash:await sha256(bad),worldSetRevision:world.manifest.revision}),/road group/);
});


test('cold entry retains its warmed requested grid and TT never prepares the default AI event',async()=>{
 const {readFile}=await import('node:fs/promises'),{runInNewContext}=await import('node:vm'),main=await readFile(new URL('../src/main.js',import.meta.url),'utf8'),code=main.slice(main.indexOf('function prepareInitialEvent(id)'),main.indexOf('function resetUnifiedRace()'));
 const race={id:'megara-race',type:'sprint',rivals:2},tt={id:'megara-tt',type:'timetrial',rivals:0};let prepares=0,resets=0;const G={ev:{def:tt}},ctx={G,worldSession:{},mapEvent:id=>id===tt.id?tt:race,prepareEvent:def=>{prepares++;G.ev={def};},resetRace:()=>resets++};
 runInNewContext(code+";prepareInitialEvent('megara-tt');",ctx);assert.equal(prepares,0);assert.equal(resets,0);
 runInNewContext(code+";prepareInitialEvent('megara-race');",ctx);assert.equal(prepares,1);assert.equal(resets,1);assert.equal(G.ev.def,race);
 runInNewContext(code+";prepareInitialEvent('quick');",ctx);assert.equal(resets,1,'same warmed default grid is reused');
 ctx.worldSession=null;runInNewContext(code+";prepareInitialEvent('quick');",ctx);assert.equal(resets,2,'legacy bootstrap contract remains explicit');
 assert.match(main,/eventId=Q.get\('routeEvent'\)\|\|Q.get\('event'\)/);assert.match(main,/retry:\(\)=>network\?multiplayer.retryMap\(\):loadUnifiedWorld\(compiled,\{eventId\}\)/);
});

async function surfaceTimingFixture(){
 const {readFile}=await import('node:fs/promises'),{runInNewContext}=await import('node:vm'),THREE=await import('three'),{installCarSurface}=await import('../src/car-surface.js'),{RouteRivals}=await import('../src/route-rivals.js'),source=await readFile(new URL('../src/main.js',import.meta.url),'utf8');
 const car=(id)=>{const root=new THREE.Group(),body=new THREE.Group();root.add(body);const model=installCarSurface({root,body,paint:new THREE.MeshStandardMaterial(),dims:{L:4,W:2,H:1.5},update(){}}),calls=[],updateSurface=model.updateSurface;model.updateSurface=(...args)=>{calls.push(args);return updateSurface(...args);};const c={id,model,calls,finish:null,front:null,ai:{controller:{}},veh:{x:0,y:0,z:0,s:0,u:0,yaw:0,halfW:1,halfL:2,spec:{},vLong:20,vLat:0,w:0,corners:Array.from({length:4},()=>({Fz:3500})),wheelSurf:['dirt','dirt','dirt','dirt'],damage:{},pose:{},place(root){root.position.set(this.x,this.y,this.z);},update(dt){this.x+=dt*this.vLong;this.s+=dt*this.vLong;this.updates=(this.updates||0)+1;}}};c.actor={veh:c.veh};return c;};
 const player=car('player'),grid=[car('rival-ready'),car('rival-held')],blocked=new Set(),G={state:'race',t:0,raceT:0,postT:0,crashes:0,pFinish:null,ev:{r:{len:1000},def:{rules:{},traffic:0}},run:{}},multiplayer={active:false},settings={worldDetail:true};
 const context={player,grid,G,multiplayer,settings,ground:{ready:v=>!blocked.has(v),begin(){}},worldSession:{props:{},stream:{origin:{x:0,z:0}},metrics:{holds:0,missingContacts:0}},routeRivals:new RouteRivals({}),traffic:{actors:[],cars:[],update(){},collide(){}},signals:{update(){}},towOffer:{recovering:false,hold:0},inMenu:()=>false,inFreeRoam:()=>false,tickWorldLife(){},updateRoadWeather(){},window:{},pilotDriver:null,input:{},hud:{message(){}},raceTiming(){},racerPair(){},aiField:[],aiInput:()=>({brake:0}),route:{},camera:{position:new THREE.Vector3()},DistanceDetail:class{update(){}},audio:{},console};
 const code=source.slice(source.indexOf('function recordCarSurfaceStep('),source.indexOf('function racerCollide('))+source.slice(source.indexOf('function updateGrid('),source.indexOf('// ---- timing, positions'))+source.slice(source.indexOf('function stepUnified('),source.indexOf('function stepOnlineContacts('));
 runInNewContext(code,context);return {...context,blocked,step:dt=>context.stepUnified(dt,false,1),sync:(c,dt=1)=>context.syncCar(c,dt),record:context.recordCarSurfaceStep,consume:context.consumeCarSurfaceStep};
}

test('executed unified physics and sync consume each car simulation slices once, independent of render dt',async()=>{
 const f=await surfaceTimingFixture();for(let i=0;i<3;i++)f.step(.01);f.sync(f.player,1);assert.ok(Math.abs(f.player.model.surface.dirt.x-.03*20/230)<1e-12);assert.equal(f.player.calls.at(-1)[0],.03);assert.equal(f.player.veh.updates,3);
 const dirt=f.player.model.surface.dirt.x;f.sync(f.player,5);assert.equal(f.player.calls.at(-1)[0],0);assert.equal(f.player.model.surface.dirt.x,dirt,'render-only repeats cannot add wear');
 f.sync(f.grid[0],.001);assert.equal(f.grid[0].calls.at(-1)[0],.03,'rival clock is its successful physics time too');
});

test('actual unified player holds, pause and capture do not charge stale wheel speeds or skipped rivals',async()=>{
 const f=await surfaceTimingFixture();f.blocked.add(f.grid[1].veh);f.step(.02);for(const c of [f.player,...f.grid])f.sync(c);
 assert.equal(f.player.calls.at(-1)[0],.02);assert.equal(f.grid[0].calls.at(-1)[0],.02);assert.equal(f.grid[1].calls.at(-1)[0],0);assert.equal(f.grid[1].model.surface.dirt.x,0,'unready rival retains stale speed but has no elapsed physics');
 const dirt=[f.player,...f.grid].map(c=>c.model.surface.dirt.x);f.blocked.add(f.player.veh);for(let i=0;i<80;i++)f.step(.1);for(const c of [f.player,...f.grid])f.sync(c,8);
 assert.deepEqual([f.player,...f.grid].map(c=>c.model.surface.dirt.x),dirt,'player hold also skips rival simulation, even though simulate remains true');
 f.blocked.clear();f.G.state='paused';f.step(.1);for(const c of [f.player,...f.grid]){f.sync(c,8);assert.equal(c.calls.at(-1)[0],0);}
 f.G.state='race';f.towOffer.recovering=true;f.towOffer.hold=1;f.step(.1);f.sync(f.player);assert.equal(f.player.calls.at(-1)[0],0,'capture suspension steps are not driving wear');assert.equal(f.player.model.surface.dirt.x,dirt[0]);
 f.towOffer.recovering=false;f.player.veh.vLong=20;f.step(.01);f.sync(f.player);assert.ok(f.player.model.surface.dirt.x>dirt[0],'normal driving resumes its own clock');
});

test('surface clock discards old reset identity and zero-time sync still applies detail and online visibility',async()=>{
 const f=await surfaceTimingFixture();f.step(.01);f.player.veh.corners=Array.from({length:4},()=>({Fz:3500}));f.sync(f.player,1);assert.equal(f.player.calls.at(-1)[0],0);assert.equal(f.player.model.surface.dirt.x,0,'old pending contact history cannot cross Vehicle.reset');
 f.settings.worldDetail=false;f.sync(f.player,1);assert.equal(f.player.model.surface.size.w,0);f.settings.worldDetail=true;f.multiplayer.active=true;f.sync(f.player,1);assert.equal(f.player.model.surface.size.w,0);f.multiplayer.active=false;f.sync(f.player,1);assert.equal(f.player.model.surface.size.w,1);assert.equal(f.player.calls.at(-1)[0],0);
});

test('a failed player physics slice cannot credit cosmetic elapsed time',async()=>{
 const f=await surfaceTimingFixture();f.player.veh.update=()=>{throw Error('missing physical contact');};assert.throws(()=>f.step(.1),/missing physical contact/);assert.equal(f.worldSession.metrics.missingContacts,1);f.sync(f.player,1);assert.equal(f.player.calls.at(-1)[0],0);assert.equal(f.player.model.surface.dirt.x,0);
});

test('recovery builder publishes authenticated packed tuples while preserving every offline proof and root binding',async()=>{
 const {mkdtemp,writeFile,readFile,rm}=await import('node:fs/promises'),{join}=await import('node:path'),{tmpdir}=await import('node:os'),{buildWorldRecovery,proveRecoveryCell}=await import('./build-world-recovery.mjs'),{decodeRecoverySidecar}=await import('../server/route-road-wire.mjs'),{admitRecoverySidecar}=await import('../server/route-road-stream.mjs'),{canonicalJSON,sha256}=await import('../src/route-definition.js');
 const dir=await mkdtemp(join(tmpdir(),'athens-recovery-wire-')),revision='a'.repeat(64),manifest={revision,tiles:{'0,0':{sha256:'b'.repeat(64)},'1,0':{sha256:'c'.repeat(64)}}},edge={id:'road',from:'a',to:'b',flags:1,layer:0,surface:'asphalt',points:[[20,0,20],[60,0,20]]},profiles=[{halfWidth:1,halfLength:3},{halfWidth:1.5,halfLength:2}];let disposed=0;
 const readWorld=async()=>({manifest,tiles:new Map([['0,0',{packet:{roadGraph:{edges:[edge]}}}],['1,0',{packet:{roadGraph:{edges:[]}}}]]),roads:{graph:{edges:new Map([[edge.id,{value:edge}]]),outgoing:new Map(),dispose(){disposed++;}}},contacts:{contact:()=>({y:0,layer:0,surfaceId:'asphalt'}),width:()=>({left:4,right:4}),safe:()=>true}});
 try{
  const world=join(dir,'world.json');await writeFile(world,canonicalJSON(manifest));const original=proveRecoveryCell('0,0',await readWorld(),profiles),saved=canonicalJSON(original),result=await buildWorldRecovery({world,cells:'unused synthetic reader',out:join(dir,'world/recovery'),profiles,readWorld});
  const descriptor=result.body.cells['0,0'],raw=await readFile(dir+descriptor.url,'utf8'),packed=JSON.parse(raw),admitted=await admitRecoverySidecar(raw,{expectedHash:descriptor.hash,worldSetRevision:revision});
  assert.equal(packed.schemaVersion,2);assert.ok(Array.isArray(packed.anchors[0]));assert.equal(packed.anchors[0].length,14);assert.equal(await sha256(packed),descriptor.hash);assert.notEqual(await sha256(original),descriptor.hash,'root authenticates published packed representation');assert.deepEqual(decodeRecoverySidecar(packed).body,original);assert.equal(canonicalJSON(original),saved,'offline fullproof is not mutated');
  assert.equal(admitted.body.anchors.length,original.anchors.length);assert.equal(result.anchorCount,original.anchors.length);assert.equal(packed.edges.length,original.edges.length);assert.equal(packed.edges.reduce((n,e)=>n+e.points.length,0),original.edges.reduce((n,e)=>n+e.points.length,0));assert.equal(admitted.body.anchors.reduce((n,a)=>n+a.footprints.length,0),original.anchors.reduce((n,a)=>n+a.footprints.length,0));assert.deepEqual(admitted.body.sourceHashes,[['0,0','b'.repeat(64)],['1,0','c'.repeat(64)]]);
  assert.deepEqual(result.body.footprints,[{halfWidth:1,halfLength:3},{halfWidth:1.5,halfLength:2}]);assert.deepEqual(result.body.cells['1,0'],{sourceHash:'c'.repeat(64),empty:true});assert.equal(result.admission.cells,1);assert.equal(result.admission.maxSidecarBytes,Buffer.byteLength(raw));assert.equal(disposed,2);assert.equal(await sha256(result.body),result.hash);assert.equal(await readFile(join(dir,'world/recovery',`manifest.${result.hash}.json`),'utf8'),canonicalJSON(result.body));
  await assert.rejects(admitRecoverySidecar(raw,{expectedHash:await sha256(original),worldSetRevision:revision}),/Invalid authoritative/);await assert.rejects(admitRecoverySidecar(raw,{expectedHash:descriptor.hash,worldSetRevision:'d'.repeat(64)}),/Invalid authoritative/);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('offline online-proof reader rejects malformed original UTF8 before parsing or authenticating normalized roots',async()=>{
 const {mkdtemp,mkdir,writeFile,rm}=await import('node:fs/promises'),{join}=await import('node:path'),{tmpdir}=await import('node:os'),{readOnlineRouteRelease}=await import('./online-route-release.mjs'),{canonicalJSON,sha256}=await import('../src/route-definition.js'),f=await networkReleaseFixture(),dir=await mkdtemp(join(tmpdir(),'athens-release-utf8-'));
 try{
  const roads=f.proof.routeRoads[0];roads.body.utf8Probe='\ufffd';roads.hash=await sha256(roads.body);Object.assign(f.proof.routes[0].recovery,{hash:roads.hash,url:`/world/recovery/manifest.${roads.hash}.json`});
  const path=join(dir,'data/routes/online-release.json'),out=join(dir,'out'),raw=Buffer.from(canonicalJSON(f.proof)),at=raw.indexOf(Buffer.from('\ufffd'));assert.ok(at>0);await mkdir(join(dir,'data/routes'),{recursive:true});await writeFile(path,raw);
  const valid=await readOnlineRouteRelease(dir,{compiled:[f.compiled],manifest:f.manifest,out,required:true});assert.equal(valid.routeRoads[0].hash,roads.hash);assert.equal(valid.routeRoads[0].body.utf8Probe,'\ufffd','properly encoded replacement character is valid data');
  const malformed=Buffer.concat([raw.subarray(0,at),Buffer.from([0x80]),raw.subarray(at+3)]);assert.equal(malformed.toString('utf8'),raw.toString('utf8'),'negative control: replacing decoder normalizes malformed bytes to the authenticated root');await writeFile(path,malformed);
  const parse=JSON.parse;let parses=0;JSON.parse=(...args)=>{parses++;return parse(...args);};try{for(const required of [true,false])await assert.rejects(readOnlineRouteRelease(dir,{compiled:[f.compiled],manifest:f.manifest,out,required}),error=>error.code==='ERR_ENCODING_INVALID_ENCODED_DATA');assert.equal(parses,0,'original byte decoding rejects before JSON or root authentication');}finally{JSON.parse=parse;}
  await writeFile(path,Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),raw]));await assert.rejects(readOnlineRouteRelease(dir,{compiled:[f.compiled],manifest:f.manifest,out,required:true}),SyntaxError,'do not silently broaden the old JSON reader to accept a BOM');
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('offline proof byte reader bounds growth and shrink to the original handle and always closes it',async()=>{
 const {mkdtemp,writeFile,open,rm}=await import('node:fs/promises'),{join}=await import('node:path'),{tmpdir}=await import('node:os'),{readOnlineProofBytes}=await import('./online-route-release.mjs'),dir=await mkdtemp(join(tmpdir(),'athens-proof-bytes-')),path=join(dir,'proof.json'),original=Buffer.from('{"literal":"\ufffd"}');
 try{
  await writeFile(path,original);assert.deepEqual(Buffer.from(await readOnlineProofBytes(path)),original,'returns original valid bytes without replacement or serialization');
  for(const mutation of ['grow','shrink']){await writeFile(path,original);let closed=0,reads=0;const openFile=async()=>{const file=await open(path,'r');let first=true;return{async stat(){const stat=await file.stat();if(first){first=false;await writeFile(path,mutation==='grow'?Buffer.concat([original,Buffer.from('x')]):original.subarray(0,4));}return stat;},read(...args){reads++;return file.read(...args);},async close(){closed++;await file.close();}};};await assert.rejects(readOnlineProofBytes(path,{openFile}),/proof package (?:changed|shrank)/);assert.equal(closed,1);assert.ok(reads<=2,'read stays bounded to advertised bytes plus one-byte probe');}
  for(const size of [0,-1,NaN,Infinity,1.5,Number.MAX_SAFE_INTEGER+1]){let reads=0,closed=0;await assert.rejects(readOnlineProofBytes(path,{openFile:async()=>({stat:async()=>({size,isFile:()=>true}),read(){reads++;throw Error('must not read');},async close(){closed++;}})}),/Invalid online proof package/);assert.equal(reads,0);assert.equal(closed,1);}
 }finally{await rm(dir,{recursive:true,force:true});}
});
