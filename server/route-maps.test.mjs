import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from '../tools/fixtures/routes/fixture.mjs';
import { compileRoute } from '../src/route-compile.js';
import { edgePoint } from '../src/route-geometry.js';
import { sha256 } from '../src/route-definition.js';
import { installRouteMaps as installRoutes } from './route-maps.mjs';
import { validateRouteRoads, routeRoadAuthority } from './route-roads.mjs';
import { requestRecovery, recoveryStateAllowed } from './race-recovery.mjs';
import { buildCourse, observeCourse } from '../src/course.js';
const installRouteMaps = (maps, build, options = {}) => installRoutes(maps, build, { ...options, loadRoadArtifact: async url => build.roadArtifacts[url] });
async function bindRoads(build, roads) {
  const hash = await sha256(roads), url = `/world/recovery/0,0.${hash}.json`;
  const manifest = { schemaVersion: 1, worldId: 'athens', projectionId: 'athens-v1', worldSetRevision: roads.worldSetRevision, footprints: [{ halfWidth: 1.1, halfLength: 2.8 }], cells: { '0,0': { sourceHash: 'b'.repeat(64), hash, url } } };
  const rootHash = await sha256(manifest), entry = build.routeConfig.routes[0]; entry.recovery = { schemaVersion: 1, hash: rootHash, url: `/data/routes/${entry.id}.recovery.${rootHash}.json`, streamed: true };
  build.recoveryWorld = { worldSetRevision: roads.worldSetRevision, sourceHashes: roads.sourceHashes };
  build.routeRoads = [{ hash: rootHash, body: manifest }]; build.roadArtifacts = { [url]: roads };
}
async function catalogue({ timetrial = false } = {}) {
  const f = fixture(); if (timetrial) f.definition.events = [{ id: 'only-tt', type: 'timetrial', enabled: true, rivals: 0 }];
  const c = await compileRoute(f.definition, f.graph, f.contacts);
  const grid = { schemaVersion: 1, projectionId: 'athens-v1', routeId: c.id, routeHash: c.routeHash, geometryHash: c.geometryHash, worldSetRevision: c.worldSetRevision, capacity: 8, footprint: { halfWidth: 1.1, halfLength: 2.8, clearanceM: .2 }, poses: Array.from({ length: 8 }, (_, slot) => ({ slot, s: -8 * (slot + 1), x: 100, y: 0, z: 400 + 8 * (slot + 1), yaw: 0, edgeId: 'a', layer: 0, surfaceId: 'road-a' })), approach: { points: [], occurrences: [] } };
  const anchors = [100, 104, 108, 112].map(offsetM => { const p = edgePoint(f.graph.edges.get('a').value, offsetM); return { edgeId: 'a', offsetM, x: p.x, y: p.y, z: p.z, yaw: p.yaw, layer: 0, surfaceId: 'road-a', leftM: 4, rightM: 3, halfWidth: 1.1, halfLength: 2.8 }; });
  const roads = { schemaVersion: 1, projectionId: 'athens-v1', worldId: 'athens', worldSetRevision: c.worldSetRevision, sourceHashes: [['0,0', 'b'.repeat(64)]], edges: [...f.graph.edges.values()].map(e => e.value), anchors };
  const gridHash = await sha256(grid), roadHash = await sha256(roads), entry = { id: c.id, routeHash: c.routeHash, geometryHash: c.geometryHash, worldSetRevision: c.worldSetRevision, onlineGrid: { schemaVersion: 1, capacity: 8, hash: gridHash, url: `/data/routes/${c.id}.online-grid.${gridHash}.json` }, recovery: { schemaVersion: 1, hash: roadHash, url: `/data/routes/${c.id}.recovery.${roadHash}.json` } };
  const build = { routeConfig: { environment: 'staging', world: false, online: true, routes: [entry] }, routes: [c], routeGrids: [{ hash: gridHash, body: grid }] };
  await bindRoads(build, roads); return { c, grid, roads, entry, build };
}
test('trusted build binds route/grid/road artifacts; the compiled geometry remains unchanged', async () => {
  const { c, build, grid } = await catalogue(), before = JSON.stringify(c), maps = new Map(); await installRouteMaps(maps, build, { carSpecs: { mini: { width: 2, length: 4 }, bus: { width: 2.55, length: 12 } } });
  assert.ok(maps.has(c.id)); const map = maps.get(c.id); assert.equal(map.geometry.isWorldRoute, true); assert.equal(maps.routeConfig.routes[0].url, `/data/routes/${c.id}.${c.routeHash}.json`); assert.equal(map.track.version, c.routeHash + ':' + build.routeConfig.routes[0].onlineGrid.hash); assert.equal(map.gridPose(7, 'mini'), grid.poses[7]); assert.throws(() => map.gridPose(7, 'bus')); assert.equal(map.supportsCar('bus'), false);
  assert.equal(JSON.stringify(c), before); const event = [...map.definitions.values()][0]; assert.equal(event.s0, 0); assert.equal(event.len, c.lengthM); assert.equal(event.mapId, c.id);
});
test('unknown/stale routes, spoofed descriptors, changed artifact bytes and incomplete eight-slot grids fail closed', async () => {
  for (const change of [x => x.build.routeConfig.routes[0].routeHash = 'old', x => x.build.routeConfig.routes[0].onlineGrid.url = 'https://other/grid.json', x => x.grid.poses.pop(), x => x.build.routeRoads[0].body.worldSetRevision = 'c'.repeat(64), x => x.build.routeRoads = []]) {
    const x = await catalogue(); change(x); const maps = new Map(); await installRouteMaps(maps, x.build); assert.equal(maps.has(x.c.id), false);
  }
  const x = await catalogue(); x.build.routeConfig.online = false; const maps = new Map(); await installRouteMaps(maps, x.build); assert.equal(maps.has(x.c.id), false); assert.equal(maps.routes.size, 1); assert.equal(maps.routeConfig.online, false);
});
test('only authorized release routes appear in the API catalogue; raw configured geometry is never accepted', async () => {
  const x = await catalogue(); x.build.routeConfig.routes.push({ ...x.entry, id: 'client-selected' }); x.build.routes.push({ ...x.c, id: 'unlisted' });
  const maps = new Map(); await installRouteMaps(maps, x.build); assert.deepEqual(maps.routeConfig.routes.map(r => r.id), [x.c.id]); assert.deepEqual([...maps.routes.keys()], [x.c.id]);
  x.build.routeConfig.environment = 'development'; await installRouteMaps(new Map(), x.build).then(config => assert.equal(config.routes.length, 0));
});
test('authoritative road snapshot authenticates all bytes and rejects duplicate/off-deck/forbidden anchors', async () => {
  for (const change of [r => r.anchors[0].y = 12, r => r.anchors.push(r.anchors[0]), r => r.edges[0].flags |= 8, r => r.anchors[0].halfLength = 0]) {
    const { roads } = await catalogue(); change(roads); const expectedHash = await sha256(roads); await assert.rejects(validateRouteRoads(roads, { expectedHash, worldSetRevision: roads.worldSetRevision }));
  }
  const { roads } = await catalogue(); assert.equal(await validateRouteRoads(roads, { expectedHash: await sha256(roads), worldSetRevision: roads.worldSetRevision }), roads);
  const authority = routeRoadAuthority(roads); assert.equal(authority.candidates({ x: 10000, y: 0, z: 10000 }, { halfWidth: 1, halfLength: 2 }).length, 0); assert.equal(authority.candidates({ x: 100, y: 0, z: 400 }, { halfWidth: 1.275, halfLength: 6 }).length, 0);
});
test('world recovery uses surveyed road anchors and never grants progress after waiting out the hold', async () => {
  const { c, build } = await catalogue(), maps = new Map(); await installRouteMaps(maps, build, { carSpecs: { mini: { width: 2, length: 4 } } });
  const map = maps.get(c.id), route = map.geometry, event = [...map.definitions.values()][0];
  const stateAt = s => { const f = route.frame(s); return { ...route.point(s), s, u: 0, yaw: f.yaw, layer: f.layer, edgeId: f.edgeId, surfaceId: f.surfaceId, vLong: 0, vLat: 0, motionEpoch: 0 }; };
  const driver = { car: 'mini', course: buildCourse(event, route), state: stateAt(0), stateAt: 1000 }; driver.course.lastRoad = stateAt(0);
  const earned = driver.course.reached; driver.state = { ...stateAt(11), u: 12, x: 112 };
  await map.prepareRecovery(driver); const recovery = requestRecovery(driver, event, 'race', 1, 1100, { route }); assert.ok(recovery); assert.equal(driver.course.reached, earned); assert.equal(driver.course.validProgress, 0); assert.ok(driver.course.rejoinLimit <= 2);
  assert.equal(recovery.layer, 0); assert.equal(recovery.surfaceId, 'road-a');
  assert.equal(recoveryStateAllowed(driver, { ...driver.state, y: 12, layer: 1 }, 'race', 1150, { route, event }), false);
  observeCourse(driver.course, { ...stateAt(12), motionEpoch: 1 }, 10, { route }); assert.equal(driver.course.reached, earned);
  driver.state = { ...stateAt(0), x: 10000, z: 10000 }; driver.recovery = null; assert.equal(requestRecovery(driver, event, 'race', 2, 20000, { route }), null);
});

