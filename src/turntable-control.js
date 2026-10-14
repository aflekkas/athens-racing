// Continuous angle: dragging and auto-spin can cross any number of revolutions.
export class TurntableControl {
  constructor(angle = -.5) { this.angle = angle; this.dragging = false; }
  drag(pixels) { this.angle += pixels * .012; return this.angle; }
  advance(seconds) { if (!this.dragging) this.angle += Math.max(0, Math.min(.05, seconds)) * .35; return this.angle; }
}
