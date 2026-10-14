// Delayed race work belongs to a session, never to a replacement map/menu.
export class SessionTransitions {
  constructor() { this.generation = 0; this.timers = new Set(); }
  cancel() {
    this.generation++;
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
  }
  token() { const generation = this.generation; return () => generation === this.generation; }
  after(delay, callback) {
    const current = this.token();
    const timer = setTimeout(() => { this.timers.delete(timer); if (current()) callback(current); }, delay);
    this.timers.add(timer);
  }
}
