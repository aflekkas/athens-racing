import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import { ENF, cameraFires, CameraWatch, FineLedger, redViolation, modeEnforcement, resolveCapture } from '../src/enforcement.js';
import { collectCameras, collectRedLightSites, UNVERIFIED_CANDIDATES } from '../src/enforcement-data.js';
import { EnforcementRuntime } from '../src/enforcement-runtime.js';
import { createEnforcementState, observeEnforcementState, validateViolation, penaltyFor, MAX_CLAIMS } from '../server/enforcement.mjs';
const cam = { id: 'ermou-fixture', mapId: 'riviera', s: 220, dir: 1, limitKmh: 50, verified: true, active: true, source: 'fixture: researched junction, post NOT verified' };
const map = { id: 'riviera', data: { route: { length: 10988 }, speedCameras: [cam], redLightSites: [{ ...cam, id: 'red-fixture' }] } };
const st = (s=220,now=10,dir=1) => ({ s, u: 2, kmh: 90, now, at: 60000, dir });
const ctx = () => ({ enabled: true, active: true, mapId:'riviera', raceId:'r1', generation:2, now:60000, stateAt:60000,
  state: { s:220,u:2,vLong:25 }, dir:1, cameras:[cam], redSites:[], enforcement:createEnforcementState('r1',2) });
