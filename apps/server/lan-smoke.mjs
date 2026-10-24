// Exercises the real packaged unified route through two independent local
// facades and the LAN transport. Sends continuous authoritative route poses;
// this complements (and does not replace) the GPU/browser playtest.
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { WebSocket } from 'ws';
import { readCarCapabilities } from '../../server/car-capabilities.mjs';
import { startDesktopRuntime } from './runtime.mjs';
import { MULTIPLAYER_PROTOCOL } from '../../packages/contracts/desktop.mjs';
import { RouteNetworkRuntime } from '../../src/route-network-runtime.js';

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
function client(url) {
  const ws = new WebSocket(url.replace(/^http:/, 'ws:') + '/ws?protocol=' + MULTIPLAYER_PROTOCOL, { origin: url });
  const inbox = [], waiters = new Set(); let failure,latestSnapshot;
  const fail = error => { failure = error; for (const w of waiters) { clearTimeout(w.timer); w.reject(error); } waiters.clear(); };
  ws.on('error', fail);
  ws.on('message', bytes => { const message = JSON.parse(bytes); if(message.type==='snapshot')latestSnapshot=message; if (message.type === 'error' || message.type === 'reload') return fail(Error(JSON.stringify(message))); const waiter = [...waiters].find(w => w.predicate(message)); if (waiter) { waiters.delete(waiter); clearTimeout(waiter.timer); waiter.resolve(message); } else if (message.type !== 'snapshot') inbox.push(message); });
  return { ws, send: message => { if (failure) throw failure; ws.send(JSON.stringify(message)); }, next: (predicate, timeout = 10000) => new Promise((resolve, reject) => { if (failure) return reject(failure); const i = inbox.findIndex(predicate); if (i >= 0) return resolve(inbox.splice(i, 1)[0]); const waiter = { predicate, resolve, reject, timer: null }; waiter.timer = setTimeout(() => { waiters.delete(waiter); reject(Error('LAN smoke message timeout. Latest snapshot: '+JSON.stringify(latestSnapshot).slice(0,3500))); }, timeout); waiters.add(waiter); }), close: () => { for (const w of waiters) clearTimeout(w.timer); waiters.clear(); ws.terminate(); } };
}