test('separate online approach projects the eighth slot beyond eighty metres without changing competitive geometry', async () => {
  const { c, grid, build, roads } = await catalogue(), original = JSON.stringify(c);
  const { RouteRuntime } = await import('../src/route-runtime.js');
  const { RouteNetworkRuntime } = await import('../src/route-network-runtime.js');
  grid.approach = { points: [[100, 0, 560, -160, 4, 3], [100, 0, 400, 0, 4, 3]], occurrences: [{ edgeId: 'approach', layer: 0, surfaceId: 'entry', s0: -160, s1: 0 }] };
  grid.poses = grid.poses.map((p, i) => ({ ...p, s: -16 * (i + 1), z: 400 + 16 * (i + 1), edgeId: 'approach', surfaceId: 'entry' }));
  roads.edges.push({ id: 'approach', from: 'entry', to: 'start', points: [[100, 0, 560], [100, 0, 400]], surface: 'entry', layer: 0, flags: 1 });
  const gridHash = await sha256(grid), roadHash = await sha256(roads), entry = build.routeConfig.routes[0];
  entry.onlineGrid.hash = gridHash; entry.onlineGrid.url = `/data/routes/${c.id}.online-grid.${gridHash}.json`; build.routeGrids = [{ hash: gridHash, body: grid }];
  await bindRoads(build, roads);
  const maps = new Map(); await installRouteMaps(maps, build, { carSpecs: { mini: { width: 2, length: 4 } } });
  const runtime = maps.get(c.id).geometry, core = new RouteRuntime(c), last = grid.poses[7];
  assert.ok(runtime instanceof RouteNetworkRuntime); assert.equal(runtime.compiled, c); assert.equal(JSON.stringify(c), original);
  const q = runtime.project(last.x, last.z, { hint: last.s, layer: last.layer, referenceY: last.y }); assert.equal(q.s, -128); assert.equal(q.edgeId, 'approach');
  assert.equal(runtime.validatePose(last), true); assert.equal(runtime.frame(-128).z, last.z);
  for (const s of [0, 10, 400, 900, c.lengthM]) assert.deepEqual(runtime.frame(s), core.frame(s));
  const event = [...maps.get(c.id).definitions.values()][0], course = buildCourse(event, runtime); course.previous = { ...last, u: 0 };
  let time = 0; for (let s = last.s; s <= 8; s += 4) { const f = runtime.frame(s); observeCourse(course, { ...runtime.point(s), s, u: 0, yaw: f.yaw, layer: f.layer, surfaceId: f.surfaceId }, time += .2, { route: runtime }); }
  assert.ok(course.reached >= 7.9); assert.equal(course.finishedAt, null);
});

