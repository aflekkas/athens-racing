// Username = plate. Device credentials restore the HttpOnly session cookie;
// recovery codes are shown only in memory until the player acknowledges them.
import { formatPlate } from './plate.js';
import * as C from './ui/components.js';

const listeners = new Set();
let cached = null;
const emit = () => { for (const cb of listeners) { try { cb(cached); } catch {} } };
const failure = async (res) => { throw new Error((await res.json().catch(() => ({}))).error || 'Request failed.'); };

const DEVICE_KEY = 'asr.device.v1', INTRO_KEY = 'asr.account-intro.v1';
let recoveryCode = '', loading = null, recoverMode = false;
const storedDevice = () => { try { return localStorage.getItem(DEVICE_KEY) || ''; } catch { return ''; } };
const saveDevice = secret => { try { if (secret) localStorage.setItem(DEVICE_KEY, secret); else localStorage.removeItem(DEVICE_KEY); } catch {} };
const post = async (path, data = {}) => {
  const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  if (!res.ok) await failure(res);
  return res.json();
};
const accept = out => {
  const { deviceSecret, recoveryCode: code, ok, ...profile } = out;
  if (deviceSecret) saveDevice(deviceSecret);
  recoveryCode = code || ''; recoverMode = false;
  cached = { ...profile, guest: false }; emit(); return cached;
};
export const account = {
  cached: () => cached,
  needsOnboarding() { try { return !cached?.username && !localStorage.getItem(INTRO_KEY); } catch { return !cached?.username; } },
  continueAsGuest() { try { localStorage.setItem(INTRO_KEY, 'seen'); } catch {} },
  async get() {
    if (loading) return loading;
    loading = (async () => {
      const res = await fetch('/api/me');
      if (!res.ok) await failure(res);
      let profile = await res.json();
      if (profile.guest && storedDevice()) {
        const restore = await fetch('/api/accounts/device', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deviceSecret: storedDevice() }) });
        if (restore.ok) { const { ok, ...user } = await restore.json(); profile = { ...user, guest: false }; }
        else if (restore.status === 401) saveDevice('');
      }
      if (JSON.stringify(cached) !== JSON.stringify(profile)) { cached = profile; emit(); }
      return cached;
    })();
    try { return await loading; } finally { loading = null; }
  },
  async create(username) { return accept(await post('/api/accounts/create', { username })); },
  async recover(username, code) { return accept(await post('/api/accounts/recover', { username, code })); },
  async regenerateRecovery() {
    const out = await post('/api/accounts/recovery-code'); recoveryCode = out.recoveryCode; emit(); return out;
  },
  async signOut() {
    await post('/auth/logout', { deviceSecret: storedDevice() });
    saveDevice(''); recoveryCode = ''; cached = { guest: true }; emit(); return cached;
  },
  async setUsername(username) {
    const out = await post('/api/username', { username });
    const { ok, ...profile } = out; cached = { ...cached, ...profile, guest: false }; emit(); return out;
  },
  async stats() { const me = cached || await this.get().catch(() => null); return me && !me.guest ? me.stats || null : null; },
  plate() { const u = cached?.username; return u ? formatPlate(u) || null : null; },
  onChange(cb) { listeners.add(cb); return () => listeners.delete(cb); },
  adopt(profile) {
    if (!profile) return;
    const next = { ...(cached || {}), guest: false, ...profile };
    if (JSON.stringify(cached) !== JSON.stringify(next)) { cached = next; emit(); }
  },
};

