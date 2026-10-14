import test from 'node:test';
import assert from 'node:assert/strict';
import { MusicSources, isMusicFile } from '../src/music-sources.js';
import { parseYouTubeURL } from '../src/music-youtube.js';
function setup() {
  const levels = [], audio = { musicOn: false, ctx: { currentTime: 0, resume: async () => {} }, mix: { menu: false }, musicBus: { gain: { setTargetAtTime: value => levels.push(value) } }, start() {} };
  const source = new MusicSources(audio); source.enabled = true;
  source.el = { paused: true, play: async function() { this.paused = false; }, pause() { this.paused = true; } };
  return { source, audio, levels };
}
test('Spotify is gone and a saved Spotify choice falls back to Off', () => {
  globalThis.localStorage = { getItem: () => 'spotify', setItem() {} };
  try { const { source } = setup(); assert.equal(source.source, 'off'); source.select('spotify'); assert.equal(source.source, 'off'); } finally { delete globalThis.localStorage; }
});
test('Off is the fresh default and next/mute do not start bundled music', async () => {
  const { source, audio } = setup(); assert.equal(source.source, 'off'); await source.next(); assert.equal(source.toggle(), false); assert.equal(audio.musicOn, false); assert.equal(source.el.paused, true);
});
test('local playlist uses files, wraps next/previous and pauses on source change', async () => {
  const { source, audio, levels } = setup();
  const files = [new File(['a'], 'a.wav', { type: 'audio/wav' }), new File(['b'], 'b.wav', { type: 'audio/wav' })];
  await source.loadFiles(files); assert.equal(source.files.length, 2); assert.equal(source.el.paused, false);
  assert.match(source.el.src, /^blob:/); assert.equal(source.index, 0); await source.next(); assert.equal(source.index, 1); await source.next(-1); assert.equal(source.index, 0);
  source.select('youtube'); assert.equal(source.el.paused, true); assert.equal(audio.musicOn, false); assert.equal(levels.at(-1), 0); source.releaseURL();
});
test('late playlist fetch cannot restart an old source after selecting Off', async () => {
  const { source } = setup(); let resolve;
  source.select('builtin'); source.builtin = new Promise(r => { resolve = r; });
  const next = source.next(); source.select('off'); resolve([{ file: 'a.mp3' }]); await next;
  assert.equal(source.el.paused, true); assert.equal(source.source, 'off');
});
test('local files are 6 dB quieter in menus after compensating the calibrated bus', () => {
  const { source, audio } = setup(); let gain;
  source.inputGain = { gain: { setTargetAtTime: value => { gain = value; } } };
  source.source = 'files'; audio.mix.menu = true; source.syncMenu(); assert.equal(gain * .62, .35 * .5);
  source.source = 'builtin'; source.syncMenu(); assert.equal(gain, 1);
});
test('YouTube video, live and playlist URLs parse; non-YouTube/script origins are rejected', () => {
  assert.equal(parseYouTubeURL('https://youtu.be/jfKfPfyJRdk').video, 'jfKfPfyJRdk');
  assert.equal(parseYouTubeURL('https://www.youtube.com/live/jfKfPfyJRdk').video, 'jfKfPfyJRdk');
  assert.equal(parseYouTubeURL('https://www.youtube.com/playlist?list=PL123456789abc').playlist, 'PL123456789abc');
  for (const url of ['javascript:alert(1)', 'https://youtube.com.evil.test/watch?v=jfKfPfyJRdk', 'https://www.youtube.com/watch?v=bad']) assert.throws(() => parseYouTubeURL(url));
  assert.equal(isMusicFile({ name: 'song.MP3' }), true); assert.equal(isMusicFile({ name: 'cover.jpg' }), false);
});

test('an old media play promise does not pause a newer file source', async () => {
  const { source, audio } = setup(); let release, calls = 0;
  source.source = 'files'; source.files = [new File(['a'], 'a.wav', { type: 'audio/wav' })]; audio.musicOn = true;
  source.el.play = function() { this.paused = false; return ++calls === 1 ? new Promise(resolve => { release = resolve; }) : Promise.resolve(); };
  const old = source.play(); await new Promise(resolve => setImmediate(resolve));
  source.select('files'); await new Promise(resolve => setImmediate(resolve)); assert.equal(source.el.paused, false);
  release(); await old; assert.equal(source.el.paused, false); source.releaseURL();
});
