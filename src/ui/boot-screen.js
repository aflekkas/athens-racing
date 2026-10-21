// The launch screen (owner 2026-10-20: "one central loading screen that checks auth"). index.html paints it before any
// module runs (tools/sync-loading-layout.mjs builds it from the shared kit). The game loads and the session is checked
// behind it, and it leaves only once there is a screen to show: the title when you are signed in, the sign-in dialog over
// the title when you are not. Nothing else is shown first, so no wrong screen flashes. Imports nothing: entry paths
// (the menu, the Athens world) all call it.
const doc = () => (typeof document === 'undefined' ? null : document);
export const bootScreen = {
  /** the quiet status line and the bar: what is happening, and how far */
  step(text, progress) {
    const d = doc(), el = d?.getElementById('boot'); if (!el || el.dataset.done) return;
    const label = el.querySelector('.boot__step'); if (label && text) label.textContent = text;
    const bar = el.querySelector('.progress'); if (bar && progress != null) { const p = Math.max(0, Math.min(1, progress)); bar.style.setProperty('--p', p); bar.setAttribute('aria-valuenow', String(Math.round(p * 100))); }
  },
  /** a screen is ready under it: fade out and leave */
  done() {
    const d = doc(), el = d?.getElementById('boot'); if (!el || el.dataset.done) return;
    el.dataset.done = '1'; this.step(null, 1); el.setAttribute('aria-hidden', 'true'); el.inert = true;
    d.documentElement.classList.add('booted');
    setTimeout(() => el.remove(), 320);
  },
  get open() { const el = doc()?.getElementById('boot'); return !!el && !el.dataset.done; },
};
