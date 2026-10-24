// Browser geometry guard. Run through tools/browser-slot.sh; the unit suite checks the same markup/CSS contracts.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
let chromium;
for(const module of [process.env.PLAYWRIGHT_MODULE,'playwright','/home/dev/projects/spawn-platform/node_modules/.pnpm/playwright@1.62.0/node_modules/playwright/index.mjs'].filter(Boolean)){
 try{({chromium}=await import(module.startsWith('/')?pathToFileURL(module).href:module));break;}catch{}
}
if(!chromium)throw Error('Playwright is required for the garage browser guard. Set PLAYWRIGHT_MODULE.');
const html=`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/ui/ui.css"><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/src/menu.css"><script type="importmap">{"imports":{"three":"/vendor/build/three.module.js","three/addons/":"/vendor/examples/jsm/"}}</script><style>body{margin:0;background:#0c1219}#ui{display:block!important;position:fixed;inset:0}</style><div id="ui"></div><script type="module">
import {renderCarSelect} from '/src/car-select.js';import {CARS} from '/src/cars.js';import * as C from '/src/ui/components.js';
const root=document.querySelector('#ui');let filters={};C.bindRoot(root);root.addEventListener('click',C.handleClick);
const render=()=>root.innerHTML=renderCarSelect({garage:true,filters});root.addEventListener('ui:change',e=>{filters={...filters,[e.detail.key]:e.detail.value};render();});
window.showSpec=id=>root.innerHTML=renderCarSelect({garage:true,detail:true,index:CARS.findIndex(c=>c.id===id)});render();window.ready=true;
</script>`;
const server=createServer(async(req,res)=>{try{const path=new URL(req.url,'http://localhost').pathname;if(path==='/'){res.setHeader('Content-Type','text/html');res.end(html);return;}
 const file=path.startsWith('/vendor/')?resolve(root,'node_modules/three',path.slice(8)):resolve(root,'.'+path);
 res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml'})[extname(file)]||'application/octet-stream');res.end(await readFile(file));
}catch{res.statusCode=404;res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
try{
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN||undefined,args:['--no-sandbox','--enable-webgl','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const page=await browser.newPage({deviceScaleFactor:2});
 for(const width of [1280,960]){
  await page.setViewportSize({width,height:844});await page.goto(`http://127.0.0.1:${server.address().port}/`,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.ready);
  const failures=await page.evaluate(()=>{
   const errors=[],grid=document.querySelector('.car-grid'),toolbar=document.querySelector('.catalog-toolbar'),heading=document.querySelector('.scr__head');
   if(toolbar.getBoundingClientRect().top<heading.getBoundingClientRect().bottom)errors.push('toolbar overlaps title');
   if(grid.clientHeight<innerHeight*.5)errors.push('grid does not fill vertical space');
   for(const card of grid.children){const pill=card.querySelector('.card__badge'),logo=card.querySelector('.car-card__brand');if(!logo?.dataset.manufacturer)errors.push('missing manufacturer');if(!pill)continue;const a=card.getBoundingClientRect(),b=pill.getBoundingClientRect();if(b.left<a.left+4||b.right>a.right-4||b.top<a.top+4||b.bottom>a.bottom-4)errors.push('drive outside '+card.textContent);}
   return errors;
  });assert.deepEqual(failures,[],width+'px card bounds');
  await page.locator('[data-key="brand"]').scrollIntoViewIfNeeded();await page.locator('[data-key="brand"]').click();
  const options=page.locator('.listbox__opt');assert.ok(await options.count()>10);assert.equal(await options.locator('[data-manufacturer]').count(),await options.count()-1);
  await options.filter({hasText:'VOLKSWAGEN'}).click();assert.equal(await page.locator('.car-card').count(),1);assert.equal(await page.locator('.car-card [data-manufacturer]').getAttribute('data-manufacturer'),'volkswagen');
  console.log('Garage browser bounds, logos and brand filter PASS',width);
  for(const id of ['golf','van']){
   await page.evaluate(id=>window.showSpec(id),id);
   const layout=await page.evaluate(()=>{
    const stage=document.querySelector('.car-stage').getBoundingClientRect(),view=document.querySelector('.car-preview-viewport').getBoundingClientRect(),tiles=[...document.querySelectorAll('.stats--specs .stat-tile')].map(el=>{const r=el.getBoundingClientRect();return {width:r.width,height:r.height};});
    return {frameError:Math.max(Math.abs(stage.left-view.left),Math.abs(stage.top-view.top),Math.abs(stage.width-view.width),Math.abs(stage.height-view.height)),tiles,paint:!!document.querySelector('.car-paints')};
   });
   assert.ok(layout.frameError<.5,`${id} viewer must fill its entire container`);assert.equal(layout.tiles.length,6);
   for(const tile of layout.tiles){assert.ok(Math.abs(tile.width-layout.tiles[0].width)<1);assert.ok(Math.abs(tile.height-layout.tiles[0].height)<1);}
   assert.equal(layout.paint,id==='golf');
  }
  console.log('Garage viewer container and equal spec tiles PASS',width);
 }
}finally{await browser?.close();await new Promise(r=>server.close(r));}
