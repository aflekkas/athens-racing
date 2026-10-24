// Review-only draft. Copy to tools/desktop-ci/windows-lifecycle.mjs in candidate9.
import assert from 'node:assert/strict';
import { _electron } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const mode = process.argv[2];
assert.ok(['write','read'].includes(mode));
const profile = resolve(process.env.DESKTOP_LIFECYCLE_PROFILE);
const evidence = resolve(process.env.DESKTOP_EVIDENCE);
const cwd = resolve(process.env.RUNNER_TEMP, 'athens-lifecycle-launch');
await mkdir(cwd,{recursive:true}); await mkdir(evidence,{recursive:true});
const env={...process.env,ASR_DESKTOP_PORT:'17849'};
for(const key of ['ASR_DESKTOP_USER_DATA','ASR_GAME_ROOT','NODE_OPTIONS','NODE_PATH','ELECTRON_RUN_AS_NODE'])delete env[key];
let app;
try {
 app=await _electron.launch({executablePath:process.env.DESKTOP_EXECUTABLE,args:['--mute-audio'],cwd,env,timeout:60000});
 await app.evaluate(({app,BrowserWindow})=>{app.focus({steal:true});for(const w of BrowserWindow.getAllWindows()){w.show();w.focus();w.webContents.setAudioMuted(true);w.webContents.on('dom-ready',()=>w.webContents.setAudioMuted(true));}});
 const page=await app.firstWindow();
 await page.waitForFunction(()=>window.athensDesktop&&document.body.classList.contains('loaded'),null,{timeout:120000});
 const metadata=await app.evaluate(({app,BrowserWindow})=>({name:app.getName(),version:app.getVersion(),packaged:app.isPackaged,profile:app.getPath('userData'),muted:BrowserWindow.getAllWindows()[0].webContents.isAudioMuted(),platform:process.platform}));
 assert.equal(metadata.name,'Athens Racing');assert.equal(metadata.packaged,true);assert.equal(metadata.platform,'win32');assert.equal(metadata.muted,true);assert.equal(resolve(metadata.profile),profile);
 if(mode==='write')await page.evaluate(()=>localStorage.setItem('native-uninstall-retention','candidate8-retained'));
 else assert.equal(await page.evaluate(()=>localStorage.getItem('native-uninstall-retention')),'candidate8-retained');
 const graphics=await page.evaluate(()=>{const canvas=document.getElementById('c');const gl=canvas?.getContext('webgl2')||canvas?.getContext('webgl');const ext=gl?.getExtension('WEBGL_debug_renderer_info');return {vendor:ext?gl.getParameter(ext.UNMASKED_VENDOR_WEBGL):null,renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):null};});
 await page.screenshot({path:resolve(evidence,'lifecycle-'+mode+'.jpg'),type:'jpeg',quality:85});
 await writeFile(resolve(evidence,'lifecycle-'+mode+'.json'),JSON.stringify({passed:true,mode,...metadata,graphics},null,2));
} finally {await app?.close();}
