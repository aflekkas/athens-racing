// OWNER DECISION 2026-10-18 (docs/OWNER-DECISIONS.md, "All screens use the shared layout templates"): the owner asked
// "is the ui all componentized?" and had every screen moved onto the six kit templates (docs/ui-layouts.md). This guard keeps
// it that way: a screen never renders its own .scr shell, and screen stylesheets never carry page layout.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const OWNER = 'Owner-locked decision 2026-10-18, see docs/OWNER-DECISIONS.md ("All screens use the shared layout templates"). Use a kit template (docs/ui-layouts.md) and put page geometry in src/ui/ui.css.';
const read = (f) => readFileSync(f, 'utf8');
const walk = (dir, re) => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p, re) : re.test(n) ? [p] : []; });
const KIT_JS = 'src/ui/components.js';
const TEMPLATE = /\bC\.(?:heroTiles|sidebarContent|browseGrid|stageInspector|mapStage|sheetList|dialog)\(/;

// ------------------------------------------------------------------ the shell: only the kit builds .scr
test('no module outside the kit renders its own .scr shell or calls screen()', () => {
  const hits = [];
  const shell = /class\s*=\s*["'`][^"'`]*\bscr(?:\s|"|'|`)|classList\.add\(\s*['"`]scr['"`]|className\s*=\s*['"`]scr\b|\bC\.screen\(|\bscreen\(\s*\{|data-layout\s*=/;
  // index.html's loading screen, desktop gate and launch screen are generated from the kit's mapStage({variant:'loading'}) and
  // sheetList({variant:'narrow'}) (tools/sync-loading-layout.mjs; tools/launch-gate.test.mjs checks the launch screen is in sync).
  const html = read('index.html').replace(/<!-- ui-layout:(loading|device-gate|boot):start -->[\s\S]*?<!-- ui-layout:\1:end -->/g, '');
  for (const [file, text] of [...walk('src', /\.js$/).filter((f) => f !== KIT_JS).map((f) => [f, read(f)]), ['index.html', html]]) {
    text.split('\n').forEach((line, i) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
      if (shell.test(line)) hits.push(`${file}:${i + 1} ${line.trim().slice(0, 110)}`);
    });
  }
  assert.deepEqual(hits, [], OWNER);
});

test('only the kit templates call screen(); screen() is not exported API for new screens', () => {
  const kit = read(KIT_JS);
  const callers = [...kit.matchAll(/(?<![\w.])(?<!function )screen\(\{/g)].length;
  assert.equal(callers, 1, `${OWNER}\nscreen() has exactly one caller: layoutFrame().`);
  assert.match(kit, /function layoutFrame\([\s\S]*?return screen\(\{/, OWNER);
});

// ------------------------------------------------------------------ every renderer returns a template
const members = (source, head, end) => {
  const out = [];
  const re = new RegExp(head, 'gm');
  let m;
  while ((m = re.exec(source))) {
    const rest = source.slice(m.index + m[0].length);
    const stop = rest.search(end);
    out.push([m[1], rest.slice(0, stop < 0 ? rest.length : stop)]);
  }
  return out;
};
const DELEGATE = /\barticle\(menu,|\b(?:render[A-Z]\w*|Release\.render\w+|MP\.render\w+|garage\.render\w+)\(|this\.h\.account\?\.\(/;

test('every Menu r_* screen returns a kit template or delegates to a screen module that does', () => {
  const menu = read('src/menu.js');
  const screens = members(menu, '^  (r_\\w+)\\(', '\\n  [A-Za-z_$][\\w$]*\\(');
  assert.ok(screens.length >= 20, 'found the Menu screen renderers');
  const hits = screens.filter(([, body]) => !TEMPLATE.test(body) && !DELEGATE.test(body)).map(([name]) => name);
  assert.deepEqual(hits, [], `${OWNER}\nthese screens do not build their page with a kit template`);
});

test('every exported screen renderer in the screen modules builds its page with a kit template', () => {
  const modules = ['src/car-select.js', 'src/map-select.js', 'src/leaderboards-screen.js', 'src/ui/mp-screens.js', 'src/ui/account-screen.js', 'src/ui/release-screens.js'];
  // Fragments (rows, records, panels) are not pages; these helpers are the only exports named render* that return one.
  const FRAGMENTS = new Set(['renderBestRecord', 'renderTrackTimes', 'renderControls', 'renderLiveBoard', 'renderAbout']);
  const hits = [];
  for (const file of modules) for (const [name, body] of members(read(file), '^export function (render[A-Z]\\w*)\\(', '\\n\\}')) {
    if (FRAGMENTS.has(name)) continue;
    if (!TEMPLATE.test(body) && !DELEGATE.test(body)) hits.push(`${file} ${name}`);
  }
  assert.deepEqual(hits, [], OWNER);
  // the fragments above must not secretly be pages: they never emit a .scr
  for (const file of modules) for (const [name, body] of members(read(file), '^export function (render[A-Z]\\w*)\\(', '\\n\\}')) {
    if (FRAGMENTS.has(name)) assert.doesNotMatch(body, /\bscr\b/, `${file} ${name}`);
  }
});

test('screen modules carry no inline page layout', () => {
  const SCREEN_JS = ['src/menu.js', 'src/leaderboards-screen.js', 'src/car-select.js', 'src/map-select.js', ...walk('src/ui', /\.js$/).filter((f) => f !== KIT_JS && !/phone-wheel|notification|notice-style|telltales|title-hero|garage-thumbnails|live-board|loading\.js$|loading-content/.test(f))];
  const hits = [];
  for (const file of SCREEN_JS) read(file).split('\n').forEach((line, i) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
    if (/style\s*=\s*["'`][^"'`]*\b(?:display|position|grid[\w-]*|flex[\w-]*|width|height|margin[\w-]*|padding[\w-]*|top|left|right|bottom|inset|gap)\s*:/.test(line)) hits.push(`${file}:${i + 1} ${line.trim().slice(0, 100)}`);
  });
  assert.deepEqual(hits, [], `${OWNER}\nMove the geometry into the kit; screens pass content to the template regions.`);
});

// ------------------------------------------------------------------ screen stylesheets: no page layout
// Stylesheets that a screen may load besides the kit. The kit (src/ui/ui.css) owns every page geometry property.
const SCREEN_CSS = ['src/menu.css', 'src/menu-backdrop.css', 'src/map-select.css', 'src/ui/release.css', 'src/multiplayer.css', 'src/ui/headunit.css'];
const LAYOUT = /^(display|position|inset|top|right|bottom|left|z-index|order|flex|flex-[a-z-]+|grid|grid-[a-z-]+|gap|row-gap|column-gap|align-[a-z]+|justify-[a-z]+|place-[a-z]+|width|min-width|max-width|height|min-height|max-height|inline-size|block-size|min-inline-size|min-block-size|margin|margin-[a-z-]+|padding|padding-[a-z-]+|overflow|overflow-[xy]|aspect-ratio|float|columns|column-[a-z-]+|scroll-[a-z-]+)$/;
// Race HUD and in-race overlays are not menu screens (style.css and the HUD modules own them).
const HUD = /(#hud|#evBox|#posBox|#mapBox|#dialBox|#routeBox|#gearboxHud|#engineHud|#limitSign|#wrongWay|#lapTiming|#drivingHints|#drivingTip|#keys|#credit|#count|#mp-board|#mp-toggle|#race-settings|#checkpoint-banner|#police-hud|#tow-prompt|\.tow-|\.objective-|\.racer-marker|\.pop\b|#sigBox|\.wheel-hud|#accounts-offline|\.mp-update-notice|\.mp-connection-chip|\.mp-latency|\.graphics-live-note|#banner|#input-toast|\.driving-dismiss|#multiplayer|#styleBox|#mapLabel|#msg|#rZone|#rRoad|#rToGo|#rticks|#notification-lane|\.race-notice|\.chip--hud|#engineHud|#posBox)/;
// Genuinely screen-specific rendering that no template can own: the map canvas, its labels and pins, and the static backdrop
// layer. Adding to this list needs owner review: layout belongs in the kit.
const ALLOWED = [
  ['src/map-select.css', /\.attica-(?:canvas|overlay|labels|credit|map)\b|\.track-pin(?:__dot)?\b|\.map-label\b/],
  ['src/menu-backdrop.css', /#menu-backdrop\b/],
];

function* rules(source) {
  source = source.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '));
  const re = /([^{}@;]+)\{([^{}]*)\}/g; let m;
  while ((m = re.exec(source))) yield { selector: m[1].trim().replace(/\s+/g, ' '), decls: m[2].split(';').map((d) => d.slice(0, d.indexOf(':')).trim().toLowerCase()).filter(Boolean), line: source.slice(0, m.index).split('\n').length };
}

test('screen stylesheets contain no page-layout properties outside the kit', () => {
  const hits = [];
  for (const file of SCREEN_CSS) {
    const allowed = ALLOWED.filter(([f]) => f === file).map(([, re]) => re);
    for (const r of rules(read(file))) {
      if (HUD.test(r.selector) || allowed.some((re) => re.test(r.selector))) continue;
      const layout = r.decls.filter((d) => LAYOUT.test(d));
      if (layout.length) hits.push(`${file}:${r.line} ${r.selector.slice(0, 90)} { ${layout.join(', ')} }`);
    }
  }
  assert.deepEqual(hits, [], `${OWNER}\nMove the geometry into src/ui/ui.css (a template region or a component); screen stylesheets keep backdrops and genuinely screen-specific rendering only.`);
});

test('dead per-screen stylesheets stay deleted', () => {
  for (const file of ['src/leaderboards.css', 'src/ui/accounts.css']) assert.throws(() => statSync(file), /ENOENT/, `${file}: empty screen stylesheets are not kept`);
  assert.doesNotMatch(read('src/leaderboards-screen.js'), /createElement\('link'\)/, 'leaderboards owns no stylesheet');
  assert.doesNotMatch(read('style.css'), /@import[^;]*accounts\.css/);
});
