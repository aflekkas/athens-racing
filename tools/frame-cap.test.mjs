import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dynamicBudgetMs } from '../src/frame-pacing.js';
const memory = (seed = {}) => ({ values: new Map(Object.entries(seed)), getItem(key) { return this.values.get(key) ?? null; }, setItem(key, value) { this.values.set(key, value); }, removeItem(key) { this.values.delete(key); } });
let serial = 0;
async function preferences(storage) { globalThis.localStorage = storage; return import('../src/settings.js?frame-cap=' + serial++); }

test('new and every legacy saved frame cap become uncapped without changing other preferences',async()=>{
 for(const saved of [undefined,0,30,60,120,'30','60','120',null,'unlimited',false,true,'garbage',-1,240]){
  const storage=memory({'paraliaki.settings':JSON.stringify({...(saved===undefined?{}:{frameCap:saved}),units:'mph',renderScale:.8,perfClass:'high'})});
  const module=await preferences(storage);assert.equal(module.settings.frameCap,0);assert.equal(JSON.parse(storage.getItem('paraliaki.settings')).frameCap,0);assert.equal(module.settings.units,'mph');assert.equal(module.settings.renderScale,.8);assert.equal(module.settings.perfClass,'high');
  for(const requested of [30,60,120,0,'garbage']){module.setSetting('frameCap',requested);assert.equal(module.settings.frameCap,0);assert.equal(JSON.parse(storage.getItem('paraliaki.settings')).frameCap,0);}
  assert.equal((await preferences(storage)).settings.frameCap,0);
 }
});

test('uncapping does not change the dynamic-resolution quality threshold or physics slicing',()=>{
 assert.equal(dynamicBudgetMs(),20);for(const legacy of[30,60,120])assert.equal(dynamicBudgetMs(legacy),20);
 const main=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');assert.match(main,/Math\.ceil\(dt \/ \(1 \/ 60\)/);assert.match(main,/step\(dt \/ slices/);
});

test('race and showroom render loops have no software frame-skip gate or render timers',()=>{
 for(const file of['main.js','car-select.js']){
  const source=readFileSync(new URL('../src/'+file,import.meta.url),'utf8');assert.doesNotMatch(source,/FrameLimiter|frameLimiter|showroomCap|limiter\.allow/);
  const timers=[...source.matchAll(/^.*(?:setInterval|setTimeout)\(.*$/gm)].map(m=>m[0].trim());
  if(file==='main.js'){assert.equal(timers.length,1);assert.match(timers[0],/^const onlineBackgroundTimer = setInterval/);}else assert.deepEqual(timers,[]);
 }
});
