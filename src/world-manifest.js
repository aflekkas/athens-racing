import {validateWorldManifest} from './world-tile-format.js';
export const ATHENS_PROJECTION=Object.freeze({lat0:37.98,lon0:23.73,metresPerLat:111320,metresPerLon:111320*Math.cos(37.98*Math.PI/180)});
/** Both single-source manifests and composed releases use the flat AWT contract. */
export function validateWorldDefinition(def){const manifest=validateWorldManifest(def.manifest||def);if(def.id&&def.id!=='athens')throw Error('Unknown world');if(def.worldSetRevision&&def.worldSetRevision!==manifest.revision)throw Error('World release mismatch');return {id:'athens',regionId:'basin',worldSetRevision:manifest.revision,manifest,manifestURL:def.manifestURL};}

export const canonicalWorldJSON=value=>JSON.stringify(sortWorldValue(value));
function sortWorldValue(v){return Array.isArray(v)?v.map(sortWorldValue):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,sortWorldValue(v[k])])):v;}
const keysOnly=(o,keys)=>{if(Object.keys(o).some(k=>!keys.includes(k)))throw Error('Unknown world set key');};
const sourceFields=['lat0','lon0','mlat','mlon'];
const canonical=p=>({lat0:p.lat0,lon0:p.lon0,mlat:p.mlat??p.metresPerLat,mlon:p.mlon??p.metresPerLon});
/** Pure composition after manifests have passed immutable hash verification. */
export function composeWorldManifest(def,sources){
 keysOnly(def,['schemaVersion','id','revision','projection','tileMetres','regions']);
 if(def.schemaVersion!==1||def.id!=='athens'||def.tileMetres!==512||!Array.isArray(def.regions)||!def.regions.length||!/^[a-f0-9]{64}$/.test(def.revision))throw Error('Invalid world set');
 const projection=canonical(def.projection),expected=canonical(ATHENS_PROJECTION);if(sourceFields.some(k=>projection[k]!==expected[k]))throw Error('World set projection mismatch');
 const regions=new Set(),tiles={},variants=new Map(),sourceIdentities=new Map();let spawn;const datums=new Set(),enrichments=[],regionMetadata=[],regionalAssets=[];
 for(const region of def.regions){
  keysOnly(region,['id','manifestUrl','manifestSha256','sourceWorld','sourceRevision','access','elevation','externalPortals']);
  if(!/^[a-z][a-z0-9-]*$/.test(region.id)||regions.has(region.id)||!['public','circuit'].includes(region.access)||!/^[a-f0-9]{64}$/.test(region.manifestSha256))throw Error('Invalid or duplicate region');regions.add(region.id);
  const source=sources[region.id],manifest=validateWorldManifest(source?.manifest);if(manifest.world!==region.sourceWorld||manifest.revision!==region.sourceRevision)throw Error('Stale region source revision');
  if(manifest.acceptance&&manifest.acceptance.passed!==true)throw Error('Region acceptance gates have not passed');
  const p=canonical(manifest.projection);if(sourceFields.some(k=>p[k]!==projection[k]))throw Error('Region projection mismatch');
  if(!manifest.elevation?.datum)throw Error('Region vertical datum required');
  if(region.elevation&&canonicalWorldJSON(region.elevation)!==canonicalWorldJSON(manifest.elevation))throw Error('Region vertical datum metadata mismatch');
  datums.add(manifest.elevation.datum);regionMetadata.push({...region,elevation:manifest.elevation});
  enrichments.push(...(manifest.enrichments||[]));regionalAssets.push(...(manifest.regionalAssets||[]));
  for(const [key,entry]of Object.entries(manifest.tiles)){if(Object.hasOwn(tiles,key))throw Error('Duplicate region cell: '+key);const identity={regionId:region.id,world:entry.source?.world||manifest.world,revision:entry.source?.revision||manifest.revision};sourceIdentities.set(JSON.stringify(identity),identity);tiles[key]={...entry,url:new URL(entry.url,source.url).href,source:identity};}
  for(const v of manifest.renderVariants||[])variants.set(v.key,v);spawn??=manifest.spawn;
 }
 // Absence of a portal declaration is not proof of isolation. Both the
 // authenticated source and release descriptor must explicitly certify none.
 if(datums.size>1)for(const region of def.regions){const portals=sources[region.id].manifest.externalPortals;if(!Array.isArray(portals)||portals.length||!Array.isArray(region.externalPortals)||region.externalPortals.length)throw Error('Mixed vertical datums require isolated regions without portals');}
 // Touching independently baked sources require a rebuilt common boundary.
 for(const[key,entry]of Object.entries(tiles)){const[x,z]=key.split(',').map(Number);for(const next of[`${x+1},${z}`,`${x},${z+1}`])if(tiles[next]&&tiles[next].source.regionId!==entry.source.regionId)throw Error('Cross-region boundary requires shared seam/portal proof');}
 return validateWorldManifest({tileVersion:1,world:'athens',revision:def.revision,tileMetres:512,projection,elevation:datums.size===1?{datum:[...datums][0]}:{perRegion:Object.fromEntries(regionMetadata.map(r=>[r.id,r.elevation]))},regions:regionMetadata,enrichments,regionalAssets,regionResidentBytes:regionalAssets.reduce((n,a)=>n+a.residentBytes,0),sourceIdentities:[...sourceIdentities.values()],spawn,tiles,renderVariants:[...variants.values()],developmentOnly:true,releaseReady:false});
}
/** Each region document is authenticated before it can supply packet identities. */
export async function loadWorldDefinition(url,{fetcher=fetch,signal}={}){
 const read=async url=>{const response=await fetcher(url,{signal});if(!response.ok)throw Error('World manifest HTTP '+response.status);return new Uint8Array(await response.arrayBuffer());};
 const bytes=await read(url),def=JSON.parse(new TextDecoder().decode(bytes));if(!def.regions||def.tileVersion===1)return validateWorldDefinition({manifest:def,manifestURL:url});
 const {revision,...content}=def,computed=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonicalWorldJSON(content))))].map(n=>n.toString(16).padStart(2,'0')).join('');if(revision!==computed)throw Error('World set revision mismatch');
 const sources={};await Promise.all(def.regions.map(async region=>{const address=new URL(region.manifestUrl,url).href,body=await read(address),digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',body))].map(n=>n.toString(16).padStart(2,'0')).join('');if(digest!==region.manifestSha256)throw Error('Region manifest hash mismatch');sources[region.id]={url:address,manifest:JSON.parse(new TextDecoder().decode(body))};}));
 return {id:'athens',regionId:def.regions[0].id,worldSetRevision:def.revision,manifest:composeWorldManifest(def,sources),manifestURL:url};
}
