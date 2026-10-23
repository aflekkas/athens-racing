import {loadUnifiedRoute} from './unified-routes.js';
import {validateOnlineGrid,onlineGridPose} from './online-grid.js';
import {routeNetworkIdentity,sameRouteIdentity,validRouteIdentity} from './route-network.js';
import {RouteNetworkRuntime} from './route-network-runtime.js';
import {canonicalJSON} from './route-definition.js';
// Membership describes an immutable release. A client cannot choose geometry,
// invent a grid pose, or silently substitute a stale local route on reconnect.
export function networkLobbyIdentity(lobby){
 if(!validRouteIdentity(lobby?.routeIdentity)||lobby.mapId!==lobby.routeIdentity.routeId||!sameRouteIdentity(lobby.routeIdentity,lobby.track?.routeIdentity)||lobby.track.version!==`${lobby.routeIdentity.routeHash}:${lobby.routeIdentity.onlineGridHash}`)throw Error('Lobby route release mismatch');
 return lobby.routeIdentity;
}
export function assignedNetworkPose(lobby,grid,member,car){
 networkLobbyIdentity(lobby);if(!member||!Number.isInteger(member.gridSlot))throw Error('Authoritative grid slot unavailable');
 const pose=onlineGridPose(grid,member.gridSlot,car);
 if(canonicalJSON(pose)!==canonicalJSON(member.gridPose))throw Error('Authoritative grid pose mismatch');
 return pose;
}
export async function loadNetworkRoute(lobby,{fetcher=fetch,car}={}){
 const identity=networkLobbyIdentity(lobby),response=await fetcher('/api/routes',{cache:'no-store'});
 if(!response.ok)throw Error('Online routes unavailable');const config=await response.json();
 const entry=config.routes?.find(r=>r.id===lobby.mapId),descriptor=entry?.onlineGrid;
 if(!['staging','production'].includes(config.environment)||config.online!==true||entry?.onlineUnsupported||descriptor?.schemaVersion!==1||descriptor.capacity!==8||descriptor.hash!==identity.onlineGridHash||descriptor.url!==`/data/routes/${lobby.mapId}.online-grid.${descriptor.hash}.json`)throw Error('Unsupported online route capacity or release');
 // Use exactly the authorization just read. The immutable artifact loader still
 // checks each competitive tuple field before constructing any runtime.
 const compiled=await loadUnifiedRoute(new URLSearchParams({routes:'1',route:lobby.mapId}),{fetcher:async(url,options)=>url==='/api/routes'?{ok:true,json:async()=>config}:fetcher(url,options)});
 if(!sameRouteIdentity(routeNetworkIdentity(compiled,descriptor.hash),identity))throw Error('Online route release mismatch');
 const result=await fetcher(descriptor.url);if(!result.ok)throw Error('Online grid unavailable');
 const grid=await validateOnlineGrid(await result.json(),compiled,{expectedHash:descriptor.hash,car});
 const occupied=new Set();for(const member of lobby.players||[]){if(occupied.has(member.gridSlot))throw Error('Duplicate authoritative grid slot');occupied.add(member.gridSlot);assignedNetworkPose(lobby,grid,member);}
 return {compiled,onlineGrid:grid,runtime:new RouteNetworkRuntime(compiled,grid),identity,version:lobby.track.version};
}
