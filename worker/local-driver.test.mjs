import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { WebSocket } from 'ws';
import { cleanupLegacyStorage, LEGACY_TABLES } from './legacy-storage.mjs';
import { MULTIPLAYER_PROTOCOL } from '../src/multiplayer-protocol.js';
test('one-time SQLite cleanup removes retired tables and preserves arena, leaderboard and unrelated data',async()=>{
 const db=new DatabaseSync(':memory:'),kv=new Map([['arena',{sessions:[{token:'resume'}]}]]);let drops=0;
 for(const table of [...LEGACY_TABLES,'leaderboard','post_limits']){db.exec(`CREATE TABLE ${table} (value TEXT)`);db.prepare(`INSERT INTO ${table} VALUES (?)`).run('existing');}
 const storage={get:async k=>kv.get(k),put:async(k,v)=>kv.set(k,v),sql:{exec:q=>{drops++;return db.exec(q);}},transactionSync:fn=>{db.exec('BEGIN');try{fn();db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}}};
 await cleanupLegacyStorage(storage);assert.equal(drops,LEGACY_TABLES.length);assert.deepEqual(kv.get('arena'),{sessions:[{token:'resume'}]});
 for(const table of LEGACY_TABLES)assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name=?").get(table),undefined);
 for(const table of ['leaderboard','post_limits'])assert.equal(db.prepare(`SELECT value FROM ${table}`).get().value,'existing');
 await cleanupLegacyStorage(storage);assert.equal(drops,LEGACY_TABLES.length);db.close();
});
const base=process.env.ASR_TEST_BASE;
test('live Worker has no identity APIs or cookies; independent local names start an MP race',{skip:!base,timeout:30000},async t=>{
 for(const path of ['/api/me','/api/username','/api/accounts/create','/api/accounts/recover','/api/auth/ticket','/api/friends','/api/recent','/api/customization','/auth/google/start','/auth/logout']){
  for(const method of ['GET','POST']){const r=await fetch(base+path,{method});assert.equal(r.status,404,method+' '+path);assert.equal(r.headers.get('set-cookie'),null);}
 }
 const client=async()=>{
  const ws=new WebSocket(base.replace(/^http/,'ws')+'/ws?protocol='+MULTIPLAYER_PROTOCOL),inbox=[],waiters=[];
  t.after(()=>ws.terminate());ws.on('message',data=>{const m=JSON.parse(data),i=waiters.findIndex(w=>w.pred(m));if(i<0)inbox.push(m);else waiters.splice(i,1)[0].resolve(m);});
  const next=pred=>new Promise((resolve,reject)=>{const i=inbox.findIndex(pred);if(i>=0)return resolve(inbox.splice(i,1)[0]);const timer=setTimeout(()=>reject(Error('Worker message timeout')),12000);waiters.push({pred,resolve:m=>{clearTimeout(timer);resolve(m);}});});
  const hello=await next(m=>m.type==='hello');return{ws,hello,next,send:m=>ws.send(JSON.stringify(m))};
 };
 const a=await client(),b=await client();assert.notEqual(a.hello.id,b.hello.id);
 a.send({type:'create',name:'ABC',mapId:'penteli',car:'mini',private:true});let l=(await a.next(m=>m.type==='lobby')).lobby;
 b.send({type:'join',code:l.code,name:'ABC',car:'carrera'});l=(await b.next(m=>m.type==='lobby')).lobby;assert.deepEqual(l.players.map(p=>p.plate),['ABC','ABC']);
 b.send({type:'name',name:'a-wwwwwwwwwwww-z'});l=(await a.next(m=>m.type==='lobby'&&m.lobby.players.some(p=>p.plate==='A-WWWWWWWWWWWW-Z'))).lobby;
 assert.equal(l.players[1].name,'A-WWWWWWWWWWWW-Z');b.send({type:'name',name:'bad name'});assert.match((await b.next(m=>m.type==='error')).message,/Invalid message/);
 a.send({type:'start',force:true});const start=(await b.next(m=>m.type==='lobby'&&m.lobby.status==='countdown')).lobby;
 const race=(await a.next(m=>m.type==='lobby'&&m.lobby.status==='race')).lobby;assert.equal(race.raceId,start.raceId);assert.deepEqual(race.players.map(p=>p.name),['ABC','A-WWWWWWWWWWWW-Z']);
 // Refreshing a transport resumes the same racer, without an account cookie or auth ticket.
 const again=await client();again.send({type:'resume',token:a.hello.token});const resumed=await again.next(m=>m.type==='session');assert.equal(resumed.id,a.hello.id);assert(resumed.resumed);
 l=(await again.next(m=>m.type==='lobby')).lobby;assert.equal(l.players.find(p=>p.id===resumed.id).plate,'ABC');
 again.send({type:'leave'});b.send({type:'leave'});
});
