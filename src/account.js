// Account client: Google sign-in, username (= license plate), stats.
//
// Server API (Cloudflare Worker; the Node VPS server answers /api/me with
// { guest: true } and 501 guest-only on the rest):
//   GET  /auth/google/start?next=/   -> 302 to Google (code + PKCE, see
//                                        worker/oidc.mjs). Returns 501 JSON
//                                        when GOOGLE_CLIENT_ID is unset.
//   GET  /auth/google/callback       -> verifies the ID token vs Google JWKS,
//                                        sets the HttpOnly session cookie,
//                                        302 back to ?login=… on failure.
//   POST /auth/logout                -> revokes the session, clears cookie.
//   GET  /api/me                     -> { guest: true } or the profile:
//                                        { username (''
//                                        while unpicked), displayName,
//                                        avatarUrl, stats, pendingRequests }
//   POST /api/username { username }  -> claims/changes the USERNAME
//                                        (3-16 chars A-Z 0-9 -; unique).
//   POST /api/auth/ticket            -> { ticket, expiresIn } single-use
//                                        60 s ticket for { type: 'auth' }.
// WebSocket: after hello the client fetches a ticket and sends
//   { type: 'auth', ticket }; the handshake cookie usually links it first.
//   The server replies { type: 'account', account } and pushes
//   { type: 'friends', … } snapshots (see src/friends.js).
//
// Client API for the UI agent:
//   account.get()         -> profile or { guest: true } (network, cached)
//   account.cached()      -> last known without network
//   account.signIn(next)  -> redirect into Google (full page)
//   account.signOut()     -> POST logout, back to guest
//   account.setUsername() -> claim/change username, throws Error(message)
//   account.stats()       -> stats object or null for guests
//   account.plate()       -> username formatted for the plate, or null
//   account.onChange(cb)  -> subscribe (returns unsubscribe)
//   renderAccountCard(state) / bindAccountCard(root, hooks): minimal
//   account-screen markup on the src/ui kit for the UI agent to polish.
import { formatPlate } from './plate.js';
import * as C from './ui/components.js';

const listeners = new Set();
let cached = null;
const emit = () => { for (const cb of listeners) { try { cb(cached); } catch {} } };
const failure = async (res) => { throw new Error((await res.json().catch(() => ({}))).error || 'Request failed.'); };

export const account = {
  cached: () => cached,
  async get() {
    const res = await fetch('/api/me');
    if (!res.ok) await failure(res);
    cached = await res.json(); emit();
    return cached;
  },
  signIn(next = '/') { location.href = '/auth/google/start?next=' + encodeURIComponent(next); },
  async signOut() {
    await fetch('/auth/logout', { method: 'POST' }).catch(() => {});
    cached = { guest: true }; emit();
    return cached;
  },
  async setUsername(username) {
    const res = await fetch('/api/username', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username }) });
    if (!res.ok) await failure(res);
    const out = await res.json();
    cached = { ...(cached || {}), username: out.username, displayName: out.displayName, stats: out.stats || cached?.stats }; emit();
    return out;
  },
  async stats() { const me = cached || await this.get().catch(() => null); return me && !me.guest ? me.stats || null : null; },
  plate() { const u = cached?.username; return u ? formatPlate(u) || null : null; },
  onChange(cb) { listeners.add(cb); return () => listeners.delete(cb); },
  adopt(profile) {
    if (!profile) return;
    cached = { ...(cached || {}), guest: false, ...profile }; emit();
  },
};

// Minimal account-screen markup (unstyled hooks for the UI agent):
// data-account="root", data-act="signin|signout|save-username",
// data-username input, data-recovery-note, data-stats.
export function renderAccountCard(state = {}) {
  const me = state.me || cached || { guest: true };
  const stats = me.stats;
  const tiles = stats ? C.stats([
    ['RACES', String(stats.started ?? 0), { icon: 'flag-checkered' }],
    ['FINISHES', String(stats.finished ?? 0), { icon: 'check' }],
    ['WINS', String(stats.wins ?? 0), { icon: 'trophy' }],
    ['PODIUMS', String(stats.podiums ?? 0), { icon: 'medal' }],
    ['DNF', String(stats.dnfs ?? 0), { icon: 'warning' }],
    ['KM DRIVEN', Number(stats.km ?? 0).toFixed(1), { icon: 'gauge' }],
    ['FAVOURITE CAR', C.esc(String(stats.favouriteCar || '—').toUpperCase()), { icon: 'car' }],
  ]) : '';
  const best = stats?.best ? Object.entries(stats.best).slice(0, 6).map(([k, t]) =>
    `<li><span>${C.esc(k)}</span><b class="tnum">${Number(t).toFixed(2)} s</b></li>`).join('') : '';
  const body = me.guest
    ? C.panel('DRIVER ACCOUNT', `<p>Sign in with Google to keep stats, race under your own plate and add friends. Guests race as <b>GUEST</b>.</p>`
      + C.button({ label: 'SIGN IN WITH GOOGLE', icon: 'sign-in', variant: 'primary', block: true, attrs: { 'data-act': 'signin' } })
      + `<p class="note">Guests can race everything. Accounts, stats and friends need sign-in.</p>`, { icon: 'user', attrs: { 'data-account': 'root' } })
    : C.panel('DRIVER ACCOUNT', `<p>Signed in as <b>${C.esc(me.displayName || me.username)}</b></p>`
      + (me.username ? `<p>Plate <b class="plate-text">${C.esc(formatPlate(me.username))}</b></p>` : '')
      + C.field('USERNAME · PLATE', `<input data-username maxlength="16" value="${C.esc(me.username || '')}" placeholder="PICK-A-NAME" autocomplete="nickname">`,
        { icon: 'tag', note: '3–16 chars A–Z 0–9 -. Unique, case-insensitive.', kind: 'account-name', key: 'username' })
      + C.button({ label: me.username ? 'CHANGE USERNAME' : 'CLAIM USERNAME', icon: 'check', variant: 'primary', block: true, attrs: { 'data-act': 'save-username' } })
      + (state.error ? `<p class="form-error" role="alert">${C.esc(state.error)}</p>` : '')
      + tiles + (best ? `<ul class="best-times" data-stats="best">${best}</ul>` : '')
      + C.button({ label: 'SIGN OUT', icon: 'sign-out', variant: 'ghost', block: true, attrs: { 'data-act': 'signout' } }), { icon: 'user', attrs: { 'data-account': 'root' } });
  return body;
}

export function bindAccountCard(root, { onToast } = {}) {
  const say = onToast || ((text, opts) => C.ui.toast(text, opts));
  root.addEventListener('click', async (e) => {
    const el = e.target.closest('[data-act]');
    if (!el || !root.contains(el)) return;
    const act = el.dataset.act;
    if (act === 'signin') account.signIn(location.pathname + location.search);
    else if (act === 'signout') { await account.signOut(); say('SIGNED OUT · RACING AS GUEST', { icon: 'sign-out' }); }
    else if (act === 'save-username') {
      const input = root.querySelector('[data-username]');
      try { await account.setUsername(input?.value || ''); say('PLATE UPDATED', { icon: 'check', tone: 'good' }); }
      catch (err) { say(String(err.message || err).toUpperCase(), { icon: 'warning', tone: 'bad' }); }
    }
  });
}
