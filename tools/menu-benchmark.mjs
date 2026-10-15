// Run through tools/browser-slot.sh node tools/menu-benchmark.mjs AFTER_ROOT OUT BEFORE_ROOT.
// Local CDN mirror and immutable static cache keep cold/warm timing repeatable without routing (which disables Chrome caching).
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {pathToFileURL} from 'node:url';
const root=resolve(process.argv[2]),out=resolve(process.argv[3]);await fs.mkdir(out,{recursive:true});
const {createGameServer}=await import(pathToFileURL(resolve(root,'server/index.mjs')));
const app=await createGameServer({root,dataDir:resolve(out,'server-data')});
const types={'.js':'text/javascript','.mjs':'text/javascript','.html':'text/html','.css':'text/css','.svg':'image/svg+xml','.json':'application/json','.bin':'application/octet-stream','.webp':'image/webp','.png':'image/png','.jpg':'image/jpeg','.wav':'audio/wav','.mp3':'audio/mpeg','.woff2':'font/woff2'};
let servedRoot=root;
const server=http.createServer(async(req,res)=>{const path=new URL(req.url,'http://localhost').pathname;if(path.startsWith('/api/')||path==='/health')return app.server.emit('request',req,res);try{let file=resolve(servedRoot,'.'+(path==='/'?'/index.html':path));if(path.startsWith('/vendor/'))file=resolve(root,'node_modules/three',path.slice(8));let body=await fs.readFile(file);if(file.endsWith('index.html'))body=Buffer.from(body.toString().replaceAll('https://cdn.jsdelivr.net/npm/three@0.170.0/','/vendor/'));res.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream','Content-Length':body.length,'Cache-Control':file.endsWith('index.html')?'no-cache':'public,max-age=3600'});res.end(body);}catch{res.writeHead(404);res.end();}});
server.on('upgrade',(...args)=>app.server.emit('upgrade',...args));await new Promise(r=>server.listen(0,'127.0.0.1',r));
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || '/tmp/pw/node_modules/playwright/index.mjs');
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});

const results=[];
try {for(let run=0;run<3;run++)for(const variant of (run%2?['after','before']:['before','after'])) {
 servedRoot=variant==='before'?resolve(process.argv[4]||'/tmp/menu-redesign-baseline'):root;
 const context=await browser.newContext({viewport:{width:1280,height:800}}),page=await context.newPage();
 await page.addInitScript(()=>{const raf=requestAnimationFrame;window.requestAnimationFrame=cb=>['frame','onAnimationFrame'].includes(cb.name)?0:raf(cb);new MutationObserver(()=>{if(document.body?.dataset.ui==='title'&&!window.__menuAt)window.__menuAt=performance.now();}).observe(document,{subtree:true,childList:true,attributes:true,attributeFilter:['data-ui']});});
 for(const cache of ['cold','warm']) {await page.goto(`http://127.0.0.1:${server.address().port}/?menu&guest=1&quality=low`,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__menuAt&&document.body.classList.contains('loaded'),null,{timeout:120000});await page.locator('.home__car').evaluateAll(imgs=>Promise.all(imgs.map(img=>img.decode())));const record=await page.evaluate(()=>({timeToMenuMs:__menuAt,transferBytes:performance.getEntriesByType('resource').reduce((n,r)=>n+r.transferSize,performance.getEntriesByType('navigation')[0].transferSize),bodyBytes:performance.getEntriesByType('resource').reduce((n,r)=>n+r.encodedBodySize,0),runtime:__mapRuntime(),mapRequests:performance.getEntriesByType('resource').filter(r=>/\/data\//.test(r.name)).length}));results.push({run,variant,cache,...record});console.log(JSON.stringify(results.at(-1)));}
 await context.close();
}await fs.writeFile(resolve(out,'paired-performance.json'),JSON.stringify(results,null,2));}catch(e){console.error(e);process.exitCode=1;}finally{await browser.close();server.close();app.server.close();process.exit(process.exitCode||0);}
