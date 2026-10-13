import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { createGameServer } from '../server/index.js';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function harness(t, options = {}) {
  const {shortTrack, ...settings} = options;
  if (shortTrack) {
    const root=mkdtempSync(join(tmpdir(),'paraliaki-test-'));mkdirSync(join(root,'data'));
    writeFileSync(join(root,'data/map.json'),JSON.stringify({route:{start:819,finish:919}}));
    settings.root=root;t.after(()=>rmSync(root,{recursive:true,force:true}));
  }
  const game = createGameServer({ countdownMs: 80, tickMs: 10, ...settings });
  await new Promise(resolve => game.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${game.server.address().port}`;
  t.after(() => game.close());
  async function client() {
    const ws = new WebSocket(base.replace('http:', 'ws:') + '/ws'); const history = [];
    ws.on('message', raw => history.push(JSON.parse(raw)));
    await new Promise((resolve,reject) => { ws.once('open', resolve); ws.once('error', reject); });
    const wait = async predicate => { const end = Date.now() + 2000; while (Date.now() < end) { const m = history.find(predicate); if (m) return m; await new Promise(r => setTimeout(r,10)); } throw new Error('Timed out: ' + JSON.stringify(history.slice(-3))); };
    const welcome = await wait(m => m.type === 'welcome');
    return { ws, history, id: welcome.playerId, send(m) { ws.send(JSON.stringify(m)); }, wait, room(phase, count) { return wait(m => m.type === 'room' && m.room.phase === phase && (count === undefined || m.room.players.length === count)); } };
  }
  return { game, base, client };
}

test('public discovery, private codes, full capacity, safe static serving', async t => {
  const { base, client } = await harness(t);
  const host = await client(); host.send({ type: 'create', name: '<Host>', lobbyName: 'Public', car: 'mini' });
  const room = (await host.room('waiting',1)).room;
  const guest = await client(); assert.equal((await guest.wait(m => m.type === 'lobbies')).lobbies[0].code, room.code);
  for (let i=0; i<7; i++) { const p = i===0 ? guest : await client(); p.send({ type:'join', code:room.code, name:'Driver '+i }); await p.room('waiting',i+2); }
  const extra = await client(); extra.send({ type:'join',code:room.code }); assert.match((await extra.wait(m=>m.type==='error')).message,/full/);
  const hidden = await client(); hidden.send({type:'create',public:false,lobbyName:'Private'}); const privateRoom = (await hidden.room('waiting',1)).room;
  assert.equal((await (await fetch(base+'/api/lobbies')).json()).lobbies.some(r=>r.code===privateRoom.code),false);
  extra.history.length=0; extra.send({type:'join',code:privateRoom.code.toLowerCase(),name:'Friend'}); await extra.room('waiting',2);
  assert.equal((await fetch(base+'/server/index.js')).status,404);
  assert.equal((await fetch(base+'/.git/config')).status,404);
  assert.equal((await fetch(base+'/src/main.js')).status,200);
});

test('host authority, ready gating, shared race ID, state relay, invalid movement, DNF and rematch', async t => {
  const { game, client } = await harness(t,{shortTrack:true});
  const a=await client(), b=await client();
  a.send({type:'create',name:'Alice'}); const code=(await a.room('waiting',1)).room.code;
  b.send({type:'join',code,name:'Bob',car:'poseidon'}); await b.room('waiting',2);
  b.send({type:'start'}); assert.match((await b.wait(m=>m.type==='error')).message,/host/);
  a.send({type:'start'}); assert.match((await a.wait(m=>m.type==='error')).message,/ready/);
  a.send({type:'ready',ready:true}); b.send({type:'ready',ready:true}); await a.wait(m=>m.type==='room'&&m.room.players.length===2&&m.room.players.every(p=>p.ready));
  a.send({type:'start'}); const ar=(await a.room('racing')).room, br=(await b.room('racing')).room;
  assert.equal(ar.raceId,br.raceId); assert.equal(ar.startAt,br.startAt);
  const state={s:ar.track.start+5,u:4,yaw:0,vLong:20,vLat:0,steer:0,rpm:3000,gear:2};
  a.send({type:'state',raceId:ar.raceId,state}); const snap=await b.wait(m=>m.type==='snapshot'&&m.players.find(p=>p.id===a.id)?.state);
  assert.equal(snap.players.find(p=>p.id===a.id).state.s,state.s);
  a.send({type:'state',raceId:ar.raceId,state:{...state,s:ar.track.finish}}); await new Promise(r=>setTimeout(r,30)); assert.equal(game.rooms.get(code).players.get(a.id).finish,null);
  a.send({type:'state',raceId:'stale',state:{...state,s:state.s+2}}); a.send({type:'state',raceId:ar.raceId,state:{...state,u:1e99}}); await new Promise(r=>setTimeout(r,30)); assert.equal(game.rooms.get(code).players.get(a.id).state.s,state.s);
  // The fixture is a 100 m sprint. Wait for valid travel time before crossing the line.
  await new Promise(r=>setTimeout(r,1000));
  a.send({type:'state',raceId:ar.raceId,state:{...state,s:ar.track.finish}}); await a.wait(m=>m.type==='room'&&m.room.players.find(p=>p.id===a.id)?.finish!==null&&m.room.players.find(p=>p.id===a.id)?.finish!==undefined);
  b.ws.close(); const result=(await a.room('results')).room; assert.equal(result.players.find(p=>p.id===b.id).dnf,true); assert.ok(result.players.find(p=>p.id===a.id).finish>0);
  a.send({type:'rematch'}); await a.wait(m=>m.type==='room'&&m.room.phase==='waiting'&&m.room.players.length===1&&!m.room.players[0].ready);
});

test('host departure transfers ownership and countdown cancels with one remaining driver', async t => {
  const { client }=await harness(t,{countdownMs:500}); const a=await client(), b=await client();
  a.send({type:'create'}); const code=(await a.room('waiting',1)).room.code; b.send({type:'join',code}); await b.room('waiting',2);
  a.send({type:'ready',ready:true}); b.send({type:'ready',ready:true}); await a.wait(m=>m.type==='room'&&m.room.players.every(p=>p.ready)&&m.room.players.length===2);
  a.send({type:'start'}); await b.room('countdown'); a.ws.close();
  const r=(await b.wait(m=>m.type==='room'&&m.room.phase==='waiting'&&m.room.hostId===b.id)).room;
  assert.equal(r.players.length,1); assert.equal(r.players[0].ready,false);
});

test('race deadline finishes all remaining drivers as DNF', async t=>{
  const { client }=await harness(t,{raceLimitMs:80}); const a=await client(),b=await client(); a.send({type:'create'}); const code=(await a.room('waiting',1)).room.code;
  b.send({type:'join',code}); await b.room('waiting',2); a.send({type:'ready',ready:true}); b.send({type:'ready',ready:true}); await a.wait(m=>m.type==='room'&&m.room.players.length===2&&m.room.players.every(p=>p.ready));
  a.send({type:'start'}); const r=(await a.room('results')).room; assert.ok(r.players.every(p=>p.dnf));
});

test('a finished driver keeps their result when leaving before the other driver finishes', async t=>{
  const {game,client}=await harness(t,{shortTrack:true}); const a=await client(),b=await client();
  a.send({type:'create'});const code=(await a.room('waiting',1)).room.code;b.send({type:'join',code});await b.room('waiting',2);
  a.send({type:'ready',ready:true});b.send({type:'ready',ready:true});await a.wait(m=>m.type==='room'&&m.room.players.length===2&&m.room.players.every(p=>p.ready));
  a.send({type:'start'});const r=(await b.room('racing')).room;
  const room=game.rooms.get(code);
  await new Promise(r=>setTimeout(r,1000));
  const state={s:r.track.finish,u:4,yaw:0,vLong:0,vLat:0,steer:0,rpm:850,gear:1};
  a.send({type:'state',raceId:r.raceId,state});await b.wait(m=>m.type==='room'&&m.room.players.find(p=>p.id===a.id)?.finish!=null);
  a.ws.close();await b.wait(m=>m.type==='room'&&m.room.hostId===b.id);
  assert.equal(room.players.get(a.id).dnf,false);
  room.endAt=Date.now();const results=(await b.room('results')).room;
  const winner=results.players.find(p=>p.id===a.id);
  assert.ok(winner.finish!==null&&!winner.dnf);
  assert.equal(results.players.find(p=>p.id===b.id).dnf,true);
});
