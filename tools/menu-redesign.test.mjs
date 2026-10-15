import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { environmentBadge } from '../src/build-environment.js';

test('only an explicit production identity removes the environment badge', () => {
  assert.equal(environmentBadge('production', '2026.10.15.1'), '');
  for (const id of ['staging', 'preview-abc', 'test']) assert.equal(environmentBadge(id, '2026.10.15.1'), 'STAGING · 2026.10.15.1');
  assert.equal(environmentBadge(undefined), 'DEV');
  assert.equal(environmentBadge('dev', 'local'), 'DEV');
});
test('Wrangler injects distinct build identities for staging and production', () => {
  const config = JSON.parse(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
  for (const env of ['staging', 'production']) assert.match(config.env[env].build.command, new RegExp(`ASR_BUILD_ENV=${env} `));
});

import { Input } from '../src/input.js';
test('menu keyboard bindings work while the account button has DOM focus', () => {
  const target = new EventTarget();
  const input = new Input({target, navigator: {getGamepads:()=>[]}, document:null});
  input.update(1/60, {inMenu:true});
  try {
    for (const [code,action] of [['ArrowUp','up'],['KeyW','up'],['ArrowDown','down'],['KeyS','down'],['Enter','confirm'],['Space','confirm'],['KeyG','garage']]) {
      const event = new Event('keydown', {cancelable:true});Object.assign(event,{code,repeat:false});
      Object.defineProperty(event,'target',{value:{closest:selector=>selector.includes('.input-bindings')?null:{}}});
      input.keyDown(event);input.update(1/60,{inMenu:true});
      assert.ok(input.actions.includes(action), `${code} routes ${action} from a menu button`);
      input.clear();input.update(1/60,{inMenu:true});
    }
  } finally {input.destroy();}
});
test('D-pad and A continue to emit menu navigation actions', () => {
  const pad={id:'menu-test',index:0,connected:true,axes:[0,0,0,0],buttons:Array.from({length:17},()=>({value:0}))};
  const input=new Input({target:new EventTarget(),navigator:{getGamepads:()=>[pad]},document:null});
  try {
    for (const [index,action] of [[12,'up'],[13,'down'],[0,'confirm']]) {
      pad.buttons[index].value=1;input.update(1/60,{inMenu:true});assert.ok(input.actions.includes(action));
      pad.buttons[index].value=0;input.update(1/60,{inMenu:true});
    }
  } finally {input.destroy();}
});

import { mountTitleHero } from '../src/ui/title-hero.js';
test('title hero waits for two frames and idle; cancelling a stale idle callback never imports the renderer', async () => {
  const keys=['window','requestAnimationFrame','cancelAnimationFrame','requestIdleCallback','cancelIdleCallback'];
  const previous=Object.fromEntries(keys.map(k=>[k,globalThis[k]]));
  let id=0,idleCallback,idleCancelled=false;const frames=[];
  const host={isConnected:true,dataset:{ready:'true'}};
  Object.assign(globalThis,{window:{requestIdleCallback:true},requestAnimationFrame:cb=>{frames.push(cb);return ++id;},cancelAnimationFrame:()=>{},requestIdleCallback:cb=>{idleCallback=cb;return 1;},cancelIdleCallback:()=>{idleCancelled=true;}});
  try {
    const preview=mountTitleHero({querySelector:()=>host},{id:'mini'},'#bd1626');
    assert.equal(frames.length,1);assert.equal(idleCallback,undefined);
    frames.shift()();assert.equal(frames.length,1);assert.equal(idleCallback,undefined);
    frames.shift()();assert.equal(typeof idleCallback,'function');
    preview.dispose();assert.equal(idleCancelled,true);assert.equal(host.dataset.ready,undefined);
    await idleCallback(); // Importing THREE/renderer here would fail in this Node-only test.
  } finally {for(const key of keys)if(previous[key]===undefined)delete globalThis[key];else globalThis[key]=previous[key];}
});

import { mountGarageThumbnails, thumbnailKey } from '../src/ui/garage-thumbnails.js';
function thumbnailFixture(paint, cache = new Map(), extra = {}) {
  const img={dataset:{carThumb:'mini'},isConnected:true,decode:async()=>{}},root={querySelector:()=>null,querySelectorAll:()=>[img]};
  let observe, allocations=0, disposed=0;const paints=[];
  class Observer {constructor(callback){observe=callback;}observe(){}unobserve(){}disconnect(){}}
  const view=mountGarageThumbnails(root,[{id:'mini'}],()=>paint,{Observer,build:'test',read:async key=>cache.get(key),write:async(key,blob)=>cache.set(key,blob),createStudio:async()=>{allocations++;return {canvas:{},setVehicle:(_spec,p)=>paints.push(p),draw:async()=>{},dispose:()=>disposed++};},capture:async()=>new Blob(['car']),...extra});
  return {img,view,paints,get allocations(){return allocations;},get disposed(){return disposed;},enter(){observe([{target:img,isIntersecting:true}]);}};
}
test('garage thumbnails allocate only after intersection and render the saved paint',async()=>{
  const f=thumbnailFixture('#C02624');assert.equal(f.allocations,0);f.enter();await f.view.whenIdle();assert.equal(f.allocations,1);assert.deepEqual(f.paints,['#C02624']);assert.equal(f.img.dataset.thumbReady,'true');assert.equal(f.img.dataset.thumbKey,'test/mini/c02624');f.view.dispose();assert.equal(f.disposed,1);
});
test('a cached car and paint needs no renderer; a new paint gets a distinct thumbnail',async()=>{
  const cache=new Map(),first=thumbnailFixture('#c02624',cache);first.enter();await first.view.whenIdle();first.view.dispose();
  const warm=thumbnailFixture('#c02624',cache);warm.enter();await warm.view.whenIdle();assert.equal(warm.allocations,0);assert.equal(warm.img.dataset.thumbReady,'true');warm.view.dispose();
  const blue=thumbnailFixture('#1e6384',cache);blue.enter();await blue.view.whenIdle();assert.equal(blue.allocations,1);assert.equal(cache.size,2);assert.notEqual(thumbnailKey('mini','#c02624','test'),thumbnailKey('mini','#1e6384','test'));blue.view.dispose();
});
test('leaving the garage during a lazy studio import disposes it without rendering',async()=>{
  let release,draws=0,disposed=0;const studio={setVehicle(){},draw:async()=>draws++,dispose:()=>disposed++};
  const f=thumbnailFixture('#fff',new Map(),{createStudio:()=>new Promise(resolve=>{release=resolve;})});f.enter();await new Promise(resolve=>setTimeout(resolve,0));f.view.dispose();release(studio);await f.view.whenIdle();assert.equal(draws,0);assert.equal(disposed,1);assert.equal(f.img.src,undefined);
});

import { Menu } from '../src/menu.js';
test('OWNER LOCK: aceb5bd title is the owner-chosen design; ask before redesigning (docs/OWNER-DECISIONS.md)',()=>{
 const priorDocument=globalThis.document,priorWindow=globalThis.window;globalThis.document={baseURI:'http://localhost/',querySelector:()=>null,body:{classList:{contains:()=>false}}};globalThis.window={};
 let html;try{html=Menu.prototype.r_title.call({h:{}});}finally{globalThis.document=priorDocument;globalThis.window=priorWindow;}
 assert.match(html,/home__brand/,'OWNER LOCK: keep the logo on the left');assert.match(html,/home__tiles/,'OWNER LOCK: keep the large PLAY and four supporting cards');
 const actions=[...html.matchAll(/data-act="([^"]+)"/g)].map(m=>m[1]);assert.deepEqual(actions.filter(a=>['play','mpJoin','mpHost','garage','settings'].includes(a)),['play','mpJoin','mpHost','garage','settings'],'OWNER LOCK: title card structure changed; ask the owner first');
 for(const label of ['PLAY','JOIN GAME','HOST / CREATE GAME','GARAGE','SETTINGS','ATHENS','RACING'])assert.ok(html.includes(label),'OWNER LOCK: missing '+label);
 assert.doesNotMatch(html,/data-title-hero|home__hero|road-sign|home__edition|home__session/,'OWNER LOCK: no car hero, road sign, coordinates or info strip on the title');
 assert.match(html,/data-act="account"/);assert.match(html,/title-meta/);
 const source=readFileSync(new URL('../src/menu.js',import.meta.url),'utf8');assert.doesNotMatch(source,/mountTitleHero/,'OWNER LOCK: title must allocate no preview renderer');
});
