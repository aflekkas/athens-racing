import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameCore } from './core.mjs';
import { MULTIPLAYER_PROTOCOL } from '../src/multiplayer-protocol.js';
import { socketAttachment } from '../worker/socket-attachment.mjs';
import { Multiplayer } from '../src/multiplayer.js';
import { resolvePlayerContacts, containOnlineVehicle } from '../src/multiplayer-contact.js';
const pose = (s, u = 0) => ({ x: s, y: 0, z: u, s, u, yaw: -Math.PI/2, vLong: 20, vLat: 0, steer: 0, rpm: 3000, gear: 2 });
const socket = () => ({ readyState: 1, messages: [], send(s) { this.messages.push(JSON.parse(s)); }, close() {} });
function setup(t) {
 let now = 100000; t.mock.method(Date, 'now', () => now);
 const event = { id: 'quick', type: 'sprint', s0: 0, s1: 240, len: 240, dir: 1 };
 const opts = { maps: new Map([['riviera', { track: { version: 'v' }, definitions: new Map([['quick', event]]) }]]), cars: new Set(['mini']), leaderboard: { submit: async () => {} }, countdownMs: 100 };
 const core = createGameCore(opts), clients = Array.from({ length: 3 }, socket);
 clients.forEach((ws, i) => core.connect(ws, String(i), { protocol: MULTIPLAYER_PROTOCOL }));
 const send = (ws, m) => core.message(ws, JSON.stringify(m));
 send(clients[0], { type: 'create', name: 'PARROT', paint: '#abcdef', config: { time: 'night', weather: 'rain', traffic: 2 } });
 const lobby = [...core.lobbies.values()][0];
 return { core, clients, send, lobby, opts, advance: (ms = 100) => { now += ms; core.tick(); } };
}
test('loading, force start, late grid joins and restart retain everyone without auto-ready', t => {
 const { core, clients: [a,b,c], send, lobby:l, advance } = setup(t);
 send(b, { type:'join', code:l.code, name:'PARROT', paint:'#123456' });
 assert.equal(l.players.get(core.clientData(b).id).name,'PARROT#2');
 assert.equal(core.publicLobby(l).players[1].paint,'#123456');
 send(a,{type:'ready',ready:true,mapId:'riviera',version:'v'});
 send(a,{type:'start'});assert.equal(l.status,'waiting');assert.match(a.messages.at(-1).message,/ready/);
 send(a,{type:'start',force:true});assert.equal(l.status,'countdown');assert.equal(l.players.size,2);assert.equal(l.players.get(core.clientData(b).id).ready,false);
 advance(1000);send(b,{type:'loaded',loaded:true,mapId:'riviera',version:'v'});
 send(c,{type:'join',code:l.code,name:'PARROT'});assert.equal(c.messages.at(-1).type,'lobby');assert.equal(l.players.size,3);
 assert.deepEqual(core.publicLobby(l).players.map(p=>p.gridSlot),[0,1,2]);
 send(c,{type:'loaded',loaded:true,mapId:'riviera',version:'wrong'});assert.equal(core.clientData(c).loaded,false);
 send(c,{type:'loaded',loaded:true,mapId:'riviera',version:'v'});assert.equal(core.clientData(c).loaded,true);
 const old = l.raceId, generation=l.generation;
 send(a,{type:'restart'});assert.notEqual(l.raceId,old);assert.equal(l.generation,generation+1);assert.equal(l.players.size,3);
 advance();send(b,{type:'states',raceId:l.raceId,generation,states:[pose(30)]});assert.equal(core.clientData(b).state,null,'batched stale generations cannot hydrate the restarted run');
 assert.ok([...l.players.values()].every(p=>p.finish==null&&!p.course));
});
test('ordered checkpoint standings are identical on all clients and ignore local rendering/prediction', t => {
 const { core,clients:[a,b,c],send,lobby:l,advance }=setup(t);
 for(const ws of [b,c])send(ws,{type:'join',code:l.code});send(a,{type:'start',force:true});advance(1000);
 send(a,{type:'state',raceId:l.raceId,state:pose(70)});send(b,{type:'state',raceId:l.raceId,state:pose(90)});send(c,{type:'state',raceId:l.raceId,state:pose(140,80)});advance();
 const packets=[a,b,c].map(ws=>ws.messages.findLast(m=>m.type==='snapshot'));
 assert.deepEqual(packets[0].standings,packets[1].standings);assert.deepEqual(packets[1].standings,packets[2].standings);
 assert.equal(packets[0].standings[0].id,core.clientData(b).id,'valid checkpoint beats unpassed off-road cursor');
 assert.equal(packets[0].world.state.weather,'rain');assert.equal(packets[0].world.state.wet,1);
 const publicLobby=core.publicLobby(l);assert.equal(publicLobby.traffic,false);assert.equal(publicLobby.config.traffic,0);
 for(const ws of [a,b,c]) { const mp=Object.assign(Object.create(Multiplayer.prototype),{id:core.clientData(ws).id,lobby:publicLobby,peers:new Map()});assert.deepEqual(mp.ranking(9999).map(p=>p.id),packets[0].standings.map(p=>p.id)); }
});
test('attachment remains under 2KiB with full telemetry and accumulated enforcement; restores latest checkpoint cursor',t=>{
 const {core,clients:[a,b],send,lobby:l,opts,advance}=setup(t);send(b,{type:'join',code:l.code});send(a,{type:'start',force:true});advance(1000);
 const saved=structuredClone(core.exportState());
 send(a,{type:'state',raceId:l.raceId,state:{...pose(90),sampleTime:100.123456789,motionEpoch:2}});
 const client=core.clientData(a);client.enforcement={claims:Array.from({length:100},(_,i)=>['site'+i,{at:10000+i}])};client.state.tyreTelemetry={front:{utilization:.123456789123456},rear:{utilization:.456789123456789}};
 const old={...client};delete old.course;
 assert.ok(new TextEncoder().encode(JSON.stringify(old)).length>2048,'reproduces old attachment overflow');
 const bounded=socketAttachment(client);assert.ok(new TextEncoder().encode(JSON.stringify(bounded)).length<2048);
 const savedClient=saved.sessions.find(c=>c.id===client.id);Object.assign(savedClient,bounded);
 const restored=createGameCore(opts);restored.restore(saved,new Map([...core.clients].map(c=>[c.token,c.ws])));
 assert.equal(restored.clientData(a).course.passed,1);assert.equal(restored.clientData(a).course.previous.s,90);
});
test('contact slows rear-ending car, separates sides, ignores stale proxies and never launches vertically',()=>{
 const route={project:(x,z)=>({s:-z,u:x}),length:1000,edge:()=>5,point:(s,u)=>({x:u,y:0,z:-s})};
 const local={x:0,y:0,z:0,yaw:0,s:0,u:0,vLong:30,vLat:0,w:0,halfW:1,halfL:2,m:1500,route,damage:0,addDamage(){this.damage++;}};
 const remote={...local,z:-3,vLong:10};const contacts=new Map();
 const hits=resolvePlayerContacts(local,[{id:'remote',vehicle:remote}],1/60,1000,contacts);assert.equal(hits.length,1);assert.equal(local.vLong,22);assert.equal(local.y,0);assert.equal(local.damage,1);
 resolvePlayerContacts(local,[{id:'remote',vehicle:remote}],1/60,1016,contacts);assert.equal(local.damage,1,'continuous contact cannot repeatedly damage');
 assert.equal(resolvePlayerContacts(local,[{id:'remote',vehicle:remote,age:351}],1/60,2000).length,0);
 const side={...local,x:1.5,z:local.z,vLong:local.vLong};assert.ok(resolvePlayerContacts(local,[{id:'side',vehicle:side}],1/60,3000).length);
 local.s=1005;local.u=900;containOnlineVehicle(local,route);assert.equal(local.s,997);assert.equal(local.u,13);assert.equal(local.vLong,0);
});
