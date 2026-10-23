import {loadRaceRoute,loadUnifiedRoute} from './unified-routes.js';
import {initialMapId} from './menu-map.js';
import {loadWorldDefinition} from './world-manifest.js';
// Start immutable release metadata while the simulation chunk downloads. This
// runs only after the desktop gate and an explicit direct race selection.
export function prefetchDirectRace(query,{fetcher=fetch,worldLoader=loadWorldDefinition,baseURL=globalThis.location?.href||'http://localhost/'}={}){
 const event=query.get('event')||'',direct=['simhook','autodrive','car','s','event','quick','fixeddt','turbo'].some(k=>query.has(k));
 if(query.has('menu')||query.has('lobby')||query.get('map')==='athens'||event==='free'||event.startsWith('free:')||query.get('routes')!=='1'&&!direct)return null;
 const route=query.get('routes')==='1'?loadUnifiedRoute(query,{fetcher}):loadRaceRoute({mapId:initialMapId(query),routeId:query.get('route'),eventId:event},{fetcher});
 const manifestURL=new URL('/data/athens/manifest.json',baseURL),world=worldLoader(manifestURL,{fetcher});route.catch(()=>{});world.catch(()=>{});return {route,world,manifestURL:manifestURL.href};
}
