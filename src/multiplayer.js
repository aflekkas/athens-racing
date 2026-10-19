import { icon } from './ui/components.js';
import { ReconnectHistory, reconnectDelay } from './reconnect-history.js';
import { MULTIPLAYER_PROTOCOL, UPDATE_CLOSE_CODE, AUTH_CLOSE_CODE, protocolVersion, clientHello } from './multiplayer-protocol.js';
import { renderLiveBoard } from './ui/live-board.js';
import { driverId, getLeaderboard } from './leaderboard.js';
import { MAPS } from './map-catalog.js';
import { StateSender } from './multiplayer-state.js';
import { ServerClock } from './server-clock.js';
import { SpectatorSelection, rankDrivers, driverTelemetry } from './race-lifecycle.js';
import { receiveRemoteSnapshot, resetRemoteTimelines } from './remote-timeline.js';
import { driverName } from './driver-name.js';
import { presetCars } from './plate.js';
import { inGarage, sortTrims } from './car-catalog.js';
import { defaultCarRules, describeRules } from './mp-car-rules.js';
import { describeMode, configFromLobby } from './mp-setup.js';
import { getPlayableMaps } from './enabled-maps.js';

const LOADED_RETRY_MS = 4000; // how long a driver may stay LOADING in a lobby before the client says so again
// The tow screen is black while this request is out; the server answers (or denies) within a round trip.
export const RECOVERY_TIMEOUT_MS = 3500;
// Same-origin multiplayer transport and lobby UI. Physics stays responsive locally;
// the server owns membership, synchronized starts, and elapsed finish times.
export class Multiplayer {
  constructor(cars, hooks) {
    this.cars = cars; this.hooks = hooks; this.id = null; this.lobby = null;
    this.offset = 0; this.latency = 0; this.peers = new Map(); this.startedRace = null;
    this.token = null; try { this.token = sessionStorage.getItem('paraliaki.session'); } catch {}
    this.connected = false; this.reconnectAttempt = 0; this.reconnectHistory = new ReconnectHistory(); this.resumeCount = 0; this.events = []; this.resumeState = null; this.spectateIndex = 0; this.spectateAt = 0;
    this.loaded = false; this.mapId = null; this.preparing = null; this.failedMap = null; this.pendingResume = false;
    this.maps = []; this.trackVersion = null; this.pendingCode = new URLSearchParams(location.search).get('lobby');
    this.stateBatching = false; this.finishSent = null; this.wreckedRace = null; this.wreckSent = false;
    this.stateSender = new StateSender(packet => {
      this.reconnectHistory.record(packet);
      if (this.connected && this.worldReady && this.lobby?.raceId === packet.raceId && !this.reconnectHistory.replaying) { packet.generation = this.lobby?.generation || 0; this.send(packet); }
    });
    this.panel = document.createElement('section'); this.panel.id = 'multiplayer'; this.panel.hidden = true;
    this.panel.setAttribute('aria-label', 'Multiplayer lobbies');
    this.panel.setAttribute('role', 'dialog'); this.panel.setAttribute('aria-modal', 'true');
    this.panel.innerHTML = `<div class="mp-card"><div class="mp-heading"><div><small>ATHENS RIVIERA · LIVE RACING</small><h2>MULTIPLAYER</h2></div><button id="mp-close" aria-label="Close multiplayer">${icon('x')}</button></div>
      <p id="mp-status" role="status">Connecting…</p>
      <div id="mp-browser"><form id="mp-join-form" class="mp-join-hero"><div><small>HAVE AN INVITE?</small><h3>JOIN BY CODE</h3><p>Enter the host’s six-character lobby code.</p></div><label>LOBBY CODE<input id="mp-code" maxlength="6" placeholder="ABC123" aria-label="Lobby code" autocomplete="off" autocapitalize="characters" spellcheck="false"></label><button type="submit">JOIN LOBBY ${icon('chevron-right')}</button></form><input type="hidden" id="mp-car">
      <details class="mp-create-fold"><summary>HOST / CREATE GAME</summary><div class="mp-create"><input id="mp-lobby-name" maxlength="28" placeholder="Lobby name" aria-label="Lobby name"><label class="mp-map-field">TRACK<ui-select id="mp-create-map"></ui-select></label><label class="mp-toggle-field"><input type="checkbox" id="mp-private"> Invite only</label><button id="mp-create">CREATE LOBBY</button></div></details>
      <div class="mp-section"><h3>BROWSE OPEN LOBBIES</h3><button id="mp-refresh">REFRESH</button></div><div id="mp-list"></div></div>
      <div id="mp-room" hidden><div class="mp-section"><h3 id="mp-room-name"></h3><b id="mp-room-code"></b></div><p id="mp-room-help"></p><div class="mp-fields"><label>YOUR CAR<ui-select id="mp-room-car"></ui-select></label><label>TRACK<ui-select id="mp-map"></ui-select></label><label>MODE<ui-select id="mp-event"></ui-select></label><label class="mp-toggle-field"><input id="mp-traffic" type="checkbox"> TRAFFIC ON</label></div><div id="mp-car-toggles" data-hook="allowed-cars" hidden></div><div id="mp-members"></div><div class="mp-actions"><button id="mp-ready">READY</button><button id="mp-start">START RACE</button><button id="mp-restart">RESTART</button><button id="mp-tolobby">LOBBY</button><button id="mp-copy">COPY INVITE</button><button id="mp-leave">LEAVE LOBBY</button></div><div id="mp-results"></div></div>
      <button id="mp-leaderboard">VIEW BEST TIMES</button><div id="mp-times" hidden></div><p class="mp-note">2–8 drivers · Player collisions on · Shared traffic off · 10-minute race limit · Rejoin within 90 seconds after a disconnect</p></div>`;
    document.body.append(this.panel);
    this.button = document.createElement('button'); this.button.id = 'mp-toggle'; this.button.textContent = 'MULTIPLAYER'; this.syncSessionControls(); document.body.append(this.button);
    this.board = document.createElement('aside'); this.board.id = 'mp-board'; this.board.hidden = true; this.board.setAttribute('aria-label', 'Race standings'); document.body.append(this.board);
    const $ = id => this.panel.querySelector('#' + id); this.$ = $;
    for (const car of sortTrims(cars)) { const o = document.createElement('option'); o.value = car.id; o.textContent = car.short; $('mp-room-car').append(o); }
    this.button.onclick = () => this.open(); $('mp-close').onclick = () => this.close();
    $('mp-refresh').onclick = () => this.send({ type: 'discover' });
    // Double CREATE clicks used to race the first lobby join and surface a
    // confusing "leave first" error; the button stays disabled until the
    // lobby (or an error) arrives.
    $('mp-create').onclick = () => { if (this.lobby || this.creating) return; this.creating = true; $('mp-create').disabled = true; this.status('Creating lobby…'); this.action('create', { lobbyName: $('mp-lobby-name').value, private: $('mp-private').checked }); };
    $('mp-restart').onclick = () => this.restart();
    $('mp-tolobby').onclick = () => this.returnToLobby();
    $('mp-code').oninput = e => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); };
    $('mp-join-form').onsubmit = e => { e.preventDefault(); this.action('join', { code: $('mp-code').value }); };
    $('mp-ready').onclick = () => { if (!this.worldReady) return this.status(this.versionMismatch ? 'The lobby track was updated. Reload the game to update.' : 'The track is loading. Ready becomes available when it finishes.'); const me = this.me; this.send({ type: 'ready', ready: !me?.ready, car: me?.car || $('mp-car').value, mapId: this.mapId, version: this.trackVersion }); };
    $('mp-start').onclick = () => this.send({ type: this.lobby?.status === 'results' ? 'rematch' : 'start' });
    $('mp-leave').onclick = () => this.send({ type: 'leave' });
    $('mp-room-car').onchange = () => this.send({ type: 'ready', ready: false, car: $('mp-room-car').value, version: this.trackVersion });
    $('mp-event').onchange = $('mp-traffic').onchange = () => this.send({ type: 'options', mapId: this.lobby?.mapId || 'riviera', eventId: $('mp-event').value, traffic: $('mp-traffic').checked });
    $('mp-map').onchange = () => this.send({ type: 'options', mapId: $('mp-map').value, traffic: $('mp-traffic').checked });
    $('mp-leaderboard').onclick = () => this.showLeaderboard();
    $('mp-copy').onclick = async () => { const u = new URL(location.href); u.search = ''; u.searchParams.set('lobby', this.lobby.code); u.searchParams.set('map', this.lobby.mapId || 'riviera'); try { await navigator.clipboard.writeText(u.href); this.status('Invite link copied.'); } catch { this.status('Invite link: ' + u.href); } };
    driverName.onChange(name => { if (this.connected) this.send({ type: 'name', name }); });
    this.connectionChip = document.createElement('aside'); this.connectionChip.className = 'mp-connection-chip'; this.connectionChip.hidden = true; this.connectionChip.setAttribute('role', 'status'); this.connectionChip.textContent = 'Reconnecting…'; document.body.append(this.connectionChip);
    this.connect();
    this.timer = setInterval(() => { if (this.ws?.readyState === WebSocket.OPEN) this.send({ type: 'ping', sent: Date.now() }); }, 30000);
    if (this.pendingCode) { $('mp-code').value = this.pendingCode; this.open(); }
  }
  get active() { return !!this.lobby; }
  syncSessionControls() { this.button.hidden = !this.active; }
  // Lobby car allow-list (host-only writes). `lobby.allowedCars` arrives
  // with every lobby message; empty/missing means the whole catalogue.
  get allowedCars() { const allowed=this.lobby?.allowedCars;return sortTrims(this.cars.filter(c=>!allowed?.length||allowed.includes(c.id))).map(c=>c.id); }
  setAllowedCars(ids) {
    const list = [...new Set((ids || []).filter(id => this.cars.some(c => c.id === id)))];
    if (!list.length) { this.status('Allow at least one car.'); return false; }
    this.send({ type: 'options', allowedCars: list });
    return true;
  }
  // UI owns presentation. These commands are checked again by the server.
  get canChangeCar() { return !this.lobby || ['waiting', 'results'].includes(this.lobby.status); }
  changeCar(car) {
    if (!this.canChangeCar || !this.cars.some(c => c.id === car) || this.lobby && !this.allowedCars.includes(car)) { this.status('Choose an allowed car while in the lobby.'); return false; }
    if (!this.lobby) { this.$('mp-car').value = car; return true; }
    this.send({ type: 'car', car }); return true;
  }
  startRace({ force = false } = {}) {
    if (this.lobby?.host !== this.id) return false;
    this.send({ type: this.lobby.status === 'results' ? 'rematch' : 'start', force: force === true }); return true;
  }
  kickPlayer(id) {
    if (this.lobby?.host !== this.id || id === this.id) return false;
    this.send({ type: 'kick', id }); return true;
  }
  blockPlayer(id) {
    if (this.lobby?.host !== this.id || id === this.id) return false;
    this.send({ type: 'block', id }); return true;
  }
  unblockPlayer(id) {
    if (this.lobby?.host !== this.id) return false;
    this.send({ type: 'unblock', id }); return true;
  }
  setCarPickerOpen(open) { this.carPickerOpen = open === true; if (open && this.lobby?.status === 'waiting') this.send({ type: 'ready', ready: false }); }
  setAllowedPreset(preset) { return this.setAllowedCars(presetCars(sortTrims(this.cars.filter(inGarage)), preset)); }
  // Host car ruleset (speed-range presets + balancing). The server stays
  // authoritative: it sanitizes the patch, resolves the effective allow-list
  // and rejects invalid car picks with the reason.
  get carRules() { return this.lobby?.carRules || defaultCarRules(); }
  rulesSummary() { return describeRules(this.carRules, Object.fromEntries((this.cars || []).map(c => [c.id, c.short || c.id]))); }
  setCarRules(patch = {}) {
    if (this.lobby?.host !== this.id) { this.status('Only the host can change the car rules.'); return false; }
    this.send({ type: 'options', carRules: { ...this.carRules, ...patch } });
    return true;
  }
  // Shared session-setup contract (UI binds host controls to these; the
  // server stays authoritative and rejects guest writes + invalid values).
  // getLobbyConfig() returns { mode, mapId, eventId, rivals, traffic, time,
  // weather, reverse, police, sessionDuration, enforcement }.
  getLobbyConfig() {
    const l = this.lobby;
    return { ...configFromLobby(l), mode: l?.mode || l?.event?.type || 'sprint', mapId: l?.mapId || 'riviera', eventId: l?.eventId || null };
  }
  // Host-only. Accepts any subset of { mapId, eventId, mode, ...config }.
  // mode resolves to the first route of that type on the target map.
  setLobbyConfig(patch = {}) {
    if (this.lobby?.host !== this.id) { this.status('Only the host can change the lobby setup.'); return false; }
    const { mapId, eventId, mode, ...config } = patch || {};
    const msg = { type: 'options' };
    if (mapId !== undefined) msg.mapId = mapId;
    let eid = eventId;
    if (mode !== undefined && eid === undefined) {
      const onMap = (this.events || []).filter(e => (e.mapId || 'riviera') === (mapId || this.lobby?.mapId || 'riviera'));
      eid = onMap.find(e => e.type === mode)?.id;
      if (!eid) { this.status(`No ${String(mode).toUpperCase()} route on this track.`); return false; }
    }
    if (eid !== undefined) msg.eventId = eid;
    if (Object.keys(config).length) msg.config = config;
    this.send(msg); return true;
  }
  // Participant entry with a shared-setup draft ({ mapId, eventId, mode,
  // config, lobbyName, private }): preselects the create form; plain open()
  // behaves as before for the browser button.
  createLobby(opts = {}) {
    const draft = { ...(this.pendingDraft || {}), ...opts };
    const name = driverName.get();
    const msg = { type: 'create', name, driverId: this.driverIdValue(), car: this.$('mp-car').value };
    if (draft.lobbyName !== undefined) msg.lobbyName = draft.lobbyName;
    if (draft.private !== undefined) msg.private = draft.private;
    if (draft.mapId !== undefined) msg.mapId = draft.mapId;
    let eid = draft.eventId;
    if (draft.mode !== undefined && eid === undefined) {
      const onMap = (this.events || []).filter(e => (e.mapId || 'riviera') === (draft.mapId || this.$('mp-create-map').value || 'riviera'));
      eid = onMap.find(e => e.type === draft.mode)?.id;
    }
    if (eid !== undefined) msg.eventId = eid;
    if (draft.config !== undefined) msg.config = draft.config;
    this.pendingDraft = null;
    this.send({ ...msg, ...this.hooks.appearance?.() });
  }
  driverIdValue() { try { return driverId(); } catch { return this.id; } }
  restart() {
    if (this.lobby?.host !== this.id) { this.status('Only the host can restart the race.'); return false; }
    this.send({ type: 'restart' }); return true;
  }
  returnToLobby() {
    if (this.lobby?.host !== this.id) { this.status('Only the host can return the lobby.'); return false; }
    this.send({ type: 'to-lobby' }); return true;
  }
  transferHost(id) { this.send({ type: 'transfer', to: id }); }
  get versionMismatch() { return this.loaded && this.mapId === (this.lobby?.mapId || 'riviera') && !!this.lobby?.track?.version && this.trackVersion !== this.lobby.track.version; }
  get worldReady() { return this.loaded && !this.preparing && !this.versionMismatch && (!this.lobby || this.mapId === (this.lobby.mapId || 'riviera')); }
  get me() { return this.lobby?.players.find(p => p.id === this.id); }
  get wrecked() { return !!this.lobby?.raceId && (this.me?.dnf === 'wrecked' || this.wreckedRace === this.lobby.raceId); }
  get retired() { return !!this.me?.dnf || this.retiredRace === this.lobby?.raceId && !!this.lobby?.raceId; }
  now() { return Date.now() + this.offset; }
  wreck(impactEbs) {
    // Impacts are recoverable. Only the explicit retire/leave action ends a race.
    return false;
  }
  retire() {
    const l = this.lobby;
    if (!this.connected || !l?.raceId || l.status !== 'race' || this.me?.finish != null || this.retired) return false;
    this.cancelRecovery('Driver retired.'); this.retiredRace = l.raceId; this.wreckSent = false;
    this.stateSender.reset(); this.hooks.wrecked(); this.sendWreck(); return true;
  }
  sendWreck() {
    if (this.connected && this.retired && !this.me?.dnf && !this.wreckSent) { this.wreckSent = true; this.send({ type: 'dnf', raceId: this.lobby.raceId, generation: this.lobby.generation, reason: 'retired' }); }
  }
  recover({ capture = false } = {}) {
    if (!this.connected || this.retired || this.me?.finish != null || this.lobby?.status !== 'race') return Promise.reject(new Error('Recovery is unavailable.'));
    if (this.recoveryPending) return this.recoveryPending.promise;
    this.stateSender.discontinuity();
    const raceId = this.lobby.raceId, motionEpoch = this.stateSender.motionEpoch;
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    const timer = setTimeout(() => this.cancelRecovery('Recovery timed out. Try again.'), RECOVERY_TIMEOUT_MS);
    this.recoveryPending = { raceId, motionEpoch, promise, resolve, reject, timer, capture, retried: false };
    this.send({ type: 'recover', raceId, generation: this.lobby.generation, motionEpoch, capture }); return promise;
  }
  // The server answered "no": fail now (the caller is fading to black), or once re-send with an epoch it will accept.
  denyRecovery(m) {
    const pending = this.recoveryPending;
    if (!pending || m.raceId !== pending.raceId || m.motionEpoch !== pending.motionEpoch) return;
    if (!pending.retried && Number.isSafeInteger(m.epoch) && m.epoch >= pending.motionEpoch) {
      pending.retried = true; this.stateSender.motionEpoch = Math.max(this.stateSender.motionEpoch, m.epoch + 1); this.stateSender.discontinuity();
      pending.motionEpoch = this.stateSender.motionEpoch;
      this.send({ type: 'recover', raceId: pending.raceId, generation: this.lobby.generation, motionEpoch: pending.motionEpoch, capture: pending.capture }); return;
    }
    this.cancelRecovery(m.message || 'Recovery is unavailable.');
  }
  cancelRecovery(message = 'The race changed before recovery completed.') {
    if (!this.recoveryPending) return;
    const pending = this.recoveryPending; this.recoveryPending = null;
    clearTimeout(pending.timer); pending.reject(new Error(message));
  }
  status(text) { this.$('mp-status').textContent = text; }
  open(draft = null) {
    if (draft && typeof draft === 'object') {
      this.pendingDraft = { ...(this.pendingDraft || {}), ...draft };
      if (typeof draft.mapId === 'string' && this.maps.some(m => m.id === draft.mapId)) this.$('mp-create-map').value = draft.mapId;
    }
    this.panel.hidden = false; this.hooks.clearInput();
    if (!this.lobby) {
      this.panel.querySelector('.mp-create-fold').open = draft?.entry === 'host' || !!draft?.mode;
      if (draft?.entry === 'host') this.$('mp-lobby-name').focus();
      else if (draft?.entry === 'join') this.$('mp-code').focus();
    }
    if (!this.lobby) { this.$('mp-car').value = this.cars[this.hooks.carIndex()].id; if (!this.pendingDraft?.mapId && this.maps.some(m => m.id === this.mapId)) this.$('mp-create-map').value = this.mapId; this.send({ type: 'discover' }); }
  }
  hidePanel() { if (this.panel.contains(document.activeElement) || document.activeElement === this.button) document.activeElement.blur(); this.panel.hidden = true; this.hooks.clearInput(); this.hooks.panelClosed?.(); }
  close() { this.hidePanel(); }
  send(data) { if (this.reloadRequired) return; if (this.ws?.readyState === WebSocket.OPEN) { try { this.ws.send(JSON.stringify(data)); } catch { this.retryConnection(this.ws); } } else this.status('Multiplayer is offline. Reconnecting…'); }
  action(type, extra) {
    const name = driverName.get();
    this.send({ type, name, ...this.hooks.appearance?.(), driverId: driverId(), car: this.$('mp-car').value, ...(type === 'create' ? { mapId: this.$('mp-create-map').value || 'riviera' } : {}), ...extra });
  }
  requireReload() {
    if (this.reloadRequired) return;
    this.reloadRequired = true; this.connected = false; this.connectionState(false);
    clearTimeout(this.reconnectTimer); clearInterval(this.timer);
    this.hooks.clearInput(); this.stateSender.reset();
    this.cancelRecovery('Game updated. Reload to reconnect.');
    this.status('Game updated, reload'); this.showReloadNotice();
    this.hooks.reloadRequired?.({ reason: 'update' });
  }
  showReloadNotice() {
    if (this.reloadNotice) return;
    const notice = this.reloadNotice = document.createElement('aside');
    notice.className = 'mp-update-notice'; notice.setAttribute('role', 'alert');
    const label = document.createElement('span'); label.textContent = 'Game updated, reload';
    const button = document.createElement('button'); button.textContent = 'Reload';
    button.onclick = () => location.reload();
    notice.append(label, button); document.body.append(notice);
  }
  connectionState(reconnecting) {
    this.reconnecting = reconnecting;
    if (this.connectionChip) this.connectionChip.hidden = !reconnecting || !this.active;
    if (!reconnecting) { this.reconnectAttempt = 0; clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
  }
  /** the browser's TRY AGAIN: skip the back-off wait and dial now (a pending retry is cancelled first) */
  reconnectNow() {
    if (this.reloadRequired || this.connected) return;
    clearTimeout(this.reconnectTimer); this.reconnectTimer = null;
    const ws = this.ws; this.ws = null; try { ws?.close(); } catch {}
    this.connect();
  }
  retryConnection(ws) {
    if (this.ws !== ws || this.reloadRequired || this.reconnectTimer != null) return;
    this.connected = false; this.connectionState(true);
    const delay = reconnectDelay(this.reconnectAttempt || 0); this.reconnectAttempt = (this.reconnectAttempt || 0) + 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.ws !== ws || this.reloadRequired) return;
      try { ws.close(); } catch {}
      this.connect();
    }, delay);
  }
  connect() {
    if (this.reloadRequired) return;
    const url = new URL('ws', location.href); url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'; url.pathname = '/ws'; url.search = ''; url.hash = '';
    const hello = clientHello(document);
    url.searchParams.set('protocol', String(hello.protocol));
    if (hello.build) url.searchParams.set('build', hello.build);
    const ws = this.ws = new WebSocket(url);
    ws.onopen = () => { this.connected = false; this.status('Connecting to your session…'); this.send(hello); this.send({ type: 'ping', sent: Date.now() }); };
    ws.onmessage = e => {
      if (this.ws !== ws || this.reloadRequired) return;
      if (e.data === 'alive') return;
      const m = JSON.parse(e.data);
      if (Number.isFinite(m.now)) this.offset = (this.serverClock ||= new ServerClock()).observe(m.now, Date.now(), m.type === 'pong' ? m.sent : null);
      if (m.type === 'reload' && m.reason === 'update') { this.requireReload(); return; }
      if (m.type === 'hello') {
        if (protocolVersion(m.protocol) !== MULTIPLAYER_PROTOCOL) { this.requireReload(); ws.close(UPDATE_CLOSE_CODE, 'Game updated, reload'); return; }
        // Immediate 10 Hz samples avoid an additional 100–200ms batching delay.
        this.stateBatching = false;
        if (!this.loaded) this.trackVersion = m.track.version;
        this.maps = getPlayableMaps(m.maps || [{ id: 'riviera', name: MAPS[0].name, track: m.track, events: m.events || [] }]);
        this.events = m.events || this.maps.flatMap(map => (map.events || []).map(e => ({ ...e, mapId: map.id })));
        for (const id of ['mp-create-map', 'mp-map']) { this.$(id).replaceChildren(); for (const map of this.maps) { const option = document.createElement('option'); option.value = map.id; option.textContent = map.name; this.$(id).append(option); } }
        if (this.maps.some(map => map.id === this.mapId)) this.$('mp-create-map').value = this.mapId;
        this.renderEvents(this.lobby?.mapId || 'riviera');
        if (this.token) this.send({ type: 'resume', token: this.token });
        else { this.id = m.id; this.saveToken(m.token); this.connected = true; this.connectionState(false); this.status('Connected · find a lobby or create your own.'); }
        this.send({ type: 'name', name: driverName.get() });
      }
      else if (m.type === 'session') {
        // The server no longer knows this token (grace over, restart, other account): adopt the fresh session. Retrying the
        // dead token would loop forever on a socket that reads as open.
        this.id = m.id; this.saveToken(m.token); this.reconnectAttempt = 0;
        if (!m.resumed || !m.lobby) this.connected = true;
        if (!m.resumed) { const wasRacing = this.active; this.left(); this.status(wasRacing ? 'You were away too long and your seat was released. Join or create a lobby.' : 'Your previous session expired. Join or create a lobby.'); }
        else if (!m.lobby) this.left();
      }
      else if (m.type === 'pong') { this.latency = Math.max(0, Date.now() - m.sent); }
      else if (m.type === 'world' && m.raceId === this.lobby?.raceId && m.generation === this.lobby?.generation) this.hooks.world?.(m.world, Math.max(0, (this.now() - m.now) / 1000));
      else if (['world-frame', 'world-contact'].includes(m.type) && m.raceId === this.lobby?.raceId && m.generation === this.lobby?.generation) this.hooks.sharedWorld?.(m);
      else if (m.type === 'discovery') this.renderDiscovery(m.lobbies);
      else if (m.type === 'error') { this.creating = false; if (this.$) this.$('mp-create').disabled = false; this.status(m.message); this.panel.hidden = false; }
      else if (m.type === 'left' || m.type === 'kicked') { this.left(); this.panel.hidden = false; if (m.message || m.reason) this.status(m.message || m.reason); if (m.type === 'kicked') { this.kickCooldown = { lobbyCode: m.lobbyCode, until: m.until }; this.hooks.kicked?.(m); } }
      else if (m.type === 'lobby') {
        this.creating = false; if (this.$) this.$('mp-create').disabled = false;
        const joined = !this.lobby, previousCar = this.me?.car, previousBalance = JSON.stringify(this.me?.balance || null), previousRace = this.lobby?.raceId, previousMembers = this.lobby?.players; this.lobby = m.lobby; this.syncSessionControls();
        if (previousRace !== m.lobby.raceId) { this.reconnectHistory?.clear(); this.peers.clear(); this.cancelRecovery(); this.selection?.reset(m.lobby.raceId); this.retiredRace = null; }
        for (const member of m.lobby.players) {
          const prior = previousMembers?.find(p => p.id === member.id), peer = this.peers.get(member.id);
          if (peer && prior && (prior.car !== member.car || prior.connected === false && member.connected !== false)) delete peer.timeline;
        }
        if (m.resume) {
          const continuing = this.reconnecting && this.startedRace === m.lobby.raceId && previousRace === m.lobby.raceId && this.worldReady;
          this.resumeState = continuing ? null : m.state; this.pendingResume = !continuing; this.connected = true; this.resumeCount++;
          if (continuing) { this.reconnectHistory?.resume(m.state); this.reconnectHistory?.flush(p => this.send(p), m.lobby.generation || 0, performance.now()); }
          else this.reconnectHistory?.clear();
          this.connectionState(false);
        }
        if (joined) { this.peers.clear(); this.hooks.join(this.me.car); this.panel.hidden = false; }
        else if (previousCar !== this.me?.car || previousBalance !== JSON.stringify(this.me?.balance || null)) this.hooks.carChanged?.(this.me.car);
        this.renderRoom(); this.syncLobby();
      } else if (m.type === 'recover-denied') { this.denyRecovery(m);
      } else if (m.type === 'recovered' && m.raceId === this.lobby?.raceId && (m.generation === undefined || m.generation === this.lobby.generation)) {
        const pending = this.recoveryPending;
        if (pending && m.motionEpoch === pending.motionEpoch && Number.isFinite(m.s) && Number.isFinite(m.u) && Number.isFinite(m.until)) {
          clearTimeout(pending.timer); this.recoveryPending = null; pending.resolve(m);
        }
      } else if (m.type === 'snapshot' && m.raceId === this.lobby?.raceId && m.generation === (this.lobby?.generation || 0)) {
        if (m.standings) this.lobby.standings = m.standings;
        if (m.world) { this.lobby.world = m.world; this.hooks.world?.(m.world.state, Math.max(0, (this.now() - m.world.at) / 1000)); }
        for (const p of m.players || []) { const member = this.lobby.players.find(x => x.id === p.id); if (member) { member.finish = p.finish; member.dnf = p.dnf; } }
        receiveRemoteSnapshot(this.peers, m, { id: this.id, members: this.lobby.players, networkDelay: this.latency / 2 });
        // Websocket messages keep race state current even when background tabs stop animation frames.
        this.advanceClock();
        if (document.hidden && this.worldReady) this.hooks.remote(this.peers, 0.1);
      }
    };
    ws.onclose = e => {
      if (this.ws !== ws) return;
      if (this.reloadRequired || e.code === UPDATE_CLOSE_CODE) { this.requireReload(); return; }
      this.lastClose = { code: e.code, reason: e.reason, at: Date.now() };
      // An ended account session is not an update: let the account gate take over instead of reloading.
      if (e.code === AUTH_CLOSE_CODE) void globalThis.__bootMenu?.accounts?.revalidate?.();
      console.warn('Multiplayer socket closed', this.lastClose);
      this.loadedKey = null; this.connected = false;
      this.cancelRecovery('Connection lost before recovery completed.');
      this.stateSender.reset(); this.wreckSent = false;
      resetRemoteTimelines(this.peers);
      if (e.reason === 'Session resumed elsewhere') { this.left(); this.saveToken(null); this.status('This session is now open in another tab.'); return; }
      this.status(this.active ? 'Connection lost. Rejoining your race… (90-second reservation)' : 'Multiplayer is offline. Retrying…');
      this.retryConnection(ws);
    };
    ws.onerror = () => { if (!this.reloadRequired) { this.status('Reconnecting…'); this.retryConnection(ws); } };
  }
  renderEvents(mapId) {
    const select = this.$('mp-event'), previous = select.value;
    select.replaceChildren();
    for (const e of this.events.filter(e => (e.mapId || 'riviera') === mapId && ['sprint', 'free'].includes(e.type))) {
      const option = document.createElement('option'); option.value = e.id;
      option.textContent = describeMode(e.type);
      select.append(option);
    }
    if ([...select.options].some(o => o.value === previous)) select.value = previous;
  }
  retryMap() { this.failedMap = null; return this.syncLobby(); }
  syncLobby() {
    if (!this.loaded || !this.lobby) return Promise.resolve();
    if (this.preparing) return this.preparing;
    const mapId = this.lobby.mapId || 'riviera';
    if (this.mapId !== mapId) {
      if (this.failedMap === mapId) return Promise.resolve();
      this.panel.hidden = false; this.hooks.clearInput(); this.status('Loading the lobby track…');
      this.preparing = Promise.resolve().then(() => this.hooks.mapChanged(mapId)).then(() => {
        this.preparing = null; this.failedMap = null;
        return this.syncLobby(); // membership or the selected map may have changed during loading
      }, error => {
        this.preparing = null; this.failedMap = mapId;
        this.status('Could not load the lobby track. Choose another track or leave the lobby.');
        console.warn('Multiplayer track loading failed:', error);
        if (this.lobby) this.renderRoom();
      });
      this.renderRoom();
      return this.preparing;
    }
    if (!this.worldReady) { this.renderRoom(); return Promise.resolve(); }
    const lobby = this.lobby;
    const loadedKey = `${lobby.code}:${this.mapId}:${this.trackVersion}:${lobby.raceId || ''}`;
    if (this.loadedKey !== loadedKey) { this.loadedKey = loadedKey; this.loadedAt = performance.now(); this.send({ type: 'loaded', loaded: true, mapId: this.mapId, version: this.trackVersion }); }
    const appearance = this.hooks.appearance?.();
    if (appearance && JSON.stringify(appearance) !== this.appearanceKey) { this.appearanceKey = JSON.stringify(appearance); this.send({ type: 'appearance', ...appearance }); }
    if (lobby.world) this.hooks.world?.(lobby.world.state, Math.max(0, (this.now() - lobby.world.at) / 1000));
    if (lobby.status === 'waiting') { if (this.startedRace) { this.startedRace = null; this.peers.clear(); this.stateSender.reset(); this.hooks.wait(); } this.pendingResume = false; this.resumeState = null; if (!this.carPickerOpen && !this.hooks.inputOverlayOpen?.()) this.panel.hidden = false; }
    if (lobby.raceId && (this.startedRace !== lobby.raceId || this.pendingResume)) {
      const state = this.pendingResume ? this.resumeState : null;
      if (this.startedRace !== lobby.raceId) { this.contacts?.clear(); this.wreckedRace = null; this.wreckSent = false; }
      this.pendingResume = false; this.resumeState = null; this.startedRace = lobby.raceId;
      this.stateSender.reset(); this.finishSent = null;
      if (Number.isSafeInteger(state?.motionEpoch)) this.stateSender.motionEpoch = Math.max(this.stateSender.motionEpoch, state.motionEpoch + 1);
      this.hidePanel(); this.hooks.start(lobby, this.id, state);
    }
    this.renderRoom(); this.hooks.members(lobby.players.filter(p => p.id !== this.id));
    if (this.peers.size) this.hooks.remote(this.peers, 0.1);
    if (lobby.status === 'results') { if (!this.carPickerOpen && !this.hooks.inputOverlayOpen?.()) this.panel.hidden = false; this.hooks.results(); }
    else { this.advanceClock(); if (this.retired) { this.stateSender.reset(); this.hooks.wrecked(); this.sendWreck(); } }
    return Promise.resolve();
  }
  saveToken(token) { this.token = token; try { if (token) sessionStorage.setItem('paraliaki.session', token); else sessionStorage.removeItem('paraliaki.session'); } catch {} }
  left() { this.connectionState(false); this.reconnectHistory?.clear(); this.carPickerOpen = false; this.cancelRecovery(); this.selection?.reset(); this.retiredRace = null; this.creating = false; if (this.$) this.$('mp-create').disabled = false; this.stateSender.reset(); this.wreckedRace = null; this.wreckSent = false; this.resumeState = null; this.pendingResume = false; this.failedMap = null; this.loadedKey = this.appearanceKey = null; if (this.lobby) { this.lobby = null; this.startedRace = null; this.peers.clear(); this.hooks.leave(); } this.syncSessionControls(); this.board.hidden = true; this.$('mp-browser').hidden = false; this.$('mp-room').hidden = true; this.status('Find a lobby or create your own.'); const u = new URL(location.href); u.searchParams.delete('lobby'); history.replaceState(null, '', u); }
  renderDiscovery(lobbies) {
    const list = this.$('mp-list'); list.replaceChildren();
    if (!lobbies.length) { const p = document.createElement('p'); p.textContent = 'No public lobbies yet. Create one and invite other drivers.'; list.append(p); }
    for (const l of lobbies) {
      const row=document.createElement('article');row.className='mp-lobby';row.dataset.state=l.status;
      const title=document.createElement('h4');title.textContent=l.name;
      const route=document.createElement('p');route.textContent=(this.maps.find(m=>m.id===(l.mapId||'riviera'))?.name||'ATHENS RIVIERA')+' · '+(l.event?.name||'QUICK RACE');
      const state=document.createElement('span');state.className='mp-lobby-state';state.textContent=l.players.length+'/'+l.capacity+' DRIVERS · '+(l.status==='waiting'?'OPEN':l.status.toUpperCase());
      const b=document.createElement('button');b.innerHTML=(l.status==='waiting'?'JOIN RACE':'JOIN AT GRID')+icon('chevron-right');b.disabled=l.players.length>=l.capacity;b.onclick=()=>this.action('join',{code:l.code});
      row.append(title,route,state,b);list.append(row);
    }
  }

  renderRoom() {
    const l = this.lobby, me = this.me, host = l.host === this.id; this.$('mp-browser').hidden = true; this.$('mp-room').hidden = false;
    this.$('mp-room-name').textContent = l.name; this.$('mp-room-code').textContent = l.code;
    this.$('mp-room-help').textContent = this.roomHelpText();
    this.status(this.preparing ? 'Loading the lobby track…' : this.versionMismatch ? 'The lobby track was updated. Reload the game to update.' : this.failedMap === (l.mapId || 'riviera') ? 'Could not load the lobby track. Choose another track or leave the lobby.' : `Connected · ${Math.round(this.latency)} ms · ${l.players.length}/8 drivers`);
    // Guests keep choosing cars while the lobby track loads (ready gating
    // stays server-side), and an open dropdown is never snapped back by a
    // host edit arriving mid-selection.
    if (document.activeElement !== this.$('mp-room-car')) this.$('mp-room-car').value = me?.car;
    this.$('mp-room-car').disabled = !this.canChangeCar;
    this.$('mp-map').value = l.mapId || 'riviera'; this.$('mp-map').disabled = !!this.preparing || l.status !== 'waiting';
    this.renderEvents(l.mapId || 'riviera');
    this.$('mp-event').value = l.eventId || 'quick'; this.$('mp-event').disabled = !this.worldReady || l.status !== 'waiting';
    this.$('mp-traffic').checked = l.traffic === true; this.$('mp-traffic').disabled = true; this.$('mp-traffic').closest('label').title = 'Shared ambient traffic is disabled in multiplayer.';
    // Guests never see fake-disabled host controls (see applyRoleVisibility);
    // the room summary below carries the host setup instead.
    this.applyRoleVisibility(l, host);
    if(this.$('mp-car-toggles'))this.renderCarToggles(l,host,new Set(this.allowedCars));
    const list = this.$('mp-members'); list.replaceChildren();
    for (const p of l.players) {
      const row = document.createElement('div'); row.className = 'mp-member';row.dataset.playerId=p.id;
      const label = document.createElement('span'); label.textContent = `${p.name}${p.id === this.id ? ' (YOU)' : ''}${p.id === l.host ? ' · HOST' : ''} · ${(c => c?.name || c?.short)(this.cars.find(c => c.id === p.car)) || p.car} · ${p.connected === false ? 'RECONNECTING' : !p.loaded ? 'LOADING' : p.ready ? 'READY' : 'NOT READY'}`;
      row.append(label);
      list.append(row);
    }
    this.$('mp-ready').disabled = !this.worldReady || l.status !== 'waiting'; this.$('mp-ready').innerHTML = me?.ready ? icon('check')+'READY · UNREADY' : 'READY TO RACE';
    this.$('mp-start').textContent = l.status === 'results' ? 'REMATCH' : 'START RACE'; this.$('mp-start').hidden = !host;
    this.$('mp-start').disabled = !this.worldReady || (l.status !== 'results' && (l.status !== 'waiting' || l.players.length < 2 || !l.players.every(p => p.ready && p.loaded && p.connected !== false)));
    this.$('mp-restart').hidden = !host || !['countdown', 'race', 'results'].includes(l.status);
    this.$('mp-tolobby').hidden = !host || l.status === 'waiting';
    this.renderResults();
    this.board.hidden = l.status === 'waiting';
  }
  roomHelpText() {
    const l = this.lobby, mode = String(l.mode || l.event?.type || 'sprint').toUpperCase(), eventName = l.event?.name || '';
    const message = l.status === 'waiting' ? 'Shared traffic off. The host starts when everyone is ready and loaded.' : l.status === 'results' ? `${this.objectiveMode ? 'Round' : 'Race'} complete. The host can prepare a rematch.` : this.me?.finish !== null ? 'You finished. Waiting for the other drivers; the race ends after ten minutes.' : 'Race in progress. Close this panel to keep driving.';
    const details = [this.maps.find(m => m.id === (l.mapId || 'riviera'))?.name, eventName];
    if (eventName.trim().toUpperCase() !== mode) details.push(mode);
    return message + (l.host !== this.id ? ` ${details.filter(Boolean).join(' · ')}` : '');
  }
  renderResults() {
    const l = this.lobby, results = this.$('mp-results'); results.replaceChildren();
    if (l.status === 'results') {
      const title = document.createElement('h3'); title.textContent = this.objectiveMode ? `${this.objectiveMode.toUpperCase()} RESULTS` : 'RACE RESULTS'; results.append(title);
      this.ranking().forEach((p, i) => {
        const row = document.createElement('p'); row.textContent = this.resultRowText(p, i);
        results.append(row);
      });
    }
  }
  get objectiveMode() { const mode = this.lobby?.mode || this.lobby?.event?.type; return ['taxi', 'getaway'].includes(mode) ? mode : null; }
  sessionDurationText() {
    const seconds = configFromLobby(this.lobby).sessionDuration;
    return this.resultTimeText(Number.isFinite(seconds) && seconds > 0 ? seconds : 300);
  }
  resultTimeText(seconds) { const whole = Math.max(0, Math.floor(seconds)); return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`; }
  resultRowText(p, i) {
    if (!this.objectiveMode) return p.finish != null ? `${i + 1}. ${p.name} · ${p.finish.toFixed(2)} s` : `DNF · ${p.name}${p.dnf === 'wrecked' ? ' · WRECKED' : ''}`;
    const count = p.objective?.completed || 0, noun = this.objectiveMode === 'taxi' ? 'fare' : 'mission';
    return `${p.dnf ? 'DNF' : i + 1} · ${p.name} · ${count} ${noun}${count === 1 ? '' : 's'} · best ${p.objective?.bestTrip == null ? '—' : this.resultTimeText(p.objective.bestTrip)}${p.dnf === 'wrecked' ? ' · WRECKED' : ''}`;
  }
  // Role visibility contract (UI owns presentation; this owns the rule):
  // host-only config rows hide for guests instead of showing fake-disabled
  // controls. Native control IDs (#mp-map, #mp-event, #mp-traffic,
  // #mp-room-car) stay canonical.
  applyRoleVisibility(lobby = this.lobby, host = lobby?.host === this.id) {
    if (!lobby || !this.$) return host;
    for (const id of ['mp-map', 'mp-event', 'mp-traffic']) { const row = this.$(id).closest('label'); if (row) row.hidden = !host; }
    return host;
  }
  // Host-only car toggles with quick presets. Unstyled hooks for the UI
  // agent: #mp-car-toggles [data-preset], label.mp-car-toggle input[data-car].
  renderCarToggles(lobby, host, allowed) {
    const box = this.$('mp-car-toggles'); box.replaceChildren();
    const show = host && lobby.status === 'waiting';
    box.hidden = !show;
    if (!show) return;
    for (const [preset, label] of [['all', 'ALL'], ['normal', 'NORMAL'], ['supercar', 'SUPERCARS']]) {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.dataset.preset = preset;
      b.onclick = () => this.setAllowedPreset(preset); box.append(b);
    }
    for (const car of sortTrims(this.cars.filter(inGarage))) {
      const label = document.createElement('label'); label.className = 'mp-car-toggle'; label.dataset.car = car.id;
      const input = document.createElement('input'); input.type = 'checkbox'; input.checked = allowed.has(car.id); input.dataset.car = car.id;
      // Deselecting the final checkbox is rejected server-side and locally
      // (setAllowedCars returns false): restore it so the UI never shows an
      // empty allow-list the lobby does not have.
      input.onchange = () => { if (!this.setAllowedCars([...box.querySelectorAll('input[data-car]:checked')].map(i => i.dataset.car))) input.checked = true; };
      label.append(input, document.createTextNode(car.short)); box.append(label);
    }
  }
  driverProgress(p) { return this.lobby?.standings?.find(row => row.id === p.id)?.progress || 0; }
  ranking() {
    const drivers = this.lobby?.results || this.lobby?.players || [];
    if (this.objectiveMode) return [...drivers].sort((a, b) => ((b.objective?.completed || 0) - (a.objective?.completed || 0)) || ((a.objective?.bestTrip ?? Infinity) - (b.objective?.bestTrip ?? Infinity)) || ((a.objective?.elapsed ?? Infinity) - (b.objective?.elapsed ?? Infinity)));
    const byId = new Map(drivers.map(p => [p.id, p]));
    return this.lobby?.standings ? this.lobby.standings.map(row => byId.get(row.id)).filter(Boolean) : rankDrivers(drivers, () => 0);
  }
  progress(s) { const r = this.lobby?.event; return r ? (s - r.s0) * r.dir : s; }
  advanceClock() {
    if (this.worldReady && (this.connected || this.startedRace === this.lobby?.raceId) && ['countdown', 'race'].includes(this.lobby?.status)) this.hooks.clock(this.me?.finish ?? Math.max(0, (this.now() - this.lobby.startAt) / 1000), Math.max(0, (this.lobby.startAt - this.now()) / 1000));
  }
  spectating() {
    if (!this.active || (this.me?.finish == null && !this.retired) || this.lobby.status === 'results') return null;
    this.selection ||= new SpectatorSelection();
    return this.selection.target(this.lobby.raceId, this.spectatorDrivers());
  }
  spectatorDrivers() {
    // A chosen finisher stays selected while the race is running. Disconnects/retirements are removed.
    return (this.lobby?.players || []).filter(p => p.id !== this.id && !p.dnf && p.connected !== false && this.peers.has(p.id));
  }
  selectSpectator(id) { this.selection ||= new SpectatorSelection(); return this.selection.choose(id, this.lobby?.raceId, this.spectatorDrivers()); }
  stepSpectator(direction) { this.selection ||= new SpectatorSelection(); return this.selection.step(direction, this.lobby?.raceId, this.spectatorDrivers()); }
  telemetry(localState, id = this.spectating()?.id || this.id) {
    const member = this.lobby?.players.find(p => p.id === id), state = id === this.id ? localState : this.peers.get(id)?.state;
    return driverTelemetry({ member, state, event: this.lobby?.event, startAt: this.lobby?.startAt, now: this.now(), ranked: this.ranking(localState.s), progress: p => this.driverProgress(p, localState.s) });
  }
  async showLeaderboard() {
    const box = this.$('mp-times'); box.hidden = false; box.textContent = 'Loading best times…';
    try {
      const entries = await getLeaderboard({ mapId: this.lobby?.mapId || this.mapId || 'riviera', eventId: this.lobby?.eventId || 'quick', car: this.me?.car || this.$('mp-car').value, traffic: this.lobby?.traffic ?? false, reverse: this.lobby?.config?.reverse === true });
      box.replaceChildren(); const title = document.createElement('h3'); title.textContent = 'BEST TIMES · ' + (this.lobby?.event?.name || 'QUICK RACE'); box.append(title);
      if (!entries.length) { const row = document.createElement('p'); row.textContent = 'No recorded times yet.'; box.append(row); }
      entries.forEach((e, i) => { const row = document.createElement('p'); row.textContent = `${i + 1}. ${e.name} · ${e.time.toFixed(2)} s · ${e.car}`; box.append(row); });
    } catch { box.textContent = 'Best times are unavailable. Try again shortly.'; }
  }
  update(dt, state) {
    if (!this.lobby || !this.worldReady) return;
    this.hooks.remote(this.peers, dt);
    const l = this.lobby;
    // The server resets "loaded" when a driver joins or the track changes, and quietly ignores a vote it cannot match.
    // Keep telling it, every few seconds, until the lobby agrees this driver is loaded, so nobody sits on LOADING for ever.
    if (l.status === 'waiting' && this.connected && this.me && this.me.loaded === false && this.loadedKey && performance.now() - (this.loadedAt || 0) > LOADED_RETRY_MS) {
      this.loadedAt = performance.now(); this.send({ type: 'loaded', loaded: true, mapId: this.mapId, version: this.trackVersion });
    }
    if (['countdown', 'race'].includes(l.status)) {
      this.advanceClock();
      if (this.now() >= l.startAt && this.me?.finish == null && !this.retired && !this.recoveryPending) {
        const force = this.finishSent !== l.raceId && (state.s - l.event.s1) * l.event.dir >= 0 && Math.abs(state.u) < 30;
        if (force) this.finishSent = l.raceId;
        this.stateSender.sample(state, l.raceId, { batching: this.stateBatching, force });
      }
    }
    if (this.connected) this.reconnectHistory?.flush(p => this.send(p), l.generation || 0, performance.now());
    if (performance.now() - (this.boardAt || 0) > 250) {
      if (this.board.contains?.(document.activeElement)) return;
      this.boardAt = performance.now(); renderLiveBoard(this,state);
    }
  }
}
