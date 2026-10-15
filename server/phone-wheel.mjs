// Transport-independent room policy, shared by local Node and Cloudflare.
import { WHEEL_BYTES } from '../src/phone-wheel-packet.js';
export const PAIR_TTL = 5 * 60_000, SESSION_TTL = 8 * 60 * 60_000;
export const validWheelCode = code => /^[A-HJ-NP-Z2-9]{8}$/.test(code || '');
export function wheelCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(crypto.getRandomValues(new Uint8Array(8)), b => alphabet[b % 32]).join('');
}
export class WheelRoom {
  constructor({ now = Date.now, data = null } = {}) { this.now = now; this.data = data; this.sockets = new Map(); this.rates = new Map(); }
  create() {
    if (this.data) return null;
    this.data = { token: crypto.randomUUID(), expires: this.now() + PAIR_TTL, paired: false };
    return { ...this.data };
  }
  canJoin(role, token) {
    return !!this.data && this.now() < this.data.expires && ['game', 'phone'].includes(role) && !this.sockets.has(role) &&
      (role !== 'game' || token === this.data.token) && (role !== 'phone' || (this.sockets.has('game') && !this.data.paired));
  }
  join(ws, role, token) {
    if (!this.canJoin(role, token)) return false;
    this.sockets.set(role, ws);
    if (role === 'phone') { this.data.paired = true; this.data.expires = this.now() + SESSION_TTL; for (const socket of this.sockets.values()) socket.send(JSON.stringify({ type: 'paired' })); }
    return true;
  }
  message(ws, message) {
    const role = [...this.sockets].find(([, socket]) => ws === socket)?.[0]; if (!role) return;
    if (this.now() >= this.data.expires) { this.close(); return; }
    let rate = this.rates.get(ws); if (!rate || this.now() - rate.at >= 1000) this.rates.set(ws, rate = { at: this.now(), n: 0 });
    if (++rate.n > 180) { this.close(); return; }
    const other = this.sockets.get(role === 'game' ? 'phone' : 'game');
    if (typeof message !== 'string') {
      if (role !== 'phone' || message.byteLength !== WHEEL_BYTES) return;
    } else {
      if (message.length > 16384) { this.close(); return; }
      let packet; try { packet = JSON.parse(message); } catch { return; }
      if (packet.type === 'unpair') { this.close(); return; }
      if (!['signal', 'data'].includes(packet.type)) return;
    }
    try { if (other?.readyState === 1 && (other.bufferedAmount || 0) < 65536) other.send(message); } catch { this.close(); }
  }
  close() { const sockets = [...this.sockets.values()]; this.sockets.clear(); if (this.data) this.data.expires = this.now(); for (const ws of sockets) {
      try { if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'unpaired' })); } catch {}
      try { ws.close(1000, 'Wheel unpaired or expired'); } catch {}
    } }
}
