import { PERF_CLASSES } from './graphics.js';

// The frame governor. The first-run check (graphics.js detectPerformance) is a guess made once, in a quiet moment. A
// machine that then keeps missing its frame budget although resolution can no longer help (dynamic resolution is off, at
// its floor, or a smaller picture did not make frames faster: the CPU is the bottleneck, not the pixels) is stepped down
// one performance class at a time. One that has had plenty of headroom for a full minute is stepped back up, never above
// `ceiling` (the class the first-run check picked) and never again above a class it just failed on.
// Pure logic: main.js feeds it the wall time and the main-thread time of every displayed frame.
//
//   wallMs : time since the previous displayed frame · cpuMs : main-thread time spent in this frame's own function
//   budgetMs : 1000 / frame cap (60 when the cap is off) · pixelBound : dynamic resolution can still help
export class PerfGovernor {
  constructor({ window = 90, hotWindows = 3, quietWindows = 40, cooldownS = 12, floor = 'potato', ceiling = 'high' } = {}) {
    Object.assign(this, { window, hotWindows, quietWindows, cooldownS, floor, ceiling, n: 0, wall: 0, cpu: 0, hot: 0, quiet: 0, cool: cooldownS, changes: 0, last: null, promoted: null });
  }
  /** one displayed frame; returns the class to switch to, or null. `current` is the class in force. */
  sample(wallMs, cpuMs, budgetMs, current, { dt = wallMs / 1000, pixelBound = false } = {}) {
    this.cool -= dt;
    if (!(wallMs > 0) || wallMs > 250) return null; // a hitch, a loading screen, a hidden tab: not steady state
    this.wall += wallMs; this.cpu += cpuMs;
    if (++this.n < this.window) return null;
    const wall = this.wall / this.n, cpu = this.cpu / this.n; this.n = 0; this.wall = 0; this.cpu = 0;
    this.last = { wall, cpu, budgetMs, pixelBound };
    const at = PERF_CLASSES.indexOf(current);
    if (at < 0) return null;
    const hot = wall > budgetMs * 1.2 && !pixelBound;
    const quiet = wall < budgetMs * 1.08 && cpu < budgetMs * 0.45;
    this.hot = hot ? this.hot + 1 : 0; this.quiet = quiet ? this.quiet + 1 : 0;
    if (this.cool > 0) return null;
    if (this.hot >= this.hotWindows && at > PERF_CLASSES.indexOf(this.floor)) {
      const to = PERF_CLASSES[at - 1];
      if (this.promoted === current) { this.ceiling = to; this.promoted = null; } // it did not hold: do not try that class again
      return this.move(to);
    }
    if (this.quiet >= this.quietWindows && at < PERF_CLASSES.indexOf(this.ceiling)) { const to = PERF_CLASSES[at + 1]; this.promoted = to; return this.move(to); }
    return null;
  }
  move(to) { this.hot = 0; this.quiet = 0; this.cool = this.cooldownS; this.changes++; return to; }
}
