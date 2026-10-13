// Real two-browser game smoke test using the same Chrome/CDP setup as tools/cdp.mjs.
// node tools/multiplayer-browser.mjs http://localhost:8000
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const url=process.argv[2] || 'http://localhost:8000';
const chrome=process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const angle=process.env.ANGLE || (process.platform === 'darwin' ? 'metal' : 'swiftshader');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const processes=[];
async function page(name) {
  const port=9500+Math.floor(Math.random()*1000), prof=mkdtempSync(path.join(os.tmpdir(),'mp-cdp-'));
  const proc=spawn(chrome,['--headless=new',`--remote-debugging-port=${port}`,`--user-data-dir=${prof}`,'--mute-audio','--no-first-run','--enable-webgl','--ignore-gpu-blocklist',`--use-angle=${angle}`,'--enable-unsafe-swiftshader','--no-sandbox','--window-size=1280,800','--autoplay-policy=no-user-gesture-required','about:blank'],{stdio:'ignore'});
  processes.push({proc,prof}); let tabs;
  for(let i=0;i<50;i++){try{tabs=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();if(tabs.length)break;}catch{}await sleep(200);}
  const ws=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl); await new Promise(r=>ws.addEventListener('open',r));
  processes.at(-1).ws=ws; let id=0; const pending=new Map(),errors=[];
  ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id){pending.get(m.id)?.(m);pending.delete(m.id);}else if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);else if(m.method==='Runtime.consoleAPICalled'&&m.params.type==='error')errors.push(m.params.args.map(a=>a.value||a.description).join(' '));});
  const send=(method,params={})=>new Promise((resolve,reject)=>{const i=++id;pending.set(i,resolve);ws.send(JSON.stringify({id:i,method,params}));setTimeout(()=>{if(pending.has(i)){pending.delete(i);reject(new Error(`${name}: ${method} timed out`));}},30000).unref();});
  const evaluate=async expression=>{const m=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(m.result?.exceptionDetails)throw new Error(JSON.stringify(m.result.exceptionDetails));return m.result?.result?.value;};
  const wait=async expression=>{const end=Date.now()+90000;while(Date.now()<end){if(await evaluate(expression))return;await sleep(500);}throw new Error(name+' waiting for '+expression);};
  await send('Runtime.enable');await send('Page.enable');await send('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false});await send('Page.navigate',{url});
  return {name,send,evaluate,wait,errors,async shot(file){const m=await send('Page.captureScreenshot',{format:'png'});writeFileSync(file,Buffer.from(m.result.data,'base64'));}};
}
try {
  const a=await page('Alice'); await a.wait('window.__multiplayer?.connected'); console.log('Alice loaded');
  const b=await page('Bob'); await b.wait('window.__multiplayer?.connected'); console.log('Bob loaded');
  await a.evaluate(`document.getElementById('mp-open').click();document.getElementById('mp-name').value='Alice';document.getElementById('mp-lobby-name').value='Browser smoke test';document.getElementById('mp-create').click()`);
  await a.wait('!!window.__multiplayer.room'); const code=await a.evaluate('window.__multiplayer.room.code'); console.log('Created lobby',code);
  await b.evaluate(`document.getElementById('mp-open').click()`); await b.wait(`document.getElementById('mp-lobbies').textContent.includes('Browser smoke test')`);
  await b.evaluate(`document.getElementById('mp-name').value='Bob';document.getElementById('mp-car').value='poseidon';document.getElementById('mp-lobbies').querySelector('button').click()`);
  await b.wait('window.__multiplayer.room?.players.length===2'); await a.wait('window.__multiplayer.room?.players.length===2');
  await a.shot('/tmp/paraliaki-two-player-lobby.png');
  await a.evaluate(`document.getElementById('mp-ready').click()`);await b.evaluate(`document.getElementById('mp-ready').click()`);await a.wait('window.__multiplayer.room.players.every(p=>p.ready)');
  await a.evaluate(`document.getElementById('mp-start').click();document.activeElement.blur()`);await b.evaluate('document.activeElement.blur()');
  await a.wait(`window.__multiplayer.room?.phase==='racing'`);await b.wait(`window.__multiplayer.room?.phase==='racing'`);
  const aRace=await a.evaluate('window.__multiplayer.room.raceId'),bRace=await b.evaluate('window.__multiplayer.room.raceId');assert.equal(aRace,bRace);
  await a.send('Input.dispatchKeyEvent',{type:'keyDown',code:'KeyW',key:'w',windowsVirtualKeyCode:87});await b.send('Input.dispatchKeyEvent',{type:'keyDown',code:'KeyW',key:'w',windowsVirtualKeyCode:87});await sleep(6000);
  await a.send('Input.dispatchKeyEvent',{type:'keyUp',code:'KeyW',key:'w',windowsVirtualKeyCode:87});await b.send('Input.dispatchKeyEvent',{type:'keyUp',code:'KeyW',key:'w',windowsVirtualKeyCode:87});
  for(const p of [a,b]){
    const result=await p.evaluate(`({game:__dbg(),room:__multiplayer.room.players.map(p=>({name:p.name,s:p.state?.s,car:p.car})),clock:__game.raceT,error:document.getElementById('err').textContent})`);console.log(p.name,JSON.stringify(result));
    assert.ok(result.game.kmh>10,'car accelerates');assert.ok(result.room.every(p=>p.s>819),'both positions arrive');assert.equal(result.error,'');assert.deepEqual(p.errors,[]);
  }
  await a.shot('/tmp/paraliaki-online-race.png');
  await b.evaluate(`__multiplayer.send({type:'leave'})`);await b.wait('!__multiplayer.room');await a.wait('!!__multiplayer.room.players.find(p=>p.name===\'Bob\')?.dnf');
  await a.evaluate(`__multiplayer.send({type:'leave'})`);await a.wait('!__multiplayer.room');
  console.log('PASS: discovery, join, ready, shared start, two live cars, state relay, departure, solo return; no game errors.');
} finally { for(const {proc,prof,ws} of processes){ws?.close();proc.kill('SIGKILL');rmSync(prof,{recursive:true,force:true});} }
