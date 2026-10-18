// Owner decision 2026-10-18 (docs/OWNER-DECISIONS.md): "just combine the two cards into a multiplayer card please",
// "spin an opus agent on the host vs join game ui", and on RACE "these cards should take up full vertical, and the z index
// should be increased". One MULTIPLAYER title tile, a lobby-browser multiplayer screen with a full-screen host setup, a
// solo RACE screen whose two cards fill the height, and no race-corner button floating over menus.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const OWNER = 'Owner-locked decision 2026-10-18, see docs/OWNER-DECISIONS.md (one MULTIPLAYER tile, lobby-browser multiplayer screen, solo RACE with full-height cards). Ask the owner before changing.';
const read = (path) => readFileSync(path, 'utf8');
async function withDom(fn) {
  const priorDocument = globalThis.document, priorWindow = globalThis.window;
  globalThis.document = { baseURI: 'http://localhost/', querySelector: () => null, body: { classList: { contains: () => false } } };
  globalThis.window = {};
  try { return await fn(); } finally { globalThis.document = priorDocument; globalThis.window = priorWindow; }
}
const fakeMp = (state = {}) => ({
  id: 'me', connected: true, canChangeCar: true, lobby: null, hooks: { carIndex: () => 0 }, $: () => ({ textContent: 'Connected', value: 'mini' }),
  cars: [{ id: 'mini', name: 'Mini Cooper S', short: 'MINI', power: 141, drive: 'fwd' }],
  maps: [{ id: 'riviera', name: 'ATHENS RIVIERA' }, { id: 'penteli', name: 'PENTELI HILL CLIMB' }],
  __lobbies: [{ code: 'NIGHT1', name: 'NIGHT RUN', mapId: 'penteli', mode: 'sprint', status: 'waiting', capacity: 8, host: 'h', players: [{ id: 'h', name: 'GR-4821' }, { id: 'n', name: 'NIKOS' }], config: { time: 'night', weather: 'clear' } }],
  ...state,
});

test('the title has one MULTIPLAYER tile beside PLAY, GARAGE and SETTINGS, and it opens the lobby browser', async () => {
  const { Menu } = await import('../src/menu.js');
  const html = await withDom(() => Menu.prototype.r_title.call({ h: {} }));
  const tiles = [...html.matchAll(/class="mi option [^"]*option--tile[^"]*" role="button" data-act="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(tiles, ['play', 'multiplayer', 'garage', 'settings'], OWNER);
  assert.match(html, /option__title">MULTIPLAYER</, OWNER);
  assert.doesNotMatch(html, /JOIN GAME|HOST \/ CREATE GAME|data-act="mpJoin"|data-act="mpHost"/, OWNER);
  const menu = read('src/menu.js');
  assert.match(menu, /case 'multiplayer':[^\n]*MP\.openEntry\(this, 'join'\)/, OWNER);
  assert.doesNotMatch(menu, /r_multiplayer\(/, `${OWNER}\nthe old JOIN / HOST chooser screen is gone`);
  assert.match(read('src/menu.css'), /\.scr--title \.home__tiles > \[data-act=multiplayer\] \{ grid-column: span 2; \}/, OWNER);
});

test('RACE is solo: QUICK RACE and FREE ROAM are artwork cards that fill the height, with no multiplayer controls', async () => {
  const { Menu } = await import('../src/menu.js');
  const mode = await withDom(() => Menu.prototype.r_mode.call({}));
  assert.deepEqual([...mode.matchAll(/option--feature[^"]*" role="button" data-act="([^"]+)"/g)].map((m) => m[1]), ['quick', 'free'], OWNER);
  assert.equal([...mode.matchAll(/class="option__media"[^>]*><img /g)].length, 2, `${OWNER}\nboth cards are led by artwork`);
  assert.doesNotMatch(mode, /participants|MULTIPLAYER|JOIN GAME|data-act="mp"|LEADERBOARD/, OWNER);
  const menu = read('src/menu.js');
  assert.doesNotMatch(menu, /participant/i, `${OWNER}\nno SOLO / MULTIPLAYER switch on RACE or race setup`);
  assert.doesNotMatch(menu, /HOST \/ CREATE GAME/, OWNER);
  assert.match(read('src/menu.css'), /\.mode-grid \{ flex: 1; display: grid; grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); grid-template-rows: minmax\(0, 1fr\);/, `${OWNER}\nthe two cards take the full height`);
});

test('MULTIPLAYER is a lobby browser: lobbies are the hero, join by code is inline, HOST A LOBBY is the primary action', async () => {
  const M = await import('../src/ui/mp-screens.js');
  M.form.code = '';
  const html = M.renderMp({}, fakeMp());
  assert.match(html, /data-layout="browse-grid"/, `${OWNER}\nthe shared browse layout`);
  assert.match(html, /data-field="code"[\s\S]*data-act="mpJoinCode"/, `${OWNER}\njoin by code is a compact inline field`);
  assert.match(html, /btn--primary[^"]*" role="button" data-act="mpHost"[^>]*>[\s\S]*HOST A LOBBY/, OWNER);
  for (const fact of ['NIGHT RUN', 'HOST · GR-4821', 'PENTELI HILL CLIMB', 'QUICK RACE', 'NIGHT', '2/8', 'OPEN']) assert.ok(html.includes(fact), `${OWNER}\nlobby row is missing ${fact}`);
  assert.doesNotMatch(html, /data-kind="tabs"|JOIN \/ HOST|id="carStage"|data-dialog/, `${OWNER}\nno JOIN / HOST tabs, showroom car or dialog`);
  assert.match(M.renderMp({}, fakeMp({ __lobbies: [] })), /NO OPEN LOBBIES RIGHT NOW/, OWNER);
  assert.match(M.renderMp({}, fakeMp({ connected: false })), /CONNECTING TO THE LOBBY SERVER/, OWNER);
  assert.match(M.renderMp({}, fakeMp({ connected: false, reconnecting: true })), /CAN’T REACH THE LOBBY SERVER[\s\S]*data-act="mpRetry"/, OWNER);
  assert.match(M.renderMp({}, fakeMp({ connected: false, reloadRequired: true })), /GAME UPDATED[\s\S]*data-act="mpReload"/, OWNER);
  const host = M.renderHost({}, fakeMp());
  assert.match(host, /data-layout="stage-inspector"/, `${OWNER}\nhost setup is a full screen`);
  for (const re of [/data-act="mpTrack"[^>]*data-map="penteli"/, /data-key="mode"/, /data-key="private"[\s\S]*INVITE ONLY/, /data-field="name"/, /data-act="mpCreate"/]) assert.match(host, re, OWNER);
  assert.doesNotMatch(host, /data-dialog|role="dialog"/, OWNER);
  assert.ok(M.MP_SCREENS.includes('mpHost') && M.wantedScreen({ lobby: null }, 'mpHost') === 'mpHost', OWNER);
});

test('the race-corner MULTIPLAYER button never floats over a menu screen or its header', () => {
  assert.match(read('src/menu.css'), /body\.ui-open #mp-toggle \{ display: none !important; \}/, OWNER);
});
