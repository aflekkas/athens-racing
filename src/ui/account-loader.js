import { importWithUpdate } from '../client-release.js';
import { AccountsClient } from '../accounts-client.js';
import { driverName } from '../driver-name.js';
// Policy is eager: no menu, URL parameter or lazy import may skip pending auth.
export function install(menu) {
  let pending, installed = false;
  const ensure = () => pending ||= importWithUpdate(() => import('./account-screen.js')).then(module => {
    module.install(menu, client); installed = true; return module;
  }).catch(error => { pending = null; throw error; });
  const client = menu.accounts = new AccountsClient({ onChange() {
    if (client.user?.displayName) { try { driverName.set(client.user.displayName); } catch {} }
    if (client.blocked || client.user) void ensure().then(() => {
      if (client.blocked) menu.show(client.user && !client.offline ? 'accountName' : 'signIn');
      else if (['signIn', 'accountName'].includes(menu.screen)) menu.show('title');
    });
  } });
  const show = menu.show.bind(menu), hide = menu.hide.bind(menu), activate = menu.activate.bind(menu), back = menu.back.bind(menu), pop = menu.pop.bind(menu);
  menu.r_signIn = () => ''; // Replaced by the lazy dialog before any controls become available.
  menu.show = (screen, ...args) => {
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
  void client.init();
  window.addEventListener('online', () => void client.init());
  window.addEventListener('offline', () => client.connectionLost());
  window.addEventListener('focus', () => void client.revalidate());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void client.revalidate(); });
  setInterval(() => void client.revalidate(), 30000);
}
