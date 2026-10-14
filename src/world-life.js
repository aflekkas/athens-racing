// Pure world clock/front model, shared by the runtime and deterministic audits.
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
export const TIME_HOURS = Object.freeze({ dawn: 6, day: 14, afternoon: 17, sunset: 20, night: 3 });
export const FRONTS = Object.freeze({
  clear: { over: 0, T: 1, haze: 1, rain: 0, minutes: [5, 9], next: ['cloudy'] },
  cloudy: { over: .55, T: .65, haze: 2, rain: 0, minutes: [3, 6], next: ['clear', 'overcast', 'lightRain'] },
  overcast: { over: 1, T: .36, haze: 3, rain: 0, minutes: [3, 5], next: ['cloudy', 'lightRain'] },
  lightRain: { over: .9, T: .32, haze: 12, rain: .3, minutes: [2, 4], next: ['rain', 'clearing'] },
  rain: { over: 1, T: .22, haze: 30, rain: 1, minutes: [2, 5], next: ['lightRain', 'clearing'] },
  clearing: { over: .45, T: .7, haze: 4, rain: 0, minutes: [3, 5], next: ['clear', 'cloudy'] },
});
export const hourForTime = time => TIME_HOURS[time] ?? 17;
export function timeForHour(hour) {
  hour = ((hour % 24) + 24) % 24;
  return hour < 5.5 || hour >= 21 ? 'night' : hour < 8 ? 'dawn' : hour < 16 ? 'day' : hour < 19.5 ? 'afternoon' : 'sunset';
}
export function trafficByHour(hour) {
  const peak = (h, width) => Math.max(0, 1 - Math.abs(hour - h) / width);
  return .35 + .55 * peak(14, 10) + .7 * peak(8.5, 2) + .65 * peak(18.5, 2.5);
}
export class WorldLife {
  constructor({ seed = 2026, dayMinutes = 30 } = {}) { this.seed = seed >>> 0; this.dayMinutes = clamp(dayMinutes, 24, 40); this.configure(); }
  random() { this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0; return this.seed / 4294967296; }
  configure({ type = 'sprint', time = 'afternoon', weather = 'clear', hour, dayMinutes = this.dayMinutes } = {}) {
    this.dayMinutes = clamp(Number(dayMinutes) || 30, 24, 40);
    this.clockDynamic = type === 'free' || time === 'dynamic'; this.weatherDynamic = type === 'free' || weather === 'dynamic';
    this.hour = Number.isFinite(hour) ? ((hour % 24) + 24) % 24 : hourForTime(time);
    this.front = FRONTS[weather] ? weather : 'clear'; this.elapsed = 0;
    this.weather = Object.fromEntries(['over', 'T', 'haze', 'rain'].map(k => [k, FRONTS[this.front][k]]));
    this.from = { ...this.weather }; this.transition = 1; this.hold = this.duration();
    return this.sample();
  }
  duration() { const [a, b] = FRONTS[this.front].minutes; return (a + (b - a) * this.random()) * 60; }
  advance(dt) {
    dt = Math.max(0, Number(dt) || 0); this.elapsed += dt;
    if (this.clockDynamic) this.hour = (this.hour + dt * 24 / (this.dayMinutes * 60)) % 24;
    if (this.weatherDynamic) {
      let remaining = dt;
      while (remaining > 0) {
        const step = Math.min(remaining, this.hold); this.hold -= step; remaining -= step;
        this.transition = clamp(this.transition + step / 45);
        const t = this.transition * this.transition * (3 - 2 * this.transition), target = FRONTS[this.front];
        for (const k of ['over', 'T', 'haze', 'rain']) this.weather[k] = this.from[k] + (target[k] - this.from[k]) * t;
        if (this.hold <= 0) {
          this.from = { ...this.weather }; const next = target.next;
          this.front = next[Math.floor(this.random() * next.length)]; this.transition = 0; this.hold = this.duration();
        }
      }
    }
    return this.sample();
  }
  sample() { return { hour: this.hour, time: timeForHour(this.hour), weather: this.front, atmosphere: { ...this.weather }, dynamic: this.clockDynamic || this.weatherDynamic }; }
  snapshot() { return { ...this.sample(), clockDynamic: this.clockDynamic, weatherDynamic: this.weatherDynamic, dayMinutes: this.dayMinutes, seed: this.seed, hold: this.hold, from: { ...this.from }, transition: this.transition }; }
  adopt(data, age = 0) {
    if (!validWorldSnapshot(data)) return false;
    Object.assign(this, { hour: data.hour, front: data.weather, weather: { ...data.atmosphere }, clockDynamic: data.clockDynamic, weatherDynamic: data.weatherDynamic, dayMinutes: data.dayMinutes, seed: data.seed >>> 0, hold: data.hold, from: { ...data.from }, transition: data.transition });
    this.advance(clamp(age, 0, 10)); return true;
  }
}
export function validWorldSnapshot(d) {
  if (!d || !FRONTS[d.weather] || !Number.isFinite(d.hour) || d.hour < 0 || d.hour >= 24 || typeof d.clockDynamic !== 'boolean' || typeof d.weatherDynamic !== 'boolean') return false;
  if (!Number.isFinite(d.dayMinutes) || d.dayMinutes < 24 || d.dayMinutes > 40 || !Number.isSafeInteger(d.seed) || d.seed < 0 || d.seed > 4294967295 || !Number.isFinite(d.hold) || d.hold <= 0 || d.hold > 540 || !Number.isFinite(d.transition) || d.transition < 0 || d.transition > 1) return false;
  return ['atmosphere', 'from'].every(obj => ['over', 'T', 'rain', 'haze'].every(k => Number.isFinite(d[obj]?.[k]) && d[obj][k] >= 0 && d[obj][k] <= (k === 'haze' ? 30 : 1)));
}
