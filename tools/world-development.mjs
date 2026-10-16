// Private localhost-only fixture viewer. Never imported by the game or deployment build.
import { createServer } from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import { resolve, dirname, relative, extname, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validateWorldManifest } from '../src/world-tile-format.js';
const root=resolve(import.meta.dirname,'..');
const mime={'.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.html':'text/html','.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg','.svg':'image/svg+xml'};
export async function startWorldDevelopment(manifestPath,{port=0}={}){
  manifestPath=await realpath(manifestPath);
  const manifest=validateWorldManifest(JSON.parse(await readFile(manifestPath,'utf8')));
  if(manifest.developmentOnly!==true||manifest.releaseReady!==false)throw new Error('Private viewer requires developmentOnly:true and releaseReady:false');
  const files=new Map([['/fixture/manifest.json',manifestPath]]),source=dirname(manifestPath);
  for(const entry of Object.values(manifest.tiles)){
    const url=new URL(entry.url,'http://fixture/fixture/');
    if(url.origin!=='http://fixture'||!url.pathname.startsWith('/fixture/')||url.search||url.hash)throw new Error('Fixture asset must stay inside its directory');
    const path=await realpath(resolve(source,decodeURIComponent(url.pathname.slice('/fixture/'.length)))),rel=relative(source,path);
    if(rel==='..'||rel.startsWith('..'+sep)||resolve(rel)===rel)throw new Error('Fixture asset escapes directory');
    if((await stat(path)).size>25*1024*1024)throw new Error('Fixture asset exceeds 25 MiB');
    files.set(url.pathname,path);
  }
  const server=createServer(async(req,res)=>{
    if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return;}
    try{
      const url=new URL(req.url,'http://localhost'),pathname=decodeURIComponent(url.pathname);let path=files.get(pathname);
      if(pathname==='/')path=resolve(root,'tools/world-development.html');
      else if(!path){
        const allowed=pathname.startsWith('/src/')||pathname.startsWith('/assets/')||pathname.startsWith('/vendor/');
        if(!allowed)throw new Error('Not found');
        const base=await realpath(pathname.startsWith('/vendor/')?resolve(root,'node_modules/three'):root);
        path=await realpath(resolve(base,pathname.startsWith('/vendor/')?pathname.slice(8):'.'+pathname));
        if(!path.startsWith(base+sep))throw new Error('Not found');
      }
      let body=await readFile(path),status=200;const headers={'Content-Type':mime[extname(path)]||'application/octet-stream','Cache-Control':'no-store','X-Robots-Tag':'noindex'};
      if(files.has(pathname)&&req.headers.range){const match=/^bytes=(\d+)-(\d+)$/.exec(req.headers.range);if(!match)throw new Error('Invalid range');const start=Number(match[1]),end=Number(match[2]);if(start>end||end>=body.length){res.writeHead(416);res.end();return;}headers['Content-Range']=`bytes ${start}-${end}/${body.length}`;body=body.subarray(start,end+1);status=206;}
      headers['Content-Length']=body.length;res.writeHead(status,headers);res.end(req.method==='HEAD'?undefined:body);
    }catch{res.writeHead(404);res.end('Not found');}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  return {server,url:`http://127.0.0.1:${server.address().port}`,manifest};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
  if(!process.argv[2])throw new Error('Usage: node tools/world-development.mjs /absolute/development/manifest.json [port]');
  const result=await startWorldDevelopment(resolve(process.argv[2]),{port:Number(process.argv[3]||8795)});
  console.log(`Private AWT viewer ${result.url}\n${result.manifest.world} · ${result.manifest.revision}\nDevelopment fixture only; road-grade/driving acceptance pending. Ctrl-C stops the server.`);
}
