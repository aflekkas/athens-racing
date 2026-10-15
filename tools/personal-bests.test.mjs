import test from 'node:test';
import assert from 'node:assert/strict';
import { personalBestSetup, exactBestKey, routeBestKey, recordPersonalBest, getPersonalBests, personalBestLabel } from '../src/personal-bests.js';
const setup = () => personalBestSetup({mapId:'megara',def:{id:'quick',type:'sprint',rivals:2,traffic:1},route:{s0:10,s1:4010,dir:1,laps:2},car:'mini',conditions:{time:'day',weather:'clear'},assists:{tc:true,abs:true,steering:'full',gearbox:'auto'}});
const mem = () => {const m=new Map();return {getItem:k=>m.get(k),setItem:(k,v)=>m.set(k,v)}};
test('each performance setting gets its own exact best, but shares the route board',()=>{
 const s=setup(), key=exactBestKey(s),variants={map:'riviera',event:'other',type:'timetrial',from:11,to:6010,direction:-1,laps:3,car:'z4',traffic:0,time:'night',weather:'rain',rivals:0,police:true,tc:false,abs:false,steering:'off',gearbox:'manual'};
 for(const [k,v]of Object.entries(variants))assert.notEqual(exactBestKey({...s,[k]:v}),key,k);
 for(const k of ['car','traffic','time','weather','rivals','police','tc','abs','steering','gearbox','event','type'])assert.equal(routeBestKey({...s,[k]:variants[k]}),routeBestKey(s),k);
 for(const k of ['map','from','to','direction','laps'])assert.notEqual(routeBestKey({...s,[k]:variants[k]}),routeBestKey(s),k);
 assert.equal(exactBestKey(Object.fromEntries(Object.entries(s).reverse())),key);
});
test('keeps fastest clean result, reports a signed improvement, survives reload',()=>{
 const s=setup(),st=mem();assert.equal(recordPersonalBest(s,{time:63,valid:true},st).newBest,true);
 const pb=recordPersonalBest(s,{time:61.77,valid:true},st);assert.equal(pb.newBest,true);assert.equal(personalBestLabel(pb),'NEW PERSONAL BEST −1.23 s');
 assert.equal(recordPersonalBest(s,{time:70,valid:true},st).newBest,false);
 assert.equal(getPersonalBests(s,st).exact.time,61.77);
 const other={...s,car:'z4'};recordPersonalBest(other,{time:60,valid:true},st);assert.equal(getPersonalBests(s,st).route.time,60);assert.equal(getPersonalBests(s,st).exact.time,61.77);
});
test('rejects DNF, invalid/autodrive and corrupt data; blocked storage stays usable',()=>{
 const s=setup(),st=mem();for(const r of [{time:1,valid:false},{time:null,valid:true},{time:NaN,valid:true},{time:Infinity,valid:true},{time:-1,valid:true},{time:1,valid:true,retired:true}])assert.equal(recordPersonalBest(s,r,st).newBest,false);
 const blocked={getItem(){throw Error('blocked')},setItem(){throw Error('quota')}};assert.equal(getPersonalBests(s,blocked).exact,null);assert.equal(recordPersonalBest(s,{time:30,valid:true},blocked).persistent,false);
});


test('lazy track setup and loaded geometry resolve identical personal-record keys', async () => {
 const { menuMapContext, quickMapEvent } = await import('../src/menu-map.js');
 const { resolve } = await import('../src/events.js');
 const { readFile } = await import('node:fs/promises');
 for (const id of ['riviera', 'penteli', 'megara']) {
  const data = JSON.parse(await readFile(new URL(id === 'riviera' ? '../data/map.json' : `../data/maps/${id}/map.json`, import.meta.url)));
  const def = quickMapEvent(id), menu = resolve(def, menuMapContext(id)), live = resolve(def, { route: data.route, marks: data.marks });
  const key = route => exactBestKey(personalBestSetup({ mapId: id, def, route, car: 'mini' }));
  assert.equal(key(menu), key(live), id);
 }
});
