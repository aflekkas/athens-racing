// Run one browser job: bash tools/browser-slot.sh node tools/airborne-evidence.mjs
const { chromium } = await import('playwright').catch(() => import('/tmp/pw/node_modules/playwright/index.mjs'));
import http from 'node:http';
import { readFile,writeFile,mkdir } from 'node:fs/promises';
import { resolve,extname } from 'node:path';
const out=resolve(process.env.AIRBORNE_OUT||'.scratch/airborne'),root=resolve('.');await mkdir(out,{recursive:true});
const types={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.png':'image/png','.json':'application/json','.css':'text/css','.wav':'audio/wav','.webp':'image/webp'};
const server=http.createServer(async(req,res)=>{try{const path=resolve(root,'.'+new URL(req.url,'http://local').pathname);if(!path.startsWith(root+'/'))throw Error('path');res.setHeader('content-type',types[extname(path)]||'application/octet-stream');res.end(await readFile(path));}catch{res.statusCode=404;res.end('not found');}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
const errors=[],frames={};
try{
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/home/dev/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell',args:['--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader-webgl','--disable-dev-shm-usage']});
 const page=await browser.newPage({viewport:{width:960,height:600}});page.on('pageerror',e=>errors.push(e.stack));
 await page.goto(`http://127.0.0.1:${server.address().port}/tools/airborne-preview.html`);await page.waitForFunction(()=>window.airborneReady,{timeout:60000});
 for(const [name,times]of Object.entries({crest:[.6,.85,1.1,1.4,1.8,2.6],barrier:[0,.2,.5,.8,1.2,2,3.5,6],bus:[.55,.7,.85,1.1,1.5,2.2,3.5,6],sports:[.55,.85,1.5,3.5]})){
  await page.evaluate(name=>airborne.setup(name),name);frames[name]=[];
  for(let i=0;i<times.length;i++){const state=await page.evaluate(n=>airborne.frame(n),Math.round(times[i]*60));frames[name].push(state);await page.screenshot({path:resolve(out,`${name}-${String(i).padStart(2,'0')}.png`)});}
 }
 await writeFile(resolve(out,'browser-frames.json'),JSON.stringify({errors,frames},null,2));
 if(errors.length)throw Error(errors.join('\n'));console.log(JSON.stringify({errors,scenarios:Object.keys(frames),frames:Object.values(frames).reduce((n,a)=>n+a.length,0)}));
}finally{await browser?.close();await new Promise(r=>server.close(r));}
