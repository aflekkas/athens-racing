// The one launch check (owner 2026-10-20: "one central loading screen that checks auth"; sign-in required when Google is
// configured, owner 2026-10-17, offline stays gated). src/ui/account-loader.js with the real AccountsClient against
// scripted server answers: nothing renders until the session is known, then the launch routes once and the launch screen
// (src/ui/boot-screen.js) leaves after the first real screen is up.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { install } from '../src/ui/account-loader.js';
import { AccountsClient } from '../src/accounts-client.js';

const OWNER = 'Owner 2026-10-20 (one launch screen that checks auth) within the locked Google sign-in rules (2026-10-17), docs/OWNER-DECISIONS.md.';
const tick = (ms = 0) => new Promise(r => setTimeout(r, ms));
const ok = body => ({ status: 200, ok: true, json: async () => body });
const GOOGLE = { providers: ['google'], required: true };
const USER = { id: 'u1', displayName: 'ATHENA' };

/** a launch: the loader on a recording menu, the real client answering from `routes` (a function or a value per path) */
function launch(routes, { request = 'title', hint = null, calls = [] } = {}) {
  const log = [], memory = new Map(hint ? [['paraliaki.sessionHint', JSON.stringify(hint)]] : []);
  const saved = { window: globalThis.window, document: globalThis.document };
  globalThis.window = { addEventListener() {} }; globalThis.document = { addEventListener() {}, hidden: false };
  const fetcher = async path => { calls.push(path); const r = routes[path]; if (r instanceof Error) throw r; const v = typeof r === 'function' ? await r() : r; return v?.status ? v : ok(v ?? []); };
  class Client extends AccountsClient {
    constructor(o) { super({ ...o, fetcher, storage: { getItem: k => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, v), removeItem: k => memory.delete(k) } }); }
    connect() {} // no presence socket in a unit test
  }
  const menu = { screen: null, show(screen) { this.screen = screen; log.push(screen); }, hide() {}, activate() {}, back() {}, pop() { return false; } };
  const boot = { steps: [], step(t) { if (t) this.steps.push(t); }, done() { log.push('BOOT DONE'); } };
  try { install(menu, { boot, AccountsClientClass: Client, loadScreen: async () => ({ install() {} }) }); }
  finally { for (const [k, v] of Object.entries(saved)) v === undefined ? delete globalThis[k] : (globalThis[k] = v); } // listeners are added at install only
  if (request) menu.show(request); // what boot.js asks for straight away
  return { menu, log, boot, client: menu.accounts };
}
const settle = async (l, until = () => l.log.includes('BOOT DONE')) => { for (let i = 0; i < 200 && !until(); i++) await tick(5); };

test('signed in: the launch screen goes straight to the title, nothing shown before', async () => {
  const l = launch({ '/api/auth/config': GOOGLE, '/api/auth/session': { user: USER, csrf: 'x', expires: Date.now() + 864e5, migrated: true, progress: {} } });
  assert.deepEqual(l.log, [], `nothing renders before the session is known. ${OWNER}`);
  assert.deepEqual(l.boot.steps, ['CHECKING YOUR SESSION']);
  await settle(l);
  assert.deepEqual(l.log, ['title', 'BOOT DONE'], 'the title, then the launch screen leaves: no sign-in flash');
});

test('signed out: the sign-in dialog is the first screen, never the title', async () => {
  const l = launch({ '/api/auth/config': GOOGLE, '/api/auth/session': { user: null } });
  await settle(l);
  assert.deepEqual(l.log, ['signIn', 'BOOT DONE'], OWNER);
  assert.equal(l.client.blocked, true);
});

test('an expired session at launch routes to sign-in; one that expires while playing brings sign-in back', async () => {
  const expired = launch({ '/api/auth/config': GOOGLE, '/api/auth/session': { user: null } });
  await settle(expired); assert.deepEqual(expired.log, ['signIn', 'BOOT DONE']);
  const l = launch({ '/api/auth/config': GOOGLE, '/api/auth/session': { user: USER, csrf: 'x', expires: Date.now() + 60, migrated: true, progress: {} } });
  await settle(l); assert.deepEqual(l.log, ['title', 'BOOT DONE']);
  l.menu.screen = 'title';
  await settle(l, () => l.log.includes('signIn'));
  assert.equal(l.log.at(-1), 'signIn', 'the session ran out: the gate is back');
  assert.match(l.client.error, /session expired/i);
});

test('offline: gated with retry (no offline play while Google is configured)', async () => {
  const l = launch({ '/api/auth/config': Object.assign(new TypeError('Failed to fetch'), { name: 'TypeError' }) });
  await settle(l);
  assert.deepEqual(l.log, ['signIn', 'BOOT DONE'], `the sign-in dialog in its offline state, with TRY AGAIN. ${OWNER}`);
  assert.equal(l.client.offline, true); assert.match(l.client.error, /internet/i);
  assert.ok(!l.log.includes('title'));
});

test('an unconfigured local environment plays locally: straight to the title', async () => {
  const l = launch({ '/api/auth/config': { providers: [], required: false } });
  await settle(l);
  assert.deepEqual(l.log, ['title', 'BOOT DONE']);
  assert.equal(l.client.blocked, false);
});

