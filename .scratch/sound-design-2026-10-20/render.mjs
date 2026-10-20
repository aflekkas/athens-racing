// Run through tools/browser-slot.sh. No game server or background processes survive this job.
import {execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {chromium} from '/home/dev/projects/spawn-platform/node_modules/.pnpm/playwright@1.62.0/node_modules/playwright/index.mjs';
const [prefix='before',raw='/tmp/sound-design.u1Gf/raw',filter='']=process.argv.slice(2);
console.log('Capture process',process.pid);
const historical=new Map(),baseRef=process.env.SOUND_BASE_REF;
const root=process.cwd();await mkdir(raw,{recursive:true});
const server=createServer(async(req,res)=>{try{
 const url=new URL(req.url,'http://local');
 if(req.method==='POST') {const name=url.pathname.slice(1);if(!/^[\w.-]+$/.test(name))throw Error('name'); const chunks=[];for await(const c of req)chunks.push(c);await writeFile(resolve(raw,name),Buffer.concat(chunks));res.end('ok');return;}
 if(url.pathname==='/'){res.setHeader('Content-Type','text/html');res.end('<script type="module" src="/.scratch/sound-design-2026-10-20/scenes.js"></script>');return;}
 const path=resolve(root,'.'+decodeURIComponent(url.pathname));if(!path.startsWith(root+'/'))throw Error('path');
 if(baseRef&&url.pathname.startsWith('/src/')){if(!historical.has(url.pathname))historical.set(url.pathname,execFileSync('git',['show',baseRef+':'+url.pathname.slice(1)]));res.setHeader('Content-Type','text/javascript');res.end(historical.get(url.pathname));return;}
 res.setHeader('Content-Type',({'.js':'text/javascript','.json':'application/json','.mp3':'audio/mpeg','.wav':'audio/wav'})[extname(path)]||'application/octet-stream');res.end(await readFile(path));
 }catch(e){res.statusCode=404;res.end(String(e));}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
try{
 browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});const page=await browser.newPage();
 page.on('console',m=>{if(m.type()==='error')console.error(m.text());});page.on('pageerror',e=>console.error(e));
 await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>window.auditScenes);
 const names=await page.evaluate(()=>window.auditScenes());
 const results=JSON.parse(await readFile(resolve(raw,prefix+'-renders.json'),'utf8').catch(()=> '[]'));
 for(const name of names.filter(n=>!filter||new RegExp(filter).test(n))){
   const r=await page.evaluate(async({name,prefix})=>Promise.race([window.renderSound(name,prefix),new Promise((_,reject)=>setTimeout(()=>reject(Error('Render timeout: '+name)),60000))]),{name,prefix});const old=results.findIndex(x=>x.name===r.name);if(old>=0)results[old]=r;else results.push(r);console.log(JSON.stringify(r));await writeFile(resolve(raw,prefix+'-renders.json'),JSON.stringify(results,null,2));
 }
 await writeFile(resolve(raw,prefix+'-renders.json'),JSON.stringify(results,null,2));
}finally{await browser?.close();await new Promise(r=>server.close(r));}
