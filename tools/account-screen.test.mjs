// Account + sign-in screens on the shared component set (docs/OWNER-DECISIONS.md, 2026-10-16).
import test from 'node:test';
import assert from 'node:assert/strict';
const { renderAccount, renderSignIn } = await import('../src/ui/account-screen.js');
const base = () => ({ ready: true, providers: ['google'], error: '', presence: { f1: { status: 'in-menu' } }, invites: [],
  user: { id: 'me', displayName: 'GR-4821', plate: 'IKA 1920' }, friends: [{ id: 'f1', display_name: 'ELENI', state: 'accepted' }] });

test('account: name + plate, one Save disabled until a change, friends on top with an inline Add', () => {
  const html = renderAccount(base());
  assert.equal([...html.matchAll(/data-act="account-profile"/g)].length, 1, 'one Save button');
  assert.match(html, /account-save[^>]*aria-disabled="true"/, 'Save starts disabled');
  assert.match(html, /class="plate /, 'the plate is drawn as a plate');
  assert.match(html, /plate-input/, 'the plate field is plate-styled');
  assert.match(html, /field--stack/, 'labels sit above their fields (no truncated DISPLA…)');
  assert.match(html, /placeholder="Driver name"/); assert.match(html, /data-act="account-friend-request"/);
  assert.ok(html.indexOf('FRIENDS') < html.indexOf('Driver name'), 'the friends list comes before the add field');
  assert.match(html, /chip--good[^>]*><span>ONLINE/, 'online state on each friend');
  assert.doesNotMatch(html, /ACTIVITY|REQUESTS|LOBBY INVITES/, 'no empty activity panels');
  for (const act of ['account-export', 'account-logout', 'account-delete']) assert.match(html, new RegExp(`data-act="${act}"`));
  assert.match(html, /option--danger[^"]*" role="button" data-act="account-delete"/, 'Delete is marked destructive');
});

test('account: one Activity list for requests and invites, only when non-empty', () => {
  const a = base(); a.friends.push({ id: 'f2', display_name: 'MARIA', state: 'pending', recipient: 'me' }); a.invites = [{ id: 'i1', display_name: 'NIKOS', lobby: 'ATH123', expires: Date.now() + 60000 }];
  const html = renderAccount(a);
  assert.equal([...html.matchAll(/ACTIVITY/g)].length, 1);
  assert.match(html, /data-act="account-friend-accept"/); assert.match(html, /data-act="account-join"/);
});

test('sign-in is the kit Dialog over the title screen with the Google button and Play offline', () => {
  const menu = { r_title: () => '<div class="scr scr--title">TITLE</div>' };
  const html = renderSignIn({ ...base(), user: null }, menu);
  assert.match(html, /class="dialog-under" inert/); assert.match(html, /TITLE/);
  assert.match(html, /role="dialog" aria-modal="true"/); assert.match(html, /SIGN IN TO ATHENS RACING/);
  assert.match(html, /btn--google[^>]*>\s*<svg class="btn__logo"[\s\S]*#EA4335[\s\S]*#4285F4[\s\S]*#FBBC05[\s\S]*#34A853[\s\S]*Continue with Google/, 'the multicolour G sits left of the standard label');
  assert.match(html, /data-act="account-offline"[\s\S]*PLAY OFFLINE/); assert.match(html, /href="\/privacy"/); assert.match(html, /href="\/terms"/);
  assert.doesNotMatch(html, /YOUR PLACE ON THE GRID|One driver\. Every road\./, 'the old full sign-in page is gone');
});
