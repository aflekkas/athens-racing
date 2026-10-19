// Owner playtest 2026-10-18: after a reset or tow "I'm back at the start", "why am I all the way back here?", "I can't see you. Where are you?".
// A tow is a deliberate jump (the server puts the car on the nearest road, motion epoch bumped, speed 0). The other screen must show exactly that
// and nothing else: one hop to the tow pose, no ghost left at the old spot, no rewind, no long catch-up, however slow the sender is.
// Production sender, arena core, intake and timeline through tools/mp-link-sim.mjs (virtual time).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runLink, curvyPath, NET } from './mp-link-sim.mjs';

/** The curving car until `at` ms, then a tow: 1.65 m sideways onto the lane centre, speed 0, held for `hold` ms, then accelerating at 5 m/s^2 straight on. */
function towed(at, hold, lateral = 1.65) {
  return ms => {
    const base = curvyPath(ms), p0 = base(at), rx = Math.cos(p0.yaw), rz = -Math.sin(p0.yaw), fx = -Math.sin(p0.yaw), fz = -Math.cos(p0.yaw);
    const x0 = p0.x + rx * lateral, z0 = p0.z + rz * lateral;
    return t => {
      if (t < at) return base(t);
      const k = Math.max(0, t - at - hold) / 1000, v = Math.min(25, 5 * k), d = k < 5 ? 2.5 * k * k : 62.5 + 25 * (k - 5);
      return { x: x0 + fx * d, z: z0 + fz * d, yaw: p0.yaw, vLong: v, s: p0.s + d, w: 0 };
    };
  };
}
const AT = 9000, HOLD = 1000;
const tow = ({ senderFps, net, seed = 7 }) => runLink({ senderFps, net, seconds: 22, seed, path: towed(AT, HOLD), events: [{ at: AT, run: ({ sender }) => sender.discontinuity() }] });

for (const [name, senderFps, net] of [['perfect link, 60 fps', 60, NET.none], ['150 ms RTT +/- 50, 15 fps sender', 15, NET.rtt150], ['150 ms each way +/- 50, 15 fps sender', 15, NET.bad]]) test(`a tow is shown as one hop to the tow pose and a normal drive-off (${name})`, () => {
  const { all, truth } = tow({ senderFps, net });
  const shown = all.filter(f => f.shown), after = shown.filter(f => f.t > AT);
  // 1. Nothing is hidden: the car is on screen every frame from the first sample on.
  assert.equal(all.filter(f => f.t > 4000 && !f.shown).length, 0, 'the tow never makes the car vanish');
  // 2. Drawn hops: frame-to-frame jumps of the drawn car well above what its speed explains are the snaps the other driver sees.
  const hops = []; for (let i = 1; i < shown.length; i++) { const d = Math.hypot(shown[i].shown.x - shown[i - 1].shown.x, shown[i].shown.z - shown[i - 1].shown.z), dt = (shown[i].t - shown[i - 1].t) / 1000; if (d > 1.2 + 40 * dt) hops.push({ t: shown[i].t, d }); }
  const towHops = hops.filter(h => h.t > AT && h.t < AT + 1500), strays = hops.filter(h => h.t < AT || h.t >= AT + 1500);
  assert.deepEqual(strays, [], 'no snap anywhere except the tow itself');
  assert.ok(towHops.length <= 1, `at most one hop for the tow (${JSON.stringify(towHops)})`);
  // 3. No ghost at the old place: 1.2 s after the tow arrived on screen the drawn car is where the tow put it (the car is held, 1.65 m sideways).
  const pose = truth(AT + HOLD - 1);
  const settled = shown.filter(f => f.t > AT + 1000 + (net.base + 2 * net.jitter) + 700 && f.t < AT + HOLD);
  for (const f of settled) assert.ok(Math.hypot(f.shown.x - pose.x, f.shown.z - pose.z) < 2.5, `t=${f.t}: drawn ${Math.hypot(f.shown.x - pose.x, f.shown.z - pose.z).toFixed(1)} m from the tow pose`);
  // 4. Driving off is a normal, bounded lag: never more than 0.55 s of the car's own speed behind, and never ahead.
  for (const f of after.filter(f => f.t > AT + HOLD + 1500)) {
    const lag = Math.hypot(f.truth.x - f.shown.x, f.truth.z - f.shown.z), ahead = Math.hypot(f.shown.x - pose.x, f.shown.z - pose.z) - Math.hypot(f.truth.x - pose.x, f.truth.z - pose.z);
    assert.ok(lag < .55 * Math.max(f.truth.vLong, 1) + 2, `t=${f.t}: ${lag.toFixed(1)} m behind at ${f.truth.vLong.toFixed(1)} m/s`);
    assert.ok(ahead < 1.5, `t=${f.t}: drawn ${ahead.toFixed(1)} m AHEAD of the real car`);
  }
});

