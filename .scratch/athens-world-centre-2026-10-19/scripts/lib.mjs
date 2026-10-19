// Shared harness: serve the game tree plus a published Athens world exactly as the Worker does (manifest alias and
// content-hashed cells), count bytes by kind, launch Chromium, sum the browser's process-tree RSS.
import http from 'node:http';import {readFile} from 'node:fs/promises';import {resolve,extname} from 'node:path';import {execFileSync} from 'node:child_process';
import {chromium} from '/home/dev/projects/spawn-platform/node_modules/.pnpm/playwright@1.62.0/node_modules/playwright/index.mjs';
const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.webp':'image/webp','.woff2':'font/woff2','.ktx2':'image/ktx2','.mp3':'audio/mpeg','.ogg':'audio/ogg'};
export const counters=()=>({world:{bytes:0,count:0,urls:new Set()},manifest:{bytes:0,count:0},other:{bytes:0,count:0},byExt:{}});
export async function startServer({app,r2,c=counters()}){
  app=resolve(app);r2=resolve(r2);
  const server=http.createServer(async(req,res)=>{try{
    const p=new URL(req.url,'http://l').pathname;
    if(p==='/api/auth/config'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({required:false,providers:[]}));return;}
    let file,kind='other';
    if(p==='/data/athens/manifest.json'){file=r2+'/manifest.json';kind='manifest';}
    else if(p.startsWith('/world/')){file=resolve(r2,'.'+p);kind='world';}
    else file=resolve(app,'.'+(p==='/'?'/index.html':p));
    if(!file.startsWith(resolve(app)+'/')&&!file.startsWith(resolve(r2)+'/'))throw Error('path');
    let body=await readFile(file);if(file.endsWith('index.html'))body=Buffer.from(body.toString().replaceAll('https://cdn.jsdelivr.net/npm/three@0.170.0/','/node_modules/three/'));
    res.setHeader('Content-Type',mime[extname(file)]||'application/octet-stream');
    // Exactly the Worker's headers: content-hashed cells are immutable for a year, the manifest alias is revalidated.
    if(kind==='world')res.setHeader('Cache-Control','public, max-age=31536000, immutable');else if(kind==='manifest')res.setHeader('Cache-Control','no-cache');
    // Count what a real client downloads: cells are already gzip files; text assets are measured gzipped as the CDN would send them.
    let sent=body.length;if(kind==='other'&&/\.(js|mjs|json|css|html|svg)$/.test(file)){const {gzipSync}=await import('node:zlib');sent=gzipSync(body).length;}
    const k=c[kind];k.bytes+=sent;k.count++;if(kind==='world'){k.urls.add(p);k.size??=new Map();k.size.set(p,sent);}const ext=extname(file)||'none';(c.byExt[ext]??={bytes:0,count:0});c.byExt[ext].bytes+=sent;c.byExt[ext].count++;
    res.end(body);}catch{res.writeHead(404);res.end('Not found');}});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));return {server,port:server.address().port,c};
}
export async function launch({mobile=false,throttle=1}={}){
  const browser=await chromium.launch({headless:true,executablePath:'/home/dev/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome',args:['--no-sandbox']});
  const context=await browser.newContext(mobile?{viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true}:{viewport:{width:1280,height:720}});
  const page=await context.newPage();if(throttle>1){const cdp=await context.newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:throttle});}
  return {browser,context,page};
}
export function treeRss(pid){
  // Resident set of the browser and every descendant, in bytes (read-only ps; no signals).
  const rows=execFileSync('ps',['-eo','pid=,ppid=,rss='],{encoding:'utf8'}).trim().split('\n').map(l=>l.trim().split(/\s+/).map(Number));
  let total=0;const stack=[pid]; // descendants only: the measuring script itself is not the browser
  while(stack.length){const cur=stack.pop();for(const [p,pp,rss] of rows)if(pp===cur&&p!==cur){total+=rss;stack.push(p);}}
  return total*1024;
}
