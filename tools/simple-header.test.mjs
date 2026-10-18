// Owner 2026-10-17: simple shared headers; wall-clock time is never game UI.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import * as C from '../src/ui/components.js';
const read = path => readFileSync(path, 'utf8');

test('inner headers omit identity, even on screens without a Back button', () => {
  for (const back of [true, false]) {
    const html = C.screen({ back, kick: 'GARAGE · 31 / 31 CARS', title: 'GARAGE', head: C.searchField({ name: 'cars' }) });
    const status = html.slice(0, html.indexOf('<header'));
    assert.match(status, /GARAGE · 31 \/ 31 CARS/);
    assert.equal(status.includes('data-act="back"'), back);
    assert.doesNotMatch(status, /hu-status__r|hu-driver|data-act="account"|build-badge|<time/);
    assert.match(html, /scr__title">GARAGE/);
    assert.match(html, /scr__headr[\s\S]*type="search"/);
  }
  assert.doesNotMatch(C.sheetHead({ kick: 'PAUSED', title: 'PAUSE' }), /hu-driver|<time/);
});

test('only the title opts into the account button, retaining the account and sign-out route', async () => {
  const { Menu } = await import('../src/menu.js');
  const priorDocument = globalThis.document, priorWindow = globalThis.window;
  globalThis.document = { baseURI: 'http://localhost/', querySelector: () => null, body: { classList: { contains: () => false } } };
  globalThis.window = {};
  let title;
  try { title = Menu.prototype.r_title.call({ h: {} }); }
  finally { globalThis.document = priorDocument; globalThis.window = priorWindow; }
  assert.match(title, /<button[^>]*data-act="account"[^>]*aria-label="Account"/);
  assert.doesNotMatch(title, /<time|hu-clock/);
  const menu = read('src/menu.js');
  assert.match(menu, /case 'account': this.show\('account'/);
  assert.match(read('src/ui/account-screen.js'), /act: ['"]account-logout['"]/);
  // A new status bar caller must not silently opt an inner screen into account UI.
  for (const path of readdirSync('src', { recursive: true }).filter(p => p.endsWith('.js'))) {
    const src = read('src/' + path);
    if (path === 'ui/components.js') continue;
    const calls = [...src.matchAll(/(?:C\.)?statusBar\(\{[^}]*\}/g)];
    for (const [call] of calls) {
      assert.equal(path, 'menu.js');
      assert.equal(menu.indexOf(call) > menu.indexOf('  r_title(') && menu.indexOf(call) < menu.indexOf('  participantChoice('), true);
      assert.match(call, /account: true/);
    }
  }
});

test('no wall-clock markup, formatting, or update code survives in game sources', () => {
  for (const path of readdirSync('src', { recursive: true }).filter(p => /\.(js|css)$/.test(p))) {
    assert.doesNotMatch(read('src/' + path), /hu-clock|data-hu-clock|clockText|toLocaleTimeString\s*\(|\.getHours\s*\(|\.getMinutes\s*\(/, path);
  }
});

test('floating race navigation never occupies an open menu header', () => {
  assert.match(read('src/ui/ui.css'), /body\[data-ui\] #mp-toggle\s*\{\s*display: none !important;/);
});
