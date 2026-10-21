// Pure racecraft decisions of src/rival-ai.js: braking zones from corner
// curvature, when to commit to an overtake, which side to take, and when a
// committed pass completes or is abandoned. No physics or route needed.
// node --test tools/rival-racecraft.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { RacingLine, RivalAI, prepareRacingLine, planBraking, cornerSpeed, shouldCommit, choosePassSide, passVerdict, driverPersonality } from '../src/rival-ai.js';

test('racing-line prefetch is the exact cached line consumed by the real controller',()=>{
 const route={length:80,closed:false,edge:()=>6,frame:(s,out={})=>Object.assign(out,{x:0,z:s,rx:1,rz:0,grade:0}),point:(s,u,out={})=>Object.assign(out,{x:u,y:0,z:s}),y:()=>0,curv:()=>0};
 const prepared=prepareRacingLine(route,.95,{dir:1,closedRoad:false});
 const veh={halfW:.95,halfL:2,wb:2.6,u:0,s:0,vLong:0,vLat:0,spec:{vmax:100,mass:1200,grip:1,cdA:.6,brake:1,drive:'fwd',gears:[3],final:4,wheelR:.3,idle:800,redline:6000,power:100,torque:180},lockAt:()=>.5};
 const ai=new RivalAI(route,veh);assert.equal(ai.line,prepared);assert.deepEqual(ai.profile,prepared.speedProfile(veh));
 assert.notEqual(prepareRacingLine(route,1.05),prepared,'body widths keep their own line');
});

test('profile capability reuse is exact and scoped to one build, including live grip refresh',()=>{
 const line=Object.assign(Object.create(RacingLine.prototype),{n:120,step:2,dir:1,closed:false,route:{streetCircuit:false},k:new Float64Array(120),grade:new Float64Array(120),vertical:new Float64Array(120)});
 line.k.fill(.025,40,65);line.vertical.fill(-.002,80,90);let calls=0,grip=1;
 const veh={spec:{vmax:180},wb:2.6,maxLatAccel:v=>{calls++;return (9+v*.001)*grip;},maxBrakeDecel:v=>10*grip+v*.001,maxDriveAccel:v=>Math.max(0,5-v*.07),steerLockAt:()=>.5};
 const expected=line.speedProfile(veh),uncached=calls;calls=0;veh.planningStateKey=()=>String(grip);
 assert.deepEqual(line.speedProfile(veh),expected);assert.ok(calls<uncached*.8,'repeated exact speeds avoid repeated tyre solves');
 grip=.6;const changed=line.speedProfile(veh);delete veh.planningStateKey;
 assert.deepEqual(changed,line.speedProfile(veh));assert.notDeepEqual(changed,expected,'refresh sees new grip');
});

// Straight road into one corner of curvature k starting `at` metres ahead.
const cornerAhead = (at, k, lat = 9, vmax = 70) => ({ limit: (d) => d >= at && d < at + 40 ? cornerSpeed(k, lat) : vmax });
const brakePoint = (v, k, decel = 10, budget = 0.7) => {
  // The furthest distance from the corner at which the planner first lowers its target.
  for (let at = 400; at > 0; at -= 1) {
    const out = planBraking(v, decel, budget, 0.25, cornerAhead(at, k), v * v / (2 * decel * budget) + 70);
    if (out.target < 70) return at;
  }
  return 0;
};

test('corner speed follows curvature and grip', () => {
  assert.equal(cornerSpeed(0.01, 9), 30);
  assert.ok(Math.abs(cornerSpeed(-0.04, 9) - 15) < 1e-9, 'sign of the bend does not matter');
  assert.equal(cornerSpeed(0, 9, 55), 55, 'a straight is capped by top speed');
});

test('no braking on a clear road', () => {
  const out = planBraking(40, 10, 0.7, 0.25, { limit: () => 70 }, 200);
  assert.equal(out.target, Infinity);
  assert.equal(out.brake, 0);
});

test('braking starts where the corner speed can just be reached', () => {
  const v = 40, k = 1 / 40, vc = cornerSpeed(k, 9), decel = 10, budget = 0.7;
  const expected = (v * v - vc * vc) / (2 * decel * budget) + v * 0.25;
  const at = brakePoint(v, k, decel, budget);
  assert.ok(Math.abs(at - expected) < 6, `brakes at ${at} m, physics says ${expected.toFixed(1)} m`);
  // Inside the zone the target is the corner speed itself.
  const out = planBraking(v, decel, budget, 0.25, cornerAhead(at - 10, k), 200);
  assert.ok(Math.abs(out.target - vc) < 1e-9);
  assert.ok(out.brake > budget, 'brake demand reported above the budget once committed');
});

test('tighter corners and higher speeds brake earlier', () => {
  assert.ok(brakePoint(40, 1 / 25) > brakePoint(40, 1 / 60) + 10, 'hairpin before sweeper');
  assert.ok(brakePoint(45, 1 / 40) > brakePoint(32, 1 / 40) + 20, 'faster approach brakes earlier');
  assert.equal(brakePoint(20, 1 / 200), 0, 'a sweeper taken flat needs no brake');
});

test('aggressive drivers brake later than careful ones', () => {
  const late = driverPersonality({ aggression: 1 }).brakeBudget, early = driverPersonality({ aggression: 0 }).brakeBudget;
  assert.ok(late > early);
  assert.ok(brakePoint(40, 1 / 30, 10, late) < brakePoint(40, 1 / 30, 10, early));
});

