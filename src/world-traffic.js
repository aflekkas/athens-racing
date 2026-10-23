import {roadLayersConnect} from './world-tile-graph.js';
import {Traffic} from './traffic.js';
import {edgePoint,projectEdge,edgeLength} from './route-geometry.js';
import {resolveCarPair,bodyOffset,carOverlap} from './crash-contact.js';
import {HeatMachine,policeTuning,pursuit,encodePursuit,decodePursuit} from './police.js';
import {events} from './events.js';
import {prewarmFleet} from './fleet-prewarm.js';
import {worldOwner} from './shared-world-protocol.js';
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
// Samples at a curve knot carry that knot's road identity. Snapping tiny
// interpolation roundoff keeps the exact layer boundary usable in both directions.
function turnPoint(turn,progress){
 const i=Math.max(1,turn.points.findIndex(p=>p.s>=progress)),a=turn.points[i-1],b=turn.points[i],t=(progress-a.s)/(b.s-a.s||1);
 if(t<1e-8)return {...a};if(t>1-1e-8)return {...b};
 return {...a,x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,z:a.z+(b.z-a.z)*t,yaw:a.yaw+Math.atan2(Math.sin(b.yaw-a.yaw),Math.cos(b.yaw-a.yaw))*t};
}

/** A legal civilian successor may leave the selected race. No route-successor shortcut. */
export function trafficSuccessors(graph,edge,closures){return [...(graph.outgoing.get(edge.to)||[])].map(id=>graph.edges.get(id)?.value).filter(e=>e&&e.to!==edge.from&&roadLayersConnect(edge,e)&&graph.legal(edge.id,e)&&!closures?.blocksEdge(e));}
export class WorldTraffic {
 constructor(session,scene,route,{closures,poolSize=24,policePoolSize=5,focusProvider}={}){Object.assign(this,{session,scene,route,closures,poolSize,policePoolSize,focusProvider});this.onlineTargets=new Map();this.onlineDriver=null;this.onlineAuthority=false;this.focusCursor=0;this.pool=null;this.cars=[];this.widthCache=new Map();this.laneCache=new Map();this.pathCache=new Map();this.avoidEdges=new Map();this.sites=[];this.level=0;this.disabled=true;this.t=0;this.spawnT=0;this.hm=new HeatMachine();this.policeEnabled=false;this.wrecks=[];this.honks=[];this.sounds=[];}
 configure(def,{deferFleet=false}={}){this.definition=def;this.level=clamp(def.traffic??0,0,2);this.disabled=this.level===0;this.policeEnabled=def.rules?.police===true;this.tuning=policeTuning(def.rules?.policeLevel,def.rules?.busted);this.hm=new HeatMachine(this.tuning);this.onlineTargets.clear();this.onlineDriver=null;this.onlineAuthority=false;this.pendingCopFocus=null;this.focusCursor=0;this.crossedRed=null;this.spawnT=0;this.widthCache.clear();this.laneCache.clear();this.pathCache.clear();this.avoidEdges.clear();
  if(!deferFleet&&(this.level>0||this.policeEnabled)&&!this.pool){this.pool=new Traffic(this.scene,{closed:true},{},{poolSize:this.poolSize,policePoolSize:this.policePoolSize,roadVehiclesOnly:true});this.cars=this.pool.cars;}
  for(const c of this.cars){if(c.police)c.cop||={};c.active=false;c.crashed=false;c.targetId=null;if(c.cop)Object.assign(c.cop,{target:null,chase:false,siren:false});c.m.root.visible=false;c.point=null;c.vehicle=null;}
  Object.assign(pursuit,{enabled:this.policeEnabled,state:this.policeEnabled?'idle':'off',heat:0,level:0,bustMeter:0,evadeMeter:0,units:0});
 }

