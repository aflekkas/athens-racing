import { importWithUpdate } from '../client-release.js';
// MULTIPLAYER SCREENS: Join / Host, the lobby room, allowed cars and results, rendered by src/menu.js as ordinary head-unit
// screens (C.screen: the same status bar, Back, focus / gamepad navigation, slide-in and soft-key bar as every other menu).
// src/multiplayer.js keeps transport, lobby state and its native #multiplayer panel. That panel stays in the DOM, never
// shown, as the source of truth tools can drive; its `hidden` flag still means "the multiplayer UI is up" for main.js.
// This module:
//   * renders the screens from window.__multiplayer state (string builders, no DOM writes),
//   * maps their actions onto the public Multiplayer API (createLobby, setLobbyConfig, changeCar, kickPlayer, ...),
//   * bridges the two: a lobby publish, a discovery list or a status line patches the open screen in place
//     (Menu.refresh -> C.morph touches only rows whose markup changed), so an update never rebuilds the screen,
//     flashes, resets an input or moves focus; and the panel's hidden flag follows the menu screen.
import * as C from './components.js';
import { notifications } from './notifications.js';
import { TIMES, WEATHERS, TRAFFIC_LEVELS, POLICE_LEVELS } from '../race-setup.js';
import { configFromLobby, describeMode } from '../mp-setup.js';
import { carCategory, classLabel, inGarage, GARAGE_CLASSES, sortTrims } from '../car-catalog.js';
import { classifyCar, PI_CLASSES } from '../car-performance.js';
import { defaultCarRules, describeRules, carEligibility } from '../mp-car-rules.js';
import { driverName } from '../driver-name.js';

const { esc, icon } = C;
export const MP_SCREENS = ['mp', 'mpLobby', 'mpCars', 'mpResults'];
export const isMpScreen = (s) => MP_SCREENS.includes(s);
const MODES = [['sprint', 'QUICK RACE', 'flag-checkered'], ['free', 'FREE ROAM', 'car-profile']];
const MAX_DRIVERS = 8;
const weatherIcon = (v) => (v === 'rain' ? 'cloud-rain' : v === 'overcast' ? 'cloud' : 'sun');
const timeIcon = (v) => (v === 'night' ? 'moon' : v === 'sunset' || v === 'dawn' ? 'sun-horizon' : 'sun');
const label = (list, v) => list.find(([id]) => id === v)?.[1] || String(v ?? '').toUpperCase();
const TRAFFIC = TRAFFIC_LEVELS.map(([, v, t]) => [v, t]);
const trafficLabel = (v) => TRAFFIC.find(([x]) => +x === +v)?.[1] || 'NORMAL';
// Police are part of the shared world (src/mp-shared-world.js): the host's POLICE level and CAN BE BUSTED apply to all.
const policeLabel = (cfg) => cfg.police === true ? label(POLICE_LEVELS, cfg.policeLevel || 'normal') + (cfg.busted === false ? ' · NO ARRESTS' : '') : 'OFF';

/** The Join / Host form survives screen switches and lobby updates (the menu may re-show 'mp' with fresh data). */
export const form = { tab: 'join', code: '', name: '', map: null, mode: 'sprint', private: false };
/** The room the player closed with Back: lobby publishes in the same phase do not pop it back open (a new phase, such as
 *  the results after a race, still does). Read through the Multiplayer inputOverlayOpen hook. */
let dismissed = null;
const phaseKey = (mp) => (mp?.lobby ? `${mp.lobby.code}:${mp.lobby.status}:${mp.lobby.raceId || ''}:${mp.me?.finish != null ? 'finished' : 'running'}` : null);
/** Host edits shown until the server echoes them, so a publish in between cannot flick a control back. */
const pending = new Map();
const PENDING_MS = 2500;

// ---------------------------------------------------------------- state -> screen
/** the screen the multiplayer state calls for: the room while in a lobby, results after a race, else Join / Host */
export function wantedScreen(mp, current) {
  const l = mp?.lobby;
  if (!l) return 'mp';
  if (l.status === 'results' || mp.me?.finish != null) return 'mpResults';
  if (current === 'mpCars' && l.host === mp.id && l.status === 'waiting') return 'mpCars';
  return 'mpLobby';
}
/** one driver row's facts; state is the ready / loading / connection light */
export function driverRow(p, lobby, me) {
  const racing = ['countdown', 'race'].includes(lobby.status) || lobby.status === 'results';
  const state = p.connected === false ? ['away', 'RECONNECTING'] : racing ? (p.dnf ? ['away', 'DNF'] : p.finish != null ? ['ready', 'FINISHED'] : ['wait', 'RACING'])
    : !p.loaded ? ['load', 'LOADING'] : p.ready ? ['ready', 'READY'] : ['wait', 'NOT READY'];
  return { id: p.id, name: p.name, me: p.id === me, host: p.id === lobby.host, car: p.car, state: state[0], text: state[1] };
}
/** a host edit stays on screen until the lobby reports it (or it times out) */
export function shownValue(key, server, now = Date.now()) {
  const p = pending.get(key); if (!p) return server;
  if (String(p.value) === String(server) || now - p.at > PENDING_MS) { pending.delete(key); return server; }
  return p.value;
}
export function setPending(key, value, now = Date.now()) { pending.set(key, { value, at: now }); }

const statusText = (mp) => mp?.$?.('mp-status')?.textContent || '';
const carOf = (mp, id) => mp?.cars?.find((c) => c.id === id);
const mapName = (mp, id) => mp?.maps?.find((m) => m.id === (id || 'riviera'))?.name || 'ATHENS RIVIERA';
const statusChip = (mp) => C.chip(`${mp?.preparing ? C.spinner() : ''}${esc(statusText(mp) || 'Connecting…')}`, { tone: mp?.connected ? '' : 'warn', icon: mp?.preparing ? null : mp?.connected ? 'globe' : 'warning', cls: 'mp-status', attrs: { role: 'status' } });
/** the car the session will use: yours in the lobby, otherwise the car you would join or host with */
export function showroomCar(mp) { return mp?.lobby ? mp.me?.car : mp?.$?.('mp-car')?.value || mp?.cars?.[mp?.hooks?.carIndex?.() ?? 0]?.id; }

