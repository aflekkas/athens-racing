#!/usr/bin/env node
// PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node tools/damage-visual.mjs
// Starts its own ephemeral static server; never touches the application server.
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile, stat, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve, extname, dirname, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),out=resolve(root,'.scratch/damage');
let playwright;
for(const candidate of [process.env.PLAYWRIGHT_MODULE,'playwright','/tmp/pw/node_modules/playwright/index.mjs'].filter(Boolean)){
  try{playwright=await import(candidate.startsWith('/')?pathToFileURL(candidate).href:candidate);break;}catch{}
}
if(!playwright)throw new Error('Install Playwright separately and set PLAYWRIGHT_MODULE to its index.mjs.');
const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg','.css':'text/css'};
const server=createServer(async(req,res)=>{
  try{const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);let path=resolve(root,'.'+pathname);if(!path.startsWith(root+sep))throw new Error('Outside repository');if((await stat(path)).isDirectory())path=resolve(path,'index.html');const data=await readFile(path);res.writeHead(200,{'Content-Type':mime[extname(path)]||'application/octet-stream','Cache-Control':'no-store'});res.end(data);}catch{res.writeHead(404);res.end('Not found');}
});
await new Promise((yes,no)=>{server.once('error',no);server.listen(0,'127.0.0.1',yes);});
await mkdir(out,{recursive:true});
let browser;
try{
  let executablePath=process.env.CHROME_BIN;
  if(!executablePath&&!existsSync(playwright.chromium.executablePath())){
    const cache=resolve(homedir(),'.cache/ms-playwright');
    for(const folder of (await readdir(cache).catch(()=>[])).filter(n=>/^chromium-\d+$/.test(n)).sort().reverse()){
      const candidate=resolve(cache,folder,'chrome-linux64/chrome');if(existsSync(candidate)){executablePath=candidate;break;}
    }
  }
  browser=await playwright.chromium.launch({headless:true,executablePath,args:['--no-sandbox','--enable-webgl','--ignore-gpu-blocklist','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const page=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1});const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${server.address().port}/tools/damage-preview.html`,{waitUntil:'networkidle',timeout:60000});
  await page.waitForFunction(()=>window.damageReady,{},{timeout:60000});
  const invariants=await page.evaluate(()=>damagePreview.tests());
  console.log(`Damage browser invariants: ${invariants.passed} passed`);
  const catalogue=await page.evaluate(()=>({cars:damagePreview.cars,scenarios:damagePreview.scenarios}));const reports=[];
  for(const car of catalogue.cars.filter(c=>!process.env.DAMAGE_CARS||process.env.DAMAGE_CARS.split(',').includes(c)))for(const scenario of catalogue.scenarios.filter(s=>!process.env.DAMAGE_SCENARIOS||process.env.DAMAGE_SCENARIOS.split(',').includes(s))){
    await page.evaluate(([id,s])=>damagePreview.setup(id,s),[car,scenario]);
    await page.screenshot({path:resolve(out,`${car}-${scenario}-before.png`)});
    const report=await page.evaluate(()=>damagePreview.impact());reports.push(report);
    await page.screenshot({path:resolve(out,`${car}-${scenario}-after.png`)});
    console.log(`${car} ${scenario}: ${report.deformationMs.toFixed(1)} ms, max displacement ${report.maxDisplacement.toFixed(3)} m`);
    if(!report.finite||report.bounds.size.some(n=>!Number.isFinite(n)||n>15)||report.maxDisplacement>1.5)throw new Error(`Invalid deformation: ${JSON.stringify(report)}`);
  }
  const createdAt=new Date().toISOString(),result={createdAt,invariants,reports,errors};
  await writeFile(resolve(out,'report-'+createdAt.replaceAll(':','-')+'.json'),JSON.stringify(result,null,2)+'\n');
  await writeFile(resolve(out,'report.json'),JSON.stringify(result,null,2)+'\n');
  if(errors.length)throw new Error(errors.join('\n'));
  console.log(`Saved ${reports.length*2} screenshots and report.json to ${out}`);
}finally{await browser?.close();await new Promise(done=>server.close(done));}
