import { guestProgress, restoreProgress } from "./account-progress.js";
export { guestProgress, restoreProgress } from "./account-progress.js";
const localStorageOrNull = () => {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
};
export const offlineAllowed = (error, online = true) =>
  !online ||
  error?.status >= 500 ||
  error?.name === "TypeError" ||
  error?.name === "TimeoutError" ||
  error?.name === "AbortError" ||
  error?.name === "SyntaxError" ||
  error?.status === 404;
// After a good check the client keeps a small hint of who is signed in (never the token: the session cookie is HttpOnly).
// While it is unexpired and the browser is online, the launch goes straight to the title and checks in the background; the
// server's answer still decides (owner 2026-10-20: the signed-in launch must not wait on the check).
const HINT = "paraliaki.sessionHint";
function readHint(storage) {
  try {
    const h = JSON.parse(storage?.getItem(HINT) || "null");
    return h && typeof h.id === "string" && typeof h.displayName === "string" && h.displayName && Number.isFinite(h.expires) && h.expires > Date.now() + 60000 ? h : null;
  } catch { return null; }
}
/** an answer the page entry already asked for (src/entry.js starts the launch check alongside loading the game), used once */
function prefetched(path) {
  const all = globalThis.__authPrefetch, answer = all?.[path];
  if (answer) delete all[path];
  return answer || null;
}
export class AccountsClient {
  constructor({
    fetcher = fetch,
    storage = localStorageOrNull(),
    onChange = () => {},
    onInvite = () => {},
  } = {}) {
    this.fetcher = (...args) => fetcher(...args);
    this.storage = storage;
    this.onChange = onChange;
    this.onInvite = onInvite;
    this.user = null;
    this.csrf = null;
    this.providers = [];
    this.required = true; // Unknown config fails closed; only explicit unconfigured config permits local play.
    this.friends = [];
    this.invites = [];
    this.presence = {};
    this.offline = false;
    this.ready = false;
    this.hint = readHint(storage);
  }
  /** before the first answer: a recent sign-in on this device, online, lets the launch show the title while the check runs */
  get optimistic() { return !this.ready && !!this.hint && globalThis.navigator?.onLine !== false; }
  get blocked() { return this.required && (this.ready ? this.offline || !this.user || !this.user.displayName : !this.optimistic); }
  remember(s) {
    try {
      if (s?.user?.displayName && Number.isFinite(s.expires)) this.storage?.setItem(HINT, JSON.stringify({ id: s.user.id, displayName: s.user.displayName, expires: s.expires }));
      else this.storage?.removeItem(HINT);
    } catch {}
  }
  setSession(s) {
    clearTimeout(this.sessionTimer);
    this.user = s.user; this.csrf = s.csrf; this.remember(s);
    const generation = this.sessionGeneration = (this.sessionGeneration || 0) + 1;
    if (s.user && Number.isFinite(s.expires)) {
      const arm = () => {
        this.sessionTimer = setTimeout(() => {
          if (generation !== this.sessionGeneration) return;
          // Timers can fire early or be capped below a long session's deadline.
          if (s.expires > Date.now()) { arm(); return; }
          this.disconnect();
          this.error = "Your session expired. Sign in with Google to continue.";
          this.onChange();
        }, Math.max(0, Math.min(2147483647, s.expires - Date.now())));
        this.sessionTimer?.unref?.();
      };
      arm();
    }
  }
  connectionLost() {
    this.offline = true;
    this.error = "Connect to the internet to sign in with Google, then try again.";
    this.onChange();
  }
  async revalidate() {
    if (!this.required || this.checking) return;
    this.checking = true;
    try {
      const s = await this.api("/api/auth/session");
      if (!s.user) this.disconnect();
      this.setSession(s); this.offline = false;
      this.error = s.user ? "" : "Your session expired. Sign in with Google to continue.";
      this.onChange();
    } catch (e) { this.connectionLost(); }
    finally { this.checking = false; }
  }
  async api(path, data) {
    const early = data === undefined ? prefetched(path) : null;
    const r = early ? await early : await this.fetcher(path, {
      credentials: "same-origin",
      signal: AbortSignal.timeout(8000),
      ...(data === undefined
        ? {}
        : {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-CSRF-Token": this.csrf || "",
            },
            body: JSON.stringify(data),
          }),
    });
    const b = early ? r.body : await r.json();
    if (r.status === 401 && !path.includes("/google/")) {
      this.disconnect();
      this.error = "Your session expired. Sign in with Google to continue.";
      this.onChange();
    }
    if (!r.ok)
      throw Object.assign(new Error(b.error || "Request failed"), {
        status: r.status,
      });
    return b;
  }
  async init() {
    this.offline = false;
    this.error = new URLSearchParams(globalThis.location?.search || "").has("signin_error") ? "Google sign-in was cancelled or failed. Please try again." : "";
    try {
      const config = await this.api("/api/auth/config");
      if (!Array.isArray(config.providers) || typeof config.required !== "boolean") throw new Error("Could not verify sign-in configuration. Please retry.");
      this.providers = config.providers;
      this.required = config.required === true;
      if (!this.providers.length) {
        this.user = null;
        this.csrf = null;
        return;
      }
      const s = await this.api("/api/auth/session");
      this.setSession(s);
      if (this.user) {
        if (!s.migrated)
          await this.api("/api/account/migrate", {
            progress: guestProgress(this.storage),
          });
        else restoreProgress(this.storage, s.progress);
        await this.social();
        this.connect();
      }
    } catch (e) {
      if (offlineAllowed(e, globalThis.navigator?.onLine !== false)) this.connectionLost();
      else this.error = e.message;
    } finally {
      // Entry already drains the body. Drop any unused snapshot (providers[] or failed
      // config) without another GET, waiting on it, or applying an unverified identity.
      prefetched("/api/auth/session")?.catch(() => {});
      this.ready = true;
      this.onChange();
    }
  }
  async social() {
    [this.friends, this.invites] = await Promise.all([
      this.api("/api/account/friends"),
      this.api("/api/account/invites"),
    ]);
    clearTimeout(this.expireTimer);
    const next = Math.min(...this.invites.map((i) => i.expires));
    if (Number.isFinite(next))
      this.expireTimer = setTimeout(
        () => {
          this.invites = this.invites.filter((i) => i.expires > Date.now());
          this.onChange();
        },
        Math.max(1, next - Date.now() + 10),
      );
    this.onChange();
  }
  connect() {
    if (this.ws || !this.user) return;
    const u = new URL("/api/account/presence", location.href);
    u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
    const ws = (this.ws = new WebSocket(u));
    const beat = () => {
      if (ws.readyState === 1) {
        const mp = window.__multiplayer;
        ws.send(
          JSON.stringify({
            type: "heartbeat",
            status:
              window.__flow?.state === "race" || mp?.lobby?.status === "race"
                ? "in-race"
                : "in-menu",
            map: window.__flow?.mapId || null,
            token: mp?.lobby ? mp.token : null,
          }),
        );
      }
    };
    ws.onopen = () => {
      this.presenceOffline = false;
      beat();
      this.timer = setInterval(beat, 25000);
      this.onChange();
    };
    ws.onmessage = (e) => {
      let b;
      try {
        b = JSON.parse(e.data);
      } catch {
        return;
      }
      if (b.type === "presence") {
        this.presence = b.friends;
        this.onChange();
      }
      if (b.type === "social") this.social().catch(() => {});
      if (b.type === "invite") {
        this.social()
          .then(() => this.onInvite())
          .catch(() => {});
      }
    };
    ws.onclose = () => {
      clearInterval(this.timer);
      this.ws = null;
      this.presenceOffline = true;
      this.presence = {};
      this.onChange();
      if (this.user) this.retry = setTimeout(() => this.connect(), 30000);
    };
  }
  disconnect() {
    this.sessionGeneration = (this.sessionGeneration || 0) + 1;
    clearTimeout(this.sessionTimer);
    this.user = null; this.remember(null);
    clearTimeout(this.retry);
    clearTimeout(this.expireTimer);
    clearInterval(this.timer);
    this.ws?.close();
    this.ws = null;
  }
}
