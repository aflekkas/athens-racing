import * as C from './components.js';
import { bindingLabel } from '../input-labels.js';
let root, previous = '';
// Every chip is the live primary binding of the action it labels, so the card can never
// advertise a key that does something else. Physical R is tow/reset, so it has no row;
// Enter already opens results, so there is no restart row either.
const first = (action, device = 'keyboard') => String(bindingLabel(C.hintBindings?.(), action, device)).split(' / ')[0];
const chips = (a, b, pad = false) => [a, b].map((action) => { const label = first(action, pad ? 'gamepad' : 'keyboard'); return label && label !== 'UNBOUND' ? C.kbd(label, pad) : ''; }).join('');
export function updateFinishSpectateHud({ visible, name, position, time, ownPosition }) {
  if (!root && !visible) return;
  if (!root) { root = document.createElement('aside'); root.id = 'finish-spectate'; root.setAttribute('aria-label', 'Finish and spectator'); document.body.append(root); }
  root.hidden = !visible;
  if (!visible) return;
  const hints = `<div class="hints" aria-hidden="true">` +
    `<span class="hint"><span class="hint__keys on-key">${chips('left', 'right')}</span><span class="hint__keys on-pad">${chips('left', 'right', true)}</span>DRIVER</span>` +
    `<span class="hint"><span class="hint__keys on-key">${chips('back', 'confirm')}</span><span class="hint__keys on-pad">${chips('back', 'confirm', true)}</span>RESULTS</span></div>`;
  const html = C.panel('YOUR FINISH',
    C.chip(`WATCHING · P${position} · ${C.esc(name)}`) +
    C.stats([['POSITION', `P${ownPosition}`], ['TIME', C.esc(time)]]) +
    hints);
  if (html !== previous) { root.innerHTML = html; previous = html; }
}
