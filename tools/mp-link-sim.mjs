// Deterministic two-client link simulator for the online car-sync path (virtual time, 1 ms resolution).
// It drives the REAL production pieces end to end: StateSender (sender fps), the shared game core (server
// authority + relay), a lossy/jittery TCP-like link in each direction, and the receiver's snapshot intake
// plus remote-car render pose. The old proof used a constant 20 m/s straight line sampled at an exact 10 Hz,
// which hides every sender-frame-rate and acceleration/turn artefact; this one drives a curving, accelerating
// car from a sender whose frames are 15 fps and uneven.
//
//   node tools/mp-link-sim.mjs [--sender-fps=15] [--net=bad|lan|none] [--seconds=24] [--json]
//
// Importing this module never touches globals; `runLink` swaps Date.now/performance.now only while it runs.
import { createGameCore } from '../server/core.mjs';
import * as protocol from '../src/multiplayer-protocol.js';
import { StateSender } from '../src/multiplayer-state.js';
// Namespace imports: the simulator also runs against older trees (to reproduce a bug before its fix), which lack the new exports.
import * as timeline from '../src/remote-timeline.js';
import * as contact from '../src/multiplayer-contact.js';
const { receiveRemoteSnapshot, applyRemotePose, remoteContactPose } = timeline, { resolvePlayerContacts, ContactCoordinator } = contact;
import { fileURLToPath } from 'node:url';

export const NET = {
  none: { base: 0, jitter: 0, loss: 0, rto: 0 },
  lan: { base: 15, jitter: 5, loss: 0, rto: 0 },
  // 150 ms round trip +/- 50 ms of jitter, 1.5 % stalls: the same link read as RTT rather than one-way.
  rtt150: { base: 75, jitter: 50, loss: .015, rto: 300 },
  mid: { base: 60, jitter: 20, loss: 0, rto: 0 },
  // 150 ms +/- 50 ms each way, 1.5 % of messages stall the stream for a 300 ms retransmit (TCP head-of-line blocking).
  bad: { base: 150, jitter: 50, loss: .015, rto: 300 },
};
export const rng = seed => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };

/** A curving, accelerating car: speed swings 17-33 m/s and the yaw rate changes sign every couple of seconds. */
export function curvyPath(ms) {
  const n = Math.ceil(ms) + 2000, x = new Float64Array(n), z = new Float64Array(n), yaw = new Float64Array(n), v = new Float64Array(n), s = new Float64Array(n), w = new Float64Array(n);
  let px = 0, pz = 0, py = 0, ps = 0;
  for (let i = 0; i < n; i++) {
    const t = i / 1000, speed = 25 + 8 * Math.sin(2 * Math.PI * t / 9), rate = .30 * Math.sin(2 * Math.PI * t / 5) + .12 * Math.sin(2 * Math.PI * t / 2.1);
    x[i] = px; z[i] = pz; yaw[i] = py; v[i] = speed; s[i] = ps; w[i] = rate;
    px += -Math.sin(py) * speed / 1000; pz += -Math.cos(py) * speed / 1000; py += rate / 1000; ps += speed / 1000;
  }
  const at = t => { const f = Math.max(0, Math.min(n - 2, t)), i = Math.floor(f), k = f - i, l = (a, b) => a[i] + (b[i + 1] - a[i]) * k; return { x: l(x, x), z: l(z, z), yaw: l(yaw, yaw), vLong: l(v, v), s: l(s, s), w: l(w, w) }; };
  return at;
}
export const stateOf = (p, extra = {}) => ({ x: p.x, y: 0, z: p.z, yaw: p.yaw, s: p.s, u: 0, vLong: p.vLong, vLat: 0, steer: p.w * .5, rpm: 3000 + p.vLong * 40, gear: 3, reverse: false, nitro: 0, damage: { front: 0, rear: 0, left: 0, right: 0 }, ...extra });

