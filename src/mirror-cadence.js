// Count displayed mirror opportunities, never physics substeps (which can keep
// the same parity forever). Long gaps refresh immediately after tab/pause return.
export class MirrorCadence {
  constructor() { this.reset(); }
  reset() { this.last = null; this.calls = 0; }
  due(now) {
    this.calls++;
    return this.last === null || now < this.last || now - this.last >= 100 || this.calls >= 2;
  }
  rendered(now) { this.last = now; this.calls = 0; }
}