test('a slow check keeps the launch screen up and remembers the latest request; a direct game URL asks for no screen', async () => {
  let answer; const slow = new Promise(r => { answer = r; });
  const l = launch({ '/api/auth/config': () => slow, '/api/auth/session': { user: USER, csrf: 'x', expires: Date.now() + 864e5, migrated: true, progress: {} } });
  l.menu.show('settings');
  await tick(30); assert.deepEqual(l.log, [], 'still checking: nothing rendered');
  answer(ok(GOOGLE)); await settle(l);
  assert.deepEqual(l.log, ['settings', 'BOOT DONE'], 'the latest request wins');
  const direct = launch({ '/api/auth/config': GOOGLE, '/api/auth/session': { user: USER, csrf: 'x', expires: Date.now() + 864e5, migrated: true, progress: {} } }, { request: null });
  await settle(direct); assert.deepEqual(direct.log, ['BOOT DONE'], 'a race straight from the URL: no menu screen is forced on it');
});

test('the launch screen is one static kit screen in index.html; the old ad-hoc Athens prompt is gone', async () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8'), { syncLayouts, bootMarkup } = await import('./sync-loading-layout.mjs');
  assert.equal(syncLayouts(html), html, 'run node tools/sync-loading-layout.mjs');
  assert.match(bootMarkup(), /id="boot"[^]*class="scr [^"]*layout--sheet-list-narrow/, 'built by the kit\'s sheetList');
  assert.match(bootMarkup(), /class="progress boot__bar"/); assert.doesNotMatch(bootMarkup(), /dialog/);
  assert.ok(html.indexOf('id="boot"') < html.indexOf('<div id="ui">'), 'painted before the menu root');
  const athens = readFileSync(new URL('../src/athens-world.js', import.meta.url), 'utf8');
  assert.doesNotMatch(athens, /SIGN IN TO DRIVE/, 'the Athens world no longer has its own sign-in prompt');
  assert.match(athens, /if\(account\.blocked\)\{location\.replace\('\/\?menu=1'\);return;\}/);
  const css = readFileSync(new URL('../src/ui/ui.css', import.meta.url), 'utf8');
  assert.match(css, /html\[data-device="blocked"\] body > :not\(#device-gate\)\s*\{\s*display:\s*none\s*!important/, 'a blocked device never sees it');
});

// Lead 2026-10-20: the signed-in launch must not wait on the check. The check starts with the page (src/entry.js) and a
// recent sign-in on this device goes straight to the title; the server's answer still decides.
const HINT = { id: 'u1', displayName: 'ATHENA', expires: Date.now() + 864e5 };
const SESSION = { user: USER, csrf: 'x', expires: Date.now() + 864e5, migrated: true, progress: {} };
test('a recent sign-in goes straight to the title while the check runs; the answer only confirms it', async () => {
  let answer; const slow = new Promise(r => { answer = r; });
  const l = launch({ '/api/auth/config': GOOGLE, '/api/auth/session': () => slow }, { hint: HINT });
  await tick(5);
  assert.deepEqual(l.log, ['title', 'BOOT DONE'], 'the title is up before the server has answered');
  answer(ok(SESSION)); await settle(l, () => l.client.ready); await tick(20);
  assert.deepEqual(l.log, ['title', 'BOOT DONE'], 'confirmed: nothing changes');
  assert.equal(l.client.blocked, false);
});
test('a recent sign-in the server rejects falls back to the sign-in dialog', async () => {
  const l = launch({ '/api/auth/config': GOOGLE, '/api/auth/session': { user: null } }, { hint: HINT });
  await settle(l, () => l.log.includes('signIn'));
  assert.deepEqual(l.log, ['title', 'BOOT DONE', 'signIn'], OWNER);
  assert.equal(l.client.blocked, true);
  const again = launch({ '/api/auth/config': GOOGLE, '/api/auth/session': { user: null } }, { hint: null });
  await settle(again); assert.deepEqual(again.log, ['signIn', 'BOOT DONE'], 'the hint is gone after a rejection');
});
test('no optimism for an expired hint or while the browser is offline: the launch waits for the answer as before', async () => {
  const expired = launch({ '/api/auth/config': GOOGLE, '/api/auth/session': { user: null } }, { hint: { ...HINT, expires: Date.now() - 1 } });
  await settle(expired); assert.deepEqual(expired.log, ['signIn', 'BOOT DONE']);
  const nav = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { value: { onLine: false }, configurable: true, writable: true });
  try {
    const offline = launch({ '/api/auth/config': Object.assign(new TypeError('Failed to fetch'), { name: 'TypeError' }) }, { hint: HINT });
    assert.deepEqual(offline.log, [], 'offline: no title first');
    await settle(offline); assert.deepEqual(offline.log, ['signIn', 'BOOT DONE']);
  } finally { if (nav) Object.defineProperty(globalThis, 'navigator', nav); else delete globalThis.navigator; }
});
test('the answers the page entry already asked for are used, not asked for again', async () => {
  globalThis.__authPrefetch = { '/api/auth/config': Promise.resolve({ status: 200, ok: true, body: GOOGLE }), '/api/auth/session': Promise.resolve({ status: 200, ok: true, body: SESSION }) };
  const calls = [], l = launch({}, { calls });
  try {
    await settle(l);
    assert.deepEqual(l.log, ['title', 'BOOT DONE']);
    assert.ok(!calls.includes('/api/auth/config') && !calls.includes('/api/auth/session'), `fetched again: ${calls}`);
  } finally { delete globalThis.__authPrefetch; }
  const entry = readFileSync(new URL('../src/entry.js', import.meta.url), 'utf8');
  assert.ok(entry.indexOf("__authPrefetch") < entry.indexOf("await import('./game-entry.js')"), 'the check starts before the game loads');
});