// ---------------------------------------------------------------- the showroom frame (home-screen layout)
// The selected car stands large in the middle as a live studio render (car-select.js mountCarSelect, lite); a slim
// right-hand column of head-unit panels floats beside it. No map world is needed. #carStage is data-ui-keep="stage",
// so in-place refreshes never touch the canvas; afterRender() mounts, keeps or swaps the studio.
const STAGE = '<div id="carStage" class="mp-stage" data-ui-keep="stage" aria-hidden="true"></div>';
function carPlate(mp, car, extra = '') {
  const spec = car ? `${esc(classLabel(carCategory(car)))} · ${Math.round(car.power * 1.341)} HP · ${esc(String(car.drive || '').toUpperCase())}` : '';
  return `<div class="mp-plate"><span class="kick">YOUR CAR</span><b class="mp-plate__name">${esc(car?.name || '—')}</b><span class="mp-plate__spec">${spec}</span>
    <div class="mp-plate__acts">${C.button({ label: 'CHANGE CAR', icon: 'car-profile', variant: 'ghost', size: 'sm', act: 'mpCar', disabled: !mp?.canChangeCar, attrs: { 'data-fid': 'car' } })}${extra}</div></div>`;
}
const showroom = ({ cls = '', caption, plate, side }) => `<div class="mp-show ${cls}">${STAGE}<div class="mp-show__cap">${caption}</div>${plate}<aside class="mp-side scroll-y">${side}</aside></div>`;

// ---------------------------------------------------------------- Join / Host
export function renderMp(menu, mp, d = {}) {
  const tab = form.tab = d.tab || form.tab || 'join';
  const tabs = C.tabs({ key: 'mpTab', value: tab, options: [['join', 'JOIN', 'users-three'], ['host', 'HOST', 'plus']], cls: 'mp-tabs' });
  const caption = `${C.sheetHead({ kick: 'MULTIPLAYER', title: tab === 'host' ? 'HOST A GAME' : 'JOIN A GAME' })}
    <p class="mp-show__sub">2–${MAX_DRIVERS} drivers · player collisions on · rejoin within 90 seconds</p>`;
  return C.screen({ cls: 'scr--mp scr--showroom', kick: 'MULTIPLAYER <span class="acc">/</span> LIVE RACING',
    hints: [['updown', 'SELECT'], ['tabs', 'JOIN / HOST'], ['confirm', 'OK'], ['back', 'BACK']],
    body: showroom({ cls: 'mp-show--entry', caption, plate: carPlate(mp, carOf(mp, showroomCar(mp))), side: `<div class="mp-side__bar">${tabs}${statusChip(mp)}</div>${tab === 'host' ? hostBody(mp) : joinBody(mp)}` }) });
}
function joinBody(mp) {
  const ready = /^[A-Z0-9]{6}$/.test(form.code);
  const join = C.panel('JOIN BY CODE', `${C.textField({ name: 'code', label: 'LOBBY CODE', value: form.code, placeholder: 'ABC123', maxlength: 6, inputCls: 'mp-code', attrs: { 'data-default': '' }, inputAttrs: { autocapitalize: 'characters', enterkeyhint: 'go' } })}
    <div class="mp-go">${C.button({ label: 'JOIN LOBBY', icon: 'sign-in', iconRight: 'caret-right', variant: 'primary', block: true, act: 'mpJoinCode', disabled: !ready || !mp?.connected, attrs: { 'data-fid': 'join' } })}</div>`, { icon: 'link', cls: 'mp-join' });
  const lobbies = mp?.__lobbies || [];
  const rows = lobbies.length ? lobbies.map((l) => {
    const full = l.players.length >= l.capacity, open = l.status === 'waiting';
    return C.listRow({ title: esc(l.name), desc: `${esc(mapName(mp, l.mapId))} · ${esc(l.event?.name || 'QUICK RACE')}`, act: 'mpJoinLobby', fid: 'lobby:' + l.code, disabled: full, attrs: { 'data-code': l.code },
      meta: C.chip(`${l.players.length}/${l.capacity}`, { icon: 'users-three' }) + C.chip(full ? 'FULL' : open ? 'OPEN' : 'RACING', { tone: open && !full ? 'accent' : '' }) });
  }).join('') : `<p class="empty">NO OPEN LOBBIES YET · HOST ONE AND INVITE DRIVERS</p>`;
  // discovery is re-requested while this screen is up (installMpScreens), so the list stays live without a button
  const browse = C.panel('OPEN LOBBIES', `<div class="mp-lobby-list">${rows}</div>`, { icon: 'globe', cls: 'mp-browse', right: C.chip('LIVE', { tone: 'accent', cls: 'mp-live' }) });
  return join + browse;
}
function hostBody(mp) {
  const maps = mp?.maps || [], map = maps.some((m) => m.id === form.map) ? form.map : (maps.some((m) => m.id === mp?.mapId) ? mp.mapId : maps[0]?.id);
  form.map = map || form.map;
  const A = { 'data-scope': 'mpHost' }, draft = mp?.pendingDraft, cfg = draft?.config;
  const rows = [
    C.textField({ name: 'name', label: 'LOBBY NAME', value: form.name, placeholder: (driverName.get() || 'MY') + '’S RACE', maxlength: 28, inputAttrs: { enterkeyhint: 'done' } }),
    maps.length ? C.select({ key: 'map', label: 'TRACK', icon: 'map-trifold', value: map, options: maps.map((m) => [m.id, esc(m.name)]), attrs: A }) : '',
    C.segmented({ key: 'mode', label: 'MODE', icon: 'flag-checkered', value: form.mode, options: MODES, attrs: A }),
    C.segmented({ key: 'private', label: 'WHO CAN JOIN', icon: 'lock-simple', value: String(form.private), type: 'bool', options: [['false', 'ANYONE'], ['true', 'INVITE ONLY']], attrs: A }),
  ].join('');
  const note = cfg ? `<p class="group__note">${icon('sliders-horizontal')} Uses your race setup: ${esc(label(TIMES, cfg.time))} · ${esc(label(WEATHERS, cfg.weather))} · ${esc(trafficLabel(cfg.traffic).toLowerCase())} traffic. You can change it in the lobby.</p>`
    : '<p class="group__note">Time of day, weather, traffic and police are set in the lobby. Share the code so friends can join.</p>';
  return C.panel('NEW LOBBY', `<div class="mp-fields">${rows}</div>${note}
    <div class="mp-go">${C.button({ label: mp?.creating ? 'CREATING…' : 'CREATE LOBBY', icon: 'plus', iconRight: 'caret-right', variant: 'primary', block: true, act: 'mpCreate', disabled: !!mp?.creating || !mp?.connected, attrs: { 'data-default': '', 'data-fid': 'create' } })}</div>`, { icon: 'users-three', cls: 'mp-host' });
}

