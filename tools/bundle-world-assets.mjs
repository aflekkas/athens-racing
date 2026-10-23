// Read-only local host for the exact public immutable world used by the build.
// This module imports no Worker entry, catalogue, credentials, R2 client or geometry decoder.
import {createHash} from 'node:crypto';
import {types} from 'node:util';
import {worldAssets} from '../worker/world-assets.mjs';
import {composeWorldManifest, canonicalWorldJSON, validateWorldDefinition} from '../src/world-manifest.js';
export const BUNDLE_WORLD_ORIGIN = 'https://staging.athensracing.com';
export const BUNDLE_WORLD_LIMITS = Object.freeze({
  metadataBytes: 2 * 1024 * 1024, objectBytes: 4 * 1024 * 1024,
  upstreamBytes: 64 * 1024 * 1024, downstreamBytes: 64 * 1024 * 1024,
  regions: 8, objects: 4096, requests: 512, pending: 16,
  prepareMs: 15000, objectMs: 10000, lifetimeMs: 120000, closeMs: 2000,
});
const hex = /^[a-f0-9]{64}$/, manifestKey = /^manifests\/([a-f0-9]{64})\.json$/;
const cellKey = /^cells\/([a-f0-9]{64})\.bin\.gz$/;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const json = bytes => JSON.parse(new TextDecoder('utf-8', {fatal:true, ignoreBOM:true}).decode(bytes));
const plain = value => value && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => plain(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value,key));
const positive = value => Number.isSafeInteger(value) && value > 0;
const apply=Reflect.apply;
// No error-value coercion, accessor invocation or Proxy trap for diagnostics.
function safeErrorText(value,limit) {
  if(value===null||typeof value!=='object'||types.isProxy(value)||!types.isNativeError(value))return 'non-Error failure';
  const descriptor=Object.getOwnPropertyDescriptor(value,'message');
  return descriptor&&Object.hasOwn(descriptor,'value')&&typeof descriptor.value==='string'
    ?descriptor.value.slice(0,limit).replace(/[^ -~]/g,'?'):'native Error';
}
function workFailure(value) {
  return value!==null&&typeof value==='object'&&!types.isProxy(value)&&types.isNativeError(value)
    ?value:new Error('Bundle world: non-Error failure',{cause:value});
}
const fail = code => { throw Error('Bundle world: ' + code); };
export function describeBundleWorldSource(binding, manifest) {
  if (!exact(binding,['key','revision']) || !manifestKey.test(binding.key) || !hex.test(binding.revision) || manifest?.world !== 'athens' || manifest.revision !== binding.revision) fail('build binding mismatch');
  return Object.freeze({schemaVersion:1, origin:BUNDLE_WORLD_ORIGIN, manifestKey:binding.key, worldSetRevision:binding.revision});
}
function sourceDescriptor(value) {
  if (!exact(value,['schemaVersion','origin','manifestKey','worldSetRevision']) || value.schemaVersion !== 1 || value.origin !== BUNDLE_WORLD_ORIGIN || !manifestKey.test(value.manifestKey) || !hex.test(value.worldSetRevision)) fail('source descriptor unavailable or invalid');
  return Object.freeze({...value});
}
function lowerLimits(overrides) {
  if (!plain(overrides)) fail('limits');
  const result={...BUNDLE_WORLD_LIMITS};
  for (const [key,value] of Object.entries(overrides)) {
    if (!Object.hasOwn(result,key) || !positive(value) || value > result[key]) fail('limits');
    result[key]=value;
  }
  return Object.freeze(result);
}
// Empty/offline legacy builds need no transport. Enabled compiled routes require it.
export function bundleWorldSourceFromCatalogue(catalogue, installedConfig) {
  if (!plain(catalogue) || !Array.isArray(installedConfig?.routes)) fail('catalogue unavailable');
  const fields=['id','url','routeHash','geometryHash','worldSetRevision'];
  const view=config=>({environment:config?.environment,world:config?.world===true,online:config?.online===true,
    routes:Array.isArray(config?.routes)?config.routes.map(route=>Object.fromEntries(fields.map(key=>[key,route[key]]))):null});
  // installRouteMaps adds onlineAvailable to the public view. Compare every
  // configured tuple/URL and activation flag, not byte-identical object shape.
  if (canonicalWorldJSON(view(catalogue.routeConfig)) !== canonicalWorldJSON(view(installedConfig))) fail('catalogue changed after installation');
  if(installedConfig.onlineAvailable!==undefined&&installedConfig.onlineAvailable!==false)fail('online transport unavailable');
  if (!installedConfig.routes.length) {
    if (catalogue.worldAssetSource != null) fail('unexpected source on empty build');
    return null;
  }
  if (installedConfig.online !== false) fail('online recovery transport not implemented by this host');
  const source=sourceDescriptor(catalogue.worldAssetSource);
  if (installedConfig.routes.some(route=>route.worldSetRevision !== source.worldSetRevision)) fail('compiled world binding mismatch');
  return source;
}
export function isBundleWorldPath(path) {
  return path === '/data/athens/manifest.json' || path.startsWith('/world/');
}
// Failure cleanup has its own existing cleanup budget, never the failed work guard.
// Completion means an observed close (or native closed===true), not destroyed=true.
async function observeOwnedResponseClose(res,{until,now}) {
  let observed=false,timer,hasError=false,firstError,resolveClose;const attached=[];
  const closed=new Promise(resolve=>{resolveClose=resolve;});
  const onClose=()=>{observed=true;resolveClose();};
  const remember=error=>{if(!hasError){hasError=true;firstError=error;}};
  const onError=remember;
  try {
    for(const [event,listener]of [['close',onClose],['error',onError]])try {
      const once=res.once;if(typeof once!=='function')fail('response close observer unavailable');
      apply(once,res,[event,listener]);attached.push([event,listener]);
    } catch(error){remember(error);}
    // Always attempt owned destruction, including observer/deadline failure.
    try{if(res.closed===true)observed=true;}catch(error){remember(error);}
    if(!observed)try{const destroy=res.destroy;if(typeof destroy!=='function')fail('response destroy unavailable');apply(destroy,res,[]);}catch(error){remember(error);}
    if(hasError)throw firstError;
    if(!observed)await Promise.race([closed,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Bundle world: response close deadline')),Math.max(0,until-now()));})]);
    if(!observed||now()>=until)fail('response close late');
  } catch(error){remember(error);}
  finally {
    try{clearTimeout(timer);}catch(error){remember(error);}
    for(const [event,listener]of attached)try{res.removeListener(event,listener);}catch(error){remember(error);}
    try{if(now()>=until)remember(Error('Bundle world: response cleanup deadline'));}catch(error){remember(error);}
  }
  if(hasError)throw firstError;
}
export async function prepareBundleWorldAssets(value, {fetcher=fetch, signal, limits:overrides={}, now=()=>performance.now()} = {}) {
  const source=sourceDescriptor(value), limits=lowerLimits(overrides), born=now(), deadline=born+limits.lifetimeMs;
  let hasFirstFailure=false,firstFailure,hasCleanupFailure=false,cleanupFailure, cleanupConfirmed=false, closed=false, active=0, pending=0, upstreamBytes=0, downstreamBytes=0, metadataBytes=0, requests=0, enrichmentReads=0, enrichmentBytes=0;
  let sequence=Promise.resolve(), resolveFailure;
  const failure=new Promise(resolve=>{resolveFailure=resolve;});
  const objects=new Map(), metadata=new Map(), controllers=new Set(), cancellations=new Set(), fetches=new Set(), forwards=new Set(), phases=new WeakMap();
  const closeSignal=new AbortController(), secondaryFailures=[];let secondaryOverflow=false,cleanupUntil=null,responseCleanupPending=0,responseCleanupUncertain=0;
  const responseCleanup=new WeakMap();
  const cleanupBudget=()=>cleanupUntil??=now()+limits.closeMs;
  const latch=error=>{if(!hasFirstFailure){hasFirstFailure=true;firstFailure=workFailure(error);resolveFailure(firstFailure);}return firstFailure;};
  const check=until=>{
    if (hasFirstFailure) throw firstFailure;
    if (closed) fail('closed');
    if (signal?.aborted) throw signal.reason;
    if (now() >= Math.min(deadline,until??deadline)) fail('deadline');
  };
  function recordFailure(error,kind='bridge') {
    if(kind==='bridge-cleanup'&&!hasCleanupFailure){hasCleanupFailure=true;cleanupFailure=error;}
    if(hasFirstFailure&&error!==firstFailure) {
      const message=safeErrorText(error,40);
      if(secondaryFailures.length<8)secondaryFailures.push(Object.freeze({kind:['bridge','bridge-write','bridge-cleanup','guard'].includes(kind)?kind:'bridge',message}));
      else secondaryOverflow=true;
    }
    return latch(error);
  }
  function cleanupAttempt(operation) {
    try{operation();return true;}catch(error){recordFailure(error,'bridge-cleanup');return false;}
  }
  function phaseCheck(state) {
    try {
      if(state.signal?.aborted)throw state.signal.reason;
      check(state.until);
    } catch(error){throw recordFailure(error,'guard');}
  }
  function cancelResponse(state) {
    try{const body=state.response?.body;if(body&&!body.locked)cancel({cancel:()=>body.cancel()});}catch(error){recordFailure(error,'bridge-cleanup');}
    // arrayBuffer owns a locked reader internally. Its promise stays in forwards;
    // an uncooperative copy cannot count as confirmed cleanup.
  }
  function trackForward(work) {
    const owned=Promise.resolve(work);
    if(!forwards.has(owned)){forwards.add(owned);owned.then(()=>forwards.delete(owned),error=>{forwards.delete(owned);if(hasFirstFailure&&error!==firstFailure)recordFailure(error);});}
    return owned;
  }
  function closeFailedResponse(res) {
    const prior=responseCleanup.get(res);if(prior)return prior;
    let until,hasBudgetError=false,budgetError;
    try{until=cleanupBudget();}catch(error){hasBudgetError=true;budgetError=error;recordFailure(error,'bridge-cleanup');until=-Infinity;}
    responseCleanupPending++;
    const work=Promise.resolve().then(()=>observeOwnedResponseClose(res,{until,now})).catch(error=>{
      responseCleanupUncertain++;recordFailure(error,'bridge-cleanup');throw hasBudgetError?budgetError:error;
    }).finally(()=>{responseCleanupPending--;});
    responseCleanup.set(res,work);trackForward(work);return work;
  }
  async function phaseWait(state,work) {
    const owned=trackForward(work);
    let timer,abortListener;
    const signals=[signal,state.signal,closeSignal.signal].filter(Boolean);
    const combined=signals.length?AbortSignal.any(signals):null;
    let rejectAbort;
    const interrupted=new Promise((_,reject)=>{rejectAbort=reject;});
    abortListener=()=>rejectAbort(combined.reason);
    combined?.addEventListener('abort',abortListener,{once:true});
    try {
      phaseCheck(state);
      if(combined?.aborted)throw combined.reason;
      timer=setTimeout(()=>rejectAbort(Error('Bundle world: response deadline')),Math.max(0,Math.min(deadline,state.until)-now()));
      const result=await Promise.race([owned,interrupted,failure.then(error=>{throw error;})]);
      phaseCheck(state);return result;
    } catch(error) {recordFailure(error);cancelResponse(state);throw firstFailure;}
    finally {let failed=false;if(!cleanupAttempt(()=>clearTimeout(timer)))failed=true;if(!cleanupAttempt(()=>combined?.removeEventListener('abort',abortListener)))failed=true;if(failed)throw firstFailure;}
  }
  function beginRequest(requestSignal) {
    const state={until:Math.min(deadline,now()+limits.objectMs),signal:requestSignal,request:null,response:null,complete:false};
    phaseCheck(state);
    const phase=Object.freeze({
      check(){phaseCheck(state);},
      async body(response) {
        try {
          phaseCheck(state);if(state.complete||state.response!==response)fail('response phase identity');
          const body=response.body,copy=body?response.arrayBuffer:null;
          phaseCheck(state);if(!body)return null;
          const buffer=await phaseWait(state,apply(copy,response,[]));
          if(!(buffer instanceof ArrayBuffer)||buffer.byteLength>limits.objectBytes)fail('response copy type or size');
          const bytes=new Uint8Array(buffer);phaseCheck(state);return bytes;
        } catch(error){recordFailure(error);cancelResponse(state);throw firstFailure;}
      },
      track:trackForward,
      wait(work){return phaseWait(state,work);},
      finish(){phaseCheck(state);state.complete=true;},
      fail(error,kind){const primary=recordFailure(error,kind);cancelResponse(state);return primary;},
    });
    phases.set(phase,state);return phase;
  }
  function cancel(reader) {
    if (!reader) return;
    let attempt;try{attempt=reader.cancel();}catch(error){attempt=Promise.reject(error);}
    const work=Promise.resolve(attempt).catch(error=>{recordFailure(error,'bridge-cleanup');throw error;});
    cancellations.add(work);work.then(()=>cancellations.delete(work),()=>{});
    // A rejection is retained for close(), never an unhandled background rejection.
    work.catch(()=>{});
  }
  async function read(key, expected, until, requestSignal) {
    check(until);if(requestSignal?.aborted)throw requestSignal.reason;
    if (active) fail('overlapping upstream read');
    active++; const controller=new AbortController();controllers.add(controller);
    let reader, response, timer, abortListener;
    const end=Math.min(until,deadline,now()+limits.objectMs);
    let rejectAbort;
    const interrupted=new Promise((_,reject)=>{rejectAbort=reject;});
    controller.signal.addEventListener('abort',()=>rejectAbort(controller.signal.reason),{once:true});
    abortListener=()=>{controller.abort(combined?.reason);};
    const combined=signal&&requestSignal?AbortSignal.any([signal,requestSignal]):(signal||requestSignal);
    combined?.addEventListener('abort',abortListener,{once:true});
    if(combined?.aborted)controller.abort(combined.reason);
    timer=setTimeout(()=>{const error=Error('Bundle world: object deadline');controller.abort(error);rejectAbort(error);},Math.max(0,end-now()));
    const bounded=async promise=>{const result=await Promise.race([promise,interrupted]);check(end);return result;};
    try {
      const upstream=Promise.resolve().then(()=>fetcher(source.origin+'/world/'+key,{
        method:'GET', redirect:'error', credentials:'omit', cache:'no-store',
        headers:{'Accept-Encoding':'identity'}, signal:controller.signal,
      }));
      const fetching=upstream.then(value=>{response=value;if(controller.signal.aborted)cleanupAttempt(()=>{if(response?.body&&!response.body.locked)cancel(response.body.getReader());});return response;});
      fetches.add(fetching);fetching.then(()=>fetches.delete(fetching),()=>fetches.delete(fetching));
      response=await bounded(fetching);
      reader=response?.body?.getReader();
      if (!response || response.status !== 200 || response.redirected) fail('upstream status or redirect');
      if (response.url && response.url !== source.origin+'/world/'+key) fail('upstream response URL');
      if (response.headers.get('content-encoding') && response.headers.get('content-encoding') !== 'identity') fail('HTTP content encoding');
      const declared=response.headers.get('content-length');
      if (declared !== null && (!/^[1-9]\d*$/.test(declared) || !positive(Number(declared)) || Number(declared)>expected.cap || expected.bytes!=null&&Number(declared)!==expected.bytes)) fail('upstream length');
      if (!response.body) fail('missing body');
      const chunks=[];let length=0;
      for (;;) {
        const {value:chunk,done}=await bounded(reader.read());if(done)break;
        if (!(chunk instanceof Uint8Array)) fail('body chunk type');
        length+=chunk.byteLength;upstreamBytes+=chunk.byteLength;
        // Immutable enrichment JSON is opaque, lazy and never a regional manifest.
        // Charge every received byte cumulatively, including a failed transfer.
        if(expected.enrichment){metadataBytes+=chunk.byteLength;enrichmentBytes+=chunk.byteLength;if(metadataBytes>limits.metadataBytes)fail('metadata cap');}
        if (length>expected.cap || upstreamBytes>limits.upstreamBytes || expected.bytes!=null&&length>expected.bytes) fail('body byte limit');
        if(chunks.length>=4096)fail('body chunk cap');chunks.push(chunk);
      }
      if (!length || expected.bytes!=null&&length!==expected.bytes || declared!==null&&length!==Number(declared)) fail('body length');
      const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
      if (digest(bytes)!==expected.sha256) fail('raw SHA mismatch');
      check(end);if(expected.enrichment)enrichmentReads++;return bytes;
    } catch(error) {latch(error);cleanupAttempt(()=>controller.abort(error));cleanupAttempt(()=>{if(!reader&&response?.body&&!response.body.locked)reader=response.body.getReader();});cancel(reader);throw firstFailure;}
    finally {let failed=false;for(const operation of [()=>clearTimeout(timer),()=>combined?.removeEventListener('abort',abortListener),()=>reader?.releaseLock()])if(!cleanupAttempt(operation))failed=true;controllers.delete(controller);active--;if(failed)throw firstFailure;}
  }
  function address(url, base, pattern) {
    if(typeof url!=='string'||url.length>256||!url.startsWith('/')||url.startsWith('//')||url.includes('\\')||/[%?#]/.test(url)) fail('nonlocal immutable URL');
    const resolved=new URL(url,base);
    if(url!==resolved.pathname||resolved.origin!==source.origin||resolved.username||resolved.password||!resolved.pathname.startsWith('/world/')) fail('immutable URL origin');
    const key=resolved.pathname.slice(7);if(!pattern.test(key)||resolved.pathname!=='/world/'+key) fail('immutable URL path');return key;
  }
  function admit(key, expected) {
    const prior=objects.get(key);
    if(prior && (prior.sha256!==expected.sha256 || prior.bytes!==expected.bytes)) fail('conflicting immutable identity');
    if(!prior) {if(objects.size>=limits.objects)fail('object inventory cap');objects.set(key,Object.freeze({...expected}));}
  }
  async function manifest(key, hash, until) {
    const prior=metadata.get(key);if(prior)return json(prior);
    const bytes=await read(key,{sha256:hash,cap:limits.metadataBytes-metadataBytes},until);
    metadataBytes+=bytes.byteLength;if(metadataBytes>limits.metadataBytes)fail('metadata cap');
    admit(key,{sha256:hash,bytes:bytes.byteLength,cap:bytes.byteLength});metadata.set(key,bytes);
    return json(bytes);
  }
  function entries(m) {
    // These URLs remain unchanged. Non-world enrichments are built local data assets,
    // outside this immutable transport; reject external/unbounded alternate URLs.
    if(m.enrichments!=null) {
      if(!Array.isArray(m.enrichments)||m.enrichments.length>16)fail('enrichment inventory');
      for(const e of m.enrichments) {
        if(!plain(e)||Object.hasOwn(e,'range'))fail('unsupported enrichment descriptor');
        if(typeof e.url==='string'&&e.url.startsWith('/world/')) {
          const key=address(e.url,source.origin,manifestKey);
          // URL content hash authenticates raw JSON; descriptor supplies no length.
          // No eager read, semantic recursion, parse or metadata-cache admission.
          admit(key,{sha256:manifestKey.exec(key)[1],cap:limits.objectBytes,enrichment:true});
        } else if(typeof e.url!=='string'||e.url.length>256||!/^\/data\/[a-zA-Z0-9_/-]+\.json$/.test(e.url)||e.url.includes('/../')||e.url.includes('/./'))fail('unsupported enrichment URL');
      }
    }
    if(m.regionalAssets!=null&&(!Array.isArray(m.regionalAssets)||m.regionalAssets.length>64))fail('regional asset inventory');
    const list=[...Object.values(m.tiles),...(m.regionalAssets||[])];
    for (const entry of list) {
      if(entry.range)fail('ranged objects unsupported');
      const key=address(entry.url,source.origin,cellKey);
      if(!hex.test(entry.sha256)||cellKey.exec(key)[1]!==entry.sha256||!positive(entry.bytes)||entry.bytes>limits.objectBytes)fail('cell or asset identity/size');
      admit(key,{sha256:entry.sha256,bytes:entry.bytes,cap:entry.bytes});
    }
  }
  async function close() {
    closed=true;cleanupConfirmed=false;
    cleanupAttempt(()=>closeSignal.abort(Error('Bundle world: closed')));
    for(const controller of controllers)cleanupAttempt(()=>controller.abort(Error('Bundle world: closed')));
    let timer,expired=false,until;
    try {
      until=cleanupBudget();
      await Promise.race([(async()=>{
        await sequence;await Promise.allSettled([...fetches]);await Promise.allSettled([...forwards]);await Promise.all([...cancellations]);
        if(active||pending||fetches.size||forwards.size||responseCleanupPending)fail('cleanup still active');
        if(hasCleanupFailure)throw cleanupFailure;
        if(expired||now()>=until)fail('cleanup confirmation late');
      })(),new Promise((_,reject)=>{timer=setTimeout(()=>{expired=true;reject(Error('Bundle world: cleanup deadline'));},Math.max(0,until-now()));})]);
    } catch(error){recordFailure(error,'bridge-cleanup');}
    finally {
      for(const operation of [()=>clearTimeout(timer),()=>metadata.clear(),()=>objects.clear()])cleanupAttempt(operation);
      cleanupAttempt(()=>{if(expired||until===undefined||now()>=until)fail('cleanup confirmation late');});
    }
    if(hasCleanupFailure)throw cleanupFailure;
    cleanupConfirmed=true;
  }
  try {
    const until=Math.min(deadline,born+limits.prepareMs);
    const root=await manifest(source.manifestKey,manifestKey.exec(source.manifestKey)[1],until);
    let composed;
    if(root.regions && root.tileVersion!==1) {
      if(!Array.isArray(root.regions)||!root.regions.length||root.regions.length>limits.regions)fail('region cap');
      const {revision,...content}=root;
      if(digest(new TextEncoder().encode(canonicalWorldJSON(content)))!==revision)fail('semantic revision');
      const sources={};
      for(const region of root.regions) {
        const key=address(region.manifestUrl,source.origin,manifestKey);
        if(!hex.test(region.manifestSha256)||manifestKey.exec(key)[1]!==region.manifestSha256)fail('region SHA binding');
        const m=await manifest(key,region.manifestSha256,until);entries(m);
        sources[region.id]={url:source.origin+'/world/'+key,manifest:m};
      }
      composed=composeWorldManifest(root,sources);
    } else {composed=validateWorldDefinition({manifest:root}).manifest;entries(composed);}
    if(composed.world!=='athens'||composed.revision!==source.worldSetRevision)fail('world revision mismatch');
    check(until);
  } catch(error) {latch(error);try{await close();}catch(secondary){try{Object.defineProperty(firstFailure,'cleanupError',{value:secondary,configurable:true});}catch(error){recordFailure(error,'bridge-cleanup');}}throw firstFailure;}
  async function get(key,requestSignal,until) {
    check();const expected=objects.get(key);if(!expected)return null;
    let bytes=metadata.get(key);
    if(!bytes) {
      if(pending>=limits.pending)throw latch(Error('Bundle world: pending request cap'));
      pending++;
      const work=sequence.then(()=>{
        const bounded=expected.enrichment?{...expected,cap:Math.min(expected.cap,limits.metadataBytes-metadataBytes)}:expected;
        if(bounded.cap<1)fail('metadata cap');
        return read(key,bounded,until,requestSignal);
      });
      sequence=work.catch(()=>{});
      try{bytes=await work;}finally{pending--;}
    }
    check();
    return {size:bytes.byteLength,httpEtag:'"'+expected.sha256+'"',body:bytes};
  }
  return Object.freeze({
    source, failure, beginRequest, recordFailure, closeFailedResponse,
    check(){try{check();}catch(error){throw recordFailure(error,'guard');}},
    status(){return Object.freeze({prepared:!closed&&!hasFirstFailure,closed,cleanupConfirmed,fetches:fetches.size,firstFailure:hasFirstFailure?safeErrorText(firstFailure,256):null,firstFailurePresent:hasFirstFailure,objects:objects.size,metadataBytes,enrichmentReads,enrichmentBytes,upstreamBytes,downstreamBytes,requests,pending,active,cleanupFailed:hasCleanupFailure,forwarding:forwards.size,secondaryFailures:[...secondaryFailures],secondaryOverflow,responseCleanupPending,responseCleanupUncertain});},
    async handle(request,phase) {
      try {
        if(phase===undefined)phase=beginRequest(request.signal);
        const state=phases.get(phase);if(!state||state.request)fail('request phase identity');
        phaseCheck(state);state.request=request;
        const path=new URL(request.url).pathname;if(!isBundleWorldPath(path))return null;
        if(request.signal.aborted)throw request.signal.reason;
        if(++requests>limits.requests)fail('request cap');
        const response=await worldAssets(request,{ATHENS_WORLD:{get:key=>get(key,request.signal,state.until)},ATHENS_WORLD_MANIFEST:source.manifestKey},null,null);
        state.response=response;
        const count=Number(response.headers.get('content-length')||0);
        if(request.method==='GET'&&response.status===200) {downstreamBytes+=count;if(downstreamBytes>limits.downstreamBytes)fail('downstream byte cap');}
        phaseCheck(state);return response;
      } catch(error) {throw recordFailure(error);}
    },
    close,
  });
}
// World routes are dispatched before generic /data/*.json compression. No real
// server or socket is needed to exercise this bridge with inert request/response fakes.
export async function serveBundleWorldRequest(adapter, req, res) {
  const path=new URL(req.url,'http://localhost').pathname;
  if(!isBundleWorldPath(path))return false;
  const controller=new AbortController();
  let phase,headersCommitted=false,endStarted=false,forwardFinished=false,accepted=false,completeResolve,completeReject;
  const disconnected=()=>{if(!forwardFinished&&!res.writableFinished){const error=Error('Bundle world: client disconnected');completeReject?.(error);controller.abort(error);}};
  const writeError=error=>{const primary=note(error,'bridge-write');completeReject?.(primary);controller.abort(primary);};
  const note=(error,kind='bridge')=>{if(phase)return phase.fail(error,kind);if(adapter?.recordFailure)return adapter.recordFailure(error,kind);return error;};
  const destroy=async()=>{
    try {
      if(adapter?.closeFailedResponse)await adapter.closeFailedResponse(res);
      else await observeOwnedResponseClose(res,{until:performance.now()+BUNDLE_WORLD_LIMITS.closeMs,now:()=>performance.now()});
    } catch(error){note(error,'bridge-cleanup');}
  };
  req.once?.('aborted',disconnected);res.once?.('close',disconnected);
  try {
    if(!adapter)fail('source unavailable');
    phase=adapter.beginRequest(controller.signal);
    // Constructing Request copies/serializes native headers under the same phase.
    const method=req.method;
    const request=new Request('http://localhost'+req.url,{method,headers:req.headers,signal:controller.signal});
    phase.check();
    const response=await adapter.handle(request,phase);
    const bytes=await phase.body(response);
    const headers=Object.fromEntries(Array.from(response.headers,([key,value])=>[String(key),String(value)])),status=Number(response.status);
    // Capture every potentially costly getter/serialization before the last guard.
    const length=headers['content-length'],writeHead=res.writeHead,end=res.end;
    phase.check();
    if(!Number.isInteger(status)||status<100||status>599)fail('response status');
    if(method==='GET'&&status===200&&(!/^[1-9]\d*$/.test(length||'')||Number(length)!==bytes?.byteLength))fail('response content length');
    phase.check();
    const completion=new Promise((resolve,reject)=>{completeResolve=resolve;completeReject=reject;});
    completion.catch(()=>{});phase.track(completion);
    res.once?.('error',writeError);
    phase.check();
    apply(writeHead,res,[status,headers]);headersCommitted=true;
    phase.check(); // No body follows a late/aborted header operation.
    endStarted=true;apply(end,res,[bytes,error=>{const failed=error!==null&&error!==undefined;forwardFinished=!failed;if(failed)completeReject(error);else completeResolve();}]);
    phase.check();
    await phase.wait(completion);
    phase.finish();accepted=true; // Charges callback/flush and final forwarding costs.
  } catch(error) {
    const primary=note(error);controller.abort(primary);
    if(!endStarted)completeReject?.(primary);
    // No second error-body write. Failed work is never a cleanup admission guard.
    await destroy();
  } finally {
    for(const [owner,event,listener]of [[req,'aborted',disconnected],[res,'close',disconnected],[res,'error',writeError]]) {
      try{owner.removeListener?.(event,listener);}catch(error){note(error,'bridge-cleanup');await destroy();}
    }
    if(accepted)try{phase.check();}catch(error){const primary=note(error);controller.abort(primary);await destroy();}
  }
  return true;
}
