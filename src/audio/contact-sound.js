/** One contact texture, regardless of how many collision callbacks arrive.
 * Reuses a long tyre-noise buffer; stopped voices disconnect without a frame timer.
 */
export class ContactSound {
  constructor(audio) { this.audio = audio; this.voice = null; }
  touch(level, material = 'wall') {
    const a = this.audio, ctx = a.ctx, now = ctx.currentTime;
    level = Math.max(0, Math.min(1, Number.isFinite(level) ? level : 0));
    if (!level) return;
    let v = this.voice;
    if (!v || now >= v.ends) {
      const src = ctx.createBufferSource(), body = a.mk.filt('lowpass', 550, .6);
      const grit = a.mk.filt('bandpass', 1700, .8), bodyG = a.mk.gain(.7), gritG = a.mk.gain(.55), out = a.mk.gain();
      src.buffer = a.tyres[0].noise.buffer; src.loop = true;
      src.loopStart = a.tyres[0].noise.loopStart;
      a.mk.chain(src, body, bodyG, out); a.mk.chain(src, grit, gritG, out);
      out.connect(a.sfx);
      v = this.voice = { src, body, grit, bodyG, gritG, out, ends: now, next: 0 };
      src.start(now, src.loopStart + Math.random() * (src.buffer.duration - src.loopStart));
      src.onended = () => {
        for (const node of [src, body, grit, bodyG, gritG, out]) node.disconnect();
        if (this.voice === v) this.voice = null;
      };
    }
    if (now >= v.next) {
      v.src.playbackRate.setTargetAtTime(.85 + Math.random() * .3, now, .12);
      v.grit.frequency.setTargetAtTime((material === 'metal' ? 2300 : 1400) * (.85 + Math.random() * .3), now, .07);
      v.grit.Q.setTargetAtTime(material === 'metal' ? 1.5 : .65, now, .07);
      v.next = now + .1;
    }
    const g = v.out.gain;
    // Hold the current envelope when a new contact arrives, never restart its attack.
    if (g.cancelAndHoldAtTime) g.cancelAndHoldAtTime(now);
    else { const current = g.value; g.cancelScheduledValues(now); g.setValueAtTime(current, now); }
    g.setTargetAtTime(.46 * Math.pow(level, .7), now, .025);
    // A missed/slow frame does not chatter. Loss of contact releases in audio time.
    g.setTargetAtTime(0, now + .26, .07);
    v.ends = now + .85; v.src.stop(v.ends);
  }
}

/** Linear at normal listening levels, a smooth shoulder with a guaranteed ceiling.
 * The compressor handles ordinary dynamics; this last stage catches piled-up transients.
 */
export function outputCeiling(size = 2049) {
  return Float32Array.from({ length: size }, (_, i) => {
    const x = i * 2 / (size - 1) - 1, a = Math.abs(x);
    return Math.sign(x) * (a <= .68 ? a : .68 + .16 * Math.tanh((a - .68) / .16));
  });
}
