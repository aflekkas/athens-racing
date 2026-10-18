import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { legalPage } from '../worker/legal-pages.mjs';
import { createGameServer } from './index.mjs';

test('legal routes serve standalone crawlable HTML on production and staging', async () => {
  for (const host of ['athensracing.com', 'staging.athensracing.com']) {
    for (const path of ['/privacy', '/terms']) {
      const response = legalPage(new Request(`https://${host}${path}`));
      assert.equal(response.status, 200);
      assert.match(response.headers.get('Content-Type'), /^text\/html/);
      const html = await response.text();
      assert.match(html, /<!doctype html>/i);
      assert.match(html, new RegExp(`rel="canonical" href="https://${host}${path}"`));
      assert.match(html, /2026-10-15/);
      assert.match(html, /Alexandros Lekkas/);
      assert.match(html, /aflekkas@gmail.com/);
      assert.doesNotMatch(html, /<script\b|<iframe\b|src\/main|noindex/i);
      assert.match(html, /href="\/privacy"/);
      assert.match(html, /href="\/terms"/);
      if (path === '/privacy') { assert.match(html, /cookieless Web Analytics beacon/); assert.doesNotMatch(html, /includes no analytics tracker/); }
      const head = legalPage(new Request(`https://${host}${path}`, { method: 'HEAD' }));
      assert.equal(head.status, 200);
      assert.equal(await head.text(), '');
    }
  }
  for (const path of ['/', '/constructor', '/toString', '/privacy-other']) assert.equal(legalPage(new Request('https://athensracing.com' + path)), null);
});

test('www and alternate legal paths redirect to canonical documents', () => {
  for (const path of ['/privacy', '/terms']) {
    const response = legalPage(new Request(`https://www.athensracing.com${path}`));
    assert.equal(response.status, 301);
    assert.equal(response.headers.get('Location'), `https://athensracing.com${path}`);
    for (const suffix of ['/', '.html']) assert.equal(legalPage(new Request(`https://athensracing.com${path}${suffix}`)).headers.get('Location'), `https://athensracing.com${path}`);
    assert.equal(legalPage(new Request(`https://athensracing.com${path}`, { method: 'POST' })).status, 405);
  }
});

test('Worker intercepts legal routes before assets; sitemap and in-game entry points link documents', async () => {
  const worker = await readFile(new URL('../worker/index.mjs', import.meta.url), 'utf8');
  assert.ok(worker.indexOf('legalPage(request)') < worker.indexOf('env.ASSETS.fetch(request)'));
  const config = JSON.parse((await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8')));
  assert.equal(config.assets.run_worker_first, true, 'all assets must reach the Worker for host canonicalization');
  const sitemap = await readFile(new URL('../sitemap.xml', import.meta.url), 'utf8');
  for (const path of ['/privacy', '/terms']) assert.ok(sitemap.includes(`https://athensracing.com${path}`));
  const accounts = await readFile(new URL('../src/ui/account-screen.js', import.meta.url), 'utf8');
  const release = await readFile(new URL('../src/ui/release-screens.js', import.meta.url), 'utf8');
  assert.match(accounts, /foot: `\$\{privacyLink\}/, 'the sign-in dialog footer links the privacy policy');
  assert.match(accounts, /Read the \$\{privacyLink\}/);
  assert.match(release, /CONTRIBUTING_URL[^\n]*\$\{legalLinks\}/);
  assert.match(release, /title: 'CREDITS'[\s\S]*?, legalLinks\);/, 'Credits ends with the privacy and terms links');
});

test('local HTTP transport returns HTML without a game boot', async t => {
  const app = await createGameServer();
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  for (const path of ['/privacy', '/terms']) {
    const response = await fetch(`http://127.0.0.1:${app.server.address().port}${path}`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /^text\/html/);
    assert.doesNotMatch(await response.text(), /<script\b/i);
  }
});
