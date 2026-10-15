// Browser adapter for replay.js. Owns ghost visuals, replay/photo controls and the camera override.
import * as THREE from 'three';
import { bestGhostEvent } from './personal-bests.js';
import { Recorder, GhostStore, sampleReplay, encodeReplay, decodeReplay, ghostKey, ghostOpacity, MAX_REPLAY_BYTES } from './replay.js';
import { CARS, CarModel } from './cars.js';
import { events } from './events.js';
import { settings, onSettings } from './settings.js';
import { PHOTO_FILTERS } from './post.js';
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const fmt = t => `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, '0')}`;
const vec = new THREE.Vector3(), q = new THREE.Quaternion(), euler = new THREE.Euler(0, 0, 0, 'YXZ');
function download(blob, name) {
  const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
}
function applyState(model, s) {
  model.root.position.fromArray(s.position); model.root.quaternion.fromArray(s.quaternion);
  model.body.position.y = s.heave; model.body.rotation.set(s.pitch, 0, s.roll, 'YXZ');
  // Let the model calculate Ackermann steering, then restore the recorded unwrapped wheel phase.
  model.update(0, s.speed, s.steer, s.brake, { pitch: s.pitch, roll: s.roll, heave: s.heave });
  for (const w of model.wheels) { w.angle = s.spin; w.spin.rotation.x = s.spin; }
  for (const z of ['front', 'rear', 'left', 'right']) model.setDamage?.(z, s.damage[z]);
  model.root.updateMatrixWorld(true);
}
export function initReplay(ctx) {
  const mode = new ReplayMode(ctx); window.__replay = mode; return mode;
}
class ReplayMode {
  constructor(ctx) {
    this.ctx = ctx; this.store = new GhostStore(); this.choices = new Map(); this.spins = []; this.active = false;
    this.time = 0; this.rate = 1; this.playing = true; this.cameraMode = 'director'; this.orbit = { yaw: .4, pitch: .25, radius: 8 };
    this.ready = this.store.all().then(() => { if (window.__flow?.menu?.screen === 'events') window.__flow.menu.render(); });
    events.on('start', p => this.start(p)); events.on('split', p => this.split(p));
    events.on('finish', r => this.finish(r)); events.on('abort', () => { this.recorder = null; this.hideGhost(); });
    onSettings((s, key) => { if (key === 'ghostEnabled' && !s.ghostEnabled) this.hideGhost(); });
    const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = new URL('./replay.css', import.meta.url).href; document.head.append(css);
    this.ui = document.createElement('section'); this.ui.id = 'replay-controls'; this.ui.hidden = true; document.body.append(this.ui);
    this.delta = document.createElement('div'); this.delta.id = 'ghost-delta'; this.delta.hidden = true; document.body.append(this.delta);
    this.ctx.canvas.addEventListener('pointerdown', ev => {
      if (!this.active || (this.kind !== 'photo' && this.cameraMode !== 'orbit')) return;
      this.drag = { id: ev.pointerId, x: ev.clientX, y: ev.clientY }; this.ctx.canvas.setPointerCapture?.(ev.pointerId); ev.stopImmediatePropagation();
    }, true);
    this.ctx.canvas.addEventListener('pointermove', ev => {
      if (!this.drag || ev.pointerId !== this.drag.id) return;
      const dx = ev.clientX - this.drag.x, dy = ev.clientY - this.drag.y; this.drag.x = ev.clientX; this.drag.y = ev.clientY;
      if (this.kind === 'photo') { this.photoState.yaw -= dx * .004; this.photoState.pitch = clamp(this.photoState.pitch - dy * .004, -1.5, 1.5); }
      else { this.orbit.yaw -= dx * .004; this.orbit.pitch = clamp(this.orbit.pitch + dy * .004, -.05, 1.45); }
      ev.stopImmediatePropagation();
    }, true);
    for (const type of ['pointerup', 'pointercancel']) this.ctx.canvas.addEventListener(type, ev => { if (this.drag?.id === ev.pointerId) this.drag = null; });
    this.ctx.canvas.addEventListener('wheel', ev => {
      if (!this.active) return;
      if (this.kind === 'photo') this.flySpeed = clamp((this.flySpeed || 8) * Math.exp(ev.deltaY * .001), .5, 100);
      else this.orbit.radius = clamp(this.orbit.radius * Math.exp(ev.deltaY * .001), 2, 60);
      ev.preventDefault(); ev.stopImmediatePropagation();
    }, { passive: false, capture: true });
  }
  get cars() { return [this.ctx.player(), ...this.ctx.grid()]; }
  capture(dt = 0) {
    return this.cars.map((c, i) => {
      const v = c.veh;
      const r = c.model.wheels[0]?.r || .33; this.spins[i] = (this.spins[i] || 0) - v.vLong * dt / r;
      q.setFromEuler(euler.set(Math.atan(v.grade || 0), v.yaw, Math.atan(v.bank || 0), 'YXZ'));
      return { position: [v.x, v.y, v.z], quaternion: q.toArray(), speed: v.vLong, steer: v.steer, spin: this.spins[i], s: v.s,
        brake: i === 0 ? this.ctx.input.brake > .3 : !!c.lastBrake, damage: v.damage,
        pitch: v.pose.pitch, roll: v.pose.roll, heave: v.pose.heave };
    });
  }
  start(p) {
    this.hideGhost(); this.spins = []; this.last = null; this.saved = null; this.lastSave = Promise.resolve(null);
    const run = p.run, routeKey = `${Math.round(run.r.s0)}>${Math.round(run.r.s1)}`;
    this.recorder = new Recorder(this.cars.map(c => ({ car: c.spec.id, name: c.name || 'YOU' })),
      { eventId: p.eventId, car: p.car, routeKey, trackVersion: this.ctx.trackVersion(), type: p.type, pbEventId: this.ctx.G.bestSetup ? bestGhostEvent(this.ctx.G.bestSetup) : null });
    this.recorder.tick(0, this.capture()); this.startToken = (this.startToken || 0) + 1;
    const token = this.startToken;
    if (!['timetrial', 'sprint'].includes(p.type) || !settings.ghostEnabled || this.choices.get(p.eventId) === null) return;
    const selected = this.choices.get(p.eventId), cached = selected ? this.store.cache.get(selected) : null;
    Promise.resolve(cached || this.store.load(this.recorder?.metadata.pbEventId || p.eventId, p.car)).then(r => {
      if (token !== this.startToken || !this.recorder || !settings.ghostEnabled || !r || r.routeKey !== routeKey || r.trackVersion !== this.ctx.trackVersion()) return;
      this.ghostReplay = r; this.buildGhost(r.car);
    });
  }
  tick(dt) { if (this.recorder) this.recorder.tick(dt, this.capture(dt)); }
  finish(result) {
    if (!this.recorder) return;
    this.last = this.recorder.finish({ time: result.time ?? this.recorder.elapsed, splits: result.splits, resultType: result.type });
    this.recorder = null; this.hideGhost();
    if (['timetrial', 'sprint'].includes(result.type) && result.valid && result.time != null && !this.last.truncated) {
      this.lastSave = Promise.resolve().then(() => result.personalBest?.eligible === false ? { saved: false, best: null, persistent: false } : this.store.saveBest({ ...this.last, eventId: this.last.pbEventId || this.last.eventId })).then(s => {
        this.saved = s;
        this.ctx.hud.message(s.saved ? (s.persistent ? 'BEST GHOST <i>SAVED</i>' : 'BEST GHOST <i>IN MEMORY · EXPORT TO KEEP</i>') : 'BEST GHOST <i>KEPT</i>', 4);
        return s;
      });
    }
  }
  split(p) {
    const best = this.ghostReplay?.splits?.[p.index];
    if (!settings.ghostEnabled || best == null) return;
    const delta = p.time - best; this.delta.textContent = `GHOST ${delta >= 0 ? '+' : '−'}${Math.abs(delta).toFixed(2)}`;
    this.delta.classList.toggle('ahead', delta < 0); this.delta.hidden = false;
    clearTimeout(this.deltaTimer); this.deltaTimer = setTimeout(() => { this.delta.hidden = true; }, 5000);
  }
  buildGhost(car) {
    if (this.ghost?.spec.id !== car) {
      if (this.ghost) this.disposeGhost();
      const spec = CARS.find(c => c.id === car); if (!spec) return;
      const model = new CarModel(spec), mat = new THREE.MeshBasicMaterial({ color: '#8de8ff', transparent: true, opacity: .28, depthWrite: false });
      const materials = new Set(); model.root.traverse(o => { if (o.isMesh) { for (const m of Array.isArray(o.material) ? o.material : [o.material]) materials.add(m); o.material = mat; o.castShadow = o.receiveShadow = false; } });
      // CarModel's ground-contact blob is a visual shadow even with castShadow=false.
      // Keep it hidden instead of recolouring it into a cyan rectangle below the ghost.
      for (const o of model.root.children) if (o.isMesh && o.geometry.type === 'PlaneGeometry' && Math.abs(o.rotation.x + Math.PI / 2) < .001) {
        o.visible = false; o.userData.ghostContactShadow = true;
      }
      // CarModel's generated geometry is owned by this model; textures/materials may be shared with live cars.
      this.ghost = { model, spec, mat, originalMaterials: materials }; this.ctx.scene.add(model.root);
    }
    this.ghost.model.root.visible = true;
  }
  disposeGhost() {
    const g = this.ghost; g.model.root.removeFromParent(); const geos = new Set(); g.model.root.traverse(o => { if (o.geometry) geos.add(o.geometry); });
    for (const geo of geos) geo.dispose(); g.mat.dispose();
    for (const m of g.originalMaterials) m.dispose(); this.ghost = null;
  }
  hideGhost() { this.startToken = (this.startToken || 0) + 1; if (this.ghost) this.ghost.model.root.visible = false; this.ghostReplay = null; }
  listGhosts(eventId) {
    return [...this.store.cache.entries()].filter(([, r]) => r.eventId === eventId && r.trackVersion === this.ctx.trackVersion()).map(([id, r]) =>
      ({ id, name: `${CARS.find(c => c.id === r.car)?.short || r.car} · BEST`, time: r.time }));
  }
  selectedGhost(eventId) {
    if (this.choices.has(eventId)) return this.choices.get(eventId);
    const key = ghostKey(eventId, this.ctx.player().spec.id); return this.store.cache.has(key) ? key : null;
  }
  selectGhost(eventId, id) { this.choices.set(eventId, id); }
  async importGhost(file) {
    if (!file) {
      file = await new Promise(resolve => {
        const input = document.createElement('input'); input.type = 'file'; input.accept = '.ghost,.json,application/json';
        input.addEventListener('change', () => resolve(input.files[0])); input.addEventListener('cancel', () => resolve(null)); input.click();
      });
    }
    if (!file) return null;
    try {
      if (file.size > MAX_REPLAY_BYTES * 1.4 + 65536) throw new Error('Ghost file is too large');
      const r = decodeReplay(await file.text());
      if (!CARS.some(c => c.id === r.car)) throw new Error('This ghost uses an unsupported car');
      if (r.trackVersion !== this.ctx.trackVersion()) throw new Error('Ghost belongs to a different route version');
      const s = await this.store.saveBest(r); this.choices.set(r.eventId, ghostKey(r.eventId, r.car)); return s;
    } catch (err) { this.ctx.hud.message('GHOST IMPORT <i>' + String(err.message).replace(/[<>]/g, '') + '</i>', 6); return { error: err.message }; }
  }
  async exportGhost(eventId) {
    await this.lastSave;
    const r = [...this.store.cache.values()].find(r => r.eventId === (eventId || this.last?.eventId) && r.car === this.ctx.player().spec.id) || this.last;
    if (!r) { this.ctx.hud.message('NO GHOST <i>FINISH A TIME TRIAL FIRST</i>', 3); return false; }
    download(new Blob([encodeReplay(r)], { type: 'application/json' }), `${r.eventId}-${r.car}.ghost`); return true;
  }
  watch() {
    if (!this.last || this.ctx.online() || !['results', 'finished'].includes(this.ctx.G.state)) return false;
    this.returnState = { state: this.ctx.G.state, cam: this.ctx.G.cam, screen: window.__flow.menu.screen, payload: window.__flow.menu.data };
    this.active = true; this.kind = 'replay'; this.ctx.G.state = 'replay'; this.time = 0; this.playing = true; this.hudVisible = false;
    this.replayCars = this.cars.slice(); this.visibility = this.replayCars.map(c => c.model.root.visible);
    this.damageBefore = this.replayCars.map(c => ({ ...c.veh.damage })); this.ctx.controls.clear(); window.__flow.menu.hide();
    document.body.classList.add('replay-active'); this.ctx.post.resetHistory?.(); this.makeReplayUI(); this.ui.hidden = false; this.setHud(false); this.visual(0); return true;
  }
  setHud(visible) { this.hudVisible = visible; document.body.classList.toggle('replay-hide-hud', !visible); }
  makeReplayUI() {
    this.ui.innerHTML = `<div class="replay-title"><b>REPLAY</b><span>TRAFFIC HIDDEN · P PHOTO MODE</span><button data-close>BACK TO RESULTS</button></div>
      <div class="replay-timeline"><button data-play>PAUSE</button><output data-time></output><input aria-label="Replay timeline" data-scrub type="range" min="0" max="${this.last.duration}" step="0.01" value="${this.time}"></div>
      <div class="replay-options"><label>SPEED <select data-speed aria-label="Replay speed"><option value=".25">0.25×</option><option value=".5">0.5×</option><option selected value="1">1×</option><option value="2">2×</option></select></label>
      <label>CAMERA <select data-camera aria-label="Replay camera"><option value="director">AUTO DIRECTOR</option><option value="chase">CHASE</option><option value="cockpit">COCKPIT</option><option value="orbit">FREE ORBIT</option><option value="helicopter">HELICOPTER</option><option value="bumper">LOW BUMPER</option><option value="tv">TRACKSIDE TV</option></select></label>
      <button data-hud>SHOW HUD</button></div>`;
    this.ui.querySelector('[data-close]').onclick = () => this.close(); this.ui.querySelector('[data-play]').onclick = () => this.togglePlay();
    this.ui.querySelector('[data-scrub]').oninput = ev => this.scrub(+ev.target.value);
    this.ui.querySelector('[data-speed]').value = String(this.rate); this.ui.querySelector('[data-speed]').onchange = ev => { this.rate = +ev.target.value; };
    this.ui.querySelector('[data-camera]').value = this.cameraMode; this.ui.querySelector('[data-camera]').onchange = ev => { this.cameraMode = ev.target.value; };
    this.ui.querySelector('[data-hud]').onclick = ev => { this.setHud(!this.hudVisible); ev.target.textContent = this.hudVisible ? 'HIDE HUD' : 'SHOW HUD'; };
  }
  togglePlay() { this.playing = !this.playing; const b = this.ui.querySelector('[data-play]'); if (b) b.textContent = this.playing ? 'PAUSE' : 'PLAY'; }
  scrub(time) { this.time = clamp(time, 0, this.last.duration); this.playing = false; this.ctx.post.resetHistory?.(); this.visual(0); }
  photo() {
    if (this.kind === 'photo') { this.closePhoto(); return true; }
    if (this.ctx.online() || (this.kind !== 'replay' && this.ctx.G.state !== 'paused')) return false;
    this.photoReturn = { kind: this.kind, playing: this.playing, cam: this.ctx.G.cam, state: this.ctx.G.state, hud: this.hudVisible,
      screen: window.__flow.menu.screen, data: window.__flow.menu.data };
    this.active = true; this.kind = 'photo'; this.playing = false; this.ctx.G.state = 'photo'; this.ctx.G.cam = 'photo';
    euler.setFromQuaternion(this.ctx.camera.quaternion, 'YXZ');
    this.photoState = { position: this.ctx.camera.position.clone(), yaw: euler.y, pitch: euler.x, roll: 0, fov: this.ctx.camera.fov,
      focus: this.ctx.camera.position.distanceTo(this.ctx.player().model.root.position), dof: 0, exposure: 0, contrast: 0, saturation: 1, vignette: 0.22, filter: 'neutral' };
    this.flySpeed = 8; this.ctx.controls.clear(); window.__flow.menu.hide(); document.body.classList.add('replay-active'); this.setHud(false);
    this.ctx.post.resetHistory?.(); this.makePhotoUI(); this.ui.hidden = false; this.ctx.post.setPhoto(this.photoState); return true;
  }
  makePhotoUI() {
    const s = this.photoState;
    this.ui.innerHTML = `<div class="replay-title"><b>PHOTO MODE</b><span>DRAG TO LOOK · WASD MOVE · Q/E UP/DOWN · SHIFT FAST · WHEEL SPEED</span><button data-close>CLOSE · P / ESC</button></div>
      <div class="photo-options">${[['fov', 'FOV', 20, 110, 1], ['roll', 'ROLL', -3.14, 3.14, .01], ['focus', 'FOCUS · M', .5, 200, .5], ['dof', 'DEPTH OF FIELD', 0, 9, .1], ['exposure', 'EXPOSURE · EV', -3, 3, .1], ['contrast', 'CONTRAST', -1, 1, .05], ['saturation', 'SATURATION', 0, 2, .05], ['vignette', 'VIGNETTE', 0, 1, .02]].map(([key, label, min, max, step]) =>
        `<label>${label}<input aria-label="Photo ${key}" data-photo-key="${key}" type="range" min="${min}" max="${max}" step="${step}" value="${s[key]}"><output>${s[key].toFixed(1)}</output></label>`).join('')}
      <label>FILTER<select aria-label="Photo filter" data-filter>${PHOTO_FILTERS.map(f => `<option value="${f}">${f.toUpperCase()}</option>`).join('')}</select></label>
      <label>EXPORT<select aria-label="Photo resolution" data-resolution><option value="2">2× SUPERSAMPLED</option><option value="3">3× SUPERSAMPLED</option></select></label><button data-save>SAVE PNG</button><output data-status></output></div>`;
    this.ui.querySelector('[data-close]').onclick = () => this.closePhoto();
    for (const input of this.ui.querySelectorAll('[data-photo-key]')) input.oninput = () => { s[input.dataset.photoKey] = +input.value; input.nextElementSibling.value = (+input.value).toFixed(1); this.ctx.post.setPhoto(s); };
    this.ui.querySelector('[data-filter]').onchange = ev => { s.filter = ev.target.value; this.ctx.post.setPhoto(s); };
    this.ui.querySelector('[data-save]').onclick = () => this.savePhoto(+this.ui.querySelector('[data-resolution]').value).catch(err => { this.ui.querySelector('[data-status]').textContent = err.message; });
  }
  async savePhoto(scale = 2) {
    if (this.kind !== 'photo' || this.capturing) return null;
    this.capturing = true; const { renderer, camera, post } = this.ctx, oldSize = renderer.getSize(new THREE.Vector2()), oldRatio = renderer.getPixelRatio();
    const w = Math.round(oldSize.x * clamp(scale, 2, 3)), h = Math.round(oldSize.y * clamp(scale, 2, 3));
    try {
      if (Math.max(w, h) > renderer.capabilities.maxTextureSize || w * h > 20000000) throw new Error('Choose 2× export for this display');
      renderer.setPixelRatio(1); renderer.setSize(w, h, false); post.setSize(w, h, 1); post.resetHistory?.(); camera.updateProjectionMatrix();
      this.updateCamera(0); this.ctx.render();
      const blob = await new Promise((resolve, reject) => renderer.domElement.toBlob(b => b ? resolve(b) : reject(new Error('PNG capture failed')), 'image/png'));
      this.lastPhoto = { width: w, height: h, bytes: blob.size }; download(blob, `athens-street-racers-${Date.now()}.png`);
      this.ui.querySelector('[data-status]').textContent = `SAVED ${w} × ${h}`; return this.lastPhoto;
    } finally { renderer.setPixelRatio(oldRatio); renderer.setSize(oldSize.x, oldSize.y); post.setSize(oldSize.x, oldSize.y, oldRatio); post.resetHistory?.(); this.capturing = false; }
  }
  closePhoto() {
    if (this.kind !== 'photo') return;
    const r = this.photoReturn; this.ctx.post.clearPhoto(); this.ctx.post.resetHistory?.(); this.ctx.G.cam = r.cam; this.ctx.G.state = r.state; this.ctx.controls.clear();
    if (r.kind === 'replay') { this.kind = 'replay'; this.playing = r.playing; this.setHud(r.hud); this.makeReplayUI(); }
    else { this.active = false; this.kind = null; this.ui.hidden = true; document.body.classList.remove('replay-active', 'replay-hide-hud'); window.__flow.menu.show(r.screen || 'pause', r.data); }
  }
  close() {
    if (this.kind === 'photo') { this.closePhoto(); return; }
    if (!this.active) return;
    this.active = false; this.kind = null; this.ui.hidden = true; document.body.classList.remove('replay-active', 'replay-hide-hud'); this.ctx.controls.clear();
    this.ctx.G.state = this.returnState.state; this.ctx.G.cam = this.returnState.cam; this.ctx.post.resetHistory?.();
    this.replayCars.forEach((c, i) => { c.model.root.visible = this.visibility[i]; c.driver.head.visible = true; for (const z of Object.keys(this.damageBefore[i])) c.model.setDamage?.(z, this.damageBefore[i][z]); });
    window.__flow.menu.show(this.returnState.screen || 'results', this.returnState.payload);
  }
  action(name) {
    if (!this.active) return false;
    if (name === 'pause' || name === 'back') this.close();
    else if (this.kind === 'replay' && name === 'replayPlay') this.togglePlay();
    else if (this.kind === 'replay' && name === 'left') this.scrub(this.time - 5);
    else if (this.kind === 'replay' && name === 'right') this.scrub(this.time + 5);
    return true; // consume confirm/handbrake's shared Space/b0 edge exactly once
  }
  visual(dt) {
    const { G, traffic } = this.ctx;
    if (this.active && this.replayCars && (this.kind === 'replay' || this.photoReturn?.kind === 'replay')) {
      if (this.kind === 'replay' && this.playing) { this.time = Math.min(this.last.duration, this.time + dt * this.rate); if (this.time >= this.last.duration) this.playing = false; }
      this.replayCars.forEach((c, i) => { const s = sampleReplay(this.last, this.time, i); if (s) { c.model.root.visible = this.visibility[i]; applyState(c.model, s); } });
      for (const c of traffic.cars) c.m.root.visible = false;
      const timeline = this.ui.querySelector('[data-scrub]'); if (timeline) { timeline.value = this.time; this.ui.querySelector('[data-time]').value = `${fmt(this.time)} / ${fmt(this.last.duration)}`; this.ui.querySelector('[data-play]').textContent = this.playing ? 'PAUSE' : 'PLAY'; }
    }
    if (this.ghost && this.ghostReplay && settings.ghostEnabled && G.state === 'race') {
      const t = this.recorder?.elapsed || 0, root = this.ghost.model.root;
      applyState(this.ghost.model, sampleReplay(this.ghostReplay, t));
      this.ghost.mat.opacity = ghostOpacity(root.position.distanceTo(this.ctx.player().model.root.position));
      root.visible = t <= this.ghostReplay.duration && this.ghost.mat.opacity > .001;
    } else if (this.ghost) this.ghost.model.root.visible = false;
  }
  updateCamera(dt) {
    if (!this.active) return false;
    const { camera, controls } = this.ctx;
    if (this.kind === 'photo') {
      const s = this.photoState, keys = controls.keys, speed = this.flySpeed * dt * (keys.has('ShiftLeft') ? 4 : 1);
      q.setFromEuler(euler.set(s.pitch, s.yaw, 0, 'YXZ'));
      vec.set((keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0), 0, (keys.has('KeyS') ? 1 : 0) - (keys.has('KeyW') ? 1 : 0));
      if (vec.lengthSq()) s.position.addScaledVector(vec.normalize().applyQuaternion(q), speed);
      s.position.y += ((keys.has('KeyE') ? 1 : 0) - (keys.has('KeyQ') ? 1 : 0)) * speed;
      camera.position.copy(s.position); camera.quaternion.copy(q); camera.rotateZ(s.roll); camera.fov = s.fov; this.ctx.G.cam = 'photo';
    } else {
      const s = sampleReplay(this.last, this.time), root = this.replayCars[0].model.root;
      q.fromArray(s.quaternion); const target = vec.fromArray(s.position).add(new THREE.Vector3(0, .8, 0));
      let mode = this.cameraMode;
      if (mode === 'director') mode = ['tv', 'helicopter', 'bumper', 'chase'][Math.floor(this.time / 6) % 4];
      const shot = mode === 'tv' ? mode + Math.floor(Math.abs(s.s - sampleReplay(this.last, 0).s) / 180) : mode;
      if (shot !== this.lastShot) { this.ctx.post.resetHistory?.(); this.lastShot = shot; }
      camera.fov = mode === 'tv' ? 38 : mode === 'helicopter' ? 48 : 65;
      if (mode === 'cockpit') {
        const eye = this.ctx.player().cockpit.eye; camera.position.set(eye.x, eye.y, eye.z); this.replayCars[0].model.body.localToWorld(camera.position);
        this.replayCars[0].model.body.getWorldQuaternion(camera.quaternion); camera.rotateX(-.045);
      } else if (mode === 'tv') {
        // Fixed cameras along the actual driven route, each covering ~180 m; proximity chooses the shot.
        const start = sampleReplay(this.last, 0).s, direction = this.last.routeKey.split('>').map(Number), dir = direction[1] >= direction[0] ? 1 : -1;
        const station = start + dir * (Math.floor(Math.abs(s.s - start) / 180) * 180 + 90), route = this.ctx.route;
        const p = route.point(clamp(station, 0, route.length), route.edge(station) + 7);
        camera.position.set(p.x, route.surfaceY(station, route.edge(station) + 7) + 3.5, p.z); camera.lookAt(target);
      } else {
        let offset;
        if (mode === 'orbit') { const o = this.orbit; offset = new THREE.Vector3(Math.sin(o.yaw) * Math.cos(o.pitch) * o.radius, Math.sin(o.pitch) * o.radius + .4, Math.cos(o.yaw) * Math.cos(o.pitch) * o.radius); }
        else offset = mode === 'helicopter' ? new THREE.Vector3(12, 22, 10) : mode === 'bumper' ? new THREE.Vector3(0, .3, -this.replayCars[0].model.dims.L / 2 - .15) : new THREE.Vector3(0, 2.2, 7);
        offset.applyQuaternion(q); camera.position.fromArray(s.position).add(offset);
        if (mode === 'bumper') camera.quaternion.copy(q); else camera.lookAt(target);
      }
      root.updateMatrixWorld(true); this.replayCars[0].driver.head.visible = mode !== 'cockpit'; this.ctx.G.cam = mode === 'cockpit' ? 'cockpit' : 'replay';
      camera.near = mode === 'cockpit' || mode === 'bumper' ? .04 : .15;
    }
    camera.updateProjectionMatrix(); return true;
  }
}
