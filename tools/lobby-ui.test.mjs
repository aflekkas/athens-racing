import test from 'node:test';
import assert from 'node:assert/strict';
import { wantedScreen, driverRow, shownValue, setPending, renderLobby, renderMp, renderCars, renderResults, form, isMpScreen, helpText, change } from '../src/ui/mp-screens.js';

// A Multiplayer stand-in with just the state the screens read (src/multiplayer.js owns the real one).
function fakeMp({ host = true, players, status = 'waiting', lobbies } = {}) {
  const mp = {
    id: host ? 'a' : 'b', connected: true, worldReady: true, canChangeCar: true, preparing: null, creating: false, objectiveMode: null,
    cars: [{ id: 'mini', name: 'Mini Cooper S', short: 'MINI', power: 141, drive: 'fwd' }, { id: 'z4', name: 'BMW Z4', short: 'Z4', power: 285, drive: 'rwd' }, { id: 'police_x', name: 'Police', short: 'POL', power: 200, drive: 'rwd' }],
    maps: [{ id: 'riviera', name: 'ATHENS RIVIERA' }, { id: 'penteli', name: 'PENTELI' }],
    lobby: { code: 'ABC123', name: 'TEST RUN', host: 'a', status, mode: 'sprint', mapId: 'riviera', config: { time: 'afternoon', weather: 'clear', police: false, traffic: 1 },
      players: players || [{ id: 'a', name: 'GR-1001', car: 'mini', ready: false, loaded: true }, { id: 'b', name: 'GR-2002', car: 'z4', ready: false, loaded: true }] },
    get me() { return this.lobby?.players.find((p) => p.id === this.id); },
    get allowedCars() { return this.cars.map((c) => c.id); },
    $: () => ({ textContent: 'Connected · 12 ms · 2/8 drivers' }),
    ranking() { return this.lobby.results || this.lobby.players; },
    resultRowText: () => '',
    __lobbies: lobbies,
  };
  return mp;
}
const menu = { h: { fmtTime: (t) => t.toFixed(2) } };

test('the multiplayer state picks the screen: join/host without a lobby, the room while in one, results after a race', () => {
  assert.equal(wantedScreen({ lobby: null }, 'mpLobby'), 'mp');
  const mp = fakeMp();
  assert.equal(wantedScreen(mp, 'mp'), 'mpLobby');
  assert.equal(wantedScreen(mp, 'mpCars'), 'mpCars', 'the host stays on the allowed-car rules');
  assert.equal(wantedScreen(fakeMp({ host: false }), 'mpCars'), 'mpLobby', 'guests never see host rules');
  assert.equal(wantedScreen(fakeMp({ status: 'results' }), 'mpLobby'), 'mpResults');
  assert.equal(wantedScreen(fakeMp({ status: 'race' }), 'mpLobby'), 'mpLobby');
  assert.ok(['mp', 'mpLobby', 'mpCars', 'mpResults'].every(isMpScreen) && !isMpScreen('settings') && !isMpScreen('car'));
});

test('driver rows report ready, loading, reconnecting and race states', () => {
  const l = { host: 'a', status: 'waiting' };
  assert.equal(driverRow({ id: 'a', loaded: true, ready: true }, l, 'a').text, 'READY');
  assert.equal(driverRow({ id: 'b', loaded: false }, l, 'a').text, 'LOADING');
  assert.equal(driverRow({ id: 'b', loaded: true, connected: false }, l, 'a').text, 'RECONNECTING');
  assert.equal(driverRow({ id: 'b', loaded: true, finish: 81.2 }, { ...l, status: 'race' }, 'a').text, 'FINISHED');
  const me = driverRow({ id: 'a', loaded: true }, l, 'a'); assert.ok(me.me && me.host);
});

test('a host edit stays on screen until the lobby echoes it, then follows the server', () => {
  setPending('time', 'night', 1000);
  assert.equal(shownValue('time', 'afternoon', 1500), 'night', 'a publish in between cannot flick it back');
  assert.equal(shownValue('time', 'night', 1600), 'night');
  assert.equal(shownValue('time', 'dawn', 1700), 'dawn', 'cleared once echoed');
  setPending('police', true, 0); assert.equal(shownValue('police', false, 10000), false, 'and expires');
});

