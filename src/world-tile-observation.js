// Diagnostic producer only. No request-failure classifier or transport exemption.
// The registry is intentionally lazy: importing this module creates no observer.
let registry;
const freeze=Object.freeze;
const LIMIT=2*1024*1024,FAILURE_RESERVE=4096,MAX_EVENT=4096;
const fail=(root,code)=>{
 if(root.firstFailure)return;
 root.firstFailure=freeze({code,seq:root.seq});root.invalid=true;
 root.failureView=freeze({version:1,valid:false,firstFailure:root.firstFailure,requestClassification:false});
};
const retained=(root,bytes)=>{
 if(!Number.isSafeInteger(bytes)||bytes<0||root.bytes+bytes>LIMIT-FAILURE_RESERVE){fail(root,'retained-budget');return false;}
 root.bytes+=bytes;return true;
};
const enter=(cap,fn)=>{
 const item=registry?.get(cap);if(!item)return null;const root=item.root;
 if(root.busy){fail(root,'reentrant-observer');return null;}
 root.busy=true;try{return fn(item,root);}catch{fail(root,'observer-fault');return null;}finally{root.busy=false;}
};
const token=(root,item)=>{const cap=freeze({});item.root=root;registry.set(cap,item);return cap;};
const emit=(item,phase,reason='none',detail='none')=>{
 const root=item.root;if(root.invalid)return;
 const bytes=item.identityBytes+1024;if(bytes>MAX_EVENT){fail(root,'event-budget');return;}
 if(root.events.length>=512){fail(root,'journal-limit');return;}
 if(!retained(root,bytes))return;
 const at=performance.now();if(root.invalid)return;if(!Number.isFinite(at)||at<(root.lastAt??-Infinity)){fail(root,'observer-clock');return;}root.lastAt=at;
 const event=freeze({...item.identity,seq:++root.seq,at,phase,reason,detail,
  currentInterestEpoch:item.stream.epoch,poolInstance:item.poolInstance??null,poolJobSerial:item.poolJobSerial??null,transport:item.transport??'native'});
 root.events.push(event);root.eventBytes+=bytes;
};
const release=item=>{
 if(item.removed&&item.loadSettled&&!item.released){item.released=true;item.root.live.delete(item.identity.admissionSerial+':'+item.identity.streamInstance);item.root.bytes-=item.contextBytes;}
};
const word=(s,max=128)=>typeof s==='string'&&s.length>0&&s.length<=max&&/^[A-Za-z0-9_.-]+$/.test(s);
function identity(stream,root,entry,cell,url,admissionSerial){
 // Reject unsupported strings BEFORE URL/event/context allocation; never retain
 // unknown credentials, queries, fragments, oversized URLs or arbitrary paths.
 if(!entry||typeof entry.sha256!=='string'||!/^[a-f0-9]{64}$/.test(entry.sha256)||!Number.isSafeInteger(entry.bytes)||entry.bytes<1||!Number.isSafeInteger(admissionSerial)||admissionSerial<1||typeof cell!=='string'||!/^[-\d]+,[-\d]+$/.test(cell))return null;
 const raw=entry.url;if(typeof raw!=='string'||raw.length>512||typeof url!=='string'||url.length>512||/[?#\s@]/.test(raw)||/[?#\s@]/.test(url))return null;
 const resolved=new URL(url),rawURL=new URL(raw,stream.baseURL),base=new URL(stream.baseURL);
 if(resolved.href!==url||rawURL.href!==url||resolved.username||resolved.password||resolved.search||resolved.hash||!new RegExp('^/(?:world/)?cells/'+entry.sha256+'\\.bin\\.gz$').test(resolved.pathname))return null;
 if(resolved.protocol!=='https:'&&!(resolved.protocol==='http:'&&(resolved.origin===base.origin||['localhost','127.0.0.1','[::1]'].includes(resolved.hostname))))return null;
 const sourceWorld=entry.source?.world||stream.world,sourceRevision=entry.source?.revision||stream.revision;
 if(!word(sourceWorld)||!word(sourceRevision))return null;
 const identityBytes=1536+64+2*(cell.length+stream.world.length+stream.revision.length+sourceWorld.length+sourceRevision.length+entry.sha256.length+raw.length+url.length);
 if(root.invalid)return null;
 if(identityBytes+1024>MAX_EVENT){fail(root,'event-budget');return null;}if(!retained(root,identityBytes+1024))return null;
 return {identityBytes,value:{streamInstance:stream.id,admissionSerial,admittedInterestEpoch:stream.epoch,cell,manifestWorld:stream.world,manifestRevision:stream.revision,sourceWorld,sourceRevision,entrySHA256:entry.sha256,entryBytes:entry.bytes,entryURL:raw,resolvedURL:url}};
}
export function createTileObservationForDebug(query,target=globalThis){
 if(!query?.has('simhook')||query.get('tileLifecycle')!=='1')return null;
 registry??=new WeakMap();
 const root={bytes:FAILURE_RESERVE,seq:0,nextStream:0,nextPool:0,events:[],eventBytes:0,live:new Map(),invalid:false,firstFailure:null,busy:false,reads:0,snapshots:0};
 const unavailable=freeze({version:1,valid:false,firstFailure:freeze({code:'observer-unavailable',seq:0}),requestClassification:false});root.failureView=unavailable;
 const read=full=>{
  if(root.busy){fail(root,'reentrant-observer');return root.failureView;}
  if(root.invalid)return root.failureView;
  if(++root.reads>64||full&&++root.snapshots>4){fail(root,'read-limit');return root.failureView;}
  let copyBytes=1024;if(full){copyBytes+=root.eventBytes;for(const c of root.live.values())copyBytes+=c.contextBytes;}
  if(!retained(root,copyBytes))return root.failureView;
  root.busy=true;try{
   const status={version:1,valid:true,firstFailure:null,events:root.events.length,retainedContexts:root.live.size,retainedEstimateBytes:root.bytes,requestClassification:false};
   if(full){status.journal=freeze(root.events.map(e=>freeze({...e})));status.contexts=freeze([...root.live.values()].map(c=>freeze({...c.identity,currentInterestEpoch:c.stream.epoch,poolInstance:c.poolInstance??null,poolJobSerial:c.poolJobSerial??null,transport:c.transport,cancelReason:c.cancelReason,nativeAbort:c.nativeAbort,transportSettled:c.poolSettled,loadSettled:c.loadSettled,removed:c.removed})));}
   if(root.invalid)return root.failureView;return freeze(status);
  }catch{fail(root,'observer-fault');return root.failureView;}finally{root.busy=false;}
 };
 const handle=freeze({snapshot:()=>read(true),status:()=>read(false)});
 try{Object.defineProperty(target,'__tileLifecycle',{value:handle,enumerable:false,writable:false,configurable:false});registry.set(handle,{kind:'handle',root});}catch{const existing=Object.getOwnPropertyDescriptor(target,'__tileLifecycle');const previous=existing&&Object.hasOwn(existing,'value')?registry.get(existing.value):null;if(previous)fail(previous.root,'duplicate-hook');fail(root,'hook-install');}
 return token(root,{kind:'root'});
}
export const openTileStreamObservation=(cap,manifest,baseURL)=>enter(cap,(item,root)=>{
 if(root.invalid)return null;if(item.kind!=='root'||!word(manifest.world)||!word(manifest.revision)||typeof baseURL!=='string'||baseURL.length>512||/[?#\s@]/.test(baseURL)){fail(root,'stream-identity');return null;}
 if(!retained(root,4096))return null;
 return token(root,{kind:'stream',id:++root.nextStream,epoch:0,world:manifest.world,revision:manifest.revision,baseURL});
});
export const openTilePoolObservation=cap=>enter(cap,(stream,root)=>{if(root.invalid)return null;if(stream.kind!=='stream'){fail(root,'pool-binding');return null;}return token(root,{kind:'pool',id:++root.nextPool,stream});});
export const observeTileInterest=cap=>enter(cap,stream=>{stream.epoch++;});
export const observeTileAdmission=(cap,entry,cell,url,serial,custom=false)=>enter(cap,(stream,root)=>{
 if(root.invalid)return null;if(root.events.length>=512){fail(root,'journal-limit');return null;}if(root.live.size>=16){fail(root,'context-limit');return null;}
 const checked=identity(stream,root,entry,cell,url,serial);if(!checked){fail(root,'entry-identity');return null;}
 const value=checked.value,bytes=checked.identityBytes+1024;
 const key=serial+':'+stream.id;if(root.live.has(key)){root.bytes-=bytes;fail(root,'duplicate-admission');return null;}
 const ctx={kind:'job',identity:value,identityBytes:checked.identityBytes,contextBytes:bytes,stream,transport:custom?'custom':'native',removed:false,loadSettled:false,poolSettled:false,nativeAbort:false,nativeCancelled:false,cancelReason:'unknown',root};
 root.live.set(key,ctx);const job=token(root,ctx);emit(registry.get(job),'admit');return job;
});
export const observeTileRemoval=(cap,reason)=>enter(cap,item=>{
 if(item.removed){fail(item.root,'duplicate-remove');return;}item.removed=true;
 item.cancelReason=['stale-interest','admission-eviction','stream-dispose'].includes(reason)?reason:'unknown';emit(item,'remove',item.cancelReason);
 if(item.cancelReason==='unknown')fail(item.root,'unknown-removal');release(item);
});
export const observeTileControllerAbort=cap=>enter(cap,item=>{if(item.nativeAbort){fail(item.root,'duplicate-controller-abort');return;}item.nativeAbort=true;emit(item,'controller-abort',item.cancelReason);});
export const observeTilePoolBind=(poolCap,jobCap,serial,job)=>enter(poolCap,(pool,root)=>{
 const item=registry.get(jobCap);if(!item){if(!root.invalid)fail(root,'unknown-job');return;}if(item.root!==root||item.stream!==pool.stream||item.poolJobSerial!==undefined||!Number.isSafeInteger(serial)||serial<1||!job||job.url!==item.identity.resolvedURL||job.entry?.url!==item.identity.entryURL||job.entry?.sha256!==item.identity.entrySHA256||job.entry?.bytes!==item.identity.entryBytes||job.world!==item.identity.sourceWorld||job.revision!==item.identity.sourceRevision||job.cell?.length!==2||job.cell[0]+','+job.cell[1]!==item.identity.cell){fail(root,'pool-binding');return;}
 item.poolInstance=pool.id;item.poolJobSerial=serial;emit(item,'pool-bind');
});
export const observeTilePoolPrecancel=(cap,signalAborted)=>enter(cap,item=>{
 item.nativeCancelled=signalAborted===true&&item.nativeAbort&&item.removed;
 item.poolSettled=true;emit(item,'pool-settle',item.nativeCancelled?item.cancelReason:'error','no-worker');
 if(!item.nativeCancelled)fail(item.root,'pool-pre-cancelled');
});
export const observeTileWorkerPost=cap=>enter(cap,item=>{if(!item.poolJobSerial||item.poolSettled||item.workerPosted){fail(item.root,'duplicate-or-unbound-post');return;}item.workerPosted=true;emit(item,'worker-post');});
export const observeTilePoolMessage=(cap,id)=>enter(cap,item=>{if(item.poolSettled||item.poolJobSerial!==id)fail(item.root,'late-job-callback');});
export const observeTileWorkerTerminate=(cap,aborting,signalAborted,kind='worker-error')=>enter(cap,item=>{
 if(!['worker-error','post-message-error'].includes(kind))kind='worker-error';
 item.nativeCancelled=aborting&&signalAborted===true&&item.nativeAbort&&item.removed;
 emit(item,'worker-terminate',item.nativeCancelled?item.cancelReason:'error',aborting?'abort':kind);
 if(!item.nativeCancelled)fail(item.root,aborting?'unclassified-worker-abort':kind);
});
export const observeTilePoolSettle=(cap,error)=>enter(cap,item=>{
 if(item.poolSettled){fail(item.root,'duplicate-pool-settle');return;}item.poolSettled=true;emit(item,'pool-settle',item.nativeCancelled?item.cancelReason:error?'error':'none',item.nativeCancelled?'native-cancel':error?'error':'success');
 if(error&&!item.nativeCancelled)fail(item.root,'pool-error');
});
export const observeTileLoadError=(cap,kind='loader-error')=>enter(cap,item=>{
 if(!['loader-error','warmup-error','activation-error','pool-full','worker-create-error'].includes(kind))kind='unknown-error';
 if(kind==='loader-error'&&item.nativeCancelled)return;emit(item,'error','error',kind);fail(item.root,kind);
});
export const observeTileLoadSettle=cap=>enter(cap,item=>{if(item.loadSettled){fail(item.root,'duplicate-load-settle');return;}item.loadSettled=true;emit(item,'load-settle',item.nativeCancelled?item.cancelReason:'none');release(item);});
export const observeTileIdleTerminate=(cap,reason)=>enter(cap,(pool,root)=>{
 // No cell/job identity: idle cleanup can never authorize an HTTP exception.
 if(!['stream-dispose','unknown'].includes(reason))reason='unknown';
 if(root.invalid)return;if(root.events.length>=512){fail(root,'journal-limit');return;}if(root.bytes+1536>LIMIT-FAILURE_RESERVE){fail(root,'retained-budget');return;}const item={root,identity:{streamInstance:pool.stream.id,admissionSerial:null,cell:null},identityBytes:512,stream:pool.stream,poolInstance:pool.id,poolJobSerial:null};emit(item,'idle-worker-terminate',reason,'no-job');if(reason==='unknown')fail(root,'unknown-pool-dispose');
});
export const closeTileStreamObservation=cap=>enter(cap,(stream,root)=>{if(!stream.closed){stream.closed=true;root.bytes-=4096;}});
