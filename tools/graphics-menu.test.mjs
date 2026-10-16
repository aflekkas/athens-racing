import test from 'node:test';
import assert from 'node:assert/strict';
import {Menu} from '../src/menu.js';
import {settings,onSettings} from '../src/settings.js';
import {resolveGraphics,PERFORMANCE,RENDER} from '../src/graphics.js';

const change=(menu,key,value)=>menu.onChange({key,value,el:{dataset:{scope:'setting'}}});
test('Graphics menu writes resolution and draw distance live; the look never changes',()=>{
 const before={renderScale:settings.renderScale,drawDistance:settings.drawDistance};
 const changes=[],unsubscribe=onSettings((_,key)=>changes.push(key));
 const menu=Object.assign(Object.create(Menu.prototype),{h:{}});
 try{
  change(menu,'renderScale','0.75');change(menu,'drawDistance','300');
  assert.equal(settings.renderScale,.75);assert.equal(settings.drawDistance,300);
  let g=resolveGraphics(settings,{deviceRatio:1});assert.equal(g.pixelRatio,.75);assert.equal(g.drawDistance,300);assert.equal(g.R,RENDER);
  change(menu,'renderScale','auto');change(menu,'drawDistance','auto');
  g=resolveGraphics({...settings,perfClass:'high'},{deviceRatio:2});assert.equal(g.pixelRatio,PERFORMANCE.high.pixelRatio);assert.equal(g.R,RENDER);assert.ok(changes.includes('renderScale'));
 }finally{unsubscribe();for(const[key,value]of Object.entries(before))change(menu,key,value);}
});
test('Graphics tab keeps the performance controls and no adaptive or automatic quality modes',()=>{
 const menu=Object.assign(Object.create(Menu.prototype),{h:{}});
 const html=menu.r_settings({tab:'video',from:'pause'});
 for(const key of ['renderScale','drawDistance','frameCap','mirrors'])assert.match(html,new RegExp('data-key="'+key+'"'));
 assert.doesNotMatch(html,/LOCKED WHILE ONLINE|RELOADS THE GAME|ADAPTIVE|PIXEL RATIO CAP/);
 assert.match(html,/50%/);assert.match(html,/100%/);
});
test('the weakest performance class only lowers resolution and draw ranges',()=>{
 const p=resolveGraphics({perfClass:'potato',renderScale:'auto',drawDistance:'auto'},{deviceRatio:2});
 assert.ok(p.pixelRatio<=.6);assert.ok(p.drawDistance<=500);assert.equal(p.R,RENDER);
 assert.equal(resolveGraphics({perfClass:'auto',renderScale:'auto'},{deviceRatio:1,gpuName:'SwiftShader'}).perfClass,'low');
});

test('Dynamic resolution is on by default, persisted and controllable independently of the ceiling',()=>{
 const menu=Object.assign(Object.create(Menu.prototype),{h:{}});
 assert.match(menu.r_settings({tab:'video'}),/data-key="dynamicResolution"/);
 const before=settings.dynamicResolution;
 try{change(menu,'dynamicResolution',false);assert.equal(settings.dynamicResolution,false);change(menu,'dynamicResolution',true);assert.equal(settings.dynamicResolution,true);}
 finally{change(menu,'dynamicResolution',before);}
});
