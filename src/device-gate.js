// DESKTOP ONLY. Owner decision, 2026-10-19 (docs/OWNER-DECISIONS.md): Athens Racing is a computer game. A phone or tablet gets
// one full screen telling it so, before sign-in, the title menu or any asset download (src/entry.js). Ask the owner before changing.
// This module must stay tiny and import nothing: it is the only code a blocked device ever runs.

/** the gate screen's words (tools/sync-loading-layout.mjs builds the static #device-gate markup in index.html from these) */
export const GATE_TITLE = 'ATHENS RACING IS MADE FOR COMPUTERS';
export const GATE_TEXT = 'Open this page on a laptop or desktop computer to play.';
export const GATE_URL = 'athensracing.com';

const IOS = /iPhone|iPod|iPad/;
const ANDROID_PHONE = /Android[\s\S]*\bMobile\b|\bMobile\b[\s\S]*Android/;

/**
 * Why this device may not play, or null when it may.
 *  - 'mobile-hint'  the browser says it is a mobile device (User-Agent Client Hints)
 *  - 'phone'        an iPhone, an iPod or an Android phone by its user agent
 *  - 'ipad'         an iPad, by its user agent, or an iPad that asks for the desktop site (a Mac with a touch screen)
 *  - 'touch-only'   the primary pointer is coarse and no pointer anywhere is fine (no mouse, no trackpad)
 * A touchscreen laptop has a trackpad, so its primary pointer is fine and it plays.
 */
export function deviceBlockReason({ coarse = false, anyFine = false, mobileHint = false, userAgent = '', platform = '', maxTouchPoints = 0 } = {}) {
  if (mobileHint === true) return 'mobile-hint';
  if (/iPad/.test(userAgent) || (platform === 'MacIntel' && maxTouchPoints > 1)) return 'ipad';
  if (IOS.test(userAgent) || ANDROID_PHONE.test(userAgent)) return 'phone';
  if (coarse === true && anyFine !== true) return 'touch-only';
  return null;
}
export const deviceBlocked = (device) => deviceBlockReason(device) !== null;

/** the facts the decision needs, read from the browser (never throws) */
export function readDevice(scope = globalThis) {
  const media = query => { try { return scope.matchMedia?.(query)?.matches === true; } catch { return false; } };
  const nav = scope.navigator || {};
  return { coarse: media('(pointer: coarse)'), anyFine: media('(any-pointer: fine)'), mobileHint: nav.userAgentData?.mobile === true, userAgent: String(nav.userAgent || ''), platform: String(nav.platform || ''), maxTouchPoints: +nav.maxTouchPoints || 0 };
}

/** show the gate: CSS (src/ui/ui.css) hides everything else and reveals #device-gate */
export function showDeviceGate(doc = document, reason = null) {
  doc.documentElement.dataset.device = 'blocked';
  if (reason) doc.documentElement.dataset.deviceReason = reason;
}
