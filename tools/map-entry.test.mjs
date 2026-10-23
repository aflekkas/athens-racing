import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import * as entry from '../src/map-entry.js';
import * as menu from '../src/menu-map.js';
import {MAPS} from '../src/map-catalog.js';
const source=await readFile(new URL('../src/map-entry.js',import.meta.url),'utf8');
const saved=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
function storage(value){Object.defineProperty(globalThis,'localStorage',{configurable:true,value:value===undefined?undefined:{getItem:key=>{assert.equal(key,'paraliaki.lastPlayedMap');return value;}}});}
function restore(){saved?Object.defineProperty(globalThis,'localStorage',saved):delete globalThis.localStorage;}

test('map entry has the exact original selection bodies and one shared exported implementation',async()=>{
 const body=source.slice(source.indexOf('/** the track played'));assert.equal(createHash('sha256').update(body).digest('hex'),'5302809f191973cc5abe0b1290f68e89260d56c3ab235d46774c7b07329330e4');assert.equal(menu.lastPlayedMap,entry.lastPlayedMap);assert.equal(menu.initialMapId,entry.initialMapId);
 assert.deepEqual([...source.matchAll(/^import .*? from ['"]([^'"]+)['"]/gm)].map(m=>m[1]),['./map-catalog.js','./enabled-maps.js']);const context=await readFile(new URL('../src/menu-map.js',import.meta.url),'utf8');assert.doesNotMatch(context,/export function (?:lastPlayedMap|initialMapId)/);assert.match(context,/export \{ lastPlayedMap, initialMapId \} from '\.\/map-entry.js'/);
});

test('explicit maps, events, Athens special handling and stored/default preference keep prior precedence',()=>{
 try{storage('megara');for(const m of MAPS)assert.equal(entry.initialMapId(new URLSearchParams('map='+m.id)),m.id);for(const [event,expected]of [['penteli-tt','penteli'],['penteli-descent-tt','penteli'],['psychiko-race','psychiko'],['megara-race','megara'],['free:psychiko','psychiko']])assert.equal(entry.initialMapId(new URLSearchParams({event})),expected);
 assert.equal(entry.initialMapId(new URLSearchParams('map=athens')),'megara');assert.equal(entry.initialMapId(new URLSearchParams('event=unknown')),'megara');assert.equal(entry.initialMapId(new URLSearchParams('map=riviera&event=megara-race')),'riviera');storage(undefined);assert.equal(entry.initialMapId(new URLSearchParams()),'riviera');assert.equal(entry.initialMapId(new URLSearchParams('map=athens')),'riviera');assert.throws(()=>entry.initialMapId(new URLSearchParams('map=unavailable-native')),/Unknown map/);}finally{restore();}
});

test('unknown, removed or inaccessible persisted choices do not replace the established default',()=>{
 try{for(const value of [undefined,null,'','missing-native','athens']){storage(value);assert.equal(entry.lastPlayedMap(),null);assert.equal(entry.initialMapId(new URLSearchParams()),'riviera');}assert.equal(entry.lastPlayedMap(null),null);assert.equal(entry.lastPlayedMap({getItem(){throw Error('storage blocked');}}),null);for(const m of MAPS)assert.equal(entry.lastPlayedMap({getItem:()=>m.id}),m.id);}finally{restore();}
});

test('disabled native metadata preserves URL resolution but is excluded from the saved playable preference',()=>{
 const body=source.slice(source.indexOf('/** the track played')).replaceAll('export function','function'),maps=[{id:'riviera'},{id:'disabled',eventIds:['disabled-race']}],getMap=id=>{const m=maps.find(m=>m.id===id);if(!m)throw Error('Unknown map');return m;},helpers=new Function('MAPS','getMap','getPlayableMaps',body+';return {lastPlayedMap,initialMapId};')(maps,getMap,rows=>rows.filter(m=>m.id!=='disabled'));
 try{storage('disabled');assert.equal(helpers.lastPlayedMap(),null);assert.equal(helpers.initialMapId(new URLSearchParams()),'riviera');assert.equal(helpers.initialMapId(new URLSearchParams('map=disabled')),'disabled');assert.equal(helpers.initialMapId(new URLSearchParams('event=disabled-race')),'disabled');assert.throws(()=>helpers.initialMapId(new URLSearchParams('map=absent')),/Unknown map/);}finally{restore();}
});

test('race event/context outputs retain their original geometry and conditions',()=>{
 for(const meta of MAPS){const quick=menu.quickMapEvent(meta.id),context=menu.menuMapContext(meta.id);assert.equal(quick.mapId,meta.id);assert.equal(context.mapId,meta.id);assert.deepEqual(context.events,[quick]);assert.equal(context.route.start,meta.routeStart??0);assert.equal(context.route.finish,meta.routeFinish??meta.length);assert.equal(context.route.length,meta.routeLength??meta.length);assert.equal(quick.reverse,meta.defaultReverse===true);assert.equal(quick.traffic,meta.id==='riviera'?1:0);}
});
