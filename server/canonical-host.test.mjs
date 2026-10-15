import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { canonicalHostRedirect } from '../worker/canonical-host.mjs';

test('www documents, assets and OAuth navigations redirect with 301, preserving path and query', () => {
  for (const path of ['/', '/privacy', '/terms', '/index.html', '/assets/maps/riviera.webp', '/src/main.js', '/robots.txt', '/sitemap.xml', '/arbitrary/deep/path', '/api/auth/google/start', '/api/auth/google/callback']) {
    for (const scheme of ['http', 'https']) {
      const request = new Request(`${scheme}://www.athensracing.com${path}?from=google&return=%2Frace%3Fx%3D1`);
      const response = canonicalHostRedirect(request);
      assert.equal(response.status, 301);
      assert.equal(response.headers.get('Location'), `https://athensracing.com${path}?from=google&return=%2Frace%3Fx%3D1`);
    }
  }
});

test('canonical, staging, API and WebSocket connections keep their current origin', () => {
  for (const host of ['athensracing.com', 'staging.athensracing.com', 'localhost']) assert.equal(canonicalHostRedirect(new Request(`https://${host}/privacy?q=1`)), null);
  for (const path of ['/ws', '/api/account/presence', '/api/auth/session', '/api/leaderboard', '/api/lobbies']) assert.equal(canonicalHostRedirect(new Request('https://www.athensracing.com' + path)), null);
  assert.equal(canonicalHostRedirect(new Request('https://www.athensracing.com/api/account/profile', { method: 'POST', body: '{}' })), null);
});

test('all assets pass through the Worker and canonicalization runs before APIs and assets', async () => {
  const config = JSON.parse(await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
  assert.equal(config.assets.run_worker_first, true);
  const worker = await readFile(new URL('../worker/index.mjs', import.meta.url), 'utf8');
  assert.ok(worker.indexOf('canonicalHostRedirect(request)') < worker.indexOf('legalPage(request)'));
  assert.ok(worker.indexOf('canonicalHostRedirect(request)') < worker.indexOf('env.ASSETS.fetch(request)'));
});
