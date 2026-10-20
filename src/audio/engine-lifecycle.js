import { gearboxSound } from './engine-profiles.js';
/** Mechanical events use the host's noise/tone primitives (original synthesis).
 * No downloaded effect samples. Engine events follow telemetry; menu pause alone
 * must never imply a stall or a bad shift. level/rpm are reusable output fields.
 */
export class EngineLifecycle {
  constructor(host) { this.host = host; this.state = 'running'; this.level = 1; this.rpm = 800; this.lastShiftStart = 0; this.lastShiftEnd = 0; }
  start(now, recorded = false) {
    if(this.host.profile?.synth==='electric'){this.state='running';this.level=1;return;}
    this.state = 'starting'; this.at = now; this.recorded = recorded;
    if (!recorded) {
      const a = this.host;
      for (let i = 0; i < 5; i++) {
        a.noise({dur:.1, f:380 + i * 28, type:'bandpass', q:1.8, gain:.035, at:i*.09, bus:a.eng});
        a.tone({f:55 + i*4, dur:.085, gain:.045, type:'triangle', at:i*.09, bus:a.eng});
      }
      a.tone({f:75, slide:130, dur:.18, gain:.07, at:.43, bus:a.eng});
    }
  }
  stop(now, stall = false) {
    if (this.state === 'off') return;
    this.state = 'off'; this.at = now;
    if(this.host.profile?.synth==='electric')return;
    const a = this.host;
    a.tone({f:stall ? 65 : 95, slide:28, dur:stall ? .3 : .45, gain:.055, type:'triangle', bus:a.eng});
    a.noise({dur:.16, f:350, type:'lowpass', gain:.025, bus:a.eng});
  }
  shift(p, now, start, end) {
    if(this.host.profile?.synth==='electric')return 'auto';
    const a = this.host, selected = gearboxSound(a.engineSpec, p.gearboxType);
    const kind = selected === 'manual' && p.manual === false ? 'auto' : selected;
    const cabin = p.cockpit ?? !p.open, cabinGain = cabin ? 1 : .045;
    const up = (p.shiftDirection ?? p.shiftStart?.direction ?? p.shift ?? 1) > 0;
    const fast = Math.max(0, Math.min(1, (.5 - (p.shiftDuration ?? p.shiftStart?.duration ?? a.engineSpec?.powertrain?.shiftTime ?? a.engineSpec?.shiftT ?? .25)) / .4));
    const variation = .88 + Math.random() * .24;
    if (start) {
      if (kind === 'manual') {
        // Gate detent + low lever stop, with pedal/bearing release underneath.
        a.noise({dur:.025, f:(up ? 1300 : 1000)*variation, type:'bandpass', q:2.5, gain:cabinGain*(.018+.022*fast), bus:a.eng});
        a.tone({f:(up ? 165 : 125)*variation, slide:75, dur:.055, gain:cabinGain*(.028+.024*fast), type:'triangle', bus:a.eng});
        a.noise({dur:.14, f:420*variation, type:'bandpass', q:1.3, gain:.012*cabinGain, attack:.025, bus:a.eng});
      } else {
        // Muted actuator/engagement click with a little body, not a broadband spit.
        a.noise({dur:.035, f:1050*variation, type:'bandpass', q:.8, gain:.028*cabinGain, bus:a.eng});
        a.tone({f:145*variation, slide:85, dur:.055, gain:.022*cabinGain, bus:a.eng});
      }
      // Only an explicit powertrain diagnostic authorizes grinding.
      if (kind === 'manual' && (p.gearGrind || p.shiftGrind))
        a.noise({dur:.13, f:1100, type:'bandpass', q:3, gain:.055*cabinGain, bus:a.eng});
    }
    if (end && kind === 'manual')
      a.noise({dur:.07, f:550*variation, type:'lowpass', gain:.015*cabinGain, attack:.012, bus:a.eng});
    return kind;
  }
  update(p, now, idle = 800) {
    if ((p.stalled || p.engineRunning === false) && this.state !== 'off') this.stop(now, !!p.stalled);
    if ((p.engineRunning === true || this.wasStalled && p.stalled === false) && this.state === 'off' && !p.stalled) this.start(now);
    this.wasStalled = !!p.stalled;
    this.rpm = p.rpm; this.level = this.state === 'off' ? Math.max(0, 1-(now-this.at)/.25) : 1;
    if (this.state === 'starting') {
      const age = now-this.at;
      if (!this.recorded) this.level = Math.max(0, Math.min(1,(age-.4)/.35));
      // Audible catch/flare is subordinate to deliberate throttle/revs.
      this.rpm = Math.max(p.rpm, idle*(1 + .65*Math.exp(-Math.max(0,age-.5)*3)));
      if (age > 2) this.state = 'running';
    }
    const startSignal = p.shiftStart?.serial ?? p.shiftStart ?? p.shift, endSignal = p.shiftEnd?.serial ?? p.shiftEnd;
    const start = !!startSignal && (startSignal !== this.lastShiftStart || !this.lastShiftStart);
    const end = !!endSignal && (endSignal !== this.lastShiftEnd || !this.lastShiftEnd);
    this.lastShiftStart = startSignal; this.lastShiftEnd = endSignal;
    this.shiftKind = gearboxSound(this.host.engineSpec, p.gearboxType);
    this.shiftStarted = start; this.shiftEnded = end;
    if (start || end) this.shiftKind = this.shift(p, now, start, end);
  }
}
