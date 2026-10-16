export async function requestWheelMotion(target = globalThis) {
  const api = target.DeviceOrientationEvent;
  if (!api) throw new Error('Motion sensors unavailable. Use a phone with motion sensors.');
  if (typeof api.requestPermission === 'function' && await api.requestPermission() !== 'granted') throw new Error('Motion permission denied. Allow Motion & Orientation in Safari, then tap to start again.');
}
// Gravity projected into the display plane gives roll without Euler-angle flips.
// Calibration removes the fixed screen rotation, including naturally landscape tablets.
export class WheelMotion {
  constructor() { this.angle = null; this.centre = null; this.filtered = 0; this.fullLock = 90; this.at = null; }
  calibrate() { this.centre = this.angle; this.filtered = 0; }
  update(event, _screenAngle = 90, now = performance.now()) {
    if (!Number.isFinite(event.beta) || !Number.isFinite(event.gamma)) return this.filtered;
    const beta = event.beta * Math.PI / 180, gamma = event.gamma * Math.PI / 180;
    const x = Math.cos(beta) * Math.sin(gamma), y = Math.sin(beta);
    // A flat phone has no measurable wheel angle; centre instead of amplifying sensor noise.
    if (Math.hypot(x, y) < .1) return this.filtered = 0;
    this.angle = Math.atan2(x, y) * 180 / Math.PI;
    if (this.centre === null) this.calibrate();
    const degrees = ((this.angle - this.centre + 540) % 360) - 180;
    const normalized = Math.max(-1, Math.min(1, degrees / this.fullLock));
    const value = Math.abs(normalized) < .025 ? 0 : Math.sign(normalized) * (Math.abs(normalized) - .025) / .975;
    const dt = this.at === null ? 16 : Math.min(100, Math.max(0, now - this.at)); this.at = now;
    this.filtered += (value - this.filtered) * (1 - Math.exp(-dt / 20)); return this.filtered;
  }
}
