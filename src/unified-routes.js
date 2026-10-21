// Query parameters opt into server-enabled staging entries; they never authorize a route.
export async function loadUnifiedRoute(query,{fetcher=fetch}={}){
 if(query.get('routes')!=='1')return null;
 const r=await fetcher('/api/routes',{cache:'no-store'});if(!r.ok)throw Error('Routes unavailable');const config=await r.json();
 if(config.environment!=='staging'||!config.routes?.length)throw Error('Route pilot is unavailable in this release');
 const id=query.get('route')||config.routes[0].id,entry=config.routes.find(e=>e.id===id);if(!entry)throw Error('Route is not enabled');
 const response=await fetcher(entry.url);if(!response.ok)throw Error('Route unavailable');const compiled=await response.json();
 for(const k of ['id','routeHash','geometryHash','worldSetRevision'])if(entry[k]!==compiled[k])throw Error('Route release mismatch');
 return compiled;
}
