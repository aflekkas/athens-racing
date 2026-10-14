// One browser-slot job; trusted keyboard, production player/ground/render graph.
// FEEL_OUT and BEFORE_PHYS are absolute evidence paths. Run from a clean archive.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
const root = resolve(import.meta.dirname, '../..');
const out = resolve(process.env.FEEL_OUT || '.scratch/power-corner-browser');
await mkdir(out, { recursive: true });
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE || '/tmp/pw/node_modules/playwright/index.mjs'));
let phase = 'after';
const mime = { '.html':'text/html', '.js':'text/javascript', '.json':'application/json', '.css':'text/css', '.svg':'image/svg+xml', '.png':'image/png' };
const server = createServer(async (req,res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    let file = resolve(root, '.' + pathname);
    if (!file.startsWith(root + sep) && file !== root) throw new Error('outside root');
    if ((await stat(file)).isDirectory()) file = resolve(file, 'index.html');
    if (phase === 'before' && pathname === '/src/physics.js') file = process.env.BEFORE_PHYS;
    res.writeHead(200, {'Content-Type':mime[extname(file)] || 'application/octet-stream','Cache-Control':'no-store'});
    res.end(await readFile(file));
  } catch { res.writeHead(404);res.end('Not found'); }
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const port=server.address().port;
const errors=[], runs=[];
let browser;
try {
  const executablePath=process.env.CHROME_PATH || (existsSync(chromium.executablePath()) ? undefined : '/home/dev/.t3/tools/chrome-headless-shell/linux64/154.0.8037.92/chrome-headless-shell');
  browser=await chromium.launch({headless:true,executablePath,args:['--no-sandbox','--enable-webgl','--ignore-gpu-blocklist','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const page=await browser.newPage({viewport:{width:1280,height:800}});
  page.on('pageerror',e=>errors.push(String(e)));
  const cdp=await page.context().newCDPSession(page);
  const held=new Set();
  const key=async(code,on)=>{
    if(held.has(code)===on)return;
    await cdp.send('Input.dispatchKeyEvent',{type:on?'keyDown':'keyUp',code,key:code.slice(3).toLowerCase(),windowsVirtualKeyCode:code.charCodeAt(3)});
    if(on)held.add(code);else held.delete(code);
  };
  for(phase of ['before','after'])for(const scenario of [
    {id:'911-power',map:'riviera',s:1577,kmh:60,frames:96,powerAt:30},
    {id:'penteli-first',map:'penteli',s:1106,kmh:60,frames:60,powerAt:0},
    {id:'penteli-worst-fast',map:'penteli',s:5748,kmh:60,frames:60,powerAt:0},
    {id:'penteli-worst-slow',map:'penteli',s:5739,kmh:12,frames:180,powerAt:999},
  ]) {
    await page.goto(`http://127.0.0.1:${port}/?car=carrera&map=${scenario.map}&simhook&debug&quality=low&notraffic&fixeddt&s=${scenario.s}`,{waitUntil:'domcontentloaded',timeout:60000});
    await page.waitForFunction(()=>!!window.__sim?.step&&!!window.__vehicle?.()&&window.__game.state==='race',null,{timeout:150000});
    await page.evaluate(()=>{
      window.__proofRafs=[];window.requestAnimationFrame=cb=>{window.__proofRafs.push(cb);return 0;};window.__game.state='paused';
    });
    await page.waitForTimeout(100);
    const setup=await page.evaluate(({s,kmh})=>{
      const {route,keys,G}=window.__sim,v=window.__vehicle(); keys.clear();G.state='paused';G.inputDevice='keyboard';
      const u=route.laneU(s,0);v.reset(s,u,kmh/3.6);v.manual=true;v.gear=2;
      for(let i=0;i<90;i++){v.update(1/60,{throttle:.2,brake:0,steer:0});v.vLong=kmh/3.6;}
      v.reset(s,u,kmh/3.6);v.manual=true;v.gear=2;v.rpm=Math.max(v.spec.idle,kmh/3.6/v.spec.wheelR*v.ratio()*30/Math.PI);
      const side=Math.sign(route.curv(s+9))||Math.sign(route.curv(s));
      return {car:v.spec.id,side,assist:v.steerAssist,gear:v.gear};
    },scenario);
    const steerKey=setup.side>0?'KeyD':'KeyA';
    await key(steerKey,true);
    const trace=[];
    for(let i=0;i<scenario.frames;i++) {
      if(i===scenario.powerAt)await key('KeyW',true);
      const t=await page.evaluate(()=>{
        const sim=window.__sim,v=window.__vehicle();sim.G.state='race';sim.step(1,1/60);sim.G.state='paused';
        return {kmh:v.speed*3.6,steerInput:sim.input.steer,throttle:sim.input.throttle,yawRate:v.w,betaDeg:Math.atan2(v.vLat,v.vLong)*180/Math.PI,
          x:v.x,z:v.z,s:v.s,u:v.u,tc:v.tcCut,esc:v.escCut,latch:v.driftLatch,rearSlip:v.wheel[1].sN,offroad:v.offroad,wallHit:v.wallHit,
          wheelSurf:v.wheelSurf.slice(),wheelBump:v.wheelBump.slice(),travel:v.sus.d.slice(),gravity:v.contactFrame.effectiveGravity,grade:v.contactFrame.grade,bank:v.contactFrame.bank};
      });
      trace.push({t:(i+1)/60,...t});
    }
    for(const code of [...held])await key(code,false);
    await page.evaluate(()=>{window.__sim.G.state='race';window.__sim.render();window.__sim.G.state='paused';});
    const label=phase+'-'+scenario.id;
    await page.screenshot({path:resolve(out,label+'.png')});
    runs.push({label,phase,scenario,...setup,trace});
    await writeFile(resolve(out,label+'.json'),JSON.stringify(runs.at(-1),null,2)+'\n');
    if(trace.some(t=>!Number.isFinite(t.yawRate)))throw new Error(label+': nonfinite dynamics');
    console.log(`${label}: max beta ${Math.max(...trace.map(t=>Math.abs(t.betaDeg))).toFixed(2)}°, s ${trace.at(-1).s.toFixed(1)}, u ${trace.at(-1).u.toFixed(2)}, offroad frames ${trace.filter(t=>t.offroad).length}`);
  }
  if(errors.length)throw new Error(errors.join('\n'));
} finally {
  await writeFile(resolve(out,'browser.json'),JSON.stringify({port,errors,runs},null,2)+'\n');
  await browser?.close();await new Promise(r=>server.close(r));
}
