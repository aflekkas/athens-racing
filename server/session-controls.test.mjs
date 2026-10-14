import { MULTIPLAYER_PROTOCOL } from '../src/multiplayer-protocol.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameCore } from './core.mjs';
const socket=()=>({readyState:1,messages:[],send(d){this.messages.push(JSON.parse(d))},close(){this.readyState=3}});
const state=(s,u=0)=>({x:s,y:0,z:u,s,u,yaw:0,vLong:20,vLat:0,steer:0,rpm:3000,gear:2});
const geometry={step:20,x:[0,20,40,60,80,100,120,140,160,180,200],z:Array(11).fill(0),y:Array(11).fill(0),lanes:Array(11).fill(1),div:Array(11).fill(0)};
const maps=new Map([['riviera',{track:{version:'v'},geometry,definitions:new Map([['quick',{id:'quick',type:'sprint',s0:0,s1:200,dir:1,len:200,checkpoints:[{s:100,d:100}]}]])}]]);
function setup(t){let now=100000;t.mock.method(Date,'now',()=>now);let core;const opts={maps,cars:new Set(['mini','z4']),leaderboard:{submit:async()=>{}},countdownMs:100};core=createGameCore(opts);const a=socket(),b=socket(),c=socket();for(const [s,ip]of [[a,'a'],[b,'b'],[c,'c']])core.connect(s,ip, { protocol: MULTIPLAYER_PROTOCOL });const send=(s,m)=>core.message(s,JSON.stringify(m));send(a,{type:'create'});const l=[...core.lobbies.values()][0];send(b,{type:'join',code:l.code,driverId:'guest-driver'});return {get core(){return core},a,b,c,l,send,advance(n=1100){now+=n;core.tick()},restore(){const data=JSON.parse(JSON.stringify(core.exportState())),sockets=new Map([...core.clients].map(c=>[c.token,c.ws]));core=createGameCore(opts);core.restore(data,sockets)}};}
test('host force starts connected unready drivers; permissions, stale reservations and repeat rate limit',t=>{const e=setup(t),{a,b,c,l,send}=e;send(c,{type:'join',code:l.code});e.core.disconnect(c);send(b,{type:'start',force:true});assert.match(b.messages.at(-1).message,/host/);send(a,{type:'start'});assert.match(a.messages.at(-1).message,/ready/);send(a,{type:'start',force:true});assert.equal(l.status,'countdown');assert.equal(l.players.size,2);assert.equal(l.racers.size,2);assert.ok([...l.players.values()].every(p=>p.ready));send(a,{type:'to-lobby'});send(a,{type:'start',force:true});assert.match(a.messages.at(-1).message,/wait/);e.advance();send(a,{type:'start',force:true});assert.equal(l.status,'countdown');});
test('kick cooldown survives reconnect, changed identity and DO hibernation; host unblocks',t=>{const e=setup(t),{a,b,c,l,send}=e,guest=[...l.players.values()][1];send(b,{type:'kick',id:l.host});assert.match(b.messages.at(-1).message,/host/);send(a,{type:'kick',id:l.host});assert.match(a.messages.at(-1).message,/another/);send(a,{type:'kick',id:guest.id});assert.ok(b.messages.some(m=>m.type==='kicked'));assert.equal(l.players.size,1);send(b,{type:'join',code:l.code,driverId:'guest-driver'});assert.equal(b.messages.at(-1).code,'KICK_COOLDOWN');e.restore();const replacement=socket();e.core.connect(replacement,'b', { protocol: MULTIPLAYER_PROTOCOL });send(replacement,{type:'join',code:l.code,driverId:'new-driver'});assert.equal(replacement.messages.at(-1).code,'KICK_COOLDOWN');send(a,{type:'unblock',id:guest.id});send(replacement,{type:'join',code:l.code});assert.equal(replacement.messages.at(-1).type,'lobby');send(a,{type:'kick',id:e.core.clientData(replacement).id});assert.match(a.messages.at(-1).message,/wait/);e.advance();send(a,{type:'kick',id:e.core.clientData(replacement).id});e.advance(30001);send(replacement,{type:'join',code:l.code});assert.equal(replacement.messages.at(-1).type,'lobby');});
test('car changes unready ready drivers, work after race/reconnect, obey filters and reject racing edits',t=>{const e=setup(t),{a,b,l,send}=e;send(b,{type:'ready',ready:true,version:'v'});send(b,{type:'car',car:'z4'});const guest=[...l.players.values()][1];assert.equal(guest.car,'z4');assert.equal(guest.ready,false);send(a,{type:'options',allowedCars:['mini'],config:{time:'invalid'}});assert.deepEqual(l.allowedCars,['mini','z4']);send(a,{type:'options',allowedCars:['mini']});assert.equal(guest.car,'mini');send(b,{type:'car',car:'z4'});assert.match(b.messages.at(-1).message,/allowed/);send(a,{type:'options',allowedCars:['mini','z4']});send(a,{type:'start',force:true});send(b,{type:'car',car:'z4'});assert.match(b.messages.at(-1).message,/started/);e.advance();for(const s of [a,b])send(s,{type:'dnf',raceId:l.raceId,reason:'retired'});assert.equal(l.status,'results');send(b,{type:'car',car:'z4'});assert.equal(guest.car,'z4');assert.equal(l.racers.get(guest.id).car,'mini');e.core.disconnect(b);const resumed=socket();e.core.connect(resumed,'b', { protocol: MULTIPLAYER_PROTOCOL });send(resumed,{type:'resume',token:guest.token});send(resumed,{type:'car',car:'mini'});assert.equal(guest.car,'mini');send(a,{type:'rematch'});send(resumed,{type:'ready',ready:false,car:'z4'});assert.equal(guest.car,'z4');});
test('side-road checkpoint skip cannot finish; go back through missing gate then complete ordered course',t=>{const e=setup(t),{a,b,l,send}=e;send(a,{type:'start',force:true});e.advance();const raceId=l.raceId;send(b,{type:'state',raceId,state:state(60,20)});e.advance();send(b,{type:'state',raceId,state:state(110,20)});assert.equal(e.core.clientData(b).course.passed,0);assert.equal(b.messages.at(-1).type,'checkpoint');assert.match(b.messages.at(-1).message,/MISSED CHECKPOINT/);e.advance();send(b,{type:'state',raceId,state:state(200)});assert.equal(e.core.clientData(b).finish,null);e.restore();assert.equal(e.core.clientData(b).course.passed,0);for(const s of [60,90,110,170,200]){e.advance();send(b,{type:'state',raceId,state:state(s)});}assert.ok(e.core.clientData(b).finish>0);});
test('teleported world position cannot count a gate with forged s/u',t=>{const e=setup(t),{a,b,l,send}=e;send(a,{type:'start',force:true});e.advance();send(b,{type:'state',raceId:l.raceId,state:{...state(85),x:5000}});assert.equal(e.core.clientData(b).finish,null);assert.equal(e.core.clientData(b).course.passed,0);});

