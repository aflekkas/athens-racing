// Player-only personal-best ghost recording and race visuals. No playback or camera controls.
import * as THREE from 'three';
import { bestGhostEvent } from './personal-bests.js';
import { Recorder, GhostStore, sampleGhost, ghostOpacity } from './ghost-lap.js';
import { CARS, CarModel } from './cars.js';
import { canonicalCarId } from './car-ids.js';
import { events } from './events.js';
import { settings, onSettings } from './settings.js';
const q = new THREE.Quaternion(), euler = new THREE.Euler(0, 0, 0, 'YXZ');
function applyState(model, s) {
  model.root.position.fromArray(s.position); model.root.quaternion.fromArray(s.quaternion);
  model.body.position.y = s.heave; model.body.rotation.set(s.pitch, 0, s.roll, 'YXZ');
  // Let the model calculate Ackermann steering, then restore the recorded unwrapped wheel phase.
  model.update(0, s.speed, s.steer, s.brake, { pitch: s.pitch, roll: s.roll, heave: s.heave });
  for (const w of model.wheels) { w.angle = s.spin; w.spin.rotation.x = s.spin; }
  for (const z of ['front', 'rear', 'left', 'right']) model.setDamage?.(z, s.damage[z]);
  model.root.updateMatrixWorld(true);
}
export function initGhostLap(ctx) {
  const ghost = new GhostLap(ctx); window.__ghostLap = ghost; return ghost;
}
class GhostLap {
  constructor(ctx) {
    this.ctx = ctx; this.store = new GhostStore(); this.spin = 0;
    events.on('start', p => this.start(p)); events.on('split', p => this.split(p));
    events.on('finish', r => this.finish(r)); events.on('abort', () => { this.recorder = null; this.hideGhost(); });
    onSettings((s, key) => { if (key === 'ghostEnabled' && !s.ghostEnabled) this.hideGhost(); });
    const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = new URL('./ghost-lap.css', import.meta.url).href; document.head.append(css);
    this.delta = document.createElement('div'); this.delta.id = 'ghost-delta'; this.delta.hidden = true; document.body.append(this.delta);
  }
  capture(dt = 0) {
    const c = this.ctx.player(), v = c.veh, r = c.model.wheels[0]?.r || .33;
    this.spin -= v.vLong * dt / r;
    q.setFromEuler(euler.set(Math.atan(v.grade || 0), v.yaw, Math.atan(v.bank || 0), 'YXZ'));
    return [{ position: [v.x, v.y, v.z], quaternion: q.toArray(), speed: v.vLong, steer: v.steer, spin: this.spin, s: v.s,
      brake: this.ctx.input.brake > .3, damage: v.damage,
      pitch: v.pose.pitch, roll: v.pose.roll, heave: v.pose.heave }];
  }

  start(p) {
    this.hideGhost(); this.spin = 0; this.recorder = null;
    if (this.ctx.online() || !['timetrial', 'sprint'].includes(p.type)) return;
    const run = p.run, routeKey = `${Math.round(run.r.s0)}>${Math.round(run.r.s1)}`;
    this.recorder = new Recorder([{ car: p.car, name: 'YOU' }],
      { ...(this.ctx.routeIdentity?.()||{}),eventId: p.eventId, car: p.car, routeKey, trackVersion: this.ctx.trackVersion(), type: p.type, pbEventId: this.ctx.G.bestSetup ? bestGhostEvent(this.ctx.G.bestSetup) : null });
    this.recorder.tick(0, this.capture()); this.startToken = (this.startToken || 0) + 1;
    const token = this.startToken;
    if (!settings.ghostEnabled) return;
    this.store.load(this.recorder.metadata.pbEventId || p.eventId, p.car).then(r => {
      if (token !== this.startToken || !this.recorder || !settings.ghostEnabled || !r || r.routeKey !== routeKey || r.trackVersion !== this.ctx.trackVersion()) return;
      const identity=this.ctx.routeIdentity?.();if(identity&&(['worldId','regionId','geometryHash','routeId','edition','direction','laps','projectionId','setupKey'].some(k=>r[k]!==identity[k])||r.version!==2))return;
      this.ghostLap = r; this.buildGhost(r.car);
    });
  }
  tick(dt) { if (this.recorder) this.recorder.tick(dt, this.capture(dt)); }
  finish(result) {
    if (!this.recorder) return;
    const lap = this.recorder.finish({ time: result.time ?? this.recorder.elapsed, splits: result.splits, resultType: result.type });
    this.recorder = null; this.hideGhost();
    if (result.valid && result.time != null && !lap.truncated && result.personalBest?.eligible !== false) {
      this.store.saveBest({ ...lap, eventId: lap.pbEventId || lap.eventId }).then(s => {
        this.ctx.hud.message(s.saved ? (s.persistent ? 'BEST GHOST <i>SAVED</i>' : 'BEST GHOST <i>IN MEMORY</i>') : 'BEST GHOST <i>KEPT</i>', 4);
      });
    }
  }
  split(p) {
    const best = this.ghostLap?.splits?.[p.index];
    if (!settings.ghostEnabled || best == null) return;
    const delta = p.time - best; this.delta.textContent = `GHOST ${delta >= 0 ? '+' : '−'}${Math.abs(delta).toFixed(2)}`;
    this.delta.classList.toggle('ahead', delta < 0); this.delta.hidden = false;
    clearTimeout(this.deltaTimer); this.deltaTimer = setTimeout(() => { this.delta.hidden = true; }, 5000);
  }
  buildGhost(car) {
    if (this.ghost?.spec.id !== car) {
      if (this.ghost) this.disposeGhost();
      const spec = CARS.find(c => c.id === canonicalCarId(car)); if (!spec) return;
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
  hideGhost() { this.startToken = (this.startToken || 0) + 1; if (this.ghost) this.ghost.model.root.visible = false; this.ghostLap = null; }
  visual() {
    const { G } = this.ctx;
    if (this.ghost && this.ghostLap && settings.ghostEnabled && G.state === 'race') {
      const t = this.recorder?.elapsed || 0, root = this.ghost.model.root;
      const state=sampleGhost(this.ghostLap,t),origin=this.ctx.origin?.()||{x:0,z:0};state.position[0]-=origin.x;state.position[2]-=origin.z;applyState(this.ghost.model,state);
      this.ghost.mat.opacity = ghostOpacity(root.position.distanceTo(this.ctx.player().model.root.position));
      root.visible = t <= this.ghostLap.duration && this.ghost.mat.opacity > .001;
    } else if (this.ghost) this.ghost.model.root.visible = false;
  }
}