function link(random, { base, jitter, loss, rto }) {
  let last = 0; const queue = [];
  return {
    messages: 0, bytes: 0,
    send(at, payload) {
      this.messages++; this.bytes += payload.length;
      let arrival = at + base + (random() * 2 - 1) * jitter;
      if (loss && random() < loss) arrival += rto; // a lost segment holds everything behind it (in-order delivery)
      arrival = Math.max(last, arrival); last = arrival; queue.push({ arrival, payload });
    },
    drain(now, fn) { while (queue.length && queue[0].arrival <= now) fn(queue.shift().payload); },
  };
}

/** Frame clock with the uneven spacing of a struggling machine. */
function frames(random, fps, spread) { let next = 0; return now => { if (now + .001 < next) return false; next = Math.max(next + 1, now) + (1000 / fps) * (1 + (random() * 2 - 1) * spread); return true; }; }

export function runLink({ senderFps = 60, receiverFps = 60, net = NET.bad, seconds = 24, seed = 7, warmup = 4, path = curvyPath, relayMs = protocol.RELAY_MS ?? 100, spread = .2, events = [] } = {}) {
  const realNow = Date.now, realPerf = performance.now; let now = 0; const BASE = 1.7e12, SENDER_SKEW = 7777;
  Date.now = () => BASE + now; performance.now = () => now;
  try {
    const random = rng(seed), truth = path(seconds * 1000 + 3000);
    const map = { id: 'riviera', name: 'sim', track: { start: 0, finish: 100000, version: 'v1' }, definitions: new Map([['quick', { id: 'quick', name: 'sim', type: 'sprint', s0: 0, s1: 100000, dir: 1, len: 100000 }]]) };
    const core = createGameCore({ maps: new Map([['riviera', map]]), cars: new Set(['mini']), leaderboard: { submit: async () => {} }, countdownMs: 0 });
    const up = link(random, net), down = link(random, net); let relayAt = null;
    const socket = (id) => ({ readyState: 1, messages: [], send(bytes) { const m = typeof bytes === 'string' ? JSON.parse(bytes) : bytes; this.messages.push(m); if (this.deliver && m.type === 'snapshot') down.send(now, bytes); }, close() {} });
    const a = socket('a'), b = socket('b'); core.connect(a, 'a', { protocol: protocol.MULTIPLAYER_PROTOCOL }); core.connect(b, 'b', { protocol: protocol.MULTIPLAYER_PROTOCOL });
    const send = (ws, m) => core.message(ws, JSON.stringify(m));
    send(a, { type: 'create' }); send(b, { type: 'join', code: a.messages.findLast(m => m.type === 'lobby').lobby.code });
    for (const ws of [a, b]) send(ws, { type: 'ready', ready: true, version: 'v1' }); send(a, { type: 'start' }); core.tick();
    const lobby = a.messages.findLast(m => m.type === 'lobby').lobby, driverId = a.messages[0].id; b.deliver = true;
    const timers = new Map(); let serial = 0;
    const batching = protocol.STATE_BATCHING ?? false;
    const sender = new StateSender(packet => up.send(now, JSON.stringify(packet)), { now: () => now + SENDER_SKEW, schedule: (fn, delay) => { const id = ++serial; timers.set(id, { at: now + delay, fn }); return id; }, cancel: id => timers.delete(id) });
    const peers = new Map(), members = [{ id: driverId, car: 'mini', connected: true, finish: null }];
    const senderFrame = frames(random, senderFps, spread), receiverFrame = frames(random, receiverFps, spread);
    const out = [], senderFrames = []; let firstSeen = null;
    const end = seconds * 1000;
    for (now = 0; now <= end; now++) {
      for (const e of events) if (!e.done && now >= e.at) { e.done = true; e.run({ sender, now }); } // scripted driver events (a tow bumps the motion epoch)
      if (senderFrame(now)) { const p = truth(now); senderFrames.push(now); sender.sample(stateOf(p), lobby.raceId, { batching }); }
      for (const [id, timer] of timers) if (timer.at <= now) { timers.delete(id); timer.fn(); }
      up.drain(now, text => { core.message(a, text); if (relayAt === null && [...core.lobbies.values()].some(l => l.dirty)) relayAt = now + relayMs; });
      if (relayAt !== null && now >= relayAt) { relayAt = null; core.tick(); }
      down.drain(now, text => { const m = JSON.parse(text); receiveRemoteSnapshot(peers, m, { id: 'observer', members, receivedAt: now, networkDelay: net.base }); });
      if (receiverFrame(now)) {
        const peer = peers.get(driverId), t = truth(now);
        if (!peer) { out.push({ t: now, truth: t, shown: null }); continue; }
        const v = { x: 0 }; applyRemotePose(peer, v, now, false); firstSeen ??= now;
        out.push({ t: now, truth: t, shown: { x: v.x, z: v.z, yaw: v.yaw, s: v.s }, mode: peer.timeline?.mode, delay: peer.timeline?.delay });
      }
    }
    sender.reset();
    const wire = { upMsgPerSec: round(up.messages / seconds, 1), upBytesPerSec: Math.round(up.bytes / seconds), downMsgPerSec: round(down.messages / seconds, 1), downBytesPerSec: Math.round(down.bytes / seconds) };
    return { wire, frames: out.filter(f => f.t >= warmup * 1000), all: out, senderFrames, truth, firstSeen, stats: { ...analyse(out.filter(f => f.t >= warmup * 1000), truth), wire, delayMs: round(out.filter(f => f.delay).reduce((a, f, i, l) => a + f.delay / l.length, 0), 0) } };
  } finally { Date.now = realNow; performance.now = realPerf; }
}

