import test from 'node:test';
import assert from 'node:assert/strict';
import { desktopInvite } from '../../src/desktop-navigation.js';
import { selectDesktopInvite } from '../../src/desktop-menu.js';
const lobby = { code: 'ABC123' };
test('hosting shares usable LAN addresses and lobby code instead of a loopback URL', () => {
  const invite = desktopInvite({ mode: 'host', addresses: ['127.0.0.1:17843', '192.168.1.20:17834', '10.2.3.4:17834'], address: '192.168.1.20:17834' }, lobby);
  assert.deepEqual(invite.addresses, ['192.168.1.20:17834', '10.2.3.4:17834']);
  assert.match(invite.text, /ABC123/); assert.match(invite.text, /JOIN LAN GAME/); assert.doesNotMatch(invite.text, /127\.0\.0\.1|localhost|\?lobby/);
  for (const address of ['127.0.0.1:17843', 'localhost:17834', '[::1]:17834', '8.8.8.8:17834', 'https://192.168.1.20:17834', 'http://user:pass@192.168.1.20:17834']) assert.equal(desktopInvite({ mode: 'host', addresses: [address] }, lobby), null);
});
test('joined players share the upstream host rather than their own interface and retain IPv6 LAN addresses', () => {
  const invite = desktopInvite({ mode: 'join', address: 'http://192.168.1.20:17834', addresses: ['10.0.0.7:17844'] }, lobby);
  assert.deepEqual(invite.addresses, ['192.168.1.20:17834']); assert.doesNotMatch(invite.text, /10\.0\.0\.7/);
  assert.deepEqual(desktopInvite({ mode: 'join', address: 'http://[fd00::12]:17834' }, lobby).addresses, ['[fd00::12]:17834']);
  assert.equal(desktopInvite({ mode: 'solo' }, lobby), null); assert.equal(desktopInvite({ mode: 'host', addresses: ['192.168.1.20:17834'] }, { code: '' }), null);
});
test('desktop share action refreshes the real bridge session and selects manual share text without clipboard permissions', async () => {
  let refreshed = 0, focused = 0, selected = 0;
  const field = { focus() { focused++; }, select() { selected++; } };
  const menu = { desktopForm: { session: { mode: 'solo' } }, root: { querySelector: selector => { assert.equal(selector, '[data-desktop-share]'); return field; } }, refresh() { refreshed++; } };
  const session = { mode: 'join', address: 'http://192.168.1.20:17834' };
  const bridge = { session: async () => session, host() {}, join() {}, solo() {} };
  assert.equal(await selectDesktopInvite(menu, { lobby }, bridge), true); assert.equal(menu.desktopForm.session, session); assert.equal(menu.desktopForm.error, ''); assert.equal(refreshed, 1); assert.equal(focused, 1); assert.equal(selected, 1);
  assert.equal(await selectDesktopInvite({ root: {} }, { lobby }, bridge), false);
});

test('created lobby keeps usable LAN address/code and selectable invite while hosted browser keeps its existing invite action', async () => {
  const { renderLobby } = await import('../../src/ui/mp-screens.js');
  const priorDocument = globalThis.document, priorWindow = globalThis.window;
  globalThis.document = { baseURI: 'http://localhost/', querySelector: () => null, body: { classList: { contains: () => false } } }; globalThis.window = {};
  try {
    const mp = { id: 'me', connected: true, worldReady: true, canChangeCar: true, $: () => ({ textContent: 'Connected', value: 'mini' }), cars: [{ id: 'mini', name: 'Mini Cooper S', short: 'MINI', power: 141, drive: 'fwd' }], maps: [{ id: 'riviera', name: 'ATHENS RIVIERA' }], me: { id: 'me', car: 'mini' }, lobby: { host: 'me', code: 'ABC123', name: 'LAN RACE', status: 'race', mapId: 'riviera', mode: 'sprint', players: [{ id: 'me', name: 'LOCAL', car: 'mini', loaded: true }], config: {} } };
    const html = renderLobby({ desktopForm: { session: { mode: 'host', addresses: ['192.168.1.20:17834'] } } }, mp);
    assert.match(html, /data-desktop-room-address/); assert.match(html, /192\.168\.1\.20:17834/); assert.match(html, /ABC123/); assert.match(html, /readonly[^>]*data-desktop-share/); assert.match(html, /SHARE DETAILS/); assert.doesNotMatch(html, /127\.0\.0\.1/);
    const hosted = renderLobby({}, mp); assert.match(hosted, /INVITE/); assert.doesNotMatch(hosted, /data-desktop-room-address|data-desktop-share|SHARE DETAILS/);
  } finally { globalThis.document = priorDocument; globalThis.window = priorWindow; }
});
