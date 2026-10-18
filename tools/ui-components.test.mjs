// OWNER LOCK (docs/OWNER-DECISIONS.md, 2026-10-16): one shared component set for every screen.
// The kit lives in src/ui/components.js (markup) + src/ui/ui.css (looks). Screen stylesheets may only LAY OUT kit
// components (grid / flex / size / spacing between them); they may not restyle them or define their own buttons, cards,
// selects, pills, tabs or headers. Screen modules build markup through the kit builders, never by hand.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const OWNER = 'Owner-locked decision, see docs/OWNER-DECISIONS.md ("One shared component set for every screen"). Ask the owner before changing.';
const read = (f) => readFileSync(f, 'utf8');
const walk = (dir, re) => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p, re) : re.test(n) ? [p] : []; });

// ------------------------------------------------------------------ a small CSS reader: [{ selector, decls, line }]
export function cssRules(src) {
  src = src.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '));
  const rules = []; let i = 0;
  const lineAt = (k) => src.slice(0, k).split('\n').length;
  function block(end) {
    while (i < end) {
      const open = src.indexOf('{', i), close = src.indexOf('}', i);
      if (open < 0 || (close >= 0 && close < open)) { i = close < 0 ? end : close + 1; return; }
      const head = src.slice(i, open).trim(), at = i + src.slice(i, open).search(/\S/);
      i = open + 1;
      if (/^@(media|supports|container|layer)\b/.test(head)) { block(end); continue; }
      if (head.startsWith('@')) { let depth = 1; while (depth && i < end) { const c = src[i++]; if (c === '{') depth++; else if (c === '}') depth--; } continue; }
      const stop = src.indexOf('}', i), body = src.slice(i, stop); i = stop + 1;
      const decls = body.split(';').map((d) => d.trim()).filter(Boolean).map((d) => d.slice(0, d.indexOf(':')).trim().toLowerCase());
      rules.push({ selector: head.replace(/\s+/g, ' '), decls, body, line: lineAt(at) });
    }
  }
  block(src.length);
  return rules;
}
const classesOf = (sel) => [...sel.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1]);

// ------------------------------------------------------------------ the kit
const KIT_CSS = 'src/ui/ui.css', KIT_JS = 'src/ui/components.js';
/** state / modifier classes the kit toggles; they are not components by themselves */
const STATES = new Set(['focus', 'on', 'off', 'selected', 'sel', 'hi', 'dis', 'open', 'dragging', 'dflt', 'me', 'good', 'bad', 'warn', 'run', 'pa', 'pb', 'px', 'gold', 'silver', 'bronze', 'none', 'big', 'out', 'ico', 'mi', 'on-key', 'on-pad', 'no-pad', 'is-closing', 'is-dirty', 'tnum', 'muted', 'label', 'kick', 'acc', 'sr-only', 'scroll-y', 'scroll-x', 'ui-native', 'ui-text', 'glass', 'title-xl']);
const KIT = new Set(cssRules(read(KIT_CSS)).flatMap((r) => classesOf(r.selector)).filter((c) => !STATES.has(c) && !c.startsWith('ico--')));
/** what a screen stylesheet may set on a kit component: where it sits, never how it looks */
const LAYOUT = /^(display|position|inset|top|right|bottom|left|z-index|order|flex|flex-[a-z-]+|grid|grid-[a-z-]+|gap|row-gap|column-gap|align-[a-z]+|justify-[a-z]+|place-[a-z]+|width|min-width|max-width|height|min-height|max-height|inline-size|block-size|min-inline-size|max-inline-size|margin|margin-[a-z-]+|overflow|overflow-[xy]|overscroll-behavior|scroll-[a-z-]+|aspect-ratio|box-sizing|contain|visibility|pointer-events|touch-action|-webkit-overflow-scrolling)$/;
/** bespoke component names a screen may not invent: use the kit's Button, Card, Select, Segmented, Tabs, Chip, screen header */
const BESPOKE_WORD = /(^|-)(btn|button|card|tile|pill|chip|badge|select|tabs?|toggle|switch|slider|stepper|dialog|modal|head|header|title)s?$/;
/** the part of a BEM name that says what the thing IS: the modifier, else the element, else the block */
const bespoke = (c) => !/^(s|scr)-/.test(c) && !SCREEN_CONTAINERS.has(c) && BESPOKE_WORD.test(c.split('--').pop().split('__').pop());
/** owner-locked title layout (docs/OWNER-DECISIONS.md, 2026-10-15): the grid that places the kit's option tiles */
const SCREEN_CONTAINERS = new Set(['home__tiles']);

