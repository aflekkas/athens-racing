// Axes prefer unordered, zero-retry WebRTC; signalling and fallback share the room WebSocket.
export class WheelLink {
  constructor({ code, role, token, onPacket = () => {}, onData = () => {}, onStatus = () => {}, WebSocket = globalThis.WebSocket, RTCPeerConnection = globalThis.RTCPeerConnection, base = globalThis.location?.href }) {
    Object.assign(this, { role, onPacket, onData, onStatus, RTCPeerConnection });
    this.state = 'Connecting'; this.latency = null; this.paired = false; this.candidates = []; this.pendingPings = new Map();
    const url = new URL('/api/wheel/ws', base); url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.search = new URLSearchParams({ c: code, role, ...(token ? { token } : {}) });
    this.ws = new WebSocket(url); this.ws.binaryType = 'arraybuffer';
    this.ws.onmessage = event => this.message(event.data);
    this.ws.onclose = () => this.dispose('Disconnected · pair again');
    this.ws.onerror = () => this.status('Connection failed');
    this.timer = setInterval(() => {
      if (!this.paired) return;
      if (this.channel?.readyState === 'open' && performance.now() - (this.lastPong || 0) > 1800) this.dropPeer();
      const id = performance.now(); this.pendingPings.set(id, id);
      for (const [key, at] of this.pendingPings) if (id - at > 5000) this.pendingPings.delete(key);
      this.send({ ping: id });
    }, 500);
  }
  status(state = this.state) { this.state = state; this.onStatus({ state, latency: this.latency, paired: this.paired, transport: this.channel?.readyState === 'open' ? 'P2P' : 'WebSocket' }); }
  relay(value) { if (this.ws.readyState === 1 && this.ws.bufferedAmount < 65536) this.ws.send(JSON.stringify(value)); }
  send(data) {
    if (!this.paired) return;
    if (this.channel?.readyState === 'open' && this.channel.bufferedAmount < 65536) {
      try { this.channel.send(data instanceof ArrayBuffer ? data : JSON.stringify(data)); return; } catch { this.dropPeer(); }
    }
    if (data instanceof ArrayBuffer) { if (this.ws.readyState === 1 && this.ws.bufferedAmount < 65536) this.ws.send(data); }
    else this.relay({ type: 'data', data });
  }
  async message(message) {
    if (typeof message !== 'string') { this.onPacket(message); return; }
    let value; try { value = JSON.parse(message); } catch { return; }
    if (value.type === 'unpaired') { this.dispose('Disconnected · pair again'); this.ws.close(1000); return; }
    if (value.type === 'paired') { this.paired = true; this.status('Connected'); if (this.role === 'phone') await this.startPeer(); }
    else if (value.type === 'signal') { try { await this.signal(value.data); } catch { this.dropPeer(); } }
    else if (value.type === 'data') this.data(value.data);
  }
  data(data) {
    if (!data || typeof data !== 'object') return;
    if (Number.isFinite(data.ping)) { this.send({ pong: data.ping }); return; }
    if (this.pendingPings.has(data.pong)) {
      this.latency = Math.max(0, performance.now() - this.pendingPings.get(data.pong)); this.pendingPings.delete(data.pong); this.lastPong = performance.now(); this.status(); return;
    }
    this.onData(data);
  }
  peer() {
    if (this.pc) return this.pc;
    const pc = this.pc = new this.RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    pc.onicecandidate = event => { if (event.candidate) this.relay({ type: 'signal', data: { candidate: event.candidate.toJSON() } }); };
    pc.ondatachannel = event => this.bindChannel(event.channel);
    pc.onconnectionstatechange = () => { if (['failed', 'closed', 'disconnected'].includes(pc.connectionState)) this.dropPeer(); };
    return pc;
  }
  bindChannel(channel) {
    this.channel = channel; channel.binaryType = 'arraybuffer';
    channel.onopen = () => { this.lastPong = performance.now(); this.status('Connected'); };
    channel.onclose = () => { if (this.channel === channel) { this.channel = null; this.status('Connected'); } };
    channel.onerror = () => this.dropPeer();
    channel.onmessage = event => {
      if (typeof event.data !== 'string') this.onPacket(event.data);
      else { try { this.data(JSON.parse(event.data)); } catch {} }
    };
  }
  async startPeer() {
    try {
      const pc = this.peer(); this.bindChannel(pc.createDataChannel('wheel', { ordered: false, maxRetransmits: 0 }));
      await pc.setLocalDescription(await pc.createOffer()); this.relay({ type: 'signal', data: { description: pc.localDescription } });
    } catch { this.dropPeer(); }
  }
  async signal(data) {
    if (!data || !this.RTCPeerConnection) return;
    const pc = this.peer();
    if (data.description) {
      await pc.setRemoteDescription(data.description);
      for (const candidate of this.candidates.splice(0)) await pc.addIceCandidate(candidate);
      if (data.description.type === 'offer') { await pc.setLocalDescription(await pc.createAnswer()); this.relay({ type: 'signal', data: { description: pc.localDescription } }); }
    } else if (data.candidate) { if (pc.remoteDescription) await pc.addIceCandidate(data.candidate); else if (this.candidates.length < 64) this.candidates.push(data.candidate); }
  }
  dropPeer() { const pc = this.pc; this.pc = null; this.channel = null; if (pc) { pc.onconnectionstatechange = null; pc.close(); } this.status(); }
  close() { this.relay({ type: 'unpair' }); this.dispose('Disconnected'); this.ws.close(); }
  dispose(state) { clearInterval(this.timer); this.paired = false; this.latency = null; this.dropPeer(); this.status(state); this.onPacket(null); }
}
