// Small solo-only debris pool. Settled tyres retain their slot and position until
// restart; exhausting the pool leaves the remaining barrier intact.
export const MAX_LOOSE_TYRES = 40;
export class TyreDynamics {
  constructor(height, capacity = MAX_LOOSE_TYRES) { this.height = height; this.capacity = capacity; this.bodies = []; this.enabled = false; }
  release(stack, vx, vz, speed) {
    if (!this.enabled || speed < 2 || stack.released || this.bodies.length + 3 > this.capacity) return [];
    stack.released = true;
    const released = [];
    for (let level = 1; level <= 3; level++) {
      const spread = (level - 2) * 1.1;
      const body = { stack, level, x: stack.x, y: stack.y + .14 + level * .28, z: stack.z,
        vx: vx * .32 + spread, vz: vz * .32 - spread, vy: Math.min(8, 1.5 + speed * .18 + level * .45),
        ax: 0, ay: stack.yaw, az: 0, wx: vz * .6 + level, wy: spread * 2, wz: -vx * .6,
        sleep: false, quiet: 0 };
      this.bodies.push(body); released.push(body);
    }
    return released;
  }
  update(dt) {
    // Substeps keep fast debris from tunnelling through the sampled terrain.
    const steps = Math.max(1, Math.ceil(Math.min(dt, .1) / (1 / 120))), h = Math.min(dt, .1) / steps;
    for (let step = 0; step < steps; step++) for (const b of this.bodies) {
      if (b.sleep) continue;
      b.vy -= 9.81 * h; b.x += b.vx * h; b.y += b.vy * h; b.z += b.vz * h;
      b.ax += b.wx * h; b.ay += b.wy * h; b.az += b.wz * h;
      // Oriented tyre support: flat sidewall .14 m, tread radius .5 m.
      const up = Math.abs(Math.cos(b.ax) * Math.cos(b.az));
      const radius = .14 * up + .5 * Math.sqrt(Math.max(0, 1 - up * up));
      const floor = this.height(b.x, b.z) + radius;
      if (b.y < floor) {
        b.y = floor; b.vy = Math.abs(b.vy) > .7 ? Math.abs(b.vy) * .36 : 0;
        const friction = Math.exp(-h * (up > .8 ? 4.5 : 1.8));
        b.vx *= friction; b.vz *= friction;
        b.wx *= Math.exp(-h * 2.5); b.wy *= Math.exp(-h * 3); b.wz *= Math.exp(-h * 2.5);
        // Friction couples forward motion into visible rolling spin.
        b.wx += (b.vz / .5 - b.wx) * h * .6; b.wz += (-b.vx / .5 - b.wz) * h * .6;
        b.quiet = Math.hypot(b.vx, b.vy, b.vz, b.wx, b.wy, b.wz) < .25 ? b.quiet + h : 0;
        if (b.quiet > .5) { b.sleep = true; b.vx = b.vy = b.vz = b.wx = b.wy = b.wz = 0; }
      }
    }
  }
  reset() { for (const b of this.bodies) b.stack.released = false; this.bodies.length = 0; }
}
