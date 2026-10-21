// Immutable emitted-graph/contact-proof index. Raw pre-exclusion generator graphs fail closed.
import {dirname,resolve} from 'node:path';import {fileURLToPath} from 'node:url';
import {readFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';import {promisify} from 'node:util';
import {WorldRoadGraph} from '../src/world-tile-graph.js';import {RouteError} from '../src/route-definition.js';
import {routeSurfaceAllowed} from '../src/route-surface.js';
export async function readRouteInputs({world,graph}){
 if(!world||!graph)throw new RouteError('input-unavailable');let manifest,shard;
 try{manifest=JSON.parse(await readFile(world,'utf8'));if(/\.sqlite$/.test(graph)){
  // Bounded Python transport works on Node builds without node:sqlite. This is an emitted index, not source OSM.
  const script="import sqlite3,json,sys\nc=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True)\nr=c.execute('select json from route_validation_shards limit 65').fetchall()\nassert len(r)==1, 'expected one bounded emitted route shard'\nassert len(r[0][0])<=8*1024*1024, 'route shard too large'\nprint(r[0][0])";
  shard=JSON.parse((await promisify(execFile)('python3',['-c',script,graph],{maxBuffer:8*1024*1024})).stdout);
 }else{const b=await readFile(graph);if(b.length>8*1024*1024)throw Error('Route index too large');shard=JSON.parse(b);}}
 catch(e){throw new RouteError('input-unavailable',{reason:e.message});}
 // Each region keeps its own bounded proof file. The root binds all source hashes;
 // siblings cannot change a previously reviewed edge, query, cell or restriction.
 if(shard.shards){if(!Array.isArray(shard.shards)||shard.shards.length>3)throw new RouteError('emitted-input-mismatch');const directory=dirname(graph instanceof URL?fileURLToPath(graph):graph);for(const name of shard.shards){if(!/^[a-z][a-z0-9-]*\.inputs\.json$/.test(name))throw new RouteError('emitted-input-mismatch');const bytes=await readFile(resolve(directory,name));if(bytes.length>8*1024*1024)throw new RouteError('input-unavailable');const extra=JSON.parse(bytes);if(extra.schemaVersion!==1||extra.worldSetRevision!==shard.worldSetRevision||extra.shards)throw new RouteError('emitted-input-mismatch');for(const field of ['cells'])for(const[k,v]of Object.entries(extra[field])){if(shard[field][k]&&JSON.stringify(shard[field][k])!==JSON.stringify(v))throw new RouteError('emitted-input-mismatch');shard[field][k]=v;}for(const kind of ['contact','width','safe'])for(const[k,v]of Object.entries(extra.proofs[kind])){if(Object.hasOwn(shard.proofs[kind],k)&&JSON.stringify(shard.proofs[kind][k])!==JSON.stringify(v))throw new RouteError('emitted-input-mismatch');shard.proofs[kind][k]=v;}for(const field of ['edges','turns','sourceHashes']){const seen=new Set(shard[field].map(v=>JSON.stringify(v)));for(const v of extra[field])if(!seen.has(JSON.stringify(v)))shard[field].push(v);}}}
 manifest=manifest.manifest||manifest;if(shard.schemaVersion!==1||shard.worldSetRevision!==manifest.revision||!Array.isArray(shard.edges)||!shard.proofs)throw new RouteError('emitted-input-mismatch');
 for(const [cell,hash]of shard.sourceHashes){if(manifest.tiles[cell]?.sha256!==hash||manifest.tiles[cell]?.contactEligible===false)throw new RouteError('emitted-input-mismatch',{cell});}
 const g=new WorldRoadGraph();for(const e of shard.edges){if(g.edges.has(e.id))throw new RouteError('duplicate-graph-id',{edgeId:e.id});g.edges.set(e.id,{value:e});if(!g.outgoing.has(e.from))g.outgoing.set(e.from,new Set());g.outgoing.get(e.from).add(e.id);}
 for(const t of shard.turns)g.turns.set(JSON.stringify(t),{value:t});
 const proof=(kind,...args)=>{const k=JSON.stringify(args);if(!Object.hasOwn(shard.proofs[kind],k))throw new RouteError('contact-proof-unavailable',{kind});return shard.proofs[kind][k];};
 const contacts={worldSetRevision:manifest.revision,eligible:k=>!!manifest.tiles[k]&&manifest.tiles[k].contactEligible!==false&&!!shard.cells[k],surfaceAllowed:(e,c)=>routeSurfaceAllowed(e,c,g),contact:(...a)=>proof('contact',...a),width:(...a)=>proof('width',...a),safe:(...a)=>proof('safe',...a),sourceHashes:cells=>cells.map(k=>[k,manifest.tiles[k].sha256])};
 return{manifest,graph:g,contacts,shard};
}
export function argumentsOf(args){const out={};for(let i=0;i<args.length;i++){if(!args[i].startsWith('--'))throw Error('Unexpected argument '+args[i]);const key=args[i].slice(2);if(!['world','graph','routes','report','out','legacy','manifest-url','cell-only'].includes(key))throw Error('Unknown flag --'+key);out[key]=key==='cell-only'?true:args[++i];}return out;}
export async function readRouteClosures(directory,def){
 if(!def.closureIds?.length)return new Map();
 const {resolve}=await import('node:path');const data=JSON.parse(await readFile(resolve(directory,def.id+'.closures.json'),'utf8'));
 if(data.schemaVersion!==1||data.routeId!==def.id||!Array.isArray(data.blocks)||data.blocks.length>256)throw Error('Invalid route closures');
 const map=new Map();for(const b of data.blocks){if(typeof b.id!=='string'||map.has(b.id)||!['x','z','yaw','hl','hw'].every(k=>Number.isFinite(b[k]))||b.hl<=0||b.hl>40||b.hw<=0||b.hw>20||Math.abs(b.x)>1e7||Math.abs(b.z)>1e7||Object.hasOwn(b,'y'))throw Error('Invalid closure footprint');map.set(b.id,b);}
 return map;
}
