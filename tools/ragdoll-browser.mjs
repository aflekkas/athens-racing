// Run through tools/browser-slot.sh; one sequential browser job, isolated archive root.
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=path.resolve(import.meta.dirname,'..'),out=process.env.RAGDOLL_EVIDENCE||path.join(root,'.scratch/ragdoll');await fs.mkdir(out,{recursive:true});
const server=http.createServer(async(req,res)=>{try{const file=path.join(root,decodeURIComponent(new URL(req.url,'http://local').pathname));const bytes=await fs.readFile(file);res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.webp':'image/webp','.png':'image/png'})[path.extname(file)]||'application/octet-stream');res.end(bytes);}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'/tmp/pw/node_modules/playwright/index.mjs');
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN||'/home/dev/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome',args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const report={errors:[],shots:[],states:[]};
try{
 const page=await browser.newPage({viewport:{width:1000,height:640}});page.on('pageerror',e=>report.errors.push(String(e)));
 await page.goto(`http://127.0.0.1:${server.address().port}/tools/fixtures/ragdoll.html`);await page.waitForFunction(()=>window.ready,{},{timeout:120000});
 for(const [mode,times]of [['bonnet',[0,.17,.34,.6,1.1]],['rider',[0,.15,.4,.8,1.5]],['low',[0,.25,.7,1.5,3.5]]]){
  await page.evaluate(m=>ragdollFixture.setup(m),mode);let prev=0;
  for(const [i,t]of times.entries()){
   const s=await page.evaluate(dt=>ragdollFixture.step(dt),t-prev);prev=t;report.states.push(s);
   const file=path.join(out,`${mode}-${i}.png`);await page.screenshot({path:file});report.shots.push(file);
   if(mode==='rider')assert(s.riderHidden.every(v=>!v),'both rider LODs detached');
  }
 }
 assert.deepEqual(report.errors,[]);console.log(JSON.stringify({shots:report.shots.length,errors:report.errors}));
}finally{await fs.writeFile(path.join(out,'browser-report.json'),JSON.stringify(report,null,2));await browser.close();server.close();}