// A car that stops sends nothing, so the receiver's playhead is held on its last sample. When it moves off the playhead used to crawl
// to the wall clock at +5 %, so after a stop of 0.3 - 1 s (a junction, a bump, the tow hold) the other screen drew it 5 - 18 m behind for
// eight seconds or more: "Do you not see me behind you now?", "I can't see you. Where are you?".
/** 20 m/s, brakes at 6 m/s^2 to rest at `T0`, holds `hold` ms, accelerates at 5 m/s^2 back to 20 m/s. */
const stopAndGo = (T0, hold) => () => {
  const v0 = 20, a = 6, tb = v0 / a, db = v0 * tb - .5 * a * tb * tb;
  return t => {
    const k = t / 1000; let d, v;
    if (k < T0) { d = v0 * k; v = v0; }
    else if (k < T0 + tb) { const q = k - T0; d = v0 * T0 + v0 * q - .5 * a * q * q; v = v0 - a * q; }
    else if (k < T0 + tb + hold / 1000) { d = v0 * T0 + db; v = 0; }
    else { const q = k - T0 - tb - hold / 1000; d = v0 * T0 + db + (q < 4 ? 2.5 * q * q : 40 + 20 * (q - 4)); v = Math.min(20, 5 * q); }
    return { x: 0, z: -d, yaw: 0, vLong: v, s: d, w: 0 };
  };
};
for (const [name, senderFps, net, maxLag] of [['perfect link, 60 fps', 60, NET.none, .30], ['150 ms RTT +/- 50, 15 fps sender', 15, NET.rtt150, .42], ['150 ms each way +/- 50, 15 fps sender', 15, NET.bad, .70]]) test(`after a short stop the other car is drawn at its normal delay again within the first seconds (${name})`, () => {
  for (const hold of [300, 600, 900, 1500]) {
    const T0 = 7, goAt = T0 * 1000 + 20000 / 6 + hold, { all } = runLink({ senderFps, net, seconds: 24, path: stopAndGo(T0, hold) });
    for (const after of [3000, 5000, 8000]) {
      const f = all.find(f => f.t >= goAt + after && f.shown); assert.ok(f, 'the car is on screen');
      const lag = Math.hypot(f.truth.x - f.shown.x, f.truth.z - f.shown.z) / Math.max(f.truth.vLong, 1);
      let worst = 0; const run = all.filter(g => g.shown && g.t >= goAt - 500 && g.t <= goAt + 4000);
      for (let i = 1; i < run.length; i++) { const d = Math.hypot(run[i].shown.x - run[i - 1].shown.x, run[i].shown.z - run[i - 1].shown.z), dt = (run[i].t - run[i - 1].t) / 1000; worst = Math.max(worst, d - 24 * dt); }
      assert.ok(worst < 1.2, `stopped ${hold} ms: the drawn car must not hop when it moves off (${worst.toFixed(1)} m over what 24 m/s explains)`);
      assert.ok(lag < maxLag, `stopped ${hold} ms, ${after / 1000} s after moving off: drawn ${(lag * 1000).toFixed(0)} ms behind (limit ${maxLag * 1000}; was 450-900 ms)`);
    }
  }
});
