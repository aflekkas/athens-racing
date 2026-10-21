// Build-owned immutable composition; input is a JSON array of regional manifest paths/URLs.
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {canonicalWorldJSON,composeWorldManifest} from '../src/world-manifest.js';
const hash=b=>createHash('sha256').update(b).digest('hex');
export async function buildWorldSet(regions){
 const sources={},records=[];
 for(const r of regions){const bytes=await readFile(r.path),manifest=JSON.parse(bytes);sources[r.id]={manifest,url:r.manifestUrl||pathToFileURL(resolve(r.path)).href};records.push({id:r.id,manifestUrl:sources[r.id].url,manifestSha256:hash(bytes),sourceWorld:manifest.world,sourceRevision:manifest.revision,access:r.access,elevation:manifest.elevation,externalPortals:manifest.externalPortals});}
 const content={schemaVersion:1,id:'athens',tileMetres:512,projection:{lat0:37.98,lon0:23.73,mlat:111320,mlon:111320*Math.cos(37.98*Math.PI/180)},regions:records},def={...content,revision:hash(canonicalWorldJSON(content))};
 const manifest=composeWorldManifest(def,sources);return{definition:def,manifest};
}
if(process.argv[1]===import.meta.filename){const [input,out]=process.argv.slice(2);if(!input||!out)throw Error('Usage: regions.json output-world-set.json');const result=await buildWorldSet(JSON.parse(await readFile(input)));await writeFile(out,JSON.stringify(result.definition,null,2)+'\n');}
