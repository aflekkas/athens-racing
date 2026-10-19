// Audio robustness helpers: pure logic (no Web Audio objects), so each piece is unit-tested in Node.

/**
 * A cap on simultaneous one-shot voices (noise bursts, tones, samples, formant voices). Every one-shot builds 4-6
 * nodes, so a pile-up (a crash chain, pops on a long overrun, a crowd of horns) would hand the audio thread dozens
 * of extra voices in one frame. take() admits a voice that ends at `end` (audio-clock seconds) or refuses it.
 * Critical voices (priority >= 1: crashes, ignition) may use a reserve above the normal limit.
 */
export class VoiceBudget {
  constructor(limit = 32, reserve = 8) { this.limit = limit; this.reserve = reserve; this.ends = []; this.dropped = 0; this.admitted = 0; }
  prune(now) { const e = this.ends; let n = 0; for (let i = 0; i < e.length; i++) if (e[i] > now) e[n++] = e[i]; e.length = n; }
  get active() { return this.ends.length; }
  take(now, end, priority = 0) {
    this.prune(now);
    if (this.ends.length >= this.limit + (priority >= 1 ? this.reserve : 0)) { this.dropped++; return false; }
    this.ends.push(end > now ? end : now + 0.05); this.admitted++; return true;
  }
}

/**
 * Hide the click at a loop's seam. The loop is data[start, end). Its last `fade` samples are blended (equal power)
 * with the first `fade` samples of the loop, and the loop then restarts `fade` samples in, so the wrap lands on the
 * natural continuation of the tail. Edits `data` in place and returns the new { start, end } in samples, or null
 * when the seam is already smooth (|jump| <= factor x the loop's rms sample-to-sample step).
 */
export function seamlessLoop(data, start, end, { fade = 2048, factor = 2.5 } = {}) {
  const n = end - start;
  if (n < fade * 8) return null;
  let sum = 0; for (let i = start + 1; i < end; i++) { const d = data[i] - data[i - 1]; sum += d * d; }
  const step = Math.sqrt(sum / (n - 1)), jump = Math.abs(data[start] - data[end - 1]);
  if (jump <= factor * step) return null;
  for (let i = 0; i < fade; i++) {
    const w = (i + 1) / (fade + 1), a = Math.cos(w * Math.PI / 2), b = Math.sin(w * Math.PI / 2);
    data[end - fade + i] = data[end - fade + i] * a + data[start + i] * b;
  }
  return { start: start + fade, end };
}

/** seamlessLoop for every channel of an AudioBuffer: channel 0 decides, the others get the same blend. */
export function seamlessBuffer(buffer, start, end, opts) {
  const fixed = seamlessLoop(buffer.getChannelData(0), start, end, opts);
  if (fixed) for (let c = 1; c < buffer.numberOfChannels; c++) seamlessLoop(buffer.getChannelData(c), start, end, { ...opts, factor: -1 });
  return fixed;
}

/**
 * AudioContext watchdog: browsers suspend (or "interrupt") a context when the output device changes, on a power
 * event or when the page is backgrounded, and the game only resumed it on a user gesture, so sound stayed off until
 * the next key press. check() asks for a resume at most once per `every` seconds of wall time.
 */
export class ContextWatchdog {
  constructor(every = 1) { this.every = every; this.lastTry = -Infinity; this.resumes = 0; this.stateChanges = 0; }
  /** true when a resume was requested */
  check(ctx, wallSeconds) {
    if (!ctx || ctx.state === 'running' || ctx.state === 'closed') return false;
    if (wallSeconds - this.lastTry < this.every) return false;
    this.lastTry = wallSeconds; this.resumes++;
    try { ctx.resume?.()?.catch?.(() => {}); } catch { /* needs a user gesture: the next one retries */ }
    return true;
  }
}

/** Under-run counters when the browser exposes them (Chrome's playout statistics); null elsewhere. */
export function playoutUnderruns(ctx) {
  const stats = ctx?.playoutStats ?? ctx?.playbackStats;
  if (!stats) return null;
  const n = stats.underrunEvents ?? stats.fallbackFramesEvents;
  return Number.isFinite(n) ? n : null;
}

/** Output buffer size hint: weak machines get the large 'playback' buffer, the rest 'balanced' (interactive is the first to under-run). */
export function audioLatencyHint(perfClass = 'auto', cores = 8) {
  const weak = perfClass === 'potato' || perfClass === 'low' || perfClass === 'med' || (perfClass === 'auto' && cores <= 4);
  return weak ? 'playback' : 'balanced';
}

/**
 * Filter coefficients and per-sample automation are the audio thread's biggest cost here: the voices re-target about 130
 * AudioParams every frame with setTargetAtTime, and a biquad whose frequency / Q / gain is being automated at the
 * default a-rate recomputes its coefficients (sin, cos, divides) for every one of 48,000 samples a second. At k-rate they
 * are recomputed once per 128-sample block (2.7 ms), which the slow exponential approaches cannot make audible.
 * Gains stay a-rate: one-shot envelopes use 2 ms attacks that a 2.7 ms step would turn into a click.
 */
export function useKRate(ctx) {
  const patch = (method, names) => {
    const create = ctx[method]?.bind(ctx); if (!create) return;
    ctx[method] = (...args) => { const node = create(...args); for (const name of names) { try { node[name].automationRate = 'k-rate'; } catch { /* a-rate only on this browser */ } } return node; };
  };
  patch('createBiquadFilter', ['frequency', 'Q', 'gain', 'detune']);
  patch('createStereoPanner', ['pan']);
  patch('createOscillator', ['frequency', 'detune']);
  return ctx;
}

/** the weakest machines get a lighter audio graph (fewer detailed traffic voices, 4 squeal resonances per tyre, a shorter reverb) */
export function audioLowCost(perfClass = 'auto', cores = 8) { return perfClass === 'potato' || perfClass === 'low' || (perfClass === 'auto' && cores <= 4); }

/**
 * Web Audio renders by pulling from the destination: a branch that is not connected to it costs nothing, but a branch
 * whose gain is merely 0 still runs every source, filter and gain in it, 48,000 times a second. The voices here keep
 * many such branches (four tyres with squeal / scrub / grit / rumble layers, turbo and whine layers, the RPM layers
 * of an engine that are not currently blended in). BranchGate connects one while its level is audible and disconnects
 * it once the level has stayed at zero for `hold` audio seconds (several time constants of the slowest ramp into it),
 * so the signal has faded to nothing before it is cut and no click can result.
 */
export class BranchGate {
  constructor(from, to, hold = 1, eps = 1e-5) { this.from = from; this.to = to; this.hold = hold; this.eps = eps; this.on = true; this.quiet = null; this.switches = 0; }
  close() { if (this.on) { try { this.from.disconnect(this.to); } catch { /* already disconnected */ } this.on = false; this.switches++; } return this; }
  open() { if (!this.on) { this.from.connect(this.to); this.on = true; this.switches++; } return this; }
  /** level: the target the branch's gain is ramping to; now: the audio clock in seconds */
  use(level, now) {
    if (level > this.eps) { this.quiet = null; this.open(); }
    else if (this.on) { if (this.quiet == null) this.quiet = now; else if (now - this.quiet >= this.hold) this.close(); }
    return this.on;
  }
}
