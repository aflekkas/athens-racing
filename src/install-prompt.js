// ADD TO HOME SCREEN: the pure logic behind the title-screen card that invites phone players to install the game
// (src/ui/install-card.js renders it; tools/install-prompt.test.mjs runs this file directly). No DOM and no Node imports.
// Owner request, 2026-10-18: "on mobile can we encourage the user to add a bookmark please".
//  - phones and tablets only, never inside an already-installed app (display-mode standalone / fullscreen, navigator.standalone)
//  - NOT NOW hides the card for SNOOZE_MS, DON'T ASK AGAIN for good, an install (appinstalled / standalone launch) for good
//  - only for players who have shown up before: a finished race on record, or a few launches

export const INSTALL_KEY = 'paraliaki.install.v1';
export const SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;
export const MIN_VISITS = 3;
/** storage keys a finished race leaves behind (personal-bests.js, events.js, main.js): the "has raced" signal */
const RACED_KEYS = /^paraliaki\.(?:personalBests\.v1|best\.|events\.)/;
const IN_APP = /FBAN|FBAV|FB_IAB|Instagram|Line\/|MicroMessenger|Snapchat|TikTok|Twitter|; wv\)|\bwv\b/i;

const store = (s) => { try { return s ?? globalThis.localStorage ?? null; } catch { return null; } };

/** { mobile, os: 'ios' | 'android' | 'other', safari, inApp } from the navigator; iPadOS reports itself as a Mac with a touch screen */
export function platformOf({ userAgent = '', platform = '', maxTouchPoints = 0, coarse = false } = {}) {
  const ios = /iPhone|iPad|iPod/.test(userAgent) || (platform === 'MacIntel' && maxTouchPoints > 1);
  const android = /Android/i.test(userAgent);
  const mobile = ios || android || (coarse && /Mobile|Tablet|HarmonyOS|Silk|KF[A-Z]{2,}/i.test(userAgent));
  return {
    mobile, os: ios ? 'ios' : android ? 'android' : 'other', inApp: IN_APP.test(userAgent),
    // Safari proper has no browser token; Chrome, Firefox, Edge and Opera on iOS identify themselves (they can add too, from the same share sheet)
    safari: ios && !/CriOS|FxiOS|EdgiOS|OPiOS|OPT\//.test(userAgent),
  };
}
/** true when the page runs as an installed app (home-screen launch) */
export function isInstalledApp({ matchMedia, navigatorStandalone } = {}) {
  if (navigatorStandalone === true) return true;
  try { return ['standalone', 'fullscreen', 'minimal-ui', 'window-controls-overlay'].some((m) => matchMedia?.(`(display-mode: ${m})`)?.matches === true); } catch { return false; }
}

export function readState(storage) {
  try {
    const v = JSON.parse(store(storage)?.getItem(INSTALL_KEY) || 'null');
    return v && typeof v === 'object' ? { visits: +v.visits || 0, snoozedUntil: +v.snoozedUntil || 0, never: v.never === true, installed: v.installed === true } : { visits: 0, snoozedUntil: 0, never: false, installed: false };
  } catch { return { visits: 0, snoozedUntil: 0, never: false, installed: false }; }
}
function update(storage, patch) {
  const next = { ...readState(storage), ...patch };
  try { store(storage)?.setItem(INSTALL_KEY, JSON.stringify(next)); } catch { /* storage blocked: the card simply asks again next time */ }
  return next;
}
/** call once per page load */
export const countVisit = (storage) => update(storage, { visits: readState(storage).visits + 1 });
export const snooze = (storage, now = Date.now()) => update(storage, { snoozedUntil: now + SNOOZE_MS });
export const neverAsk = (storage) => update(storage, { never: true });
export const markInstalled = (storage) => update(storage, { installed: true });

/** has this browser finished a race before? */
export function hasRaced(storage) {
  const s = store(storage);
  try { for (let i = 0; i < (s?.length ?? 0); i++) if (RACED_KEYS.test(s.key(i) || '')) return true; } catch { /* storage blocked */ }
  return false;
}

/**
 * What the card shows, or null for nothing:
 *   'install' the browser handed us an install prompt (Android Chrome and friends): an INSTALL button
 *   'ios'     Share, then Add to Home Screen
 *   'menu'    any other phone browser: open the browser menu, then Add to Home screen
 */
export function planOf({ platform, installedApp = false, state = readState(), now = Date.now(), hasPrompt = false, raced = false } = {}) {
  if (!platform?.mobile || platform.inApp || installedApp) return null;
  if (state.installed || state.never || now < state.snoozedUntil) return null;
  if (!raced && state.visits < MIN_VISITS) return null;
  return platform.os === 'ios' ? 'ios' : hasPrompt ? 'install' : 'menu';
}
