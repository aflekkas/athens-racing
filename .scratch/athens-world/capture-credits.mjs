// Run through tools/browser-slot.sh; actual Menu + Credits components, no copied UI.
import http from 'node:http';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {chromium} from '/tmp/pw/node_modules/playwright/index.mjs';
import {buildCredits} from '../../tools/release-data.mjs';
const root=process.cwd(),out=resolve('.scratch/athens-world'),credits=await buildCredits(root,{authors:[]});
const styles=[...(await readFile('index.html','utf8')).matchAll(/<link\b[^>]*rel="stylesheet"[^>]*>/g)].map(m=>m[0].replaceAll('href="./','href="/')).join('');
const html=`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">${styles}<style>#ui{position:fixed;inset:0}</style><script type="importmap">{"imports":{"three":"/node_modules/three/build/three.module.js","three/addons/":"/node_modules/three/examples/jsm/"}}</script></head><body><div id="ui"></div><script type="module">import {Menu} from '/src/menu.js';window.menu=new Menu(document.querySelector('#ui'),{ui(){},ctx(){return{}},inputDevice(){return'keyboard'}});menu.show('title');</script></body></html>`;
const server=http.createServer(async(req,res)=>{try{
 const p=new URL(req.url,'http://local').pathname;
 if(p==='/'){res.setHeader('content-type','text/html');res.end(html);return;}
 if(p==='/credits.json'){res.setHeader('content-type','application/json');res.end(JSON.stringify(credits));return;}
 if(p.startsWith('/api/')){res.setHeader('content-type','application/json');res.end(JSON.stringify(p==='/api/auth/config'?{providers:[],required:false}:{user:null}));return;}
 const file=resolve('.'+p);if(!file.startsWith(root+'/'))throw Error('path');
 res.setHeader('content-type',({'.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.json':'application/json'})[extname(file)]||'application/octet-stream');res.end(await readFile(file));
 }catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,executablePath:'/home/dev/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome',args:['--no-sandbox']});
const report={purpose:'Attribution only; this is not a playable world or street-view screenshot.',captures:[],errors:[]};
try{for(const width of [1280,390]){
 const page=await browser.newPage({viewport:{width,height:width===390?844:900}});page.on('pageerror',e=>report.errors.push(e.message));
 await page.goto(`http://127.0.0.1:${server.address().port}/`);
 await page.waitForFunction(()=>window.menu?.accounts?.ready);
 await page.evaluate(()=>{menu.accounts.required=false;menu.show('credits');});
 const row=page.locator('[data-credit="tools-world-gen-credits-md"]');await row.waitFor();await row.evaluate(el=>el.click());
 await page.waitForSelector('.credit-sheet');assert.match(await page.locator('.credit-sheet').innerText(),/OpenStreetMap contributors/);
 assert.match(await page.locator('.credit-sheet').innerText(),/Copernicus/);
 await page.waitForTimeout(400);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 const name=`credits-${width}.png`;await page.screenshot({path:resolve(out,name)});report.captures.push(name);await page.close();
}assert.deepEqual(report.errors,[]);await writeFile(resolve(out,'credits-browser.json'),JSON.stringify(report,null,2)+'\n');}
finally{await browser.close();await new Promise(r=>server.close(r));}
