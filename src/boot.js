import { audioLatencyHint, audioLowCost } from './audio/robust.js';
import { importWithUpdate } from './client-release.js';
// Production entry: paint the real menu before fetching the simulation or world builders.
// Native development still enters main.js directly and needs no build step.
import { Menu } from './menu.js';
import { CARS } from './cars.js';
import { inGarage } from './car-catalog.js';
import { menuMapContext, initialMapId, quickMapEvent } from './menu-map.js';
import { freeRoam } from './events.js';
import { settings, onSettings } from './settings.js';
import { input as controls } from './input.js';
import { Audio } from './audio.js';
const query = new URLSearchParams(location.search);
const direct = !query.has('menu') && ['simhook', 'autodrive', 'car', 's', 'event', 'quick', 'fixeddt', 'turbo'].some(key => query.has(key));
if (query.get('map')==='athens' || direct || query.has('lobby')) {
  await (await importWithUpdate(() => import('./main.js'))).gameReady;
} else {
  let mapId = initialMapId(query), car = 0, runtime;
  try { const saved = CARS.findIndex(car => car.id === localStorage.getItem('paraliaki.car')); if (saved >= 0 && inGarage(CARS[saved])) car = saved; } catch {}
  const ensureRuntime = () => runtime ||= importWithUpdate(() => import('./main.js')).then(async module => { await module.gameReady; stopVolumeSync(); menu.h.selectMap(mapId);
    if (window.__multiplayer?.pendingResume || window.__multiplayer?.active || window.__multiplayer?.pendingCode) (await importWithUpdate(() => import('./ui/mp-loader.js'))).installMpScreens(menu);
    return window.__flow; }).catch(error => { runtime = null; throw error; });
  const audio = window.__bootAudio = new Audio();
  audio.latencyHint = audioLatencyHint(settings.perfClass, navigator.hardwareConcurrency); audio.lowCost = audioLowCost(settings.perfClass, navigator.hardwareConcurrency);
  audio.menuRequested = true; audio.setVolumes(settings);
  const stopVolumeSync = onSettings(values => audio.setVolumes(values));
  const unlock = () => { if (!runtime) audio.start(); };
  addEventListener('pointerdown', unlock); addEventListener('keydown', unlock);
  addEventListener('click', unlock);
  const menu = new Menu(document.getElementById('ui'), {
    ctx: () => menuMapContext(mapId), selectMap: id => { mapId = id; },
    carSpec: () => CARS[car], carName: () => CARS[car].name, inputDevice: () => controls.drivingSource, manual: () => settings.transmission === 'manual',
    fmtTime: seconds => (seconds / 60 | 0) + ':' + (seconds % 60).toFixed(3).padStart(6, '0'),
    ensureRuntime, ui: forward => audio.ui?.(forward), bindings: element => controls.openBindings?.(element), cancelBindings: () => controls.cancelCapture?.(),
    garage: () => menu.show('car', { index: car, garage: true }, true),
    chooseCar: async (index, def, garage) => {
      car = index; try { localStorage.setItem('paraliaki.car', CARS[index].id); } catch {}
      if (garage) { menu.back(); return; }
      const flow = await ensureRuntime();
      if (menu.screen !== 'car' || menu.data.def !== def) return;
      await flow.startEvent(def, { car: index });
    },
    openEvent: id => menu.show('car', { def: typeof id === 'object' ? id : quickMapEvent(mapId), index: car }, true),
    quickRace: () => menu.show('car', { def: quickMapEvent(mapId), index: car }, true),
  });
  window.__bootMenu = menu;
  window.__flow = { menu, inMenu: () => true, freeRoamDef: () => freeRoam(mapId) };
  const pollMenu = () => {
    if (runtime) return;
    controls.update(1 / 60, { inMenu: true, blocked: document.hidden });
    for (const action of controls.actions) { if (action === 'garage') menu.h.garage(); else menu.action(action); }
    requestAnimationFrame(pollMenu);
  };
  requestAnimationFrame(pollMenu);
  document.body.classList.add('menu-backdrop', 'loaded'); menu.show('title');
  requestAnimationFrame(() => { performance.mark('menu-ready'); });
  // A saved online session must reconnect even if the visitor has not opened Multiplayer.
  try { if (sessionStorage.getItem('paraliaki.session')) void ensureRuntime(); } catch {}
}