test('a partial static road snapshot cannot enable online even with valid hashes and eight slots', async () => { const { c, roads, build } = await catalogue(), hash = await sha256(roads); build.routeConfig.routes[0].recovery = { schemaVersion: 1, hash, url: `/data/routes/${c.id}.recovery.${hash}.json` }; build.routeRoads = [{ hash, body: roads }]; const maps = new Map(); await installRouteMaps(maps, build); assert.equal(maps.has(c.id), false); assert.match(maps.routeIssues.get(c.id), /Full-domain streamed/); });

test('streamed recovery needs exact published-world coverage, including empty road cells', async () => { const { c, build } = await catalogue(); build.recoveryWorld.sourceHashes.push(['2,0', 'e'.repeat(64)]); const maps = new Map(); await installRouteMaps(maps, build); assert.equal(maps.has(c.id), false); assert.match(maps.routeIssues.get(c.id), /omits or changes/); });

test('shared immutable recovery manifest URL and route-bound free roam preserve the online mode contract', async () => { const { c, build } = await catalogue(); build.routeConfig.routes[0].recovery.url = `/world/recovery/manifest.${build.routeConfig.routes[0].recovery.hash}.json`; const maps = new Map(); await installRouteMaps(maps, build); const map = maps.get(c.id), free = map.definitions.get('free:' + c.id); assert.equal(free.type, 'free'); assert.equal(free.save, false); assert.deepEqual(free.sectors, []); assert.equal(free.mapId, c.id); });

test('free roam and off-course race recoveries on distant surveyed roads return finite stations', async () => {
 const {c,build}=await catalogue(),maps=new Map();await installRouteMaps(maps,build,{carSpecs:{mini:{width:2,length:4}}});const map=maps.get(c.id),route=map.geometry;
 route.recoveryCandidates=()=>[{x:1000,y:0,z:1000,yaw:0,layer:0,edgeId:'distant-road',surfaceId:'distant-road'}];
 for(const event of map.definitions.values()){
  const driver={car:'mini',state:{x:1000,y:0,z:1000,yaw:0,s:0,u:0,layer:0,surfaceId:'distant-road',motionEpoch:0},stateAt:1000,course:event.type==='free'?null:buildCourse(event,route)};
  const recovery=requestRecovery(driver,event,'race',1,1100,{route});assert.ok(recovery);assert.equal(recovery.kind,'road');assert.ok(Number.isFinite(recovery.s)&&Number.isFinite(recovery.u));assert.equal(recovery.u,0);if(driver.course)assert.equal(driver.course.reached,0);
 }
});

