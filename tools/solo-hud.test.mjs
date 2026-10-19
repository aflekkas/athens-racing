import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Multiplayer } from '../src/multiplayer.js';
import { layoutRacerMarkers } from '../src/racer-marker-layout.js';

// Owner decision 2026-10-18: multiplayer entry is the title tile; RACE is solo-only.
test('solo races and free roam have no multiplayer HUD button; joined sessions retain it', () => {
  const mp = Object.create(Multiplayer.prototype);
  mp.button = {};
  for (const lobby of [null, { status: 'waiting' }, { status: 'race' }, null]) {
    mp.lobby = lobby;
    mp.syncSessionControls();
    assert.equal(mp.button.hidden, !lobby);
  }
  const source = readFileSync('src/multiplayer.js', 'utf8');
  assert.match(source, /this\.syncSessionControls\(\); document\.body\.append\(this\.button\)/, 'hidden before mounting');
  assert.match(source, /this\.lobby = m\.lobby; this\.syncSessionControls\(\)/, 'joining updates visibility');
  assert.match(source.match(/  left\(\)[^\n]*/)[0], /this\.syncSessionControls\(\)/, 'leaving hides the shortcut');
  assert.match(readFileSync('src/ui/ui.css', 'utf8'), /body #mp-toggle\[hidden\] \{ display: none !important; \}/, 'HUD styles must respect hidden');
});

const overlaps = (a, b) => Math.abs(a.x - b.x) < (a.width + b.width) / 2 && a.y > b.y - b.height && a.y - a.height < b.y;
test('crowded rival tags stack within narrow and wide desktop windows', () => {
  for (const [width, height] of [[960, 700], [1280, 720], [1920, 1080]]) {
    for (const y of [20, height / 2, height - 10]) {
      const tags = ['ELENI', 'STAV', 'NIKOS', 'ALEX'].map((id, i) => ({ id, x: width / 2 + i * 3, y, width: 64, height: 42 }));
      const placed = layoutRacerMarkers(tags, width, height);
      for (const [i, tag] of placed.entries()) {
        assert.ok(tag.y - tag.height >= 8 && tag.y <= height - 8, `${tag.id} stays visible`);
        for (const other of placed.slice(i + 1)) assert.ok(!overlaps(tag, other), `${tag.id}/${other.id} readable`);
      }
      assert.deepEqual(placed, layoutRacerMarkers([...tags].reverse(), width, height), 'input ordering does not shuffle the stack');
    }
  }
});
test('separated tags keep their projected anchors', () => {
  const tags = [{ id: 'a', x: 150, y: 200, width: 64, height: 42 }, { id: 'b', x: 450, y: 200, width: 64, height: 42 }];
  assert.deepEqual(layoutRacerMarkers(tags, 852, 393), tags);
});
