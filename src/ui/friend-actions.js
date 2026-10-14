import { account } from '../account.js';
import { friends } from '../friends.js';
import { ui } from './components.js';

// All opponent surfaces use the public username, never the display name or account ID.
export function createAddFriendButton(username, report = message => ui.toast(message)) {
  const me = account.cached(), target = String(username || '').toUpperCase();
  if (!me || me.guest || !me.username || !/^[A-Z0-9-]{3,16}$/.test(target) || target === me.username.toUpperCase()) return null;
  const button = document.createElement('button'); button.type = 'button'; button.className = 'mp-add-friend';
  button.dataset.friend = target; button.textContent = 'ADD'; button.setAttribute('aria-label', `Add ${target} as a friend`);
  const snapshot = friends.cache();
  if (snapshot?.friends?.some(p => p.username === target)) { button.textContent = 'FRIENDS'; button.disabled = true; }
  else if (snapshot?.outgoing?.some(p => p.username === target)) { button.textContent = 'REQUEST SENT'; button.disabled = true; }
  button.onclick = async () => {
    if (button.disabled) return;
    button.disabled = true; button.textContent = 'SENDING…';
    try { await friends.request(target); button.textContent = 'REQUEST SENT'; report(`Friend request sent to ${target}.`); }
    catch (error) { button.disabled = false; button.textContent = 'ADD'; report(error.message || 'Could not send friend request.'); }
  };
  return button;
}
