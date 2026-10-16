import { importWithUpdate } from '../client-release.js';
// The auth policy and session stay eager. Full account screens load only when needed.
import { AccountsClient } from '../accounts-client.js';
import { driverName } from '../driver-name.js';
export function install(menu) {
  let pending, installed = false;
  const ensure = () => pending ||= importWithUpdate(() => import('./account-screen.js')).then(module => {
    module.install(menu, client); installed = true;
    return module;
  }).catch(error => { pending = null; throw error; });
  const client = menu.accounts = new AccountsClient({ onChange() {
    if (client.user?.displayName) { try { driverName.set(client.user.displayName); } catch {} }
    if (client.required || client.user) void ensure().then(() => {
      if (client.required && !client.offline && (!client.user || !client.user.displayName)) menu.show(client.user ? 'accountName' : 'signIn');
    });
    let banner = document.querySelector('#accounts-offline');
    if (client.offline && !banner) {
      banner = document.createElement('div'); banner.id = 'accounts-offline'; banner.role = 'status';
      banner.textContent = 'PLAYING OFFLINE · Progress stays on this device'; document.body.append(banner);
    } else if (!client.offline) banner?.remove();
  } });
  const show = menu.show.bind(menu);
  menu.show = (screen, ...args) => {
    if (!installed && /^(account|signIn)/.test(screen)) {
      const from = menu.screen;
      void ensure().then(() => { if (menu.screen === from) menu.show(screen, ...args); }); return;
    }
    return show(screen, ...args);
  };
  if (new URLSearchParams(location.search).get('guest') === '1') {
    client.offline = client.ready = true; client.onChange();
  } else void client.init();
  if (new URLSearchParams(location.search).has('privacy')) queueMicrotask(() => menu.show('accountPrivacy'));
  window.addEventListener('online', () => { if (!installed) void client.init(); });
  window.addEventListener('offline', () => { if (!installed) { client.offline = true; client.onChange(); } });
}
