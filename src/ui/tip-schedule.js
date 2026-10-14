// Profile-local pacing. Wall-clock timestamps survive reloads and race changes.
export class TipSchedule {
  constructor(saved = {}) { this.saved = saved; this.raceAt = null; }
  startRace(now) { this.raceAt = now; }
  available(now) { return this.raceAt != null && now - this.raceAt >= 10000 && now - (this.saved.lastAt ?? -Infinity) >= 120000; }
  show(id, now) { if (this.saved[id] || !this.available(now)) return false; this.saved[id] = true; this.saved.lastAt = now; return true; }
}
