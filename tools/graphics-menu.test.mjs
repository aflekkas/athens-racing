import test from 'node:test';
import assert from 'node:assert/strict';
import {Menu} from '../src/menu.js';
import {settings,onSettings} from '../src/settings.js';

const change=(menu,key,value)=>menu.onChange({key,value,el:{dataset:{scope:'setting'}}});
test('Graphics menu writes quality and numeric resolution independently without invoking the legacy reload control',()=>{
 const before={graphics:settings.graphics,renderScale:settings.renderScale,pixelRatioCap:settings.pixelRatioCap};
 let reloaded=0;const changes=[],unsubscribe=onSettings((_,key)=>changes.push(key));
 const menu=Object.assign(Object.create(Menu.prototype),{h:{graphicsControl:{disabled:true,value:'auto',onchange(){reloaded++;}}}});
 try{
  change(menu,'graphics','low');change(menu,'renderScale','0.75');change(menu,'pixelRatioCap','1.25');
  assert.equal(settings.graphics,'low');assert.equal(settings.renderScale,.75);assert.equal(settings.pixelRatioCap,1.25);assert.equal(menu.h.graphicsControl.value,'low');assert.equal(reloaded,0);
  change(menu,'graphics','high');assert.equal(settings.renderScale,.75);assert.equal(settings.pixelRatioCap,1.25);
  change(menu,'renderScale','auto');assert.equal(settings.renderScale,'auto');assert.equal(settings.graphics,'high');assert.ok(changes.includes('renderScale'));
 }finally{unsubscribe();for(const[key,value]of Object.entries(before))change(menu,key,value);}
});
test('Graphics controls stay usable online and expose separate quality, resolution and DPR cap values',()=>{
 const menu=Object.assign(Object.create(Menu.prototype),{h:{graphicsControl:{disabled:true}}});
 const html=menu.r_settings({tab:'video',from:'pause'});
 for(const key of ['graphics','renderScale','pixelRatioCap'])assert.match(html,new RegExp('data-key="'+key+'"'));
 assert.match(html,/APPLIES LIVE/);assert.doesNotMatch(html,/LOCKED WHILE ONLINE|RELOADS THE GAME/);
 assert.match(html,/AUTO · ADAPTIVE/);assert.match(html,/50%/);assert.match(html,/100%/);
});
