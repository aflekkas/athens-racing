// Isolated two-WebSocket proof with Worker-style 100ms relay coalescing.
// Runs the real client intake + production main.js render hook with graphics stubbed.
// No WebGL, browser screenshot, live staging connection, or game-server restart.
import { createServer } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createGameCore } from '../server/core.mjs';
import { Multiplayer } from '../src/multiplayer.js';
import { StateSender } from '../src/multiplayer-state.js';
import { applyRemotePose } from '../src/remote-timeline.js';
const output = new URL('../.scratch/mp-motion/', import.meta.url);
const map = { id: 'riviera', name: 'proof', track: { start: 0, finish: 10000, version: 'proof' }, definitions: new Map([['quick', { id: 'quick', name: 'proof', type: 'sprint', s0: 0, s1: 10000, dir: 1, len: 10000 }]]) };
const core = createGameCore({ maps: new Map([['riviera', map]]), cars: new Set(['mini']), countdownMs: 0, reconnectGraceMs: 0, leaderboard: { submit: async () => {} } });
const server = createServer(), wss = new WebSocketServer({ server });
let relay = null, incoming = 0, relays = 0;
wss.on('connection', ws => {
  core.connect(ws, 'proof');
  ws.on('message', bytes => {
    const m = JSON.parse(bytes); if (m.type === 'states') incoming++;
    core.message(ws, bytes);
    if (relay === null && [...core.lobbies.values()].some(l => l.dirty)) relay = setTimeout(() => { relay=null; core.tick(); relays++; }, 100);
  });
  ws.on('close', () => core.disconnect(ws));
});
await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
const originalGlobals = Object.fromEntries(['location','document','WebSocket','sessionStorage'].map(k=>[k,globalThis[k]]));
const element = () => ({ value: '', replaceChildren() {}, append() {}, hidden: false });
globalThis.location = { href: `http://127.0.0.1:${server.address().port}/`, protocol: 'http:' };
globalThis.document = { hidden: false, createElement: element };
globalThis.WebSocket = WebSocket;
globalThis.sessionStorage = { setItem() {}, removeItem() {} };
const clients = [];
function connect() {
  const client = Object.create(Multiplayer.prototype);
  const elements = new Map();
  Object.assign(client, { peers: new Map(), loaded: false, panel: {}, stateSender: { reset() {} }, maps: [], offset: 0, token: null, lobby: null, preparing: null,
    $: id => { if (!elements.has(id)) elements.set(id,element()); return elements.get(id); },
    hooks: { clearInput() {}, join() {}, remote() {} }, renderEvents() {}, renderDiscovery() {}, renderRoom() {}, syncLobby() {}, advanceClock() {}, status() {}, authSession() {} });
  client.connect(); clients.push(client); return client;
}
async function waitUntil(fn) { const deadline = performance.now()+5000; while (!fn()) { if(performance.now()>deadline) throw new Error('Proof setup timed out'); await new Promise(r=>setTimeout(r,10)); } }
let sampler, frameTimer;
try {
  const driver = connect(), observer = connect(); await waitUntil(()=>driver.connected && observer.connected);
  driver.send({ type: 'create', car: 'mini' }); await waitUntil(()=>driver.lobby);
  observer.send({ type: 'join', code: driver.lobby.code, car: 'mini' }); await waitUntil(()=>observer.lobby && driver.lobby.players.length===2);
  for (const c of clients) c.send({ type: 'ready', ready: true, version: 'proof' }); await waitUntil(()=>driver.lobby.players.every(p=>p.ready));
  driver.send({ type: 'start' }); await waitUntil(()=>driver.lobby.raceId && observer.lobby.raceId);
  const main = await readFile(new URL('../src/main.js',import.meta.url),'utf8');
  const body = main.slice(main.indexOf('  remote(peers, dt) {'),main.indexOf('  wrecked() {',main.indexOf('  remote(peers, dt) {')));
  const vehicle = { x: 0, y: 0, z: 0, s: 0, u: 0, yaw: 0, vLong: 0, vLat: 0, steer: 0, rpm: 900, gear: 1 }, car = { veh: vehicle, model: { root: {} } };
  let draws=0;
  const render = Function('remoteCars','multiplayer','applyRemotePose','performance','setPaint','applyCarDecals','unpackDecals','syncCar',`return ({${body}}).remote`)(new Map([[driver.id,car]]),observer,applyRemotePose,performance,()=>{},()=>{},x=>x,()=>draws++);
  observer.hooks.remote = render;
  const sender = new StateSender(packet=>driver.send(packet));
  const start = performance.now(); let last = start, oldZ=0, previous=null; const frames=[];
  sampler = setInterval(()=>{
    const time=performance.now()-start;
    sender.sample({ ...vehicle, x: 0, y: 0, z: -20*time/1000, s: 20*time/1000, u: 0, yaw: 0, vLong: 20, vLat: 0, steer: 0, rpm: 3000, gear: 2, reverse: false, damage: { front: 0, rear: 0, left: 0, right: 0 } },driver.lobby.raceId,{batching:true});
  },10);
  await new Promise(resolve=>{
    const frame=()=>{
      const now=performance.now(), dt=(now-last)/1000; last=now; render(observer.peers,dt);
      const target=observer.peers.get(driver.id)?.state.z ?? 0; oldZ+=(target-oldZ)*(1-Math.exp(-18*dt));
      if (previous && now-start>1500) frames.push({ time:now-start, dt, beforeSpeed:Math.abs((oldZ-previous.oldZ)/dt), afterSpeed:Math.abs((vehicle.z-previous.z)/dt), z:vehicle.z, authoritativeZ:target });
      previous={oldZ,z:vehicle.z};
      if(now-start>=6000)resolve(); else frameTimer=setTimeout(frame,1000/60);
    }; frame();
  });
  clearInterval(sampler); sender.reset();
  const metric=key=>{const values=frames.map(f=>f[key]),mean=values.reduce((a,b)=>a+b,0)/values.length;return {mean,min:Math.min(...values),max:Math.max(...values),coefficientOfVariation:Math.sqrt(values.reduce((a,b)=>a+(b-mean)**2,0)/values.length)/mean};};
  const report={ proof:'two real local WebSockets; Worker-style latest-state relay; actual Multiplayer.connect intake and main.js remote hook; graphics stubbed, no WebGL',durationSeconds:(performance.now()-start)/1000,frames:frames.length,draws,incomingStateMessages:incoming,relays,before:metric('beforeSpeed'),after:metric('afterSpeed'),framesData:frames };
  report.messagesPerSecond=incoming/report.durationSeconds;
  await mkdir(output,{recursive:true}); await writeFile(new URL('transport-proof.json',output),JSON.stringify(report,null,2));
  console.log(JSON.stringify({...report,framesData:undefined},null,2));
  assert.ok(report.before.coefficientOfVariation>.6); assert.ok(report.after.coefficientOfVariation<.15); assert.ok(Math.abs(report.after.mean-20)<.5); assert.ok(report.messagesPerSecond<=5.1);
} finally {
  clearInterval(sampler); clearTimeout(frameTimer); clearTimeout(relay);
  for(const c of clients){c.ws.onclose=null;c.ws.terminate();}
  for(const ws of wss.clients)ws.terminate();
  await new Promise(resolve=>wss.close(resolve)); await new Promise(resolve=>server.close(resolve));
  for(const [key,value] of Object.entries(originalGlobals)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}
}
