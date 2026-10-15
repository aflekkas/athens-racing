// Continuous distant sources and ambience already ramp on the audio thread. Limit graph rescheduling to 30 Hz;
// preserve elapsed simulation time and force an immediate update on mute/menu transitions.
export class AudioCadence {
  constructor(hz = 30) { this.period = 1 / hz; this.last = -Infinity; this.acc = 0; this.dt = 0; }
  sample(now, dt, urgent = false) {
    this.acc += Math.max(0, dt || 0);
    if (!urgent && now >= this.last && now - this.last < this.period - 1e-6) return false;
    this.last = now; this.dt = this.acc; this.acc = 0; return true;
  }
}