// ---------------------------------------------------------------- lobby room
export function renderLobby(menu, mp) {
  const l = mp?.lobby;
  if (!l) return C.screen({ cls: 'scr--mp', kick: 'MULTIPLAYER', title: 'LOBBY', body: statusChip(mp), hints: [['back', 'BACK']] });
  const host = l.host === mp.id, waiting = l.status === 'waiting', me = mp.me, cfg = configFromLobby(l), mode = l.mode || l.event?.type || 'sprint';
  const A = { 'data-scope': 'mpCfg' }, live = ['countdown', 'race'].includes(l.status);
  let session;
  if (host && waiting) {
    const time = shownValue('time', cfg.time), weather = shownValue('weather', cfg.weather), traffic = shownValue('traffic', cfg.traffic ?? 1), reverse = String(shownValue('reverse', cfg.reverse === true)), modeV = shownValue('mode', mode), mapV = shownValue('mapId', l.mapId || 'riviera');
    const police = shownValue('police', cfg.police === true) === true, policeLevel = shownValue('policeLevel', cfg.policeLevel || 'normal'), busted = String(shownValue('busted', cfg.busted !== false));
    const garageCars = (mp.cars || []).filter(inGarage), allowedSet = new Set(mp.allowedCars), garage = garageCars.length, allowed = garageCars.filter((c) => allowedSet.has(c.id)).length;
    session = [
      C.select({ key: 'mapId', label: 'TRACK', icon: 'map-trifold', value: mapV, options: (mp.maps.length ? mp.maps : [{ id: mapV, name: mapName(mp, mapV) }]).map((m) => [m.id, esc(m.name)]), attrs: { ...A, ...(mp.preparing ? { 'aria-disabled': 'true' } : {}) } }),
      C.segmented({ key: 'mode', label: 'MODE', icon: 'flag-checkered', value: modeV, options: MODES, attrs: A }),
      C.select({ key: 'time', label: 'TIME OF DAY', icon: timeIcon(time), value: time, options: TIMES, attrs: A }),
      C.segmented({ key: 'weather', label: 'WEATHER', icon: weatherIcon(weather), value: weather, options: WEATHERS.map(([v, t]) => [v, t, weatherIcon(v)]), attrs: A }),
      C.segmented({ key: 'traffic', label: 'TRAFFIC', icon: 'traffic-cone', value: traffic, type: 'num', options: TRAFFIC, attrs: A }),
      ...(modeV === 'sprint' ? [C.segmented({ key: 'reverse', label: 'DIRECTION', icon: 'arrows-left-right', value: reverse, type: 'bool', options: [['false', 'FORWARD'], ['true', 'REVERSE']], attrs: A })] : []),
      C.segmented({ key: 'policeMode', label: 'POLICE & LAWS', icon: 'police-car', value: police ? policeLevel : 'off', options: [['off', 'OFF'], ...POLICE_LEVELS], attrs: A }),
      ...(police ? [C.segmented({ key: 'busted', label: 'CAN BE BUSTED', icon: 'siren', value: busted, type: 'bool', options: [['true', 'ON'], ['false', 'OFF']], attrs: A })] : []),
      C.listRow({ icon: 'car', title: 'CAR RULES', desc: `${esc(typeof mp?.rulesSummary === 'function' ? mp.rulesSummary() : describeRules(mp?.carRules, specNames(mp)))} · ${allowed} OF ${garage} CARS`, act: 'mpCars', fid: 'cars' }),
    ].join('');
  } else {
    session = C.stats([['TRACK', esc(mapName(mp, l.mapId)), { icon: 'map-trifold' }], ['MODE', esc(describeMode(mode)), { icon: 'flag-checkered' }],
      ['TIME OF DAY', esc(label(TIMES, cfg.time)), { icon: timeIcon(cfg.time) }], ['WEATHER', esc(label(WEATHERS, cfg.weather)), { icon: weatherIcon(cfg.weather) }],
      ['TRAFFIC', esc(trafficLabel(cfg.traffic ?? 1)), { icon: 'traffic-cone' }], ['POLICE', esc(policeLabel(cfg)), { icon: 'police-car' }],
      ['CAR RULES', esc(typeof mp?.rulesSummary === 'function' ? mp.rulesSummary() : describeRules(mp?.carRules, specNames(mp))), { icon: 'car' }]], 'mp-facts');
  }
  const rows = l.players.map((p) => {
    const r = driverRow(p, l, mp.id), c = carOf(mp, r.car);
    const ctl = host && !r.me ? `<span class="mp-driver__ctl">${C.button({ label: 'KICK', icon: 'sign-out', variant: 'ghost', size: 'sm', act: 'mpKick', attrs: { 'data-id': p.id, 'data-fid': 'kick:' + p.id, 'aria-label': 'Kick ' + p.name } })}${C.button({ label: 'BLOCK', icon: 'x', variant: 'ghost', size: 'sm', act: 'mpBlock', cls: 'mp-block', attrs: { 'data-id': p.id, 'data-fid': 'block:' + p.id, 'aria-label': 'Block ' + p.name } })}</span>` : '';
    return `<div class="mp-driver ${r.me ? 'me' : ''}" data-player="${esc(p.id)}"><i class="mp-dot" data-state="${r.state}"></i>
      <span class="mp-driver__who"><b>${esc(r.name)}</b>${r.me ? C.chip('YOU', { tone: 'accent' }) : ''}${r.host ? C.chip('HOST', { tone: 'gold', icon: 'crown' }) : ''}</span>
      <span class="mp-driver__car">${esc(c?.short || r.car || '')}${p.balance && (p.balance.ballastKg > 0 || p.balance.powerCapKW > 0) ? ` · ${esc(p.balance.label)}` : ''}</span><span class="mp-driver__state" data-state="${r.state}">${r.text}</span>${ctl}</div>`;
  }).join('');
  const blocked = host ? (l.blockedPlayers || []) : [];
  const blockedList = blocked.length ? `<div class="mp-blocked"><h4 class="mp-sub">${icon('x')}BLOCKED</h4>${blocked.map((p) => `<div class="mp-driver mp-driver--blocked"><span class="mp-driver__who"><b>${esc(p.name)}</b></span>${C.button({ label: 'UNBLOCK', variant: 'ghost', size: 'sm', act: 'mpUnblock', attrs: { 'data-id': p.id, 'data-fid': 'unblock:' + p.id } })}</div>`).join('')}</div>` : '';
  const allReady = l.players.length >= 2 && l.players.every((p) => p.ready && p.loaded && p.connected !== false);
  const connected = l.players.filter((p) => p.connected !== false).length;
  // the race actions sit under the car, like PLAY on the home screen
  const acts = [];
  if (waiting) {
    acts.push(C.button({ label: me?.ready ? 'READY · CANCEL' : 'READY TO RACE', icon: me?.ready ? 'check' : 'flag-checkered', variant: host || me?.ready ? 'secondary' : 'primary', act: 'mpReady', disabled: !mp.worldReady, cls: me?.ready ? 'is-on' : '', attrs: { 'data-default': '', 'data-fid': 'ready' } }));
    if (host) acts.push(C.button({ label: 'START RACE', icon: 'play', variant: 'primary', act: 'mpStart', disabled: !mp.worldReady || !allReady, attrs: { 'data-fid': 'start' } }),
      C.button({ label: 'FORCE START', variant: 'ghost', size: 'sm', act: 'mpForce', disabled: !mp.worldReady || connected < 2, attrs: { 'data-fid': 'force' } }));
  } else if (live) {
    acts.push(C.button({ label: 'BACK TO THE RACE', icon: 'play', variant: 'primary', act: 'back', attrs: { 'data-default': '', 'data-fid': 'resume' } }));
    if (host) acts.push(C.button({ label: 'RESTART', icon: 'arrow-counter-clockwise', act: 'mpRestart', attrs: { 'data-fid': 'restart' } }), C.button({ label: 'BACK TO LOBBY', icon: 'users-three', act: 'mpToLobby', attrs: { 'data-fid': 'tolobby' } }));
  }
  const caption = `${C.sheetHead({ kick: `LOBBY · ${live ? 'RACE IN PROGRESS' : waiting ? 'WAITING FOR DRIVERS' : 'RESULTS'}`, title: `${esc(l.name)}` })}
    <div class="mp-show__meta">${C.chip(esc(l.code || ''), { tone: 'accent', icon: 'lock-simple', attrs: { title: 'Lobby code' } })}${C.chip(esc(mapName(mp, l.mapId)), { icon: 'map-trifold' })}${C.chip(esc(describeMode(mode)), { icon: 'flag-checkered' })}</div>`;
  const tools = `<div class="mp-side__bar">${statusChip(mp)}<div class="mp-tools">${C.button({ label: 'INVITE', icon: 'link', variant: 'ghost', size: 'sm', act: 'mpCopy', attrs: { 'data-fid': 'copy' } })}${C.button({ icon: 'gear-six', variant: 'ghost', size: 'sm', act: 'settings', title: 'SETTINGS', attrs: { 'data-fid': 'settings' } })}${C.button({ label: 'LEAVE', icon: 'sign-out', variant: 'ghost', size: 'sm', act: 'mpLeave', cls: 'mp-leave', attrs: { 'data-fid': 'leave' } })}</div></div>`;
  const sessionPanel = C.panel('SESSION', `<div class="mp-fields">${session}</div>`, { icon: 'sliders-horizontal', cls: 'mp-session' });
  const drivers = C.panel(`DRIVERS <span class="mp-count">${l.players.length}/${MAX_DRIVERS}</span>`, `<div class="mp-drivers__list">${rows}${blockedList}</div><p class="mp-help">${esc(helpText(mp, l, host))}</p>`, { icon: 'users-three', cls: 'mp-drivers' });
  return C.screen({ cls: 'scr--mp scr--showroom scr--mp-lobby', kick: `MULTIPLAYER <span class="acc">/</span> ${live ? 'RACE IN PROGRESS' : 'LOBBY'}`,
    hints: [['updown', 'SELECT'], ['leftright', 'CHANGE'], ['confirm', 'OK'], ['back', 'CLOSE']],
    body: showroom({ cls: 'mp-show--lobby', caption, plate: carPlate(mp, carOf(mp, me?.car), `<div class="mp-actions">${acts.join('')}</div>`), side: tools + drivers + sessionPanel }) });
}

