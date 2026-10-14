// One gameplay notice, replacing stale notices (e.g. a previously selected car).
// Its lifetime advances only while the race HUD can show it.
export class GameplayToast {
  enqueue(message, options = {}) { this.notice = { message, ms: options.ms ?? 2800, tone: options.tone || 'info', icon: options.icon || 'game-controller' }; this.at = null; this.active = false; }
  sample(active, now) {
    if (this.notice && this.active && this.at != null) this.notice.ms -= Math.max(0, now - this.at);
    this.at = now; this.active = active;
    if (this.notice?.ms <= 0) this.notice = null;
    return active ? this.notice : null;
  }
}