const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN; };
const round = (n, d = 3) => Number.isFinite(n) ? Math.round(n * 10 ** d) / 10 ** d : n;
/** Smoothness of a drawn path: frame-to-frame speed against its own half-second average, and jerk. */
export function pathMetrics(points, window = 500) {
  const v = [], t = [];
  for (let i = 1; i < points.length; i++) { const dt = (points[i].t - points[i - 1].t) / 1000; if (dt > 0) { v.push(Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z) / dt); t.push(points[i].t); } }
  const dev = [], stalls = []; let maxJump = 0;
  for (let i = 0; i < v.length; i++) {
    let sum = 0, n = 0; for (let j = i; j >= 0 && t[i] - t[j] <= window / 2; j--) { sum += v[j]; n++; } for (let j = i + 1; j < v.length && t[j] - t[i] <= window / 2; j++) { sum += v[j]; n++; }
    const avg = sum / n; dev.push(Math.abs(v[i] - avg) / Math.max(avg, 1)); stalls.push(v[i] < .25 * avg ? 1 : 0);
    const dt = i ? (t[i] - t[i - 1]) / 1000 : 1 / 60; maxJump = Math.max(maxJump, (v[i] - avg) * dt);
  }
  const jerk = []; for (let i = 2; i < v.length; i++) { const dt1 = (t[i] - t[i - 1]) / 1000, dt0 = (t[i - 1] - t[i - 2]) / 1000; if (dt1 > 0 && dt0 > 0 && i > 2) jerk.push(((v[i] - v[i - 1]) / dt1 - (v[i - 1] - v[i - 2]) / dt0) / dt1); }
  return { frames: v.length, speedDevP50: round(pct(dev, .5)), speedDevP95: round(pct(dev, .95)), speedDevMax: round(Math.max(...dev)), stallPct: round(100 * stalls.reduce((x, y) => x + y, 0) / stalls.length, 2), maxStepM: round(maxJump), jerkRms: round(Math.sqrt(jerk.reduce((x, y) => x + y * y, 0) / jerk.length), 1), jerkP99: round(pct(jerk.map(Math.abs), .99), 1) };
}
export function analyse(rows, truth) {
  const shown = rows.filter(r => r.shown);
  const err = shown.map(r => Math.hypot(r.shown.x - r.truth.x, r.shown.z - r.truth.z));
  // Effective render lag: the time shift of the true path that best explains what is drawn. The residual at that shift is
  // the part that is NOT latency, i.e. the positional noise of the drawn path.
  let best = { lag: 0, rms: Infinity };
  for (let lag = 0; lag <= 700; lag += 5) { const rms = Math.sqrt(shown.reduce((a, r) => { const q = truth(r.t - lag); return a + (r.shown.x - q.x) ** 2 + (r.shown.z - q.z) ** 2; }, 0) / shown.length); if (rms < best.rms) best = { lag, rms }; }
  const drawn = pathMetrics(shown.map(r => ({ t: r.t, x: r.shown.x, z: r.shown.z }))), real = pathMetrics(shown.map(r => ({ t: r.t, x: r.truth.x, z: r.truth.z })));
  return { samples: shown.length, errMean: round(err.reduce((x, y) => x + y, 0) / err.length, 2), errP95: round(pct(err, .95), 2), errMax: round(Math.max(...err), 2), lagMs: best.lag, noiseRmsM: round(best.rms, 3), drawn, truth: real };
}


