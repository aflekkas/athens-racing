import { worldOwner, worldPackets, WorldAssembler, validConeRow, nearestWorldS } from '../src/shared-world-protocol.js';

export function createSharedWorldRelay(send, { period = () => 0 } = {}) {
  const assemblers = new WeakMap(), contacts = new WeakMap();
  const matches = (l, m) => l && ['countdown', 'race'].includes(l.status) && m.raceId === l.raceId && m.generation === (l.generation || 0);
  const cached = l => l.sharedWorld?.raceId === l.raceId && l.sharedWorld.generation === (l.generation || 0) ? l.sharedWorld : null;
  const deliver = (ws, l) => {
    const frame = cached(l); if (!frame) return;
    for (const packet of worldPackets({ ...frame, now: Date.now() }, frame.rows, frame.cones)) send(ws, packet);
  };
  return {
    deliver,
    frame(c, l, m, now) {
      if (!matches(l, m) || worldOwner(l) !== c.id || Math.abs(m.at - now) > 2000) return false;
      let assembler = assemblers.get(l);
      if (!assembler) { assembler = new WorldAssembler(); assemblers.set(l, assembler); }
      const full = assembler.accept({ ...m, owner: c.id }); if (!full) return false;
      // A complete snapshot is atomic. Never expose half a fleet or clear cars
      // because a chunk was lost during a reconnect.
      const prior = cached(l);
      if (prior?.owner === c.id && now - (l.worldAcceptedAt || 0) < 120) return false;
      const { raceId, generation, owner, seq, at, rows, cones } = full;
      let packets;
      try { packets = worldPackets({ raceId, generation, owner, seq, at, now }, rows, cones).map(p => JSON.stringify(p)); }
      catch { return false; }
      l.worldAcceptedAt = now;
      l.sharedWorld = { raceId, generation, owner, seq, at, rows, cones };
      // Encode once for fan-out, rather than once per recipient.
      for (const p of l.players.values()) for (const packet of packets) send(p.ws, packet);
      return true;
    },
    contact(c, l, m, now) {
      if (!matches(l, m) || !c.loaded || !c.state || !Number.isSafeInteger(m.nonce) || !Number.isFinite(m.at) || Math.abs(m.at - now) > 2000) return false;
      const owner = worldOwner(l), target = l.players.get(owner);
      if (!target || owner === c.id) return false; // authority already applied its own contact
      const body = m.body;
      if (!Array.isArray(body) || !body.every(Number.isSafeInteger)) return false;
      let state = contacts.get(c);
      if (!state || state.raceId !== l.raceId) { state = { raceId: l.raceId, nonce: -1, at: now, count: 0 }; contacts.set(c, state); }
      if (m.nonce <= state.nonce) return false;
      if (now - state.at >= 1000) { state.at = now; state.count = 0; }
      if (++state.count > 12) return false;
      if (m.kind === 'car') {
        if (body.length !== 9 || body[0] < 0 || body[0] >= 66 || body.slice(1, 3).some(n => Math.abs(n) > 300) || body.slice(3, 5).some(n => Math.abs(n) > 6000) || Math.abs(body[5]) > 10000 || body[6] < 0 || body[6] > 6000 || body[7] < 0 || body[7] > 3 || body[8] < 0 || body[8] > 10000) return false;
        const row = cached(l)?.rows.find(r => r[0] === body[0]);
        if (!row || Math.abs(nearestWorldS(row[1] / 100, c.state.s, period(l)) - c.state.s) > 30 || Math.abs(row[2] / 100 - c.state.u) > 12) return false;
      } else if (m.kind === 'cone') {
        if (!validConeRow(body) || Math.abs(nearestWorldS(body[1] / 100, c.state.s, period(l)) - c.state.s) > 20 || Math.abs(body[2] / 100 - c.state.u) > 8) return false;
      } else return false;
      state.nonce = m.nonce;
      send(target.ws, { type: 'world-contact', raceId: l.raceId, generation: l.generation || 0, playerId: c.id, kind: m.kind, nonce: m.nonce, body, at: now });
      return true;
    }
  };
}
