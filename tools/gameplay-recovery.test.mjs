import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { towCondition, recoveryHeld, TOW_PROMPT_SECONDS, TOW_PROMPT_COOLDOWN } from '../src/recovery-policy.js';
const source = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
function section(from, to) { return source.slice(source.indexOf(from), source.indexOf(to, source.indexOf(from))); }
test('brief road excursions do not offer tow; persistent off-course/stuck/inverted do', () => {
  const sample = { offroad: true, beyond: 9, water: 0, inverted: false, disabled: false, speed: 20 };
  const state = { offT: 0 };
  for (let i = 0; i < 180; i++) assert.equal(towCondition(sample, 1/60, state), false);
  towCondition({ ...sample, offroad: false }, 1/60, state); assert.equal(state.offT, 0);
  for (let i = 0; i < 361; i++) towCondition(sample, 1/60, state);
  assert.equal(towCondition(sample, 1/60, state), true);
  const stopped = { offT: 0 }; for (let i=0;i<181;i++) towCondition({...sample, speed:0},1/60,stopped);
  assert.ok(stopped.stuckT>3); assert.equal(towCondition({...sample,speed:0},1/60,stopped),true);
  assert.equal(recoveryHeld(false, { element: {}, offT: 12, hold: 5 }), false, 'a prompt or stale timer cannot hold driving');
  assert.equal(recoveryHeld(false, { recovering: true, hold: 5 }), true);
  assert.equal(recoveryHeld(false, { recovering: true, hold: 0 }), false);
});
test('live stuckCheck minimises after 3s and dismiss/on-road preserve 20s cooldown', () => {
  const classes = new Set(), el = { classList: { contains: x=>classes.has(x), add: x=>classes.add(x) }, remove() {} };
  const towOffer = { element: el, cooldown: 0, elapsed: 0, offT: 0, hold: 0 }, G = { state: 'race' };
  let offers=0;
  const check = Function('G','towOffer','multiplayer','route','EV','towCondition','TOW_PROMPT_SECONDS','TOW_PROMPT_COOLDOWN','offerTow','notifications', section('function closeTowOffer(', 'function resetTowOffer(')+section('function stuckCheck(', 'function tow(')+'; return { stuckCheck, closeTowOffer };')(G,towOffer,{retired:false},{edge:()=>4},{isWrecked:()=>false},towCondition,TOW_PROMPT_SECONDS,TOW_PROMPT_COOLDOWN,()=>{if(towOffer.cooldown<=0)offers++},{dismiss(){}});
  const v = { s:100, u:14, offroad:1, water:0, pose:{roll:0,pitch:0},speed:10 };
  for(let i=0;i<180;i++) check.stuckCheck(v,1/60);
  check.stuckCheck(v,.01); assert.ok(classes.has('minimised')); assert.equal(towOffer.cooldown,20); assert.equal(v.speed,10);
  check.closeTowOffer(20); assert.equal(towOffer.element,null);
  check.stuckCheck({...v,offroad:0,u:0},1); assert.equal(towOffer.cooldown,19);
  for(let i=0;i<18;i++) check.stuckCheck(v,1); assert.equal(offers,0);
  check.stuckCheck(v,1); assert.equal(offers,1);
});
test('actual camera and simulation gates stop solo pause and MP menus, allow racing and photo', () => {
  const gate = section('function updateCamera(', '  previousCameraQuat.copy');
  const G = {state:'paused'}, multiplayer={active:false}, window={}; let menuOpen=false;
  const frozen = Function('window','G','multiplayer','inMenu', gate+'return false; } return updateCamera;')(window,G,multiplayer,()=>menuOpen);
  assert.equal(frozen(1/60),undefined); G.state='race'; assert.equal(frozen(1/60),false);
  multiplayer.active=true; menuOpen=true; assert.equal(frozen(1/60),undefined);
  window.__replay={active:true}; assert.equal(frozen(1/60),false);
  const expression=source.match(/const simulate = (.*);/)[1];
  const simulate=()=>Function('window','G','multiplayer','inMenu','return '+expression)(window,G,{...multiplayer,panel:{hidden:true}},()=>menuOpen);
  window.__replay=null; assert.equal(simulate(),false); menuOpen=false; assert.equal(simulate(),true); G.state='paused'; assert.equal(simulate(),false);
});
test('reset resumes a paused race and calls recovery, preserving Retry as restart', () => {
  const calls=[], G={state:'paused'}, player={veh:{}};
  Function('G','multiplayer','menu','player','resume','tow',section('function resetCar()', 'function recoverFromCapture()')+'resetCar();')(G,{active:false},{open:true},player,()=>{calls.push('resume');G.state='race';},(v,opts)=>calls.push(opts));
  assert.deepEqual(calls,['resume',{reset:true}]);
});
