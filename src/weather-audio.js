import { loopSource } from './world-sounds.js';

// Weather and time-of-day layer on top of Audio (audio.js): rain outside (light / heavy beds crossfaded by
// intensity), rain on the roof when the cabin is closed, wet-tyre hiss with speed x wetness, wipers in the cockpit,
// crickets replacing cicadas at night. Driven by weather.js through Audio.setWeather / setTimeOfDay.
export class WeatherAudio {
  constructor(audio) {
    this.A = audio; this.kind = 'clear'; this.rain = 0; this.time = 'day'; this.night = 0; this.started = false;
  }
  /** kind 'clear' | 'overcast' | 'rain', intensity 0..1 */
  setWeather(kind, intensity = 1) {
    this.kind = kind; this.rain = kind === 'rain' ? Math.max(0, Math.min(1, intensity)) : 0;
  }
  /** 'dawn' | 'day' | 'sunset' | 'night' */
  setTimeOfDay(time) {
    this.time = time; this.night = time === 'night' ? 1 : time === 'dawn' || time === 'sunset' ? 0.35 : 0;
  }
  /** how loud the cicadas should be relative to the day (they stop at night) */
  get cicadas() { return 1 - this.night * 0.95 - this.rain * 0.8; }

  build() {
    const A = this.A, { gain, filt, chain } = A.mk;
    this.out = gain(1); this.out.connect(A.amb);
    this.light = gain(); this.heavy = gain(); this.light.connect(this.out); this.heavy.connect(this.out);
    // rain on the roof is inside the car: it bypasses the cabin filter
    this.cabin = gain(); this.cabin.connect(A.chassis);
    this.crickets = gain(); this.crickets.connect(this.out);
    this.wipers = gain(); this.wipers.connect(A.chassis);
    // wet tyres: bright spray noise rising with speed
    this.hiss = A.loopSrc(A.pink); this.hissHP = filt('highpass', 1800, 0.6); this.hissLP = filt('lowpass', 6000, 0.5); this.hissG = gain();
    chain(this.hiss, this.hissHP, this.hissLP, this.hissG, A.chassis);
    this.srcs = {};
    this.started = true;
  }

  update(p, now) {
    const A = this.A;
    if (!A.S) return;
    if (!this.started) this.build();
    // recorded beds start the first time they are needed and keep running silently after
    for (const [name, dest] of [['rain-light', this.light], ['rain-heavy', this.heavy], ['rain-cabin', this.cabin], ['crickets', this.crickets], ['wipers', this.wipers]]) {
      if (!this.srcs[name] && A.S[name] && (name === 'crickets' ? this.night : this.rain) > 0) this.srcs[name] = loopSource(A.ctx, A.S[name], dest);
    }
    const r = this.rain, open = p.open ? 1 : 0, v = Math.max(0, p.speed || 0), mute = 1;
    const heavyK = Math.max(0, Math.min(1, (r - 0.35) / 0.5));
    this.light.gain.setTargetAtTime(0.7 * r * (1 - heavyK * 0.7), now, 1.5);
    this.heavy.gain.setTargetAtTime(0.75 * r * heavyK, now, 1.5);
    // the roof drums when it is up; roof down (or chase cam) you hear it all through the outside beds
    this.cabin.gain.setTargetAtTime(mute * 0.55 * r * (1 - open), now, 0.4);
    this.wipers.gain.setTargetAtTime(mute * (r > 0.15 && !open ? 0.18 : 0), now, 0.5);
    this.hissG.gain.setTargetAtTime(mute * Math.min(0.12, v * 0.004) * Math.sqrt(r), now, 0.15);
    this.hissHP.frequency.setTargetAtTime(1400 + v * 25, now, 0.3);
    this.crickets.gain.setTargetAtTime(0.4 * this.night * (1 - r * 0.8) * (0.5 + 0.5 * Math.max(0, 1 - (p.city || 0))), now, 2);
  }
}