export async function smokePackagedLAN({ root = resolve('.desktop/game'), routeId, log = console.log } = {}) {
  const temp = await mkdtemp(resolve(process.platform === 'win32' ? tmpdir() : '/tmp', 'athens-lan-smoke.'));
  const runtimes = [], clients = [];
  try {
    const catalogue = JSON.parse(await readFile(resolve(root, 'catalogue.json'), 'utf8'));
    assert.equal(catalogue.routeConfig.online, true, 'Certified unified LAN catalogue required. Run desktop:online then desktop:prepare.');
    const compiled = routeId?catalogue.routes.find(route=>route.id===routeId):[...catalogue.routes].sort((a,b)=>a.lengthM-b.lengthM)[0];assert.ok(compiled,'Requested certified route unavailable');
    const car=readCarCapabilities(await readFile(resolve(root,'src/cars.js'),'utf8')).cars[0];assert.ok(car);
    const host = await startDesktopRuntime({ root, dataDir: resolve(temp, 'host'), port: 0, lanPort: 0 }); runtimes.push(host);
    const guest = await startDesktopRuntime({ root, dataDir: resolve(temp, 'guest'), port: 0, lanPort: 0 }); runtimes.push(guest);
    const hosted = await host.host(); await guest.join(`127.0.0.1:${hosted.port}`);
    const a = client(host.url), b = client(guest.url); clients.push(a, b);
    const [helloA, helloB] = await Promise.all([a, b].map(c => c.next(m => m.type === 'hello')));
    const advertised = helloA.maps.find(map => map.id === compiled.id); assert.ok(advertised, 'Certified route must be offered');
    const event = advertised.events.filter(e => e.type === 'timetrial' || e.type === 'sprint').sort((a, b) => a.len - b.len)[0]; assert.ok(event);
    a.send({ type: 'create', mapId: compiled.id, eventId: event.id, name: 'LAN HOST', driverId: 'desktop-smoke-host', car });
    const created = (await a.next(m => m.type === 'lobby')).lobby;
    b.send({ type: 'join', code: created.code, name: 'LAN GUEST', driverId: 'desktop-smoke-guest', car });
    let lobby = (await b.next(m => m.type === 'lobby' && m.lobby.players.length === 2)).lobby;
    const identity = lobby.routeIdentity;
    const packet = extra => ({ mapId: compiled.id, routeIdentity: identity, ...extra });
    for (const c of [a, b]) c.send(packet({ type: 'loaded', loaded: true, version: advertised.track.version }));
    for (const c of [a, b]) c.send(packet({ type: 'ready', ready: true, version: advertised.track.version }));
    await a.next(m => m.type === 'lobby' && m.lobby.players.every(p => p.ready && p.loaded));
    a.send({ type: 'start' });
    lobby = (await a.next(m => m.type === 'lobby' && m.lobby.status === 'race', 15000)).lobby;
    assert.equal((await b.next(m => m.type === 'lobby' && m.lobby.status === 'race', 15000)).lobby.raceId, lobby.raceId);
    log(JSON.stringify({ proof: 'two local facades → LAN host → unified lobby → loaded → ready → synchronized start', route: compiled.id, raceId: lobby.raceId }));
    // A real socket loss must retain the reserved driver, grid and race tuple.
    b.close(); const resumed = client(guest.url); clients.push(resumed); await resumed.next(m => m.type === 'hello');
    resumed.send(packet({ type: 'resume', token: helloB.token, raceId: lobby.raceId, generation: lobby.generation }));
    const session = await resumed.next(m => m.type === 'session'); assert.equal(session.resumed, true); assert.equal(session.id, helloB.id);
    assert.equal((await resumed.next(m => m.type === 'lobby' && m.resume)).lobby.raceId, lobby.raceId);
    const grid = catalogue.routeGrids.find(grid => grid.hash === identity.onlineGridHash); assert.ok(grid);
    const geometry = new RouteNetworkRuntime(compiled, grid.body), active = [a, resumed];
    const stations = lobby.players.filter(p => [helloA.id, helloB.id].includes(p.id)).map(p => grid.body.poses[p.gridSlot].s);
    const initialFrame=geometry.frame(stations[0]),initialPoint=geometry.point(stations[0]);
    a.send(packet({type:'state',raceId:lobby.raceId,generation:lobby.generation,state:{...initialPoint,s:stations[0],u:0,yaw:initialFrame.yaw,layer:initialFrame.layer,surfaceId:initialFrame.surfaceId,edgeId:initialFrame.edgeId,vLong:0,vLat:0,steer:0,rpm:900,gear:1,motionEpoch:0,sampleTime:0,recordMeta:{tc:true,abs:true,steering:'off',gearbox:'auto'}}}));
    await delay(100); // Let the preceding accepted-state handler finish before requesting its snapshot.
    const earnedStation=stations[0];
    a.send(packet({type:'recover',raceId:lobby.raceId,generation:lobby.generation,motionEpoch:1}));
    const recovered=await a.next(m=>m.type==='recovered'||m.type==='recover-denied',15000);
    assert.equal(recovered.type,'recovered',JSON.stringify(recovered));assert.ok(Number.isFinite(recovered.x)&&Number.isFinite(recovered.y)&&Number.isFinite(recovered.z));
    stations[0]=recovered.s;await delay(Math.max(0,recovered.until-Date.now())+100);
    a.send(packet({type:'state',raceId:lobby.raceId,generation:lobby.generation,state:{...recovered,vLong:0,vLat:0,steer:0,rpm:900,gear:1,sampleTime:1,motionEpoch:1,recordMeta:{tc:true,abs:true,steering:'off',gearbox:'auto'}}}));
    await delay(100);
    // A tow grants no course progress. Drive the short distance back to the
    // last earned station before accelerating, satisfying the existing rejoin rule.
    const rejoinPoint=geometry.point(earnedStation),rejoinFrame=geometry.frame(earnedStation);
    a.send(packet({type:'state',raceId:lobby.raceId,generation:lobby.generation,state:{...rejoinPoint,s:earnedStation,u:0,yaw:rejoinFrame.yaw,layer:rejoinFrame.layer,surfaceId:rejoinFrame.surfaceId,edgeId:rejoinFrame.edgeId,vLong:0,vLat:0,steer:0,rpm:900,gear:1,sampleTime:2,motionEpoch:1,recordMeta:{tc:true,abs:true,steering:'off',gearbox:'auto'}}}));
    stations[0]=earnedStation;await delay(100);
    log(JSON.stringify({proof:'real LAN recover request → authoritative certified Tow acknowledgement',route:compiled.id,motionEpoch:recovered.motionEpoch,edgeId:recovered.edgeId}));
    const finish = lobby.event.s1 + 12, speed = 120, step = 6; let sequence = 2;
    const results = active.map(c => c.next(m => m.type === 'lobby' && m.lobby.status === 'results', Math.ceil((finish + 512) / speed * 1000) + 30000));
    const completed = Promise.all(results); completed.catch(() => {});
    while (stations.some(station => station <= finish)) {
      for (const [i, c] of active.entries()) {
        const s = stations[i]; if (s > finish) continue;
        const frame = geometry.frame(s), point = geometry.point(s);
        c.send(packet({ type: 'state', raceId: lobby.raceId, generation: lobby.generation, state: { ...point, s, u: 0, yaw: frame.yaw, layer: frame.layer, surfaceId: frame.surfaceId, edgeId: frame.edgeId, vLong: speed, vLat: 0, steer: 0, rpm: 4000, gear: 4, sampleTime: ++sequence, motionEpoch:i===0?1:0, recordMeta: { tc: true, abs: true, steering: 'off', gearbox: 'auto' } } }));
        stations[i] += step;
      }
      await delay(step / speed * 1000);
    }
    const finished = (await completed)[0].lobby;
    assert.equal(finished.results.length, 2); assert.ok(finished.results.every(driver => Number.isFinite(driver.finish) && !driver.dnf));
    log(JSON.stringify({ proof: 'reserved session reconnected → continuous route poses → both certified finishes', route: compiled.id, results: finished.results.map(({ finish, dnf }) => ({ finish, dnf })) }));
    await guest.solo(); await host.solo(); assert.equal(guest.getSession().mode, 'solo'); assert.equal(host.getSession().mode, 'solo');
    await assert.rejects(fetch(`http://127.0.0.1:${hosted.port}/health`));
    return { route: compiled.id, results: finished.results, reconnects: 1 };
  } finally { for (const c of clients) c.close(); for (const runtime of runtimes.reverse()) await runtime.close(); await rm(temp, { recursive: true, force: true }); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) smokePackagedLAN({ root: process.argv[2] || undefined,routeId:process.argv[3]||undefined }).catch(error => { console.error(error.stack); process.exitCode = 1; });
