// A delayed hello/pong during model loading must not move the world clock back
// by a second. Fresh server stamps bound clock lag; the lowest-RTT ping refines
// the one-way estimate. Expire old ping measurements after a minute.
export class ServerClock {
  constructor() { this.floor = -Infinity; this.offset = null; this.pings = []; }
  observe(serverNow, receivedAt, sent = null) {
    if (!Number.isFinite(serverNow) || !Number.isFinite(receivedAt)) return this.offset;
    this.floor = Math.max(this.floor, serverNow - receivedAt);
    if (this.offset === null) this.offset = this.floor;
    const rtt = receivedAt - sent;
    if (Number.isFinite(sent) && rtt >= 0 && rtt < 30000) this.pings.push({ rtt, offset: serverNow - (sent + receivedAt) / 2, at: receivedAt });
    this.pings = this.pings.filter(p => receivedAt - p.at <= 60000).slice(-16);
    const best = this.pings.reduce((a, p) => !a || p.rtt < a.rtt ? p : a, null);
    this.offset = Math.max(this.floor, best ? Math.min(best.offset, this.floor + 150) : this.offset);
    return this.offset;
  }
}