// ---------------------------------------------------------------- the live studio behind the showroom screens
const SHOWROOM = ['mp', 'mpLobby'];
let studio = null, mounting = 0; // { carId, el, view }
export function disposeStage() { mounting++; studio?.view?.dispose?.(); studio = null; }
/** before a full render: lift the live stage out so the new screen can take it over */
export function detachStage(menu) {
  const el = studio && menu.root.querySelector('#carStage'); if (!el || el !== studio.el) return null;
  el.remove(); return el;
}
/** after any render / patch / hide: keep, swap or mount the studio for the car the session will use */
export function afterRender(menu, kept = null) {
  const mp = typeof window !== 'undefined' ? window.__multiplayer : null;
  if (!menu.open || !SHOWROOM.includes(menu.screen) || !mp) { disposeStage(); return; }
  let el = menu.root.querySelector('#carStage'); if (!el) { disposeStage(); return; }
  if (kept && kept !== el) { el.replaceWith(kept); el = kept; }
  const id = showroomCar(mp), index = (mp.cars || []).findIndex((c) => c.id === id);
  if (studio && studio.el === el && studio.carId === id) return;
  disposeStage(); if (index < 0) return;
  const token = mounting;
  importWithUpdate(() => import('../car-select.js')).then(({ mountCarSelect }) => {
    if (token !== mounting || !el.isConnected) return;
    try { studio = { carId: id, el, view: mountCarSelect(menu.root, index, { container: el, lite: true }) }; } catch (error) { console.warn('Showroom unavailable:', error?.message || error); }
  });
}

