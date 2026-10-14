import {ASSET_ID_RE,CUSTOMIZATION_LIMITS as L,normalizeManifest,referencedAssets,newCustomizationId} from '../src/customization-data.js';
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const ascii=(b,start,n)=>String.fromCharCode(...b.subarray(start,start+n));
// Header and container validation before storage. Rendering still uses browser
// image decoders, never DOM insertion. The picker re-encodes and strips EXIF.
export function inspectStickerImage(input,type){
  const b=input instanceof Uint8Array?input:new Uint8Array(input),v=new DataView(b.buffer,b.byteOffset,b.byteLength);
  if(!b.length||b.length>L.assetBytes)fail('Photo must be at most 96 KiB.',413);
  let width=0,height=0;
  if(type==='image/png'){
    if(b.length<45||ascii(b,0,8)!=='\x89PNG\r\n\x1a\n')fail('Invalid PNG.');
    let at=8,ended=false,hasData=false;
    while(at+12<=b.length){const n=v.getUint32(at),tag=ascii(b,at+4,4);if(at+n+12>b.length)fail('Truncated PNG.');
      if(at===8){if(tag!=='IHDR'||n!==13)fail('Invalid PNG header.');width=v.getUint32(at+8);height=v.getUint32(at+12);if(![1,2,4,8,16].includes(b[at+16])||![0,2,3,4,6].includes(b[at+17])||b[at+18]||b[at+19]||b[at+20]>1)fail('Unsupported PNG encoding.');}
      else if(tag==='IHDR'||tag==='acTL')fail('Animated or invalid PNG.');
      if(tag==='IDAT')hasData=true;
      at+=n+12;if(tag==='IEND'){if(n||at!==b.length)fail('Invalid PNG ending.');ended=true;break;}
    }
    if(!ended||!hasData)fail('Incomplete PNG.');
  }else if(type==='image/jpeg'){
    if(b.length<12||b[0]!==255||b[1]!==216||b[b.length-2]!==255||b[b.length-1]!==217)fail('Invalid JPEG.');
    let at=2,scan=false;
    while(at+4<b.length){if(b[at++]!==255)fail('Invalid JPEG segment.');while(b[at]===255)at++;const marker=b[at++];
      if(marker===217)break;const n=v.getUint16(at);if(n<2||at+n>b.length)fail('Truncated JPEG.');
      if([192,193,194].includes(marker)){if(width)fail('Duplicate JPEG frame.');if(n<8||b[at+2]!==8)fail('Unsupported JPEG.');height=v.getUint16(at+3);width=v.getUint16(at+5);}
      if((marker>=195&&marker<=207&&![196,200,204].includes(marker))||marker===220)fail('Unsupported JPEG frame.');if(marker===218){scan=true;break;}at+=n;
    }
    if(!scan||!width)fail('JPEG image data missing.');
  }else if(type==='image/webp'){
    if(b.length<30||ascii(b,0,4)!=='RIFF'||ascii(b,8,4)!=='WEBP'||v.getUint32(4,true)+8!==b.length)fail('Invalid WebP.');
    let at=12,hasImage=false,canvasWidth=0,canvasHeight=0;
    while(at+8<=b.length){const tag=ascii(b,at,4),n=v.getUint32(at+4,true),p=at+8;if(p+n>b.length)fail('Truncated WebP.');
      if(tag==='ANIM'||tag==='ANMF')fail('Animated WebP is unsupported.');
      if(tag==='VP8X'){if(n!==10||(b[p]&2))fail('Invalid or animated WebP.');width=1+b[p+4]+(b[p+5]<<8)+(b[p+6]<<16);height=1+b[p+7]+(b[p+8]<<8)+(b[p+9]<<16);canvasWidth=width;canvasHeight=height;if(width>L.imageEdge||height>L.imageEdge)fail('Photo dimensions must be 1–512 pixels.',413);}
      if(tag==='VP8 '){if(hasImage)fail('Duplicate WebP frame.');if(n<10||ascii(b,p+3,3)!=='\x9d\x01\x2a')fail('Invalid WebP frame.');width=v.getUint16(p+6,true)&16383;height=v.getUint16(p+8,true)&16383;hasImage=true;}
      if(tag==='VP8L'){if(hasImage)fail('Duplicate WebP frame.');if(n<5||b[p]!==47)fail('Invalid WebP frame.');const bits=v.getUint32(p+1,true);width=(bits&16383)+1;height=((bits>>>14)&16383)+1;hasImage=true;}
      at=p+n+(n&1);
    }if(at!==b.length||!hasImage)fail('Incomplete WebP.');if(canvasWidth&&(width!==canvasWidth||height!==canvasHeight))fail('WebP frame dimensions differ from its canvas.');
  }else fail('Use a PNG, JPEG or WebP photo.',415);
  if(!width||!height||width>L.imageEdge||height>L.imageEdge)fail('Photo dimensions must be 1–512 pixels.',413);
  return {type,width,height,bytes:b};
}
export function createCustomizationService(store,{cars,now=()=>Date.now()}={}){
  const requireOwner=owner=>{if(typeof owner!=='string'||!owner)fail('Sign in with Google first.',401);};
  const manifest=owner=>normalizeManifest(store.getManifest(owner),cars);
  const service={
    get(owner){requireOwner(owner);return {...manifest(owner),assets:store.listAssets(owner).map(a=>({id:a.id,type:a.type,width:a.width,height:a.height,size:a.size??a.bytes.byteLength}))};},
    save(owner,value){requireOwner(owner);if(!value||!Array.isArray(value.presets)||value.presets.length>L.presets)fail('Invalid preset collection.');
      const current=manifest(owner);if(value.revision!==current.revision)fail('Presets changed elsewhere. Reload before saving.',409);
      const next=normalizeManifest(value,cars);if(next.presets.length!==value.presets.length)fail('Invalid preset or per-car limit exceeded.');
      for(const id of referencedAssets(next)){const a=store.getAsset(id);if(!a||a.owner!==owner)fail('Photo does not belong to this account.',403);}
      next.revision=current.revision+1;store.putManifest(owner,next);return service.get(owner);
    },
    upload(owner,bytes,type){requireOwner(owner);const image=inspectStickerImage(bytes,type),assets=store.listAssets(owner);
      if(assets.length>=L.assets||assets.reduce((n,a)=>n+(a.size??a.bytes.byteLength),0)+image.bytes.byteLength>L.accountBytes)fail('Photo storage is full. Remove an unused photo first.',413);
      if(store.totalBytes()+image.bytes.byteLength>64*1024*1024)fail('Shared photo storage is full. Try again later.',507);
      const id=newCustomizationId();store.putAsset({id,owner,...image,createdAt:now()});return {id,type:image.type,width:image.width,height:image.height,size:image.bytes.byteLength};
    },
    image(id){if(!ASSET_ID_RE.test(id||''))fail('Photo not found.',404);const a=store.getAsset(id);if(!a)fail('Photo not found.',404);return {type:a.type,bytes:a.bytes};},
    delete(owner,id){requireOwner(owner);const a=store.getAsset(id);if(!a||a.owner!==owner)fail('Photo not found.',404);if(referencedAssets(manifest(owner)).has(id))fail('Remove this photo from saved presets first.',409);store.deleteAsset(id);return {ok:true};},
    owns(owner,id){return typeof owner==='string'&&!!owner&&ASSET_ID_RE.test(id||'')&&store.getAsset(id)?.owner===owner;},
  };return service;
}
const json=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
async function readBounded(request,max){
  if(Number(request.headers.get('Content-Length')||0)>max)fail('Upload too large.',413);
  const reader=request.body?.getReader();if(!reader)fail('Request body required.');let size=0;const parts=[];
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>max){await reader.cancel();fail('Upload too large.',413);}parts.push(value);}
  const bytes=new Uint8Array(size);let at=0;for(const part of parts){bytes.set(part,at);at+=part.length;}return bytes;
}
// Worker owner calls with verified session resolver; no second auth system.
export async function handleCustomizationRequest(request,{service,who}){
  const url=new URL(request.url),path=url.pathname,method=request.method;
  try{
    const origin=request.headers.get('Origin');if(origin&&origin!==url.origin)fail('Origin mismatch.',403);
    if(path.startsWith('/api/customization/assets/')&&method==='GET'){
      const a=service.image(path.split('/').pop());return new Response(a.bytes,{headers:{'Content-Type':a.type,'Content-Length':String(a.bytes.byteLength),'Cache-Control':'public, max-age=300','X-Content-Type-Options':'nosniff','Cross-Origin-Resource-Policy':'same-origin','Content-Security-Policy':"default-src 'none'; sandbox"}});
    }
    const user=typeof who==='function'?who():who;if(!user?.sub)fail('Sign in with Google first.',401);if(!user.username)fail('Choose a public username before saving.',403);
    if(path==='/api/customization'&&method==='GET')return json(service.get(user.sub));
    if(path==='/api/customization'&&method==='PUT'){
      let body;try{body=JSON.parse(new TextDecoder().decode(await readBounded(request,L.manifestBytes)));}catch(e){if(e.status)throw e;fail('Invalid preset JSON.');}return json(service.save(user.sub,body));
    }
    if(path==='/api/customization/assets'&&method==='POST')return json(service.upload(user.sub,await readBounded(request,L.assetBytes),request.headers.get('Content-Type')?.split(';')[0]),201);
    if(path.startsWith('/api/customization/assets/')&&method==='DELETE')return json(service.delete(user.sub,path.split('/').pop()));
    return json({error:'Method not allowed.'},405);
  }catch(e){return json({error:e.status?e.message:'Could not update customization.'},e.status||500);}
}
