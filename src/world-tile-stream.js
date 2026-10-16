import { TILE_METRES, tileKey, tileTables, validateWorldManifest } from './world-tile-format.js';
import { sampleTileContact } from './world-tile-contact.js';

/** Shared materials/textures are disposed only when their last tile releases them. */
export class TileResources {
  constructor(){this.entries=new Map();this.bytes=0;}
  acquire(key,create,bytes=0){let entry=this.entries.get(key);if(!entry){entry={resource:create(),refs:0,bytes};this.entries.set(key,entry);this.bytes+=bytes;}entry.refs++;return entry.resource;}
  release(key){const entry=this.entries.get(key);if(!entry)throw new Error('Unbalanced tile resource release');if(--entry.refs===0){entry.resource.dispose?.();this.entries.delete(key);this.bytes-=entry.bytes;}}
}
export class TileWorkerPool {
  constructor({size=2,url=new URL('./world-tile-worker.js',import.meta.url),createWorker=u=>new Worker(u,{type:'module'})}={}) {
    this.slots=Array.from({length:size},()=>({worker:null,busy:false}));this.url=url;this.createWorker=createWorker;this.nextId=0;this.disposed=false;
  }
  load(job,signal){
    if(this.disposed||signal?.aborted)return Promise.reject(new Error('Tile worker cancelled'));
    const slot=this.slots.find(s=>!s.busy);if(!slot)return Promise.reject(new Error('Tile worker pool full'));
    slot.busy=true;
    return new Promise((resolve,reject)=>{
      const worker=slot.worker??=this.createWorker(this.url),id=++this.nextId;
      const finish=(error,packet)=>{signal?.removeEventListener('abort',abort);worker.onmessage=worker.onerror=null;slot.busy=false;slot.reject=null;error?reject(error):resolve(packet);};
      // Terminating also cancels synchronous decode, and bounds stale worker allocations.
      const abort=()=>{worker.terminate();slot.worker=null;finish(new Error('Tile worker cancelled'));};
      slot.reject=abort;signal?.addEventListener('abort',abort,{once:true});
      worker.onmessage=({data})=>{if(data.id===id)finish(data.error?new Error(data.error):null,data.packet);};
      worker.onerror=e=>{worker.terminate();slot.worker=null;finish(new Error(e.message||'Tile worker failed'));};
      try{worker.postMessage({id,job});}catch(e){worker.terminate();slot.worker=null;finish(e);}
    });
  }
  dispose(){if(this.disposed)return;this.disposed=true;for(const slot of this.slots){slot.reject?.();slot.worker?.terminate();slot.worker=null;}}
}
/** No world data is allocated until the caller constructs this after session selection. */
export class WorldTileStream {
  constructor(manifest,{baseURL,load,adapter,capBytes=64*1024*1024,transientBytes=32*1024*1024,concurrency=2,nearRing=1,safetyRing=0,lookaheadSeconds=12,activationMs=2,now=()=>performance.now(),retryMs=500}={}) {
    this.manifest=validateWorldManifest(manifest);this.baseURL=baseURL||'http://localhost/';
    this.pool=load?null:new TileWorkerPool({size:concurrency});this.load=load||((job,signal)=>this.pool.load(job,signal));
    this.adapter=adapter;this.capBytes=capBytes;this.transientCap=transientBytes;this.concurrency=concurrency;
    this.nearRing=nearRing;this.safetyRing=safetyRing;this.lookaheadSeconds=lookaheadSeconds;this.activationMs=activationMs;this.now=now;this.retryMs=retryMs;
    this.tiles=new Map();this.pins=new Map();this.wanted=new Map();this.origin={x:0,z:0};this.generation=0;this.disposed=false;
    this.residentBytes=0;this.reservedBytes=0;this.transientBytes=0;this.inflight=0;
    this.metrics={loadedBytes:0,evictions:0,failures:0,peakResidentBytes:0,peakReservedBytes:0,maxActivationMs:0,activationLongTasks:0};
    this.spawnRelease=this.pin('spawn',manifest.spawn.cell.join(','));
  }
  entry(key){return this.manifest.tiles[key];}
  pin(reason,key){
    if(this.disposed||!this.entry(key))throw new Error(`Cannot pin unknown tile ${key}`);
    const keys=this.dependencies(key),token=Symbol(reason);
    for(const k of keys){let refs=this.pins.get(k);if(!refs)this.pins.set(k,refs=new Set());refs.add(token);}
    let released=false;
    return ()=>{if(released)return;released=true;for(const k of keys){const refs=this.pins.get(k);refs?.delete(token);if(!refs?.size)this.pins.delete(k);}};
  }
  // Owners loaded only to complete this base cell never become new base requests.
  // This same one-hop set drives admission, pins, readiness and teleports.
  dependencies(key) {return new Set([key,...(this.entry(key)?.dependencies||[])]);}
  update({x,z,vx=0,vz=0,latencySeconds=0,interest=[],contacts=[]}) {
    if(this.disposed)return;
    this.position={x,z};
    this.contactKeys=new Set([tileKey(x,z),...contacts.map(p=>tileKey(p.x,p.z))]);
    this.wanted.clear();
    const add=(px,pz,r,priority)=>{
      const cx=Math.floor(px/TILE_METRES),cz=Math.floor(pz/TILE_METRES);
      for(let dx=-r;dx<=r;dx++)for(let dz=-r;dz<=r;dz++){
        const key=`${cx+dx},${cz+dz}`;if(!this.entry(key))continue;
        const score=priority+Math.max(Math.abs(dx),Math.abs(dz));
        for(const d of this.dependencies(key))if(!this.wanted.has(d)||this.wanted.get(d)>score)this.wanted.set(d,score);
      }
    };
    add(x,z,this.safetyRing,0);add(x,z,this.nearRing,10);
    const speed=Math.hypot(vx,vz),ahead=speed?Math.max(1000,speed*Math.max(this.lookaheadSeconds,latencySeconds+5)):0;
    for(let distance=TILE_METRES/2;speed && distance<=ahead+TILE_METRES/2;distance+=TILE_METRES/2)add(x+vx/speed*distance,z+vz/speed*distance,this.safetyRing,0.25+distance/10000);
    for(const p of interest)add(p.x,p.z,0,1); // caller includes AI/wheel-contact centres, within the same cap
    for(const key of this.contactKeys)if(this.entry(key))for(const d of this.dependencies(key))this.wanted.set(d,-.5);
    for(const key of this.pins.keys())this.wanted.set(key,-1);
    // Latest-interest generation cancels stale fetches before new reservations are admitted.
    for(const [key,tile] of this.tiles)if(!this.wanted.has(key)&&tile.state==='loading')this.remove(key);
    const ox=Math.abs(x-this.origin.x)>2048?Math.floor(x/TILE_METRES)*TILE_METRES:this.origin.x;
    const oz=Math.abs(z-this.origin.z)>2048?Math.floor(z/TILE_METRES)*TILE_METRES:this.origin.z;
    if(ox!==this.origin.x||oz!==this.origin.z){const previous=this.origin;this.origin={x:ox,z:oz};this.adapter?.rebase?.(this.origin,previous);}
    this.pump();
  }
  pump(){
    if(this.disposed)return;
    const wanted=[...this.wanted].sort((a,b)=>a[1]-b[1]);
    for(const [key] of wanted){
      if(this.inflight>=this.concurrency)break;
      const old=this.tiles.get(key);if(old&&old.state!=='failed')continue;
      if(old&&(old.attempts>=3||old.retryAt>this.now()))continue;
      const entry=this.entry(key),reserved=entry.decodedBytes,transient=entry.decodedBytes+entry.bytes;
      if(transient>this.transientCap-this.transientBytes)continue;
      const admission=(this.wanted.get(key)??0)>=10?this.capBytes*.8:this.capBytes;
      while(this.residentBytes+this.reservedBytes+reserved>admission){
        const candidates=[...this.tiles].filter(([k,t])=>!this.pins.has(k)&&!this.contactKeys?.has(k)&&(!this.wanted.has(k)||this.wanted.get(k)>this.wanted.get(key))&&['active','ready'].includes(t.state)).sort((a,b)=>(this.wanted.get(b[0])??100)-(this.wanted.get(a[0])??100)||a[1].used-b[1].used);
        if(!candidates.length)break;this.remove(candidates[0][0]);this.metrics.evictions++;
      }
      if(this.residentBytes+this.reservedBytes+reserved>admission)continue;
      const controller=new AbortController(),tile={state:'loading',generation:++this.generation,controller,reserved,transient,used:this.now(),attempts:(old?.attempts||0)+1};
      this.tiles.set(key,tile);this.inflight++;this.reservedBytes+=reserved;this.transientBytes+=transient;
      this.metrics.peakReservedBytes=Math.max(this.metrics.peakReservedBytes,this.residentBytes+this.reservedBytes);
      const job={url:new URL(entry.url,this.baseURL).href,entry,world:this.manifest.world,revision:this.manifest.revision,cell:key.split(',').map(Number)};
      Promise.resolve().then(()=>this.load(job,controller.signal)).then(packet=>{
        if(this.disposed||this.tiles.get(key)!==tile)return;
        if(!Number.isSafeInteger(packet.bytes)||packet.bytes<0||packet.bytes>reserved)throw new Error('Tile exceeded reservation');
        packet.tables=tileTables(packet);
        this.reservedBytes-=tile.reserved;tile.reserved=0;
        tile.packet=packet;tile.state='ready';tile.used=this.now();this.residentBytes+=packet.bytes;tile.bytes=packet.bytes;
        this.metrics.loadedBytes+=entry.bytes;this.metrics.peakResidentBytes=Math.max(this.metrics.peakResidentBytes,this.residentBytes);
      }).catch(error=>{
        if(this.tiles.get(key)!==tile||this.disposed)return;
        tile.state='failed';tile.error=error;tile.retryAt=this.now()+this.retryMs*2**(tile.attempts-1);this.metrics.failures++;
      }).finally(()=>{
        if(tile.reserved){this.reservedBytes-=tile.reserved;tile.reserved=0;}
        this.transientBytes-=tile.transient;tile.transient=0;this.inflight--;
      });
    }
  }
  /** Call once per render frame; no await, decode or bounds scans on this path. */
  activateFrame(){
    if(this.disposed)return;
    const start=this.now();
    for(const [key] of [...this.wanted].sort((a,b)=>a[1]-b[1])){
      const tile=this.tiles.get(key);if(!tile||tile.state!=='ready')continue;
      try{
        tile.build??=this.adapter?.prepare?.(key,tile.packet,this.origin)||{steps:[][Symbol.iterator](),commit:()=>null,dispose:()=>{}};
        do{
          const at=this.now(),step=tile.build.steps.next(),duration=this.now()-at;
          this.metrics.maxActivationMs=Math.max(this.metrics.maxActivationMs,duration);if(duration>50)this.metrics.activationLongTasks++;
          if(step.done){tile.handle=tile.build.commit();tile.state='active';tile.used=this.now();break;}
        }while(this.now()-start<this.activationMs);
      }catch(error){tile.build?.dispose();this.residentBytes-=tile.bytes||0;tile.bytes=0;tile.packet=null;tile.build=null;tile.state='failed';tile.error=error;tile.retryAt=this.now()+this.retryMs;this.metrics.failures++;}
      if(this.now()-start>=this.activationMs)break;
    }
    this.pump();
  }
  readyAt(x,z){const key=tileKey(x,z),tile=this.tiles.get(key);if(tile?.state!=='active'||![...this.dependencies(key)].every(k=>this.tiles.get(k)?.state==='active'))return false;tile.used=this.now();return true;}
  /** Null is an explicit missing-contact state: callers must hold physics, never invent a fallback height. */
  contact(x,z,options){
    const tile=this.tiles.get(tileKey(x,z));if(!this.readyAt(x,z))return null;tile.used=this.now();
    const [cx,cz]=tile.packet.metadata.cell;
    return sampleTileContact(tile.packet.tables,tile.packet.contactIndex,x-cx*TILE_METRES,z-cz*TILE_METRES,options);
  }
  async teleport({x,z},move,{signal,timeoutMs=30000,nextFrame=()=>new Promise(resolve=>requestAnimationFrame(resolve))}={}){
    const releases=[],targets=[],start=this.now(),[cx,cz]=tileKey(x,z).split(',').map(Number);
    for(let dx=-this.safetyRing;dx<=this.safetyRing;dx++)for(let dz=-this.safetyRing;dz<=this.safetyRing;dz++){const key=`${cx+dx},${cz+dz}`;if(this.entry(key)){targets.push(key);releases.push(this.pin('tow/teleport',key));}}
    if(!targets.includes(tileKey(x,z)))throw new Error('Tile target outside world');
    if(this.position){const key=tileKey(this.position.x,this.position.z);if(this.entry(key))releases.push(this.pin('previous-safe',key));}
    try{
      while(!targets.every(key=>[...this.dependencies(key)].every(k=>this.tiles.get(k)?.state==='active'))){
        if(this.disposed||signal?.aborted||this.now()-start>timeoutMs)throw new Error('Tile target unavailable');
        this.update({x,z});this.activateFrame();
        const tile=this.tiles.get(tileKey(x,z));if(tile?.state==='failed'&&tile.attempts>=3)throw tile.error;
        await nextFrame();
      }
      // Caller may move car/camera atomically only after its destination is active.
      await move();
    }finally{for(const release of releases)release();}
  }
  retry(key){const tile=this.tiles.get(key);if(tile?.state==='failed'){tile.attempts=0;tile.retryAt=0;this.pump();}}
  remove(key){
    const tile=this.tiles.get(key);if(!tile)return;this.tiles.delete(key);tile.controller.abort();
    if(tile.reserved){this.reservedBytes-=tile.reserved;tile.reserved=0;}
    tile.build?.dispose?.();if(!tile.build)tile.handle?.dispose?.();
    this.residentBytes-=tile.bytes||0;tile.packet=null;tile.build=null;tile.handle=null;
  }
  dispose(){if(this.disposed)return;this.disposed=true;for(const key of this.tiles.keys())this.remove(key);this.spawnRelease?.();this.pins.clear();this.wanted.clear();this.pool?.dispose();}
}
