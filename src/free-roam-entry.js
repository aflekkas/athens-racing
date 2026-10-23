import {initialMapId} from './menu-map.js';
import {AREA_STARTS,AREA_NAMES,MAP_PROJECTIONS,athensFromLonLat} from './spawn-spots.js';
// Compatibility launch coordinates are converted once. Free roam then owns only
// the published Athens scene/contacts, never an authored whole-map runtime.
export function freeRoamEntryQuery(query,selection=null){
 if(!selection&&(query.has('menu')||query.get('event')!=='free'&&query.get('map')!=='athens'||query.get('routes')==='1'))return null;
 const params=new URLSearchParams(query),mapId=selection?.mapId||query.get('map')||initialMapId(query);
 const pair=(query.get('spawn')||'').split(',').map(Number),spawn=selection?.spawn;
 let point=spawn&&[spawn.x,spawn.z].every(Number.isFinite)?[spawn.x,spawn.z]:pair.length===2&&pair.every(Number.isFinite)?pair:null;
 if(mapId!=='athens'){
  const projection=MAP_PROJECTIONS[mapId];if(!projection)throw Error('Free roam area unavailable');
  if(point)point=athensFromLonLat(projection.lon0+point[0]/projection.mlon,projection.lat0-point[1]/projection.mlat);
  else {const area=AREA_STARTS.find(a=>a.mapId===mapId);if(!area)throw Error('Free roam area unavailable');point=athensFromLonLat(area.lon,area.lat);}
 }
 for(const key of ['menu','routes','route','routeEvent','setup','event','quick','lobby','s'])params.delete(key);
 params.set('map','athens');
 if(point)params.set('spawn',point.map(v=>Math.round(v*10)/10).join(','));else params.delete('spawn');
 const area=spawn?.name||query.get('spawnArea')||AREA_NAMES[mapId];if(area)params.set('spawnArea',area);
 return params;
}
