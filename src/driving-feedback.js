import * as THREE from 'three';
import { DrivingGuidance } from './driving-guidance.js';
import { settings as preferences, setSetting, onSettings } from './settings.js';
import { gripFeedback } from './driving-feedback-model.js';

const colors = { go: [0.15, .95, .48], prepare: [1, .68, .12], brake: [1, .18, .16] };
const speedText = (mps, units) => `${Math.round(mps * (units === 'mph' ? 2.236936 : 3.6))} ${units === 'mph' ? 'MPH' : 'KM/H'}`;
const preferencesKey = 'paraliaki.driving-feedback';
export class DrivingFeedback {
  constructor({ scene, input, document: doc = globalThis.document } = {}) {
    this.doc = doc; this.scene = scene; this.input = input; this.guidance = new DrivingGuidance(); this.nextUpdate = 0;
    this.options = { grip: preferences.showTyreGrip === true, line: false };
    this.unsubscribe = onSettings(st => { this.options.grip=st.showTyreGrip===true;this.nextUpdate=0;const box=this.root?.querySelector('[data-option=grip]');if(box)box.checked=this.options.grip; });
    try { const saved = JSON.parse(globalThis.localStorage?.getItem(preferencesKey) || '{}'); for (const k of ['line']) if (typeof saved[k] === 'boolean') this.options[k] = saved[k]; } catch {}
    if (doc) this.mount();
  }
  mount() {
    const doc = this.doc;
    if (!doc.getElementById('driving-feedback-css')) { const css = doc.createElement('link'); css.id = 'driving-feedback-css'; css.rel = 'stylesheet'; css.href = new URL('./driving-feedback.css', import.meta.url).href; doc.head.append(css); }
    const root = this.root = doc.createElement('aside'); root.id = 'driving-feedback'; root.hidden = true; root.setAttribute('aria-label', 'Driving feedback and optional assists');
    root.innerHTML = `<div class="df-heading"><span data-driver>TYRE GRIP</span><button type="button" class="df-options" aria-label="Driving assist options" aria-expanded="false">ASSISTS</button></div>
      <div class="df-settings" hidden><label><input type="checkbox" data-option="grip">Live tyre grip</label><label><input type="checkbox" data-option="line">Road braking line</label><small>Advisory · allows for car grip and weather; watch traffic.</small></div>
      <div class="df-grip"><div class="df-axle" data-axle="front"><span>FRONT</span><meter min="0" max="100" value="0" aria-label="Front tyre grip utilization"></meter><output>—</output></div>
      <div class="df-axle" data-axle="rear"><span>REAR</span><meter min="0" max="100" value="0" aria-label="Rear tyre grip utilization"></meter><output>—</output></div></div><p class="df-guidance" hidden></p>`;
    this.grip = root.querySelector('.df-grip'); this.cue = root.querySelector('.df-guidance'); this.driver = root.querySelector('[data-driver]');
    this.axles = ['front', 'rear'].map(k => { const row = root.querySelector(`[data-axle=${k}]`); return { row, meter: row.querySelector('meter'), value: row.querySelector('output') }; });
    const settings = root.querySelector('.df-settings'), button = root.querySelector('button');
    button.addEventListener('click', () => { settings.hidden = !settings.hidden; button.setAttribute('aria-expanded', String(!settings.hidden)); });
    for (const checkbox of root.querySelectorAll('[data-option]')) {
      checkbox.checked = this.options[checkbox.dataset.option]; checkbox.addEventListener('change', () => {
        this.options[checkbox.dataset.option] = checkbox.checked;
        if(checkbox.dataset.option==='grip')setSetting('showTyreGrip',checkbox.checked); this.nextUpdate = 0;
        this.grip.hidden = !this.options.grip; this.cue.hidden = !this.options.line;
        if (!this.options.line && this.line) this.line.visible = false;
        try { globalThis.localStorage?.setItem(preferencesKey, JSON.stringify(this.options)); } catch {}
      });
    }
    doc.body.append(root);
  }
  createLine() {
    // One reusable chevron mesh, at most 75 route samples. Only built on opting in.
    const count = this.guidance.capacity - 1, positions = new Float32Array(count * 9), color = new Float32Array(count * 9);
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('color', new THREE.BufferAttribute(color, 3).setUsage(THREE.DynamicDrawUsage));
    const material = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: .78, side: THREE.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    this.line = new THREE.Mesh(geometry, material); this.line.name = 'driving-braking-assist'; this.line.frustumCulled = false; this.line.renderOrder = 2; this.scene.add(this.line);
  }
  update({ vehicle, route = vehicle?.route, dir, visible = true, spectating = false, driverName = '', units = 'kmh', wetGrip = 1, endS } = {}) {
    visible = visible && (this.options.grip || this.options.line);
    if (this.root) this.root.hidden = !visible;
    if (!visible || !vehicle) { this.nextUpdate = 0; if (this.line) this.line.visible = false; if (this.root && visible) this.showGrip(null); if (this.cue) this.cue.hidden = true; return; }
    const now = globalThis.performance?.now?.() || Date.now();
    const changed = vehicle !== this.lastVehicle || route !== this.lastRoute || dir !== this.lastDir || visible !== this.lastVisible;
    this.lastVisible = visible;
    if (!changed && now < this.nextUpdate) return;
    this.nextUpdate = now + 100; this.lastVehicle = vehicle; this.lastRoute = route; this.lastDir = dir;
    if (this.driver) this.driver.textContent = spectating ? `${driverName || 'WATCHING DRIVER'} · GRIP` : 'TYRE GRIP';
    if (this.root) {
      // The online board grows with the roster. Measure only at 10 Hz, never move another owner's panel.
      const board = this.doc.getElementById('mp-board'), r = board && !board.hidden ? board.getBoundingClientRect() : null;
      const top = r?.height ? r.bottom + 12 : 145;
      this.root.style.setProperty('--df-top', `${top}px`);
      this.root.style.setProperty('--df-max-height', `${Math.max(60, (globalThis.innerHeight || 800) - top - 140)}px`);
      this.showGrip(spectating && !vehicle.remoteTyreTelemetry ? null : spectating ? vehicle.remoteTyreTelemetry : vehicle.tyreTelemetry);
    }
    if (!this.options.line || !this.scene || spectating && !vehicle.spec) { if (this.line) this.line.visible = false; if (this.cue) this.cue.hidden = true; return; }
    const guidance = this.guidance.update(vehicle, route, { dir, wetGrip, endS });
    if (this.cue) {
      this.cue.hidden = !guidance.available;
      if (guidance.available) { this.cue.dataset.tone = guidance.tone; this.cue.textContent = guidance.corner ? `${guidance.tone === 'brake' ? 'BRAKE' : guidance.tone === 'prepare' ? 'EASE OFF' : 'CLEAR'} · ${speedText(guidance.targetSpeed, units)} advisory${guidance.targetDistance ? ' in ' + Math.round(guidance.targetDistance) + ' m' : ''}` : 'CLEAR · Road line advisory'; }
    }
    if (!guidance.available) { if (this.line) this.line.visible = false; return; }
    if (!this.line) this.createLine(); this.line.visible = true;
    const geometry = this.line.geometry, positions = geometry.attributes.position.array, color = geometry.attributes.color.array;
    let count = 0;
    for (let i = 1; i < guidance.count - 1; i++) {
      const n = guidance.nodes[i], next = guidance.nodes[i + 1], dx = next.x - n.x, dz = next.z - n.z, len = Math.hypot(dx, dz);
      if (len < .1) continue;
      const fx = dx / len, fz = dz / len, width = Math.min(.55, Math.max(.1, (route.edge(n.s) - Math.abs(n.u)) * .65));
      const offset = count * 9;
      positions.set([n.x - fz * width, n.y, n.z + fx * width, n.x + fz * width, n.y, n.z - fx * width, n.x + fx * 1.5, n.y + (next.y - n.y) * Math.min(1, 1.5 / len), n.z + fz * 1.5], offset);
      const c = colors[n.tone]; for (let v = 0; v < 3; v++) for (let ch = 0; ch < 3; ch++) color[offset + v * 3 + ch] = c[ch]; count++;
    }
    geometry.setDrawRange(0, count * 3); geometry.attributes.position.needsUpdate = geometry.attributes.color.needsUpdate = true;
  }
  showGrip(telemetry) {
    if (!this.root) return;
    // Meters only: the sliding / spin sentence under them read as a popup telling you that you spun (playtest).
    const model = gripFeedback(telemetry); this.grip.hidden = !this.options.grip;
    ['front', 'rear'].forEach((k, i) => { const a = model[k], { row, meter, value } = this.axles[i]; meter.value = a?.percent || 0;
      row.dataset.state = a?.state || 'UNAVAILABLE'; value.textContent = a ? `${a.percent}% · ${a.state}` : '—'; meter.setAttribute('aria-valuetext', a ? `${a.percent}% force used, ${a.state.toLowerCase()}` : 'Unavailable'); });
  }
  dispose() { this.unsubscribe?.();this.root?.remove(); if (this.line) { this.line.removeFromParent(); this.line.geometry.dispose(); this.line.material.dispose(); } }
}