// Two real drivers on a straight road. The attacker comes up behind the victim at `closing` m/s faster and rear-ends it. Each
// client simulates only its own car (constant speed until a contact changes it), draws/tests the other from the real intake,
// and sends its own state through the real core. `mode: 'legacy'` is the old code path (each side tests the other's DRAWN pose,
// nothing is reported); 'symmetric' is the new one (present-pose tests + relayed reports).
export function runCollision({ attacker = 'B', closing = 10, fps = { A: 60, B: 60 }, net = NET.rtt150, masses = { A: 1500, B: 1500 }, mode = 'symmetric', seed = 3, baseSpeed = 20, seconds = 16, settle = 3 } = {}) {
  const realNow = Date.now, realPerf = performance.now; let now = 0; const BASE = 1.7e12;
  Date.now = () => BASE + now; performance.now = () => now;
  try {
    const random = rng(seed), victim = attacker === 'A' ? 'B' : 'A';
    const map = { id: 'riviera', name: 'sim', track: { start: 0, finish: 100000, version: 'v1' }, definitions: new Map([['quick', { id: 'quick', name: 'sim', type: 'sprint', s0: 0, s1: 100000, dir: 1, len: 100000 }]]) };
    const core = createGameCore({ maps: new Map([['riviera', map]]), cars: new Set(['mini']), leaderboard: { submit: async () => {} }, countdownMs: 0 });
    let relayAt = null; const clients = {};
    const gap = closing * (settle + 2.5) + 4.4 + 2;
    for (const name of ['A', 'B']) {
      const c = clients[name] = { name, up: link(random, net), down: link(random, net), peers: new Map(), timers: new Map(), serial: 0, frame: frames(random, fps[name], .2), last: 0, impacts: [], contacts: new Map(), hits: [] };
      c.ws = { readyState: 1, send: bytes => { const m = JSON.parse(bytes); if (m.type === 'snapshot') c.down.send(now, bytes); else if (m.type === 'contact') c.down.send(now, bytes); }, close() {} };
      core.connect(c.ws, name, { protocol: protocol.MULTIPLAYER_PROTOCOL });
      c.id = core.clientData(c.ws).id;
    }
    const msg = (ws, m) => core.message(ws, JSON.stringify(m));
    msg(clients.A.ws, { type: 'create' }); msg(clients.B.ws, { type: 'join', code: [...core.lobbies.keys()][0] });
    for (const n of ['A', 'B']) msg(clients[n].ws, { type: 'ready', ready: true, version: 'v1' });
    msg(clients.A.ws, { type: 'start' }); core.tick();
    const lobby = core.publicLobby([...core.lobbies.values()][0]), raceId = lobby.raceId, generation = lobby.generation;
    for (const n of ['A', 'B']) {
      const c = clients[n], isAttacker = n === attacker;
      c.speed0 = baseSpeed + (isAttacker ? closing : 0);
      c.v = { x: 0, y: 0, z: isAttacker ? gap : 0, yaw: 0, s: 0, u: 0, vLong: c.speed0, vLat: 0, steer: 0, rpm: 3000, gear: 3, halfW: .9, halfL: 2.2, m: masses[n], hcg: .5, w: 0, impactDynamics(i) { c.impacts.push({ at: now, dv: i.dv }); }, addDamage() {} };
      c.other = clients[n === 'A' ? 'B' : 'A'];
      c.sender = new StateSender(packet => c.up.send(now, JSON.stringify({ ...packet, generation })), { now: () => now + (n === 'A' ? 1234 : 9876), schedule: (fn, delay) => { const id = ++c.serial; c.timers.set(id, { at: now + delay, fn }); return id; }, cancel: id => c.timers.delete(id) });
      c.coordinator = new ContactCoordinator({ send: ev => c.up.send(now, JSON.stringify({ type: 'contact', raceId, generation, ...ev })) });
      c.coordinator.reset(raceId);
      c.render = { ...c.v }; c.proxy = { halfW: .9, halfL: 2.2, m: masses[c.other?.name ?? 'A'], hcg: .5, y: 0 };
    }
    const batching = protocol.STATE_BATCHING ?? false, net0 = net.base;
    const end = seconds * 1000; let sampleFrom = 0;
    for (now = 0; now <= end; now++) {
      for (const n of ['A', 'B']) {
        const c = clients[n], v = c.v;
        v.x += -Math.sin(v.yaw) * v.vLong / 1000 + Math.cos(v.yaw) * v.vLat / 1000; v.z += -Math.cos(v.yaw) * v.vLong / 1000 - Math.sin(v.yaw) * v.vLat / 1000; v.s = 0;
        if (c.frame(now)) {
          const dt = Math.min(.5, (now - c.last) / 1000); c.last = now;
          const peer = c.peers.get(c.other.id);
          if (peer && now > 1500) {
            c.proxy.m = masses[c.other.name];
            if (mode === 'legacy') {
              const drawn = { ...c.proxy }; applyRemotePose(peer, drawn, now, false);
              const hits = resolvePlayerContacts(v, [{ id: c.other.id, vehicle: drawn, age: now - peer.at, ghost: false }], dt, now, c.contacts); c.hits.push(...hits.map(h => ({ ...h, at: now })));
            } else {
              const ahead = remoteContactPose(peer, now), proxy = Object.assign(c.proxy, { x: ahead.x, z: ahead.z, yaw: ahead.yaw, vLong: ahead.vLong, vLat: ahead.vLat, stale: ahead.stale === true });
              const hits = c.coordinator.step(v, [{ id: c.other.id, vehicle: proxy, age: ahead.parked ? 0 : now - peer.at, ghost: false }], dt, now, { rtt: 2 * net0 }); c.hits.push(...hits.map(h => ({ ...h, at: now, proxy: { z: proxy.z, vLong: proxy.vLong, own: v.z, ownV: v.vLong, n: peer.timeline.samples.length, stale: proxy.stale, age: now - peer.at, late: now - peer.timeline.samples.at(-1).receivedAt, held: peer.timeline.samples.at(-1).held, net: peer.timeline.samples.at(-1).net, moving: peer.timeline.isMoving(false) } })));
            }
          }
          c.sender.sample({ x: v.x, y: v.y, z: v.z, yaw: v.yaw, s: v.s, u: 0, vLong: v.vLong, vLat: v.vLat, steer: 0, rpm: 3000, gear: 3, reverse: false, nitro: 0, damage: { front: 0, rear: 0, left: 0, right: 0 } }, raceId, { batching });
        }
        for (const [id, timer] of c.timers) if (timer.at <= now) { c.timers.delete(id); timer.fn(); }
        c.up.drain(now, text => { core.message(c.ws, text); if (relayAt === null && [...core.lobbies.values()].some(l => l.dirty)) relayAt = now + (protocol.RELAY_MS ?? 100); });
      }
      if (relayAt !== null && now >= relayAt) { relayAt = null; core.tick(); }
      for (const n of ['A', 'B']) {
        const c = clients[n];
        c.down.drain(now, text => {
          const m = JSON.parse(text);
          if (m.type === 'snapshot') receiveRemoteSnapshot(c.peers, m, { id: c.id, members: [{ id: c.other.id, car: 'mini', connected: true, finish: null }], receivedAt: now, networkDelay: net0 });
          else if (m.type === 'contact' && mode !== 'legacy') { const known = c.peers.get(c.other.id)?.state, hit = c.coordinator.receive(m, c.v, now, { rtt: 2 * net0, knownVelocity: known ? { x: -Math.sin(known.yaw) * known.vLong, z: -Math.cos(known.yaw) * known.vLong } : null }); if (hit) c.hits.push({ ...hit, at: now, reported: true }); }
        });
      }
    }
    const result = {};
    for (const n of ['A', 'B']) { const c = clients[n]; result[n] = { m: masses[n], v0: c.speed0, v1: c.v.vLong, dv: c.v.vLong - c.speed0, applications: c.impacts.filter(i => i.dv > .2).length, firstAt: c.impacts[0]?.at ?? null, reported: c.hits.filter(h => h.reported).length }; }
    const a = result[attacker], b = result[victim], expect = closing / (a.m + b.m);
    const expectedAttacker = -closing * b.m / (a.m + b.m), expectedVictim = closing * a.m / (a.m + b.m);
    if (arguments[0]?.debug) for (const n of ['A','B']) console.log(n, clients[n].hits.map(h => `t${h.at} c${h.closing.toFixed(1)} i${h.impulse.toFixed(1)}${h.reported?' R':''} ${JSON.stringify(h.proxy||{})}`).join(' | '));
    if (arguments[0]?.debug) for (const n of ['A','B']) console.log(n, JSON.stringify(clients[n].coordinator.stats));
    return { attacker, closing, mode, fps, result, attackerDv: a.dv, victimDv: b.dv, expectedAttacker, expectedVictim, momentumError: a.m * a.dv + b.m * b.dv, applications: [a.applications, b.applications], contactStart: [result[attacker].firstAt, result[victim].firstAt] };
  } finally { Date.now = realNow; performance.now = realPerf; }
}