/** one line under the driver list: what happens next */
export function helpText(mp, l, host) {
  if (mp.preparing) return 'Loading the lobby track. You can pick your car meanwhile.';
  if (l.status === 'waiting') return host ? 'Start when every driver is ready. FORCE START goes without drivers still loading.' : 'The host starts the race when everyone is ready.';
  if (l.status === 'results') return host ? 'Start a rematch or take everyone back to the lobby.' : 'Waiting for the host to start a rematch.';
  return mp.me?.finish != null ? 'You finished. The race ends when everyone is in, or after ten minutes.' : 'Race in progress. Close this screen to keep driving.';
}

// ---------------------------------------------------------------- car rules (host)
// Speed-range rulesets replace picking cars one by one: the host chooses a
// preset (open / same class / max PI / category / spec / balanced) and the
// server resolves which trims may race. The per-car list survives below as an
// Advanced override that can only narrow the field further.
const RULESET_OPTIONS = [['open', 'OPEN', 'globe'], ['same-class', 'SAME CLASS', 'flag-checkered'], ['max-pi', 'MAX PI', 'gauge'], ['category', 'CATEGORY', 'car-profile'], ['spec', 'SPEC', 'tire'], ['balanced', 'BALANCED', 'sliders-horizontal']];
/** pace facts for every garage trim, used by the rules screen and its reasons */
export function ruleViews(mp) {
  return sortTrims((mp?.cars || []).filter(inGarage)).map((car) => {
    const { pi, class: cls } = classifyCar(car);
    return { car, id: car.id, name: car.short || car.name || car.id, pi, class: cls, category: carCategory(car) };
  });
}
export function specNames(mp) { return Object.fromEntries((mp?.cars || []).map((c) => [c.id, c.short || c.id])); }
/** sensible parameters when the host switches preset, seeded from their own car */
export function rulesDefaults(mp, preset) {
  const myCar = (mp?.cars || []).find((c) => c.id === mp?.me?.car);
  const mine = myCar ? { ...classifyCar(myCar), category: carCategory(myCar) } : null;
  switch (preset) {
    case 'same-class': return { preset, class: mine?.class || 'B' };
    case 'balanced': return { preset, class: mine?.class || 'B', balanced: true };
    case 'max-pi': return { preset, maxPI: mine ? Math.ceil(mine.pi / 10) * 10 : 550 };
    case 'category': return { preset, category: mine?.category || 'hot hatch' };
    case 'spec': return { preset, spec: mp?.me?.car };
    default: return { preset: 'open' };
  }
}
export function renderCars(menu, mp) {
  const l = mp?.lobby, rules = mp?.carRules || defaultCarRules();
  const views = ruleViews(mp), allowed = new Set(mp?.allowedCars || []), R = { 'data-scope': 'mpRules' };
  const eligible = views.filter((v) => carEligibility(v, { ...rules, allowedCars: null }).ok);
  const summary = typeof mp?.rulesSummary === 'function' ? mp.rulesSummary() : describeRules(rules, specNames(mp));
  const counts = {};
  for (const v of views) counts[v.class] = (counts[v.class] || 0) + 1;
  let params = '';
  if (['same-class', 'balanced'].includes(rules.preset)) params = C.segmented({ key: 'class', label: 'CLASS', icon: 'flag-checkered', value: rules.class || 'B', options: PI_CLASSES.map((c) => [c, `${c} · ${counts[c] || 0}`]), attrs: R });
  else if (rules.preset === 'max-pi') params = C.stepper({ key: 'maxPI', label: 'MAX PERFORMANCE INDEX', icon: 'gauge', value: rules.maxPI || 550, min: 150, max: 900, step: 10, format: 'int', attrs: R });
  else if (rules.preset === 'category') params = C.select({ key: 'category', label: 'CATEGORY', icon: 'car-profile', value: rules.category || 'hot hatch', options: GARAGE_CLASSES.map(([id, label]) => [id, label]), attrs: R });
  else if (rules.preset === 'spec') params = C.select({ key: 'spec', label: 'SPEC CAR · EVERYONE THE SAME TRIM', icon: 'tire', value: rules.spec || views[0]?.id, options: views.map((v) => [v.id, `${v.name} · PI ${v.pi} · ${v.class}`]), attrs: R });
  const balanceRow = ['same-class', 'max-pi', 'category'].includes(rules.preset)
    ? C.toggle({ key: 'balanced', label: 'EQUALIZE PACE (BALLAST)', icon: 'sliders-horizontal', value: rules.balanced === true, note: 'The slowest car sets the pace · faster cars carry ballast or a power cap', attrs: R }) : '';
  const rows = views.map((v) => {
    const rule = carEligibility(v, { ...rules, allowedCars: null });
    if (!rule.ok) return C.option({ icon: 'lock-simple', title: `${esc(v.name)} <small>CLASS ${v.class} · PI ${v.pi}</small>`, desc: esc(rule.reason), disabled: true });
    return C.toggle({ key: v.id, label: `${esc(v.name)} <small>CLASS ${v.class} · PI ${v.pi}</small>`, value: allowed.has(v.id), attrs: { 'data-scope': 'mpAllow' } });
  }).join('');
  return C.screen({ cls: 'scr--mp scr--mp-cars', kick: `${esc(l?.name || 'LOBBY')} <span class="acc">/</span> HOST RULES`, title: 'CAR RULES',
    hints: [['updown', 'SELECT'], ['leftright', 'CHANGE'], ['back', 'BACK']],
    body: `<div class="set-panel panel scroll-y"><div class="group"><h3 class="group__title">${icon('sliders-horizontal')}RULESET · ${esc(summary)} · ${eligible.length} OF ${views.length} PASS</h3>
      ${C.segmented({ key: 'preset', label: 'RULESET', icon: 'sliders-horizontal', value: rules.preset, options: RULESET_OPTIONS, attrs: R })}${params}${balanceRow}</div>
      <div class="group"><h3 class="group__title">${icon('car')}ADVANCED · PER-CAR OVERRIDE · ${views.filter((v) => allowed.has(v.id)).length} OF ${views.length} ALLOWED</h3>${rows}</div></div>` });
}

