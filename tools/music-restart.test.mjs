import test from 'node:test';
import assert from 'node:assert/strict';
import { Audio } from '../src/audio.js';
import { MUSIC_SOURCES } from '../src/music-sources.js';
function setup(t, source, element) {
  const audio = new Audio(), ticks = [], cleared = []; let now = 0, filters = 0, ignitions = 0;
  audio.musicSources.select(source); audio.radio = audio.musicSources;
  if (element) audio.radio.el = element;
  audio.ctx = { currentTime: 1 }; audio.requestIgnition = () => { ignitions++; };
  audio.musicLP = { frequency: { setTargetAtTime() { filters++; } } };
  t.mock.method(globalThis, 'setInterval', callback => { ticks.push(callback); return ticks.length; });
  t.mock.method(globalThis, 'clearInterval', timer => cleared.push(timer));
  t.mock.method(performance, 'now', () => now);
  return { audio, ticks, cleared, advance(ms) { now += ms; }, filters: () => filters, ignitions: () => ignitions };
}
for (const source of MUSIC_SOURCES) test(`restart/tapeStop are safe with ${source} and no media element`, t => {
  const { audio, ticks, filters, ignitions } = setup(t, source);
  assert.doesNotThrow(() => audio.tapeStop(.45, 2.2));
  assert.doesNotThrow(() => audio.restart());
  assert.equal(ticks.length, 0); assert.equal(filters(), 0); assert.equal(audio.tapeT, null);
  assert.equal(ignitions(), 1, 'engine restart remains independent of music availability');
});
for (const source of ['off', 'youtube', 'spotify']) test(`${source} ignores a cached element from an earlier local source`, t => {
  const element = { playbackRate: .45 }, { audio, ticks, filters } = setup(t, source, element);
  audio.tapeStop(.2, 1); audio.restart();
  assert.equal(ticks.length, 0); assert.equal(filters(), 0); assert.equal(element.playbackRate, .45);
});
for (const source of ['files', 'builtin']) test(`${source} restarts an existing element and completes the speed ramp`, t => {
  const element = { playbackRate: .45 }, { audio, ticks, advance, filters } = setup(t, source, element);
  audio.restart(); assert.equal(ticks.length, 1); assert.equal(filters(), 1);
  advance(300); ticks[0](); assert.equal(element.playbackRate, 1); assert.equal(audio.tapeT, null);
});
test('switching source cancels a pending tape effect without touching its old element', t => {
  const element = { playbackRate: 1, pause() {} }, { audio, ticks, advance } = setup(t, 'files', element);
  audio.tapeStop(.45, 2.2); audio.musicSources.select('off'); advance(1000); ticks[0]();
  assert.equal(element.playbackRate, 1); assert.equal(audio.tapeT, null);
});
test('tapeStop before the audio graph starts is safe', () => {
  const audio = new Audio(); assert.doesNotThrow(() => audio.tapeStop(.45, 2.2)); assert.doesNotThrow(() => audio.restart());
});
