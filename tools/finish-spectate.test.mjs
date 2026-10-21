import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FinishSpectator } from '../src/finish-spectate.js';
import { Multiplayer } from '../src/multiplayer.js';

const drivers = () => [{ id: 'far', progress: 50 }, { id: 'near', progress: 90 }, { id: 'done', finish: 10, progress: 100 }, { id: 'dnf', dnf: true, progress: 95 }];
test('finish immediately spectates nearest unfinished racer; cycling, finishes and disconnects end at results', () => {
  const flow = new FinishSpectator(), field = drivers();
  const frame = (finished = true, complete = false) => flow.update({ raceId: 'solo', finished, complete, drivers: field });
  assert.equal(frame(false), null); assert.equal(flow.phase, 'racing');
  assert.equal(frame().id, 'near'); assert.equal(flow.phase, 'spectating');
  const running = field.filter(p => p.finish == null && !p.dnf);
  assert.equal(flow.step(1, 'solo', running).id, 'far');
  assert.equal(flow.step(-1, 'solo', running).id, 'near');
  field[1].connected = false; assert.equal(frame().id, 'far');
  field[0].finish = 20; assert.equal(frame(), null); assert.equal(flow.phase, 'results');
  field[1].connected = true; assert.equal(frame(), null, 'results never reopens spectate on reconnection');
  assert.equal(flow.update({ raceId: 'rematch', finished: true, drivers: field }).id, 'near');
});
test('skip and authoritative timeout are terminal; no unfinished field opens results immediately', () => {
  for (const reason of ['skip', 'timeout', 'empty']) {
    const flow = new FinishSpectator(), field = drivers();
    if (reason === 'empty') { flow.update({ raceId: 'r', finished: true, drivers: [] }); }
    else {
      flow.update({ raceId: 'r', finished: true, drivers: field });
      if (reason === 'skip') flow.skip();
      else flow.update({ raceId: 'r', finished: true, drivers: field, complete: true });
    }
    assert.equal(flow.phase, 'results');
    assert.equal(flow.update({ raceId: 'r', finished: true, drivers: field }), null);
  }
});
test('multiplayer finish uses existing standings and peers; disconnect, finish and skip hand off without sending', () => {
  const mp = Object.create(Multiplayer.prototype);
  Object.assign(mp, { id: 'me', loaded: true, peers: new Map([['near', { state: { s: 90 } }], ['far', { state: { s: 50 } }]]),
    lobby: { raceId: 'online', status: 'race', players: [{ id: 'me', finish: 12 }, ...drivers()], standings: [{ id: 'me' }, { id: 'near', progress: 90 }, { id: 'far', progress: 50 }, { id: 'done' }, { id: 'dnf' }] },
    send() { assert.fail('spectating must not add network traffic'); } });
  assert.equal(mp.spectating().id, 'near');
  mp.stepSpectator(1); assert.equal(mp.spectating().id, 'far');
  mp.lobby.players.find(p => p.id === 'far').connected = false;
  assert.equal(mp.spectating().id, 'near');
  mp.lobby.players.find(p => p.id === 'near').finish = 20;
  assert.equal(mp.spectating(), null); assert.equal(mp.selection.phase, 'results');
  mp.lobby.raceId = 'next'; mp.lobby.players.find(p => p.id === 'near').finish = null;
  assert.equal(mp.spectating().id, 'near'); mp.selection.skip(); assert.equal(mp.spectating(), null);
  mp.lobby.status = 'results'; assert.equal(mp.spectating(), null);
});
test('spectate HUD stays on the watched driver: lap hidden, gap trails the leader, solo R restarts', () => {
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  const card = readFileSync(new URL('../src/ui/finish-spectate.js', import.meta.url), 'utf8');
  const decisions = readFileSync(new URL('../docs/OWNER-DECISIONS.md', import.meta.url), 'utf8');
  const owner = 'Owner-locked decision, see docs/OWNER-DECISIONS.md. Ask the owner before changing.';
  // The lap widget is bound to the player's own run, so it must hide while spectating (multiplayer
  // never shows it either: G.run is not the active race's run there).
  assert.match(main, /updateLapHud\(G\.run, !finishWatched &&/, owner);
  // The frozen player progress must not leak into the gap: the watched driver trails the race leader.
  assert.match(main, /leaderProg - earnedProgress\(finishWatched\.car\)/, owner);
  assert.match(main, /gap: leaderProg - earnedProgress\(finishWatched\.car\), gapUnit: 'm'/, owner);
  // Solo R restarts like R after a race normally does; multiplayer R still opens results.
  assert.match(main, /if \(name === 'restart' && !multiplayer\.active\) \{ openEvent\(G\.ev\.def\); return true; \}/, owner);
  assert.match(main, /updateFinishSpectateHud\(\{[^}]*canRestart: !multiplayer\.active \}/, owner);
  assert.match(card, /canRestart/, owner);
  // Each chip names its actual key: the R chip restarts, Esc/Enter open results, and the
  // labels carry no duplicated key text (the binding-derived keyHints would show Enter).
  assert.match(card, /C\.kbd\('R'\)\}<\/span>[\s\S]*?RESTART<\/span>/, owner);
  assert.match(card, /C\.kbd\('ESC'\)\}\$\{C\.kbd\('ENTER'\)\}.*RESULTS<\/span>/s, owner);
  assert.doesNotMatch(card, /keyHints/, owner);
  assert.doesNotMatch(card, /RESTART · R/, owner);
  assert.doesNotMatch(card, /RESULTS · ENTER/, owner);
  assert.match(decisions, /non-colliding ghost/, owner);
});
test('owner-locked spectate on finish is connected to both production finish paths and interpolated camera', () => {
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  const decisions = readFileSync(new URL('../docs/OWNER-DECISIONS.md', import.meta.url), 'utf8');
  const owner = 'Owner-locked decision, see docs/OWNER-DECISIONS.md. Ask the owner before changing.';
  assert.match(decisions, /2026-10-21: Spectate on finish/, owner);
  const solo = main.slice(main.indexOf('function finishRace('), main.indexOf('function showResults('));
  assert.match(solo, /updateFinishView\(\)/, owner);
  const online = main.slice(main.indexOf('  clock(elapsed, remaining)'), main.indexOf('  results() {', main.indexOf('  clock(elapsed, remaining)')));
  assert.match(online, /updateFinishView\(\)/, owner);
  assert.doesNotMatch(online, /panel.hidden = false/, owner);
  assert.match(main, /\['pause', 'back', 'confirm', 'restart'\].*finishViewResults/s, owner);
  assert.match(main, /name === 'left' \|\| name === 'right'/, owner);
  assert.match(main, /remoteCars.get\(watching.id\).*watching.car/, owner);
  assert.match(main, /visible = targetCar.model.root.position/, owner);
  assert.match(main, /G.spectateId !== watching.id\) beginCameraBlend/, owner);
  assert.match(main, /updateFinishSpectateHud\(/, owner);
  assert.match(main, /flowAction\(name\);[\s\S]*?if \(!inMenu && window.__flow.inMenu\(\)\) break/, owner);
});
