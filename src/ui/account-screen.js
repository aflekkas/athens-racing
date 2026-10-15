import * as C from "./components.js";
import { AccountsClient } from "../accounts-client.js";
import { driverName } from "../driver-name.js";
const { esc } = C;
const btn = (label, act, attrs = {}, variant = "secondary") =>
  C.button({ label, act, attrs, variant });
const field = (name, label, value = "", extra = {}) =>
  C.textField({ name: "account-" + name, label, value, inputAttrs: extra });
export function renderSignIn(a) {
  return C.screen({
    cls: "scr--account",
    back: false,
    kick: "ATHENS STREET RACERS",
    title: "YOUR PLACE ON THE GRID",
    body: `<div class="account-layout"><section class="account-intro"><p class="account-lede">One driver. Every road.</p><p>Save your garage and personal bests. Find your friends and head out together.</p><p>Your progress on this device comes with you.</p></section>${C.panel(
      "SIGN IN / CREATE ACCOUNT",
      `<p>New here? Signing in creates your account.</p>${a.ready ? "" : C.spinner()}${a.providers
        .filter((p) => p !== "email")
        .map((p) =>
          btn("CONTINUE WITH " + p.toUpperCase(), "account-oauth", {
            "data-provider": p,
          }),
        )
        .join(
          "",
        )}${a.providers.includes("email") ? `${field("email", "EMAIL ADDRESS", a.email || "", { type: "email", autocomplete: "email" })}${btn("EMAIL ME A CODE", "account-email")}${a.challenge ? `${field("code", "6-DIGIT CODE", "", { inputmode: "numeric", autocomplete: "one-time-code", maxlength: 6 })}${btn("VERIFY CODE", "account-verify", {}, "primary")}${a.devCode ? `<p class="account-dev">Development code: ${esc(a.devCode)}</p>` : ""}` : ""}` : ""}<p class="account-error" role="status">${esc(a.error || "")}</p>${a.ready && !a.providers.length ? "<p>Sign-in is temporarily unavailable.</p>" : ""}${a.ready ? btn("PLAY OFFLINE", "account-offline", {}, "ghost") : ""}<p class="account-small">${btn("PRIVACY & YOUR DATA", "account-privacy", {}, "ghost")}</p>`,
    )}</div>`,
  });
}
export function renderProfile(a) {
  return C.screen({
    cls: "scr--account",
    back: false,
    kick: "WELCOME TO ATHENS",
    title: "PICK YOUR IDENTITY",
    body: C.panel(
      "DRIVER PROFILE",
      `<p>Choose a unique driver name and a plate. Your local progress is already safe.</p>${field("name", "DISPLAY NAME", a.user?.displayName || driverName.get(), { maxlength: 16, autocapitalize: "characters" })}${field("plate", "PLATE", a.user?.plate || driverName.get(), { maxlength: 10, autocapitalize: "characters" })}${btn("SAVE & HIT THE ROAD", "account-profile", {}, "primary")}<p role="status" class="account-error">${esc(a.error || "")}</p>`,
    ),
  });
}
const status = (a, f) => {
  const p = a.presence[f.id];
  return p?.status === "in-race"
    ? `IN RACE · ${esc(p.map || "ATHENS").toUpperCase()}`
    : p?.status === "in-menu"
      ? "ONLINE · IN MENU"
      : "OFFLINE";
};
export function renderAccount(a) {
  a.invites = a.invites.filter((i) => i.expires > Date.now());
  if (!a.user) return renderSignIn(a);
  const friends = a.friends.filter((f) => f.state === "accepted"),
    requests = a.friends.filter((f) => f.state === "pending");
  return C.screen({
    cls: "scr--account",
    kick: "YOUR DRIVER ACCOUNT",
    title: esc(a.user.displayName || "ACCOUNT"),
    body: `<div class="account-layout">${C.panel("PROFILE", `${field("name", "DISPLAY NAME", a.user.displayName || "", { maxlength: 16 })}${field("plate", "PLATE", a.user.plate || "", { maxlength: 10 })}${btn("SAVE PROFILE", "account-profile")}<p class="account-error" role="status">${esc(a.error || "")}</p>${btn("EXPORT MY DATA", "account-export")}${btn("SIGN OUT", "account-logout", {}, "ghost")}${btn("DELETE ACCOUNT", "account-delete", {}, "ghost")}`)}<div>${C.panel("FRIENDS", `${field("friend", "ADD BY DISPLAY NAME")}${btn("SEND FRIEND REQUEST", "account-friend-request")}${a.presenceOffline ? "<p>Live status is reconnecting…</p>" : ""}${friends.length ? friends.map((f) => `<article class="account-friend"><div><b>${esc(f.display_name)}</b><small>${status(a, f)}</small></div><div>${a.presence[f.id]?.status && a.presence[f.id].status !== "offline" ? btn("INVITE", "account-invite", { "data-user": f.id }) : ""}${btn("BLOCK", "account-friend-block", { "data-name": f.display_name }, "ghost")}</div></article>`).join("") : "<p>Add a friend to race together.</p>"}`)}${C.panel("REQUESTS", requests.length ? requests.map((f) => `<article class="account-friend"><b>${esc(f.display_name)}</b><div>${f.recipient === a.user.id ? btn("ACCEPT", "account-friend-accept", { "data-name": f.display_name }) + btn("DECLINE", "account-friend-decline", { "data-name": f.display_name }, "ghost") : "<small>REQUEST SENT</small>"}${btn("BLOCK", "account-friend-block", { "data-name": f.display_name }, "ghost")}</div></article>`).join("") : "<p>No pending requests.</p>")}${C.panel("LOBBY INVITES", a.invites.length ? a.invites.map((i) => `<article class="account-friend"><div><b>${esc(i.display_name)}</b><small>LOBBY ${esc(i.lobby)} · EXPIRES IN 2 MIN</small></div><div>${btn("JOIN LOBBY", "account-join", { "data-id": i.id }, "primary")}${btn("DECLINE", "account-decline", { "data-id": i.id }, "ghost")}</div></article>`).join("") : "<p>No live invites.</p>")}</div></div>`,
  });
}
export function renderPrivacy() {
  return C.screen({
    cls: "scr--account",
    kick: "PRIVACY",
    title: "YOUR DATA, YOUR CONTROL",
    body: C.panel(
      "ATHENS STREET RACERS ACCOUNTS",
      `<p>We store your provider ID (or email for email sign-in), driver name, plate, saved game settings and progress, friendships, and short-lived lobby invitations. OAuth access tokens are never saved. Online status is shared only with accepted friends and disappears shortly after disconnecting.</p><p>Sign-in uses a necessary, secure session cookie. We use short-lived hashed rate-limit identifiers to prevent abuse. Expired codes, sessions and invitations are removed automatically. We do not sell account data or use advertising trackers.</p><p>Cloudflare hosts account data; Google or Discord handles your chosen provider sign-in. Email codes use Resend when configured. Device progress remains on this browser for offline play.</p><p>In Account, export your data or permanently delete your account and its sessions, friends and invitations. Clearing browser storage removes local progress. Contact the site owner for EU access, correction or erasure requests. The owner must publish their contact details before enabling accounts publicly.</p>`,
    ),
  });
}
export function install(menu) {
  const a = (menu.accounts = new AccountsClient({
    onChange: () => {
      if (a.user?.displayName)
        try {
          driverName.set(a.user.displayName);
        } catch {}
      if (["signIn", "account", "accountName"].includes(menu.screen))
        menu.refresh();
      if (
        a.ready &&
        !a.offline &&
        (!a.user || !a.user.displayName) &&
        !bypass() &&
        menu.screen !== "accountPrivacy"
      )
        menu.show(a.user ? "accountName" : "signIn");
      banner();
    },
    onInvite: () => {
      C.ui.toast("LOBBY INVITE RECEIVED · OPEN ACCOUNT", {
        icon: "users-three",
        ms: 7000,
      });
    },
  }));
  const bypass = () =>
    new URLSearchParams(location.search).get("guest") === "1";
  const banner = () => {
    let el = document.querySelector("#accounts-offline");
    if (a.offline) {
      if (!el) {
        el = document.createElement("div");
        el.id = "accounts-offline";
        el.role = "status";
        el.textContent = "PLAYING OFFLINE · Progress stays on this device";
        document.body.append(el);
      }
    } else el?.remove();
  };
  const show = menu.show.bind(menu),
    hide = menu.hide.bind(menu),
    act = menu.activate.bind(menu),
    render = menu.render.bind(menu);
  menu.render = (...args) => {
    const result = render(...args);
    for (const chip of menu.root.querySelectorAll("[data-hu-driver] span"))
      chip.textContent = a.user?.plate || driverName.get();
    return result;
  };
  const gate = () =>
    !bypass() && !a.offline && (!a.ready || !a.user || !a.user.displayName);
  menu.show = (screen, data, push) =>
    show(
      gate() &&
        !["signIn", "accountName", "accountPrivacy", "accountDelete"].includes(
          screen,
        )
        ? a.user
          ? "accountName"
          : "signIn"
        : screen,
      data,
      push,
    );
  menu.hide = () =>
    gate() ? menu.show(a.user ? "accountName" : "signIn") : hide();
  menu.r_signIn = () => renderSignIn(a);
  menu.r_accountName = () => renderProfile(a);
  menu.r_account = () => renderAccount(a);
  menu.r_accountPrivacy = renderPrivacy;
  menu.r_accountDelete = () =>
    C.screen({
      cls: "scr--account",
      title: "DELETE YOUR ACCOUNT",
      body: C.panel(
        "PERMANENT DELETION",
        `<p>This removes your account, sessions, friends and invites. Device progress remains available offline. Type DELETE to continue.</p>${field("confirm", "CONFIRM DELETION")}${btn("PERMANENTLY DELETE", "account-delete-confirm")}<p role="status">${esc(a.error || "")}</p>`,
      ),
    });
  const value = (name) =>
    menu.root.querySelector(`[data-field="account-${name}"]`)?.value || "";
  menu.activate = (el) => {
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
        location.assign("/api/auth/" + el.dataset.provider + "/start");
        return;
      }
      if (kind === "offline") {
        a.offline = true;
        banner();
        show("title");
        return;
      }
      if (kind === "privacy") {
        menu.show("accountPrivacy", {}, true);
        return;
      }
      if (kind === "email") {
        a.email = value("email");
        const b = await a.api("/api/auth/email/request", { email: a.email });
        a.challenge = b.id;
        a.devCode = b.devCode;
      }
      if (kind === "verify") {
        await a.api("/api/auth/email/verify", {
          id: a.challenge,
          code: value("code"),
        });
        await a.init();
        menu.show(a.user?.displayName ? "title" : "accountName");
        return;
      }
      if (kind === "profile") {
        const displayName = value("name").trim().toUpperCase(),
          plate = value("plate").trim().toUpperCase();
        await a.api("/api/account/profile", { displayName, plate });
        a.user = { ...a.user, displayName, plate };
        driverName.set(displayName);
        menu.show("account");
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
      if (kind === "export") {
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
  if (new URLSearchParams(location.search).has("privacy"))
    queueMicrotask(() => menu.show("accountPrivacy"));
  if (bypass()) {
    a.offline = true;
    a.ready = true;
    banner();
  } else void a.init();
  window.addEventListener("offline", () => {
    a.offline = true;
    banner();
  });
  window.addEventListener("online", () => {
    a.offline = false;
    void a.init();
  });
}
