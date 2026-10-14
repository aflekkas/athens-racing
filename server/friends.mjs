// Friends, blocks and recent players. Keyed by stable internal ID everywhere, so
// renames never orphan the graph; usernames resolve at the edges for
// display, plates and search. Presence itself is NOT stored: the caller
// injects presenceOf(subs) — in production the arena core derives it live
// from WebSocket connections (see docs/multiplayer-cost.md for why that
// costs zero extra Durable Object requests).
//
// Request lifecycle: request -> pending; accept -> accepted; decline/remove
// delete the row. request() auto-accepts when the reverse row is pending.
// block() deletes any rows both directions and hides both users from search.
// All mutations return the affected subs so the caller can push live
// presence/friend snapshots and toasts over the existing WebSocket.
const fail = (message, status) => { throw Object.assign(new Error(message), { status }); };

const profileOf = (row) => ({ username: row.username, displayName: row.displayName, avatarUrl: row.avatarUrl || '' });

export function createFriendService(store, { now = () => Date.now(), presenceOf = () => new Map() } = {}) {
  const named = (sub) => {
    const row = sub ? store.getUserBySub(sub) : null;
    if (!row) fail('Sign in first.', 401);
    if (!row.username) fail('Pick a username first.', 403);
    return row;
  };
  const byUsername = (username) => {
    const row = store.getUserByKey(username);
    if (!row || !row.username) fail('Unknown driver.', 404);
    return row;
  };
  const relationOf = (me, peer, rows) => {
    const out = rows.find((r) => (r.from === me && r.to === peer) || (r.from === peer && r.to === me));
    if (!out || out.status !== 'pending' && out.status !== 'accepted') return 'none';
    if (out.status === 'accepted') return 'friend';
    return out.from === me ? 'outgoing' : 'incoming';
  };

  return {
    peers(sub) {
      const out = new Set();
      for (const r of store.requestsFor(sub)) out.add(r.from === sub ? r.to : r.from);
      return [...out];
    },
    search(viewerSub, query, limit = 20, presence = null) {
      const me = named(viewerSub);
      const q = String(query || '').trim();
      if (q.length < 1) return [];
      const rows = store.requestsFor(me.sub);
      const live = presence || presenceOf(store.searchUsers(q, limit).map((u) => u.sub));
      return store.searchUsers(q, limit)
        .filter((u) => u.sub !== me.sub && !store.isBlocked(me.sub, u.sub))
        .map((u) => ({ ...profileOf(u), relation: relationOf(me.sub, u.sub, rows), presence: live.get(u.sub) || { online: false } }));
    },
    request(fromSub, username) {
      const me = named(fromSub), peer = byUsername(username);
      if (peer.sub === me.sub) fail('You cannot friend yourself.', 400);
      if (store.isBlocked(me.sub, peer.sub)) fail('Driver unavailable.', 403);
      const reverse = store.getRequest(peer.sub, me.sub);
      if (reverse?.status === 'accepted' || store.getRequest(me.sub, peer.sub)?.status === 'accepted') fail('Already friends.', 409);
      if (reverse?.status === 'pending') {
        reverse.status = 'accepted'; reverse.updatedAt = now(); store.saveRequest(reverse);
        return { accepted: true, friend: profileOf(peer), affected: [me.sub, peer.sub] };
      }
      if (store.getRequest(me.sub, peer.sub)?.status === 'pending') fail('Request already sent.', 409);
      store.saveRequest({ from: me.sub, to: peer.sub, status: 'pending', updatedAt: now() });
      return { requested: true, friend: profileOf(peer), affected: [me.sub, peer.sub] };
    },
    accept(sub, username) {
      const me = named(sub), peer = byUsername(username);
      const row = store.getRequest(peer.sub, me.sub);
      if (!row || row.status !== 'pending') fail('No pending request.', 404);
      row.status = 'accepted'; row.updatedAt = now(); store.saveRequest(row);
      return { friend: profileOf(peer), affected: [me.sub, peer.sub] };
    },
    decline(sub, username) {
      const me = named(sub), peer = byUsername(username);
      const row = store.getRequest(peer.sub, me.sub);
      if (!row || row.status !== 'pending') fail('No pending request.', 404);
      store.deleteRequest(peer.sub, me.sub);
      return { affected: [me.sub, peer.sub] };
    },
    remove(sub, username) {
      const me = named(sub), peer = byUsername(username);
      const a = store.getRequest(me.sub, peer.sub), b = store.getRequest(peer.sub, me.sub);
      if (a?.status !== 'accepted' && b?.status !== 'accepted') fail('Not friends.', 404);
      if (a) store.deleteRequest(me.sub, peer.sub);
      if (b) store.deleteRequest(peer.sub, me.sub);
      return { affected: [me.sub, peer.sub] };
    },
    block(sub, username) {
      const me = named(sub), peer = byUsername(username);
      if (peer.sub === me.sub) fail('You cannot block yourself.', 400);
      store.deleteRequest(me.sub, peer.sub); store.deleteRequest(peer.sub, me.sub);
      store.addBlock(me.sub, peer.sub);
      return { affected: [me.sub, peer.sub] };
    },
    unblock(sub, username) {
      const me = named(sub), peer = byUsername(username);
      store.removeBlock(me.sub, peer.sub);
      return { affected: [me.sub, peer.sub] };
    },
    list(sub, presence = null) {
      const me = named(sub);
      const rows = store.requestsFor(me.sub);
      const subs = new Set();
      for (const r of rows) subs.add(r.from === me.sub ? r.to : r.from);
      const live = presence || presenceOf([...subs]);
      const resolve = (s) => { const u = store.getUserBySub(s); return u && u.username ? { ...profileOf(u), presence: live.get(s) || { online: false } } : null; };
      const friends = [], incoming = [], outgoing = [];
      for (const r of rows) {
        if (r.status === 'accepted') { const p = resolve(r.from === me.sub ? r.to : r.from); if (p && !friends.some((f) => f.username === p.username)) friends.push(p); }
        else if (r.status === 'pending' && r.to === me.sub) { const u = store.getUserBySub(r.from); if (u?.username) incoming.push(profileOf(u)); }
        else if (r.status === 'pending') { const u = store.getUserBySub(r.to); if (u?.username) outgoing.push(profileOf(u)); }
      }
      friends.sort((a, b) => a.username < b.username ? -1 : 1);
      return { friends, incoming, outgoing };
    },
    recent(sub, limit = 20, presence = null) {
      const me = named(sub);
      const friendSubs = new Set(store.requestsFor(me.sub).filter((r) => r.status === 'accepted').map((r) => (r.from === me.sub ? r.to : r.from)));
      const entries = store.recentFor(me.sub, limit * 2 + 10)
        .filter((e) => e.peer !== me.sub && !friendSubs.has(e.peer) && !store.isBlocked(me.sub, e.peer));
      const live = presence || presenceOf(entries.map((e) => e.peer));
      const out = [];
      for (const e of entries) {
        const u = store.getUserBySub(e.peer);
        if (!u?.username || out.some((p) => p.username === u.username)) continue;
        out.push({ ...profileOf(u), lastSeen: e.at, presence: live.get(e.peer) || { online: false } });
        if (out.length >= limit) break;
      }
      return out;
    },
    // After a validated race, every pair of signed-in racers becomes recent
    // for each other (both directions, Redundant rows collapse by upsert).
    recordMatch(subs, at = now()) {
      const ids = [...new Set((subs || []).filter(Boolean))];
      for (const a of ids) for (const b of ids) if (a !== b) store.touchRecent(a, b, at);
    },
  };
}
