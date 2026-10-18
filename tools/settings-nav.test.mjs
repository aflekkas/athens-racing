// OWNER DECISION (docs/OWNER-DECISIONS.md, 2026-10-17): "sidebar needs better UI here". The Settings sidebar is the
// kit's shared section nav (C.nav in src/ui/components.js, looks in src/ui/ui.css): pause-menu rows (icon plate, bold
// spaced-caps label, chevron) in a panel, exactly one selected (lit) row whose surface slides between rows, the calm
// keyboard / gamepad focus surface (2026-10-18: no outlines), no hover look. Screens use the component, never restyle it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as C from '../src/ui/components.js';

const OWNER = 'Owner decision, see docs/OWNER-DECISIONS.md ("Settings sidebar", 2026-10-17). Ask the owner before changing.';
const read = (f) => readFileSync(f, 'utf8');
/** flat CSS rules [{ selector, decls, body, line }], @media blocks included (comments stripped) */
function cssRules(src) {
  src = src.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '));
  const rules = [], re = /([^{}@]+)\{([^{}]*)\}/g; let m;
  while ((m = re.exec(src))) rules.push({ selector: m[1].trim().replace(/\s+/g, ' '), body: m[2], decls: m[2].split(';').map((d) => d.slice(0, d.indexOf(':')).trim().toLowerCase()).filter(Boolean), line: src.slice(0, m.index).split('\n').length });
  return rules;
}
const SCREEN_CSS = ['src/menu.css', 'src/leaderboards.css', 'src/map-select.css', 'src/multiplayer.css', 'src/ui/accounts.css', 'src/ui/release.css', 'src/ui/headunit.css', 'src/input.css', 'src/music-settings.css'];

test('the Settings screen builds its sidebar with the shared nav component', () => {
  const menu = read('src/menu.js');
  const from = menu.indexOf('r_settings('), settings = menu.slice(from, menu.indexOf('\n  leaving()', from));
  assert.match(settings, /head:\s*C\.nav\(\{\s*key:\s*'settingsTab'/, `${OWNER}\nThe sidebar must be C.nav({ key: 'settingsTab', ... }).`);
  assert.doesNotMatch(settings, /C\.tabs\(|tabs--rail|class="[^"]*\b(tab|nav__item)\b/, `${OWNER}\nNo pill tabs, old rail or hand-built nav markup on the Settings screen.`);
});

test('the nav renders pause-menu rows with exactly one selected item and one sliding indicator', () => {
  const html = C.nav({ key: 'settingsTab', value: 'audio', options: [['driver', 'DRIVER', 'user'], ['audio', 'SOUND', 'speaker-high'], ['about', 'ABOUT', 'info']] });
  assert.match(html, /^<div class="mi nav\b[^"]*" data-kind="tabs" data-key="settingsTab" data-value="audio" role="tablist"/, 'one focus item driven like tabs (Q / E, LB / RB, up / down, tap)');
  assert.equal(html.match(/class="sel-ind"/g)?.length, 1, 'one selection indicator, kept across refreshes so it can slide');
  assert.equal(html.match(/class="nav__item on"/g)?.length, 1, 'exactly one item looks selected');
  assert.equal(html.match(/aria-selected="true"/g)?.length, 1);
  assert.equal(html.match(/class="nav__ico"/g)?.length, 3, 'every row has the rounded-square icon plate');
  assert.equal(html.match(/class="nav__label"/g)?.length, 3, 'every row has the bold spaced-caps label');
  assert.equal(html.match(/class="nav__go"/g)?.length, 3, 'every row has the pause-menu chevron');
});

test('the nav look lives in the kit: a panel surface, an animated lit selection, a focus surface and no hover', () => {
  const rules = cssRules(read('src/ui/ui.css')).filter((r) => /\.nav\b/.test(r.selector));
  const find = (sel) => rules.find((r) => r.selector === sel);
  assert.ok(find('.nav')?.decls.includes('background') && find('.nav').decls.includes('border'), 'the nav sits in a panel on the panel surface');
  const glide = cssRules(read('src/ui/ui.css')).find((r) => r.selector === '.sel-ind')?.body || '';
  assert.match(glide, /transition:[^;]*transform\s+\.28s/, `${OWNER}\nThe selected surface must slide between rows, never snap.`);
  assert.ok(rules.every((r) => !/transition:\s*none|animation:\s*none/.test(r.body)), `${OWNER}\nThe nav may not switch off the glide.`);
  assert.match(find('.nav > .sel-ind')?.body || '', /background:\s*var\(--hu-lit\)/, `${OWNER}\nThe one selected row is the lit fill, clearly stronger than focus.`);
  assert.match(find(':root[data-ui-focus="navigation"] .nav.focus')?.body || '', /background:/, 'keyboard / gamepad focus is the lighter surface, only while navigating');
  assert.deepEqual(rules.filter((r) => /:hover/.test(r.selector)).map((r) => r.selector), [], `${OWNER}\nOwner, 2026-10-17: "i dont like hover effects". Hover must not change the nav.`);
  for (const f of SCREEN_CSS) {
    let src; try { src = read(f); } catch { continue; }
    const hits = cssRules(src).filter((r) => /\.nav(__[\w-]+)?\b/.test(r.selector)).map((r) => `${f}:${r.line} ${r.selector}`);
    assert.deepEqual(hits, [], `${OWNER}\nScreens never restyle the shared nav.`);
  }
});
