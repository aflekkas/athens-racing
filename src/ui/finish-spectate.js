import * as C from './components.js';
let root, previous = '';
export function updateFinishSpectateHud({ visible, name, position, time, ownPosition, canRestart = false }) {
  if (!root && !visible) return;
  if (!root) { root = document.createElement('aside'); root.id = 'finish-spectate'; root.setAttribute('aria-label', 'Finish and spectator'); document.body.append(root); }
  root.hidden = !visible;
  if (!visible) return;
  // Fixed chips per row instead of the binding-derived hint helper (whose chips follow
  // the global bindings, e.g. Enter for restart): R restarts, Esc/Enter open results.
  const chev = C.kbd(C.icon('chevron-left')) + C.kbd(C.icon('chevron-right'));
  const chevPad = C.kbd(C.icon('chevron-left'), true) + C.kbd(C.icon('chevron-right'), true);
  const hints = `<div class="hints" aria-hidden="true">` +
    `<span class="hint"><span class="hint__keys on-key">${chev}</span><span class="hint__keys on-pad">${chevPad}</span>DRIVER · A / D</span>` +
    (canRestart ? `<span class="hint"><span class="hint__keys on-key">${C.kbd('R')}</span><span class="hint__keys on-pad">${C.kbd('VIEW', true)}</span>RESTART</span>` : '') +
    `<span class="hint"><span class="hint__keys on-key">${C.kbd('ESC')}${C.kbd('ENTER')}</span><span class="hint__keys on-pad">${C.kbd('B', true)}${C.kbd('A', true)}</span>RESULTS</span></div>`;
  const html = C.panel('YOUR FINISH',
    C.chip(`WATCHING · P${position} · ${C.esc(name)}`) +
    C.stats([['POSITION', `P${ownPosition}`], ['TIME', C.esc(time)]]) +
    hints);
  if (html !== previous) { root.innerHTML = html; previous = html; }
}
