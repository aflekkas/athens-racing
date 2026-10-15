// Local driver's police cues only. Bounded queue survives short decode delays and
// the unit being stood down on the same simulation tick as an arrest.
const CUES = { warning: 'warning', start: 'start', resume: 'start', busted: 'stop', released: 'stop', cooldown: 'escape', evaded: 'escape' };
export class PoliceVoice {
  constructor(voices, locate) { this.voices = voices; this.locate = locate; this.reset(); }
  reset() { this.queue = []; this.units = new WeakMap(); this.stopped = false; this.phase = null; this.busy = false; this.generation = (this.generation || 0) + 1; }
  observe(police, transitions = []) {
    if (!police.enabled || !police.P) return;
    const candidates = police.cops.filter(c => !c.crash && (!police.online || c.cop.target === police.online.slot));
    const unit = candidates.sort((a,b) => police.distance(a,police.P)-police.distance(b,police.P))[0];
    if (!unit) return;
    const distance = police.distance(unit,police.P), slow = Math.hypot(police.P.vs,police.P.vu) < 2.5;
    if (police.hm.state !== this.phase && !transitions.length) {
      const phase = { warning: 'warning', pursuit: 'start', cooldown: 'cooldown' }[police.hm.state];
      if (phase) transitions = [{ phase }];
    }
    this.phase = police.hm.state;
    for (const event of transitions) {
      const cue = event.phase === 'released' && !slow ? null : CUES[event.phase];
      if (cue) this.enqueue(unit, cue, event.phase === 'busted');
    }
    if (police.hm.state === 'pursuit' || police.hm.state === 'warning') {
      if (slow && distance < 20 && !this.stopped) { this.enqueue(unit,'stop'); this.stopped = true; }
      else if (!slow) this.stopped = false;
      if (!slow && police.hm.state === 'pursuit' && distance < 35) this.enqueue(unit,'close');
    } else this.stopped = false;
  }
  enqueue(unit, cue, urgent = false) {
    const now = this.voices.audio.ctx?.currentTime ?? 0;
    let state = this.units.get(unit);
    if (!state) { state = { next: 0, cues: {} }; this.units.set(unit,state); }
    if (now < (state.cues[cue] ?? -Infinity) || (cue === 'close' && now < state.next) || this.queue.some(q=>q.unit===unit && q.cue===cue)) return;
    const position = this.locate(unit); if (!position) return;
    if (cue === 'escape' || cue === 'stop') this.queue = this.queue.filter(q => q.unit !== unit || q.cue === cue);
    const job = { unit, cue, urgent, position, expires: now + 9 };
    if (urgent) this.queue = [job]; else if (this.queue.length < 3) this.queue.push(job);
  }
  async tick() {
    if (this.busy || !this.voices.enabled) return;
    const now = this.voices.audio.ctx?.currentTime ?? 0;
    this.queue = this.queue.filter(q=>q.expires >= now);
    const job = this.queue[0]; if (!job) return;
    if (now < (job.retryAt || 0)) return;
    if (!job.urgent && (now < this.units.get(job.unit).next || this.voices.active || this.voices.pending || now < this.voices.next)) return;
    job.retryAt = now + .5;
    this.busy = true; const generation = this.generation;
    const played = await this.voices.trigger('police', job.unit, () => job.unit.active && job.unit.cop ? this.locate(job.unit) : job.position, { cue: job.cue, priority: job.urgent, cooldown: false });
    if (generation !== this.generation) return;
    this.busy = false;
    if (played) {
      this.queue = this.queue.filter(q=>q !== job);
      const state = this.units.get(job.unit);
      state.next = now + 5; state.cues[job.cue] = now + (job.cue === 'close' ? 18 : 12);
    }
  }
}

export function impactVoiceCue(event) {
  if (!['crash','bump','wall'].includes(event.kind)) return null;
  const severity = Number(event.dv ?? event.sev ?? 0);
  return severity >= 6 ? 'hard' : severity >= 1.5 ? 'tap' : null;
}