// screen stylesheets: every stylesheet the menus load, except the kit itself
const SCREEN_CSS = ['src/menu.css', 'src/leaderboards.css', 'src/map-select.css', 'src/multiplayer.css', 'src/ui/accounts.css', 'src/ui/release.css', 'src/ui/headunit.css', 'src/input.css'].filter(existsSync);
// Race HUD and in-race overlays are not menu screens (style.css owns them); rules scoped to them are out of scope here.
const HUD_SCOPE = /(#hud|#evBox|#posBox|#mapBox|#dialBox|#routeBox|#gearboxHud|#engineHud|#limitSign|#wrongWay|#lapTiming|#drivingHints|#drivingTip|#keys|#credit|#count|#mp-board|#mp-toggle|#race-settings|#checkpoint-banner|#touch-controls|\.touch-|#police-hud|#tow-prompt|\.tow-|\.objective-|\.racer-marker|\.pop\b|#sigBox|\.wheel-hud|#accounts-offline|\.mp-update-notice|\.mp-connection-chip|\.mp-blocked-row|\.mp-latency|\.graphics-live-note)/;
// screen modules: everything that renders menu markup
const SCREEN_JS = ['src/menu.js', 'src/leaderboards-screen.js', 'src/car-select.js', 'src/map-select.js', ...walk('src/ui', /\.js$/).filter((f) => f !== KIT_JS && !/phone-wheel|notification|notice-style|telltales|title-hero|garage-thumbnails|live-board|loading\.js$/.test(f))];

test('screen stylesheets lay out kit components but never restyle them', () => {
  const hits = [];
  for (const f of SCREEN_CSS) for (const r of cssRules(read(f))) {
    if (HUD_SCOPE.test(r.selector)) continue;
    const kit = classesOf(r.selector).filter((c) => KIT.has(c));
    if (!kit.length) continue;
    const looks = r.decls.filter((d) => !LAYOUT.test(d) && !d.startsWith('--'));
    if (looks.length) hits.push(`${f}:${r.line} ${r.selector.slice(0, 90)} { ${looks.join(', ')} } restyles .${kit[0]}`);
  }
  assert.deepEqual(hits, [], `${OWNER}\nMove the look into the kit (src/ui/ui.css) as a component or variant; screens only lay it out.`);
});

test('screens do not define their own buttons, cards, selects, pills, tabs or headers', () => {
  const hits = [];
  for (const f of SCREEN_CSS) for (const r of cssRules(read(f))) {
    if (HUD_SCOPE.test(r.selector)) continue;
    for (const c of classesOf(r.selector)) if (!KIT.has(c) && !STATES.has(c) && bespoke(c)) { hits.push(`${f}:${r.line} .${c}`); break; }
  }
  assert.deepEqual([...new Set(hits)], [], `${OWNER}\nUse the kit's Button / Card / CarCard / Select / Segmented / Tabs / Chip / screen header instead.`);
});

test('screen modules build markup through the kit builders', () => {
  const hits = [];
  const RAW = /class="(?:mi )?(?:btn|card|option|panel|chip|badge|seg|tabs?|select|list-row|field|stat-tile|switch|slider|stepper|dialog|modal|hu-status|scr__head|scr__title)[\s"]/;
  for (const f of SCREEN_JS) read(f).split('\n').forEach((line, i) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return; // comments
    if (RAW.test(line)) hits.push(`${f}:${i + 1} hand-built kit markup: ${line.trim().slice(0, 100)}`);
    if (/<style[\s>]/.test(line)) hits.push(`${f}:${i + 1} inline <style>: screen looks belong in the kit`);
    if (/<button[\s>]/.test(line)) hits.push(`${f}:${i + 1} raw <button>: use C.button()`);
    if (/racing-ui|appearance:\s*['"]racing|roadSign\(|routeHero\(|infoStrip\(|garage-intro|FIND YOUR NEXT DRIVE|THE GARAGE/.test(line)) hits.push(`${f}:${i + 1} round-1 one-off styling (owner rejected)`);
  });
  assert.deepEqual(hits, [], OWNER);
});

test('the round-1 one-off styling is gone from the kit too', () => {
  const css = read(KIT_CSS), js = read(KIT_JS);
  for (const re of [/racing-ui/, /racing-road-sign/, /route-hero/, /road-strip/, /listbox--racing/, /garage-intro/, /video-hero/]) {
    assert.doesNotMatch(css, re, OWNER); assert.doesNotMatch(js, re, OWNER);
  }
  assert.doesNotMatch(js, /export (const|function) (roadSign|routeHero|infoStrip)\b/, OWNER);
});

test('the kit provides the shared Dialog and Car card; a Dialog is used for sign-in only', () => {
  const js = read(KIT_JS);
  for (const name of ['button', 'card', 'carCard', 'dialog', 'select', 'segmented', 'tabs', 'listRow', 'textField', 'searchField', 'screen', 'plate']) assert.match(js, new RegExp(`export (function|const) ${name}\\b`), `${OWNER}\nthe kit is missing ${name}()`);
  // Owner-approved exception (docs/OWNER-DECISIONS.md, 2026-10-16): menus are full screens; sign-in alone is a Dialog
  // over the title screen. Gameplay prompts (ui.prompt: tow / reset) are not menus.
  const users = SCREEN_JS.filter((f) => /\bC\.dialog\(|\bdialog\(\{/.test(read(f)));
  assert.deepEqual(users, ['src/ui/account-screen.js'], `${OWNER}\nonly sign-in may use a Dialog`);
  const src = read('src/ui/account-screen.js'), calls = [...src.matchAll(/C\.dialog\(/g)].length;
  assert.equal(calls, 1, `${OWNER}\nexactly one Dialog: sign-in`);
  assert.match(src.slice(src.indexOf('export function renderSignIn'), src.indexOf('export function renderProfile')), /C\.dialog\(/, `${OWNER}\nthe Dialog belongs to sign-in`);
  for (const f of SCREEN_JS) assert.doesNotMatch(read(f), /role="(alert)?dialog"/, `${OWNER}\n${f}: dialogs come from the kit`);
});

// The pause menu is THE reference style (docs/OWNER-DECISIONS.md, 2026-10-16): every row kind shares its focus, the kit
// carries no second visual language (italics, lime, glows), and pause itself is built from the kit it defines.
test('the pause-menu reference: one surface focus look, one type language, pause built from the kit', () => {
  const css = read(KIT_CSS);
  const focus = cssRules(css).find((r) => /\.option\.focus/.test(r.selector) && /\.field\.focus/.test(r.selector) && /\.list-row\.focus/.test(r.selector) && /\.card\.focus/.test(r.selector));
  assert.ok(focus && focus.decls.includes('background') && !focus.decls.includes('border-color') && !focus.decls.includes('outline') && !focus.decls.includes('box-shadow'), `${OWNER}\noption, field, list row and card share the reference focus (keyboard/gamepad surface only, no outline/ring)`);
  for (const f of [KIT_CSS, ...SCREEN_CSS, 'src/ui/notifications.css', 'style.css']) {
    const rules = cssRules(read(f)).filter((r) => !/wordmark|title__mark|#hud|#posBox|#evBox|#count|#lapTiming|#wrongWay|#gearboxHud|#routeBox|#engineHud|#mapBox|#dialBox|objective-|tow-|racer-marker/.test(r.selector));
    const src = read(f);
    if (f !== 'style.css') for (const r of rules) assert.doesNotMatch(r.body, /font-style:\s*italic|\bitalic\b/, `${OWNER}\n${f}:${r.line} ${r.selector}: no italics outside the brand wordmark`);
    assert.doesNotMatch(src, /#dcfa4c|#b8ef77|#c1ed91/i, `${OWNER}\n${f}: the round-1 lime accent is gone; the one accent is ice`);
  }
  const menu = read('src/menu.js'), pause = menu.slice(menu.indexOf('  r_pause('), menu.indexOf('  r_roamConditions('));
  assert.match(pause, /C\.sheetList\(\{ variant: 'pause'/, `${OWNER}\npause uses the kit layout with its inset sheet header`);
  assert.match(pause, /C\.option\(/, OWNER);
  const title = menu.slice(menu.indexOf('  r_title('), menu.indexOf('  participantChoice('));
  assert.equal([...title.matchAll(/cls: 'option--tile/g)].length, 5, `${OWNER}\nthe locked title layout is the kit's option tiles (PLAY is option--hero)`);
  assert.doesNotMatch(pause, /PHONE AS WHEEL/, 'the phone-wheel feature is being removed; pause does not list it');
});

test('OWNER LOCK 2026-10-17: leaderboards belong to the Quick Race track, never a mode or title tile', async () => {
  const { Menu } = await import('../src/menu.js');
  const priorDocument = globalThis.document, priorWindow = globalThis.window;
  globalThis.document = { baseURI: 'http://localhost/', querySelector: () => null, body: { classList: { contains: () => false } } };
  globalThis.window = {};
  try {
    const mode = Menu.prototype.r_mode.call({ participants: 'solo', participantChoice: Menu.prototype.participantChoice });
    assert.deepEqual([...mode.matchAll(/class="mi option[^>]+data-act="([^"]+)"/g)].map(m => m[1]), ['quick', 'free']);
    assert.doesNotMatch(mode, /LEADERBOARD/);
    assert.doesNotMatch(Menu.prototype.r_title.call({ h: {} }), /LEADERBOARD/);
    const menu = { screen: 'setup', setupDef: () => ({ id: 'megara-race' }) };
    const track = Menu.prototype.r_mapConfirm.call(menu, { mapId: 'megara', mode: 'quick' });
    assert.match(track, /data-act="leaderboards"/);
    assert.match(track, /YOUR PERSONAL BEST/);
    assert.match(track, /GLOBAL \/ TOP 3/);
    assert.match(track, /data-act="mapContinue"/);
    const { renderLeaderboards } = await import('../src/leaderboards-screen.js');
    const emptyBoard = renderLeaderboards({ screen: 'setup' }, { tab: 'personal', filters: { mapId: 'penteli', eventId: 'penteli-race' } });
    assert.match(emptyBoard, /select__val">PENTELI RACE</, 'the prefiltered event remains visible before map events or records load');
    assert.match(read('src/menu.css'), /\.mode-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2,/);
    assert.match(read('src/map-select.js'), /menu\.show\('mapConfirm', \{ mapId: id, mode: 'quick' \}, true\)/);
  } finally { globalThis.document = priorDocument; globalThis.window = priorWindow; }
});


test('OWNER LOCK 2026-10-17: title taglines and environment identity leave the header', async () => {
  const { statusBar, syncFooterBadge } = await import('../src/ui/components.js');
  for (const kick of ['GREEK ROADS <span class="acc">/</span> PURE TIME', 'PURE TIME', 'GREEK ROADS']) {
    const html = statusBar({ back: false, account: true, kick });
    assert.doesNotMatch(html, /hu-crumb|build-badge/);
    assert.match(html, /data-hu-driver/);
    assert.doesNotMatch(html, /data-hu-clock/);
  }
  assert.match(statusBar({ kick: 'OPTIONS' }), /BACK[\s\S]*OPTIONS/);
  const priorDocument = globalThis.document;
  try {
    let environment = 'staging';
    globalThis.document = {
      querySelector: selector => ({ content: selector.includes('asr-environment') ? environment : '2026.10.15.3' }),
      createElement: () => ({ className: '', textContent: '' }),
    };
    const makeFooter = withVersion => {
      const footer = { badge: null, version: withVersion ? { prepend: badge => { footer.badge = badge; } } : null,
        querySelector: selector => selector === '.build-badge' ? footer.badge : footer.version,
        prepend: badge => { footer.badge = badge; } };
      return footer;
    };
    const title = makeFooter(true), settings = makeFooter(false);
    const root = { querySelectorAll: () => [title, settings] };
    syncFooterBadge(root);
    assert.equal(title.badge.textContent, 'STAGING · ');
    assert.equal(settings.badge.textContent, 'STAGING · 2026.10.15.3');
    const original = title.badge;
    syncFooterBadge(root);
    assert.equal(title.badge, original, 'repeated renders must not duplicate badges');
    environment = 'production';
    const production = makeFooter(true);
    syncFooterBadge({ querySelectorAll: () => [production] });
    assert.equal(production.badge, null);
  } finally { globalThis.document = priorDocument; }
});

test('dialog, confirm and pause share an animated blurred backdrop with a tinted fallback', () => {
  const css = read(KIT_CSS), kit = read(KIT_JS), menu = read('src/menu.js');
  assert.match(css, /\.dialog-scrim, \.modal-scrim, \.scr--pause\s*\{[^}]*-webkit-backdrop-filter: blur\(var\(--overlay-blur\)\); backdrop-filter: blur\(var\(--overlay-blur\)\)/);
  assert.match(css, /--overlay-blur: 12px; background: rgba\(3,5,7,\.66\)/);
  assert.match(css, /@supports \(\(backdrop-filter: blur\(12px\)\)/);
  assert.match(css, /@media \(pointer: coarse\), \(prefers-reduced-transparency: reduce\)/);
  assert.match(css, /data-ui-backdrop=tint/);
  assert.match(css, /@keyframes ui-overlay-out/);
  assert.match(kit, /\['potato', 'low'\]\.includes\(settings.perfClass\)/);
  assert.match(kit, /m\.root\.classList\.add\('is-closing'\)/);
  assert.match(menu, /if \(entering\) C\.exitBackdrop\(this\.root\)/);
});

// Owner 2026-10-17: supersedes the offline/escape clauses of the original Dialog decision.
test('required Google gate has no offline path and uses game button typography', () => {
  const src = read('src/ui/account-screen.js'), loader = read('src/ui/account-loader.js');
  assert.match(src, /label: "CONTINUE WITH GOOGLE"/);
  assert.doesNotMatch(src + loader, /account-offline|PLAY OFFLINE|playing-offline|bypass|searchParams.*guest/);
  const google = cssRules(read(KIT_CSS)).find(r => r.selector === '.btn--google');
  assert.ok(google); assert.match(google.body, /font-weight:\s*700/);
  assert.doesNotMatch(google.body, /font-family|letter-spacing|text-transform/);
  assert.doesNotMatch(read(KIT_CSS), /\.btn--google:hover/);
});

test('sign-in backdrop samples the whole title without an animated opacity ancestor', () => {
  const css = read(KIT_CSS);
  assert.match(css, /#ui\.is-entering \.scr--signin\s*\{ animation: none;/);
  assert.match(css, /#ui\.is-entering \.dialog-under \.scr\s*\{ animation: none;/);
  assert.match(css, /animation: ui-fade \.18s ease backwards/);
});
