// Owner-locked decision: 2026-10-17, “No music in the game”.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { Audio, AUDIO_DEFAULTS, AudioMix } from '../src/audio.js';
import { DEFAULT_BINDINGS, EDGE_ACTIONS } from '../src/input.js';

const root = new URL('../', import.meta.url);
const lock = 'Owner-locked decision, see docs/OWNER-DECISIONS.md. Ask the owner before changing.';
const forbidden = /music|youtube|playlist|nextTrack|tapeStop|now playing|built-in radio/i;
async function scan(dir) {
  for (const entry of await readdir(new URL(dir, root), { withFileTypes: true })) {
    const path = dir + entry.name;
    assert.doesNotMatch(entry.name, /music|youtube|playlist/i, `${path}: ${lock}`);
    if (entry.isDirectory()) await scan(path + '/');
    else if (/\.(?:[cm]?js|html|css|jsonc?)$/.test(path)) {
      let source = await readFile(new URL(path, root), 'utf8');
      // The only allowed production reference removes obsolete saved preferences.
      if (path === 'src/settings.js') source = source.replace(
        'const retired = Object.keys(saved).filter(key => /phone.?wheel|music|youtube|playlist/i.test(key));', '');
      assert.doesNotMatch(source, forbidden, `${path}: ${lock}`);
    }
  }
}

test('owner lock: no playback sources, graph, settings, controls, UI or bundled tracks', async () => {
  for (const dir of ['src/', 'server/', 'worker/', 'assets/audio/']) await scan(dir);
  for (const file of ['index.html', 'style.css', 'package.json', 'wrangler.jsonc', 'tools/prepare-deploy.mjs', 'tools/bundle-browser.mjs', 'tools/release-cache.mjs', 'tools/release-data.mjs']) {
    assert.doesNotMatch(await readFile(new URL(file, root), 'utf8'), forbidden, `${file}: ${lock}`);
  }
  assert.equal(existsSync(new URL('assets/audio/music/', root)), false, lock);
  assert.equal(existsSync(new URL('assets/icons/music-notes.svg', root)), false, lock);
  assert.doesNotMatch(JSON.stringify({ AUDIO_DEFAULTS, DEFAULT_BINDINGS, EDGE_ACTIONS }), forbidden, lock);
  const audio = new Audio();
  assert.equal(audio.musicSources, undefined, lock);
  assert.equal(audio.toggleMusic, undefined, lock);
  assert.equal(audio.nextTrack, undefined, lock);
  assert.equal(typeof audio.copRadio, 'function', 'Police chatter remains an effect');
  assert.equal(typeof AudioMix.prototype.setMenu, 'function', 'World/menu attenuation remains');
});

test('retired preferences are dropped on load and cannot be saved again, even with read-only storage', async () => {
  const previous = globalThis.localStorage;
  try {
    for (const readOnly of [false, true]) {
      const values = new Map([['paraliaki.settings', JSON.stringify({ master: .3, engine: .9, music: .7, musicSource: 'builtin', youtubeURL: 'old URL', playlist: ['old track'] })]]);
      globalThis.localStorage = {
        getItem: key => values.get(key) ?? null,
        setItem: (key, value) => { if (readOnly) throw Error('Read only'); values.set(key, value); },
        removeItem: key => values.delete(key),
      };
      const { settings, DEFAULTS, AUDIO_VOLUMES, setSetting } = await import(`../src/settings.js?retired-audio=${readOnly}`);
      assert.doesNotMatch(JSON.stringify({ settings, DEFAULTS, AUDIO_VOLUMES }), forbidden, lock);
      assert.equal(settings.master, .3);
      assert.equal(settings.engine, .9);
      for (const key of ['music', 'musicSource', 'youtubeURL', 'playlist']) setSetting(key, 'builtin');
      assert.doesNotMatch(JSON.stringify(settings), forbidden, lock);
      if (!readOnly) {
        assert.doesNotMatch(values.get('paraliaki.settings'), forbidden, 'Persisted obsolete fields are removed');
        setSetting('voice', .4);
        assert.doesNotMatch(values.get('paraliaki.settings'), forbidden);
        assert.equal(JSON.parse(values.get('paraliaki.settings')).voice, .4);
      }
    }
  } finally {
    if (previous === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previous;
  }
});
