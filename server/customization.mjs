import {CUSTOMIZATION_LIMITS as L,normalizeManifest} from '../src/customization-data.js';
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
export function createCustomizationService(store,{cars}={}){
 const owner=id=>{if(typeof id!=='string'||!id)fail('Sign in first.',401);};
 return{get(id){owner(id);return normalizeManifest(store.getManifest(id),cars);},save(id,value){owner(id);if(!value||!Array.isArray(value.presets)||value.presets.length>L.presets)fail('Invalid preset collection.');const current=normalizeManifest(store.getManifest(id),cars);if(value.revision!==current.revision)fail('Looks changed elsewhere. Reload before saving.',409);const next=normalizeManifest(value,cars);if(next.presets.length!==value.presets.length)fail('Invalid preset or per-car limit exceeded.');next.revision=current.revision+1;store.putManifest(id,next);return this.get(id);}};
}
const json=(v,status=200)=>Response.json(v,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
async function readBounded(request,max){if(Number(request.headers.get('Content-Length')||0)>max)fail('Request too large.',413);const reader=request.body?.getReader();if(!reader)fail('Request body required.');let size=0;const parts=[];while(true){const{done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>max){await reader.cancel();fail('Request too large.',413);}parts.push(value);}const bytes=new Uint8Array(size);let at=0;for(const p of parts){bytes.set(p,at);at+=p.length;}return bytes;}
export async function handleCustomizationRequest(request,{service,who}){
 const url=new URL(request.url),path=url.pathname,method=request.method;
 try{const origin=request.headers.get('Origin');if(origin&&origin!==url.origin)fail('Origin mismatch.',403);
  // Retire the photo endpoint without interpreting or downloading legacy descriptors.
  if(path.startsWith('/api/customization/assets'))return json({error:'Car stickers have been removed.'},410);
  const user=typeof who==='function'?who():who;if(!user?.sub)fail('Sign in first.',401);if(!user.username)fail('Choose a public username before saving.',403);
  if(path==='/api/customization'&&method==='GET')return json(service.get(user.sub));
  if(path==='/api/customization'&&method==='PUT'){let body;try{body=JSON.parse(new TextDecoder().decode(await readBounded(request,L.manifestBytes)));}catch(e){if(e.status)throw e;fail('Invalid look JSON.');}return json(service.save(user.sub,body));}
  return json({error:'Method not allowed.'},405);
 }catch(e){return json({error:e.status?e.message:'Could not save your look.'},e.status||500);}
}
