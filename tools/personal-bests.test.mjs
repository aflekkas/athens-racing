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

test('stores the full setup and car name, with no trim fields, and lists by track and assists', async () => {
 const {listPersonalBests}=await import('../src/personal-bests.js'); const st=mem();
 const s=personalBestSetup({mapId:'penteli',def:{id:'quick',traffic:1.5,rivals:2,rules:{police:true}},route:{s0:0,s1:9896,dir:1,laps:1},car:'mini_jcw',carSpec:{name:'MINI JCW',generation:'F56',trim:'JCW',trimLabel:'JCW'},conditions:{time:'night',weather:'rain'},assists:{tc:false,abs:true,steering:'light',gearbox:'manual'}});
 assert.equal(s.carName,'MINI JCW');assert.equal(s.carGeneration,undefined);assert.equal(s.carTrim,undefined);
 recordPersonalBest(s,{time:240,valid:true,date:'2026-10-17T12:00:00Z'},st);
 recordPersonalBest({...s,map:'riviera'},{time:220,valid:true},st);
 const rows=listPersonalBests({mapId:'penteli',weather:'rain',tc:'false',gearbox:'manual'},st);
 assert.equal(rows.length,1);assert.equal(rows[0].setup.carName,'MINI JCW');assert.equal(rows[0].setup.traffic,1.5);assert.equal(rows[0].setup.police,true);assert.equal(rows[0].date,'2026-10-17T12:00:00Z');
 assert.equal(getPersonalBests(s,st).exact.time,240);
 s.weather='clear';assert.equal(rows[0].setup.weather,'rain','record owns a snapshot');
});
// Owner decision 2026-10-20 (docs/OWNER-DECISIONS.md): trims are gone; a record set with a removed trim belongs to the top trim.
test('records set with removed trims move to the kept car, drop their trim fields and keep the faster time', async () => {
 const {listPersonalBests}=await import('../src/personal-bests.js');const st=mem(),base=setup();
 const old=(car,time,extra={})=>{const setup={...base,car,carName:'MINI '+car,...extra};return {key:JSON.stringify(JSON.parse(exactBestKey({...base,car}))),record:{time,car,date:'2026-01-0'+(time%9+1),setup}};};
 const a=old('mini',100,{carGeneration:'F56',carTrim:'Cooper'}),b=old('mini_cooper',90,{carGeneration:'F56',carTrim:'Cooper'}),c=old('mini_s',95),kept=old('mini_jcw',99);
 const exact={};for(const x of [a,b,c,kept])exact[JSON.stringify([x.record.setup.map,x.record.setup.event,x.record.setup.type,x.record.setup.from,x.record.setup.to,x.record.setup.direction,x.record.setup.laps,x.record.setup.car])+Math.random()]=x.record;
 st.setItem('paraliaki.personalBests.v1',JSON.stringify({version:1,exact,routes:{[routeBestKey(base)]:b.record}}));
 const best=getPersonalBests({...base,car:'mini_jcw'},st);assert.equal(best.exact.time,90);assert.equal(best.exact.car,'mini_jcw');assert.equal(best.exact.setup.car,'mini_jcw');
 assert.equal(getPersonalBests({...base,car:'mini_cooper'},st).exact.time,90,'a lookup that still names a removed trim reads the kept car board');
 const rows=listPersonalBests({mapId:base.map},st);assert.equal(rows.length,1,'one board for the one car');
 assert(!JSON.stringify(rows).includes('carTrim')&&!JSON.stringify(rows).includes('carGeneration'));
 assert.deepEqual(JSON.parse(st.getItem('paraliaki.personalBests.v1')).routes,{[routeBestKey(base)]:b.record},'the route board is unaffected');
});
test('legacy keys/records remain readable; list recovers key setup and avoids route duplicates', async () => {
 const {listPersonalBests}=await import('../src/personal-bests.js');const st=mem(),s=setup(),record={time:60,car:s.car,date:'2026-01-01'};
 st.setItem('paraliaki.personalBests.v1',JSON.stringify({version:1,exact:{[exactBestKey(s)]:record},routes:{}}));
 assert.equal(getPersonalBests(s,st).exact.time,60);assert.equal(listPersonalBests({mapId:'megara'},st)[0].setup.weather,'clear');
 recordPersonalBest({...s,weather:'rain'},{time:61,valid:true},st);assert.equal(listPersonalBests({mapId:'megara'},st).length,2);
});
