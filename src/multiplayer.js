import { driverId, getLeaderboard } from './leaderboard.js';
// Same-origin multiplayer transport and lobby UI. Physics stays responsive locally;
// the server owns membership, synchronized starts, and elapsed finish times.
export class Multiplayer {
  constructor(cars, hooks) {
    this.cars = cars; this.hooks = hooks; this.id = null; this.lobby = null;
    this.offset = 0; this.latency = 0; this.peers = new Map(); this.startedRace = null;
    this.token = null; try { this.token = sessionStorage.getItem('paraliaki.session'); } catch {}
    this.connected = false; this.events = []; this.resumeState = null; this.spectateIndex = 0; this.spectateAt = 0;
    this.loaded = false; this.trackVersion = null; this.pendingCode = new URLSearchParams(location.search).get('lobby');
    this.panel = document.createElement('section'); this.panel.id = 'multiplayer'; this.panel.hidden = true;
    this.panel.setAttribute('aria-label', 'Multiplayer lobbies');
    this.panel.setAttribute('role', 'dialog'); this.panel.setAttribute('aria-modal', 'true');
    this.panel.innerHTML = `<div class="mp-card"><div class="mp-heading"><div><small>ATHENS RIVIERA · LIVE RACING</small><h2>MULTIPLAYER</h2></div><button id="mp-close" aria-label="Close multiplayer">×</button></div>
      <p id="mp-status" role="status">Connecting…</p>
      <div id="mp-browser"><div class="mp-fields"><label>DRIVER NAME<input id="mp-name" maxlength="28" placeholder="Your name" autocomplete="nickname"></label><label>YOUR CAR<select id="mp-car"></select></label></div>
      <div class="mp-create"><input id="mp-lobby-name" maxlength="28" placeholder="Lobby name" aria-label="Lobby name"><label><input type="checkbox" id="mp-private"> Invite only</label><button id="mp-create">CREATE LOBBY</button></div>
      <form id="mp-join-form"><input id="mp-code" maxlength="6" placeholder="6-character code" aria-label="Lobby code"><button>JOIN BY CODE</button></form>
      <div class="mp-section"><h3>DISCOVER LOBBIES</h3><button id="mp-refresh">REFRESH</button></div><div id="mp-list"></div></div>
      <div id="mp-room" hidden><div class="mp-section"><h3 id="mp-room-name"></h3><b id="mp-room-code"></b></div><p id="mp-room-help"></p><div class="mp-fields"><label>RACE ROUTE<select id="mp-event"></select></label><label><input id="mp-traffic" type="checkbox"> TRAFFIC ON</label></div><div id="mp-members"></div><div class="mp-actions"><button id="mp-ready">READY</button><button id="mp-start">START RACE</button><button id="mp-copy">COPY INVITE</button><button id="mp-leave">LEAVE LOBBY</button></div><div id="mp-results"></div></div>
      <button id="mp-leaderboard">VIEW BEST TIMES</button><div id="mp-times" hidden></div><p class="mp-note">2–8 drivers · Opponent cars are ghosts · 10-minute race limit · Rejoin within 90 seconds after a disconnect</p></div>`;
    document.body.append(this.panel);
    this.button = document.createElement('button'); this.button.id = 'mp-toggle'; this.button.textContent = 'MULTIPLAYER'; document.body.append(this.button);
    this.board = document.createElement('aside'); this.board.id = 'mp-board'; this.board.hidden = true; this.board.setAttribute('aria-label', 'Race standings'); document.body.append(this.board);
    const $ = id => this.panel.querySelector('#' + id); this.$ = $;
    try { $('mp-name').value = localStorage.getItem('paraliaki.driver') || ''; } catch {}
    for (const car of cars) { const o = document.createElement('option'); o.value = car.id; o.textContent = car.short; $('mp-car').append(o); }
    this.button.onclick = () => this.open(); $('mp-close').onclick = () => this.close();
    $('mp-refresh').onclick = () => this.send({ type: 'discover' });
    $('mp-create').onclick = () => this.action('create', { lobbyName: $('mp-lobby-name').value, private: $('mp-private').checked });
    $('mp-join-form').onsubmit = e => { e.preventDefault(); this.action('join', { code: $('mp-code').value }); };
    $('mp-ready').onclick = () => { if (!this.loaded) return this.status('The world is loading. Ready becomes available when it finishes.'); const me = this.me; this.send({ type: 'ready', ready: !me?.ready, car: me?.car || $('mp-car').value, version: this.trackVersion }); };
    $('mp-start').onclick = () => this.send({ type: this.lobby?.status === 'results' ? 'rematch' : 'start' });
    $('mp-leave').onclick = () => this.send({ type: 'leave' });
    $('mp-event').onchange = $('mp-traffic').onchange = () => this.send({ type: 'options', eventId: $('mp-event').value, traffic: $('mp-traffic').checked });
    $('mp-leaderboard').onclick = () => this.showLeaderboard();
    $('mp-copy').onclick = async () => { const u = new URL(location.href); u.search = ''; u.searchParams.set('lobby', this.lobby.code); try { await navigator.clipboard.writeText(u.href); this.status('Invite link copied.'); } catch { this.status('Invite link: ' + u.href); } };
    this.connect();
    this.timer = setInterval(() => { if (this.ws?.readyState === WebSocket.OPEN) { this.send({ type: 'ping', sent: Date.now() }); if (!this.lobby) this.send({ type: 'discover' }); } }, 3000);
    if (this.pendingCode) { $('mp-code').value = this.pendingCode; this.open(); }
  }
  get active() { return !!this.lobby; }
  get me() { return this.lobby?.players.find(p => p.id === this.id); }
  now() { return Date.now() + this.offset; }
  status(text) { this.$('mp-status').textContent = text; }
  open() { this.panel.hidden = false; this.hooks.clearInput(); if (!this.lobby) { this.$('mp-car').value = this.cars[this.hooks.carIndex()].id; this.send({ type: 'discover' }); } }
  hidePanel() { if (this.panel.contains(document.activeElement) || document.activeElement === this.button) document.activeElement.blur(); this.panel.hidden = true; this.hooks.clearInput(); this.hooks.panelClosed?.(); }
  close() { this.hidePanel(); }
  send(data) { if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(data)); else this.status('Multiplayer is offline. Reconnecting…'); }
  action(type, extra) {
    const name = this.$('mp-name').value.trim() || 'DRIVER';
    try { localStorage.setItem('paraliaki.driver', name); } catch {}
    this.send({ type, name, driverId: driverId(), car: this.$('mp-car').value, ...extra });
  }
  connect() {
    const url = new URL('ws', location.href); url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'; url.pathname = '/ws'; url.search = ''; url.hash = '';
    const ws = this.ws = new WebSocket(url);
    ws.onopen = () => { this.connected = true; this.status('Connected · find a lobby or create your own.'); this.send({ type: 'ping', sent: Date.now() }); };
    ws.onmessage = e => {
      const m = JSON.parse(e.data);
      if (m.type === 'hello') {
        this.offset = m.now - Date.now(); if (!this.loaded) this.trackVersion = m.track.version;
        this.events = m.events || []; this.$('mp-event').replaceChildren();
        for (const e of this.events) { const option = document.createElement('option'); option.value = e.id; option.textContent = `${e.name} · ${(e.len / 1000).toFixed(1)} km${e.dir < 0 ? ' · REVERSE' : ''}`; this.$('mp-event').append(option); }
        if (this.token) this.send({ type: 'resume', token: this.token });
        else { this.id = m.id; this.saveToken(m.token); }
      }
      else if (m.type === 'session') {
        this.id = m.id; this.saveToken(m.token);
        if (!m.resumed) { this.left(); this.status('Your previous session expired. Join or create a lobby.'); }
        else if (!m.lobby) this.left();
      }
      else if (m.type === 'pong') { this.latency = Math.max(0, Date.now() - m.sent); this.offset = m.now - (m.sent + Date.now()) / 2; }
      else if (m.type === 'discovery') this.renderDiscovery(m.lobbies);
      else if (m.type === 'error') { this.status(m.message); this.panel.hidden = false; }
      else if (m.type === 'left') this.left();
      else if (m.type === 'lobby') {
        const joined = !this.lobby; this.lobby = m.lobby;
        if (m.resume) this.resumeState = m.state;
        if (joined) { this.peers.clear(); this.hooks.join(this.me.car); this.panel.hidden = false; }
        if (m.lobby.status === 'waiting') { if (this.startedRace) { this.startedRace = null; this.peers.clear(); this.hooks.wait(); } this.panel.hidden = false; }
        if (m.lobby.raceId && (this.startedRace !== m.lobby.raceId || m.resume)) { this.startedRace = m.lobby.raceId; this.peers.clear(); this.hidePanel(); this.hooks.start(m.lobby, this.id, m.resume ? m.state : null); }
        this.renderRoom(); this.hooks.members(m.lobby.players.filter(p => p.id !== this.id));
        if (m.lobby.status === 'results') { this.panel.hidden = false; this.hooks.results(); }
      } else if (m.type === 'snapshot' && m.raceId === this.lobby?.raceId) {
        for (const p of m.players) if (p.id !== this.id && p.state) this.peers.set(p.id, { ...p, at: performance.now() });
      }
    };
    ws.onclose = e => {
      if (this.ws !== ws) return;
      this.connected = false; this.hooks.clearInput();
      if (e.reason === 'Session resumed elsewhere') { this.left(); this.saveToken(null); this.status('This session is now open in another tab.'); return; }
      this.status(this.active ? 'Connection lost. Rejoining your race… (90-second reservation)' : 'Multiplayer is offline. Retrying…');
      if (this.active) this.panel.hidden = false;
      setTimeout(() => this.connect(), 1000);
    };
    ws.onerror = () => this.status('Multiplayer unavailable. Run the game with npm start.');
  }
  saveToken(token) { this.token = token; try { if (token) sessionStorage.setItem('paraliaki.session', token); else sessionStorage.removeItem('paraliaki.session'); } catch {} }
  left() { this.resumeState = null; if (this.lobby) { this.lobby = null; this.startedRace = null; this.peers.clear(); this.hooks.leave(); } this.board.hidden = true; this.$('mp-browser').hidden = false; this.$('mp-room').hidden = true; this.status('Find a lobby or create your own.'); const u = new URL(location.href); u.searchParams.delete('lobby'); history.replaceState(null, '', u); }
  renderDiscovery(lobbies) {
    const list = this.$('mp-list'); list.replaceChildren();
    if (!lobbies.length) { const p = document.createElement('p'); p.textContent = 'No public lobbies yet. Create one and invite your friends.'; list.append(p); }
    for (const l of lobbies) {
      const row = document.createElement('div'); row.className = 'mp-lobby';
      const label = document.createElement('span'); label.textContent = `${l.name} · ${l.players.length}/${l.capacity} · ${l.event?.name || 'QUICK RACE'} · ${l.traffic ? 'TRAFFIC' : 'CLEAR ROAD'} · ${l.status.toUpperCase()}`;
      const b = document.createElement('button'); b.textContent = 'JOIN'; b.disabled = l.status !== 'waiting' || l.players.length >= l.capacity; b.onclick = () => this.action('join', { code: l.code }); row.append(label, b); list.append(row);
    }
  }
  renderRoom() {
    const l = this.lobby, me = this.me, host = l.host === this.id; this.$('mp-browser').hidden = true; this.$('mp-room').hidden = false;
    this.$('mp-room-name').textContent = l.name; this.$('mp-room-code').textContent = l.code;
    this.$('mp-room-help').textContent = l.status === 'waiting' ? 'Get ready. The host starts when at least two drivers are ready.' : l.status === 'results' ? 'Race complete. The host can prepare a rematch.' : me?.finish !== null ? 'You finished. Waiting for the other drivers; the race ends after ten minutes.' : 'Race in progress. Close this panel to keep driving.';
    this.status(`Connected · ${Math.round(this.latency)} ms · ${l.players.length}/8 drivers`);
    this.$('mp-event').value = l.eventId || 'quick'; this.$('mp-event').disabled = !host || l.status !== 'waiting';
    this.$('mp-traffic').checked = l.traffic === true; this.$('mp-traffic').disabled = !host || l.status !== 'waiting';
    const list = this.$('mp-members'); list.replaceChildren();
    for (const p of l.players) { const row = document.createElement('div'); row.className = 'mp-member'; row.textContent = `${p.name}${p.id === this.id ? ' (YOU)' : ''}${p.id === l.host ? ' · HOST' : ''} · ${this.cars.find(c => c.id === p.car)?.short || p.car} · ${p.connected === false ? 'RECONNECTING' : p.ready ? 'READY' : 'NOT READY'}`; list.append(row); }
    this.$('mp-ready').disabled = !this.loaded || l.status !== 'waiting'; this.$('mp-ready').textContent = me?.ready ? 'NOT READY' : 'READY';
    this.$('mp-start').textContent = l.status === 'results' ? 'REMATCH' : 'START RACE'; this.$('mp-start').hidden = !host;
    this.$('mp-start').disabled = l.status !== 'results' && (l.status !== 'waiting' || l.players.length < 2 || !l.players.every(p => p.ready && p.connected !== false));
    const results = this.$('mp-results'); results.replaceChildren();
    if (l.status === 'results') { const title = document.createElement('h3'); title.textContent = 'RACE RESULTS'; results.append(title); this.ranking().forEach((p, i) => { const row = document.createElement('p'); row.textContent = `${i + 1}. ${p.name} · ${p.finish !== null ? p.finish.toFixed(2) + ' s' : 'DNF'}`; results.append(row); }); }
    this.board.hidden = l.status === 'waiting';
  }
  ranking(localS = 0) { return [...(this.lobby?.results || this.lobby?.players || [])].sort((a, b) => {
    if (a.finish !== null || b.finish !== null) return (a.finish ?? Infinity) - (b.finish ?? Infinity);
    const s = p => this.progress(p.id === this.id ? localS : this.peers.get(p.id)?.state.s ?? this.lobby?.event?.s0 ?? 0);
    return s(b) - s(a);
  }); }
  progress(s) { const r = this.lobby?.event; return r ? (s - r.s0) * r.dir : s; }
  spectating() {
    if (!this.active || this.me?.finish == null || this.lobby.status === 'results') return null;
    const remaining = this.lobby.players.filter(p => p.id !== this.id && p.finish == null && p.connected !== false && this.peers.has(p.id));
    if (!remaining.length) return null;
    if (performance.now() - this.spectateAt > 7000) { this.spectateAt = performance.now(); this.spectateIndex++; }
    return remaining[this.spectateIndex % remaining.length];
  }
  async showLeaderboard() {
    const box = this.$('mp-times'); box.hidden = false; box.textContent = 'Loading best times…';
    try {
      const entries = await getLeaderboard({ eventId: this.lobby?.eventId || 'quick', car: this.me?.car || this.$('mp-car').value, traffic: this.lobby?.traffic ?? false });
      box.replaceChildren(); const title = document.createElement('h3'); title.textContent = 'BEST TIMES · ' + (this.lobby?.event?.name || 'QUICK RACE'); box.append(title);
      if (!entries.length) { const row = document.createElement('p'); row.textContent = 'No recorded times yet.'; box.append(row); }
      entries.forEach((e, i) => { const row = document.createElement('p'); row.textContent = `${i + 1}. ${e.name} · ${e.time.toFixed(2)} s · ${e.car}`; box.append(row); });
    } catch { box.textContent = 'Best times are unavailable. Try again shortly.'; }
  }
  update(dt, state) {
    if (!this.lobby) return;
    this.hooks.remote(this.peers, dt);
    const l = this.lobby;
    if (!this.connected) return;
    if (['countdown', 'race'].includes(l.status)) {
      this.hooks.clock(Math.max(0, (this.now() - l.startAt) / 1000), Math.max(0, (l.startAt - this.now()) / 1000));
      if (this.now() >= l.startAt && performance.now() - (this.sentAt || 0) >= 50) { this.sentAt = performance.now(); this.send({ type: 'state', raceId: l.raceId, state }); }
    }
    if (performance.now() - (this.boardAt || 0) > 250) {
      this.boardAt = performance.now(); this.board.replaceChildren();
      const title = document.createElement('b'); const watching = this.spectating(); title.textContent = l.status === 'results' ? 'RESULTS' : this.me?.finish !== null ? watching ? 'WATCHING · ' + watching.name : 'FINISHED · WAITING' : `LIVE · ${Math.round(this.latency)} ms`; this.board.append(title);
      this.ranking(state.s).forEach((p, i) => { const row = document.createElement('div'); row.textContent = `${i + 1}. ${p.name}${p.id === this.id ? ' · YOU' : ''}${p.finish !== null ? ' · ' + p.finish.toFixed(2) + ' s' : l.status === 'results' ? ' · DNF' : ''}`; this.board.append(row); });
    }
  }
}
