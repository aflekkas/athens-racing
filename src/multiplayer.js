// Lobby discovery and the shared race clock. Physics remains responsive on each driver's browser.
export class Multiplayer {
  constructor(cars, callbacks) {
    this.cars = cars; this.callbacks = callbacks; this.room = null; this.playerId = null; this.offset = 0; this.latency = null; this.lastSent = 0; this.pending = false; this.connected = false;
    this.root = document.createElement('section'); this.root.id = 'multiplayer'; this.root.hidden = true;
    this.root.innerHTML = `<div class="mp-panel"><div class="mp-kicker">GLYFADA → LIMANAKIA · ONLINE</div><div class="mp-heading"><h1>RACE TOGETHER</h1><button id="mp-close" aria-label="Close multiplayer">×</button></div><p id="mp-status" role="status" aria-live="polite">Connecting…</p><div id="mp-browser"><div class="mp-profile"><label>DRIVER NAME<input id="mp-name" maxlength="24" autocomplete="nickname" placeholder="Your name"></label><label>YOUR CAR<select id="mp-car"></select></label></div><div class="mp-create"><label>LOBBY NAME<input id="mp-lobby-name" maxlength="36" value="Riviera Sprint"></label><label class="mp-private"><input id="mp-public" type="checkbox" checked> List publicly</label><button id="mp-create">CREATE LOBBY</button></div><form id="mp-join-form" class="mp-join"><label>INVITE CODE<input id="mp-code" maxlength="6" placeholder="ABC123" autocomplete="off"></label><button id="mp-join" type="submit">JOIN BY CODE</button></form><div class="mp-list-title"><h2>PUBLIC LOBBIES</h2><button id="mp-refresh">REFRESH</button></div><div id="mp-lobbies"></div></div><div id="mp-room" hidden><div class="mp-room-title"><h2 id="mp-room-name"></h2><span id="mp-room-code"></span></div><p id="mp-rules">Up to 8 drivers · Clear road · Ghost opponents · Fastest finish wins</p><div id="mp-roster"></div><div id="mp-actions"><button id="mp-ready">READY UP</button><button id="mp-start">START RACE</button><button id="mp-rematch" hidden>BACK TO LOBBY</button><button id="mp-invite">COPY INVITE</button><button id="mp-leave">LEAVE LOBBY</button></div><p id="mp-hint"></p></div></div>`;
    document.body.append(this.root);
    const bar = document.createElement('div'); bar.id = 'mp-bar'; bar.innerHTML = '<button id="mp-open">MULTIPLAYER</button><span id="mp-connection"></span>'; document.body.append(bar);
    const board = document.createElement('div'); board.id = 'mp-standings'; board.hidden = true; document.body.append(board);
    this.$ = id => document.getElementById(id);
    const savedName = localStorage.getItem('paraliaki.driver') || 'Driver'; this.$('mp-name').value = savedName;
    for (const car of cars) { const o = document.createElement('option'); o.value = car.id; o.textContent = car.name; this.$('mp-car').append(o); }
    this.$('mp-open').onclick = () => this.show();
    this.$('mp-close').onclick = () => { this.root.hidden = true; if (!this.room) callbacks.onBrowse(false); };
    this.$('mp-create').onclick = () => this.action({ type: 'create', ...this.profile(), lobbyName: this.$('mp-lobby-name').value, public: this.$('mp-public').checked });
    this.$('mp-join-form').onsubmit = e => { e.preventDefault(); this.join(this.$('mp-code').value); };
    this.$('mp-refresh').onclick = () => { if (this.connected) this.send({ type: 'list' }); else this.connect(); };
    this.$('mp-ready').onclick = () => this.send({ type: 'ready', ready: !this.me?.ready });
    this.$('mp-start').onclick = () => this.send({ type: 'start' });
    this.$('mp-rematch').onclick = () => this.send({ type: 'rematch' });
    this.$('mp-leave').onclick = () => this.send({ type: 'leave' });
    this.$('mp-invite').onclick = async () => {
      const link = new URL(location.href); link.search = ''; link.hash = ''; link.searchParams.set('lobby', this.room.code);
      try { await navigator.clipboard.writeText(link.href); this.status('Invite link copied.'); } catch { this.status('Invite: ' + link.href); }
    };
    this.root.addEventListener('keydown', e => e.stopPropagation());
    this.connect();
    this.pingTimer = setInterval(() => { if (this.connected) this.send({ type: 'ping', sentAt: Date.now() }); }, 3000);
  }
  get me() { return this.room?.players.find(p => p.id === this.playerId); }
  get now() { return Date.now() + this.offset; }
  profile() { const name = this.$('mp-name').value.trim() || 'Driver'; localStorage.setItem('paraliaki.driver', name); return { name, car: this.$('mp-car').value }; }
  status(message, bad = false) { this.$('mp-status').textContent = message; this.$('mp-status').classList.toggle('bad', bad); }
  connect() {
    if (this.ws && this.ws.readyState < 2) return;
    this.status('Connecting to the race server…');
    const url = new URL('/ws', location.href); url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = this.ws = new WebSocket(url);
    const timeout = setTimeout(() => { if (ws.readyState === WebSocket.CONNECTING) ws.close(); }, 8000);
    ws.onopen = () => { clearTimeout(timeout); this.connected = true; this.status('Connected. Create a lobby or join another driver.'); this.$('mp-connection').textContent = 'ONLINE'; this.setPending(false); this.send({ type: 'ping', sentAt: Date.now() }); };
    ws.onmessage = ({ data }) => {
      let m; try { m = JSON.parse(data); } catch { return; }
      if (m.type === 'welcome') { this.playerId = m.playerId; this.offset = m.serverTime - Date.now(); const code = new URLSearchParams(location.search).get('lobby'); if (code && !this.inviteAttempted) { this.inviteAttempted = true; this.show(); this.$('mp-code').value = code; this.join(code); } }
      else if (m.type === 'pong') { const rtt = Date.now() - m.sentAt; this.latency = Math.round(rtt / 2); this.offset = m.serverTime + rtt / 2 - Date.now(); this.$('mp-connection').textContent = `ONLINE · ${this.latency} MS`; }
      else if (m.type === 'lobbies') this.renderLobbies(m.lobbies);
      else if (m.type === 'error') { this.setPending(false); this.status(m.message, true); }
      else if (m.type === 'room') { this.setPending(false); this.room = m.room; this.renderRoom(); this.callbacks.onRoom(this.room); }
      else if (m.type === 'snapshot' && this.room?.raceId === m.raceId) {
        for (const entry of m.players) { const p = this.room.players.find(p => p.id === entry.id); if (p) { Object.assign(p, entry); if (entry.state) p.receivedAt = performance.now(); } }
        this.callbacks.onSnapshot?.(this.room);
      } else if (m.type === 'left') { this.room = null; this.renderRoom(); this.root.hidden = true; this.callbacks.onLeave(); this.send({ type: 'list' }); }
    };
    ws.onerror = () => this.status('Could not connect. Use Refresh to retry.', true);
    ws.onclose = () => {
      clearTimeout(timeout); this.connected = false; this.setPending(false); this.$('mp-connection').textContent = 'OFFLINE';
      const hadRoom = !!this.room; this.room = null; this.renderRoom(); if (hadRoom) { this.callbacks.onLeave(); this.root.hidden = false; this.callbacks.onBrowse(true); }
      this.status('Connection lost. Use Refresh to reconnect and join a lobby again.', true);
    };
  }
  setPending(value) { this.pending = value; for (const id of ['mp-create', 'mp-join']) this.$(id).disabled = value || !this.connected; for (const b of this.$('mp-lobbies').querySelectorAll('button')) b.disabled = value || !this.connected || b.dataset.locked === 'true'; }
  action(message) { if (!this.connected) return this.status('Server is offline. Use Refresh to reconnect.', true); if (this.pending) return; this.setPending(true); this.send(message); }
  send(message) { if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(message)); }
  join(code) { this.action({ type: 'join', code: code.trim().toUpperCase(), ...this.profile() }); }
  show() { this.root.hidden = false; if (!this.room) { this.callbacks.onBrowse(true); this.send({ type: 'list' }); } }
  renderLobbies(lobbies) {
    const el = this.$('mp-lobbies'); el.replaceChildren();
    if (!lobbies.length) { const p = document.createElement('p'); p.className = 'mp-empty'; p.textContent = 'No public lobbies yet. Create one and invite a friend.'; el.append(p); }
    for (const lobby of lobbies) {
      const row = document.createElement('div'); row.className = 'mp-lobby-row';
      const name = document.createElement('b'); name.textContent = lobby.name;
      const detail = document.createElement('span'); detail.textContent = `${lobby.players}/${lobby.capacity} · ${lobby.phase.toUpperCase()}`;
      const button = document.createElement('button'); button.textContent = 'JOIN'; button.dataset.locked = String(lobby.phase !== 'waiting' || lobby.players >= lobby.capacity); button.onclick = () => this.join(lobby.code);
      row.append(name, detail, button); el.append(row);
    }
    this.setPending(this.pending);
  }
  renderRoom() {
    const room = this.room; this.$('mp-browser').hidden = !!room; this.$('mp-room').hidden = !room;
    this.$('mp-close').hidden = !!room && ['waiting', 'results'].includes(room.phase);
    this.$('mp-standings').hidden = !room || ['waiting','results'].includes(room.phase);
    this.$('mp-open').textContent = room ? 'LOBBY · ' + room.code : 'MULTIPLAYER';
    if (!room) return;
    const waiting = room.phase === 'waiting', results = room.phase === 'results', host = room.hostId === this.playerId;
    this.root.hidden = !(waiting || results); this.$('mp-room-name').textContent = room.name; this.$('mp-room-code').textContent = room.code;
    this.$('mp-roster').replaceChildren();
    const sorted = this.sortedPlayers();
    for (const [i,p] of (results ? sorted : room.players).entries()) {
      const row = document.createElement('div'); row.className = 'mp-driver';
      const name = document.createElement('b'); name.textContent = `${results ? (p.dnf ? '—' : i+1) + '. ' : ''}${p.name}${p.id === this.playerId ? ' (YOU)' : ''}${p.id === room.hostId ? ' · HOST' : ''}`;
      const car = document.createElement('span'); car.textContent = this.cars.find(c => c.id === p.car)?.short || p.car;
      const state = document.createElement('strong'); state.textContent = results ? p.finish !== null ? p.finish.toFixed(2) + ' S' : 'DNF' : !p.connected ? 'LEFT' : p.ready ? 'READY' : 'NOT READY'; state.className = p.ready || p.finish !== null ? 'good' : '';
      row.append(name, car, state); this.$('mp-roster').append(row);
    }
    this.$('mp-ready').hidden = !waiting; this.$('mp-ready').textContent = this.me?.ready ? 'NOT READY' : 'READY UP';
    this.$('mp-start').hidden = !waiting || !host; this.$('mp-start').disabled = room.players.length < 2 || room.players.some(p => !p.ready);
    this.$('mp-rematch').hidden = !results || !host;
    this.$('mp-hint').textContent = results ? host ? 'Open the lobby again for a rematch.' : 'Waiting for the host to open a rematch.' : host ? 'Start when at least two drivers are ready.' : 'Ready up. The host starts the race.';
    this.status(results ? 'Race complete · official server times' : waiting ? 'Choose Ready Up when you’re set.' : 'Race in progress.');
  }
  sortedPlayers() { return [...(this.room?.players || [])].sort((a,b) => (a.dnf - b.dnf) || (a.finish !== null ? b.finish !== null ? a.finish - b.finish : -1 : b.finish !== null ? 1 : (b.state?.s || 0) - (a.state?.s || 0))); }
  standings() {
    const el = this.$('mp-standings'); if (el.hidden) return;
    el.replaceChildren();
    const title = document.createElement('b'); title.textContent = 'LIVE RACE'; el.append(title);
    for (const [i,p] of this.sortedPlayers().entries()) { const row = document.createElement('div'); row.className = p.id === this.playerId ? 'you' : ''; row.textContent = `${i+1}  ${p.name}  ${p.dnf ? 'DNF' : p.finish !== null ? p.finish.toFixed(2) + 's' : ''}`; el.append(row); }
  }
  publish(veh, brake) {
    if (this.room?.phase !== 'racing' || performance.now() - this.lastSent < 50 || this.ws?.bufferedAmount > 16384 || this.me?.finish !== null || this.me?.dnf) return;
    this.lastSent = performance.now();
    const state = { s: veh.s, u: veh.u, yaw: veh.yaw, vLong: veh.vLong, vLat: veh.vLat, steer: veh.steer, rpm: veh.rpm, gear: veh.gear, brake, nitroOn: veh.nitroOn };
    this.send({ type: 'state', raceId: this.room.raceId, state });
  }
}
