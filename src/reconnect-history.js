// Local breadcrumbs preserve physical gate crossings across short transport gaps.
// Reuse existing two-state packets and cap replay at20 samples/s (30 handler calls/s).
export const reconnectDelay = attempt => Math.min(8000, 750 * 2 ** Math.min(4, Math.max(0, attempt)));
export class ReconnectHistory {
  constructor() { this.clear(); }
  clear() { this.raceId = null; this.frames = []; this.pending = []; this.replaying = false; this.lastFlush = -Infinity; }
  record(packet) {
    if (this.raceId !== packet.raceId) { this.clear(); this.raceId = packet.raceId; }
    const states = packet.states || [packet.state];
    this.frames.push(...states); if (this.frames.length > 900) this.frames.splice(0, this.frames.length - 900);
    if (this.replaying) this.pending.push(...states);
  }
  resume(accepted) {
    const at = accepted?.sampleTime ?? -Infinity;
    this.pending = this.frames.filter(s => s.sampleTime > at + .001 && (s.motionEpoch ?? 0) >= (accepted?.motionEpoch ?? 0));
    this.replaying = this.pending.length > 0; this.lastFlush = -Infinity;
  }
  flush(send, generation, now) {
    if (!this.replaying || now - this.lastFlush < 100) return;
    this.lastFlush = now;
    const states = this.pending.splice(0, 2).map(s => ({ ...s, sampleAge: Math.min(1000, Math.max(0, now - s.sampleTime)) }));
    if (states.length) send({ type: 'states', raceId: this.raceId, generation, states });
    this.replaying = this.pending.length > 0;
  }
}
