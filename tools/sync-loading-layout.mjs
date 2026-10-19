// Regenerate the pre-module static screens from the shared kit; no runtime flash.
//   - the loading frame (mapStage loading variant)
//   - the desktop gate (#device-gate: sheetList narrow variant), the only screen a phone or tablet ever sees (src/device-gate.js)
// node tools/sync-loading-layout.mjs [--check]
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mapStage, sheetList, emptyState, chip, SPRITE } from '../src/ui/components.js';
import { loadingContent } from '../src/ui/loading-content.js';
import { GATE_TITLE, GATE_TEXT, GATE_URL } from '../src/device-gate.js';

const block = (name, html) => `<!-- ui-layout:${name}:start -->\n${html}\n<!-- ui-layout:${name}:end -->`;
const blockPattern = name => new RegExp(`<!-- ui-layout:${name}:start -->[\\s\\S]*?<!-- ui-layout:${name}:end -->`);
const BRAND = '<img class="brand-mark" src="assets/icon.svg" alt="" /><span class="wordmark wordmark--sm"><b>ATHENS</b><b>RACING</b></span>';

/** the full-screen "made for computers" page. Icons point at the sprite by a relative URL: the page needs no script to draw them. */
export function deviceGateMarkup() {
  const rows = `<div class="device-gate__brand">${BRAND}</div>${emptyState({ icon: 'monitor', title: GATE_TITLE, text: GATE_TEXT, action: chip(GATE_URL, { icon: 'globe' }) })}`;
  const screen = sheetList({ variant: 'narrow', back: false, cls: 'scr--device-gate', rows }).replaceAll(SPRITE, 'assets/icons/sprite.svg');
  return `<div id="device-gate" class="device-gate" role="main" aria-label="Athens Racing is made for computers">${screen}</div>`;
}
export const syncLayouts = html => html
  .replace(blockPattern('loading'), () => block('loading', mapStage({ variant: 'loading', ...loadingContent })))
  .replace(blockPattern('device-gate'), () => block('device-gate', deviceGateMarkup()));

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const path = 'index.html', html = readFileSync(path, 'utf8'), next = syncLayouts(html);
  if (process.argv.includes('--check')) { if (next !== html) throw new Error('Run node tools/sync-loading-layout.mjs to refresh the kit loading and device-gate templates.'); }
  else writeFileSync(path, next);
}
