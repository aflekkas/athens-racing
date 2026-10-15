import { WebSocket } from 'ws';
import { MULTIPLAYER_PROTOCOL } from '../src/multiplayer-protocol.js';
import { reconnectDelay } from '../src/reconnect-history.js';
// Actual transport failures retain the token, waiters and last unacknowledged
// command. A resumed lobby is the acknowledgement, not a fabricated success.
export function smokeClient(base, name, { build, identity, recoveryMs = 85000 } = {}) {
  const inbox=[],waiters=new Set(),history=[];
  let ws,token,id,failure,ready=false,closing=false,retry,attempt=0,lostAt=0,reconnects=0,checkpoint=null,lastState,action,lobby,sequence=0;
  const emit=m=>{const w=[...waiters].find(w=>w.pred(m));if(w){waiters.delete(w);clearTimeout(w.timer);w.resolve(m);}else if(m.type!=='snapshot'&&m.type!=='checkpoint')inbox.push(m);};
  const fail=error=>{failure ||= error;ready=false;for(const w of waiters){clearTimeout(w.timer);w.reject(failure);}waiters.clear();};
  const wire=m=>{if(ws?.readyState!==WebSocket.OPEN)return false;try{ws.send(JSON.stringify(m));return true;}catch{schedule(ws);return false;}};
  const ack=m=>{
    if(!action)return;
    const own=m.lobby?.players.find(p=>p.id===id);
    if(action.type==='leave'&&m.type==='left'||['create','join'].includes(action.type)&&m.type==='lobby'&&own||action.type==='ready'&&m.type==='lobby'&&own?.ready===action.ready||['start','rematch'].includes(action.type)&&m.type==='lobby'&&m.lobby.status!=='waiting')action=null;
  };
  function schedule(socket){
    if(socket!==ws||closing||failure||retry)return;ready=false;lostAt ||= Date.now();
    if(Date.now()-lostAt>=recoveryMs)return fail(Error(`${name}: recovery exceeded ${recoveryMs}ms`));
    retry=setTimeout(()=>{retry=null;socket.terminate();connect();},reconnectDelay(attempt++));
  }
  function restored(m){
    if(!m) { lobby=null; history.length=0; }
    const transport=ws;
    if(m?.lobby){lobby=m.lobby;ack(m);emit(m);}
    const accepted=m?.state?.sampleTime ?? -Infinity;
    const pending=history.filter(s=>s.state.sampleTime>accepted&&s.raceId===lobby?.raceId);
    // Playback is bounded below the80/s protocol handler limit. Live smoke
    // samples pause until both clients have recovered and caught up.
    let at=0;const drain=()=>{
      if(closing||failure||ws!==transport||transport.readyState!==WebSocket.OPEN)return;
      const samples=pending.slice(at,at+2);at+=samples.length;
      if(samples.length)wire({type:'states',raceId:samples[0].raceId,generation:lobby.generation,states:samples.map(s=>s.state)});
      if(at<pending.length)setTimeout(drain,75);
      else{ready=true;lostAt=0;attempt=0;if(action)wire(action);}
    };drain();
  }
  function connect(){
    const url=new URL('/ws',base.replace(/^http/,'ws'));url.searchParams.set('protocol',MULTIPLAYER_PROTOCOL);if(build)url.searchParams.set('build',build);
    const socket=ws=new WebSocket(url,{origin:base});
    socket.on('error',()=>schedule(socket));
    socket.on('close',(code,reason)=>{if(socket!==ws||closing)return;if(code===4001)return fail(Error(`${name}: protocol update ${reason}`));schedule(socket);});
    socket.on('message',bytes=>{
      if(socket!==ws||closing||String(bytes)==='alive')return;
      let m;try{m=JSON.parse(bytes);}catch{return fail(Error(`${name}: invalid JSON`));}
      if(m.type==='reload'||m.type==='error')return fail(Error(`${name}: ${JSON.stringify(m)}`));
      if(m.type==='hello'){
        if(m.protocol!==MULTIPLAYER_PROTOCOL)return fail(Error(`${name}: incompatible protocol`));
        wire({type:'hello',protocol:MULTIPLAYER_PROTOCOL,...(build?{build}:{})});
        if(token){wire({type:'resume',token});return;}
        token=m.token;id=m.id;ready=true;attempt=0;lostAt=0;emit(m);return;
      }
      if(m.type==='session'){
        if(!m.resumed||m.id!==id)return fail(Error(`${name}: seat reservation lost`));
        reconnects++;console.log(JSON.stringify({proof:'transport resumed',name,reconnects,id}));
        if(!m.lobby){if(action?.type==='leave'){action=null;emit({type:'left'});}restored(null);}return;
      }
      if(m.type==='lobby')lobby=m.lobby;
      if(m.type==='lobby'&&m.resume){restored(m);return;}
      if(m.type==='checkpoint'){checkpoint=m;if(m.missed)return fail(Error(`${name}: legal smoke path rejected: ${JSON.stringify({checkpoint:m,lastState})}`));}
      ack(m);emit(m);
    });
  }
  connect();
  return {
    get ws(){return ws;},get available(){return ready&&!failure&&ws?.readyState===WebSocket.OPEN;},get reconnects(){return reconnects;},get checkpoint(){return checkpoint;},get lobby(){return lobby;},get id(){return id;},
    next:(pred,timeout=15000)=>new Promise((resolve,reject)=>{if(failure)return reject(failure);const i=inbox.findIndex(pred);if(i>=0)return resolve(inbox.splice(i,1)[0]);const w={pred,resolve,reject,timer:null,started:Date.now()};const check=()=>{if(!ready&&Date.now()-w.started<timeout+recoveryMs){w.timer=setTimeout(check,500);return;}waiters.delete(w);reject(Error(`${name}: message timeout; checkpoint=${JSON.stringify(checkpoint)}`));};w.timer=setTimeout(check,timeout);waiters.add(w);}),
    send:m=>{
      if(failure)throw failure;
      const packet={name,car:'mini',driverId:identity,...m};
      if(['create','join','ready','start','rematch','leave'].includes(m.type))action=packet;
      if(m.state||m.states){const states=(m.states||[m.state]).map(s=>({...s,sampleTime:++sequence}));for(const state of states)history.push({raceId:m.raceId,state});if(history.length>160)history.splice(0,history.length-160);lastState=states.at(-1);if(m.states)packet.states=states;else packet.state=states[0];}
      if(ready)wire(packet);
    },
    forceReset:()=>ws.terminate(),
    close:async()=>{closing=true;clearTimeout(retry);for(const w of waiters)clearTimeout(w.timer);waiters.clear();if(!ws||ws.readyState===WebSocket.CLOSED)return;await new Promise(resolve=>{const timer=setTimeout(()=>{ws.terminate();resolve();},3000);ws.once('close',()=>{clearTimeout(timer);resolve();});ws.close(1000,'Smoke complete');});}
  };
}
