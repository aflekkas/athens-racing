// Friends + presence client. Server REST (session cookie) plus live
// WebSocket pushes from the arena core:
//
//   GET  /api/friends                 -> { friends, incoming, outgoing }
//   GET  /api/friends/search?q=       -> [{ username, displayName,
//                                          avatarUrl, relation, presence }]
//   POST /api/friends/request|accept|decline|remove|block|unblock { username }
//   GET  /api/recent                  -> recent opponents with presence
//   WS   { type: 'friends', self, friends, incoming, outgoing } pushed on
//        every relevant change (lobby join/leave/race, login, graph edits).
//   WS   { type: 'notify', kind, … }  -> kind 'friend-request' (with from)
//        or 'friend-accepted' (with by); the client toasts them.
//
// Presence entries: { online, activity: 'menu'|'lobby'|'racing',
//   lobbyCode, lobbyName, mapId, joinable }. joinable is true for a waiting,
//   public, non-full lobby: the client joins with the normal join-by-code
//   path (no invite links). "Friend online" toasts are derived client-side
//   by comparing consecutive snapshots, so the server sends zero extra
//   notifications (see docs/multiplayer-cost.md).
//
// Client API for the UI agent:
//   friends.list()/search(q)/request(u)/accept(u)/decline(u)/remove(u)/
//     block(u)/unblock(u)/recent()
//   friends.cache                     last snapshot (or null)
//   friends.onChange(cb)              subscribe (returns unsubscribe)
//   friends.presenceOf(username)      presence from the last snapshot
//   friends.joinableCode(username)    lobby code or null
//   friends.adopt(snapshot)           apply a WS push (called by multiplayer)
//   friends.notify(data)              toast a WS notify (called by multiplayer)
//   renderFriendsCard(state) / bindFriendsCard(root, hooks): minimal markup
//   on the src/ui kit for the UI agent to polish.
import * as C from './ui/components.js';

const listeners = new Set();
let cache = null;
const emit = () => { for (const cb of listeners) { try { cb(cache); } catch {} } };
const failure = async (res) => { throw new Error((await res.json().catch(() => ({}))).error || 'Request failed.'); };
const post = async (path, body) => {
  const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  if (!res.ok) await failure(res);
  return res.json();
};

const activityText = (p) => !p?.online ? 'OFFLINE' : p.activity === 'racing' ? `RACING · ${(p.mapId || '').toUpperCase()}` : p.activity === 'lobby' ? `IN LOBBY · ${p.lobbyName || p.lobbyCode || ''}` : 'IN MENU';

export const friends = {
  cache: () => cache,
  onChange(cb) { listeners.add(cb); return () => listeners.delete(cb); },
  async list() {
    const res = await fetch('/api/friends');
    if (!res.ok) await failure(res);
    cache = await res.json(); emit();
    return cache;
  },
  async search(q) {
    const res = await fetch('/api/friends/search?q=' + encodeURIComponent(q || ''));
    if (!res.ok) await failure(res);
    return (await res.json()).results || [];
  },
  async recent() {
    const res = await fetch('/api/recent');
    if (!res.ok) await failure(res);
    return (await res.json()).recent || [];
  },
  request: (username) => post('/api/friends/request', { username }),
  accept: (username) => post('/api/friends/accept', { username }),
  decline: (username) => post('/api/friends/decline', { username }),
  remove: (username) => post('/api/friends/remove', { username }),
  block: (username) => post('/api/friends/block', { username }),
  unblock: (username) => post('/api/friends/unblock', { username }),
  presenceOf(username) {
    const u = String(username || '').toUpperCase();
    return cache?.friends?.find((f) => f.username === u)?.presence || { online: false };
  },
  joinableCode(username) {
    const p = this.presenceOf(username);
    return p.online && p.joinable && p.lobbyCode ? p.lobbyCode : null;
  },
  adopt(snapshot) {
    if (!snapshot || snapshot.type !== 'friends') return;
    const prev = new Map((cache?.friends || []).map((f) => [f.username, f.presence?.online]));
    cache = snapshot; emit();
    // Friend-online toasts derive from snapshot transitions, never polling.
    for (const f of snapshot.friends || []) {
      if (f.presence?.online && prev.get(f.username) === false) {
        C.ui.toast(`${f.displayName || f.username} IS ONLINE`, { icon: 'user', tone: 'good' });
      }
    }
  },
  notify(data = {}) {
    if (data.kind === 'friend-request') C.ui.toast(`FRIEND REQUEST · ${data.from || 'A DRIVER'}`, { icon: 'user-plus', tone: 'good' });
    else if (data.kind === 'friend-accepted') C.ui.toast(`${data.by || 'A DRIVER'} ACCEPTED YOUR REQUEST`, { icon: 'check', tone: 'good' });
  },
};

