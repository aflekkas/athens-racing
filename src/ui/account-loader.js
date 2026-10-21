import { importWithUpdate } from '../client-release.js';
import { AccountsClient } from '../accounts-client.js';
import { driverName } from '../driver-name.js';
import { bootScreen } from './boot-screen.js';
// The one launch check (owner 2026-10-20: "one central loading screen that checks auth"). The launch screen
// (src/ui/boot-screen.js, painted by index.html) stays up while the session is checked; no menu screen renders under it.
// The first answer routes the launch once: the screen that was asked for (the title) when signed in, the sign-in dialog
// over the title when signed out, expired or offline (owner 2026-10-17: offline stays gated, with retry). An explicitly
// unconfigured local environment plays locally. Policy is eager: no menu, URL parameter or lazy import may skip pending auth.
export function install(menu, { boot = bootScreen, AccountsClientClass = AccountsClient, loadScreen = () => importWithUpdate(() => import('./account-screen.js')) } = {}) {
  let pending, installed = false, held = null, routed = false;
  const ensure = () => pending ||= loadScreen().then(module => {
    module.install(menu, client); installed = true; return module;
  }).catch(error => { pending = null; throw error; });
  const route = () => {
    routed = true;
    const [screen, ...args] = held || [client.blocked ? 'signIn' : null]; held = null;
    const go = () => { if (screen) menu.show(screen, ...args); boot.done(); };
    // The dialog's module comes in before the launch screen leaves; if that fails the launch screen says so and retries.
    const retry = () => { boot.step('CONNECTION LOST · RETRYING', .6); setTimeout(() => ensure().then(go, retry), 3000); };
    if (client.blocked) ensure().then(go, retry); else go();
  };
  const client = menu.accounts = new AccountsClientClass({ onChange() {
    if (client.user?.displayName) { try { driverName.set(client.user.displayName); } catch {} }
    if (!routed) { if (client.ready) route(); return; }
    if (client.blocked || client.user) void ensure().then(() => {
      if (client.blocked) menu.show(client.user && !client.offline ? 'accountName' : 'signIn');
      else if (['signIn', 'accountName'].includes(menu.screen)) menu.show('title');
    });
  } });
  const show = menu.show.bind(menu), hide = menu.hide.bind(menu), activate = menu.activate.bind(menu), back = menu.back.bind(menu), pop = menu.pop.bind(menu);
  menu.r_signIn = () => ''; // Replaced by the lazy dialog before any controls become available.
  menu.show = (screen, ...args) => {
    // Until the session is known nothing renders: the launch screen is up, and the latest request waits for the answer.
    // A recent sign-in on this device (client.optimistic) is the exception: the first screen goes up at once and the
    // launch screen leaves; if the server then rejects the session, onChange brings the sign-in dialog.
    if (!client.ready && !client.optimistic) { held = [screen, ...args]; return; }
    if (!routed) { routed = true; queueMicrotask(() => boot.done()); }
    const requestedScreen = screen;
    if (client.blocked) screen = client.user && !client.offline ? 'accountName' : 'signIn';
    if (!installed && /^(account|signIn)/.test(screen)) {
      void ensure().then(() => menu.show(client.blocked ? screen : requestedScreen, ...args)); return show('signIn');
    }
    return show(screen, ...args);
  };
  menu.hide = () => client.blocked ? menu.show('signIn') : hide();
  menu.activate = el => { if (!client.blocked) return activate(el); };
  menu.back = () => { if (!client.blocked) return back(); };
  menu.pop = () => client.blocked ? false : pop();
  boot.step('CHECKING YOUR SESSION', .6);
  void client.init();
  window.addEventListener('online', () => void client.init());
  window.addEventListener('offline', () => client.connectionLost());
  window.addEventListener('focus', () => void client.revalidate());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void client.revalidate(); });
  setInterval(() => void client.revalidate(), 30000)?.unref?.();
}
