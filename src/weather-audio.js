import { loopSource, WorldAmbience } from './world-sounds.js';

// All environmental sound, including interior rain/wipers, follows the ambience slider and menu duck.
// Only tyre spray follows the tyre bus. Interior rain has its own cabin response, not the exterior filter.
export class WeatherAudio {
  constructor(audio) {
    this.A = audio; this.kind = 'clear'; this.rain = 0; this.time = 'day'; this.night = 0; this.started = false;
  }
  setWeather(kind, intensity = 1) {
    this.kind = kind; this.rain = kind === 'rain' ? Math.max(0, Math.min(1, Number.isFinite(intensity) ? intensity : 0)) : 0;
  }
  setTimeOfDay(time) {
    this.time = time; this.night = time === 'night' ? 1 : time === 'dawn' || time === 'sunset' ? 0.35 : 0;
  }
  get cicadas() { return (1 - this.night) * (1 - this.rain * 0.95); }

  build() {
    const A = this.A, { gain, filt, chain } = A.mk;
    this.out = gain(1); this.out.connect(A.amb);
    this.light = gain(); this.heavy = gain(); this.light.connect(this.out); this.heavy.connect(this.out);
    this.interior = gain(0.45); this.interior.connect(A.mix.buses.ambience);
    this.cabin = gain(); this.cabinLP = filt('lowpass', 1800, 0.5);
    chain(this.cabin, this.cabinLP, this.interior);
    this.wipers = gain(); this.wiperLP = filt('lowpass', 2400, 0.5);
    chain(this.wipers, this.wiperLP, this.interior);
    this.hiss = A.loopSrc(A.pink); this.hissHP = filt('highpass', 1800, 0.6); this.hissLP = filt('lowpass', 5000, 0.5); this.hissG = gain();
    chain(this.hiss, this.hissHP, this.hissLP, this.hissG, A.chassis);
    this.srcs = {}; this.world = new WorldAmbience(A); this.started = true;
  }

  update(p, now) {
    const A = this.A;
    if (!A.S) return;
    if (!this.started) this.build();
    for (const [name, dest] of [['rain-light', this.light], ['rain-heavy', this.heavy], ['rain-cabin', this.cabin], ['wipers', this.wipers]]) {
      if (!this.srcs[name] && A.S[name] && this.rain > 0) this.srcs[name] = loopSource(A.ctx, A.S[name], dest);
    }
    const r = this.rain, open = p.open ? 1 : 0, v = Math.max(0, p.speed || 0);
    const heavy = Math.max(0, Math.min(1, (r - 0.35) / 0.5));
    const mask = 0.55 + 0.45 / (1 + (v / 18) ** 2);
    // Closed windows remove the bright exterior rain; a quiet, dark roof/screen layer remains inside.
    this.light.gain.setTargetAtTime(0.32 * r * Math.sqrt(1 - heavy) * mask * (open ? 1 : 0.3), now, 1.5);
    this.heavy.gain.setTargetAtTime(0.30 * r * Math.sqrt(heavy) * mask * (open ? 1 : 0.3), now, 1.5);
    this.cabin.gain.setTargetAtTime(0.11 * r * (1 - open) * mask, now, 0.4);
    this.wipers.gain.setTargetAtTime(r > 0.15 && !open ? 0.035 * Math.sqrt(r) : 0, now, 0.5);
    this.hissG.gain.setTargetAtTime(Math.min(0.06, v * 0.002) * Math.sqrt(r), now, 0.15);
    this.hissHP.frequency.setTargetAtTime(1400 + v * 25, now, 0.3);
    this.world.update(p, now, this);
  }
}
