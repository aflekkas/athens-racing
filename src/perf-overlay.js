// Lightweight in-game performance readout (Settings > Graphics > PERFORMANCE OVERLAY, or F3): fps, frame ms and
// draw calls, refreshed twice a second so the overlay itself never shows up in a profile. Plain monospace text on
// a dark chip; no gradients, no blur, no animation.
export class PerfOverlay {
  constructor(getStats) {
    this.getStats = getStats;
    this.el = document.createElement('div');
    this.el.id = 'perf-overlay';
    this.el.setAttribute('aria-hidden', 'true');
    this.el.style.cssText = 'position:fixed;top:8px;left:8px;z-index:90;pointer-events:none;display:none;'
      + 'font:12px/1.5 ui-monospace,Menlo,Consolas,monospace;color:#d7e3ee;background:rgba(8,12,18,.82);'
      + 'border:1px solid #2a3644;border-radius:4px;padding:4px 8px;white-space:pre;';
    document.body.append(this.el);
    this.el.style.display = 'none';
    this.acc = 0; this.n = 0; this.shown = false;
  }
  setVisible(on) {
    this.shown = !!on;
    this.el.style.display = this.shown ? 'block' : 'none';
  }
  /** call every frame with dt seconds; the text refreshes at 2 Hz */
  frame(dt) {
    if (!this.shown) return;
    this.acc += dt; this.n++;
    if (this.acc < 0.5) return;
    const s = this.getStats?.() || {};
    const fps = this.acc > 0 ? this.n / this.acc : 0;
    const ms = fps > 0 ? 1000 / fps : 0;
    const tris = s.tris >= 1e6 ? (s.tris / 1e6).toFixed(2) + 'M' : s.tris >= 1e3 ? (s.tris / 1e3).toFixed(0) + 'k' : String(s.tris ?? '?');
    this.el.textContent = `${fps.toFixed(0)} FPS · ${ms.toFixed(1)} MS · ${s.calls ?? '?'} DRAWS · ${tris} TRIS`;
    this.acc = 0; this.n = 0;
  }
  dispose() { this.el.remove(); }
}
