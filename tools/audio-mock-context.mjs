// A recording stand-in for AudioContext, for Node tests: every AudioParam write is logged (direct `.value =` writes
// separately from scheduled ramps), and every node created is counted by kind. No audio is rendered.
const PARAMS = new Set(['gain', 'frequency', 'Q', 'detune', 'pan', 'playbackRate', 'threshold', 'knee', 'ratio', 'attack', 'release',
  'positionX', 'positionY', 'positionZ', 'forwardX', 'forwardY', 'forwardZ', 'upX', 'upY', 'upZ', 'delayTime']);
export class MockParam {
  constructor(owner, name, log) { this.owner = owner; this.name = name; this.log = log; this._value = 0; }
  get value() { return this._value; }
  set value(v) { this._value = v; if (this.log.armed) this.log.direct.push({ node: this.owner, param: this.name, value: v, at: this.log.ctx.currentTime }); }
  _ev(kind, ...args) { this.log.scheduled.push({ node: this.owner, param: this.name, kind, args, at: this.log.ctx.currentTime }); return this; }
  setValueAtTime(v, t) { return this._ev('set', v, t); }
  linearRampToValueAtTime(v, t) { return this._ev('linear', v, t); }
  exponentialRampToValueAtTime(v, t) { return this._ev('exp', v, t); }
  setTargetAtTime(v, t, tc) { this._value = v; return this._ev('target', v, t, tc); }
  setValueCurveAtTime(c, t, d) { return this._ev('curve', c, t, d); }
  cancelScheduledValues(t) { return this._ev('cancel', t); }
}
function makeNode(kind, ctx) {
  const node = { kind, connections: [], started: null, stopped: null, ctx, born: ctx.log.seq = (ctx.log.seq || 0) + 1 };
  const params = {};
  return new Proxy(node, {
    get(t, p) {
      if (p in t) return t[p];
      if (typeof p === 'string' && PARAMS.has(p)) return params[p] ||= new MockParam(t, p, ctx.log);
      if (p === 'connect') return (to) => { t.connections.push(to); return to; };
      if (p === 'disconnect') return () => { t.connections.length = 0; };
      if (p === 'start') return (when = 0) => { t.started = when; ctx.log.starts.push({ node: t, kind, when }); };
      if (p === 'stop') return (when = 0) => { t.stopped = when; };
      if (p === 'addEventListener') return () => {};
      return undefined;
    },
    set(t, p, v) { t[p] = v; return true; },
  });
}
export function createMockContext({ sampleRate = 48000 } = {}) {
  const log = { seq: 0, armed: false, direct: [], scheduled: [], starts: [], created: {}, ctx: null };
  const ctx = { log, currentTime: 0, sampleRate, state: 'running', baseLatency: 0.01, resumed: 0,
    resume() { this.resumed++; this.state = 'running'; return Promise.resolve(); },
    addEventListener() {},
    destination: null,
    listener: makeNode('listener', { log }),
    createBuffer(channels, length, rate) { const data = Array.from({ length: channels }, () => new Float32Array(length)); return { numberOfChannels: channels, length, sampleRate: rate, duration: length / rate, getChannelData: c => data[c] }; },
    decodeAudioData: async () => ctx.createBuffer(1, 4800, sampleRate),
  };
  log.ctx = ctx;
  for (const kind of ['Gain', 'BiquadFilter', 'Oscillator', 'BufferSource', 'StereoPanner', 'Convolver', 'DynamicsCompressor', 'Analyser', 'Panner', 'WaveShaper', 'Delay'])
    ctx['create' + kind] = () => { log.created[kind] = (log.created[kind] || 0) + 1; return makeNode(kind, ctx); };
  ctx.destination = makeNode('destination', ctx);
  return ctx;
}
/** advance the audio clock like a real context would: seconds of audio time */
export const advance = (ctx, seconds) => { ctx.currentTime += seconds; };
