// The web app manifest that makes "Add to Home Screen" launch the game fullscreen like an app.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createGameServer } from '../server/index.mjs';

const root = resolve(import.meta.dirname, '..');
const read = (p) => readFile(resolve(root, p), 'utf8');
const manifest = JSON.parse(await read('assets/manifest.webmanifest'));
const png = async (src) => { const b = await readFile(resolve(root, 'assets', src)); assert.equal(b.subarray(1, 4).toString(), 'PNG', src); return `${b.readUInt32BE(16)}x${b.readUInt32BE(20)}`; };

test('manifest: identity, fullscreen display, colours and a start URL inside its scope', async () => {
  assert.equal(manifest.name, 'ATHENS RACING');
  assert.ok(manifest.short_name);
  assert.ok(['fullscreen', 'standalone'].includes(manifest.display));
  assert.equal(manifest.orientation, 'landscape');
  assert.ok(manifest.display_override.includes('fullscreen'));
  const base = new URL('https://asr.test/assets/manifest.webmanifest');
  assert.equal(new URL(manifest.start_url, base).pathname, '/');
  assert.equal(new URL(manifest.scope, base).pathname, '/');
  assert.match(manifest.background_color, /^#[0-9a-f]{6}$/i);
  assert.equal(manifest.theme_color, '#07090c');
  assert.match(await read('index.html'), /<meta name="theme-color" content="#07090c"/);
});

test('manifest: 192 and 512 icons in both "any" and "maskable" purposes, each really that size', async () => {
  for (const [size, purpose] of [[192, 'any'], [512, 'any'], [192, 'maskable'], [512, 'maskable']]) {
    const icon = manifest.icons.find((i) => i.sizes === `${size}x${size}` && i.purpose === purpose);
    assert.ok(icon, `${size} ${purpose}`);
    assert.equal(icon.type, 'image/png');
    assert.equal(await png(icon.src), `${size}x${size}`, icon.src);
  }
  assert.equal(await png('apple-touch-icon.png'), '180x180');
});

test('index.html links the manifest, the touch icon and the iOS / Android app meta', async () => {
  const html = await read('index.html');
  assert.match(html, /<link rel="manifest" href="assets\/manifest\.webmanifest"/);
  assert.match(html, /<link rel="apple-touch-icon" href="assets\/apple-touch-icon\.png" sizes="180x180"/);
  assert.match(html, /<meta name="apple-mobile-web-app-capable" content="yes"/);
  assert.match(html, /<meta name="mobile-web-app-capable" content="yes"/);
  assert.match(html, /<meta name="apple-mobile-web-app-title" content="ATHENS RACING"/);
  assert.match(html, /apple-mobile-web-app-status-bar-style/);
  assert.match(await read('tools/prepare-deploy.mjs'), /'assets'/, 'the deploy copies the whole assets folder, manifest and icons included');
});

test('the Node server serves the manifest as application/manifest+json (the Worker\'s asset binding does the same)', async () => {
  const dataDir = await mkdtemp(resolve(tmpdir(), 'asr-manifest-'));
  const app = await createGameServer({ root, dataDir });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  try {
    const res = await fetch(`http://127.0.0.1:${app.server.address().port}/assets/manifest.webmanifest`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /^application\/manifest\+json/);
    assert.deepEqual(await res.json(), manifest);
  } finally { await app.close(); await rm(dataDir, { recursive: true, force: true }); }
});
