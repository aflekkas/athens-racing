import test from 'node:test';
import assert from 'node:assert/strict';
import { runManeuvers, lowSpeedYawMoment } from './maneuvers.mjs';
const results=runManeuvers();
for(const r of results.donuts)test(`${r.car} ${r.kmh}km/h: full-lock full-power donut with TC/ESC off`,()=>{
 assert.ok(r.continuousYawSeconds>5,`${r.continuousYawSeconds}s continuous yaw >1rad/s`);assert.ok(r.headingDeg>720,`${r.headingDeg}° heading`);
 assert.equal(r.maxCut,0,'TC off remains off throughout the drift latch');assert.equal(r.maxESC,0,'ESC off remains off');
});
for(const r of results.handbrakeSpins)test(`${r.car} aids ${r.aids}: deliberate handbrake turn completes 360°`,()=>assert.ok(r.headingDeg>=360,`${r.headingDeg}°`));
for(const r of results.holds)test(`${r.car}: countersteer and throttle hold 40° drift without leaving the 30–50° window`,()=>assert.ok(r.continuousHoldSeconds>=4,`${r.continuousHoldSeconds}s`));
for(const r of results.recoveries)test(`${r.car}: ease power and unwind from 45° without a launch or tank-slapper`,()=>{
 assert.ok(r.initialBetaDeg>=45&&r.initialBetaDeg<47,'specified initial 45° slide');assert.ok(r.peakLateralG<1.2,`${r.peakLateralG}g lateral`);
 assert.ok(r.peakWorldG<1.3,`${r.peakWorldG}g world velocity change`);assert.ok(r.overshootDeg>-10,`${r.overshootDeg}° overshoot`);assert.ok(Math.abs(r.finalBetaDeg)<10,'recovers to alignment');
});
test('large-angle lateral tyre force stays broad through sideways and backward motion',()=>{
 const force=angle=>Math.abs(results.lateralCurve.find(r=>r.angle===angle).lateralG);
 assert.ok(force(60)>force(20)*.85);assert.ok(force(100)>force(80)*.98,'crossing 90° must not change the sliding friction branch');
 assert.ok(results.lateralCurve.every(r=>r.lateralG>0&&r.lateralG<1.2));
});

test('a slow handbrake pivot uses rear brakes and integrates only actual tyre yaw moment',()=>{
 const r=lowSpeedYawMoment();assert.equal(r.burnout,false,'turning is not a front line-lock brake stand');
 assert.ok(Math.abs(r.delta-r.expected)<1e-12,`yaw step ${r.delta} differs from tyre moment ${r.expected}`);
});
