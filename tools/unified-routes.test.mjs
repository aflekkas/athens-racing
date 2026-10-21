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

test('normal Quick Race opens enabled routes without URL parameters and keeps original tracks available',async()=>{
 const {Menu}=await import('../src/menu.js');
 const priorDocument=globalThis.document,priorWindow=globalThis.window,priorFetch=globalThis.fetch;
 globalThis.document={baseURI:'http://localhost/',querySelector:()=>null,querySelectorAll:()=>[],addEventListener(){},body:{classList:{contains:()=>false}}};globalThis.window={addEventListener(){}};
 try {
  const entry={id:'psychiko-faros',name:'FAROS',lengthM:1200,events:[{id:'faros-race',laps:3,rivals:5}],routeHash:'a',geometryHash:'b',worldSetRevision:'c',url:'/faros.json'};
  const reads=[];
  globalThis.fetch=async url=>{reads.push(url);return{ok:true,json:async()=>url==='/api/routes'?{environment:'production',routes:[entry]}:{schemaVersion:1,routes:[entry]}};};
  const menu={screen:'mode',data:{},show(screen,data,push){Object.assign(this,{screen,data,push});}};
  await Menu.prototype.openQuickRace.call(menu);
  assert.equal(menu.screen,'routes');assert.equal(menu.push,true);assert.deepEqual(menu.data.catalogue,[entry]);
  assert.deepEqual(reads,['/api/routes','/data/routes/index.json']);
  const html=Menu.prototype.r_routes.call(menu,menu.data);
  assert.match(html,/data-route="psychiko-faros"/);assert.match(html,/data-act="classicTracks"/);
  // Navigating away while the catalogue loads must not reopen the picker.
  let finish;globalThis.fetch=()=>new Promise(resolve=>{finish=resolve;});
  menu.screen='mode';menu.data={};const pending=Menu.prototype.openQuickRace.call(menu);menu.screen='title';
  finish({ok:true,json:async()=>({environment:'production',routes:[]})});await pending;assert.equal(menu.screen,'title');
  // A development release with no enabled routes keeps its original picker.
  globalThis.fetch=async()=>({ok:true,json:async()=>({environment:'production',routes:[]})});menu.screen='mode';
  await Menu.prototype.openQuickRace.call(menu);assert.equal(menu.screen,'maps');assert.equal(menu.data.mode,'quick');
 } finally {globalThis.document=priorDocument;globalThis.window=priorWindow;globalThis.fetch=priorFetch;}
});
