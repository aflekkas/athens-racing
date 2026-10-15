// 14 bytes at 60 Hz: version, sequence, axes, buttons, sender clock.
export const WHEEL_BYTES = 14;
export const WHEEL_BUTTONS = ['handbrake', 'shiftUp', 'shiftDown', 'lookBack', 'camera', 'pause'];
const clamp = (v, a, b) => Math.max(a, Math.min(b, Number.isFinite(v) ? v : 0));
export function encodeWheel(state, sequence, time = performance.now()) {
  const buffer = new ArrayBuffer(WHEEL_BYTES), v = new DataView(buffer);
  v.setUint8(0, 1); v.setUint16(1, sequence); v.setInt16(3, Math.round(clamp(state.steer, -1, 1) * 32767));
  v.setUint8(5, Math.round(clamp(state.throttle, 0, 1) * 255)); v.setUint8(6, Math.round(clamp(state.brake, 0, 1) * 255));
  v.setUint8(7, WHEEL_BUTTONS.reduce((bits, key, i) => bits | (state[key] ? 1 << i : 0), 0));
  v.setUint32(8, time >>> 0); return buffer;
}
export function decodeWheel(buffer) {
  if (ArrayBuffer.isView(buffer)) buffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength !== WHEEL_BYTES) return null;
  const v = new DataView(buffer); if (v.getUint8(0) !== 1) return null;
  return { sequence: v.getUint16(1), steer: clamp(v.getInt16(3) / 32767, -1, 1), throttle: v.getUint8(5) / 255, brake: v.getUint8(6) / 255,
    ...Object.fromEntries(WHEEL_BUTTONS.map((key, i) => [key, !!(v.getUint8(7) & 1 << i)])) };
}
export const neutralWheel = () => ({ steer: 0, throttle: 0, brake: 0, ...Object.fromEntries(WHEEL_BUTTONS.map(k => [k, false])) });
export class WheelInput {
  constructor(now = () => performance.now()) { this.now = now; this.reset(); }
  reset() { this.value = neutralWheel(); this.sequence = null; this.at = -Infinity; this.activity = (this.activity || 0) + 1; this.activeValue = neutralWheel(); }
  receive(buffer) {
    const value = decodeWheel(buffer); if (!value) return false;
    const delta = (value.sequence - this.sequence + 65536) % 65536;
    if (this.sequence !== null && (!delta || delta >= 32768)) return false;
    if (['steer', 'throttle', 'brake', ...WHEEL_BUTTONS].some(k => Math.abs(Number(value[k]) - Number(this.activeValue[k])) > .015)) { this.activity++; this.activeValue = value; }
    this.value = value; this.sequence = value.sequence; this.at = this.now(); return true;
  }
  sample() { return this.now() - this.at < 200 ? this.value : neutralWheel(); }
}
