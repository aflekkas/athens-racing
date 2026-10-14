// Accepted/relayed/restored race state ignores legacy decal descriptors while
// retaining bounded paint and driver appearance. No customization dependency.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameCore } from './core.mjs';
test('race appearance retains paint/driver but drops incoming and saved decals', t => {
  let now=100000;t.mock.method(Date,'now',()=>now);
  const maps=new Map([['riviera',{track:{version:'fixture'},definitions:new Map([['quick',{id:'quick',type:'sprint',s0:0,s1:1000,dir:1,len:1000}]])}]]);
  const opts={maps,cars:new Set(['mini']),leaderboard:{submit:async()=>({})},countdownMs:100};
  const core=createGameCore(opts),socket=()=>({readyState:1,messages:[],send(s){this.messages.push(JSON.parse(s))},close(){}}),a=socket(),b=socket();core.connect(a,'a');core.connect(b,'b');const send=(ws,m)=>core.message(ws,JSON.stringify(m));send(a,{type:'create'});send(b,{type:'join',code:[...core.lobbies.keys()][0]});send(a,{type:'start',force:true});now+=101;core.tick();const raceId=[...core.lobbies.values()][0].raceId;
  const state={x:2,y:0,z:0,yaw:0,s:2,u:0,vLong:0,vLat:0,steer:0,rpm:900,gear:1,paint:'#2288AA',decals:[['photo','legacy-secret']],driver:{shirt:'#123456',hairStyle:'short',helmet:true,email:'not-public'}};
  send(a,{type:'state',raceId,state});core.tick();const received=b.messages.at(-1).players.find(p=>p.state)?.state;assert.equal(received.paint,'#2288aa');assert.equal(received.driver.shirt,'#123456');assert.equal(received.driver.helmet,true);assert.ok(!('email' in received.driver));assert.ok(!('decals' in received));assert.ok(!JSON.stringify(b.messages.at(-1)).includes('legacy-secret'));
  const saved=JSON.parse(JSON.stringify(core.exportState()));saved.sessions.find(c=>c.state).state.decals=state.decals;const restored=createGameCore(opts);restored.restore(saved,new Map([...core.clients].map(c=>[c.token,c.ws])));const resumed=[...restored.clients].find(c=>c.state);assert.equal(resumed.state.driver.hairStyle,'short');assert.equal(resumed.state.paint,'#2288aa');assert.ok(!('decals' in resumed.state));
});