// ---------------------------------------------------------------- results
export function renderResults(menu, mp) {
  const l = mp?.lobby;
  if (!l) return renderLobby(menu, mp);
  const host = l.host === mp.id, ranked = mp.ranking(), mine = ranked.findIndex((p) => p.id === mp.id), me = ranked[mine], fmt = menu.h?.fmtTime || ((t) => t.toFixed(2) + ' S');
  const objective = mp.objectiveMode;
  const title = objective ? `${objective.toUpperCase()} RESULTS` : me?.finish != null ? `P${mine + 1}` : me ? 'DNF' : 'RESULTS';
  const tiles = objective ? [] : [['TIME', me?.finish != null ? fmt(me.finish) : '—'], ['POSITION', me?.finish != null ? `${mine + 1} / ${ranked.length}` : 'DNF'], ['DRIVERS', String(ranked.length)]];
  const rows = ranked.map((p, i) => `<tr class="${p.id === mp.id ? 'me' : ''}"><td class="r-pos">${p.finish != null || objective ? 'P' + (i + 1) : '—'}</td><td>${esc(p.name)}<small>${esc(carOf(mp, p.car)?.short || '')}</small></td><td class="tnum">${objective ? esc(mp.resultRowText(p, i).split(' · ').slice(2).join(' · ')) : p.finish != null ? fmt(p.finish) : p.dnf === 'wrecked' ? 'WRECKED' : p.dnf ? 'DNF' : l.status === 'results' ? 'DNF' : 'RACING'}</td></tr>`).join('');
  const complete = l.status === 'results';
  const personal = globalThis.window?.__game?.result?.personalBest;
  if (personal) tiles.push(['BEST · EXACT SETUP', personal.exact ? fmt(personal.exact.time) : '—'], ['ROUTE BEST · ANY CAR / SETUP', personal.route ? fmt(personal.route.time) : '—']);
  const acts = host && complete ? [C.button({ label: 'REMATCH', icon: 'arrow-counter-clockwise', variant: 'primary', act: 'mpStart', disabled: !mp.worldReady, attrs: { 'data-default': '', 'data-fid': 'rematch' } }), C.button({ label: 'BACK TO LOBBY', icon: 'users-three', act: 'mpToLobby', attrs: { 'data-fid': 'tolobby' } })]
    : [];
  if (me?.finish != null) acts.push(C.button({ label: 'SHARE', icon: 'export', act: 'shareResult', attrs: { 'data-fid': 'share' } }));
  if (complete) acts.push(C.button({ label: 'CHANGE CAR', icon: 'car-profile', act: 'mpCar', attrs: { 'data-fid': 'car', ...(host ? {} : { 'data-default': '' }) } }));
  acts.push(C.button({ label: 'LEAVE LOBBY', icon: 'sign-out', variant: 'ghost', act: 'mpLeave', attrs: { 'data-fid': 'leave' } }));
  return C.screen({ cls: 'scr--results scr--mp scr--mp-results', title: esc(title), kick: `${esc(l.name)} <span class="acc">/</span> ${esc(mapName(mp, l.mapId))} · ${esc(describeMode(l.mode || l.event?.type))}`,
    hints: [['select', 'SELECT'], ['confirm', 'OK'], ['back', 'CLOSE']],
    body: `<div class="res-layout"><div class="res-main"><p class="res-sub">${personal?.newBest ? C.badge('NEW PERSONAL BEST' + (personal.delta < 0 ? ' −' + Math.abs(personal.delta).toFixed(2) + ' s' : ''), 'good', 'timer') : ''}${esc(!complete ? 'Your clock has stopped. Live standings · waiting for the other drivers or the race timeout.' : host ? 'Start a rematch or take everyone back to the lobby.' : 'Waiting for the host to start a rematch.')}</p>
      ${tiles.length ? C.stats(tiles.map(([k, v]) => [k, v]), 'res-stats') : ''}<div class="res-actions">${acts.join('')}</div></div>
      <div class="res-side scroll-y">${C.panel('CLASSIFICATION', `<table class="r-table">${rows}</table>`, { icon: 'flag-checkered' })}</div></div>` });
}

// ---------------------------------------------------------------- navigation
/** open Join / Host (entry: 'join' | 'host'), keeping the screen you came from under Back */
export function openEntry(menu, entry = 'join', draft = null) {
  const mp = window.__multiplayer; if (!mp) return;
  if (mp.lobby) { openRoom(menu); return; }
  form.tab = entry;
  if (draft?.mapId) form.map = draft.mapId;
  if (draft?.mode) form.mode = draft.mode === 'free' ? 'free' : 'sprint';
  mp.open(draft ? { ...draft, entry } : { entry });
  if (mp.pendingCode && !form.code) form.code = String(mp.pendingCode).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  if (isMpScreen(menu.screen)) { menu.data.tab = entry; menu.refresh(); return; }
  menu.show('mp', { tab: entry }, !!menu.screen);
}
/** the lobby room (or results); it replaces whatever the menu showed, so Back closes it */
export function openRoom(menu) {
  const mp = window.__multiplayer; if (!mp) return;
  dismissed = null;
  if (mp.panel.hidden) mp.open();
  menu.show(wantedScreen(mp, menu.screen), {});
}
/** Back on a multiplayer screen */
export function back(menu) {
  const mp = window.__multiplayer, s = menu.screen;
  if (s === 'mpCars') { if (!menu.pop()) menu.show('mpLobby', {}); return; }
  if (s !== 'mp') dismissed = phaseKey(mp);
  mp?.close();
  if (s === 'mp') { if (!menu.pop()) menu.show('title'); return; }
  menu.hide(); // the room / results close onto the road view; pause or G reopens them
}
/** a kick / block notice for the home screen; main.js re-renders the title once more on its way home, so it is
 *  repeated on every title render for a few seconds */