test('a lobby update changes only the markup of what changed, so the menu morph leaves the rest of the screen alone', () => {
  const mp = fakeMp(), before = renderLobby(menu, mp);
  assert.equal(renderLobby(menu, mp), before, 'same state, same markup: a no-op patch');
  mp.lobby = { ...mp.lobby, players: mp.lobby.players.map((p) => (p.id === 'b' ? { ...p, ready: true } : p)) };
  const after = renderLobby(menu, mp), a = before.split('<'), b = after.split('<');
  assert.equal(a.length, b.length, 'no row added or removed');
  const changed = a.filter((t, i) => t !== b[i]);
  assert.ok(changed.length > 0 && changed.length <= 3, `only the driver's light and state change (${changed.length} tags)`);
  assert.ok(changed.every((t) => /data-state|NOT READY/.test(t)), changed.join(' | '));
});

test('the host gets separate KICK and BLOCK on other drivers; guests see the setup read-only and no host controls', () => {
  const host = renderLobby(menu, fakeMp());
  assert.equal((host.match(/data-act="mpKick"/g) || []).length, 1);
  assert.equal((host.match(/data-act="mpBlock"/g) || []).length, 1);
  assert.match(host, /data-act="mpStart"/); assert.match(host, /data-scope="mpCfg"/);
  assert.match(host, /CAR RULES/, 'the allow-list row is now the car rules entry');
  assert.match(host, /OPEN · ANY CAR · 2 OF 2 CARS/, 'the rules summary counts garage cars only');
  assert.match(host, /data-key="traffic"/); assert.match(host, /data-key="reverse"/);
  assert.match(host, /data-key="policeMode"/, 'POLICE: OFF / RELAXED / NORMAL / TOUGH'); assert.doesNotMatch(host, /UNAVAILABLE ONLINE|data-key="busted"/, 'CAN BE BUSTED only while police are on');
  const guest = renderLobby(menu, fakeMp({ host: false }));
  assert.doesNotMatch(guest, /mpKick|mpBlock|mpStart|mpForce|data-scope="mpCfg"/);
  assert.match(guest, /ATHENS RIVIERA/); assert.match(guest, /NORMAL/); assert.match(guest, /data-act="mpReady"/);
  assert.doesNotMatch(host + guest, /<input|<textarea|chat/i, 'the lobby is chat-free');
  assert.match(helpText(fakeMp({ host: false }), fakeMp().lobby, false), /host starts/);
});

