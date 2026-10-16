import { Ragdoll, STEP } from './impact-ragdoll.js';
import { snapshotBody, restoreBody, bodyTransfers, packRagdolls, unpackRagdolls } from './ragdoll-snapshot.js';
// Ground stays in the map owner: the same callback is evaluated at the exact integrated joint positions,
// in joint order, before each constraint solve. No terrain approximation or shared mutable state.
export function createRagdollWorker(post) {
  const jobs = new Map(), bodies = new Map();
  return message => {
    const { type, id } = message;
    if (type === 'cancel') { bodies.delete(message.key); jobs.delete(id); return; }
    if (type === 'step') {
      let b = bodies.get(message.key);
      if (message.state) { b = new Ragdoll(); restoreBody(b, message.state); bodies.set(message.key, b); }
      if (b.car) b.car = message.car;
      const job = { b, id, key: message.key }; jobs.set(id, job);
      if (!b.prepareUpdate(message.dt)) { finish(job); return; }
      next(job);
    } else if (type === 'ground') {
      const job = jobs.get(id); if (!job) return;
      job.b.floor.set(message.floor); job.b.groundS = message.groundS;
      job.b.solve(); job.b.acc -= STEP; next(job);
    }
  };
  function next(job) {
    const b = job.b;
    if (b.acc < STEP) { finish(job); return; }
    b.integrate(); const p = b.p.slice();
    post({ type: 'ground', id: job.id, p, groundS: b.groundS }, [p.buffer]);
  }
  function finish(job) {
    jobs.delete(job.id); const state = snapshotBody(job.b, true);
    post({ type: 'done', id: job.id, state }, bodyTransfers(state));
  }
}
// Batch the crowd's messages into one task at each phase, rather than one browser task per body.
export function batchRagdollWorker(post) {
  let pending = [], transfers = [];
  const receive = createRagdollWorker((message, list = []) => {
    pending.push(message); transfers.push(...list);
    if (pending.length === 1) queueMicrotask(() => { const messages = pending, buffers = transfers; pending = []; transfers = []; const packed = packRagdolls(messages); post(packed, [packed.data.buffer]); });
  });
  return packed => { for (const message of unpackRagdolls(packed)) receive(message); };
}
if (typeof self !== 'undefined') {
  const receive = batchRagdollWorker((data, transfer) => self.postMessage(data, transfer));
  self.onmessage = ({ data }) => receive(data);
}
