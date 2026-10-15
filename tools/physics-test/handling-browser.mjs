// Real WebGL/ground/input smoke proof. Run through tools/browser-slot.sh.
// node tools/physics-test/handling-browser.mjs [before|after]
// Before serves captured physics-before.js at the normal module URL from the
// artifact folder. PLAYWRIGHT_MODULE / CHROME_PATH may select local tooling.
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const out = resolve(root, '.scratch/handling');
const phase = process.argv[2] || 'after';
const mapId = 'megara';
const carIds = ['huracan'];
if (!['before', 'after'].includes(phase)) throw new Error('Expected before or after');
await mkdir(out, { recursive: true });
let playwright;
for (const name of [process.env.PLAYWRIGHT_MODULE, 'playwright', '/tmp/pw/node_modules/playwright/index.mjs'].filter(Boolean)) {
  try { playwright = await import(name.startsWith('/') ? pathToFileURL(name).href : name); break; } catch {}
}
if (!playwright) throw new Error('Set PLAYWRIGHT_MODULE to an installed Playwright index.mjs');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.wav': 'audio/wav' };
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    let file = resolve(root, '.' + pathname);
    if (!file.startsWith(root + sep) && file !== root) throw new Error('Outside repository');
    if ((await stat(file)).isDirectory()) file = resolve(file, 'index.html');
    if (phase === 'before' && pathname === '/src/physics.js') file = resolve(out, pathname.slice(5, -3) + '-before.js');
    let bytes = await readFile(file);
    res.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(bytes);
  } catch { res.writeHead(404); res.end('Not found'); }
});
const sockets = new WebSocketServer({server, path:'/ws'});
sockets.on('connection', socket => socket.on('message', bytes => {try {const m=JSON.parse(String(bytes));if(m.type==='ping')socket.send(JSON.stringify({type:'pong',sent:m.sent,now:Date.now()}));}catch{}}));
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
console.log(`Handling ${phase}: private server on ${port}`);
let browser;
const errors = [], runs = [];
const audit = JSON.parse(await readFile(resolve(out, phase + '.json'), 'utf8'));
const entry = audit.rows.find(r => r.id === 'huracan').transients[0].trace[0].s;
try {
  const executablePath = process.env.CHROME_PATH || (existsSync(playwright.chromium.executablePath()) ? undefined : '/home/dev/.t3/tools/chrome-headless-shell/linux64/154.0.8037.92/chrome-headless-shell');
  browser = await playwright.chromium.launch({ headless: true, executablePath, args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 800, height: 450 }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(120000);
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') console.log('Browser console:', m.text()); });
  page.on('requestfailed', r => { if (!r.url().includes('/ws')) console.log('Request failed:', r.url(), r.failure()?.errorText); });
  const cdp = await page.context().newCDPSession(page);
  for (const car of carIds) {
    const entryS = entry;
    const response = await page.goto(`http://127.0.0.1:${port}/?car=${car}&map=${mapId}&cam=chase&simhook&debug&quality=low&notraffic&fixeddt&s=${entryS}${mapId === 'megara' ? '&event=megara-tt' : ''}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    if (response.status() !== 200) throw new Error(`Game page returned HTTP ${response.status()}`);
    try {
      await page.waitForFunction(() => !!window.__sim?.step && !!window.__vehicle?.() && window.__game.state === 'race', null, { timeout: 120000 });
    } catch (error) {
      console.log('Boot state', await page.evaluate(() => ({ game: window.__game?.state, sim: !!window.__sim, car: window.__vehicle?.()?.spec.id, text: document.body.innerText.slice(0, 1000) })));
      await page.screenshot({ path: resolve(out, `${phase}-boot-failure.png`) });
      throw error;
    }
    // Pause simulation after boot; retain native rendering so the compositor
    // can capture frame strips. Simhook advances normal player updates at 60 Hz.
    await page.evaluate(() => {
      window.__game.state = 'paused';
    });
    await page.bringToFront();
    await page.waitForTimeout(250);
    console.log(`${phase}-${car}: boot complete`);
    for (const powered of [false]) {
      console.log('starting rolling setup');
      const setup = await page.evaluate(({ entryS }) => {
        const { route, keys, G } = window.__sim, v = window.__vehicle();
        keys.clear(); G.state = 'paused'; G.inputDevice = 'keyboard';
        const s = entryS, u = route.closed ? 0 : route.laneU(s, 0), side = Math.sign(route.curv(s));
        v.reset(s, u, 60 / 3.6);
        // A rolling car in a road gear, with settled tyres and engine.
        for (let i = 0; i < 90; i++) { v.update(1 / 60, { throttle: 0.2, brake: 0, steer: 0 }); v.vLong = 60 / 3.6; }
        const gear = v.gear;
        v.reset(s, u, 60 / 3.6); v.gear = gear;
        v.rpm = Math.max(v.spec.idle, 60 / 3.6 / v.spec.wheelR * v.ratio() * 30 / Math.PI);
        return { side, car: v.spec.id, assist: v.steerAssist, cornerRadius: 1 / Math.abs(route.curv(s)), gear };
      }, { entryS });
      console.log('rolling setup complete', setup);
      if (setup.car !== car) throw new Error(`Wrong car: expected ${car}, got ${setup.car}`);
      const code = setup.side > 0 ? 'KeyD' : 'KeyA', key = setup.side > 0 ? 'd' : 'a';
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: setup.side > 0 ? 68 : 65 });
      if (powered) await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'w', code: 'KeyW', windowsVirtualKeyCode: 87 });
      const trace = [];
      for (let strip = 0; strip < 4; strip++) {
      console.log('stepping strip',strip);
      trace.push(...await page.evaluate(() => {
        const sim = window.__sim, v = window.__vehicle(), trace = [];
        sim.G.state = 'race';
        // 0.8 s turns through ~15–20 degrees of the real corner, before a
        // sustained full-lock circle would necessarily leave its asphalt.
        for (let i = 0; i < 12; i++) {
          sim.step(1, 1 / 60);
          trace.push({ t: (i + 1) / 60, steerInput: sim.input.steer, throttle: sim.input.throttle,
            rackDeg: v.steer * 180 / Math.PI, kmh: v.speed * 3.6, yawRate: v.w,
            effectiveRackDeg: Math.atan2(v._S[0].s, v._S[0].c) * 180 / Math.PI,
            peakSlipDeg: v.aPk * 180 / Math.PI, betaDeg: Math.atan2(v.vLat, v.vLong) * 180 / Math.PI, driftLatch: v.driftLatch,
            lateralG: Math.abs(v.ayRaw) / 9.81, frontDeg: v.slipF * 180 / Math.PI, rearDeg: v.slipR * 180 / Math.PI,
            tcCut: v.tcCut, escCut: v.escCut, offroad: v.offroad, wallHit: v.wallHit,
            x: v.x, z: v.z, s: v.s, u: v.u, assist: v.steerAssist });
        }
        sim.G.state = 'paused';
        return trace;
      }));
      await page.waitForTimeout(100);
      console.log('rendered strip',strip);
      // Read the actual WebGL frame immediately after drawing; avoids a
      // headless compositor stall while preserving chase-camera scene pixels.
      const pixels=await page.evaluate(() => { const sim=window.__sim;sim.render();return sim.canvas.toDataURL('image/png'); });
      await writeFile(resolve(out,`${phase}-huracan-chase-${strip}.png`),Buffer.from(pixels.split(',')[1],'base64'));
      console.log('captured strip',strip);
      }
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: setup.side > 0 ? 68 : 65 });
      if (powered) await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'w', code: 'KeyW', windowsVirtualKeyCode: 87 });
      await page.waitForTimeout(100);
      trace.forEach((row,index) => { row.t = (index + 1) / 60; });
      const label = `${phase}-${car}-${powered ? 'power' : 'coast'}`;
      // Frame strips above are the visual evidence.
      const run = { label, map: mapId, entryS, ...setup, powered, trace };
      runs.push(run);
      await writeFile(resolve(out, label + '.json'), JSON.stringify(run, null, 2) + '\n');
      if (trace.some(r => !Number.isFinite(r.yawRate) || r.offroad || r.wallHit > 1)) throw new Error(`${label}: invalid drive / left asphalt / hit barrier`);
      if (trace.at(-1).assist !== 1 || Math.abs(trace.at(-1).steerInput) !== 1) throw new Error(`${label}: default full keyboard input did not reach physics`);
      console.log(`${label}: 150 ms ${trace[8].lateralG.toFixed(3)} g, 250 ms ${trace[14].lateralG.toFixed(3)} g, peak ${Math.max(...trace.map(r => r.lateralG)).toFixed(3)} g, u ${trace.at(-1).u.toFixed(2)}`);
    }
  }
  // Full-lap CPU stepping in the browser uses production Ground and barriers.
  const laps = await page.evaluate(async () => {
    const {Vehicle}=await import('/src/physics.js');
    const {CARS}=await import('/src/cars.js');
    const {RivalAI}=await import('/src/rival-ai.js');
    const {Input}=await import('/src/input.js');
    const sim=window.__sim, results=[];
    for(const device of ['keyboard','gamepad']) {
      const v=new Vehicle(CARS.find(c=>c.id==='huracan'),sim.route);
      v.ground=sim.ground;v.steerAssist=device==='keyboard'?1:.35;
      v.reset(sim.route.start,0,0);
      const ai=new RivalAI(sim.route,v,{perfect:true,closedRoad:true});
      const input=new Input({target:null,navigator:null,document:null,storage:null});
      let progress=0,prev=v.s,offroad=0,wall=0;const trace=[];
      for(let i=0;i<60*180;i++){
        const command=ai.update(1/60);
        if(device==='keyboard'){
          const error=command.steer-input.state.steer;
          input.keys.delete('KeyA');input.keys.delete('KeyD');
          if(Math.abs(error)>.075)input.keys.add(error>0?'KeyD':'KeyA');
          input.update(1/60,{speed:v.speed});command.steer=input.state.steer;
        }
        v.update(1/60,command);
        let d=v.s-prev;if(d<-sim.route.length/2)d+=sim.route.length;if(d>sim.route.length/2)d-=sim.route.length;
        progress+=d;prev=v.s;offroad+=v.offroad?1:0;wall+=v.wallHit>0?1:0;
        trace.push({s:v.s,kmh:v.kmh,u:v.u});
        if(progress>=sim.route.length)break;
      }
      input.destroy();results.push({device,time:trace.length/60,finished:progress>=sim.route.length,offroadFrames:offroad,wallFrames:wall,trace});
    }
    return results;
  });
  await writeFile(resolve(out,`laps-ground-${phase}.json`),JSON.stringify({method:'production Vehicle/Ground and RivalAI pedals/line; keyboard binary steering error controller through real Input; gamepad continuous .35 assist; ground and barriers enabled',laps},null,2));
  console.log('production-ground laps',laps.map(({trace,...r})=>r));
  if (errors.length) throw new Error(errors.join('\n'));
} finally {
  await writeFile(resolve(out, `browser-${phase}.json`), JSON.stringify({ phase, port, errors, runs }, null, 2) + '\n');
  await browser?.close();
  await new Promise(r => server.close(r));
}
