// Query parameters opt into server-enabled staging entries; they never authorize a route.
export const LEGACY_ROUTE_DESTINATIONS=Object.freeze({riviera:'riviera-coast',psychiko:'psychiko-faros',penteli:'penteli-hill',megara:'megara-club'});
export const routeDestinationForMap=mapId=>Object.hasOwn(LEGACY_ROUTE_DESTINATIONS,mapId)?LEGACY_ROUTE_DESTINATIONS[mapId]:null;
export async function loadUnifiedRoute(query,{fetcher=fetch}={}){
 if(query.get('routes')!=='1')return null;
 const r=await fetcher('/api/routes',{cache:'no-store'});if(!r.ok)throw Error('Routes unavailable');const config=await r.json();
 if(config.environment!=='staging'||!config.routes?.length)throw Error('Route pilot is unavailable in this release');
 const id=query.get('route')||routeDestinationForMap(query.get('map'))||config.routes[0].id,entry=config.routes.find(e=>e.id===id);if(!entry)throw Error('Route is not enabled');
 const response=await fetcher(entry.url);if(!response.ok)throw Error('Route unavailable');const compiled=await response.json();
 for(const k of ['id','routeHash','geometryHash','worldSetRevision'])if(entry[k]!==compiled[k])throw Error('Route release mismatch');
 return compiled;
}

export function enabledRouteCatalogue(config,index){if(config.environment!=='staging'||index.schemaVersion!==1)throw Error('Route catalogue unavailable');return config.routes.map(enabled=>{const item=index.routes.find(r=>r.id===enabled.id);if(!item||['routeHash','geometryHash','worldSetRevision','url'].some(k=>item[k]!==enabled[k]))throw Error('Route catalogue release mismatch');return item;});}
export async function loadUnifiedRouteCatalogue({fetcher=fetch}={}){const response=await fetcher('/api/routes',{cache:'no-store'});if(!response.ok)throw Error('Route catalogue unavailable');const config=await response.json();if(config.environment!=='staging'||!config.routes?.length)throw Error('Route catalogue unavailable');const index=await fetcher('/data/routes/index.json');if(!index.ok)throw Error('Route catalogue unavailable');return enabledRouteCatalogue(config,await index.json());}