 // Online law judgment is local to each accepted driver. This never advances
 // traffic; replicas may call it against received units without running NPC AI.
 updateOnlineDriver(dt,{id,player,gridSlot,crossedRed=null}={}){
  if(!id||!player||!Number.isInteger(gridSlot)||gridSlot<0||gridSlot>7){this.onlineDriver=null;this.hm.reset();this.crossedRed=null;return;}
  if(this.onlineDriver?.id!==id||this.onlineDriver.gridSlot!==gridSlot)this.hm.reset();
  this.onlineDriver={id,player,gridSlot};this.crossedRed=crossedRed;this.updatePolice(dt,player);
 }
 pursuitCode(){return this.policeEnabled?encodePursuit(this.hm.state,this.hm.level,this.hm.time):0;}
 // Only the elected authority advances shared NPCs. The provider supplies actual
 // accepted vehicles; membership and slot ownership are checked again here.
 updateOnlineAuthority(dt,{lobby,id,player,actors=[],peers}={}){
  if(worldOwner(lobby)!==id)return false;
  const members=new Map((Array.isArray(lobby.players)?lobby.players:[...lobby.players.values()]).filter(p=>p.loaded===true&&p.connected!==false&&!p.dnf).map(p=>[p.id,p]));
  const rows=this.focusProvider?.({lobby,id,player,actors,peers})||[{id,vehicle:player,accepted:true,gridSlot:members.get(id)?.gridSlot,local:true}];
  const targets=new Map(),slots=new Set();
  for(const row of rows){const member=members.get(row.id),v=row.vehicle,peer=peers?.get?.(row.id);
   if(row.accepted!==true||!member||row.gridSlot!==member.gridSlot||!Number.isInteger(row.gridSlot)||row.gridSlot<0||row.gridSlot>7||slots.has(row.gridSlot)||targets.has(row.id)||!v||!['x','y','z','yaw','vLong'].every(k=>Number.isFinite(v[k])))continue;
   if(row.id!==id&&!peer?.state&&row.pursuit==null)continue;
   const code=row.id===id?this.pursuitCode():peer?.state?.pursuit??row.pursuit;
   targets.set(row.id,{id:row.id,vehicle:v,gridSlot:row.gridSlot,...decodePursuit(code)});slots.add(row.gridSlot);
  }
  this.onlineAuthority=true;this.onlineTargets=targets;this.dispatchOnline();
  const focus=targets.get(id)?.vehicle||targets.values().next().value?.vehicle;if(!focus)return true;
  const all=[...new Set([...actors,...[...targets.values()].map(t=>t.vehicle)])];
  this.update(dt,focus,all);this.dispatchOnline();return true;
 }
 policeFocus(c,player){
  if(this.onlineAuthority){const t=this.onlineTargets.get(c.targetId);return t?{player:t.vehicle,state:t.state,active:t.state==='pursuit'||t.state==='cooldown'}:{player,state:'idle',active:false};}
  return {player,state:this.hm.state,active:this.hm.active};
 }
 dispatchOnline(){
  const targets=[...this.onlineTargets.values()],units=this.cars.filter(c=>c.active&&c.police&&!c.crashed),assigned=id=>units.filter(c=>c.targetId===id);
  for(const c of units){if(c.targetId==null)c.targetId=targets.find(t=>t.gridSlot===c.cop?.target)?.id??null;}
  for(const c of units)if(!this.onlineTargets.has(c.targetId)){c.targetId=null;c.cop={...c.cop,chase:false,siren:false,target:null};}
  const rank=t=>t.state==='pursuit'?3:t.state==='cooldown'?2:t.state==='warning'?1:0;
  const want=t=>t.state==='idle'?1:t.state==='warning'?1:Math.min(this.tuning.maxChasers,1+t.level);
  // Give every live driver a patrol before adding reinforcements to a chase.
  for(const t of targets)for(const c of assigned(t.id).slice(want(t)))c.targetId=null;
  const order=()=>[...targets].sort((a,b)=>assigned(a.id).length-assigned(b.id).length||rank(b)-rank(a)||String(a.id).localeCompare(String(b.id)));
  for(const c of units.filter(c=>!c.targetId)){const t=order().find(t=>assigned(t.id).length<want(t))||order()[0];if(t)c.targetId=t.id;}
  for(const c of units){const t=this.onlineTargets.get(c.targetId);c.cop={...c.cop,target:t?.gridSlot??null,chase:!!t&&t.state!=='idle',siren:!!t&&t.state!=='idle'};}
  this.pendingCopFocus=this.policeEnabled?order().find(t=>assigned(t.id).length<want(t))||null:null;
 }
 async warmFleet(ready=()=>true){
  if(this.pool||!this.definition||!(this.level>0||this.policeEnabled))return;
  if(this.fleetWarming)return this.fleetWarming;
  const pool=this.warmingPool=new Traffic(this.scene,{closed:true},{},{poolSize:this.poolSize,policePoolSize:this.policePoolSize,roadVehiclesOnly:true,deferBuild:true,buildProxies:false});
  this.fleetWarmMetrics={maxStepMs:0};this.fleetController=new AbortController();
  this.fleetWarming=prewarmFleet(pool.build,{ready,disposed:()=>this.disposed,signal:this.fleetController.signal,metrics:this.fleetWarmMetrics}).then(()=>{this.pool=pool;this.cars=pool.cars;this.configure(this.definition);}).catch(error=>{releaseFleet(pool);throw error;}).finally(()=>{this.warmingPool=null;this.fleetWarming=null;this.fleetController=null;});
  return this.fleetWarming;
 }
 // Junction mouths widen the asphalt, not the lane. Keep one offset through
 // the edge instead of jumping sideways every time a 4 m width bucket changes.
 laneOffset(edge,c){const key=edge.id+':'+c.wid,revision=this.session.roads.graph.revision,old=this.laneCache.get(key);if(old?.edge===edge&&old.revision===revision)return old.u;
  const length=edgeLength(edge),widths=[.25,.5,.75].map(t=>this.session.roads.width(edgePoint(edge,length*t),{radius:12,bounded:true,connected:true})).filter(Boolean);
  if(widths.length!==3)return null;const width=widths.sort((a,b)=>a.width-b.width)[0],twoWay=!(edge.flags&1);
  if(width.width<(twoWay?2:1)*(c.wid+.4))return null;
  // The emitted lane count is directional; wider junction asphalt is not another lane.
  const opposite=twoWay?[...(this.session.roads.graph.outgoing.get(edge.to)||[])].map(id=>this.session.roads.graph.edges.get(id)?.value).find(e=>e&&e.id!==edge.id&&e.to===edge.from&&e.layer===edge.layer&&e.surface===edge.surface&&!(e.flags&1)):null;
  const share=twoWay?(edge.lanes>0&&opposite?.lanes>0?edge.lanes/(edge.lanes+opposite.lanes):.5):1,span=width.width*share,divider=width.right-span;
  if(span<c.wid+.4)return null;
  const lanes=Math.max(1,Math.min(Math.floor(edge.lanes)||1,Math.floor(span/(c.wid+.4)))),laneWidth=span/lanes,u=width.right-laneWidth/2;
  if(this.laneCache.size>=4096)this.laneCache.delete(this.laneCache.keys().next().value);this.laneCache.set(key,{edge,revision,u,width,lanes,laneWidth,divider});return u;
 }
 candidate(edge,offset,c){const p=edgePoint(edge,offset),key=edge.id+':'+Math.floor(offset/2)+':'+c.wid+':'+c.len+':'+(c.laneShift||0)+':'+this.session.roads.graph.revision,cached=this.widthCache.get(key);if(cached?.failureUntil>this.t)return null;
  const reject=()=>{if(this.widthCache.size>=4096)this.widthCache.delete(this.widthCache.keys().next().value);this.widthCache.set(key,{failureUntil:this.t+1});return null;},base=this.laneOffset(edge,c);if(base==null)return reject();const u=base+(c.laneShift||0);
  p.x+=p.rx*u;p.z+=p.rz*u;const contact=this.session.stream.contact(p.x,p.z,{referenceY:p.y,layer:edge.layer,requiredFlags:1});if(!contact)return reject();p.y=contact.y;p.surfaceId=contact.surfaceId;p.edge=edge.id;p.edgeId=edge.id;
  if(cached!==true){if(!this.session.safePose(p,{halfWidth:c.wid/2,halfLength:c.len/2})||this.closures?.safe(p,{halfWidth:c.wid/2,halfLength:c.len/2})===false)return reject();if(this.widthCache.size>=4096)this.widthCache.delete(this.widthCache.keys().next().value);this.widthCache.set(key,true);}
  for(const a of [-c.len/2,0,c.len/2])for(const b of [-c.wid/2,0,c.wid/2])if(!this.session.stream.contact(p.x-Math.sin(p.yaw)*a+Math.cos(p.yaw)*b,p.z-Math.cos(p.yaw)*a-Math.sin(p.yaw)*b,{referenceY:p.y,layer:edge.layer,requiredFlags:1}))return reject();return p;
 }
 // The geometric midpoint need not be the physical edge of a deck or tunnel.
 // Only the two legally joined road layers may supply a curve's live contact.
 turnContact(p,from,to){
  if(from.layer!==to.layer&&(!roadLayersConnect(from,to)||!this.session.roads.graph.legal(from.id,to)))return null;
  const first=p.edgeId===to.id?to:from,other=first===from?to:from;
  for(const edge of from.layer===to.layer?[first]:[first,other]){
   const contact=this.session.stream.contact(p.x,p.z,{referenceY:p.y,layer:edge.layer,requiredFlags:1});
   if(!contact||contact.layer!=null&&contact.layer!==edge.layer)continue;
   if(from.layer!==to.layer&&contact.surfaceId!==edge.surface&&this.session.roads.connected?.(edge).get(contact.surfaceId)!==edge.layer)continue;
   return {...p,y:contact.y,surfaceId:contact.surfaceId,layer:edge.layer,edgeId:edge.id};
  }
  return null;
 }
 // Join the two lane centres with a checked curve before the graph node. An
 // instantaneous edge switch moves and rotates an entire car into the junction.
 turnPaths(edge,c){
  const key=edge.id+':'+c.wid+':'+c.len+':'+(c.laneShift||0),revision=this.session.roads.graph.revision,cached=this.pathCache.get(key);if(cached?.edge===edge&&cached.revision===revision&&(cached.paths.length||cached.until>this.t))return cached.paths;
  if(this.pathCache.size>=2048)this.pathCache.delete(this.pathCache.keys().next().value);
  const entry=edgeLength(edge)-Math.min(8,edgeLength(edge)*.4),a=this.candidate(edge,entry,c);if(!a){this.pathCache.set(key,{edge,revision,paths:[],until:this.t+1});return [];}
  const paths=[],incoming=this.laneCache.get(edge.id+':'+c.wid),currentLane=Math.max(0,Math.round(-(c.laneShift||0)/(incoming?.laneWidth||1)));
  for(const next of trafficSuccessors(this.session.roads.graph,edge,this.closures)){
   // Lane counts are directional. Unknown tags expose only the conservative
   // default lane; never invent an opposing or undeclared continuation.
   if(this.laneOffset(next,c)==null)continue;const lane=this.laneCache.get(next.id+':'+c.wid),preferred=Math.min(currentLane,lane.lanes-1);
   const choices=Array.from({length:lane.lanes},(_,i)=>i).sort((a,b)=>Math.abs(a-preferred)-Math.abs(b-preferred));
   for(const index of choices){
   const exitShift=-index*lane.laneWidth,exit=Math.min(8,edgeLength(next)*.4),b=this.candidate(next,exit,{...c,laneShift:exitShift});if(!b)continue;
   const reach=Math.max(2,Math.hypot(b.x-a.x,b.z-a.z)*.5),A={x:a.x-Math.sin(a.yaw)*reach,z:a.z-Math.cos(a.yaw)*reach},B={x:b.x+Math.sin(b.yaw)*reach,z:b.z+Math.cos(b.yaw)*reach},points=[];let length=0,valid=true;
   for(let i=0;i<=20;i++){const t=i/20,u=1-t,x=u*u*u*a.x+3*u*u*t*A.x+3*u*t*t*B.x+t*t*t*b.x,z=u*u*u*a.z+3*u*u*t*A.z+3*u*t*t*B.z+t*t*t*b.z,dx=3*u*u*(A.x-a.x)+6*u*t*(B.x-A.x)+3*t*t*(b.x-B.x),dz=3*u*u*(A.z-a.z)+6*u*t*(B.z-A.z)+3*t*t*(b.z-B.z),p={...a,x,z,y:a.y+(b.y-a.y)*t,yaw:Math.atan2(-dx,-dz),edgeId:i<10?edge.id:next.id,layer:i<10?a.layer:b.layer};
    const contact=this.turnContact(p,edge,next);if(!contact){valid=false;break;}Object.assign(p,contact);
    if(!this.session.safePose(p,{halfWidth:c.wid/2,halfLength:c.len/2})||this.closures?.safe(p,{halfWidth:c.wid/2,halfLength:c.len/2})===false){valid=false;break;}
    if(i)length+=Math.hypot(x-points.at(-1).x,z-points.at(-1).z);points.push({...p,s:length});
   }
   // Runtime follows these line segments, not the ideal cubic. Check their
   // intervening footprints too, retaining the small knot array in the cache.
   if(valid)for(let i=1;i<points.length&&valid;i++){const start=points[i-1].s,span=points[i].s-start,steps=Math.ceil(span/.2);for(let j=1;j<steps;j++){const p=this.turnContact(turnPoint({points},start+span*j/steps),edge,next);if(!p||!this.session.safePose(p,{halfWidth:c.wid/2,halfLength:c.len/2})||this.closures?.safe(p,{halfWidth:c.wid/2,halfLength:c.len/2})===false){valid=false;break;}}}
   if(valid&&length>.1){paths.push({from:edge.id,via:edge.to,next:next.id,entry,exit,exitShift,points,length,progress:0});}
   }
  }
  this.pathCache.set(key,{edge,revision,paths,until:this.t+1});return paths;
 }
 laneClear(edge,c){
  const key='clear:'+edge.id+':'+c.wid+':'+c.len+':'+(c.laneShift||0),revision=this.session.roads.graph.revision,cached=this.laneCache.get(key);if(cached?.edge===edge&&cached.revision===revision&&(cached.clear||cached.until>this.t))return cached.clear;
  const length=edgeLength(edge),start=Math.min(8,length*.4),end=length-start;let clear=true;
  for(let s=start;s<=end;s+=2)if(!this.candidate(edge,s,c)){clear=false;break;}
  if(clear&&!this.candidate(edge,end,c))clear=false;
  if(this.laneCache.size>=4096)this.laneCache.delete(this.laneCache.keys().next().value);this.laneCache.set(key,{edge,revision,clear,until:this.t+1});return clear;
 }
 throughPaths(edge,c){return this.turnPaths(edge,c).filter(p=>{const e=this.session.roads.graph.edges.get(p.next)?.value,joined={...c,laneShift:p.exitShift||0};return e&&this.laneClear(e,joined)&&this.turnPaths(e,joined).length;});}
 advanceLane(c,edge,travel,player){
  let turn=c.turn,offset=c.offset+travel;
  const entry=edgeLength(edge)-Math.min(8,edgeLength(edge)*.4);
  if(!turn&&offset>=entry){
   // The first car admitted owns the junction until its rear has left the
   // curve. Queued approaches cannot enter and mutually block one another.
   if(this.cars.some(q=>q!==c&&q.active&&q.turn?.via===edge.to&&!(q.stoppedT>2)))return null;
   const paths=this.throughPaths(edge,c).filter(p=>{const b=p.points.at(-1);return !(c.avoidNext?.id===p.next&&c.avoidNext.until>this.t)&&!this.cars.some(q=>q!==c&&q.active&&(q.point.edge===p.next&&q.stoppedT>2||Math.abs(q.vehicle.y-b.y)<2.5&&Math.hypot(q.vehicle.x-b.x,q.vehicle.z-b.z)<c.len+4));}).filter((p,i,paths)=>paths.findIndex(q=>q.next===p.next)===i);if(!paths.length){this.avoidEdges.set(edge.id,this.t+30);return null;}
   const focus=this.policeFocus(c,player);turn=c.police&&(this.onlineAuthority?focus.state!=='idle':focus.active)&&focus.player?[...paths].sort((a,b)=>{const end=p=>this.session.roads.graph.edges.get(p.next).value.points.at(-1);return Math.hypot(end(a)[0]-focus.player.x,end(a)[2]-focus.player.z)-Math.hypot(end(b)[0]-focus.player.x,end(b)[2]-focus.player.z);})[0]:paths[Math.floor(this.pool.rng.next()*paths.length)];turn={...turn,progress:Math.max(0,c.offset-entry)};travel=Math.max(0,offset-entry);
  }
  if(!turn)return {p:this.candidate(edge,offset,c),offset,turn:null};
  if(!this.session.roads.graph.edges.has(turn.next))return null;
  const progress=turn.progress+travel;
  if(progress>=turn.length){const next=this.session.roads.graph.edges.get(turn.next).value;offset=Math.min(edgeLength(next),turn.exit+progress-turn.length);return {p:this.candidate(next,offset,{...c,laneShift:turn.exitShift||0}),offset,turn:null,laneShift:turn.exitShift||0};}
  const p=this.turnContact(turnPoint(turn,progress),edge,this.session.roads.graph.edges.get(turn.next).value);if(!p)return null;
  return {p,offset:turn.entry+progress,turn:{...turn,progress}};
 }
 // A stopped vehicle must not pin every lane of a broad avenue. Move only
 // within the same carriageway, checking the sweep and the passing corridor.
 bypass(c,edge,dt,actors){
  if(c.turn||c.bypassTarget==null&&c.stoppedT<2||edgeLength(edge)-c.offset<c.len+2)return;
  if(c.bypassTarget==null){const base=this.laneOffset(edge,c),lane=this.laneCache.get(edge.id+':'+c.wid),width=lane?.width;if(!width)return;
   const shifts=[...Array.from({length:lane.lanes-1},(_,i)=>-(i+1)*lane.laneWidth),2.25,-2.25,3,-3];
   for(const shift of new Set(shifts)){const u=base+shift;if(u<-width.left+c.wid/2+.2||u>width.right-c.wid/2-.2||!(edge.flags&1)&&u<lane.divider+c.wid/2+.2)continue;
    const passing={...c,laneShift:shift},entry=edgeLength(edge)-Math.min(8,edgeLength(edge)*.4);if(c.offset+12>=entry&&!this.throughPaths(edge,passing).length)continue;
    let safe=true;for(const s of [c.offset,c.offset+6,c.offset+12]){const p=this.candidate(edge,s,passing);if(!p||this.poseBlocked(c,p,actors)){safe=false;break;}}
    if(safe){c.bypassTarget=shift;break;}
   }
  }
  if(c.bypassTarget==null)return;const shift=(c.laneShift||0)+clamp(c.bypassTarget-(c.laneShift||0),-.8*dt,.8*dt),p=this.candidate(edge,c.offset,{...c,laneShift:shift});
  if(p&&!this.poseBlocked(c,p,actors))c.laneShift=shift;
 }
 // An admitted car can meet an unexpected blockage after entering a turn.
 // Back out along the checked path, if the rear is clear, to release the box.
 yieldBack(c,edge,dt,actors){
  if(!c.yielding){if(!c.turn||c.stoppedT<6)return false;c.yielding={target:c.turn.entry-c.len-2,next:c.turn.next};}
  let p,offset=c.offset,turn=c.turn;
  if(turn&&turn.progress>0){const progress=Math.max(0,turn.progress-.7*dt);p=turnPoint(turn,progress);turn={...turn,progress};offset=turn.entry+progress;
  }else{turn=null;offset=Math.max(0,c.offset-.7*dt);p=this.candidate(edge,offset,c);}
  if(p){if(turn){const next=this.session.roads.graph.edges.get(turn.next)?.value;p=next?this.turnContact(p,edge,next):p.layer===edge.layer?this.turnContact(p,edge,edge):null;}else{const contact=this.session.stream.contact(p.x,p.z,{referenceY:p.y,layer:p.layer,requiredFlags:1});if(contact){p.y=contact.y;p.surfaceId=contact.surfaceId;}else p=null;}}
  if(!p||this.poseBlocked(c,p,actors)||!this.session.safePose(p,{halfWidth:c.wid/2,halfLength:c.len/2})){this.stopBlocked(c);return true;}
  c.offset=offset;c.turn=turn;c.point=p;c.v=-.7;this.placeTraffic(c,p);
  if(!turn&&offset<=Math.max(0,c.yielding.target)){c.avoidNext={id:c.yielding.next,until:this.t+8};c.yielding=null;c.stoppedT=0;c.blockedAt=null;c.v=c.vehicle.vLong=0;}
  return true;
 }
 placeTraffic(c,p){const q=this.route.project(p.x,p.z,{referenceY:p.y,heading:p.yaw});Object.assign(c.vehicle,p,{s:q.s,u:q.u,vLong:c.v,vLat:0,w:0});Object.assign(c,{s:q.s,u:q.u,hs:c.len/2,hu:c.wid/2,vs:c.v,vu:0,x:p.x,y:p.y,z:p.z});}
 spawn(player,actors){if(!this.pool)return;const online=[...this.onlineTargets.values()];if(this.onlineAuthority&&online.length)player=(this.pendingCopFocus||online[this.focusCursor++%online.length]).vehicle;const count=this.cars.filter(c=>c.active&&!c.police).length,copCount=this.cars.filter(c=>c.active&&c.police).length,needCop=this.policeEnabled&&(this.onlineAuthority?!!this.pendingCopFocus&&copCount<this.policePoolSize:copCount<Math.min(this.tuning.maxUnits,this.hm.active?1+this.hm.level:2));
  const stalled=this.cars.filter(c=>c.active&&!c.police&&c.stoppedT>5).length;
  if(!needCop&&count>=Math.max(0,Math.min(this.poolSize,Math.round(this.level*8)*(this.onlineAuthority?online.length:1))-stalled*2))return;
  const c=needCop?this.cars.find(c=>c.police&&!c.active):this.pool.pickFree(c=>!c.type.bus&&!c.type.scooter);if(!c)return;
  c.laneShift=0;c.bypassTarget=null;
  const graph=this.session.roads.graph,edges=[...graph.edges.values()].map(e=>e.value).filter(e=>!(e.flags&8)&&!this.closures?.blocksEdge(e)&&!(this.avoidEdges.get(e.id)>this.t)&&trafficSuccessors(graph,e,this.closures).length);
  for(let i=0;i<Math.min(80,edges.length);i++){const edge=edges[Math.floor(this.pool.rng.next()*edges.length)],s=edgeLength(edge)*.5,centre=edgePoint(edge,s),d=Math.hypot(centre.x-player.x,centre.z-player.z);if(d<160||d>450||this.onlineAuthority&&online.some(t=>Math.hypot(centre.x-t.vehicle.x,centre.z-t.vehicle.z)<160))continue;
   const p=this.candidate(edge,s,c);if(!p||!this.laneClear(edge,c)||!this.throughPaths(edge,c).length)continue;
   if([...actors,...this.cars.filter(q=>q.active).map(q=>q.vehicle)].some(a=>Math.abs(a.y-p.y)<3&&Math.hypot(a.x-p.x,a.z-p.z)<22)||this.cars.filter(q=>q.active&&q.point.edge===edge.id).length>=2||this.cars.some(q=>q.active&&q.point.edge===edge.id&&q.v<1))continue;
   this.pool.repair?.(c);this.pool.initDrive(c,false);c.turn=null;c.yielding=null;c.avoidNext=null;c.laneShift=0;c.bypassTarget=null;c.crashed=false;c.recoveryT=0;c.stoppedT=0;c.contactT=0;c.contactAt=-Infinity;c.blockedAt=null;c.lastSeenAt=this.t;c.active=true;c.targetId=needCop&&this.onlineAuthority?this.pendingCopFocus?.id:null;if(needCop&&this.onlineAuthority){const focus=this.onlineTargets.get(c.targetId);c.cop={...c.cop,target:focus?.gridSlot??null,chase:focus?.state!=='idle',siren:focus?.state!=='idle'};}c.point=p;c.offset=s;c.v=needCop?0:7;const q=this.route.project(p.x,p.z,{referenceY:p.y,heading:p.yaw});c.vehicle={...p,s:q.s,u:q.u,m:c.mass,halfL:c.len/2,halfW:c.wid/2,vLong:c.v,vLat:0,w:0};c.veh=c.vehicle;c.model=c.m;Object.assign(c,{s:q.s,u:q.u,hs:c.len/2,hu:c.wid/2,vs:c.v,vu:0,x:p.x,y:p.y,z:p.z});c.m.root.visible=true;return;
  }
 }
 update(dt,player,actors=[]){this.t+=dt;if(!this.pool)return;this.spawnT-=dt;if(this.spawnT<=0){this.spawnT=.5;this.spawn(player,actors);}
  const graph=this.session.roads.graph;
  for(const c of this.cars){if(!c.active)continue;this.watchVisibility(c);if(c.blockedAt!=null&&(c.point.edge!==c.blockedEdge||Math.abs(c.offset-c.blockedOffset)>1))c.blockedAt=null;if(this.retireUnseen(c,[player,...actors]))continue;let edge=graph.edges.get(c.point.edge)?.value;const distance=this.onlineAuthority?Math.min(...[...this.onlineTargets.values()].map(t=>Math.hypot(c.vehicle.x-t.vehicle.x,c.vehicle.z-t.vehicle.z))):Math.hypot(c.vehicle.x-player.x,c.vehicle.z-player.z);if(distance>600&&this.outOfView(c,[player,...actors])){c.active=false;c.m.root.visible=false;continue;}if(!edge){this.stopBlocked(c);continue;}
   c.contactT=this.t-(c.contactAt??-Infinity)<.3?(c.contactT||0)+dt:0;if(c.contactT>4&&!c.police)c.crashed=true;
   if(c.crashed){this.recover(c,edge,dt,[player,...actors]);continue;}
   let target=(edge.speedKph||35)/3.6*(c.drv?.vf||1);const focus=this.policeFocus(c,player);if(c.police){target=focus.state==='idle'?5:Math.min(35,Math.abs(focus.player?.vLong||0)+4);}
   const held=this.session.props.hold(c.point,edge.points);if(held&&!(c.police&&focus.active))target=0;
   c.stoppedT=!held&&Math.abs(c.v)<.5?(c.stoppedT||0)+dt:0;
   if((c.yielding||!held&&c.turn&&c.stoppedT>6)&&this.yieldBack(c,edge,dt,[...actors,...this.cars.filter(q=>q.active&&q!==c).map(q=>q.vehicle)]))continue;
   if(!held)this.bypass(c,edge,dt,[...actors,...this.cars.filter(q=>q.active&&q!==c).map(q=>q.vehicle)]);
   if(c.stoppedT>8){this.avoidEdges.set(edge.id,this.t+30);if(c.blockedAt==null){c.blockedAt=this.t-8;c.blockedEdge=edge.id;c.blockedOffset=c.offset;}}
   if(c.turn||edgeLength(edge)-c.offset<16)target=Math.min(target,6);
   const f=c.turn?{tx:-Math.sin(c.vehicle.yaw),tz:-Math.cos(c.vehicle.yaw),rx:Math.cos(c.vehicle.yaw),rz:-Math.sin(c.vehicle.yaw),yaw:c.vehicle.yaw}:edgePoint(edge,c.offset);let gap=Infinity,nearest=Infinity,leaderV=target;
   for(const other of [...actors,...this.cars.filter(q=>q.active&&q!==c).map(q=>q.vehicle)]){if(Math.abs(other.y-c.vehicle.y)>2.5)continue;const dx=other.x-c.vehicle.x,dz=other.z-c.vehicle.z,along=dx*f.tx+dz*f.tz,across=Math.abs(dx*f.rx+dz*f.rz);if(along>0&&along<nearest&&across<(other.halfW||1)+c.wid/2+.4){nearest=along;gap=Math.max(.1,along-c.len/2-(other.halfL||2.5));leaderV=Math.max(0,(other.vLong||0)*Math.cos(other.yaw-f.yaw));}}
   const acceleration=target<.1?-4:this.pool.idm(c,c.v,Math.max(.1,target),gap,leaderV);c.v=Math.max(0,c.v+clamp(acceleration,-5,2)*dt);
   const travel=Math.min(c.v*dt,Math.max(0,gap-.35));c.v=travel/dt;const next=this.advanceLane(c,edge,travel,player),p=next?.p;
   if(!p){this.stopBlocked(c);continue;}if(this.poseBlocked(c,p,[...actors,...this.cars.filter(q=>q.active&&q!==c).map(q=>q.vehicle)])){this.stopBlocked(c);continue;}c.offset=next.offset;c.turn=next.turn;if(next.laneShift!=null){c.laneShift=next.laneShift;c.bypassTarget=null;}c.point=p;
   this.placeTraffic(c,p);
  }
  if(!this.onlineAuthority&&!this.onlineDriver)this.updatePolice(dt,player);
 }
 // Rendering through the main camera OR mirrors protects a car from cleanup.
 watchVisibility(c){
  if(c.visibilityTracked||!c.m.root.traverse)return;
  const owner=this;let meshes=0;c.m.root.traverse(mesh=>{if(!mesh.isMesh)return;meshes++;const before=mesh.onBeforeRender;mesh.onBeforeRender=function(...args){c.lastSeenAt=owner.t;before?.apply(this,args);};});
  if(meshes){c.visibilityTracked=true;c.lastSeenAt=this.t;}
 }
 stopBlocked(c){c.v=c.vehicle.vLong=0;if(c.blockedAt==null){c.blockedAt=this.t;c.blockedEdge=c.point.edge;c.blockedOffset=c.offset;}}
 outOfView(c,actors){return !(this.onlineAuthority&&[...this.onlineTargets.values()].some(t=>Math.hypot(c.vehicle.x-t.vehicle.x,c.vehicle.z-t.vehicle.z)<350))&&c.visibilityTracked&&this.t-c.lastSeenAt>2&&!actors.some(a=>Math.abs((a.y||0)-c.vehicle.y)<3&&Math.hypot(a.x-c.vehicle.x,a.z-c.vehicle.z)<25);}
 retireUnseen(c,actors){
  if(!(c.recoveryT>8&&c.crashed||c.blockedAt!=null&&this.t-c.blockedAt>8)||!this.outOfView(c,actors))return false;
  c.active=false;c.crashed=false;c.m.root.visible=false;return true;
 }
 poseBlocked(c,p,actors){
  const current={...c.vehicle,halfL:c.len/2+.15,halfW:c.wid/2+.15},next={...current,...p};
  return actors.some(a=>{if(a===c.vehicle||Math.abs(a.y-next.y)>2.5)return false;const other=Number.isFinite(a.yaw)?a:{...a,yaw:0,vLong:0,vLat:0},hit=carOverlap(next,other);if(!hit)return false;const old=carOverlap(current,other);return !old||hit.depth>=old.depth-1e-5;});
 }
 // Rejoin the nearest safe lane slowly after an incident; never snap back to the pre-impact pose.
 recover(c,edge,dt,actors){
  if(c.turn||c.yielding){c.offset=projectEdge(edge,c.vehicle.x,c.vehicle.z).offsetM;c.turn=null;c.yielding=null;}
  c.recoveryT=(c.recoveryT||0)+dt;if(this.retireUnseen(c,actors))return;c.v*=Math.exp(-dt*3);
  const v=c.vehicle;v.vLong=c.v;v.vLat=0;v.w=0;
  if(c.recoveryT<4||this.t-(c.contactAt??-Infinity)<.5||c.v>.5)return;
  const offset=projectEdge(edge,v.x,v.z).offsetM,p=this.candidate(edge,offset,c);if(!p)return;
  const dx=p.x-v.x,dz=p.z-v.z,d=Math.hypot(dx,dz),angle=Math.atan2(Math.sin(p.yaw-v.yaw),Math.cos(p.yaw-v.yaw));
  if(d>8||Math.abs(p.y-v.y)>1)return;
  const k=Math.min(1,.7*dt/Math.max(.001,Math.hypot(d,p.y-v.y))),next={...p,x:v.x+dx*k,z:v.z+dz*k,y:v.y+(p.y-v.y)*k,yaw:v.yaw+clamp(angle,-.6*dt,.6*dt)};
  const nearby=[...actors,...this.cars.filter(q=>q.active&&q!==c).map(q=>q.vehicle)];
  if(this.poseBlocked(c,next,nearby)||!this.session.safePose(next,{halfWidth:c.wid/2,halfLength:c.len/2}))return;
  Object.assign(v,next);const q=this.route.project(v.x,v.z,{referenceY:v.y,heading:v.yaw});Object.assign(v,{s:q.s,u:q.u});Object.assign(c,{s:q.s,u:q.u,x:v.x,y:v.y,z:v.z,vs:0,vu:0});
  if(d<.05&&Math.abs(p.y-v.y)<.05&&Math.abs(angle)<.03){c.offset=offset;c.point=p;c.crashed=false;c.recoveryT=0;c.v=v.vLong=0;}
 }
 updatePolice(dt,player){if(!this.policeEnabled)return;const C=this.tuning,units=this.cars.filter(c=>c.active&&c.police),visible=units.filter(c=>{const d=Math.hypot(c.vehicle.x-player.x,c.vehicle.z-player.z);if(d>(this.hm.active?C.pursuitRange:C.witnessRange)||Math.abs(c.vehicle.y-player.y)>3||this.session.barriers?.lineBlocked({...c.vehicle,y:c.vehicle.y+1},{...player,y:player.y+1}))return false;for(let t=.1;t<1;t+=.1){const x=c.vehicle.x+(player.x-c.vehicle.x)*t,z=c.vehicle.z+(player.z-c.vehicle.z)*t;if(this.session.obstacles.contact(x,player.y+1,z,.1))return false;}return true;});
  const seen=this.seen=visible.length>0,nearest=this.session.roads.graph.nearest(player.x,player.z,{referenceY:player.y,maxDistance:20}),edge=nearest&&this.session.roads.graph.edges.get(nearest.edge)?.value,limit=edge?.speedKph||50,over=Math.abs(player.vLong)*3.6-limit;
  const wrong=edge&&(edge.flags&1)?Math.cos(player.yaw-projectEdge(edge,player.x,player.z).yaw)<-.4&&Math.abs(player.vLong)>3:false;
  if(seen&&this.crossedRed)this.hm.offence('red',.3,true);this.crossedRed=null;
  if(seen&&over>C.speedMargin)this.hm.offence('speeding',dt*(over>C.seriousMargin?C.seriousSpeedHeat:over>C.warnMargin?C.speedHeat:C.minorSpeedHeat),true,{continuous:true,sustained:this.hm.warningT>=C.sustainedAfter});
  if(seen&&wrong)this.hm.offence('wrongside',dt*C.wrongSideHeat,true,{continuous:true,sustained:this.hm.warningT>=C.sustainedAfter});
  const mine=units.filter(c=>!this.onlineDriver||!c.cop?.chase||c.cop?.target===this.onlineDriver.gridSlot),near=visible.filter(c=>mine.includes(c)&&Math.hypot(c.vehicle.x-player.x,c.vehicle.z-player.z)<C.bustDist).length;
  const transitions=this.hm.update(dt,{seen,offending:over>C.speedMargin||wrong,fleeing:over>C.fleeMargin,slow:Math.abs(player.vLong)<C.bustSpeed,copsNear:near,copNear:this.onlineDriver?near>0:undefined,complying:near>0&&Math.abs(player.vLong)<1});
  this.onVoice?.({enabled:true,P:{...player,vs:player.vLong,vu:player.vLat||0},cops:mine.filter(c=>!c.crashed),hm:this.hm,distance:(c,p)=>Math.hypot(c.vehicle.x-p.x,c.vehicle.z-p.z)},transitions);
  for(const event of transitions)events.emit('pursuit',event);
  Object.assign(pursuit,{enabled:true,state:this.hm.state,heat:this.hm.heat,level:this.hm.level,bustMeter:this.hm.bust,evadeMeter:this.hm.evade,time:this.hm.time,units:mine.length});
 }
 collide(actor,out,now){for(const c of this.cars){if(!c.active||!c.vehicle||Math.abs(c.vehicle.y-actor.veh.y)>2.5||Math.hypot(c.vehicle.x-actor.veh.x,c.vehicle.z-actor.veh.z)>10)continue;const hit=resolveCarPair(actor.veh,c.vehicle);if(!hit)continue;c.contactAt=this.t;if(hit.hitA){const offset=bodyOffset(actor.veh,hit.c.x,hit.c.z),cs=Math.cos(actor.veh.yaw),sn=Math.sin(actor.veh.yaw),localNormal={x:hit.c.nx*cs-hit.c.nz*sn,y:0,z:hit.c.nx*sn+hit.c.nz*cs},zone=Math.abs(localNormal.x)>Math.abs(localNormal.z)?(localNormal.x>0?'left':'right'):(localNormal.z>0?'front':'rear');actor.veh.addDamage?.(zone,hit.hitA.dv,{kind:'crash',sev:hit.vn,car:{mass:c.mass},localPoint:{x:offset.py,y:.5,z:-offset.px},localNormal});actor.veh.impactDynamics?.({dv:hit.hitA.dv,nx:hit.c.nx,nz:hit.c.nz,forward:offset.px,right:offset.py,height:.5,kind:'car',yawSolved:true});}if(hit.vn>3){c.crashed=true;this.pool.damageCar(c,'front',hit.hitB?.dv||0,{ebs:hit.vn});out.push({kind:'crash',sev:hit.vn,car:c,who:actor.kind});if(this.policeEnabled&&(!this.onlineDriver||actor.veh===this.onlineDriver.player))this.hm.offence('collision',1,this.seen||c.police,{serious:hit.vn>11});}c.v=Math.max(0,c.vehicle.vLong);}}
 sync(){const o=this.session.stream.origin;for(const c of this.cars){const root=c.m.root;if(!c.active){root.visible=false;continue;}const v=c.vehicle;root.visible=true;root.position.set(v.x-o.x,v.y,v.z-o.z);root.rotation.set(0,v.yaw,0);c.m.update?.(1/60,c.v,0,c.v<1,{});c.m.setStrobe?.(c.police&&(this.onlineAuthority||this.onlineDriver?!!(c.cop?.siren||c.cop?.chase):this.hm.state!=='idle'),this.t);}}
 zone(){return 'town';}
 get actors(){return this.cars.filter(c=>c.active).map(c=>c.vehicle);}
 dispose(){this.disposed=true;this.fleetController?.abort();releaseFleet(this.pool||this.warmingPool);this.cars=[];this.pool=null;Object.assign(pursuit,{enabled:false,state:'off'});}
}

function releaseFleet(pool){if(!pool||pool.released)return;pool.released=true;const roots=[...(pool.cars||[]).map(c=>c.m.root),pool.coneMesh,...(pool.proxies?.meshes||[])];const geos=new Set(),mats=new Set();for(const root of roots){root?.removeFromParent?.();root?.traverse?.(o=>{if(o.geometry&&!o.geometry.userData.shared)geos.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:o.material?[o.material]:[])if(!m.userData?.shared)mats.add(m);});}for(const g of geos)g.dispose();for(const m of mats)m.dispose();pool.proxies?.dispose?.();}