// Minimal friends markup (unstyled hooks for the UI agent):
// data-friends="root", data-act="request|accept|decline|remove|block|
// unblock|search|join|refresh", data-username / data-search attributes.
export function renderFriendsCard(state = {}) {
  const snap = state.snapshot || cache || { friends: [], incoming: [], outgoing: [] };
  const row = (u, acts) => `<div class="friend-row" data-username="${C.esc(u.username)}"><span class="friend-name">${C.esc(u.displayName || u.username)}</span>`
    + `<span class="friend-plate">${C.esc(u.username)}</span>`
    + `<span class="friend-presence" data-presence="${u.presence?.online ? u.presence.activity : 'offline'}">${C.esc(activityText(u.presence))}</span>`
    + `<span class="friend-acts">${acts.map(([act, label]) => `<button type="button" data-act="${act}" data-username="${C.esc(u.username)}">${label}</button>`).join('')}</span></div>`;
  const friendsRows = (snap.friends || []).map((u) => {
    const acts = [['remove', 'REMOVE'], ['block', 'BLOCK']];
    if (u.presence?.joinable) acts.unshift(['join', 'JOIN']);
    return row(u, acts);
  }).join('');
  return C.panel('FRIENDS',
    `<div class="friend-search"><input data-search maxlength="16" placeholder="SEARCH USERNAME" value="${C.esc(state.query || '')}"><button type="button" data-act="search">SEARCH</button><button type="button" data-act="refresh">REFRESH</button></div>`
    + `<div class="friend-results" data-list="results">${(state.results || []).map((u) => row(u, u.relation === 'none' ? [['request', 'ADD']] : [])).join('')}</div>`
    + `<h4>REQUESTS IN (${(snap.incoming || []).length})</h4><div data-list="incoming">${(snap.incoming || []).map((u) => row(u, [['accept', 'ACCEPT'], ['decline', 'DECLINE']])).join('') || '<p class="note">No pending requests.</p>'}</div>`
    + `<h4>FRIENDS (${(snap.friends || []).length})</h4><div data-list="friends">${friendsRows || '<p class="note">No friends yet. Search a username or add drivers from a lobby.</p>'}</div>`
    + `<h4>RECENT OPPONENTS</h4><div data-list="recent">${(state.recent || []).map((u) => row(u, [['request', 'ADD']])).join('') || '<p class="note">Race online to meet drivers.</p>'}</div>`,
    { icon: 'users', attrs: { 'data-friends': 'root' } });
}

export function bindFriendsCard(root, { onJoin, onToast } = {}) {
  const say = onToast || ((text, opts) => C.ui.toast(text, opts));
  const act = async (name, username) => {
    try {
      if (name === 'join') { onJoin?.(username); return; }
      await friends[name](username);
      await friends.list().catch(() => {});
      say('FRIENDS UPDATED', { icon: 'check', tone: 'good' });
    } catch (err) { say(String(err.message || err).toUpperCase(), { icon: 'warning', tone: 'bad' }); }
  };
  root.addEventListener('click', async (e) => {
    const el = e.target.closest('[data-act]');
    if (!el || !root.contains(el)) return;
    const name = el.dataset.act;
    if (name === 'search') {
      const q = root.querySelector('[data-search]')?.value || '';
      const results = await friends.search(q).catch((err) => { say(String(err.message || err).toUpperCase(), { icon: 'warning', tone: 'bad' }); return null; });
      if (results) { root.querySelector('[data-list="results"]').innerHTML = results.map((u) => `<div class="friend-row" data-username="${C.esc(u.username)}"><span class="friend-name">${C.esc(u.displayName || u.username)}</span><span class="friend-acts">${u.relation === 'none' ? `<button type="button" data-act="request" data-username="${C.esc(u.username)}">ADD</button>` : `<span>${C.esc(u.relation.toUpperCase())}</span>`}</span></div>`).join(''); }
      return;
    }
    if (name === 'refresh') { await friends.list().catch((err) => say(String(err.message || err).toUpperCase(), { icon: 'warning', tone: 'bad' })); return; }
    if (el.dataset.username) act(name, el.dataset.username);
  });
}
