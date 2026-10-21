import { SpectatorSelection } from './race-lifecycle.js';

// Local view state only. Network membership, finishes and deadlines stay authoritative.
export class FinishSpectator extends SpectatorSelection {
  reset(raceId = null) { super.reset(raceId); this.phase = 'racing'; }
  update({ raceId, finished, drivers, complete = false }) {
    if (raceId !== this.raceId) this.reset(raceId);
    if (this.phase === 'results') return null;
    if (!finished) return null;
    const running = drivers.filter(p => p.finish == null && !p.dnf && p.connected !== false);
    if (complete || !running.length) { this.skip(); return null; }
    // The first target is the furthest-progressed unfinished driver behind the finisher.
    if (this.phase === 'racing') {
      if (!running.some(p => p.id === this.id)) this.id = [...running].sort((a, b) => (b.progress ?? 0) - (a.progress ?? 0))[0].id;
      this.phase = 'spectating';
    }
    return this.target(raceId, running);
  }
  skip() { this.phase = 'results'; this.id = null; }
}
