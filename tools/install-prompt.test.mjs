// The add-to-home-screen card's decisions: who is asked, when, and how a dismissal is remembered. Owner request, 2026-10-18.
import test from 'node:test';
import assert from 'node:assert/strict';
import { platformOf, isInstalledApp, planOf, readState, countVisit, snooze, neverAsk, markInstalled, hasRaced, SNOOZE_MS, MIN_VISITS, INSTALL_KEY } from '../src/install-prompt.js';

const memory = (init = {}) => { const m = new Map(Object.entries(init)); return { get length() { return m.size; }, key: i => [...m.keys()][i] ?? null, getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; };
const UA = {
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  iosChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.153 Mobile/15E148 Safari/604.1',
  ipadOs: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  pixel: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
  desktop: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  instagram: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 330.0.0.0',
};
const NOW = Date.UTC(2026, 9, 18, 12);
const engaged = { visits: MIN_VISITS, snoozedUntil: 0, never: false, installed: false };

test('phones and tablets are recognised, desktops and in-app browsers are not asked', () => {
  assert.deepEqual(platformOf({ userAgent: UA.iphone }), { mobile: true, os: 'ios', inApp: false, safari: true });
  assert.equal(platformOf({ userAgent: UA.iosChrome }).safari, false);
  assert.equal(platformOf({ userAgent: UA.iosChrome }).os, 'ios');
  const ipad = platformOf({ userAgent: UA.ipadOs, platform: 'MacIntel', maxTouchPoints: 5 });
  assert.deepEqual([ipad.mobile, ipad.os, ipad.safari], [true, 'ios', true]);
  assert.equal(platformOf({ userAgent: UA.ipadOs, platform: 'MacIntel', maxTouchPoints: 0 }).mobile, false, 'a real Mac');
  assert.deepEqual([platformOf({ userAgent: UA.pixel }).mobile, platformOf({ userAgent: UA.pixel }).os], [true, 'android']);
  assert.equal(platformOf({ userAgent: UA.desktop }).mobile, false);
  assert.equal(platformOf({ userAgent: UA.desktop, coarse: true }).mobile, false, 'a touch laptop is still a desktop');
  assert.equal(platformOf({ userAgent: UA.instagram }).inApp, true);
  assert.equal(planOf({ platform: platformOf({ userAgent: UA.instagram }), state: engaged, now: NOW }), null, 'an in-app browser cannot add to the home screen');
});

test('an installed app (any display mode, or navigator.standalone) never sees the card', () => {
  const mm = (on) => (q) => ({ matches: q.includes(on) });
  assert.equal(isInstalledApp({ matchMedia: mm('standalone') }), true);
  assert.equal(isInstalledApp({ matchMedia: mm('fullscreen') }), true);
  assert.equal(isInstalledApp({ navigatorStandalone: true, matchMedia: mm('nothing') }), true);
  assert.equal(isInstalledApp({ matchMedia: mm('browser') }), false);
  assert.equal(isInstalledApp({}), false);
  const platform = platformOf({ userAgent: UA.pixel });
  assert.equal(planOf({ platform, installedApp: true, state: engaged, now: NOW, hasPrompt: true }), null);
});

test('which card: install button, iOS share steps, or the browser-menu steps', () => {
  const at = (userAgent, extra = {}) => planOf({ platform: platformOf({ userAgent }), state: engaged, now: NOW, ...extra });
  assert.equal(at(UA.pixel, { hasPrompt: true }), 'install');
  assert.equal(at(UA.pixel), 'menu');
  assert.equal(at(UA.iphone), 'ios');
  assert.equal(at(UA.iosChrome), 'ios');
  assert.equal(at(UA.iphone, { hasPrompt: true }), 'ios');
  assert.equal(at(UA.desktop, { hasPrompt: true }), null);
});

test('only players who have shown up before are asked: a finished race, or a few launches', () => {
  const platform = platformOf({ userAgent: UA.pixel });
  assert.equal(planOf({ platform, state: readState(memory()), now: NOW }), null, 'brand-new visitor');
  assert.equal(planOf({ platform, state: { ...engaged, visits: MIN_VISITS - 1 }, now: NOW }), null);
  assert.equal(planOf({ platform, state: { ...engaged, visits: 1 }, now: NOW, raced: true }), 'menu');
  assert.equal(planOf({ platform, state: engaged, now: NOW }), 'menu');
  assert.equal(hasRaced(memory()), false);
  assert.equal(hasRaced(memory({ 'paraliaki.settings': '{}' })), false, 'settings alone are not a race');
  for (const key of ['paraliaki.personalBests.v1', 'paraliaki.best.mini', 'paraliaki.events.riviera-sprint']) assert.equal(hasRaced(memory({ [key]: '1' })), true, key);
});

test('NOT NOW waits a week, DON\'T ASK AGAIN and installing are forever, all remembered in storage', () => {
  const platform = platformOf({ userAgent: UA.pixel }), s = memory();
  for (let i = 0; i < MIN_VISITS; i++) countVisit(s);
  assert.equal(readState(s).visits, MIN_VISITS);
  const plan = (now) => planOf({ platform, state: readState(s), now });
  assert.equal(plan(NOW), 'menu');
  snooze(s, NOW);
  assert.equal(SNOOZE_MS, 7 * 24 * 3600 * 1000);
  assert.equal(plan(NOW + 1000), null);
  assert.equal(plan(NOW + SNOOZE_MS - 1), null);
  assert.equal(plan(NOW + SNOOZE_MS), 'menu', 'asks again after a week');
  neverAsk(s);
  assert.equal(plan(NOW + 365 * 24 * 3600 * 1000), null);
  const t = memory(); for (let i = 0; i < MIN_VISITS; i++) countVisit(t);
  markInstalled(t);
  assert.equal(planOf({ platform, state: readState(t), now: NOW + 1e12 }), null);
  assert.ok(JSON.parse(t.getItem(INSTALL_KEY)).installed);
});

test('unreadable or blocked storage never throws and never blocks the game', () => {
  const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, get length() { throw new Error('blocked'); }, key() { throw new Error('blocked'); } };
  assert.deepEqual(readState(broken), { visits: 0, snoozedUntil: 0, never: false, installed: false });
  assert.doesNotThrow(() => { snooze(broken); neverAsk(broken); markInstalled(broken); countVisit(broken); });
  assert.equal(hasRaced(broken), false);
  assert.deepEqual(readState(memory({ [INSTALL_KEY]: '{oops' })), { visits: 0, snoozedUntil: 0, never: false, installed: false });
});