test('commit only after patience, inside striking distance, and composed', () => {
  assert.equal(shouldCommit(0.5, 1.2, 10, 30), false, 'not held up long enough');
  assert.equal(shouldCommit(1.3, 1.2, 10, 30), true);
  assert.equal(shouldCommit(1.3, 1.2, 30, 30), false, 'too far back to make a move');
  assert.equal(shouldCommit(1.3, 1.2, 10, 30, 0.5), false, 'cooling down after an abort');
  assert.equal(shouldCommit(1.3, 1.2, 10, 30, 0, 1), false, 'still gathering it up after contact');
  const hot = driverPersonality({ aggression: 1 }), calm = driverPersonality({ aggression: 0.2 });
  assert.ok(hot.patience < calm.patience, 'aggressive drivers go for gaps sooner');
});

test('pass side needs room and prefers the inside of the next bend', () => {
  assert.equal(choosePassSide(-0.2, -1), 0, 'no room either side: stay behind');
  assert.equal(choosePassSide(-0.2, 0.4), 1);
  assert.equal(choosePassSide(0.4, -0.2), -1);
  assert.equal(choosePassSide(0.5, 0.5, -1), -1, 'inside of a left-hander');
  assert.equal(choosePassSide(0.5, 0.5, 1), 1, 'inside of a right-hander');
  assert.equal(choosePassSide(0.5, 0.5, 0, 0.8), 1, 'on a straight: the side we already lean to');
  assert.equal(choosePassSide(1.5, 0.1, 1, 0, 0), -1, 'careful driver takes the roomy outside');
  assert.equal(choosePassSide(1.5, 0.1, 1, 0, 1), 1, 'aggressive driver dives up the inside');
});

test('a committed pass completes, holds, or aborts safely', () => {
  const halfL = 2.2, hs = 2.2;
  assert.equal(passVerdict(8, halfL, hs, 0.5, 0, 2, 1), 'continue', 'pulling out with room');
  assert.equal(passVerdict(0, halfL, hs, 0.5, 0, 2, 3), 'continue', 'alongside');
  assert.equal(passVerdict(-(halfL + hs + 3.5), halfL, hs, 0.5, 0, 2, 4), 'cleared');
  assert.equal(passVerdict(-(halfL + hs + 1), halfL, hs, 0.5, 0, 2, 4), 'continue', 'not clear yet: no cutting back');
  assert.equal(passVerdict(8, halfL, hs, -0.1, 0, 2, 1), 'abort', 'door closed before we were alongside');
  assert.equal(passVerdict(1, halfL, hs, -0.1, 0, 2, 2), 'continue', 'alongside and only just tight: hold the line');
  assert.equal(passVerdict(1, halfL, hs, -0.5, 0, 2, 2), 'abort', 'squeezed: lift rather than lean on them');
  assert.equal(passVerdict(3, halfL, hs, 0.5, 2.5, 2, 5), 'abort', 'no longer gaining');
  assert.equal(passVerdict(3, halfL, hs, 0.5, 0, 2, 15), 'abort', 'never runs alongside forever');
});

test('field pace spread is a few percent and never above the limit by default', () => {
  const paces = [0.86, 0.88, 0.9, 0.93].map((pace) => driverPersonality({ pace }).pace);
  assert.ok(paces.every((p) => p >= 0.95 && p <= 1));
  assert.ok(paces[3] - paces[0] > 0.03, 'fast and slow locals differ');
});

test('never steers into a car alongside', async () => {
  const { alongsideLimit } = await import('../src/rival-ai.js');
  // Car on our right (+u) at 3.0; we are at 0.5 with half widths 0.9: stop 0.5 short.
  const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} vs ${b}`);
  near(alongsideLimit(3, 0.5, 0.9, 3, 0.9, 0.5), 0.7);
  assert.equal(alongsideLimit(-1, 0.5, 0.9, 3, 0.9, 0.5), -1, 'moving away is always allowed');
  assert.equal(alongsideLimit(0.6, 0.5, 0.9, 3, 0.9, 0.5), 0.6, 'a small move that keeps the gap is fine');
  // Already too close (inside the clearance line): hold, never closer.
  assert.equal(alongsideLimit(2, 1.0, 0.9, 3, 0.9, 0.5), 1.0);
  // Mirror image on the left.
  near(alongsideLimit(-3, -0.5, 0.9, -3, 0.9, 0.5), -0.7);
});

test('a slower civilian is passed at once, from a few car lengths back', async () => {
  const { civilianPass } = await import('../src/rival-ai.js');
  assert.equal(civilianPass(false, 25, 12, 30, 25), true, 'closing on a slow civilian: pull out early');
  assert.equal(civilianPass(true, 25, 12, 30, 25), false, 'a racer is a race: patience rules apply');
  assert.equal(civilianPass(false, 25, 24, 10, 25), false, 'not meaningfully slower');
  assert.equal(civilianPass(false, 25, 12, 80, 25), false, 'still too far back');
  assert.equal(civilianPass(false, 25, 12, 1, 25), false, 'too close to swing out: back off first');
  assert.equal(civilianPass(false, 25, 12, 30, 25, 1), false, 'cooling down after an abort');
  assert.equal(civilianPass(false, 25, 12, 30, 25, 0, 1), false, 'gathering it up after contact');
});
