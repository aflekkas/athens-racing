// Query parameters opt into server-enabled release entries; they never authorize a route.
export const LEGACY_ROUTE_DESTINATIONS=Object.freeze({riviera:'riviera-coast',psychiko:'psychiko-faros',penteli:'penteli-hill',megara:'megara-club'});
export const routeDestinationForMap=mapId=>Object.hasOwn(LEGACY_ROUTE_DESTINATIONS,mapId)?LEGACY_ROUTE_DESTINATIONS[mapId]:null;
const artifacts=new WeakMap();
export async function loadUnifiedRoute(query,{fetcher=fetch}={}){
 if(query.get('routes')!=='1')return null;
 const r=await fetcher('/api/routes',{cache:'no-store'});if(!r.ok)throw Error('Routes unavailable');const config=await r.json();
 if(!['staging','production'].includes(config.environment)||!config.routes?.length)throw Error('Route pilot is unavailable in this release');
 const id=query.get('route')||routeDestinationForMap(query.get('map'))||config.routes[0].id,entry=config.routes.find(e=>e.id===id);if(!entry)throw Error('Route is not enabled');
 // Refresh authorization above on every selection. Reuse only the exact
 // immutable release already resident, including its larger racing plan.
 let cache=artifacts.get(fetcher);if(!cache)artifacts.set(fetcher,cache=new Map());
 const key=JSON.stringify([entry.url,...['id','routeHash','geometryHash','worldSetRevision'].map(k=>entry[k])]);if(cache.has(key))return cache.get(key);
 const response=await fetcher(entry.url);if(!response.ok)throw Error('Route unavailable');const compiled=await response.json();
 for(const k of ['id','routeHash','geometryHash','worldSetRevision'])if(entry[k]!==compiled[k])throw Error('Route release mismatch');
 cache.set(key,compiled);if(cache.size>8)cache.delete(cache.keys().next().value);
 return compiled;
}

export function enabledRouteCatalogue(config,index){if(!['staging','production'].includes(config.environment)||index.schemaVersion!==1)throw Error('Route catalogue unavailable');return config.routes.map(enabled=>{const item=index.routes.find(r=>r.id===enabled.id);if(!item||['routeHash','geometryHash','worldSetRevision','url'].some(k=>item[k]!==enabled[k]))throw Error('Route catalogue release mismatch');return item;});}
export async function loadUnifiedRouteCatalogue({fetcher=fetch,allowEmpty=false}={}){const response=await fetcher('/api/routes',{cache:'no-store'});if(!response.ok)throw Error('Route catalogue unavailable');const config=await response.json();if(!['staging','production'].includes(config.environment)||!Array.isArray(config.routes))throw Error('Route catalogue unavailable');if(!config.routes.length){if(allowEmpty)return [];throw Error('Route catalogue unavailable');}const index=await fetcher('/data/routes/index.json');if(!index.ok)throw Error('Route catalogue unavailable');return enabledRouteCatalogue(config,await index.json());}