const claim = (over={}) => ({ id:'c1',siteId:cam.id,kind:'camera',raceId:'r1',generation:2,s:220,dir:1,kmh:90,at:60000,...over });
test('direction is mandatory; unknown camera facing never guesses both ways',()=>{
  assert.equal(cameraFires(cam,220,1,90),true);assert.equal(cameraFires(cam,220,-1,90),false);
  for(const dir of [0,undefined,NaN])assert.equal(cameraFires(cam,220,dir,90),false);
  assert.equal(cameraFires({...cam,dir:undefined},220,1,90),false);
  assert.equal(cameraFires({...cam,dir:0},220,-1,90),true);
});
test('speed threshold includes margin',()=>{assert.equal(cameraFires(cam,220,1,60),false);assert.equal(cameraFires(cam,220,1,61),true);});
test('camera single pass, cooldown and race reset',()=>{
 const w=new CameraWatch();assert.equal(w.step(cam.id,cam,st()),'fire');assert.equal(w.step(cam.id,cam,st(220,12)),'held');
 w.step(cam.id,cam,st(1000,15));assert.equal(w.step(cam.id,cam,st(220,25)),'cooldown');w.reset();assert.equal(w.step(cam.id,cam,st(220,26)),'fire');
});
test('swept trigger catches a fast legitimate pass; a teleport and off-road pose do not',()=>{
 const w=new CameraWatch();assert.equal(w.step(cam.id,cam,{...st(240),prevS:200}),'fire');w.reset();
 assert.equal(w.step(cam.id,cam,{...st(1000),prevS:0}),'absent');assert.equal(w.step(cam.id,cam,{...st(),u:40}),'absent');
});
test('red requires a real witness, phase and grace; cameras alone are silent',()=>{
 const red={main:'R',redT:2,toGreen:3};assert.equal(redViolation(red,{}),false);assert.equal(redViolation(red,{camera:true}),false);assert.equal(redViolation(red,{witnessed:true}),true);
 assert.equal(redViolation({...red,redT:.2},{camera:true}),false);assert.equal(redViolation({...red,main:'G'},{camera:true}),false);
});
test('catalogue isolates maps, disabled/unknown facing/unknown provenance',()=>{
 assert.equal(collectCameras(map).length,1);assert.equal(collectRedLightSites(map).length,1);
 assert.equal(collectCameras({...map,id:'penteli'}).length,0);assert.equal(collectCameras(null).length,0);
 for(const change of [{active:false},{verified:false},{dir:undefined},{source:undefined}])assert.equal(collectCameras({...map,data:{...map.data,speedCameras:[{...cam,...change}]}}).length,0);
});
test('production real-map catalogue never enforces the unverified Ermou/Alimos leads',()=>{
 const data=JSON.parse(fs.readFileSync(new URL('../data/map.json',import.meta.url)));
 assert.deepEqual(collectCameras({id:'riviera',data}),[]);assert.deepEqual(collectRedLightSites({id:'riviera',data}),[]);
 const e=UNVERIFIED_CANDIDATES.find(c=>c.id==='poseidonos-ermou');assert.equal(e.s,220);assert.equal(e.verified,false);
 const x=(e.lon-data.proj.lon0)*data.proj.mlon,z=-(e.lat-data.proj.lat0)*data.proj.mlat,i=e.s/data.route.step;
 assert.ok(Math.hypot(data.route.x[i]-x,data.route.z[i]-z)<2,'researched intersection is near route; not a surveyed post');
});
test('runtime optional toggle controls camera and witness ledger; race reset clears cooldown/history',()=>{
 const emitted=[], r=new EnforcementRuntime(e=>{emitted.push(e);r.record(e);});r.setMap(map);
 r.configure({enabled:false});r.step(st());assert.equal(emitted.length,0);
 r.configure({enabled:true,raceId:'solo:1'});r.step(st());assert.equal(r.ledger.totalSec,3);
 r.configure({enabled:true,raceId:'solo:2'});assert.equal(r.ledger.totalSec,0);r.step(st());assert.equal(emitted.length,2);
});
test('runtime no-camera red is silent until witnessed; online never trusts client witness',()=>{
 const a=[],r=new EnforcementRuntime(e=>a.push(e));r.setMap({id:'riviera',data:{route:{length:10988}}});r.configure({enabled:true});
 const j={s:1000,i:4,main:'R',redT:2,toGreen:3};assert.equal(r.red(j,st(1000),false),null);r.red(j,st(1000),true);assert.equal(a.length,1);
 assert.equal(r.red(j,st(1000,11),true),null);r.configure({enabled:true,raceId:'online',online:true});assert.equal(r.red(j,st(1000),true),null);
});
test('online candidates stay out of ledger until acknowledged',()=>{
 const a=[],r=new EnforcementRuntime(e=>a.push(e));r.setMap(map);r.configure({enabled:true,online:true,raceId:'r1',generation:2});r.step(st());
 assert.equal(r.ledger.totalSec,0);r.record(a[0]);r.record(a[0]);assert.equal(r.ledger.totalSec,3);
});
test('server context is required; accepted snapshot supplies speed and position',()=>{
 assert.equal(validateViolation(claim()).accept,false);const c=ctx();assert.equal(validateViolation(claim(),c).accept,true);
 assert.equal(validateViolation(claim(),c).reason,'duplicate');
 for(const state of [{s:1000,u:2,vLong:25},{s:220,u:40,vLong:25},{s:220,u:2,vLong:10}])assert.equal(validateViolation(claim(),{...ctx(),state}).accept,false);
});
test('server rejects missing/NaN/future/stale timestamps and stale state',()=>{
 for(const at of [undefined,NaN,Infinity,65000,1000])assert.equal(validateViolation(claim({at}),ctx()).accept,false);
 for(const stateAt of [undefined,NaN,65000,1000])assert.equal(validateViolation(claim(),{...ctx(),stateAt}).accept,false);
});
test('server map/direction/site/race/generation/enable binding',()=>{
 for(const change of [{dir:0},{dir:undefined},{dir:-1},{siteId:'made-up'},{raceId:'r0'},{generation:1},{id:'a'.repeat(65)},{id:'<bad>'}])assert.equal(validateViolation(claim(change),ctx()).accept,false);
 for(const change of [{enabled:false},{active:false},{mapId:'penteli'},{dir:-1}])assert.equal(validateViolation(claim(),{...ctx(),...change}).accept,false);
});
test('fresh ids cannot stack a site/pass or evade cooldown; accepted leaving and elapsed time re-arm',()=>{
 const c=ctx();assert.equal(validateViolation(claim(),c).accept,true);assert.equal(validateViolation(claim({id:'c2'}),c).reason,'cooldown');
 c.now+=61000;c.stateAt=c.now;assert.equal(validateViolation(claim({id:'c2',at:c.now}),c).reason,'cooldown');
 observeEnforcementState(c.enforcement,{s:1000},[cam],c.now);assert.equal(validateViolation(claim({id:'c2',at:c.now}),c).accept,true);
 c.enforcement=createEnforcementState('r1',2);assert.equal(validateViolation(claim({at:c.now}),c).accept,true);
});
test('bounded claim memory remains bounded over repeated passes',()=>{
 const c=ctx();for(let i=0;i<MAX_CLAIMS+10;i++){c.now+=61000;c.stateAt=c.now;observeEnforcementState(c.enforcement,{s:1000},[cam],c.now);
 assert.equal(validateViolation(claim({id:`c${i}`,at:c.now}),c).accept,true);}
 assert.equal(c.enforcement.claims.size,MAX_CLAIMS);assert.equal(c.enforcement.sites.size,1);
});
test('red server cannot accept client phase/witness; needs receiver-owned phase',()=>{
 const c=ctx();c.redSites=[cam];const m=claim({kind:'red',witnessed:true,main:'R'});assert.equal(validateViolation(m,c).reason,'witness');
 c.redPhase=()=>({main:'R',redT:2,toGreen:3});assert.equal(validateViolation(m,c).reason,'witness');
 c.redWitness=()=>true;assert.equal(validateViolation(m,c).accept,true);
});
test('two sender reducers cannot penalise a victim named in a claim',()=>{
 const a=ctx(),b=ctx();assert.equal(validateViolation(claim({playerId:'victim'}),a).accept,true);assert.equal(b.enforcement.sites.size,0);
});
test('game penalties stay bounded; ledger is plain seconds; taxi/getaway gating',()=>{
 assert.equal(penaltyFor('red',{penalty:-2}),2);assert.equal(penaltyFor('camera',{cameraPenalty:Infinity}),3);assert.equal(penaltyFor('red',{penalty:5}),5);
 const l=new FineLedger();assert.equal(l.add('red','x',NaN),null);assert.equal(l.totalSec,0);
 assert.deepEqual(modeEnforcement({mode:'taxi',police:true,pickup:true}),{enforce:true,wantedArmed:false});
 assert.deepEqual(modeEnforcement({mode:'getaway',police:true,pickup:true,laws:false}),{enforce:false,wantedArmed:false});
 assert.equal(resolveCapture('sprint').dnf,false);assert.equal(resolveCapture('pursuit').dnf,true);
});

