// Convert Vas-Per's reduced, reviewed numeric data. No images, cell bodies or duplicate contact meshes.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {loadPsychikoOsm,ELEFTHERIAS} from './maps/psychiko/corrections.mjs';
import {psychikoWayClass} from './maps/psychiko/street-classes.mjs';
import {PSYCHIKO_CLASSES} from '../src/maps/psychiko-streets.js';
import {roundaboutLoops} from './roundabouts.mjs';
import {readCopernicus,copernicusField,roundaboutPlanes} from './maps/psychiko/elevation.mjs';
const root=new URL('../',import.meta.url),P={lat0:37.98,lon0:23.73,mlat:111320,mlon:111320*Math.cos(37.98*Math.PI/180)};
export async function psychikoOverrides(){
 const raw=await readFile(new URL('data/maps/psychiko/map.json',root)),map=JSON.parse(raw),osm=loadPsychikoOsm(),point=n=>[(n.lon-P.lon0)*P.mlon,-(n.lat-P.lat0)*P.mlat];
 const nodes=new Map(osm.filter(e=>e.type==='node').map(n=>[n.id,n])),ways=[];
 const selected=new Set(map.psychiko.networkWayIds.map(Number));for(const w of map.psychiko.sourceWayIds)selected.add(+w);
 for(const w of osm.filter(e=>e.type==='way'&&(selected.has(e.id)||e.splitFrom&&selected.has(e.splitFrom)))){
  const positions=w.nodes.map(id=>nodes.get(id)).filter(Boolean).map(point);if(positions.length<2)continue;
  const samples=positions.map(([x,z])=>{const k=psychikoWayClass(w.splitFrom||w.id,x,z,P),c=PSYCHIKO_CLASSES[k];return c?[x,z,c.w,c.footway,k]:null;}).filter(Boolean);
  ways.push({id:w.splitFrom||w.id,nodes:w.nodes,oneway:w.tags?.oneway==='yes'||w.tags?.junction==='roundabout'?1:w.tags?.oneway==='-1'?-1:0,samples});
 }
 const field=copernicusField(readCopernicus(new URL('tools/maps/psychiko/raw/copernicus.json.gz',root)),P),planes=roundaboutPlanes(roundaboutLoops(osm,n=>point(n)),field);
 return {schemaVersion:1,id:'psychiko-faros',sourceMapSha256:createHash('sha256').update(raw).digest('hex'),projection:P,height:{source:'tools/maps/psychiko/raw/copernicus.json.gz',sigmaM:20,planes,fadeM:160,bounds:[(23.758-P.lon0)*P.mlon,-(38.027-P.lat0)*P.mlat,(23.799-P.lon0)*P.mlon,-(37.992-P.lat0)*P.mlat]},ways,corrections:ELEFTHERIAS,attribution:map.attribution};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){const out=process.argv[2]||'tools/world-gen/overrides/psychiko.json';await mkdir(new URL('world-gen/overrides/',import.meta.url),{recursive:true});await writeFile(out,JSON.stringify(await psychikoOverrides())+'\n');console.log(out);}
