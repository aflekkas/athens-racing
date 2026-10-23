// Query parameters opt into server-enabled release entries; they never authorize a route.
export const LEGACY_ROUTE_DESTINATIONS=Object.freeze({riviera:'riviera-coast',psychiko:'psychiko-faros',penteli:'penteli-hill',megara:'megara-club'});
export const routeDestinationForMap=mapId=>Object.hasOwn(LEGACY_ROUTE_DESTINATIONS,mapId)?LEGACY_ROUTE_DESTINATIONS[mapId]:null;
const artifacts=new WeakMap();
// Compatibility URLs resolve to a released route; the enabled backend entry,
// never a query parameter, still owns geometry authorization.
export function raceRouteQuery({mapId='riviera',routeId,eventId}={}){
 const id=routeId||(eventId==='penteli-descent-tt'?'penteli-descent':routeDestinationForMap(mapId))||mapId;
 return new URLSearchParams({routes:'1',route:id});
}
export async function loadRaceRoute(selection,options){
 return loadUnifiedRoute(raceRouteQuery(selection),options);
}

export async function loadUnifiedRoute(query,{fetcher=fetch}={}){
 if(query.get('routes')!=='1')return null;
 const r=await fetcher('/api/routes',{cache:'no-store'});if(!r.ok)throw Error('Routes unavailable');const config=await r.json();
 return loadConfiguredRoute(query,config,{fetcher});
}

// Callers supply the authorization they just fetched, retaining the underlying
// fetcher as the immutable cache owner rather than wrapping its identity.
export function loadConfiguredRoute(query,config,{fetcher=fetch}={}){
 if(!['staging','production'].includes(config.environment)||!config.routes?.length)throw Error('Route pilot is unavailable in this release');
 const id=query.get('route')||routeDestinationForMap(query.get('map'))||config.routes[0].id,entry=config.routes.find(e=>e.id===id);if(!entry)throw Error('Route is not enabled');
 const fields=['id','routeHash','geometryHash','worldSetRevision'],pinned=Object.fromEntries(fields.map(k=>[k,entry[k]])),url=entry.url;
 const descriptor=entry.onlineGrid;
 const key=JSON.stringify([config.environment,url,...fields.map(k=>pinned[k]),entry.worldId??'athens',entry.projectionId??'athens-v1',descriptor?[descriptor.schemaVersion,descriptor.capacity,descriptor.hash,descriptor.url]:null]);
 let cache=artifacts.get(fetcher);if(!cache)artifacts.set(fetcher,cache=new Map());
 if(cache.has(key))return cache.get(key);
 const pending=Promise.resolve().then(async()=>{
  const response=await fetcher(url);if(!response.ok)throw Error('Route unavailable');const compiled=await response.json();
  for(const k of fields)if(pinned[k]!==compiled[k])throw Error('Route release mismatch');
  return compiled;
 });
 cache.set(key,pending);if(cache.size>8)cache.delete(cache.keys().next().value);
 pending.catch(()=>{if(cache.get(key)===pending)cache.delete(key);});
 return pending;
}

export function enabledRouteCatalogue(config,index){if(!['staging','production'].includes(config.environment)||index.schemaVersion!==1)throw Error('Route catalogue unavailable');return config.routes.map(enabled=>{const item=index.routes.find(r=>r.id===enabled.id);if(!item||['routeHash','geometryHash','worldSetRevision','url'].some(k=>item[k]!==enabled[k]))throw Error('Route catalogue release mismatch');return item;});}
export async function loadUnifiedRouteCatalogue({fetcher=fetch,allowEmpty=false}={}){const response=await fetcher('/api/routes',{cache:'no-store'});if(!response.ok)throw Error('Route catalogue unavailable');const config=await response.json();if(!['staging','production'].includes(config.environment)||!Array.isArray(config.routes))throw Error('Route catalogue unavailable');if(!config.routes.length){if(allowEmpty)return [];throw Error('Route catalogue unavailable');}const index=await fetcher('/data/routes/index.json');if(!index.ok)throw Error('Route catalogue unavailable');return enabledRouteCatalogue(config,await index.json());}
