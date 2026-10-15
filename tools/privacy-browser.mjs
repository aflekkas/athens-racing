// Run with tools/browser-slot.sh; exercise the actual legal response and shared menu components.
import http from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from '/tmp/pw/node_modules/playwright/index.mjs';
import { legalPage } from '../worker/legal-pages.mjs';
const out = resolve('.scratch/privacy'); await mkdir(out, { recursive: true });
const styles = [...(await readFile('index.html','utf8')).matchAll(/<link\b[^>]*rel="stylesheet"[^>]*>/g)].map(m=>m[0].replaceAll('href="./','href="/')).join('');
const harness = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">${styles}<style>#ui{position:fixed;inset:0}</style><script type="importmap">{"imports":{"three":"/node_modules/three/build/three.module.js","three/addons/":"/node_modules/three/examples/jsm/"}}</script></head><body><div id="ui"></div><script type="module">import {Menu} from '/src/menu.js';window.menu=new Menu(document.querySelector('#ui'),{ui(){},ctx(){return{}},inputDevice(){return'keyboard'}});menu.show('title');</script></body></html>`;
const server = http.createServer(async(req,res)=>{try{
 const path = new URL(req.url,'http://localhost').pathname;
 const legal = legalPage(new Request('http://localhost'+req.url));
 if(legal){res.writeHead(legal.status,Object.fromEntries(legal.headers));res.end(Buffer.from(await legal.arrayBuffer()));return;}
 if(path==='/'){res.setHeader('Content-Type','text/html');res.end(harness);return;}
 const file=resolve('.'+path);if(!file.startsWith(resolve('.')+'/'))throw Error('path');
 res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.json':'application/json'})[extname(file)]||'application/octet-stream');res.end(await readFile(file));
 }catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,executablePath:'/home/dev/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome',args:['--no-sandbox']});
const report=[];
try{for(const width of [1280,390]){
 const page=await browser.newPage({viewport:{width,height:width===390?844:900}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 for(const path of ['privacy','terms']){
 const requests=[]; const listener=r=>requests.push(r.url());page.on('request',listener);
 const r=await page.goto(`http://127.0.0.1:${server.address().port}/${path}`);assert.equal(r.status(),200);
 assert.equal(await page.locator('script').count(),0);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 assert.equal(requests.length,1);page.off('request',listener);
 await page.screenshot({path:resolve(out,`${path}-${width}.png`),fullPage:true});
 }
 await page.route('**/api/**',r=>r.fulfill({json:new URL(r.request().url()).pathname==='/api/auth/config'?{providers:['google'],required:true}:{user:null}}));
 await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.waitForFunction(()=>window.menu?.accounts?.ready);
 for(const [name,screen,data] of [['sign-in','signIn',{}],['account-summary','accountPrivacy',{}],['about','settings',{tab:'about'}],['credits','credits',{}]]){
 await page.evaluate(({screen,data})=>{if(['settings','credits'].includes(screen))menu.accounts.required=false;menu.show(screen,data);},{screen,data});
 await page.waitForTimeout(300);assert.ok(await page.locator('#ui a[href="/privacy"]').count()>0);
 assert.ok(await page.locator('#ui a[href="/terms"]').count()>0);
 if(width===390 && screen==='signIn'){
 const popupEvent=page.waitForEvent('popup');
 await page.evaluate(()=>menu.activate(document.querySelector('#ui a[href="/privacy"]')));
 const popup=await popupEvent;await popup.waitForLoadState();assert.match(popup.url(),/\/privacy$/);
 assert.equal(await popup.locator('script').count(),0);await popup.close();
 }
 await page.screenshot({path:resolve(out,`${name}-${width}.png`)});
 }
 assert.deepEqual(errors,[]);report.push({width,errors,standaloneRequests:1,overflow:false,menuLinks:true});await page.close();
}await writeFile(resolve(out,'browser-report.json'),JSON.stringify(report,null,2));}finally{await browser.close();await new Promise(r=>server.close(r));}
