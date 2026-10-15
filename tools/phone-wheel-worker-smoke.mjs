// Actual local Wrangler Worker + Durable Object + built assets (no deployment).
import assert from 'node:assert/strict';
import {writeFile,mkdir} from 'node:fs/promises';
import WebSocket from 'ws';
import {encodeWheel,decodeWheel} from '../src/phone-wheel-packet.js';
const base=process.argv[2]||'http://127.0.0.1:19873', out=process.argv[3]||'.scratch/phone-wheel/worker-report.json';
const clients=[];
function open(room,role,token) {
  return new Promise((resolve,reject)=>{
    const url=new URL('/api/wheel/ws',base);url.protocol=url.protocol==='https:'?'wss:':'ws:';url.search=new URLSearchParams({c:room.code,role,...(token?{token}:{})});
    const ws=new WebSocket(url);clients.push(ws);ws.messages=[];ws.on('message',(value,binary)=>ws.messages.push({value,binary}));ws.once('error',reject);ws.once('open',()=>resolve(ws));
  });
}
async function until(predicate,label) {const end=Date.now()+10000;while(!predicate()){if(Date.now()>end)throw Error('Timed out: '+label);await new Promise(r=>setTimeout(r,10));}}
const report={base,checks:[]};
try {
  const response=await fetch(base+'/api/wheel',{method:'POST'});assert.equal(response.status,200);const room=await response.json();assert.equal(room.code.length,8);assert.match(response.headers.get('cache-control'),/no-store/);
  const html=await fetch(base+'/wheel?c='+room.code,{redirect:'manual'});assert.equal(html.status,200);const document=await html.text();assert.match(document,/wheel-controller/);const entry=/src="([^"]+phone-wheel-controller[^"]+\.js)"/.exec(document)?.[1];assert.ok(entry);assert.ok((await fetch(new URL(entry,base))).ok);report.checks.push('built /wheel serves 200 without redirect and its bundled controller loads');
  assert.equal((await fetch(base+'/api/wheel',{method:'POST',headers:{Origin:'https://other.invalid'}})).status,403);report.checks.push('cross-origin creation rejected');
  const game=await open(room,'game',room.token),phone=await open(room,'phone');await until(()=>game.messages.length&&phone.messages.length,'paired');assert.equal(JSON.parse(game.messages[0].value).type,'paired');
  const duplicateStatus=await new Promise((resolve,reject)=>{const url=new URL('/api/wheel/ws',base);url.protocol='ws:';url.search=new URLSearchParams({c:room.code,role:'phone'});const ws=new WebSocket(url);clients.push(ws);ws.on('error',()=>{});ws.on('unexpected-response',(_,response)=>{resolve(response.statusCode);ws.terminate();});ws.on('open',()=>reject(Error('Duplicate phone accepted')));});assert.equal(duplicateStatus,409);assert.equal(game.readyState,WebSocket.OPEN);report.checks.push('one phone enforced without disturbing paired game');
  phone.send(encodeWheel({steer:.75,throttle:.8},7));await until(()=>game.messages.some(m=>m.binary),'binary relay');const packet=decodeWheel(game.messages.find(m=>m.binary).value);assert.ok(packet.steer>.74);assert.ok(packet.throttle>.79);report.checks.push('real DO binary relay reaches game');
  game.send(JSON.stringify({type:'signal',data:{test:'offer'}}));await until(()=>phone.messages.some(m=>!m.binary&&m.value.toString().includes('offer')),'signalling');report.checks.push('real DO signalling reaches phone');
  phone.send(JSON.stringify({type:'unpair'}));await until(()=>game.readyState===WebSocket.CLOSED&&phone.readyState===WebSocket.CLOSED,'unpair');report.checks.push('phone unpair closes both sockets');
  const next=await(await fetch(base+'/api/wheel',{method:'POST'})).json(),g=await open(next,'game',next.token),p=await open(next,'phone');await until(()=>g.messages.length,'second pairing');g.close(1000,'Game left');await until(()=>p.messages.some(m=>!m.binary&&JSON.parse(m.value).type==='unpaired')&&p.readyState!==WebSocket.OPEN,'game disconnect notification');report.checks.push('game disconnect notifies phone immediately and starts close handshake');
  report.pass=true;
} finally {for(const ws of clients)ws.terminate();await mkdir(out.slice(0,out.lastIndexOf('/')),{recursive:true});await writeFile(out,JSON.stringify(report,null,2));}
console.log(JSON.stringify(report,null,2));
