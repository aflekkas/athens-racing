// ROOT=<archive> OUT=<dir> TAG=before|after CAR=gla45 tools/browser-slot.sh node lobby-shots.mjs
// The multiplayer lobby's "your car" panel (renderLobby with a stand-in Multiplayer, real CSS and the real car catalogue) at 1280x800 and 390x844.
import {createServer} from 'node:http';import {readFile} from 'node:fs/promises';import {resolve,extname} from 'node:path';import fs from 'node:fs/promises';import sharp from 'sharp';
const root=process.env.ROOT,out=resolve(process.env.OUT),tag=process.env.TAG,car=process.env.CAR||'gla45';await fs.mkdir(out,{recursive:true});
const {chromium}=await import('/home/dev/projects/spawn-platform/node_modules/.pnpm/playwright@1.62.0/node_modules/playwright/index.mjs');
const html=`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/ui/ui.css"><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/src/menu.css"><script type="importmap">{"imports":{"three":"/vendor/build/three.module.js","three/addons/":"/vendor/examples/jsm/"}}</script><style>body{margin:0;background:#050810;color:#fff}#ui{display:block!important;position:fixed;inset:0}</style><div id="ui"></div><script type="module">
import {renderLobby} from '/src/ui/mp-screens.js';import {CARS} from '/src/cars.js';import * as C from '/src/ui/components.js';
const root=document.querySelector('#ui');C.bindRoot(root);
const cars=CARS.map(c=>({id:c.id,name:c.name,short:c.short,power:c.power,drive:c.drive,mass:c.mass,body:c.body,marque:c.marque,trimLabel:c.trimLabel,zeroTo100:c.zeroTo100}));
const players=[{id:'a',name:'GR-1001',car:'${car}',ready:false,loaded:true},{id:'b',name:'GR-2002',car:'golf_gti',ready:true,loaded:true}];
const mp={id:'a',connected:true,worldReady:true,canChangeCar:true,preparing:null,creating:false,objectiveMode:null,cars,maps:[{id:'riviera',name:'ATHENS RIVIERA'}],
 lobby:{code:'ABC123',name:'TEST RUN',host:'a',status:'waiting',mode:'sprint',mapId:'riviera',config:{time:'afternoon',weather:'clear',police:false,traffic:1},players},
 get me(){return this.lobby.players.find(p=>p.id===this.id);},get allowedCars(){return this.cars.map(c=>c.id);},$:()=>({textContent:'Connected · 12 ms · 2/8 drivers'}),ranking(){return this.lobby.players;},resultRowText:()=>'' ,rulesSummary:()=>'OPEN'};
root.innerHTML=renderLobby({h:{fmtTime:t=>t.toFixed(2)}},mp);window.ready=true;
</script>`;
const server=createServer(async(req,res)=>{try{const path=new URL(req.url,'http://localhost').pathname;if(path==='/'){res.setHeader('Content-Type','text/html');res.end(html);return;}
 const file=path.startsWith('/vendor/')?resolve(root,'node_modules/three',path.slice(8)):resolve(root,'.'+path);
 res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml'})[extname(file)]||'application/octet-stream');res.end(await readFile(file));}catch{res.statusCode=404;res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
try{for(const [w,h] of [[1280,800],[390,844]]){const page=await browser.newPage({viewport:{width:w,height:h}});page.on('pageerror',e=>console.log('PAGEERROR',e.message));page.on('console',m=>{if(m.type()==='error')console.log('CONSOLE',m.text().slice(0,200));});
 await page.goto(`http://127.0.0.1:${server.address().port}/`,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.ready,null,{timeout:60000});await page.waitForTimeout(900);
 const buf=await page.screenshot({type:'png'});await sharp(buf).webp({quality:85}).toFile(`${out}/lobby-${car}-${tag}-${w}x${h}.webp`);console.log('SHOT',w);await page.close();}
}finally{await browser.close();server.close();}