if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv.includes('--collision')) {
  const arg = (k, d) => process.argv.find(a => a.startsWith(`--${k}=`))?.split('=')[1] ?? d;
  const rows = [];
  for (const mode of ['legacy', 'symmetric']) for (const closing of [4, 10, 20]) for (const attacker of ['A', 'B']) {
    const r = runCollision({ mode, closing, attacker, fps: { A: attacker === 'A' ? 60 : 15, B: attacker === 'B' ? 60 : 15 }, net: NET[arg('net', 'rtt150')] });
    rows.push(`${mode.padEnd(9)} closing ${String(closing).padStart(2)} attacker ${attacker}(60fps) victim 15fps | attacker dv ${r.attackerDv.toFixed(2)} (want ${r.expectedAttacker.toFixed(2)}) victim dv ${r.victimDv.toFixed(2)} (want ${r.expectedVictim.toFixed(2)}) | applications ${r.applications.join('/')} | first contact t=${r.contactStart.join('/')}`);
  }
  console.log(rows.join('\n'));
}
else if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = (k, d) => process.argv.find(a => a.startsWith(`--${k}=`))?.split('=')[1] ?? d;
  const result = runLink({ senderFps: +arg('sender-fps', 15), receiverFps: +arg('receiver-fps', 60), net: NET[arg('net', 'bad')], seconds: +arg('seconds', 24), seed: +arg('seed', 7) });
  console.log(JSON.stringify({ senderFps: +arg('sender-fps', 15), net: arg('net', 'bad'), firstSeenMs: result.firstSeen, ...result.stats }, null, 1));
}
