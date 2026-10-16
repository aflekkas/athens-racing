// Adaptive render scale: when frames stay over budget, trade resolution for frame rate; give it back once there
// is headroom. Whether pixels are the bottleneck is measured, not guessed (the main thread blocks inside the GL
// calls when the GPU falls behind, so JS timings can't tell): every step down is a trial, and a step that does not
// make frames faster is undone and resolution is left alone for a while (CPU-bound: fewer pixels would not help).
// Pure logic; main.js feeds it the wall time of each displayed frame.
export class RenderScale {
  /** max: the tier's pixel ratio · min: the floor · budgetMs: target frame time (default 50 fps) */
  constructor({ max, min = Math.max(0.5, max * 0.55), budgetMs = 20, window = 36 } = {}) {
    Object.assign(this, { max, min, budgetMs, window, ratio: max, n: 0, sum: 0, cool: 1.5, calm: 0, cap: max, capT: 0, trial: null, holdT: 0, last: 0 });
  }
  /** one displayed frame (wall ms since the previous one); returns the new pixel ratio when it changes */
  sample(wallMs, dtSeconds = wallMs / 1000) {
    this.cool -= dtSeconds; this.holdT -= dtSeconds;
    if ((this.capT -= dtSeconds) <= 0) this.cap = this.max;
    if (!(wallMs > 0) || wallMs > 250) return null; // a hitch, a paused or hidden tab: not a steady-state sample
    this.n++; this.sum += wallMs;
    if (this.n < this.window) return null;
    const wall = this.last = this.sum / this.n; this.n = 0; this.sum = 0;
    if (this.cool > 0) return null;
    let next = this.ratio;
    if (this.trial) {
      const t = this.trial; this.trial = null;
      if (wall > t.before * 0.94) { next = t.from; this.cap = this.max; this.capT = 0; this.holdT = 45; this.cool = 1; } // no gain: not pixel-bound
    } else if (wall > this.budgetMs * 1.12 && this.ratio > this.min && this.holdT <= 0) {
      // pixel cost ~ ratio²: aim at the budget, 8-20% per step
      const k = Math.min(0.92, Math.max(0.8, Math.sqrt(this.budgetMs / wall)));
      this.trial = { from: this.ratio, before: wall };
      // don't climb straight back to the ratio that was too slow (no see-saw): hold just under it for 30 s
      this.cap = this.ratio * 0.95; this.capT = 30;
      next = Math.max(this.min, this.ratio * k); this.calm = 0; this.cool = 0.6;
    } else if (wall < this.budgetMs * 0.9 && this.ratio < Math.min(this.max, this.cap)) {
      if (++this.calm >= 3) { next = Math.min(this.max, this.cap, this.ratio * 1.08); this.calm = 0; this.cool = 2.5; }
    } else this.calm = 0;
    next = Math.max(this.min, Math.min(this.max, Math.round(next * 100) / 100));
    if (next === this.ratio) return null;
    this.ratio = next; return next;
  }
}
