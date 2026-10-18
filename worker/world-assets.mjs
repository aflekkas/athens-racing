// Immutable R2 cells are compressed application payloads, NOT HTTP Content-Encoding.
// The tile worker hashes the compressed bytes before inflating them itself.
const keyPattern=/^(?:cells\/[a-f0-9]{64}\.bin\.gz|manifests\/[a-f0-9]{64}\.json)$/;
const noStore={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
export async function worldAssets(request,env,ctx,cache=globalThis.caches?.default){
 const url=new URL(request.url),alias=url.pathname==='/data/athens/manifest.json';
 if(!alias&&!url.pathname.startsWith('/world/'))return null;
 if(!['GET','HEAD'].includes(request.method))return new Response('Use GET or HEAD',{status:405,headers:{...noStore,Allow:'GET, HEAD'}});
 // No production manifest is configured until the owner activates that env.
 if(!env.ATHENS_WORLD||!/^manifests\/[a-f0-9]{64}\.json$/.test(env.ATHENS_WORLD_MANIFEST||''))return new Response('World unavailable',{status:404,headers:noStore});
 if(alias)return new Response(null,{status:307,headers:{...noStore,Location:'/world/'+env.ATHENS_WORLD_MANIFEST}});
 const key=url.pathname.slice(7);if(!keyPattern.test(key))return new Response('Not found',{status:404,headers:noStore});
 // Query parameters and request cookies must not fragment the public asset cache.
 const cacheKey=new Request(url.origin+'/world/'+key),cached=await cache?.match(cacheKey);
 let response=cached;
 if(!response){
  const object=await env.ATHENS_WORLD.get(key); // one Class B read on an edge miss; no list/write ops
  if(!object)return new Response('Not found',{status:404,headers:noStore});
  const headers=new Headers({'Content-Type':key.endsWith('.json')?'application/json':'application/octet-stream','Cache-Control':'public, max-age=31536000, immutable','X-Content-Type-Options':'nosniff','ETag':object.httpEtag,'Content-Length':String(object.size)});
  response=new Response(object.body,{headers});
  if(cache&&ctx)ctx.waitUntil(cache.put(cacheKey,response.clone()));
 }
 if(request.headers.get('If-None-Match')?.split(',').map(s=>s.trim()).some(s=>s==='*'||s===response.headers.get('ETag')))return new Response(null,{status:304,headers:response.headers});
 return request.method==='HEAD'?new Response(null,{headers:response.headers}):response;
}
