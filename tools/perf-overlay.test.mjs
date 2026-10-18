import './ragdoll-worker.test.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

// Minimal DOM stub for the overlay (node has no document).
function stubDocument() {
  const els = [];
  globalThis.document = {
    body: { append(el) { els.push(el); } },
    hidden: false,
    addEventListener() {},
    removeEventListener() {},
    createElement() {
      return { id: '', style: {}, dataset: {}, textContent: '',
        setAttribute() {}, remove() {}, };
    },
  };
  return els;
}

test('perfOverlay defaults off and persists', async () => {
  const values = new Map();
  globalThis.localStorage = { getItem: (k) => values.get(k) ?? null, setItem: (k, v) => values.set(k, v) };
  const settings = await import('../src/settings.js?perf-overlay-a=1');
  assert.equal(settings.settings.perfOverlay, false);
  settings.setSetting('perfOverlay', true);
  assert.equal(settings.settings.perfOverlay, true);
  assert.equal(JSON.parse(values.get('paraliaki.settings')).perfOverlay, true);
  settings.setSetting('perfOverlay', false);
  assert.equal(settings.settings.perfOverlay, false);
});

test('PerfOverlay shows fps/ms/draws at 2 Hz and hides', async () => {
  stubDocument();
  try {
  const { PerfOverlay } = await import('../src/perf-overlay.js?perf-overlay-b=1');
  let calls = 0;
  const overlay = new PerfOverlay(() => { calls++; return { calls: 750, tris: 2500000, scale: .675 }; });
  assert.equal(overlay.el.style.display, 'none');
  overlay.setVisible(true);
  assert.equal(overlay.el.style.display, 'block');
  // below the 0.5 s refresh budget: no text, no stats read
  overlay.frame(1 / 60);
  assert.equal(overlay.el.textContent, '');
  assert.equal(calls, 0);
  // past the budget: one readout, counters reset
  overlay.frame(0.5);
  assert.equal(calls, 1);
  assert.match(overlay.el.textContent, /FPS/);
  assert.match(overlay.el.textContent, /MS/);
  assert.match(overlay.el.textContent, /750 DRAWS/);
  assert.match(overlay.el.textContent, /2\.50M TRIS/);
  assert.match(overlay.el.textContent, /68% SCALE/);
  assert.doesNotMatch(overlay.el.textContent, /HZ|LIMIT/, 'no limit info when the stats carry none');
  // under a limit the overlay also shows how fast the browser is calling back; under no limit every callback draws
  const limited = new PerfOverlay(() => ({ limit: 60 })); limited.setVisible(true);
  for (let i = 0; i < 60; i++) limited.tick();
  limited.frame(.5);
  assert.match(limited.el.textContent, /· 120 HZ · LIMIT 60 ·/);
  const free = new PerfOverlay(() => ({ limit: 0 })); free.setVisible(true);
  for (let i = 0; i < 8; i++) { free.tick(); free.frame(.0625); }
  assert.match(free.el.textContent, /· NO LIMIT ·/);
  assert.doesNotMatch(free.el.textContent, /HZ/);
  limited.dispose(); free.dispose();
  overlay.setVisible(false);
  assert.equal(overlay.el.style.display, 'none');
  overlay.frame(1);
  assert.equal(calls, 1, 'hidden overlay reads no stats');
  overlay.dispose();
  } finally { delete globalThis.document; }
});

test('tex.setAnisotropy clamps to 1..8', async () => {
  const tex = await import('../src/tex.js?perf-overlay-c=1');
  assert.equal(tex.setAnisotropy(2), 2);
  assert.equal(tex.setAnisotropy(0), 1);
  assert.equal(tex.setAnisotropy(99), 8);
  assert.equal(tex.setAnisotropy(8), 8);
});

test('Graphics settings video tab offers the overlay toggle', async () => {
  const { Menu } = await import('../src/menu.js?perf-overlay-d=1');
  const menu = Object.assign(Object.create(Menu.prototype), { h: {} });
  const html = menu.r_settings({ tab: 'video', from: 'pause' });
  assert.match(html, /data-key="perfOverlay"/);
  assert.match(html, /PERFORMANCE OVERLAY/);
});
