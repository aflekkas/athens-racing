// Proof fixture only. Never fetch an external URL or forward its credentials.
import {readFile,realpath} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {createHash} from 'node:crypto';
const hash=body=>createHash('sha256').update(body).digest('hex');
export const FONT_CSS_URL='https://fonts.googleapis.com/css2?family=Barlow+Condensed:ital,wght@0,500;0,600;0,700;0,800;1,600;1,700;1,800;1,900&family=Barlow:wght@300;400;500;600;700&display=swap';
export const THREE_PREFIX='https://cdn.jsdelivr.net/npm/three@0.170.0/';
export const EGRESS_LAUNCH_ARGS=Object.freeze(['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost']);
export const EGRESS_CONTEXT_OPTIONS=Object.freeze({serviceWorkers:'block'});
const EMPTY_SHA256=hash(Buffer.alloc(0));
export const EGRESS_SIGNATURE=hash(JSON.stringify({version:1,fontCSS:FONT_CSS_URL,fontBodyBytes:0,fontSHA256:EMPTY_SHA256,threePrefix:THREE_PREFIX,blockedFontPaths:['/s/barlow/vN/file.woff2|woff|ttf','/s/barlowcondensed/vN/file.woff2|woff|ttf'],dns:EGRESS_LAUNCH_ARGS,serviceWorkers:'block'}));
function parsed(raw){try{return new URL(raw);}catch{return null;}}
function safeURL(raw){const url=parsed(raw);return url?{origin:url.origin,pathSHA256:hash(url.pathname)}:{origin:'invalid',pathSHA256:null};}
export function expectedBlockedFont(raw){
 const url=parsed(raw);return !!url&&url.origin==='https://fonts.gstatic.com'&&!url.username&&!url.password&&!url.search&&!url.hash&&/^\/s\/(?:barlow|barlowcondensed)\/v\d+\/[A-Za-z0-9_-]+\.(?:woff2|woff|ttf)$/.test(url.pathname);
}
export async function pinnedThreeReader(packageRoot,{read=readFile,canonical=realpath}={}){
 const root=await canonical(packageRoot),packageBytes=await read(resolve(root,'package.json')),pkg=JSON.parse(packageBytes);
 if(pkg.version!=='0.170.0')throw Error('THREE_PACKAGE_VERSION_PIN');
 const pins=new Map(),dependency={version:pkg.version,packageJSONSHA256:hash(packageBytes),source:'shared read-only node_modules; each served file pinned by SHA256 and checked on reuse'};
 const load=async relative=>{
  if(!relative||relative.startsWith('/')||relative.includes('\\')||relative.includes('\0')||relative.split('/').some(p=>p==='..'||p==='.'))throw Error('THREE_PATH');
  const file=await canonical(resolve(root,relative));if(!file.startsWith(root+'/'))throw Error('THREE_PATH_ESCAPE');
  const body=await read(file),sha256=hash(body);if(pins.has(relative)&&pins.get(relative)!==sha256)throw Error('THREE_BODY_CHANGED');pins.set(relative,sha256);
  return {body,sha256,relative,contentType:extname(relative)==='.js'?'text/javascript':extname(relative)==='.wasm'?'application/wasm':'application/octet-stream'};
 };
 return {load,dependency};
}
export function createProofEgress({localOrigin,readThree,dependency}){
 const local=parsed(localOrigin);
 if(!local||local.protocol!=='http:'||!['127.0.0.1','localhost'].includes(local.hostname)||local.username||local.password||local.search||local.hash||local.pathname!=='/')throw Error('OWN_LOOPBACK_ORIGIN_REQUIRED');
 let fatal=null,rejectFatal;
 const failed=new Promise((resolve,reject)=>{rejectFatal=reject;});void failed.catch(()=>{});
 const report={signature:EGRESS_SIGNATURE,localOrigin:local.origin,dependency,REMOTE_BYTES:0,remoteBytesBasis:'No external continue/fetch/connectToServer; local fulfill bytes counted separately. DNS excludes nonloopback hosts; not a host-wide packet capture.',localRequests:0,threeLocalFiles:[],fontFallbacks:[],expectedFontBlocks:[],unapprovedExternal:[],failures:[],firstCause:null};
 const fail=(code,raw)=>{
  if(!fatal){const cause={code,...safeURL(raw)};report.firstCause=cause;report.failures.push(cause);fatal=Error(code+' '+cause.origin);rejectFatal(fatal);}
  return fatal;
 };
 const check=()=>{if(fatal)throw fatal;};
 const execute=async command=>{check();const result=await Promise.race([Promise.resolve().then(()=>{check();return command();}),failed]);check();return result;};
 const handle=async route=>{
  if(fatal){await route.abort('blockedbyclient');return;}
  const request=route.request(),raw=request.url(),url=parsed(raw);
  if(!url||url.username||url.password){report.unapprovedExternal.push(safeURL(raw));fail('EGRESS_URL_OR_CREDENTIALS',raw);await route.abort('blockedbyclient');return;}
  if(url.origin===local.origin){report.localRequests++;await route.continue();return;}
  if(request.method()!=='GET'){report.unapprovedExternal.push(safeURL(raw));fail('REMOTE_METHOD_FORBIDDEN',raw);await route.abort('blockedbyclient');return;}
  if(raw===FONT_CSS_URL){
   report.fontFallbacks.push({url:FONT_CSS_URL,classification:'expected-font-local-empty-css',provenance:'proof fixture, deterministic system-font fallback in both fresh builds; no downloaded font CSS',bodyBytes:0,sha256:EMPTY_SHA256,REMOTE_BYTES:0});
   try{await route.fulfill({status:200,contentType:'text/css',body:Buffer.alloc(0),headers:{'cache-control':'no-store','access-control-allow-origin':local.origin}});}catch{fail('FONT_LOCAL_FULFILL_FAILED',raw);}return;
  }
  if(expectedBlockedFont(raw)){report.expectedFontBlocks.push({...safeURL(raw),classification:'predeclared-font-blocked-before-network',REMOTE_BYTES:0});await route.abort('blockedbyclient');return;}
  if(raw.startsWith(THREE_PREFIX)&&url.origin==='https://cdn.jsdelivr.net'&&!url.search&&!url.hash){
   try{
    const relative=decodeURIComponent(url.pathname.slice('/npm/three@0.170.0/'.length)),file=await readThree(relative);check();
    const record={relative:file.relative,sha256:file.sha256,bodyBytes:file.body.length,provenance:'local pinned shared dependency',REMOTE_BYTES:0};
    const prior=report.threeLocalFiles.find(f=>f.relative===record.relative);if(prior&&prior.sha256!==record.sha256)throw Error('THREE_BODY_CHANGED');if(!prior)report.threeLocalFiles.push(record);
    await route.fulfill({status:200,body:file.body,contentType:file.contentType,headers:{'cache-control':'no-store','access-control-allow-origin':local.origin}});
   }catch{fail('THREE_LOCAL_FULFILL_FAILED',raw);await route.abort('blockedbyclient');}return;
  }
  report.unapprovedExternal.push(safeURL(raw));fail('UNAPPROVED_REMOTE',raw);await route.abort('blockedbyclient');
 };
 const socket=async route=>{
  const raw=route.url(),url=parsed(raw);
  if(!fatal&&url&&url.protocol==='ws:'&&url.host===local.host&&!url.username&&!url.password){route.connectToServer();return;}
  report.unapprovedExternal.push(safeURL(raw));fail('UNAPPROVED_WEBSOCKET',raw);await route.close({code:1008,reason:'Proof egress forbidden'});
 };
 const observeResponse=raw=>{const url=parsed(raw);if(url&&url.origin===local.origin)return;if(raw===FONT_CSS_URL&&report.fontFallbacks.length)return;if(raw.startsWith(THREE_PREFIX)&&report.threeLocalFiles.some(file=>raw===THREE_PREFIX+file.relative))return;report.REMOTE_BYTES=null;report.unapprovedExternal.push({...safeURL(raw),classification:'unrouted-remote-response'});fail('UNROUTED_REMOTE_RESPONSE',raw);};
 const isExpectedBlock=raw=>expectedBlockedFont(raw)&&report.expectedFontBlocks.some(record=>{const safe=safeURL(raw);return record.origin===safe.origin&&record.pathSHA256===safe.pathSHA256;});
 const safeMessage=text=>String(text).replace(/https?:\/\/[^\s\"'<>]+/g,raw=>{const safe=safeURL(raw);return safe.origin+'/[path-sha256:'+safe.pathSHA256+']';});
 const guardPage=page=>new Proxy(page,{get(target,key){const value=Reflect.get(target,key);if(typeof value!=='function')return value;if(['goto','evaluate','waitForFunction','addInitScript'].includes(key))return (...args)=>execute(()=>value.apply(target,args));return value.bind(target);}});
 const assertCaptureReady=()=>{check();if(report.fontFallbacks.length!==1)throw fail('FONT_FALLBACK_NOT_EXACTLY_ONCE',FONT_CSS_URL);if(report.REMOTE_BYTES!==0||report.unapprovedExternal.length)throw fail('REMOTE_EGRESS_OCCURRED',local.origin);};
 return {report,handle,socket,execute,guardPage,check,fail,assertCaptureReady,safeURL,safeMessage,isExpectedBlock,observeResponse,get fatal(){return fatal;}};
}
