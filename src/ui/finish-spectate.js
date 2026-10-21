import * as C from './components.js';
let root, previous = '';
export function updateFinishSpectateHud({ visible, name, position, time, ownPosition, canRestart = false }) {
  if (!root && !visible) return;
  if (!root) { root = document.createElement('aside'); root.id = 'finish-spectate'; root.setAttribute('aria-label', 'Finish and spectator'); document.body.append(root); }
  root.hidden = !visible;
  if (!visible) return;
  const html = C.panel('YOUR FINISH',
    C.chip(`WATCHING · P${position} · ${C.esc(name)}`) +
    C.stats([['POSITION', `P${ownPosition}`], ['TIME', C.esc(time)]]) +
    C.keyHints([['leftright', 'DRIVER · A / D'], ...(canRestart ? [['restart', 'RESTART · R']] : []), ['back', 'RESULTS · ENTER']]));
  if (html !== previous) { root.innerHTML = html; previous = html; }
}
