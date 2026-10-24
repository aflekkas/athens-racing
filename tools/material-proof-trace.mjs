// Passive proof metadata only: no request/response bodies, headers, credentials or wire changes.
import {createHash} from 'node:crypto';
const hash=value=>createHash('sha256').update(String(value)).digest('hex');
export function traceURL(raw){
 try{const url=new URL(String(raw).split(/[?#]/,1)[0]);return {origin:url.origin.length<=256?url.origin:'sha256:'+hash(url.origin),pathSHA256:hash(url.pathname)};}
 catch{return {origin:'invalid',pathSHA256:null};}
}
const id=value=>value==null?null:typeof value==='string'&&/^[A-Za-z0-9_.:-]{1,96}$/.test(value)?value:'sha256:'+hash(value);
const number=value=>typeof value==='number'&&Number.isFinite(value)?value:null;
const netError=value=>typeof value==='string'&&/^net::[A-Z0-9_]{1,64}$/.test(value)?{error:value}:{error:'other',errorSHA256:hash(value)};
const same=(a,b)=>a?.origin===b?.origin&&a?.pathSHA256===b?.pathSHA256;
const timingFields=['startTime','domainLookupStart','domainLookupEnd','connectStart','secureConnectionStart','connectEnd','requestStart','responseStart','responseEnd'];
const timing=value=>Object.fromEntries(timingFields.filter(key=>number(value?.[key])!==null).map(key=>[key,value[key]]));
export function createPassiveTrace({localOrigin,clock=()=>performance.now(),getFailure=()=>null,maxEvents=128,maxRequests=32,maxCleanupEvents=32,maxEventBytes=131072}={}){
 for(const value of [maxEvents,maxRequests,maxCleanupEvents,maxEventBytes])if(!Number.isSafeInteger(value)||value<1)throw Error('TRACE_CAP_REQUIRED');
 const started=clock(),pw=new WeakMap(),cdp=new Map();let pwSequence=0,commandSequence=0,cleanup=false,active=null,eventBytes=0,cleanupBytes=0;
 const local=traceURL(localOrigin).origin;
 const report={version:1,scope:'auth endpoints and document lifecycle; metadata only',events:[],cleanupEvents:[],pwRequests:[],cdpRequests:[],lastUntrackedCDP:null,observerErrors:[],firstFailedPW:null,firstFailedCDP:null,firstCause:null,activeCommand:null,commands:{gotoBegins:0,preferencesRegistered:false,initBeforeOnlyGoto:true},caps:{maxEvents,maxRequests,maxCleanupEvents,maxEventBytes,reached:false,terminationLabel:null,droppedEvents:0,droppedCleanup:0,droppedPWRequests:0,droppedCDPRequests:0},cleanupStartedMs:null,termination:null};
 const now=()=>Math.max(0,clock()-started);
 const cap=label=>{report.caps.reached=true;report.caps.terminationLabel||=label+'; detailed trace capped, critical first-failure/cause summaries retained';};
 const emit=(kind,data={})=>{
  const event={kind,nodeMs:now(),phase:cleanup?'cleanup':'run',activeCommand:active?{...active}:null,...data},bytes=Buffer.byteLength(JSON.stringify(event));
  if(cleanup){if(report.cleanupEvents.length>=maxCleanupEvents||cleanupBytes+bytes>32768){cap('cleanup-cap');report.caps.droppedCleanup++;return;}cleanupBytes+=bytes;report.cleanupEvents.push(event);}
  else{if(report.events.length>=maxEvents||eventBytes+bytes>maxEventBytes){cap('event-cap');report.caps.droppedEvents++;return;}eventBytes+=bytes;report.events.push(event);}
 };
 const classify=(raw,document)=>{const safe=traceURL(raw);let auth=null;try{const path=new URL(String(raw).split(/[?#]/,1)[0]).pathname;if(safe.origin===local&&['/api/auth/config','/api/auth/session'].includes(path))auth=path.endsWith('config')?'config':'session';}catch{}return {safe,scope:document?'document':auth?'auth-'+auth:null};};
 const allCDP=()=>[...new Map([...report.cdpRequests,report.lastUntrackedCDP,report.firstFailedCDP].filter(Boolean).map(r=>[r.id,r])).values()];
 const correlate=()=>{
  const records=[...report.pwRequests,...(report.firstFailedPW&&!report.pwRequests.includes(report.firstFailedPW)?[report.firstFailedPW]:[])];
  for(const request of records){const candidates=allCDP().filter(candidate=>same(candidate.safe,request.safe)&&candidate.method===request.method);request.cdpCandidates=candidates.map(c=>c.id);request.correlation=candidates.length===1?'unique-url/method candidate, not a proven causal link':candidates.length?'ambiguous-url/method candidates':report.caps.droppedCDPRequests?'unavailable-after-cdp-cap':'not-observed';}
  if(report.firstCause){report.firstCause.pwCandidates=records.filter(r=>same(r.safe,report.firstCause.safe)).map(r=>r.id);report.firstCause.cdpCandidates=allCDP().filter(r=>same(r.safe,report.firstCause.safe)).map(r=>r.id);}
 };
 const captureCause=()=>{
  const cause=getFailure();if(cause&&!report.firstCause){report.firstCause={code:typeof cause.code==='string'&&/^[A-Z_]{1,64}$/.test(cause.code)?cause.code:'other',safe:{origin:traceURL(cause.origin).origin,pathSHA256:/^[a-f0-9]{64}$/.test(cause.pathSHA256||'')?cause.pathSHA256:null},nodeMs:now(),activeCommand:active?{...active}:null,phase:cleanup?'cleanup':'run',pwCandidates:[],cdpCandidates:[]};correlate();}
 };
 const snapshotPW=request=>{
  const kind=classify(request.url(),request.isNavigationRequest());if(!kind.scope)return null;
  return {safe:kind.safe,scope:kind.scope,method:/^[A-Z]{1,12}$/.test(request.method())?request.method():'other',resourceType:['document','fetch','xhr'].includes(request.resourceType())?request.resourceType():'other',isNavigation:request.isNavigationRequest(),timing:timing(request.timing())};
 };
 const pwEvent=(kind,request,status)=>{
  const data=snapshotPW(request);if(!data)return;
  let record=pw.get(request);
  if(!record){if(report.pwRequests.length<maxRequests){record={id:'pw-'+(++pwSequence),...data,firstNodeMs:now(),lastEvent:kind};pw.set(request,record);report.pwRequests.push(record);}else{cap('pw-request-cap');report.caps.droppedPWRequests++;record={id:'pw-untracked-'+(++pwSequence),...data,firstNodeMs:now(),lastEvent:kind,untrackedBecauseCap:true};}}
  Object.assign(record,data,{lastEvent:kind,lastNodeMs:now()});if(status!==undefined)record.status=number(status);
  if(kind==='request-failed'){Object.assign(record,netError(request.failure()?.errorText),{failurePhase:cleanup?'cleanup':'run',failureNodeMs:now()});report.firstFailedPW||=record;}
  emit(kind,{requestId:record.id,safe:record.safe,scope:record.scope,status:record.status,timing:record.timing,...(kind==='request-failed'?netError(request.failure()?.errorText):{})});correlate();queueMicrotask(captureCause);
 };
 const initiator=value=>{
  const result={type:['script','parser','preload','preflight','other'].includes(value?.type)?value.type:'other',frames:[],truncated:false};if(value?.url)result.location={...traceURL(value.url),line:number(value.lineNumber),column:number(value.columnNumber)};let stack=value?.stack,depth=0;
  while(stack&&depth++<2){for(const frame of stack.callFrames||[]){if(result.frames.length>=8){result.truncated=true;break;}result.frames.push({...traceURL(frame.url),line:number(frame.lineNumber),column:number(frame.columnNumber)});}if(result.frames.length>=8){if(stack.parent)result.truncated=true;stack=null;break;}stack=stack.parent;}
  if(stack)result.truncated=true;return result;
 };
 const cdpRequest=event=>{
  const kind=classify(event.request.url,event.type==='Document');if(!kind.scope)return;
  const key=id(event.requestId);let record=cdp.get(key);
  if(!record){record={id:key,initialSafe:kind.safe,redirects:0};if(cdp.size>=maxRequests){cap('cdp-request-cap');report.caps.droppedCDPRequests++;record.untrackedBecauseCap=true;report.lastUntrackedCDP=record;}else{cdp.set(key,record);report.cdpRequests.push(record);}}else record.redirects++;
  Object.assign(record,{safe:kind.safe,scope:kind.scope,method:/^[A-Z]{1,12}$/.test(event.request.method)?event.request.method:'other',frameId:id(event.frameId),loaderId:id(event.loaderId),timestamp:number(event.timestamp),wallTime:number(event.wallTime),initiator:initiator(event.initiator)});
  emit('cdp-request',{requestId:key,safe:record.safe,scope:record.scope,frameId:record.frameId,loaderId:record.loaderId,timestamp:record.timestamp,wallTime:record.wallTime,initiator:record.initiator});correlate();
 };
 const cdpEvent=(kind,event)=>{
  const key=id(event.requestId),record=cdp.get(key)||(report.lastUntrackedCDP?.id===key?report.lastUntrackedCDP:null);
  if(!record){if(kind==='cdp-failed'&&['Document','Fetch','XHR'].includes(event.type)&&!report.firstFailedCDP){report.firstFailedCDP={id:key,untrackedBecauseCapOrMissingStart:true,timestamp:number(event.timestamp),arrivalPhase:cleanup?'cleanup':'run',canceled:!!event.canceled,correlation:'start metadata unavailable after cap or missing start',...netError(event.errorText)};emit(kind,{...report.firstFailedCDP});queueMicrotask(captureCause);}return;}
  const meta={requestId:key,timestamp:number(event.timestamp)};
  if(kind==='cdp-response'){meta.status=number(event.response.status);meta.timing=Object.fromEntries(['requestTime','dnsStart','dnsEnd','connectStart','connectEnd','sslStart','sslEnd','sendStart','sendEnd','receiveHeadersStart','receiveHeadersEnd'].filter(k=>number(event.response.timing?.[k])!==null).map(k=>[k,event.response.timing[k]]));}
  if(kind==='cdp-finished')meta.encodedDataLength=number(event.encodedDataLength);
  if(kind==='cdp-failed'){Object.assign(meta,{arrivalPhase:cleanup?'cleanup':'run',canceled:!!event.canceled,blockedReason:typeof event.blockedReason==='string'&&/^[a-z-]{1,64}$/.test(event.blockedReason)?event.blockedReason:null,...netError(event.errorText)});report.firstFailedCDP||={...record,...meta};}
  if(kind==='cdp-response')record.responseMetadata=meta;if(kind==='cdp-finished')record.finishMetadata=meta;if(kind==='cdp-failed')record.failureMetadata=meta;
  record.lastEvent=kind;record.lastMetadata=meta;emit(kind,meta);correlate();queueMicrotask(captureCause);
 };
 const beginCleanup=label=>{if(!cleanup){captureCause();cleanup=true;report.cleanupStartedMs=now();emit('cleanup-begin',{label});}};
 const finish=label=>{captureCause();correlate();report.termination={label,nodeMs:now(),capped:report.caps.reached};};
 const wrapPage=page=>new Proxy(page,{get(target,key){const value=Reflect.get(target,key);if(typeof value!=='function')return value;if(!['goto','evaluate','waitForFunction','addInitScript'].includes(key))return value.bind(target);return async(...args)=>{
  const previous=active;active={id:++commandSequence,name:key,stage:'guarded-invocation',afterFatal:!!getFailure()};report.activeCommand={...active};
  if(key==='goto'){report.commands.gotoBegins++;report.commands.initBeforeOnlyGoto&&=report.commands.preferencesRegistered&&report.commands.gotoBegins===1;}
  emit(key==='goto'?'goto-BEGIN':'command-BEGIN',{command:key});
  try{const result=await value.apply(target,args);if(key==='addInitScript'){report.commands.preferencesRegistered=true;emit('preferences-installed',{meaning:'addInitScript registration completed before document boot; execution not separately instrumented'});}emit(key==='goto'?'goto-END':'command-END',{command:key,outcome:'resolved'});return result;}
  catch(error){captureCause();emit(key==='goto'?'goto-END':'command-END',{command:key,outcome:'rejected'});throw error;}
  finally{active=previous;report.activeCommand=active?{...active}:null;}
 };}});
 const observe=fn=>(...args)=>{try{fn(...args);}catch(error){if(report.observerErrors.length<4)report.observerErrors.push({nodeMs:now(),errorSHA256:hash(error?.message)});cap('metadata-observer-error');}};
 const attach=async page=>{
  page.on('request',observe(r=>pwEvent('request',r)));page.on('response',observe(r=>pwEvent('response',r.request(),r.status())));page.on('requestfinished',observe(r=>pwEvent('request-finished',r)));page.on('requestfailed',observe(r=>pwEvent('request-failed',r)));
  page.on('framenavigated',observe(frame=>emit('frame-navigation',{main:frame===page.mainFrame(),safe:traceURL(frame.url())})));
  for(const name of ['domcontentloaded','load','close'])page.on(name,()=>emit(name));
  const session=await page.context().newCDPSession(page);
  session.on('Network.requestWillBeSent',observe(cdpRequest));session.on('Network.responseReceived',observe(e=>cdpEvent('cdp-response',e)));session.on('Network.loadingFinished',observe(e=>cdpEvent('cdp-finished',e)));session.on('Network.loadingFailed',observe(e=>cdpEvent('cdp-failed',e)));
  await session.send('Network.enable');emit('trace-installed',{protocolCommand:'Network.enable',noBodyOrHeaderAccess:true});
 };
 return {report,attach,wrapPage,beginCleanup,finish,captureCause,pwEvent,cdpRequest,cdpEvent,mark:(label)=>emit(label)};
}