test('real Quick Race never sends a missed warning on the legal bore and both drivers finish', async t => {
  const { readFile } = await import('node:fs/promises');
  const { resolveMap } = await import('./map-definitions.mjs');
  const { smokeDrive } = await import('../tools/deploy-smoke-route.mjs');
  const data = JSON.parse(await readFile(new URL('../data/map.json', import.meta.url)));
  const map = resolveMap({ id: 'riviera' }, data), event = map.definitions.get('quick');
  const drive = smokeDrive(event, map.geometry);
  let now = 100000;
  t.mock.method(Date, 'now', () => now);
  const core = createGameCore({ maps: new Map([['riviera', map]]), cars: new Set(['mini']),
    leaderboard: { submit: async () => {} }, countdownMs: 100 });
  const host = socket(), guest = socket(), send = (ws, m) => core.message(ws, JSON.stringify(m));
  core.connect(host, 'host', { protocol: MULTIPLAYER_PROTOCOL });
  core.connect(guest, 'guest', { protocol: MULTIPLAYER_PROTOCOL });
  send(host, { type: 'create', mapId: 'riviera', eventId: event.id });
  const lobby = [...core.lobbies.values()][0];
  send(guest, { type: 'join', code: lobby.code });
  send(host, { type: 'start', force: true });
  now += 100; core.tick();
  for (const state of drive.samples) {
    now += 100; core.tick();
    for (const ws of [host, guest]) send(ws, { type: 'state', raceId: lobby.raceId, state });
    if (state.s === 9500) for (const ws of [host, guest]) {
      const course = core.clientData(ws).course;
      assert.equal(course.passed, course.gates.findIndex(g => g.s === 9502));
      assert.equal(course.gates[course.passed].s, 9502);
      assert.equal(course.missed, false);
    }
  }
  for (const ws of [host, guest]) {
    assert.equal(ws.messages.some(m => m.type === 'checkpoint' && m.missed), false);
    assert.equal(ws.messages.some(m => m.type === 'error'), false);
    assert.equal(core.clientData(ws).course.passed, drive.checkpoints);
    assert.ok(Number.isFinite(core.clientData(ws).finish));
  }
  assert.equal(lobby.status, 'results');
});
