import { privacyLink, legalLinks } from './legal-links.js';
import * as C from "./components.js";
import { AccountsClient } from "../accounts-client.js";
import { driverName } from "../driver-name.js";
const { esc } = C;
const btn = (label, act, attrs = {}, variant = "secondary", extra = {}) =>
  C.button({ label, act, attrs, variant, ...extra });
const field = (name, label, value = "", extra = {}, opts = {}) =>
  C.textField({ name: "account-" + name, label, value, inputAttrs: extra, cls: "field--stack", ...opts });
// The official multicolour Google "G" (Google Identity sign-in branding), inline so it never waits on a request.
const GOOGLE_G = '<svg class="btn__logo" viewBox="0 0 48 48" aria-hidden="true" focusable="false"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>';
/** Sign-in: the kit Dialog over the dimmed title screen (owner-approved exception, docs/OWNER-DECISIONS.md 2026-10-16). */
export function renderSignIn(a, menu) {
  const actions = `${!a.ready ? C.spinner() : ""}${a.providers.includes("google") ? C.button({ label: "CONTINUE WITH GOOGLE", logo: GOOGLE_G, variant: "google", block: true, act: "account-oauth", attrs: { "data-default": "" } }) : C.button({ label: "RETRY CONNECTION", act: "account-retry", block: true, variant: "primary" })}`;
  return C.dialog({ fullScreen: true,
    under: menu?.r_title?.() || "",
    title: "SIGN IN",
    body: `<p>Sign in with Google to race. You need to be online.</p>${a.error ? `<p class="account-error" role="status">${esc(a.error)}</p>` : ""}`,
    actions,
    foot: `${privacyLink}<a class="mi legal-link" href="/terms" target="_blank" rel="noopener">Terms of service</a>`,
  });
}
export function renderProfile(a) {
  return C.sheetList({ variant: "narrow",
    cls: "scr--account",
    back: false,
    kick: "WELCOME TO ATHENS",
    title: "PICK YOUR IDENTITY",
    rows: C.panel(
      "DRIVER PROFILE",
      `<p class="group__note">Choose a unique driver name and a plate. Your local progress is already safe.</p>${field("name", "DRIVER NAME", a.user?.displayName || driverName.get(), { maxlength: 16, autocapitalize: "characters" })}${field("plate", "PLATE", a.user?.plate || driverName.get(), { maxlength: 10, autocapitalize: "characters" }, { inputCls: "plate-input" })}<div class="field-actions">${btn("SAVE & HIT THE ROAD", "account-profile", { "data-default": "" }, "primary")}</div><p role="status" class="account-error">${esc(a.error || "")}</p>`,
    ),
  });
}
const presenceChip = (a, f) => {
  const p = a.presence[f.id];
  return p?.status === "in-race"
    ? C.chip(`IN RACE · ${esc(p.map || "ATHENS").toUpperCase()}`, { tone: "accent" })
    : p?.status === "in-menu"
      ? C.chip("ONLINE", { tone: "good" })
      : C.chip("OFFLINE");
};
const online = (a, f) => !!a.presence[f.id]?.status && a.presence[f.id].status !== "offline";
export function renderAccount(a) {
  a.invites = a.invites.filter((i) => i.expires > Date.now());
  if (!a.user) return renderSignIn(a);
  const friends = a.friends.filter((f) => f.state === "accepted").sort((x, y) => online(a, y) - online(a, x)),
    requests = a.friends.filter((f) => f.state === "pending");
  const sm = (label, act, attrs, variant = "secondary") => C.button({ label, act, attrs, variant, size: "sm" });
  const friendRows = friends.length
    ? friends.map((f) => C.listRow({ icon: "user", title: esc(f.display_name), focusable: false, go: false,
        meta: `${presenceChip(a, f)}${online(a, f) ? sm("INVITE", "account-invite", { "data-user": f.id }) : ""}${sm("BLOCK", "account-friend-block", { "data-name": f.display_name }, "ghost")}` })).join("")
    : '<p class="group__note">Add a friend by driver name to race together.</p>';
  const activity = [
    ...requests.map((f) => C.listRow({ icon: "user-plus", title: esc(f.display_name), desc: f.recipient === a.user.id ? "WANTS TO BE FRIENDS" : "REQUEST SENT", focusable: false, go: false,
      meta: f.recipient === a.user.id ? sm("ACCEPT", "account-friend-accept", { "data-name": f.display_name }, "primary") + sm("DECLINE", "account-friend-decline", { "data-name": f.display_name }, "ghost") : sm("BLOCK", "account-friend-block", { "data-name": f.display_name }, "ghost") })),
    ...a.invites.map((i) => C.listRow({ icon: "flag", title: esc(i.display_name), desc: `LOBBY ${esc(i.lobby)} · EXPIRES IN 2 MIN`, focusable: false, go: false,
      meta: sm("JOIN", "account-join", { "data-id": i.id }, "primary") + sm("DECLINE", "account-decline", { "data-id": i.id }, "ghost") })),
  ];
  const profile = `<div class="account-id">${C.plate(a.user.plate || a.user.displayName || "")}</div>
    ${field("name", "DRIVER NAME", a.user.displayName || "", { maxlength: 16, autocapitalize: "characters", "data-initial": a.user.displayName || "" })}
    ${field("plate", "PLATE", a.user.plate || "", { maxlength: 10, autocapitalize: "characters", "data-initial": a.user.plate || "" }, { inputCls: "plate-input" })}
    <div class="field-actions">${btn("SAVE", "account-profile", {}, "primary", { size: "sm", disabled: true, cls: "account-save" })}</div><p class="account-error" role="status">${esc(a.error || "")}</p>`;
  const manage = `<h3 class="group__title">ACCOUNT</h3>${C.option({ icon: "share", title: "EXPORT MY DATA", act: "account-export" })}${C.option({ icon: "log-out", title: "SIGN OUT", act: "account-logout" })}${C.option({ icon: "trash", title: "DELETE ACCOUNT", act: "account-delete", cls: "option--danger" })}`;
  return C.sidebarContent({ variant: "balanced",
    cls: "scr--account",
    kick: "YOUR DRIVER ACCOUNT",
    title: "ACCOUNT",
    hints: [["select", "SELECT"], ["confirm", "OK"], ["back", "BACK"]],
    nav: C.panel("PROFILE", profile + manage, { icon: "user", cls: "account-profile" }),
    content: `${C.panel("FRIENDS", `${a.presenceOffline ? '<p class="group__note">Live status is reconnecting…</p>' : ""}<div class="account-friends">${friendRows}</div><div class="account-add">${C.searchField({ name: "account-friend", label: "Add a friend by driver name", placeholder: "Driver name", icon: "user-plus" })}${btn("ADD", "account-friend-request", {}, "primary", { size: "sm" })}</div>`, { icon: "users" })}${activity.length ? C.panel("ACTIVITY", activity.join(""), { icon: "menu" }) : ""}`,
  });
}
export function renderPrivacy() {
  return C.sheetList({ variant: "flow",
    cls: "scr--account",
    kick: "PRIVACY",
    title: "YOUR DATA, YOUR CONTROL",
    rows: C.panel(
      "ATHENS RACING ACCOUNTS",
      `<p>Google sign-in connects your driver account, imported progress and friends. Accepted friends can see your online status. In Account, export your data or delete your account; separate leaderboard records and device storage remain.</p><p>Read the ${privacyLink} for the full details and contact information.</p>${legalLinks}`,
    ),
  });
}
export function install(menu, existing) {
  const callbacks = {
    onChange: () => {
      if (a.blocked) { C.ui.closePrompt(); C.ui.closeListbox(); }
      if (a.user?.displayName)
        try {
          driverName.set(a.user.displayName);
        } catch {}
      if (!a.blocked && ["signIn", "accountName"].includes(menu.screen)) menu.show("title");
      if (["signIn", "account", "accountName"].includes(menu.screen))
        menu.refresh();
      if (a.blocked)
        menu.show(a.user && !a.offline ? "accountName" : "signIn");

    },
    onInvite: () => {
      C.ui.toast("LOBBY INVITE RECEIVED · Open Account from the pause menu", {
        id: "lobby-invite", group: "lobby-invite",
        icon: "users",
        ms: 7000,
      });
    },
  };
  const a = menu.accounts = existing || new AccountsClient(callbacks);
  if (existing) Object.assign(a, callbacks);
  const show = menu.show.bind(menu),
    hide = menu.hide.bind(menu),
    act = menu.activate.bind(menu),
    render = menu.render.bind(menu);
  const syncSave = () => {
    const save = menu.root.querySelector(".account-save"); if (!save) return;
    const dirty = [...menu.root.querySelectorAll('[data-field="account-name"], [data-field="account-plate"]')].some((i) => i.value.trim().toUpperCase() !== (i.dataset.initial || "").toUpperCase());
    save.classList.toggle("off", !dirty);
    save.setAttribute("aria-disabled", String(!dirty));
  };
  menu.render = (...args) => {
    const keepDrafts =
      menu.shown === menu.screen &&
      ["account", "accountName", "signIn", "accountDelete"].includes(
        menu.screen,
      );
    const drafts = keepDrafts
      ? [...menu.root.querySelectorAll('input[data-field^="account-"]')].map(
          (input) => [input.dataset.field, input.value],
        )
      : [];
    const result = render(...args);
    for (const [name, value] of drafts) {
      const input = menu.root.querySelector(`input[data-field="${name}"]`);
      if (input) input.value = value;
    }
    for (const chip of menu.root.querySelectorAll("[data-hu-driver] span"))
      chip.textContent = a.user?.plate || driverName.get();
    syncSave(); // restored drafts keep Save enabled
    return result;
  };
  const gate = () => a.blocked;
  menu.show = (screen, data, push) =>
    show(
      gate() &&
        !["signIn", "accountName"].includes(
          screen,
        )
        ? a.user && !a.offline
          ? "accountName"
          : "signIn"
        : screen,
      data,
      push,
    );
  menu.hide = () =>
    gate() ? menu.show(a.user && !a.offline ? "accountName" : "signIn") : hide();
  menu.r_signIn = () => renderSignIn(a, menu);
  menu.r_accountName = () => renderProfile(a);
  menu.r_account = () => renderAccount(a);
  menu.r_accountPrivacy = renderPrivacy;
  menu.r_accountDelete = () =>
    C.sheetList({ variant: "narrow",
      cls: "scr--account",
      kick: "YOUR DRIVER ACCOUNT",
      title: "DELETE ACCOUNT",
      hints: [["confirm", "OK"], ["back", "CANCEL"]],
      rows: C.panel(
        "PERMANENT DELETION",
        `<p class="group__note">This removes your account, sessions, friends and invites. Device progress remains on this device. Type DELETE to confirm.</p>${field("confirm", "TYPE DELETE", "", { placeholder: "DELETE", autocapitalize: "characters" })}<div class="field-actions">${btn("PERMANENTLY DELETE", "account-delete-confirm", {}, "danger")}${btn("CANCEL", "back", {}, "ghost")}</div><p role="status" class="account-error">${esc(a.error || "")}</p>`,
        { icon: "trash" },
      ),
    });
  // One Save, enabled only once the name or plate differs from the saved profile.
  menu.root.addEventListener("input", (e) => { if (e.target.matches?.('[data-field="account-name"], [data-field="account-plate"]')) syncSave(); });
  // Required sign-in has no dismissal through keyboard, gamepad or history.
  const back = menu.back.bind(menu);
  menu.back = () => { if (!gate()) return back(); };
  const value = (name) =>
    menu.root.querySelector(`[data-field="account-${name}"]`)?.value || "";
  menu.activate = (el) => {
    if (gate() && !el.matches("a.legal-link[href]") && !["account-oauth", "account-retry", "account-profile"].includes(el.dataset.act)) return;
    if (el.matches("a.legal-link[href]")) {
      el.click();
      return;
    }
    if (el.dataset.act === "account") {
      menu.show("account", {}, true);
      if (a.user) a.social().catch(() => {});
      return;
    }
    if (el.dataset.act?.startsWith("account-")) {
      void action(el);
      return;
    }
    act(el);
  };
  async function action(el) {
    const kind = el.dataset.act.slice(8);
    a.error = "";
    try {
      if (kind === "oauth") {
        if (!navigator.onLine) throw new Error("Connect to the internet to sign in with Google, then try again.");
        // Same-tab redirect works on iOS Safari and with popup blocking enabled.
        location.assign("/api/auth/google/start");
        return;
      }
      if (kind === "retry") { await a.init(); return; }
      if (kind === "privacy") {
        menu.show("accountPrivacy", {}, true);
        return;
      }
      if (kind === "profile") {
        const displayName = value("name").trim().toUpperCase(),
          plate = value("plate").trim().toUpperCase();
        await a.api("/api/account/profile", { displayName, plate });
        a.user = { ...a.user, displayName, plate };
        driverName.set(displayName);
        menu.show("title");
        return;
      }
      if (kind.startsWith("friend-")) {
        await a.api("/api/account/friends", {
          action: kind.slice(7),
          name: el.dataset.name || value("friend"),
        });
        await a.social();
        C.ui.toast("FRIENDS UPDATED");
      }
      if (kind === "invite") {
        await a.api("/api/account/invites", {
          recipient: el.dataset.user,
          token: window.__multiplayer?.token,
        });
        C.ui.toast("LOBBY INVITE SENT");
      }
      if (kind === "join") {
        const mp = window.__multiplayer;
        if (!mp?.connected)
          throw new Error(
            "Multiplayer is reconnecting. Try the invite again shortly.",
          );
        const b = await a.api("/api/account/invites", {
          action: "accept",
          id: el.dataset.id,
        });
        mp.open();
        mp.action("join", { code: b.lobby });
        menu.show("mp");
        await a.social();
      }
      if (kind === "decline") {
        await a.api("/api/account/invites", {
          action: "decline",
          id: el.dataset.id,
        });
        await a.social();
      }
      if (kind === "logout") {
        await a.api("/api/auth/logout", {});
        a.disconnect();
        a.offline = false;
        menu.show("signIn");
        return;
      }
      if (kind === "share") {
        const data = await a.api("/api/account/export");
        const link = document.createElement("a");
        link.href = URL.createObjectURL(
          new Blob([JSON.stringify(data, null, 2)], {
            type: "application/json",
          }),
        );
        link.download = "athens-racing-account.json";
        link.click();
        setTimeout(() => URL.revokeObjectURL(link.href), 1000);
      }
      if (kind === "delete") {
        menu.show("accountDelete", {}, true);
        return;
      }
      if (kind === "delete-confirm") {
        if (value("confirm").trim().toUpperCase() !== "DELETE") throw new Error("Type DELETE to confirm.");
        await a.api("/api/account/delete", { confirm: value("confirm") });
        a.disconnect();
        menu.show("signIn");
        return;
      }
    } catch (e) {
      a.error = e.message;
      C.ui.toast(e.message, { tone: "bad" });
    }
    menu.refresh();
  }
  if (!existing) void a.init();
}