test('online activation replaces legacy offerings atomically and failed proof sets offer no partial release',async()=>{
 const {createGameCore}=await import('./core.mjs'),{MULTIPLAYER_PROTOCOL}=await import('../src/multiplayer-protocol.js');
 const legacy={id:'riviera',track:{version:'legacy'},definitions:new Map([['quick',{id:'quick',mapId:'riviera',type:'sprint',s0:0,s1:100,dir:1,len:100}]])};
 for(const invalid of [false,true]){
  const {c,build}=await catalogue(),maps=new Map([['riviera',legacy]]);if(invalid)build.routeConfig.routes.push({...build.routeConfig.routes[0],id:'missing-route'});await installRouteMaps(maps,build,{carSpecs:{mini:{width:2,length:4}}});
  const core=createGameCore({maps,cars:new Set(['mini']),carSpecs:{mini:{width:2,length:4}},leaderboard:{submit:async()=>{}}}),ws={readyState:1,messages:[],send(s){this.messages.push(JSON.parse(s));},close(){}};core.connect(ws,'test',{protocol:MULTIPLAYER_PROTOCOL});
  const hello=ws.messages[0];assert.deepEqual(hello.maps.map(m=>m.id),invalid?[]:[c.id]);assert.ok(hello.events.every(e=>e.mapId!=='riviera'));
  core.message(ws,JSON.stringify({type:'create',mapId:'riviera'}));assert.equal(core.lobbies.size,0);
  core.message(ws,JSON.stringify({type:'create'}));assert.equal(core.lobbies.size,invalid?0:1);if(!invalid)assert.equal([...core.lobbies.values()][0].mapId,c.id);
 }
 const x=await catalogue();x.build.routeConfig.online=false;const maps=new Map([['riviera',legacy]]);await installRouteMaps(maps,x.build);assert.equal(maps.onlineMapIds,null);assert.equal(maps.get('riviera'),legacy);assert.equal(maps.has(x.c.id),false);
});

test('activation cannot resurrect a persisted legacy lobby or its ready state',async()=>{
 const {createGameCore}=await import('./core.mjs'),{MULTIPLAYER_PROTOCOL}=await import('../src/multiplayer-protocol.js'),{c,build}=await catalogue();
 const maps=new Map([['riviera',{id:'riviera',track:{version:'legacy'},definitions:new Map([['quick',{id:'quick',mapId:'riviera',type:'sprint',s0:0,s1:100,dir:1,len:100}]])}]]),opts={maps,cars:new Set(['mini']),carSpecs:{mini:{width:2,length:4}},leaderboard:{submit:async()=>{}}};
 let core=createGameCore(opts);const ws={readyState:1,messages:[],send(s){this.messages.push(JSON.parse(s));},close(){}};core.connect(ws,'test',{protocol:MULTIPLAYER_PROTOCOL});core.message(ws,JSON.stringify({type:'create'}));core.message(ws,JSON.stringify({type:'ready',ready:true,version:'legacy'}));const saved=structuredClone(core.exportState());assert.equal(saved.sessions[0].ready,true);
 await installRouteMaps(maps,build,{carSpecs:opts.carSpecs});core=createGameCore(opts);core.restore(saved);assert.equal(core.lobbies.size,0);assert.equal([...core.sessions.values()][0].ready,false);assert.equal([...core.sessions.values()][0].state,null);assert.equal(core.track.version,maps.get(c.id).track.version);
});

test('TT-only authenticated routes activate atomically with eight human slots and unchanged TT edition', async()=>{
 const {c,build}=await catalogue({timetrial:true}), maps=new Map();await installRouteMaps(maps,build,{carSpecs:{mini:{width:2,length:4}}});
 assert.equal(maps.routeConfig.onlineAvailable,true);assert.ok(maps.onlineMapIds.has(c.id));const map=maps.get(c.id),event=map.definitions.get('only-tt');
 assert.equal(event.type,'timetrial');assert.equal(event.rivals,0);assert.equal(event.rivalCount,0);assert.equal(event.routeHash,c.routeHash);assert.equal(event.geometryHash,c.geometryHash);
 assert.equal(new Set(Array.from({length:8},(_,slot)=>JSON.stringify(map.gridPose(slot,'mini')))).size,8);
 const invalid=await catalogue({timetrial:true});invalid.build.routeGrids[0].body.poses.pop();const blocked=new Map();await installRouteMaps(blocked,invalid.build);assert.equal(blocked.routeConfig.onlineAvailable,false);assert.equal(blocked.onlineMapIds.size,0);
});
