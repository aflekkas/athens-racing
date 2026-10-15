// Opt-in diagnostics. Bounded storage and no per-frame records/observers when disabled.
export class CpuMetrics {
  constructor(enabled = false) {
    this.enabled = enabled; this.systems = Object.create(null); this.reset();
    if (!enabled) return;
    if (typeof PerformanceObserver !== 'undefined' && PerformanceObserver.supportedEntryTypes?.includes('longtask')) {
      this.observer = new PerformanceObserver(list => { for (const e of list.getEntries()) { this.longTasks++; this.longTaskMs += e.duration; } });
      this.observer.observe({ type: 'longtask', buffered: false });
    }
    const input = e => { if (e.isTrusted) this.inputAt = performance.now(); };
    globalThis.addEventListener?.('keydown', input, { passive: true });
    globalThis.addEventListener?.('pointerdown', input, { passive: true });
  }
  reset() {
    this.frames = 0; this.frameMs = 0; this.over50 = 0; this.maxMs = 0; this.longTasks = 0; this.longTaskMs = 0;
    this.inputAt = 0; this.inputCount = 0; this.inputSum = 0; this.inputMax = 0; this.since = performance.now();
    for (const key in this.systems) this.systems[key] = 0;
  }
  start() { return this.enabled ? performance.now() : 0; }
  end(name, start) { if (this.enabled) this.systems[name] = (this.systems[name] || 0) + performance.now() - start; }
  frame(start) {
    if (!this.enabled) return;
    const now = performance.now(), ms = now - start;
    this.frames++; this.frameMs += ms; this.maxMs = Math.max(this.maxMs, ms); if (ms > 50) this.over50++;
    if (this.inputAt) { const latency = now - this.inputAt; this.inputCount++; this.inputSum += latency; this.inputMax = Math.max(this.inputMax, latency); this.inputAt = 0; }
  }
  snapshot() {
    return { seconds: (performance.now() - this.since) / 1000, frames: this.frames, mainMs: this.frameMs / Math.max(1, this.frames), maxMs: this.maxMs,
      systems: Object.fromEntries(Object.entries(this.systems).map(([k,v])=>[k,v/Math.max(1,this.frames)])), framesOver50ms: this.over50,
      longTasks: this.observer ? this.longTasks : null, longTaskMs: this.observer ? this.longTaskMs : null,
      inputToRenderSubmissionMs: this.inputCount ? this.inputSum / this.inputCount : null, maxInputToRenderSubmissionMs: this.inputMax, gc: 'Use browser trace V8.GC events; PerformanceObserver does not expose GC in Chrome.' };
  }
}
