// Actual Input + Vehicle + Ground logic; rendering-only imports are stubbed.
// Shoulder/crest fixtures are synthetic. Shipped Penteli profile checks are CPU-only.
import "./register.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { register } from "node:module";
const source = readFileSync(new URL("../../src/road.js", import.meta.url), "utf8");
const roadURL = "data:text/javascript," + encodeURIComponent(`import {lerp,smoothstep} from ${JSON.stringify(new URL("../../src/util.js", import.meta.url).href)};
` + source.slice(source.indexOf("export const ROAD ="), source.indexOf("\n};", source.indexOf("export const ROAD =")) + 3));
register("data:text/javascript," + encodeURIComponent(`export async function resolve(spec,ctx,next){
 if(spec==='./road.js' && (ctx.parentURL?.endsWith('/src/ground.js')||ctx.parentURL?.endsWith('/src/physics.js')))return{url:${JSON.stringify(roadURL)},shortCircuit:true};
 if(spec==='./tex.js' && ctx.parentURL?.endsWith('/src/ground.js'))return{url:'data:text/javascript,export const TX={};',shortCircuit:true};
 return next(spec,ctx);
}`), import.meta.url);
const { Vehicle } = await import(process.env.PHYS || "../../src/physics.js");
const { Input } = await import("../../src/input.js");
const { Ground } = await import("../../src/ground.js");
const { skidpad, transient, route: handlingRoute } = await import("./handling.mjs");
Object.assign(handlingRoute, { medHalf: () => 0, div: () => 0, seaR: () => 1e3, seaL: () => 1e3 });
const { Route } = await import("../../src/map.js");
const { ROAD } = await import(roadURL);
const cars = Function("return " + readFileSync(new URL("../../src/cars.js", import.meta.url), "utf8").split("export const CARS = ")[1].split("\n];")[0] + "\n];")();
const specs = ["mini", "golf", "corolla", "z4"].map((id) => cars.find((c) => c.id === id));
const route = { length: 1e4, closed: false, GR: null, frame(s, o) {
  return Object.assign(o, { tx: 0, tz: -1, rx: 1, rz: 0, grade: 0, bank: 0 });
}, point(s, u) {
  return { x: u, z: -s, y: 0 };
}, y: () => 0, surfaceY: () => 0, urban: () => 0, edge: () => 3.5, lin: () => 0, bank: () => 0, medHalf: () => 0, div: () => 0, seaR: () => 1e3, seaL: () => 1e3, project(x, z) {
  return { s: -z, u: x };
} };
const rows = [];
function controller() {
  return new Input({ target: null, navigator: null, document: null, storage: null });
}
function bounds(v) {
  for (const c of v.corners) {
    assert.ok(Number.isFinite(c.Fz + c.Fx + c.Fy));
    assert.ok(c.Fz >= 0 && c.Fz < v.m * 9.81 * 4);
    const cap = v._cap[v.corners.indexOf(c)];
    assert.ok(Math.hypot(c.Fx / (v.muX * Math.max(1, cap)), c.Fy / Math.max(1, cap)) <= 1.000001);
  }
  assert.ok(Number.isFinite(v.pose.heave + v.pose.roll + v.pose.pitch));
}
function ground(r = route, height = () => 0) {
  return Object.assign(Object.create(Ground.prototype), { route: r, out: {}, heightC: height, terrain: { cls: () => 0 }, traps: [], hump: () => 0, walls: () => null, _curbs: () => {
  }, limits: (s, w, out) => Object.assign(out, { min: -100, max: 100 }) });
}
function runTurn(spec, aids, manual) {
  const v = new Vehicle({ ...spec, ...!aids ? { tc: 0, esc: 0, edl: 0, abs: false } : {} }, { ...route, edge: () => 900 });
  v.reset(100, 0, 30 / 3.6);
  v.setManual(manual, { ai: !manual });
  v.gear = 2;
  v.roadZ = () => 0;
  const c = controller();
  c.keyDown({ code: "KeyD" });
  c.keyDown({ code: "KeyW" });
  let beta = 0, maxG = 0;
  for (let i = 0; i < 120; i++) {
    c.update(1 / 60, { speed: v.speed });
    v.update(1 / 60, c.state);
    bounds(v);
    beta = Math.max(beta, Math.abs(Math.atan2(v.vLat, v.vLong)) * 180 / Math.PI);
    maxG = Math.max(maxG, Math.abs(v.ay) / 9.81);
  }
  c.destroy();
  return { car: spec.id, aids, manual, radius: v.speed / Math.abs(v.w), kmh: v.kmh, beta, maxG, latch: v.driftLatch, front: v.wheel[0].sN, rear: v.wheel[1].sN };
}
test("30 km/h real keyboard throttle + turn: TC on/off, manual/automatic, FWD versus RWD", () => {
  for (const sp of specs) for (const aids of [true, false]) for (const manual of [true, false]) {
    const row = runTurn(sp, aids, manual);
    rows.push({ kind: "turn", ...row });
    assert.ok(row.maxG > 0.6);
    if (aids) assert.ok(row.radius < 17);
    if (sp.drive === "fwd") {
      assert.equal(row.latch, 0);
      assert.ok(row.beta < 12);
      assert.ok(row.front > row.rear);
    } else if (!aids) {
      assert.ok(row.beta > 25);
      assert.equal(row.latch, 1);
    }
  }
});
test("skidpad, lift-off and trail braking preserve grip and brake rotation", () => {
  for (const sp of specs) {
    const skid = skidpad(sp), lift = transient(sp, "lift", skid.maxG), brake = transient(sp, "trail", skid.maxG);
    rows.push({ kind: "skidpad", car: sp.id, maxG: skid.maxG, K: skid.K, lift, brake });
    assert.ok(skid.maxG > 0.8 && skid.maxG < 1.3);
    assert.ok(!lift.spun && !brake.spun);
    assert.ok(brake.gain > lift.gain + 0.05, `${sp.id} must retain braking rotation`);
  }
});
test("cross-road travel and a flat neighbouring road do not inherit main-route crest unloading", () => {
  for (const sp of specs) {
    const r = { ...route, edge: () => 900, y: (s) => -5e-3 * (s - 100) ** 2 };
    for (const nearby of [false, true]) {
      const v = new Vehicle(sp, r);
      v.reset(100, 0, 25);
      v.roadZ = () => 0;
      v.yaw = -Math.PI / 2;
      if (nearby) {
        v.ground = ground(r);
        v.ground.at = (x, z, s, u, out) => Object.assign(out, { y: 0, surf: "asphalt", network: true, networkStep: 0, hump: 0 });
        v.ground.resolve = (v2) => {
          v2.s = 100;
          v2.u = v2.x;
          v2.gradeG = v2.bank = 0;
          v2.wheelBump = [0, 0, 0, 0];
        };
        v.yaw = 0;
        v.ground.resolve(v);
      }
      for (let i = 0; i < 240; i++) {
        v.update(1 / 240, { throttle: 0.15, brake: 0, steer: 0 });
        bounds(v);
      }
      const load = v.corners.reduce((s, c) => s + c.Fz, 0) / (v.m * 9.81);
      rows.push({ kind: "unrelated-crest", car: sp.id, nearby, load });
      if (!process.env.HANDLING_BASELINE) assert.ok(load > 0.95 && load < 1.05, `${sp.id}: unrelated crest carries ${load}mg`);
    }
  }
});
test("rough road and genuine crest change both physical tyre loads and suspension pose with bounded forces", () => {
  for (const sp of specs) {
    const r = { ...route, edge: () => 900, y: (s) => 0.35 * Math.sin(s / 12) };
    const v = new Vehicle(sp, r);
    v.reset(100, 0, 20);
    v.roadZ = (s) => 0.02 * Math.sin(s * 1.3);
    let min = 2, max = 0, heave = 0;
    for (let i = 0; i < 720; i++) {
      v.update(1 / 240, { throttle: 0.25, brake: 0, steer: 0 });
      bounds(v);
      const load = v.corners.reduce((a, c) => a + c.Fz, 0) / (v.m * 9.81);
      min = Math.min(min, load);
      max = Math.max(max, load);
      heave = Math.max(heave, Math.abs(v.pose.heave));
      assert.equal(v.pose.heave, v.sus.z);
      assert.equal(v.pose.pitch, v.sus.th);
      assert.equal(v.pose.roll, -v.sus.ph);
    }
    rows.push({ kind: "rough-crest", car: sp.id, min, max, heave });
    assert.ok(max - min > 0.15 && heave > 5e-3);
  }
});
test("real Ground grass-to-asphalt uphill recovery uses controller input and all four contacts", () => {
  for (const sp of specs) {
    const r = { ...route, y: () => 10, surfaceY: () => 10, point: (s, u) => ({ x: u, z: -s, y: 10 }) };
    const v = new Vehicle(sp, r);
    v.ground = ground(r, (x) => 10 + Math.min(0, (5 - Math.abs(x)) * 0.1));
    const realAt = v.ground.at;
    v.ground.at = function(...args) {
      const a = realAt.apply(this, args);
      if (a.surf === "dirt") a.surf = "grass";
      return a;
    };
    v.reset(100, 8, 4);
    v.yaw = 0.5;
    v.gear = 1;
    v.roadZ = () => 0;
    v.ground.resolve(v, 1 / 240);
    const c = controller();
    c.keyDown({ code: "KeyW" });
    let grass = 0, paved = 0, minY = Infinity;
    for (let i = 0; i < 720; i++) {
      c.update(1 / 60, { speed: v.speed });
      if (i < 50) c.keyDown({ code: "KeyA" });
      else c.keys.delete("KeyA");
      if (v.wheelSurf.every((s) => s === "asphalt")) {
        paved++;
        c.keys.delete("KeyW");
        c.keyDown({ code: "KeyS" });
      }
      v.update(1 / 60, c.state);
      bounds(v);
      grass += v.wheelSurf.includes("grass") ? 1 : 0;
      minY = Math.min(minY, v.y);
      if (paved > 30) break;
    }
    c.destroy();
    rows.push({ kind: "recovery", car: sp.id, grass, paved, minY, exitKmh: v.kmh, x: v.x, yaw: v.yaw, beta: v.vLat, spin: v.spin, tc: v.tcCut, grade: v.gradeG, load: v.corners.map((c2) => c2.Fz), rpm: v.rpm, gear: v.gear, air: v.air });
    assert.ok(minY < 9.8, "must climb from a lower shoulder");
    assert.ok(grass > 10 && paved > 30, `${sp.id}: never recovered from actual grass incline`);
    assert.equal(v.driftLatch, 0);
  }
});
test("tyre telemetry is immutable and distinguishes force utilization from sliding demand", async () => {
  const { tyreTelemetry } = await import("../../src/tyre-telemetry.js");
  const v = new Vehicle(specs[0], route);
  v.update(1 / 60, { throttle: 0, brake: 0, steer: 0 });
  const before = v.corners[0].Fz;
  const t = tyreTelemetry(v);
  assert.equal(t.version, 1);
  assert.equal(t.wheels.length, 4);
  assert.ok(Object.isFrozen(t) && Object.isFrozen(t.wheels[0]));
  assert.throws(() => {
    t.wheels[0].loadN = 0;
  }, TypeError);
  assert.equal(v.corners[0].Fz, before);
  v.steer = 0.2;
  v.corners[0].sN = 3;
  v.corners[0].Fy = 0.7 * v._cap[0];
  v.corners[0].Fx = 0;
  const sliding = tyreTelemetry(v);
  assert.ok(sliding.front.sliding && sliding.understeer);
  assert.ok(sliding.front.utilization <= 1 && sliding.front.slipDemand > 1);
});
test("Penteli shipped elevation profile remains bounded near strongest crests", () => {
  const data = JSON.parse(readFileSync(new URL("../../data/maps/penteli/map.json", import.meta.url)));
  const r = new Route(data.route);
  r.urban = () => 0;
  for (const s of [2269, 6617, 6707]) {
    const v = new Vehicle(specs[0], r);
    v.reset(s, 0, 60 / 3.6);
    for (let i = 0; i < 60; i++) {
      v.update(1 / 240, { throttle: 0.2, brake: 0, steer: 0 });
      bounds(v);
    }
    rows.push({ kind: "real-penteli-profile", s, load: v.corners.reduce((a, c) => a + c.Fz, 0) / (v.m * 9.81) });
  }
});
test.after(() => {
  if (process.env.HANDLING_REPORT) writeFileSync(process.env.HANDLING_REPORT, JSON.stringify({ method: "Actual Input + Vehicle at 60Hz/240Hz internal; real Ground on explicit synthetic shoulder/crest fixtures; shipped Penteli Route CPU-only; no visual/real-world validation", rows }, null, 2) + "\n");
});
test("60/120/240 Hz update grouping preserves actual controller transient and tyre loads", () => {
  for (const sp of specs) {
    const end = [];
    for (const hz of [60, 120, 240]) {
      const v = new Vehicle(sp, { ...route, edge: () => 900 });
      v.reset(100, 0, 15);
      v.gear = 3;
      const c = controller();
      for (let i = 0; i < 180; i++) {
        if (i === 10) c.keyDown({ code: "KeyD" });
        if (i === 55) c.keys.delete("KeyD");
        if (i === 90) c.keyDown({ code: "KeyS" });
        if (i === 110) c.keys.delete("KeyS");
        c.update(1 / 60, { speed: v.speed });
        for (let j = 0; j < hz / 60; j++) v.update(1 / hz, c.state);
        bounds(v);
      }
      c.destroy();
      end.push([v.x, v.z, v.vLong, v.vLat, v.w, ...v.corners.map((c2) => c2.Fz)]);
    }
    for (let j = 0; j < end[0].length; j++) assert.ok(Math.max(...end.map((a) => a[j])) - Math.min(...end.map((a) => a[j])) < 1e-6, `${sp.id} timestep grouping ${j}`);
  }
});
test('main-road contact uses the route fast path and rotated slope normals preserve load', async () => {
  const { suspensionRoadInput } = await import('../../src/suspension-road-input.js');
  const r = { ...route, lin: () => 0.2, frame: (s, o) => Object.assign(o, { tx: 0, tz: -1, rx: 1, rz: 0, grade: 0.2, bank: 0.1 }) };
  const v = new Vehicle(specs[0], r);
  v.reset(100, 0, 10); v.wheelSurf = ['asphalt','asphalt','asphalt','asphalt'];
  let queries = 0; v.ground = { at() { queries++; throw Error('main road must not add contact queries'); } };
  const normals = [0, Math.PI/4, Math.PI/2, Math.PI].map(yaw => { v.yaw = yaw; return suspensionRoadInput(v, ROAD).effectiveGravity; });
  assert.equal(queries, 0);
  assert.ok(normals.every(n => Math.abs(n - 1 / Math.sqrt(1.05)) < 1e-12));
});
test('Huracan and older catalogue cars retain bounded controller turn authority', () => {
  for (const id of ['huracan', 'ibiza', 'panda', 'yaris', 'e36', 'gtv']) {
    const spec = cars.find(c => c.id === id);
    assert.ok(spec, `missing catalogue car ${id}`);
    const row = runTurn(spec, true, false);
    assert.ok(Number.isFinite(row.radius) && row.radius < 30, `${id}: turn radius ${row.radius}`);
    assert.ok(row.maxG > 0.45 && row.beta < 20, `${id}: turn instability`);
    if (spec.drive === 'fwd') assert.equal(row.latch, 0);
  }
});
test('optional mapped contact frame controls reset heading and contact-axis texture', async () => {
  const { suspensionRoadInput } = await import('../../src/suspension-road-input.js');
  const r = { ...route, contactFrame: (s, u, out) => Object.assign(out, {tx:1,tz:0,rx:0,rz:1,grade:0,bank:0}) };
  const v = new Vehicle(specs[0], r); v.reset(100, 2, 8);
  assert.equal(v.yaw, -Math.PI/2);
  assert.ok(Math.abs(suspensionRoadInput(v, ROAD).along - 1) < 1e-12);
});
