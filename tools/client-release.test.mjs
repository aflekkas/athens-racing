import test from 'node:test';
import assert from 'node:assert/strict';
import { reloadIfUpdated, importWithUpdate } from '../src/client-release.js';
function fixture(build, next, storage = new Map()) {
  const calls = { fetch: 0, reload: 0 };
  return { calls, options: {
    document: { querySelector: () => build ? { content: build } : null },
    location: { href: 'https://game.example/?menu', reload() { calls.reload++; } },
    storage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    fetcher: async (url, options) => { calls.fetch++; assert.equal(url.href, 'https://game.example/'); assert.equal(options.cache, 'no-store'); return new Response(`<meta name="asr-build" content="${next}">`); },
  } };
}
test('a successful lazy import never checks the network', async () => {
  const f = fixture('success-old', 'success-new'), module = { world: true };
  assert.equal(await importWithUpdate(async () => module, f.options), module);
  assert.deepEqual(f.calls, { fetch: 0, reload: 0 });
});
test('same-release failures keep the original error and do not reload', async () => {
  const f = fixture('same', 'same'), error = new Error('failed module');
  await assert.rejects(importWithUpdate(async () => { throw error; }, f.options), e => e === error);
  assert.deepEqual(f.calls, { fetch: 1, reload: 0 });
});
test('concurrent stale chunks check once and a release pair reloads only once', async () => {
  const storage = new Map(), f = fixture('old-concurrent', 'new-concurrent', storage);
  assert.deepEqual(await Promise.all([reloadIfUpdated(f.options), reloadIfUpdated(f.options)]), [true, true]);
  assert.deepEqual(f.calls, { fetch: 1, reload: 1 });
  assert.equal(await reloadIfUpdated(f.options), false);
  assert.equal(f.calls.reload, 1);
});
test('a persisted guard and disabled storage both prevent repeated reloads', async () => {
  const f = fixture('guard-old', 'guard-new', new Map([['asr-chunk-reload:guard-old:guard-new', String(Date.now())]]));
  assert.equal(await reloadIfUpdated(f.options), false); assert.equal(f.calls.reload, 0);
  const blocked = fixture('blocked-old', 'blocked-new');
  blocked.options.storage = { getItem() { throw new Error('blocked'); } };
  assert.equal(await reloadIfUpdated(blocked.options), true);
  assert.equal(await reloadIfUpdated(blocked.options), false);
  assert.equal(blocked.calls.reload, 1);
});
test('offline and unmanaged development pages never reload', async () => {
  const f = fixture('offline-old', 'offline-new'); f.options.fetcher = async () => { throw new TypeError('offline'); };
  assert.equal(await reloadIfUpdated(f.options), false); assert.equal(f.calls.reload, 0);
  const dev = fixture(null, 'dev-next'); assert.equal(await reloadIfUpdated(dev.options), false);
  assert.deepEqual(dev.calls, { fetch: 0, reload: 0 });
});

test('a rollback to an unmanaged index reloads so the old worker can remove itself', async () => {
  const f = fixture('rollback-managed', 'unused');
  f.options.fetcher = async () => new Response('<!doctype html><title>Native source rollback</title>');
  assert.equal(await reloadIfUpdated(f.options), true);
  assert.equal(f.calls.reload, 1);
});
