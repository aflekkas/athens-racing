// SCROLLING FOR ARTICLE PAGES (sheetList variant 'article': Credits, What's new, licence texts).
// Wheel and touch scroll the region natively. This module adds the rest: held arrow / W / S keys and the gamepad sticks and
// D-pad glide (velocity eases in and out), PageUp / PageDown / Home / End and Q / E / LB / RB move a page with a smooth
// jump, and left / right step between the page's few links and buttons (Enter / A opens the highlighted one).
const KEY_SPEED = 640, PAD_SPEED = 1100, EASE = 11, DEADZONE = 0.18;
const HELD = { ArrowUp: -1, KeyW: -1, ArrowDown: 1, KeyS: 1 };
const JUMPS = { PageUp: -1, PageDown: 1, Home: 'top', End: 'end' };
const calm = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** scroll one page (or to an end) with a smooth jump; the held-key glide takes over again afterwards */
export function jump(box, to) {
  const top = to === 'top' ? 0 : to === 'end' ? box.scrollHeight : box.scrollTop + to * Math.max(120, box.clientHeight * 0.85);
  box.scrollTo({ top, behavior: calm() ? 'auto' : 'smooth' });
}
/** the strongest vertical gamepad push right now, -1 … 1: left / right stick, or the D-pad */
function padAxis(navigator) {
  let best = 0;
  try {
    for (const pad of navigator?.getGamepads?.() || []) {
      if (!pad || pad.connected === false) continue;
      for (const i of [1, 3]) { const a = pad.axes?.[i] || 0; if (Math.abs(a) > DEADZONE && Math.abs(a) > Math.abs(best)) best = Math.sign(a) * (Math.abs(a) - DEADZONE) / (1 - DEADZONE); }
      const dpad = (pad.buttons?.[13]?.pressed ? 1 : 0) - (pad.buttons?.[12]?.pressed ? 1 : 0);
      if (dpad && Math.abs(best) < 1) best = dpad;
    }
  } catch { /* no gamepad API */ }
  return best;
}

export function installArticleScroll(menu, { document: doc = globalThis.document, navigator: nav = globalThis.navigator } = {}) {
  const root = menu.root, held = new Set(), box = () => (menu.open ? root.querySelector('[data-article-scroll]') : null);
  let raf = 0, last = 0, v = 0, pos = 0;
  const tick = (now) => {
    raf = 0;
    const el = box(); if (!el) { v = 0; return; }
    const dt = Math.min(0.05, (now - last) / 1000 || 0.016); last = now;
    const keys = [...held].reduce((sum, code) => sum + HELD[code], 0);
    const target = Math.max(-1, Math.min(1, keys)) * KEY_SPEED + padAxis(nav) * PAD_SPEED;
    v += (target - v) * Math.min(1, dt * EASE);
    if (!target && Math.abs(v) < 4) v = 0;
    if (v) {
      if (Math.abs(el.scrollTop - pos) > 1.5) pos = el.scrollTop; // the wheel, touch or a jump moved it: follow
      pos = Math.max(0, Math.min(el.scrollHeight - el.clientHeight, pos + v * dt));
      el.scrollTop = pos;
    }
    raf = requestAnimationFrame(tick);
  };
  const sync = () => { if (box()) { if (!raf) { last = performance.now(); raf = requestAnimationFrame(tick); } } else { held.clear(); v = 0; if (raf) { cancelAnimationFrame(raf); raf = 0; } } };
  new MutationObserver(sync).observe(root, { childList: true });
  doc.addEventListener('keydown', (e) => {
    const el = box(); if (!el || e.ctrlKey || e.metaKey || e.altKey || e.target?.closest?.('input, textarea, select, [contenteditable]')) return;
    if (e.code in HELD) held.add(e.code);
    else if (e.code in JUMPS && !e.repeat) jump(el, JUMPS[e.code]);
    else return;
    e.preventDefault(); e.stopImmediatePropagation(); // the menu's own up / down would otherwise move a focus that does not exist here
  }, true);
  doc.addEventListener('keyup', (e) => { held.delete(e.code); }, true);
  globalThis.addEventListener?.('blur', () => held.clear());
  return { sync };
}

/** a menu action on an article page; true when handled here */
export function articleAction(menu, name) {
  const el = menu.open ? menu.root.querySelector('[data-article-scroll]') : null; if (!el) return false;
  switch (name) {
    case 'up': case 'down': return true; // glided every frame from the held key or stick
    case 'shiftUp': case 'shiftDown': jump(el, name === 'shiftUp' ? -1 : 1); return true;
    case 'left': case 'right': {
      const items = menu.items(); if (!items.length) return true;
      const at = items.findIndex((item) => item.classList.contains('focus')), step = name === 'right' ? 1 : -1;
      menu.articleNavigated = el;
      menu.setFocus(at < 0 ? (step > 0 ? 0 : items.length - 1) : (at + step + items.length) % items.length, false);
      menu.items()[menu.focus]?.scrollIntoView?.({ block: 'center', behavior: calm() ? 'auto' : 'smooth' });
      menu.h.ui?.(step > 0);
      return true;
    }
    case 'confirm': return !el.querySelector('.mi.focus'); // nothing highlighted yet: nothing to open
  }
  return false;
}
/** a freshly drawn article starts with nothing highlighted, so the first Enter cannot open an unseen button;
 *  once the player has stepped through its links (same page element, patched in place) their highlight stays */
export function clearArticleFocus(menu) {
  const el = menu.open ? menu.root.querySelector('[data-article-scroll]') : null;
  if (el && menu.articleNavigated !== el) for (const item of menu.root.querySelectorAll('.mi.focus')) item.classList.remove('focus');
}
