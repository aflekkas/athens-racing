import { CameraWatch, FineLedger, ENF, redViolation } from './enforcement.js';
import { collectCameras, collectRedLightSites } from './enforcement-data.js';

// One runtime per driver, called by the game's existing simulation loop.
// emit receives a candidate; multiplayer records only the server's ack.
export class EnforcementRuntime {
  constructor(emit = () => {}) { this.emit = emit; this.watch = new CameraWatch(); this.ledger = new FineLedger(); this.reset(); }
  reset() { this.watch.reset(); this.ledger.reset(); this.seq = 0; this.claimPrefix = globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2); this.redPass = new Map(); this.prevS = null; }
  setMap(map) { this.mapId = map?.id; this.cameras = collectCameras(map); this.redSites = collectRedLightSites(map); this.reset(); }
  configure({ enabled, rules = {}, raceId = 'solo', generation = 0, online = false } = {}) {
    if (raceId !== this.raceId || generation !== this.generation) this.reset();
    Object.assign(this, { enabled: enabled === true, rules: rules || {}, raceId, generation, online });
  }
  candidate(kind, site, st) {
    const requested = kind === 'camera' ? this.rules.cameraPenalty : this.rules.penalty;
    const fallback = kind === 'camera' ? ENF.cameraPenaltySec : ENF.redPenaltySec;
    const penaltySec = Number.isFinite(requested) && requested >= 0 && requested <= 60 ? requested : fallback;
    const entry = { id: `fine:${this.claimPrefix}:${++this.seq}`, kind, label: site.label || (kind === 'camera' ? 'Mapped speed camera' : 'Witnessed traffic offence'), site: site.id, siteId: site.id,
      penaltySec, s: st.s, kmh: st.kmh, dir: st.dir, at: st.at, now: st.now, raceId: this.raceId, generation: this.generation };
    this.emit(entry);
    return entry;
  }
  step(st) {
    if (!this.enabled) { this.prevS = st.s; this.watch.reset(); return; }
    for (const cam of this.cameras || []) if (this.watch.step(cam.id, cam, { ...st, prevS: this.prevS }) === 'fire') this.candidate('camera', cam, st);
    this.prevS = st.s;
  }
  red(junction, st, witnessed = false) {
    if (!this.enabled || this.online || witnessed !== true || ![1, -1].includes(st.dir)) return null;
    const site = this.redSites?.find(c => Math.abs(c.s - junction.s) < 30 && (c.dir === 0 || c.dir === st.dir));
    if (!redViolation(junction, { camera: !!site, witnessed: witnessed === true && !this.online })) return null;
    const id = site?.id || `witness:${junction.i}:${st.dir}`;
    if (st.now - (this.redPass.get(id) ?? -Infinity) < ENF.cameraCooldownSec) return null;
    this.redPass.set(id, st.now);
    return this.candidate('red', site || { id, label: 'Police witnessed a red light' }, st);
  }
  record(entry) {
    if (this.ledger.fines.some(f => f.id === entry.id)) return null;
    const fine = this.ledger.add(entry.kind, entry.label, entry.penaltySec, entry.siteId || entry.site, entry.now ?? 0);
    if (fine) fine.id = entry.id;
    return fine;
  }
  // Ledger only. Recovery owns penalty seconds/roadside hold.
  recordCapture(now, penaltySec = ENF.capturePenaltySec) {
    return this.record({ id: `capture:${this.claimPrefix}:${++this.seq}`, kind: 'capture', label: 'Roadside police stop', penaltySec, site: 'capture', now });
  }
}