let notice = null;
export function afterShow(menu, screen) {
  if (screen !== 'title' || !notice) return;
  if (Date.now() > notice.until) { notice = null; return; }
  notifications.menuFeedback(notice.text, { tone: 'bad', ms: 6000 }); // the menu row: the race lane is hidden behind menus
}
/** keep main.js's "multiplayer UI is up" flag in step with the menu: only the multiplayer screens raise it */
export function syncFlag(screen) {
  const panel = typeof window !== 'undefined' ? window.__multiplayer?.panel : null; if (!panel) return;
  const hidden = !isMpScreen(screen); if (panel.hidden !== hidden) panel.hidden = hidden;
}

// ---------------------------------------------------------------- actions
export function act(menu, el) {
  const mp = window.__multiplayer, a = el.dataset.act; if (!mp) return false;
  switch (a) {
    case 'mpJoinCode': if (/^[A-Z0-9]{6}$/.test(form.code)) { mp.status('Joining ' + form.code + '…'); mp.action('join', { code: form.code }); } return true;
    case 'mpJoinLobby': mp.status('Joining ' + el.dataset.code + '…'); mp.action('join', { code: el.dataset.code }); return true;
    case 'mpCreate': {
      if (mp.lobby || mp.creating) return true;
      const draft = mp.pendingDraft || {}, keep = draft.mapId === form.map && (draft.mode || 'sprint') === form.mode;
      mp.creating = true; mp.status('Creating lobby…');
      mp.createLobby({ lobbyName: form.name, private: form.private, mapId: form.map || undefined, mode: form.mode, eventId: keep ? draft.eventId : undefined });
      menu.refresh(); return true;
    }
    case 'mpReady': mp.$('mp-ready').click(); return true;
    case 'mpStart': mp.startRace(); return true;
    case 'mpForce': C.ui.prompt({ title: 'START WITHOUT EVERYONE READY?', body: 'Connected drivers will join this round. Drivers still loading can join when their track is ready.', icon: 'flag-checkered',
      actions: [{ id: 'force', label: 'FORCE START', variant: 'primary' }, { id: 'cancel', label: 'KEEP WAITING' }] }).then((c) => { if (c === 'force') mp.startRace({ force: true }); }); return true;
    case 'mpRestart': mp.restart(); return true;
    case 'mpToLobby': mp.returnToLobby(); return true;
    case 'mpCopy': mp.$('mp-copy').click(); return true;
    case 'mpLeave': mp.$('mp-leave').click(); return true;
    case 'mpKick': case 'mpBlock': {
      const id = el.dataset.id, name = mp.lobby?.players.find((p) => p.id === id)?.name || 'this driver', kick = a === 'mpKick';
      C.ui.prompt({ title: (kick ? 'KICK ' : 'BLOCK ') + name + '?', body: kick ? 'They will be removed from the lobby and can rejoin immediately.' : 'Remove this driver and prevent them from rejoining this lobby until you unblock them or the lobby expires.',
        actions: [{ id: 'yes', label: kick ? 'KICK DRIVER' : 'BLOCK DRIVER', variant: 'primary' }, { id: 'cancel', label: 'CANCEL' }] }).then((c) => { if (c === 'yes') (kick ? mp.kickPlayer(id) : mp.blockPlayer(id)); });
      return true;
    }
    case 'mpUnblock': mp.unblockPlayer(el.dataset.id); return true;
    case 'mpCars': menu.show('mpCars', {}, true); return true;
    case 'mpCar': {
      if (!mp.canChangeCar) return true;
      const cars = mp.cars || [], index = Math.max(0, cars.findIndex((c) => c.id === showroomCar(mp)));
      mp.setCarPickerOpen(true);
      // The garage greys out ineligible trims with the ruleset reason; the
      // merged rule (ruleset + effective allow-list) keeps the reason precise.
      menu.show('car', { garage: true, index, allowedCars: mp.allowedCars, rules: { ...(mp.carRules || defaultCarRules()), allowedCars: mp.allowedCars }, onPick(id) { if (mp.changeCar(id) === false) return false; mp.setCarPickerOpen(false); return true; }, onCancel() { mp.setCarPickerOpen(false); } }, true);
      return true;
    }
  }
  return false;
}
/** a kit control changed on a multiplayer screen */
export function change(menu, { key, value, el }) {
  const mp = window.__multiplayer, scope = el.dataset.scope; if (!mp) return false;
  if (el.dataset.kind === 'tabs' && key === 'mpTab') { form.tab = value; menu.data.tab = value; menu.refresh(); return true; }
  if (scope === 'mpHost') { form[key] = key === 'private' ? value === true || value === 'true' : value; menu.refresh(); return true; }
  if (scope === 'mpCfg') {
    if (key === 'mapId' && mp.preparing) { menu.refresh(); return true; }
    if (key === 'policeMode') { // one row: OFF / RELAXED / NORMAL / TOUGH
      const patch = value === 'off' ? { police: false } : { police: true, policeLevel: value };
      for (const [k, v] of Object.entries(patch)) setPending(k, v);
      if (mp.setLobbyConfig(patch) === false) for (const k of Object.keys(patch)) pending.delete(k);
      menu.refresh(); return true;
    }
    const v = key === 'reverse' || key === 'busted' ? value === true || value === 'true' : key === 'traffic' ? Number(value) : value;
    setPending(key, v);
    if (mp.setLobbyConfig({ [key]: v }) === false) pending.delete(key);
    menu.refresh(); return true;
  }
  if (scope === 'mpAllow') {
    const garage = sortTrims((mp.cars || []).filter(inGarage)).map((c) => c.id), all = new Set(mp.allowedCars), allowed = new Set(garage.filter((id) => all.has(id)));
    if (value) allowed.add(key); else allowed.delete(key);
    if (!mp.setAllowedCars([...allowed])) C.ui.toast('KEEP AT LEAST ONE CAR', { icon: 'warning', tone: 'bad' });
    menu.refresh(); return true;
  }
  if (scope === 'mpRules') {
    // Preset switches seed sensible parameters from the host's own car; every
    // other control patches one field. The server echo re-renders the screen.
    const patch = key === 'preset' ? rulesDefaults(mp, value) : { [key]: key === 'maxPI' ? Math.round(Number(value)) : value };
    if (mp.setCarRules(patch) === false) C.ui.toast('ONLY THE HOST CAN CHANGE THE CAR RULES', { icon: 'warning', tone: 'bad' });
    menu.refresh(); return true;
  }
  return false;
}

