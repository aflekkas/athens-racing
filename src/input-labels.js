// Rendering-free labels: every displayed binding comes from the current input mapping.
const PAD = ['A','B','X','Y','LB','RB','LT','RT','VIEW','MENU','LS','RS','D ↑','D ↓','D ←','D →','HOME'];
const KEYS = { Space: 'SPACE', Escape: 'ESC', Enter: 'ENTER', ShiftLeft: 'L SHIFT', ShiftRight: 'R SHIFT', Backspace: 'BKSP' };
export function bindingLabel(bindings, action, device = 'keyboard') {
  if (device === 'touch') return ({ throttle: 'GAS', brake: 'BRAKE', handbrake: 'HB', shiftUp: 'GEAR +', shiftDown: 'GEAR −', transmission: 'MODE', camera: 'CAM', pause: 'PAUSE', tow: 'TOW', reset: 'RESET', mouseLook: 'DRAG VIEW' })[action] || action.toUpperCase();
  const defaults = { keyboard: { shiftUp: ['KeyE'], shiftDown: ['KeyQ'], transmission: ['KeyM'] }, gamepad: { shiftUp: ['b5'], shiftDown: ['b4'] } };
  const codes = (bindings || defaults)?.[device === 'gamepad' ? 'gamepad' : 'keyboard']?.[action] || [];
  if (!codes.length) return 'UNBOUND';
  return codes.slice(0,2).map(code => {
    if(device === 'gamepad') { const b=/^b(\d+)$/.exec(code);if(b)return PAD[+b[1]] || 'B'+b[1]; const a=/^a(\d+)([+-])$/.exec(code);return a ? `${+a[1]<2?'LS':'RS'} ${+a[1]%2 ? a[2]==='+'?'↓':'↑' : a[2]==='+'?'→':'←'}` : code; }
    return KEYS[code] || code.replace(/^Key|^Digit/,'').replace('Arrow','').replace(/([a-z])([A-Z])/g,'$1 $2').toUpperCase();
  }).join(' / ');
}
export function gearboxMessage(type, manual, bindings, device = 'keyboard', { toggle = false } = {}) {
  const up=bindingLabel(bindings,'shiftUp',device), down=bindingLabel(bindings,'shiftDown',device), mode=bindingLabel(bindings,'transmission',device);
  const shift=`${up} ↑ / ${down} ↓`;
  if(type==='manual')return `MANUAL ONLY · ${toggle ? mode+' LOCKED · ' : ''}${shift} TO SHIFT`;
  if(type==='auto' && !manual)return `AUTO · ${shift} FOR MANUAL · ${mode} FOR AUTO`;
  return manual ? `MANUAL · ${shift} TO SHIFT · ${mode} FOR AUTO` : `AUTO GEARS · ${mode==='UNBOUND'?'SETTINGS':mode} FOR MANUAL`;
}
