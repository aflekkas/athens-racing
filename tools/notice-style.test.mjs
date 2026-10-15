import test from 'node:test'; import assert from 'node:assert/strict';
import { noticeStyle, telltaleMask } from '../src/ui/notice-style.js';
import { TELLTALES, telltale } from '../src/ui/telltales.js';

test('vehicle and road warnings become cluster tell-tales with ISO lamp colours', () => {
  const cases = [
    [{ id: 'wrong-way', title: 'WRONG WAY', tone: 'bad', slot: 'banner' }, 'telltale', 'no-entry', 'bad'],
    [{ id: 'engine-condition', title: 'ENGINE HOT', tone: 'info' }, 'telltale', 'engine', 'warn'],
    [{ id: 'engine-condition', title: 'BODY DAMAGE' }, 'telltale', 'damage', 'warn'],
    [{ id: 'tow' }, 'telltale', 'tow', 'warn'],
    [{ id: 'traction-control', text: 'TC OFF' }, 'telltale', 'esc-off', 'warn'],
    [{ id: 'traction-control', text: 'TC ON' }, 'telltale', 'esc', 'good'],
    [{ title: 'SPEED CAMERA' }, 'telltale', 'speed-camera', 'warn'],
    [{ title: 'RED LIGHT', tone: 'bad' }, 'telltale', 'red-light', 'bad'],
    [{ title: 'PULLED OVER', text: 'POLICE · HELD 10 S' }, 'telltale', 'police', 'bad'],
    [{ id: 'police-status', title: 'POLICE PURSUIT', tone: 'bad', slot: 'banner' }, 'telltale', 'police', 'bad'],
    [{ title: 'WATCH THE PAVEMENT!', tone: 'bad' }, 'telltale', 'pedestrian', 'bad'],
  ];
  for (const [item, kind, icon, lamp] of cases) assert.deepEqual([noticeStyle(item).kind, noticeStyle(item).telltale, noticeStyle(item).tone], [kind, icon, lamp], JSON.stringify(item));
});
test('navigation and objectives are head-up cues; tips and media are infotainment cards', () => {
  assert.equal(noticeStyle({ id: 'checkpoint', title: 'MISSED CHECKPOINT', tone: 'bad', slot: 'banner' }).kind, 'hud');
  assert.equal(noticeStyle({ id: 'objective-direction', title: 'TURN BACK SAFELY', slot: 'banner' }).telltale, 'u-turn');
  assert.equal(noticeStyle({ title: 'VOULIAGMENI', text: 'COAST ROAD', priority: 15 }).kind, 'hud');
  const tip = noticeStyle({ id: 'tip:brakes', text: 'Brake in a straight line before the corner.', actions: [{ label: 'GOT IT' }] });
  assert.deepEqual([tip.kind, tip.telltale, tip.label], ['card', 'tip', 'DRIVING TIPS']);
  assert.equal(noticeStyle({ text: 'Kalimera · Artist' + ' MUSIC' }).kind, 'card');
  assert.equal(noticeStyle({ id: 'x', kind: 'telltale', telltale: 'abs', tone: 'bad' }).telltale, 'abs', 'callers may choose explicitly');
});
test('every tell-tale renders as an SVG and as a CSS mask', () => {
  for (const name of TELLTALES) {
    assert.match(telltale(name), /^<svg class="telltale [^"]*" viewBox="0 0 24 24"/);
    assert.match(telltaleMask(name), /^url\("data:image\/svg\+xml,/);
    assert.doesNotMatch(decodeURIComponent(telltaleMask(name)), /currentColor/);
  }
});