test('join lights up at six characters and lists open lobbies; full ones are not selectable', () => {
  form.tab = 'join'; form.code = 'AB1';
  const lobbies = [{ code: 'QWE123', name: 'NIGHT', mapId: 'penteli', status: 'waiting', capacity: 8, players: [{}] }, { code: 'FULL88', name: 'FULL', status: 'waiting', capacity: 2, players: [{}, {}] }];
  const mp = fakeMp({ lobbies }); mp.lobby = null;
  const short = renderMp(menu, mp, { tab: 'join' });
  assert.match(short, /btn--primary[^"]*off[^"]*" role="button" data-act="mpJoinCode"/);
  form.code = 'AB12CD';
  assert.doesNotMatch(renderMp(menu, mp, { tab: 'join' }), /off[^"]*" role="button" data-act="mpJoinCode"/);
  const list = renderMp(menu, mp, { tab: 'join' });
  assert.match(list, /data-code="QWE123"/); assert.match(list, /PENTELI/);
  assert.match(list, /list-row off[^"]*" role="button" data-act="mpJoinLobby" data-fid="lobby:FULL88"/, 'a full lobby is not selectable');
  assert.doesNotMatch(list, /mpRefresh/, 'the list stays live without a REFRESH button');
  assert.match(list, /id="carStage"[^>]*data-ui-keep="stage"/, 'the showroom stage survives in-place refreshes');
  const hostTab = renderMp(menu, mp, { tab: 'host' });
  assert.match(hostTab, /data-act="mpCreate"/); assert.match(hostTab, /data-key="map"/);
  form.code = '';
});

test('allowed cars and results render from lobby state', () => {
  const cars = renderCars(menu, fakeMp());
  assert.equal((cars.match(/data-scope="mpAllow"/g) || []).length, 2, 'garage cars only');
  assert.match(cars, /data-key="preset"/, 'the host picks a speed-range ruleset first');
  assert.match(cars, /ADVANCED · PER-CAR OVERRIDE/, 'the per-car list survives as an override');
  const ruled = fakeMp(); ruled.carRules = { preset: 'same-class', class: 'C', maxPI: null, category: null, spec: null, balanced: false, allowedCars: null };
  const limited = renderCars(menu, ruled);
  assert.equal((limited.match(/data-scope="mpAllow"/g) || []).length, 1, 'only class-C trims stay toggleable');
  assert.match(limited, /class A · this lobby races class C/, 'the rest grey out with the reason');
  const sent = []; globalThis.window = { __multiplayer: { ...ruled, allowedCars: ['mini', 'z4'], setCarRules: (p) => { sent.push(p); return true; } } };
  const m = { refresh() {} }, el = (scope, key) => ({ dataset: { scope, key } });
  change(m, { key: 'preset', value: 'max-pi', el: el('mpRules', 'preset') });
  assert.deepEqual(sent, [{ preset: 'max-pi', maxPI: 420 }], 'switching preset seeds the cap from the host car');
  change(m, { key: 'class', value: 'B', el: el('mpRules', 'class') });
  assert.deepEqual(sent[1], { class: 'B' });
  delete globalThis.window;
  const mp = fakeMp({ status: 'results' }); mp.lobby.results = [{ id: 'a', name: 'GR-1001', car: 'mini', finish: 80.5 }, { id: 'b', name: 'GR-2002', car: 'z4', dnf: 'retired' }];
  const res = renderResults(menu, mp);
  assert.match(res, /P1/); assert.match(res, /80\.50/); assert.match(res, /DNF/); assert.match(res, /data-act="mpStart"/);
  const guest = fakeMp({ host: false, status: 'results' }); guest.lobby.results = mp.lobby.results;
  assert.doesNotMatch(renderResults(menu, guest), /mpStart|mpToLobby/);
});


test('a finisher sees live results before the rest of the field, with no early rematch', () => {
  const mp = fakeMp({ status: 'race' });
  mp.me.finish = 80.5;
  mp.lobby.players[0].finish = 80.5;
  assert.equal(wantedScreen(mp, 'mpLobby'), 'mpResults');
  const html = renderResults(menu, mp);
  assert.match(html, /80\.50/); assert.match(html, /RACING/);
  assert.match(html, /Live standings/); assert.match(html, /data-act="shareResult"/);
  assert.doesNotMatch(html, /data-act="mpStart"|data-act="mpToLobby"|data-act="mpCar"/);
});

test('the host sets POLICE and CAN BE BUSTED for everyone; guests read them', () => {
  const mp = fakeMp(); mp.lobby.config = { ...mp.lobby.config, police: true, policeLevel: 'tough', busted: false };
  const host = renderLobby(menu, mp);
  assert.match(host, /data-key="policeMode"/); assert.match(host, /data-key="busted"/);
  assert.match(renderLobby(menu, { ...fakeMp({ host: false }), lobby: { ...mp.lobby, host: 'a' } }), /TOUGH · NO ARRESTS/);
  const sent = []; globalThis.window = { __multiplayer: { ...mp, setLobbyConfig: (p) => { sent.push(p); return true; } } };
  const el = (key) => ({ dataset: { scope: 'mpCfg', key } }), m = { refresh() {} };
  change(m, { key: 'policeMode', value: 'relaxed', el: el('policeMode') });
  change(m, { key: 'policeMode', value: 'off', el: el('policeMode') });
  change(m, { key: 'busted', value: 'true', el: el('busted') });
  assert.deepEqual(sent, [{ police: true, policeLevel: 'relaxed' }, { police: false }, { busted: true }]);
  delete globalThis.window;
});
