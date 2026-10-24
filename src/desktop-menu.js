import * as C from './ui/components.js';
import { desktopAvailable, desktopLaunchURL, takeDesktopLaunch, clearDesktopSession, desktopTransitionEndsSession, desktopInvite } from './desktop-navigation.js';
export function installDesktopMenu(menu) {
  if (!desktopAvailable()) return;
  menu.desktopForm = { address: '', session: null, pending: false, error: '' };
  menu.desktopLaunch = takeDesktopLaunch(location, history);
  void globalThis.athensDesktop.session().then(session => { menu.desktopForm.session = session; if (menu.open) menu.refresh(); }).catch(error => { menu.desktopForm.error = error.message; });
  menu.root.addEventListener('input', event => { if (event.target.matches('[data-desktop-address]')) menu.desktopForm.address = event.target.value; });
}
export function afterDesktopShow(menu, screen, openMultiplayer) {
  if (screen !== 'title' || !menu.desktopLaunch) return;
  const mode = menu.desktopLaunch; menu.desktopLaunch = null;
  if (mode === 'solo') menu.show('mode', {}, true);
  else openMultiplayer(menu, mode === 'host' ? 'host' : 'join');
}
export function desktopAct(menu, element) {
  const action = element.dataset.act;
  if (!desktopAvailable() || !['desktopLan', 'desktopSolo', 'desktopHost', 'desktopJoin'].includes(action)) return false;
  const state = menu.desktopForm;
  if (action === 'desktopLan') {
    menu.show('desktopLan', {}, true);
    void globalThis.athensDesktop.session().then(session => { state.session = session; if (menu.screen === 'desktopLan') menu.refresh(); }).catch(error => { state.error = error.message; if (menu.screen === 'desktopLan') menu.refresh(); });
    return true;
  }
  if (state.pending) return true;
  state.pending = true; state.error = ''; menu.refresh();
  const mode = { desktopSolo: 'solo', desktopHost: 'host', desktopJoin: 'join' }[action];
  void Promise.resolve().then(async () => {
    const previous = await globalThis.athensDesktop.session();
    await (mode === 'join' ? globalThis.athensDesktop.join(state.address.trim()) : globalThis.athensDesktop[mode]());
    if (desktopTransitionEndsSession(previous, mode)) clearDesktopSession();
    location.assign(desktopLaunchURL(location.href, mode));
  }).catch(error => { state.pending = false; state.error = error.message || 'The local session could not start.'; C.ui.toast(state.error, { tone: 'bad' }); menu.refresh(); });
  return true;
}
export function renderDesktopLan(menu) {
  const state = menu.desktopForm, addresses = state.session?.addresses || [], current = state.session?.mode;
  const connection = addresses.length ? addresses.map(value => C.esc(value)).join(' · ') : '';
  return C.sheetList({ variant: 'flow', title: 'LAN MULTIPLAYER', kick: 'LOCAL NETWORK', rows: [
    C.option({ icon: 'users', title: state.pending ? 'STARTING SESSION…' : 'HOST LAN GAME', desc: 'Start a game on this computer. Friends on your network join with its address.', act: 'desktopHost', disabled: state.pending, attrs: { 'data-default': '' } }),
    C.textField({ name: 'desktop-address', label: 'HOST ADDRESS', value: state.address, placeholder: '192.168.1.20:17834', inputAttrs: { 'data-desktop-address': '', autocomplete: 'off', spellcheck: 'false', maxlength: 255 }, note: 'Enter the address shown on your friend’s computer. Both computers need this game installed.' }),
    C.button({ label: 'JOIN LAN GAME', icon: 'log-in', variant: 'primary', act: 'desktopJoin', disabled: state.pending }),
    current && C.listRow({ icon: 'monitor', title: current === 'solo' ? 'SOLO' : current === 'host' ? 'HOSTING' : 'JOINED', desc: connection || state.session?.address || 'This computer' }),
    state.error && C.emptyState({ icon: 'triangle-alert', tone: 'bad', title: 'COULD NOT CONNECT', text: C.esc(state.error) }),
  ].filter(Boolean).join(''), hints: [['select', 'SELECT'], ['confirm', 'OK'], ['back', 'BACK']] });
}


export async function selectDesktopInvite(menu, multiplayer, bridge = globalThis.athensDesktop) {
  if (!menu.desktopForm || !desktopAvailable({ athensDesktop: bridge })) return false;
  try {
    menu.desktopForm.session = await bridge.session();
    menu.desktopForm.error = desktopInvite(menu.desktopForm.session, multiplayer.lobby) ? '' : 'No shareable LAN address. Connect this computer to your local network and host a game.';
    menu.refresh();
    const field = menu.root.querySelector('[data-desktop-share]');
    field?.focus(); field?.select();
  } catch (error) { menu.desktopForm.error = error.message || 'LAN details are unavailable.'; menu.refresh(); }
  return true;
}