// Exercise the actual shared-file stop-line hook rather than a parallel model.
function gameStopLine({enabled=true,witness=false,online=false}={}) {
 const source=fs.readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
 const hook=source.slice(source.indexOf('function onStopLine('),source.indexOf('\nfunction handleHonk'));
 const G={t:10,dir:1,pen:0,reds:0,rPen:0,rReds:0,ev:{def:{rules:{penalty:2}}}};
 const finePhone={entries:[],show(e){this.entries.push(e);}};
 const enforcement=new EnforcementRuntime(entry=>{const fine=enforcement.record(entry);if(fine){G.pen+=fine.penaltySec;if(fine.kind==='red')G.reds++;finePhone.show(fine);}});
 enforcement.setMap({id:'riviera',data:{route:{length:10988}}});enforcement.configure({enabled,online});
 let flashes=0; const fn=new Function('lawsEnabled','enforcement','redViolation','G','rival','police','lawState','hud','audio','people',hook+'\nreturn onStopLine;')(
  ()=>enabled,enforcement,redViolation,G,{}, {enabled,witnesses:()=>enabled&&witness,witnessedRed(){},cops:witness?[{cop:{sees:true}}]:[]},()=>st(1000),{flashCam(){flashes++;}},{shutter(){}},{redRun(){}});
 return {fn,G,enforcement,finePhone,flashes:()=>flashes};
}
test('actual main stop-line hook: disabled/no witness makes no penalty, no phone',()=>{
 for(const options of [{enabled:false,witness:true},{enabled:true,witness:false}]){const x=gameStopLine(options);x.fn({s:1000,i:1,main:'R',redT:2,toGreen:3},'player');assert.equal(x.G.pen,0);assert.equal(x.finePhone.entries.length,0);}
});
test('actual main hook: witnessed red applies race seconds/history once',()=>{
 const x=gameStopLine({witness:true}),j={s:1000,i:1,main:'R',redT:2,toGreen:3};x.fn(j,'player');x.fn(j,'player');
 assert.equal(x.G.pen,2);assert.equal(x.G.reds,1);assert.equal(x.finePhone.entries.length,1);assert.equal(x.flashes(),1);
});
test('actual main hook: player visibility never becomes an AI witness',()=>{
 const x=gameStopLine({witness:true}),r={pen:0,reds:0,dir:1};x.fn({s:1000,i:1,main:'R',redT:2,toGreen:3},'rival',r);assert.equal(r.pen,0);
});
test('actual main hook: online player witness cannot self-certify MP fine',()=>{
 const x=gameStopLine({witness:true,online:true});x.fn({s:1000,i:1,main:'R',redT:2,toGreen:3},'player');assert.equal(x.G.pen,0);
});

test('client race reset/resume never reuses claim ids',()=>{
 const a=[],r=new EnforcementRuntime(e=>a.push(e));r.setMap(map);r.configure({enabled:true,raceId:'r1'});r.step(st());r.reset();r.step(st());
 assert.notEqual(a[0].id,a[1].id);assert.ok(a.every(e=>e.id.length<=64));
});
