// Owner-locked decision: 2026-10-18, "on mobile can we encourage the user to add a bookmark please".
// The home-screen invitation is a small kit notice on the title: never a dialog, never in the driving view, never nagging.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as C from '../src/ui/components.js';

const root = new URL('../', import.meta.url);
const read = (p) => readFile(new URL(p, root), 'utf8');
const lock = 'Owner-locked decision, see docs/OWNER-DECISIONS.md. Ask the owner before changing.';

test(`the decision is recorded with the owner's words. ${lock}`, async () => {
  const doc = await read('docs/OWNER-DECISIONS.md');
  assert.match(doc, /2026-10-18[^\n]*add a bookmark/);
  assert.match(doc, /tools\/owner-locked-install-prompt\.test\.mjs/);
});

test(`the invitation is the shared kit notice, not a dialog and not a one-off. ${lock}`, async () => {
  const html = C.notice({ icon: 'smartphone', title: 'T', text: 'x', steps: [{ icon: 'share', text: 'a' }], actions: C.button({ label: 'OK', act: 'x' }), dismiss: 'later', attrs: { 'data-install': 'ios' } });
  assert.match(html, /^<aside class="panel panel--float notice/);
  assert.doesNotMatch(html, /modal|dialog|<select/);
  const card = await read('src/ui/install-card.js');
  assert.match(card, /C\.notice\(/);
  assert.doesNotMatch(card, /C\.dialog|<select|innerHTML|style\./, 'built from kit components only, no per-screen styling');
  assert.match(await read('src/menu.js'), /InstallCard\.titleNotice/);
  const menu = await read('src/menu.js');
  assert.equal([...menu.matchAll(/InstallCard\.titleNotice/g)].length, 1, 'shown from the title screen only: not in the race, not over the sign-in gate');
  assert.match(await read('tools/ui-components.test.mjs'), /dialog/, 'sign-in stays the only dialog');
});

test(`Lucide icons only, no outline, no hover, animated in and out. ${lock}`, async () => {
  const card = await read('src/ui/install-card.js');
  for (const name of ['smartphone', 'share', 'square-plus', 'ellipsis-vertical', 'download']) assert.match(card, new RegExp(`'${name}'`), name);
  assert.doesNotMatch(card, /[↑⬆⋮⊕➕✕×]/, 'no text glyphs as icons');
  const css = (await read('src/ui/ui.css')).match(/\/\* a notice \(C\.notice\)[\s\S]*?(?=\.panel__head)/)?.[0] || '';
  assert.ok(css.length > 300, 'notice styles found');
  assert.doesNotMatch(css, /:hover|outline|cursor:\s*(?:pointer|grab)|box-shadow/i);
  assert.match(css, /@keyframes notice-card-in/);
  assert.match(css, /@keyframes notice-card-out/);
  assert.match(css, /\[data-leaving\]/);
  assert.match(css, /prefers-reduced-motion/);
  assert.doesNotMatch(await read('src/ui/release.css').then((s) => s.slice(s.indexOf('the install hint'))), /:hover|outline/);
});

test(`dismissals are remembered; installing is final. ${lock}`, async () => {
  const card = await read('src/ui/install-card.js');
  for (const act of ['installLater', 'installNever', 'installApp']) assert.match(card, new RegExp(`case '${act}'`));
  assert.match(card, /beforeinstallprompt/);
  assert.match(card, /appinstalled/);
  assert.match(card, /NOT NOW/);
  assert.match(card, /DON'T ASK AGAIN/);
});
