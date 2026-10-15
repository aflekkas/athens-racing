import { snapshotBody, snapshotCar, restoreBody, bodyTransfers, packRagdolls, unpackRagdolls } from './ragdoll-snapshot.js';
// One lazy worker per crowd, at most one job per body and four queued render frames. Overflow/error replays
// unacknowledged steps from the last exact checkpoint on the main thread, without skipping simulation time.
export class RagdollClient {
  constructor(ground, factory = null) {
    this.ground = ground; this.factory = factory || (() => new Worker(new URL('./ragdoll-worker.js', import.meta.url), { type: 'module' })); this.worker = null; // Opt in with ?workerRagdolls=1: exact terrain round trips currently cost more CPU than the small solver.
    this.disabled = !factory && (typeof Worker === 'undefined' || new URLSearchParams(globalThis.location?.search || '').get('workerRagdolls') !== '1');
    this.slots = new Map(); this.jobs = new Map(); this.serial = 0; this.pending = []; this.transfers = [];
  }
  advance(b, dt) {
    if (!b.active || b.kind === 'rider' || this.disabled) { b.update(dt, this.ground); return; }
    if (!this.worker) {
      try { this.worker = this.factory(); this.worker.onmessage = e => { for (const m of unpackRagdolls(e.data)) this.receive(m); }; this.worker.onerror = e => { e.preventDefault?.(); this.fallback(); }; this.worker.onmessageerror = () => this.fallback(); }
      catch { this.fallback(); b.update(dt, this.ground); return; }
    }
    let slot = this.slots.get(b);
    if (!slot) { slot = { b, queue: [], id: null, from: b.p.slice(), display: b.p.slice(), at: 0, key: ++this.serial, initialized: false }; this.slots.set(b, slot); }
    slot.queue.push({ dt, car: snapshotCar(b.car) });
    if (slot.queue.length > 4) { this.fallback(); return; }
    if (slot.id === null) this.start(slot);
  }
  start(slot) {
    const state = slot.initialized ? null : snapshotBody(slot.b), job = slot.queue[0], id = ++this.serial; slot.initialized = true;
    slot.id = id; this.jobs.set(id, slot);
    try { this.post({ type: 'step', id, key: slot.key, dt: job.dt, car: job.car, state }, state ? bodyTransfers(state) : []); }
    catch { this.fallback(); }
  }
  post(message, transfer = []) {
    this.pending.push(message); this.transfers.push(...transfer);
    if (this.pending.length === 1) queueMicrotask(() => {
      const messages = this.pending, buffers = this.transfers; this.pending = []; this.transfers = [];
      if (this.worker && messages.length) try { const packed = packRagdolls(messages); this.worker.postMessage(packed, [packed.data.buffer]); } catch { this.fallback(); }
    });
  }
  receive(m) {
    const slot = this.jobs.get(m.id); if (!slot) return;
    if (m.type === 'ground') {
      const floor = new Float64Array(16), proxy = { groundS: m.groundS };
      try {
        for (let i = 0; i < 16; i++) floor[i] = this.ground(m.p[i*3], m.p[i*3+2], proxy);
        this.post({ type: 'ground', id: m.id, floor, groundS: proxy.groundS }, [floor.buffer]);
      } catch { this.fallback(); }
    } else if (m.type === 'done') {
      slot.from.set(slot.display); restoreBody(slot.b, m.state, true); slot.at = performance.now();
      this.jobs.delete(m.id); slot.id = null; slot.queue.shift();
      if (slot.queue.length) this.start(slot);
    }
  }
  positions(b) {
    const slot = this.slots.get(b); if (!slot || !slot.at) return b.p;
    const alpha = Math.min(1, Math.max(0, (performance.now() - slot.at) / (1000 / 60)));
    for (let i = 0; i < 48; i++) slot.display[i] = slot.from[i] + (b.p[i] - slot.from[i]) * alpha;
    return slot.display;
  }
  reset(b) {
    const slot = this.slots.get(b); if (!slot) return;
    this.post({ type: 'cancel', id: slot.id, key: slot.key });
    if (slot.id !== null) this.jobs.delete(slot.id);
    this.slots.delete(b);
  }
  fallback() {
    this.pending = []; this.transfers = [];
    this.disabled = true; this.worker?.terminate(); this.worker = null; this.jobs.clear();
    for (const { b, queue } of this.slots.values()) for (const job of queue) {
      const local = b.car;
      if (b.car) b.car = job.car;
      b.update(job.dt, this.ground);
      if (b.car) b.car = local;
    }
    this.slots.clear();
  }
  clear() { this.pending = []; this.transfers = []; this.worker?.terminate(); this.worker = null; this.jobs.clear(); this.slots.clear(); }
}