// Minimal account-screen markup (unstyled hooks for the UI agent):
// data-account="root", data-act account actions,
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
  const usernameField = C.field('USERNAME · PLATE', `<input data-username aria-label="Username" maxlength="16" value="${C.esc(me.username || '')}" placeholder="PICK-A-NAME" autocomplete="username" autocapitalize="characters" spellcheck="false">`,
    { icon: 'tag', note: '3–16 chars A–Z, 0–9 or hyphens. Unique, case-insensitive.', kind: 'account-name', key: 'username' });
  const action = (label, act, primary = false) => C.button({ label, variant: primary ? 'primary' : 'secondary', block: true, attrs: { 'data-act': act } });
  const codePanel = recoveryCode ? `<section class="account-recovery" role="status"><h3>SAVE YOUR RECOVERY CODE</h3><p>Use your username and this code on another device. This code is shown once. Keep it private.</p><code data-recovery-code>${C.esc(recoveryCode)}</code><p>Username: <b>${C.esc(me.username)}</b></p>${action('I SAVED MY CODE', 'recovery-saved', true)}</section>` : '';
  const body = me.guest
    ? C.panel(recoverMode ? 'USE ON ANOTHER DEVICE' : 'CHOOSE YOUR USERNAME', `<p>Your username is your license plate. Keep stats and add friends without an email or password.</p>`
      + usernameField
      + (recoverMode ? C.field('RECOVERY CODE', '<input data-recovery-input aria-label="Recovery code" maxlength="48" placeholder="XXXX-XXXX-…" autocomplete="off" spellcheck="false">') + action('SIGN IN', 'recover-account', true) + action('CREATE A NEW DRIVER', 'create-mode')
        : action('CREATE DRIVER', 'create-account', true) + action('USE ON ANOTHER DEVICE', 'recovery-mode'))
      + '<p class="form-error" data-account-error role="alert"></p>'
      + action('PLAY AS GUEST', 'continue-play')
      + '<p class="note">Guests can race everything. No account needed.</p>', { icon: 'user', attrs: { 'data-account': 'root' } })
    : C.panel('DRIVER ACCOUNT', `<p>Plate <b class="plate-text">${C.esc(formatPlate(me.username))}</b></p>`
      + codePanel
      + (!recoveryCode ? action('CONTINUE TO GAME', 'continue-play', true) : '')
      + usernameField + action('CHANGE USERNAME', 'save-username')
      + '<p class="form-error" data-account-error role="alert"></p>'
      + (!recoveryCode ? action('GENERATE NEW RECOVERY CODE', 'regenerate-code') + '<p class="note">Replaces your old code. Existing devices stay signed in.</p>' : '')
      + tiles + (best ? `<ul class="best-times" data-stats="best">${best}</ul>` : '')
      + action('SIGN OUT', 'signout'), { icon: 'user', attrs: { 'data-account': 'root' } });
  return body;
}

export function bindAccountCard(root, { onToast, onContinue } = {}) {
  const say = onToast || ((text, opts) => C.ui.toast(text, opts));
  let busy = false;
  root.addEventListener('click', async (e) => {
    const el = e.target.closest('[data-act]');
    if (!el || !root.contains(el) || busy) return;
    const act = el.dataset.act, username = () => root.querySelector('[data-username]')?.value || '';
    if (act === 'recovery-mode' || act === 'create-mode') { recoverMode = act === 'recovery-mode'; emit(); return; }
    if (act === 'recovery-saved') { recoveryCode = ''; emit(); return; }
    if (act === 'continue-play') { account.continueAsGuest(); onContinue?.(); return; }
    if (!['create-account', 'recover-account', 'regenerate-code', 'signout', 'save-username'].includes(act)) return;
    busy = true; el.disabled = true;
    try {
      if (act === 'create-account') await account.create(username());
      else if (act === 'recover-account') { await account.recover(username(), root.querySelector('[data-recovery-input]')?.value || ''); say('SIGNED IN · YOUR PLATE IS READY'); }
      else if (act === 'regenerate-code') await account.regenerateRecovery();
      else if (act === 'signout') { await account.signOut(); say('SIGNED OUT · RACING AS GUEST'); }
      else { await account.setUsername(username()); say('PLATE UPDATED', { icon: 'check', tone: 'good' }); }
    } catch (err) {
      const error = root.querySelector('[data-account-error]'); if (error) error.textContent = err.message;
      say(String(err.message || err), { icon: 'warning', tone: 'bad' });
    } finally { busy = false; el.disabled = false; }
  });
}
