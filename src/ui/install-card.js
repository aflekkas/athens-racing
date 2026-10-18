// ADD TO HOME SCREEN card: a small, dismissible kit notice on the title screen that invites phone and tablet players to
// install the game (it then launches fullscreen like an app). The decisions live in src/install-prompt.js (pure, tested);
// this file reads the browser, captures the browser's own install prompt and renders the card.
//  - Android Chrome and friends: the captured beforeinstallprompt drives an INSTALL button
//  - iOS: SHARE, then ADD TO HOME SCREEN        - any other phone browser: its menu, then ADD TO HOME SCREEN
//  - NOT NOW (and the close button) hides it for a week, DON'T ASK AGAIN for good; installing, or running as the app, never shows it
import * as C from './components.js';
import { platformOf, isInstalledApp, planOf, readState, countVisit, snooze, neverAsk, markInstalled, hasRaced } from '../install-prompt.js';

const nav = typeof navigator !== 'undefined' ? navigator : {};
const media = (q) => { try { return window.matchMedia(q); } catch { return null; } };
const platform = typeof window === 'undefined' ? platformOf() : platformOf({ userAgent: nav.userAgent, platform: nav.platform, maxTouchPoints: nav.maxTouchPoints, coarse: media('(pointer: coarse)')?.matches === true });
const installedApp = () => isInstalledApp({ matchMedia: (q) => media(q), navigatorStandalone: nav.standalone });
let prompt = null; // the browser's deferred install prompt (BeforeInstallPromptEvent)
let onChange = () => {};

if (platform.mobile) {
  // after the first paint, never mid-gesture: capturing early is what lets the title's INSTALL button work later
  countVisit();
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); prompt = e; onChange(); });
  window.addEventListener('appinstalled', () => { prompt = null; markInstalled(); onChange(); });
}

const plan = () => planOf({ platform, installedApp: installedApp(), state: readState(), hasPrompt: !!prompt, raced: hasRaced() });
const STEPS = {
  ios: [{ icon: 'share', text: 'Tap <b>SHARE</b> in the browser toolbar' }, { icon: 'square-plus', text: 'Choose <b>ADD TO HOME SCREEN</b>' }],
  menu: [{ icon: 'ellipsis-vertical', text: 'Open the <b>BROWSER MENU</b>' }, { icon: 'square-plus', text: 'Choose <b>ADD TO HOME SCREEN</b> or <b>INSTALL APP</b>' }],
};

/** the card for the title screen, or '' when nothing should be asked (`busy`: another card already holds that corner) */
export function titleNotice({ busy = false } = {}) {
  const kind = busy ? null : plan();
  if (!kind) return '';
  const later = C.button({ label: 'NOT NOW', variant: 'ghost', size: 'sm', act: 'installLater' }), never = C.button({ label: "DON'T ASK AGAIN", variant: 'ghost', size: 'sm', act: 'installNever' });
  return C.notice({
    icon: 'smartphone', title: 'ADD ATHENS RACING TO YOUR HOME SCREEN', cls: 'install-notice', attrs: { 'data-install': kind, 'aria-label': 'Add ATHENS RACING to your home screen' },
    text: kind === 'install' ? 'Play fullscreen like an app, one tap from your home screen.' : 'It then plays fullscreen like an app, one tap away.',
    steps: STEPS[kind] || [], dismiss: 'installLater', dismissTitle: 'Not now',
    actions: `${kind === 'install' ? C.button({ label: 'INSTALL', icon: 'download', variant: 'primary', size: 'sm', act: 'installApp' }) : ''}${later}${never}`,
  });
}

/** fade the card out, then redraw the title without it */
function leave(menu) {
  const card = menu.root?.querySelector('[data-install]');
  if (!card) return;
  card.dataset.leaving = '';
  setTimeout(() => { if (menu.open && menu.screen === 'title') menu.refresh(); }, 240);
}

/** a menu action; true when handled here */
export function act(menu, el) {
  switch (el.dataset.act) {
    case 'installLater': snooze(); leave(menu); return true;
    case 'installNever': neverAsk(); leave(menu); return true;
    case 'installApp': {
      const asked = prompt; prompt = null; // a prompt can be used once
      if (!asked) { snooze(); leave(menu); return true; }
      asked.prompt(); // must run inside this tap
      Promise.resolve(asked.userChoice).then((choice) => { if (choice?.outcome === 'accepted') markInstalled(); else snooze(); }, () => snooze()).then(() => leave(menu));
      return true;
    }
  }
  return false;
}
/** call once from the Menu constructor: redraw the title when the browser's prompt arrives or the app gets installed */
export function install(menu) { onChange = () => { if (menu.open && menu.screen === 'title') menu.refresh(); }; }
