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
  }
  get blocked() { return this.required && (!this.ready || this.offline || !this.user || !this.user.displayName); }
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
      this.user = s.user; this.csrf = s.csrf; this.offline = false;
      this.error = s.user ? "" : "Your session expired. Sign in with Google to continue.";
      this.onChange();
    } catch (e) { this.connectionLost(); }
    finally { this.checking = false; }
  }
  async api(path, data) {
    const r = await this.fetcher(path, {
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
    const b = await r.json();
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
      this.user = s.user;
      this.csrf = s.csrf;
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
    this.user = null;
    clearTimeout(this.retry);
    clearTimeout(this.expireTimer);
    clearInterval(this.timer);
    this.ws?.close();
    this.ws = null;
  }
}
