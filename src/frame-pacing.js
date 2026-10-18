// Frame pacing: the software frame-rate limit (Settings > Graphics > FRAME RATE LIMIT) and nothing else. Pure logic;
// timestamps are requestAnimationFrame times in ms. "No limit" (cap 0) is not a large number: the limiter keeps no
// state and never skips, so frames are bounded only by requestAnimationFrame, i.e. the display refresh (60 Hz, a
// 120 Hz ProMotion screen, ...) and by how fast the machine draws.
export class FrameLimiter {
  constructor() { this.reset(); }
  reset() { this.last = -Infinity; this.due = 0; }
  /** Should the frame at `now` run under `cap` fps? cap <= 0 (or not a number): always, and the schedule is forgotten.
   *  Otherwise frames are due every 1000 / cap ms on a fixed schedule, so the average rate is the cap on any display
   *  (a 144 Hz screen at 60 does not drift to 72). A vsync that arrives up to ~20% (max 3 ms) early still counts, so
   *  jitter on a display that matches the cap does not halve it. A hitch or a clock jump restarts the schedule. */
  allow(now, cap) {
    if (!(cap > 0)) { this.reset(); return true; }
    const interval = 1000 / cap, tolerance = Math.min(3, interval * 0.2);
    if (!(now >= this.last) || now - this.due > interval) { this.last = now; this.due = now + interval; return true; }
    if (now < this.due - tolerance) return false;
    this.last = now; this.due += interval; return true;
  }
}
/** Target frame time for the dynamic-resolution governor. It only trades pixels for speed, it never skips frames:
 *  a limit sets the goal, "no limit" aims at the 50 fps floor (the same as 60 fps with its 20% slack). */
export const dynamicBudgetMs = cap => 1200 / (cap > 0 ? cap : 60);
