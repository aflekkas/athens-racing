// One browser-slot job, trusted keyboard and the production player/ground graph.
// FEEL_OUT / BEFORE_PHYS: absolute evidence paths. Two map boots; each chassis
// replay loads the selected real physics module and uses the normal player step.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { WebSocketServer } from 'ws';
const root = resolve(import.meta.dirname, '../..');
const out = resolve(process.env.FEEL_OUT || '.scratch/power-corner-browser');
await mkdir(out, { recursive: true });
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE || '/tmp/pw/node_modules/playwright/index.mjs'));
const mime = { '.html':'text/html', '.js':'text/javascript', '.json':'application/json', '.css':'text/css', '.svg':'image/svg+xml', '.png':'image/png' };
const server = createServer(async (req,res) => {
  try {
    const url = new URL(req.url, 'http://localhost'), pathname = decodeURIComponent(url.pathname);
    let file = resolve(root, '.' + pathname);
    if (!file.startsWith(root + sep) && file !== root) throw new Error('outside root');
    if ((await stat(file)).isDirectory()) file = resolve(file, 'index.html');
    if (pathname === '/src/physics.js' && url.searchParams.get('proof') === 'before') file = process.env.BEFORE_PHYS;
    res.writeHead(200, {'Content-Type':mime[extname(file)] || 'application/octet-stream','Cache-Control':'no-store'});
    res.end(await readFile(file));
  } catch { res.writeHead(404);res.end('Not found'); }
});
// The production client opens /ws even in solo. A static server without an
// upgrade handler triggers reconnect clears and invalidates held-key proofs.
// Keep a local heartbeat socket open; there are no lobbies or remote drivers.
const sockets = new WebSocketServer({ server, path: '/ws' });
sockets.on('connection', socket => socket.on('message', bytes => {
  try { const m = JSON.parse(String(bytes)); if (m.type === 'ping') socket.send(JSON.stringify({ type: 'pong', sent: m.sent, now: Date.now() })); } catch {}
}));
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const port=server.address().port, errors=[], runs=[];
const hash = file => readFile(file).then(bytes => createHash('sha256').update(bytes).digest('hex'));
const sources = { commit: process.env.FEEL_COMMIT || null, physics: await hash(resolve(root,'src/physics.js')), beforePhysics: await hash(process.env.BEFORE_PHYS), input: await hash(resolve(root,'src/input.js')), controller: await hash(resolve(root,'src/rival-ai.js')) };
console.log(`proof server ${port}, PID ${process.pid}`);
let browser;
try {
  const executablePath=process.env.CHROME_PATH || (existsSync(chromium.executablePath()) ? undefined : '/home/dev/.t3/tools/chrome-headless-shell/linux64/154.0.8037.92/chrome-headless-shell');
  browser=await chromium.launch({headless:true,executablePath,args:['--no-sandbox','--enable-webgl','--ignore-gpu-blocklist','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const page=await browser.newPage({viewport:{width:1280,height:800}});
  page.on('pageerror',e=>{errors.push(String(e));console.log('page error',String(e));});
  const cdp=await page.context().newCDPSession(page);
  await cdp.send('Emulation.setFocusEmulationEnabled',{enabled:true});
  const held=new Set();
  const key=async(code,on)=>{
    if(held.has(code)===on)return;
    await cdp.send('Input.dispatchKeyEvent',{type:on?'keyDown':'keyUp',code,key:code.slice(3).toLowerCase(),windowsVirtualKeyCode:code.charCodeAt(3)});
    if(on)held.add(code);else held.delete(code);
  };
  for(const map of ['riviera','penteli']) {
    const event=map==='riviera'?'tt-riviera':'penteli-tt';
    await page.goto(`http://127.0.0.1:${port}/?car=carrera&map=${map}&event=${event}&simhook&debug&quality=low&notraffic&fixeddt&view=5,6,10,2`,{waitUntil:'domcontentloaded',timeout:60000});
    try { await page.waitForFunction(()=>!!window.__sim?.step&&!!window.__vehicle?.()&&window.__game.state==='race',null,{timeout:150000}); }
    catch(error) { await page.screenshot({path:resolve(out,map+'-boot-failure.png')});throw error; }
    console.log(map+' booted');
    await page.bringToFront();
    await page.evaluate(async()=>{
      window.__proofRafs=[];window.requestAnimationFrame=cb=>{window.__proofRafs.push(cb);return 0;};
      window.__proofEvents=[];
      for(const type of ['keydown','keyup','blur','visibilitychange'])window.addEventListener(type,e=>window.__proofEvents.push({type,code:e.code,trusted:e.isTrusted,hidden:document.hidden,state:window.__game.state}),true);
      const {Input}=await import('/src/input.js');const clear=Input.prototype.clear;
      Input.prototype.clear=function(){window.__proofEvents.push({type:'clear',stack:new Error().stack,state:window.__game.state});return clear.call(this);};
    });
    // Wait until the previously queued native frame has finished and its next
    // callback was trapped. Leaving state=race avoids pause-side input clears.
    await page.waitForFunction(()=>window.__proofRafs.length>0,null,{timeout:30000});
    for(const phase of ['before','after'])for(const scenario of (map==='riviera' ? [
      {id:'911-power',s:1577,kmh:60,frames:96,powerAt:30},
    ] : [
      {id:'penteli-first',s:1106,kmh:60,frames:60,powerAt:0},
      {id:'penteli-worst-fast',s:5748,kmh:60,frames:60,powerAt:0},
      {id:'penteli-worst-slow',s:5739,kmh:12,frames:180,powerAt:999},
    ])) {
      for(const code of [...held])await key(code,false);
      const setup=await page.evaluate(async({s,kmh,phase})=>{
        const sim=window.__sim,{route,G}=sim;
        const {Vehicle}=await import('/src/physics.js?proof='+phase);
        const v=new Vehicle(sim.player.veh.spec,route);v.ground=sim.ground;v.steerAssist=1;
        // Reset the real Input object's pedal/steering ramps between replays,
        // using the game's normal pause action (which calls controls.clear).
        window.__flow.pause();
        sim.player.veh=v;G.state='race';G.inputDevice='keyboard';G.paused=null;
        window.__flow.menu.hide();sim.keys.clear();window.__proofEvents.length=0;
        const u=route.laneU(s,0);v.reset(s,u,kmh/3.6);v.manual=true;v.gear=2;
        for(let i=0;i<90;i++){v.update(1/60,{throttle:.2,brake:0,steer:0});v.vLong=kmh/3.6;}
        v.reset(s,u,kmh/3.6);v.manual=true;v.gear=2;v.rpm=Math.max(v.spec.idle,kmh/3.6/v.spec.wheelR*v.ratio()*30/Math.PI);
        const side=Math.sign(route.curv(s+9))||Math.sign(route.curv(s));
        return {car:v.spec.id,side,assist:v.steerAssist,gear:v.gear,hidden:document.hidden,inMenu:window.__flow.inMenu()};
      },{...scenario,phase});
      console.log(`${phase}-${scenario.id} setup ${JSON.stringify(setup)}`);
      const steerKey=setup.side>0?'KeyD':'KeyA';await key(steerKey,true);
      const trace=[];
      for(let i=0;i<scenario.frames;i++) {
        if(i===scenario.powerAt)await key('KeyW',true);
        const t=await page.evaluate(()=>{
          const sim=window.__sim,v=window.__vehicle();sim.step(1,1/60);
          return {kmh:v.speed*3.6,steerInput:sim.input.steer,throttle:sim.input.throttle,yawRate:v.w,betaDeg:Math.atan2(v.vLat,v.vLong)*180/Math.PI,
            x:v.x,z:v.z,s:v.s,u:v.u,tc:v.tcCut,esc:v.escCut,latch:v.driftLatch,rearSlip:v.wheel[1].sN,offroad:v.offroad,wallHit:v.wallHit,
            wheelSurf:v.wheelSurf.slice(),wheelBump:v.wheelBump.slice(),travel:v.sus.d.slice(),gravity:v.contactFrame.effectiveGravity,grade:v.contactFrame.grade,bank:v.contactFrame.bank,
            keys:[...sim.keys],hidden:document.hidden,inMenu:window.__flow.inMenu(),ctxLost:sim.G.ctxLost,state:sim.G.state};
        });
        trace.push({t:(i+1)/60,...t});
      }
      for(const code of [...held])await key(code,false);
      await page.evaluate(()=>window.__sim.render());
      const label=phase+'-'+scenario.id;
      if (Math.abs(trace[0].steerInput) > 0.12 || (scenario.powerAt > 0 && trace[0].throttle !== 0)) throw new Error(label+': previous input ramp leaked into replay');
      await page.screenshot({path:resolve(out,label+'.png')});
      const events=await page.evaluate(()=>window.__proofEvents);
      runs.push({label,phase,map,scenario,...setup,trace,events});
      await writeFile(resolve(out,label+'.json'),JSON.stringify(runs.at(-1),null,2)+'\n');
      await writeFile(resolve(out,'browser.json'),JSON.stringify({port,sources,errors,runs},null,2)+'\n');
      if(events.some(e=>e.type==='clear'))throw new Error(label+': driving input cleared during replay');
      if(trace.some(t=>!Number.isFinite(t.yawRate)))throw new Error(label+': nonfinite dynamics');
      if(Math.max(...trace.map(t=>Math.abs(t.steerInput)))<.99 || trace.slice(20).some(t=>!t.keys.includes(steerKey)))throw new Error(label+': held trusted steering did not reach the player');
      if(scenario.powerAt<scenario.frames&&Math.max(...trace.map(t=>t.throttle))<.99)throw new Error(label+': W did not reach the player');
      console.log(`${label}: max beta ${Math.max(...trace.map(t=>Math.abs(t.betaDeg))).toFixed(2)}°, s ${trace.at(-1).s.toFixed(1)}, u ${trace.at(-1).u.toFixed(2)}, offroad frames ${trace.filter(t=>t.offroad).length}`);
    }
  }
  if(errors.length)throw new Error(errors.join('\n'));
} finally {
  await writeFile(resolve(out,'browser.json'),JSON.stringify({port,sources,errors,runs},null,2)+'\n');
  await browser?.close();for (const socket of sockets.clients) socket.terminate();await new Promise(r=>sockets.close(r));await new Promise(r=>server.close(r));
}
