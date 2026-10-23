// One-worker authenticated original-cell atlas and protection inventory.
// This does not refine, repack or claim physical/geographic acceptance.
import fs from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {validateWorldManifest} from '../../src/world-tile-format.js';
import {decodeTilePack} from '../../src/world-tile-codec.js';
import {terrainAtlasCell} from './terrain-relief.mjs';
import {readTerrainSource} from './refine-terrain.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
async function pressure(){const mem=await fs.readFile('/proc/meminfo','utf8'),available=Number(mem.match(/^MemAvailable:\s+(\d+)/m)?.[1])*1024,rss=process.memoryUsage().rss;if(!Number.isFinite(available)||available<6*1024**3||rss>=900*1024**2)throw Error('Metadata pressure stop: '+JSON.stringify({available,rss}));return {available,rss};}
export async function auditTerrainScope(manifestFile,manifestSHA,sourceCache,output){
 await pressure();const bytes=await fs.readFile(manifestFile);if(sha(bytes)!==manifestSHA)throw Error('Original flat manifest integrity');const m=validateWorldManifest(JSON.parse(bytes));
 await fs.mkdir(output,{recursive:true});const atlas={version:1,spacing:8,source:resolve(manifestFile),revision:m.revision,grids:{},protected:[],coverage:{}},report={revision:m.revision,manifestSHA,cells:0,eligible:0,protected:0,invalidAtlas:[],byRegion:{},protectedReasons:{},maxRSS:0,minAvailable:Infinity,physicalAcceptance:'not-run',geographicAcceptance:'not-run'};
 for(const[key,e]of Object.entries(m.tiles)){
  const health=await pressure();report.maxRSS=Math.max(report.maxRSS,health.rss);report.minAvailable=Math.min(report.minAvailable,health.available);
  {const bytes=await readTerrainSource(e,{cache:sourceCache,readOnly:true}),raw=gunzipSync(bytes),pack=await decodeTilePack(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength),e.decodedBytes),cell=terrainAtlasCell(pack),region=e.source?.regionId||e.source?.world||m.world;
   const invalid=cell.heights.filter(n=>!Number.isFinite(n)).length;if(invalid)report.invalidAtlas.push({key,invalid});
   atlas.grids[key]=cell.heights;atlas.coverage[key]={source:e.source,selected:true,protectedReasons:cell.protectedReasons};if(cell.protected)atlas.protected.push(key);
   const row=report.byRegion[region]??={cells:0,eligible:0,protected:0};row.cells++;row[cell.protected?'protected':'eligible']++;report.cells++;report[cell.protected?'protected':'eligible']++;
   for(const reason of cell.protectedReasons)report.protectedReasons[reason]=(report.protectedReasons[reason]||0)+1;
  }
  // Decoded arrays/contact indices must die before the next source cell.
  if(globalThis.gc)globalThis.gc();if(report.cells%64===0)console.log(JSON.stringify({classified:report.cells,total:Object.keys(m.tiles).length,...await pressure()}));
 }
 await pressure();await fs.writeFile(join(output,'original-atlas.json'),JSON.stringify(atlas));const finalHealth=await pressure();report.maxRSS=Math.max(report.maxRSS,finalHealth.rss,process.resourceUsage().maxRSS*1024);report.minAvailable=Math.min(report.minAvailable,finalHealth.available);await fs.writeFile(join(output,'terrain-scope.json'),JSON.stringify(report,null,2));return report;
}
if(process.argv[1]===import.meta.filename){const[manifest,hash,cache,output]=process.argv.slice(2);if(!output)throw Error('Expected flatmanifest SHA256 readonlycache output');console.log(JSON.stringify(await auditTerrainScope(manifest,hash,cache,output)));}
