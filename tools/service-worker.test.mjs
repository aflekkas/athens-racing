// The offline cache: request routing (never /ws, /api, /auth, music streams), content addressing, release build.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { buildRelease, publishRelease, hash16, CACHE_HEADERS } from './release-cache.mjs';

const root = resolve(import.meta.dirname, '..');
async function loadWorker(release) {
  const self = { location: { origin: 'https://asr.test' }, ASR_RELEASE: release };
  vm.runInNewContext(await readFile(resolve(root, 'src/service-worker.js'), 'utf8'), { self, URL, Response, crypto, caches: undefined, fetch: undefined });
  return self.ASR_SW;
}

test('routes only listed static files, the page and pinned CDN files', async () => {
  const files = { '/src/main.js': 'a'.repeat(16), '/data/map.json': 'b'.repeat(16) };
  const sw = await loadWorker({ build: 't', files, core: [] });
  const route = (url, opts = {}) => sw.routeOf(opts.method || 'GET', url, opts.mode || 'cors', !!opts.range, 'https://asr.test', files);
  assert.equal(route('https://asr.test/src/main.js'), 'content');
  assert.equal(route('https://asr.test/src/main.js?v=2'), 'content');
  assert.equal(route('https://asr.test/data/map.json'), 'content');
  assert.equal(route('https://asr.test/data/map.json', { method: 'POST' }), null);
  assert.equal(route('https://asr.test/data/map.json', { range: true }), null);
  for (const p of ['/ws', '/api/lobbies', '/api/me', '/api/customization/assets/x', '/auth/logout', '/health', '/assets/audio/music/a.mp3', '/src/unlisted.js'])
    assert.equal(route('https://asr.test' + p, { mode: p.startsWith('/auth') ? 'navigate' : 'cors' }), null, p);
  assert.equal(route('https://asr.test/', { mode: 'navigate' }), 'page');
  assert.equal(route('https://asr.test/index.html?quality=low', { mode: 'navigate' }), 'page');
  assert.equal(route('https://asr.test/', { mode: 'cors' }), null);
  assert.equal(route('https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js'), 'cdn');
  assert.equal(route('https://fonts.gstatic.com/s/barlow/x.woff2'), 'cdn');
  assert.equal(route('https://fonts.googleapis.com/css2?family=Barlow'), null);
  assert.equal(route('https://evil.test/src/main.js'), null);
  assert.equal(sw.contentPath('/src/main.js', files), '/_c/aaaaaaaaaaaaaaaa.js');
  assert.equal(sw.contentPath('/nope.js', files), null);
  assert.equal(await sw.hex16(new TextEncoder().encode('athens').buffer), hash16(Buffer.from('athens')));
});

test('navigations are checked against the worker release (skew, rollback, kill switch)', async () => {
  const sw = await loadWorker({ build: 'abc123', files: {}, core: [] });
  const page = (build) => `<html><head>${build ? `<meta name="asr-build" content="${build}" />` : ''}</head></html>`;
  assert.equal(sw.releaseOf(page('abc123')), 'abc123');
  assert.equal(sw.releaseOf(page(null)), null);
  assert.equal(sw.verdictOf('https://asr.test/', page('abc123')), 'same');
  assert.equal(sw.verdictOf('https://asr.test/?quality=low', page('def456')), 'newer'); // a deploy: bypass the cache, update
  assert.equal(sw.verdictOf('https://asr.test/', page(null)), 'remove'); // rollback to a pre-cache build / kill switch
  assert.equal(sw.verdictOf('https://asr.test/?nosw', page('abc123')), 'remove');
  // the deploy build writes exactly the meta the worker reads
  const dir = await mkdtemp(resolve(tmpdir(), 'asr-meta-'));
  try {
    await mkdir(resolve(dir, 'src'), { recursive: true }); await writeFile(resolve(dir, 'index.html'), '<html><head></head><body></body></html>'); await writeFile(resolve(dir, 'src/a.js'), '1');
    const release = await buildRelease(dir); await publishRelease(root, dir, release);
    assert.equal(sw.releaseOf(await readFile(resolve(dir, 'index.html'), 'utf8')), release.build);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('a release publishes immutable content-addressed copies, a worker and the page hook', async () => {
  const dir = await mkdtemp(resolve(tmpdir(), 'asr-release-'));
  try {
    for (const [p, body] of [['index.html', '<html><head></head><body></body></html>'], ['src/a.js', 'export const a = 1;'], ['src/b.js', 'export const a = 1;'], ['assets/audio/music/song.mp3', 'x'], ['data/raw/roads.json', '{}'], ['data/map.json', '{"v":1}']]) {
      await mkdir(resolve(dir, p, '..'), { recursive: true }); await writeFile(resolve(dir, p), body);
    }
    const release = await buildRelease(dir, { core: ['/src/'] });
    assert.deepEqual(Object.keys(release.files).sort(), ['/data/map.json', '/src/a.js', '/src/b.js']);
    assert.equal(release.files['/src/a.js'], release.files['/src/b.js']);
    assert.equal(release.copies, 2); // identical content shares one copy
    assert.deepEqual((await readdir(resolve(dir, '_c'))).sort(), [`${hash16('export const a = 1;')}.js`, `${hash16('{"v":1}')}.json`].sort());
    await publishRelease(root, dir, release);
    const html = await readFile(resolve(dir, 'index.html'), 'utf8');
    assert.match(html, new RegExp(`<meta name="asr-build" content="${release.build}" />`));
    assert.match(html, /src\/offline-cache\.js/);
    assert.match(await readFile(resolve(dir, 'sw.js'), 'utf8'), /^self\.ASR_RELEASE = \{"build":/);
    const changed = await buildRelease((await writeFile(resolve(dir, 'src/a.js'), 'export const a = 2;'), dir));
    assert.notEqual(changed.build, release.build);
    assert.equal(changed.files['/src/b.js'], release.files['/src/b.js']); // unchanged files keep their URL
    assert.match(CACHE_HEADERS, /\/_c\/\*\n  Cache-Control: public, max-age=31536000, immutable/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
