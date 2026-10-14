import test from 'node:test';
import assert from 'node:assert/strict';
import {Menu} from '../src/menu.js';
import {settings,onSettings} from '../src/settings.js';
import {resolveGraphics,PRESETS} from '../src/graphics.js';

const change=(menu,key,value)=>menu.onChange({key,value,el:{dataset:{scope:'setting'}}});
test('Graphics menu writes preset, lighting, effects and a fixed resolution independently without the legacy reload control',()=>{
 const before={graphics:settings.graphics,lighting:settings.lighting,effects:settings.effects,renderScale:settings.renderScale,drawDistance:settings.drawDistance};
 let reloaded=0;const changes=[],unsubscribe=onSettings((_,key)=>changes.push(key));
 const menu=Object.assign(Object.create(Menu.prototype),{h:{graphicsControl:{disabled:true,value:'high',onchange(){reloaded++;}}}});
 try{
  change(menu,'graphics','potato');change(menu,'renderScale','0.75');change(menu,'lighting','high');change(menu,'drawDistance','300');
  assert.equal(settings.graphics,'potato');assert.equal(settings.renderScale,.75);assert.equal(settings.lighting,'high');assert.equal(settings.drawDistance,300);assert.equal(menu.h.graphicsControl.value,'potato');assert.equal(reloaded,0);
  let g=resolveGraphics(settings,{deviceRatio:1});assert.equal(g.lighting,'high');assert.equal(g.effects,'off');assert.equal(g.pixelRatio,.75);assert.equal(g.drawDistance,300);
  change(menu,'graphics','high');assert.equal(settings.renderScale,.75);assert.equal(settings.lighting,'high');
  change(menu,'renderScale','auto');change(menu,'lighting','preset');change(menu,'drawDistance','auto');
  g=resolveGraphics(settings,{deviceRatio:2});assert.equal(g.pixelRatio,PRESETS.high.pixelRatio);assert.equal(g.lighting,'high');assert.ok(changes.includes('renderScale'));
 }finally{unsubscribe();for(const[key,value]of Object.entries(before))change(menu,key,value);}
});
test('Graphics tab lists five presets, lighting and effects levels, and no adaptive or automatic modes',()=>{
 const menu=Object.assign(Object.create(Menu.prototype),{h:{graphicsControl:{disabled:true}}});
 const html=menu.r_settings({tab:'video',from:'pause'});
 for(const key of ['graphics','lighting','effects','renderScale','drawDistance','frameCap'])assert.match(html,new RegExp('data-key="'+key+'"'));
 for(const label of ['POTATO','LOW','MEDIUM','HIGH','ULTRA'])assert.match(html,new RegExp('>'+label+'<'));
 assert.match(html,/APPLIES LIVE/);assert.doesNotMatch(html,/LOCKED WHILE ONLINE|RELOADS THE GAME|ADAPTIVE|PIXEL RATIO CAP/);
 assert.match(html,/50%/);assert.match(html,/100%/);
});
test('Potato is genuinely minimal and presets never resolve to automatic behaviour',()=>{
 const p=resolveGraphics({graphics:'potato',lighting:'preset',effects:'preset',renderScale:'auto',drawDistance:'auto'},{deviceRatio:2});
 assert.equal(p.L.shadow,null);assert.equal(p.L.probeEvery,0);assert.equal(p.E.ao,0);assert.equal(p.E.bloomMips,0);assert.equal(p.E.msaa,0);assert.equal(p.E.mirrorEvery,0);assert.equal(p.E.waterEvery,0);
 assert.ok(p.pixelRatio<=.6);assert.ok(p.drawDistance<=500);
 const legacy=resolveGraphics({graphics:'auto',renderScale:'auto'},{deviceRatio:1,gpuName:'SwiftShader'});assert.equal(legacy.preset,'low');
});
