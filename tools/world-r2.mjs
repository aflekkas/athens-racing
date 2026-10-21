// Repeatable staging-only publication. Never writes production or existing buckets.
// Usage: CLOUDFLARE_ACCOUNT_ID=... node tools/world-r2.mjs <cells/manifest.json> [--upload]
import {readFile} from 'node:fs/promises';
import {resolve,dirname,relative} from 'node:path';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {validateWorldManifest} from '../src/world-tile-format.js';
export const ACCOUNT='d6f3d2dc5817687a91d74ccd257bad9e',STAGING='athens-racing-world-staging',PRODUCTION='athens-racing-world',LIMIT=5_000_000_000;
const hash=b=>createHash('sha256').update(b).digest('hex');
export async function publication(path){
 const dir=dirname(resolve(path)),manifest=validateWorldManifest(JSON.parse(await readFile(path,'utf8'))),objects=[];
 if(manifest.acceptance&&manifest.acceptance.passed!==true)throw Error('World acceptance gates have not passed');
 if(manifest.developmentOnly!==true||manifest.releaseReady!==false)throw Error('Only development worlds may be staged');
 for(const e of Object.values(manifest.tiles)){
  const file=resolve(dir,e.url);if(relative(dir,file).startsWith('..')||e.range)throw Error('Only local standalone cells may be published');
  const bytes=await readFile(file);if(hash(bytes)!==e.sha256||bytes.length!==e.bytes)throw Error('Cell integrity mismatch: '+file);
  const key='cells/'+e.sha256+'.bin.gz';objects.push({key,file,size:bytes.length});e.url='/world/'+key;
 }
 for(const asset of manifest.regionalAssets||[]){const file=resolve(dir,asset.file||'');if(relative(dir,file).startsWith('..')||!asset.file)throw Error('Regional asset must be local');const bytes=await readFile(file);if(hash(bytes)!==asset.sha256||bytes.length!==asset.bytes)throw Error('Regional asset integrity mismatch');objects.push({key:'cells/'+asset.sha256+'.bin.gz',file,size:bytes.length});delete asset.file;}
 const body=Buffer.from(JSON.stringify(manifest)),key='manifests/'+hash(body)+'.json';objects.push({key,body,size:body.length});
 return{manifest,key,objects:[...new Map(objects.map(o=>[o.key,o])).values()]};
}
export function uploadPlan(objects,inventories){
 const current=inventories[STAGING],existing=new Map(current.map(o=>[o.key,o.size]));
 for(const o of objects)if(existing.has(o.key)&&existing.get(o.key)!==o.size)throw Error('Immutable object size conflict');
 const pending=objects.filter(o=>!existing.has(o.key)),used=Object.values(inventories).flat().reduce((n,o)=>n+o.size,0),added=pending.reduce((n,o)=>n+o.size,0);
 if(used+added>=LIMIT)throw Error('Athens combined R2 5 GB ceiling');return{pending,used,added,after:used+added};
}
export async function credentials(){
 if(process.env.CLOUDFLARE_ACCOUNT_ID!==ACCOUNT)throw Error('Set the explicit aflekkas CLOUDFLARE_ACCOUNT_ID');
 if(process.env.CLOUDFLARE_API_TOKEN)return process.env.CLOUDFLARE_API_TOKEN;
 // Capture credentials privately; never forward token output or stderr into logs.
 let result;try{result=await promisify(execFile)(resolve('node_modules/.bin/wrangler'),['auth','token','--json'],{maxBuffer:1024*1024});}catch{throw Error('Wrangler login is unavailable; authenticate before publishing');}
 const value=JSON.parse(result.stdout);if(typeof value.token!=='string')throw Error('Wrangler did not return a bearer token');return value.token;
}
export function apiClient(token){
 return async(bucket,suffix='',options={})=>{
  if(![STAGING,PRODUCTION].includes(bucket)||bucket!==STAGING&&options.method&&options.method!=='GET')throw Error('Staging-only writes');
  const r=await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/r2/buckets/${bucket}/objects${suffix}`,{...options,headers:{...options.headers,Authorization:'Bearer '+token},signal:AbortSignal.timeout(120000)});
  if(!r.ok)throw Error(`R2 ${options.method||'GET'} failed (${r.status})`);return r;
 };
}
export async function inventory(api,bucket){
 const all=[];let cursor;
 do{const q=new URLSearchParams({per_page:'1000'});if(cursor)q.set('cursor',cursor);const data=await(await api(bucket,'?'+q)).json();if(data.success===false||!Array.isArray(data.result))throw Error('Invalid R2 inventory');for(const o of data.result){if(typeof o.key!=='string'||!Number.isSafeInteger(o.size)||o.size<0)throw Error('Invalid R2 object size');all.push({key:o.key,size:o.size});}cursor=data.result_info?.is_truncated?data.result_info.cursor:null;if(data.result_info?.is_truncated&&!cursor)throw Error('Incomplete R2 inventory');}while(cursor);
 return all;
}
export async function publish(path,{upload=false,api}={}){
 const build=await publication(path);api??=apiClient(await credentials());const inventories={};
 for(const b of [STAGING,PRODUCTION])inventories[b]=await inventory(api,b);
 const plan=uploadPlan(build.objects,inventories);
 if(upload)for(const o of plan.pending){const body=o.body||await readFile(o.file);await api(STAGING,'/'+o.key,{method:'PUT',body,headers:{'Content-Type':o.key.endsWith('.json')?'application/json':'application/octet-stream','Cache-Control':'public, max-age=31536000, immutable','Content-Length':String(o.size)}});}
 // The manifest is last. Activation is an explicit Worker config change/deploy,
 // never a mutable bucket pointer or an automatic part of this script.
 return{bucket:STAGING,uploaded:upload?plan.pending.length:0,skipped:build.objects.length-plan.pending.length,manifest:build.key,plannedAddedBytes:plan.added,beforeBytes:plan.used,afterBytes:upload?plan.after:plan.used,limitBytes:LIMIT,byBucket:Object.fromEntries(Object.entries(inventories).map(([b,rows])=>[b,{objects:rows.length+(upload&&b===STAGING?plan.pending.length:0),bytes:rows.reduce((n,o)=>n+o.size,0)+(upload&&b===STAGING?plan.added:0)}]))};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{if(!process.argv[2])throw Error('Pass cells/manifest.json [--upload]');console.log(JSON.stringify(await publish(process.argv[2],{upload:process.argv.includes('--upload')}),null,2));}catch(e){console.error(e.message);process.exitCode=1;}
}
