import { importWithUpdate } from '../client-release.js';
// Synchronous menu lifecycle hooks are inert until an online screen is requested.
let module;
const installed = new WeakSet();
async function ready(menu) {
  await menu.h.ensureRuntime?.();
  module ||= await importWithUpdate(() => import('./mp-screens.js'));
  if (!installed.has(menu)) { installed.add(menu); module.installMpScreens(menu); }
  return module;
}
export function installMpScreens(menu) {
  if (window.__multiplayer?.pendingCode || window.__multiplayer?.pendingResume || window.__multiplayer?.active) void ready(menu);
}
export const isMpScreen = screen => ['mp', 'mpLobby', 'mpCars', 'mpResults'].includes(screen);
export const syncFlag = (...args) => module?.syncFlag(...args);
export const afterShow = (...args) => module?.afterShow(...args);
export const afterRender = (...args) => module?.afterRender(...args);
export const detachStage = (...args) => module?.detachStage(...args);
export const back = (...args) => module?.back(...args);
export const act = (...args) => module?.act(...args);
export const change = (...args) => module?.change(...args);
export const renderMp = (...args) => module?.renderMp(...args) || '';
export const renderLobby = (...args) => module?.renderLobby(...args) || '';
export const renderCars = (...args) => module?.renderCars(...args) || '';
export const renderResults = (...args) => module?.renderResults(...args) || '';
export const openEntry = async (menu, ...args) => (await ready(menu)).openEntry(menu, ...args);
export const openRoom = async menu => (await ready(menu)).openRoom(menu);