// ---------------------------------------------------------------- the bridge
/** Hooks the menu to the Multiplayer instance once it exists (main.js creates it after the menu). */
export function installMpScreens(menu) {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const root = menu.root;
  root.addEventListener('input', (e) => {
    const name = e.target.dataset?.field; if (!name || menu.screen !== 'mp') return;
    if (name === 'code') { const v = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6); if (v !== e.target.value) e.target.value = v; form.code = v; }
    else form.name = e.target.value;
    menu.refresh(); // JOIN lights up at six characters; the focused input itself is never rewritten
  });
  root.addEventListener('keydown', (e) => {
    const name = e.target.dataset?.field; if (!name || menu.screen !== 'mp' || e.key !== 'Enter') return;
    e.preventDefault(); e.target.blur(); root.focus({ preventScroll: true });
    const go = root.querySelector(name === 'code' ? '[data-act=mpJoinCode]' : '[data-act=mpCreate]'); if (go) menu.activate(go);
  });
  let mp = null, scheduled = false, attached = false, lastPhase = null;
  const schedule = () => { if (scheduled) return; scheduled = true; requestAnimationFrame(() => { scheduled = false; sync(); }); };
  function sync() {
    if (!mp) return;
    if (C.listboxOpen()) { setTimeout(schedule, 200); return; } // never close a dropdown the player has open
    const visible = !mp.panel.hidden, cur = menu.screen, onMp = isMpScreen(cur), phase = phaseKey(mp), starting = phase !== lastPhase && mp.lobby?.status === 'countdown';
    lastPhase = phase;
    // the race is starting: a lobby sub-screen (car picker, settings) closes with the room, like the room itself
    if (starting && !onMp && menu.stack.some((s) => isMpScreen(s.screen))) { if (cur === 'car') menu.data.onCancel?.(); menu.hide(); return; }
    if (visible && !onMp) {
      // a lobby sub-screen (car picker, settings) is on top: it stays, and the flag follows the menu
      if (menu.stack.some((s) => isMpScreen(s.screen))) { mp.panel.hidden = true; return; }
      if (mp.lobby) openRoom(menu); else menu.show('mp', { tab: form.tab }, !!cur);
      return;
    }
    if (!visible && onMp) {
      if (cur === 'mpCars') { menu.hide(); return; }
      const keep = [...menu.stack].map((s) => isMpScreen(s.screen)).lastIndexOf(false);
      if (keep >= 0) { menu.stack.length = keep + 1; menu.pop(); } else if (mp.lobby) menu.hide(); else menu.show('title');
      return;
    }
    if (!onMp) return;
    const want = wantedScreen(mp, cur);
    if (want !== cur) {
      if (want === 'mp' && ['mpLobby', 'mpResults', 'mpCars'].includes(cur)) { menu.show('title'); return; } // left the lobby: home (main.js follows with its own title)
      menu.show(want, want === 'mp' ? { tab: form.tab } : {}); return;
    }
    menu.refresh();
  }
  const attach = () => {
    mp = window.__multiplayer; if (!mp?.panel) { setTimeout(attach, 60); return; }
    if (attached) return; attached = true; mp.__screens = { schedule, sync };
    const wrap = (name, after) => { const fn = mp[name]; if (typeof fn !== 'function') return; mp[name] = function (...args) { const r = fn.apply(this, args); after?.(...args); schedule(); return r; }; };
    wrap('renderRoom'); wrap('status'); wrap('left');
    wrap('renderDiscovery', (lobbies) => { mp.__lobbies = Array.isArray(lobbies) ? lobbies : []; });
    const kicked = mp.hooks.kicked; mp.hooks.kicked = (m) => { kicked?.(m); notice = { text: String(m?.message || m?.reason || 'Removed from the lobby.'), until: Date.now() + 8000 }; };
    const overlay = mp.hooks.inputOverlayOpen; mp.hooks.inputOverlayOpen = () => !!overlay?.() || (dismissed != null && dismissed === phaseKey(mp));
    new MutationObserver(schedule).observe(mp.panel, { attributes: true, attributeFilter: ['hidden'] });
    if (mp.pendingCode) form.code = String(mp.pendingCode).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    // the server answers discovery on request; while JOIN is up the open-lobby list re-asks, so it stays live
    setInterval(() => { if (menu.screen === 'mp' && form.tab === 'join' && mp.connected && !mp.lobby && !document.hidden) mp.send({ type: 'discover' }); }, 4000);
    // an invite link (?lobby=CODE) opened the panel before the menus existed: open Join once the title is up
    if (!mp.panel.hidden && !mp.lobby) { if (menu.screen === 'title') openEntry(menu, 'join'); else menu.mpBooting = true; }
    schedule();
  };
  attach();
}
