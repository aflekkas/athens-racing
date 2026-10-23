// Local source first; route catalogue, compiled routes and world cells that only exist as deploy artefacts come from our
// own staging site (GET only, cached in the task temp dir). No accounts, no leaderboard writes.
import fs from 'node:fs/promises';
import {createServer} from 'node:http';
import {resolve,extname,dirname} from 'node:path';
import {createHash} from 'node:crypto';
const TYPES={'.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.html':'text/html','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml','.woff2':'font/woff2','.jpg':'image/jpeg','.wav':'audio/wav','.mp3':'audio/mpeg','.ogg':'audio/ogg','.ktx2':'image/ktx2'};
export async function serve(root,cacheDir){
 await fs.mkdir(cacheDir,{recursive:true});
 const remote=async(path,search)=>{const key=resolve(cacheDir,createHash('sha1').update(path+search).digest('hex'));
  try{return JSON.parse(await fs.readFile(key+'.meta'))&&{body:await fs.readFile(key),...JSON.parse(await fs.readFile(key+'.meta'))};}catch{}
  const r=await fetch('https://staging.athensracing.com'+path+search);if(!r.ok)return null;const body=Buffer.from(await r.arrayBuffer()),type=r.headers.get('content-type')||'application/octet-stream',enc=r.headers.get('content-encoding');
  await fs.writeFile(key,body);await fs.writeFile(key+'.meta',JSON.stringify({type}));return {body,type};};
 const server=createServer(async(req,res)=>{try{
  const url=new URL(req.url,'http://local'),path=url.pathname;
  if(path==='/api/auth/config'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({providers:[],required:false}));return;}
  if(path==='/api/routes'){const r=await remote(path,'');res.setHeader('Content-Type','application/json');res.end(r.body);return;}
  if(path.startsWith('/api/')){res.writeHead(404,{'Content-Type':'application/json'});res.end('{"error":"offline capture"}');return;}
  const file=path.startsWith('/world-three/')?resolve(root,'node_modules/three',path.slice(13)):resolve(root,'.'+(path==='/'?'/index.html':path));
  let data;try{data=await fs.readFile(file);}catch{const r=await remote(path,url.search);if(!r){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',r.type);res.end(r.body);return;}
  // workers have no import map: point bare three imports at the same local copy (production bundles them)
  if(/\.m?js$/.test(path)&&path.startsWith('/src/'))data=Buffer.from(data.toString().replace(/from\s*(['"])three\1/g,"from '/world-three/build/three.module.js'").replace(/(['"])three\/addons\//g,"$1/world-three/examples/jsm/"));
  if(path==='/'||path==='/index.html')data=Buffer.from(data.toString().replaceAll('https://cdn.jsdelivr.net/npm/three@0.170.0/','/world-three/'));
  res.setHeader('Content-Type',TYPES[extname(file)]||'application/octet-stream');res.end(data);
 }catch(e){res.writeHead(500);res.end(String(e));}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));return server;
}
