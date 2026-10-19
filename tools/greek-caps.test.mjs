// Greek capitals drop the tonos: a clicked road in the free roam picker reads ΤΗΘΥΟΣ, not ΤΗΘΎΟΣ.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { upperName } from '../src/greek-caps.js';

test('upperName drops Greek accents and keeps everything else', () => {
  assert.equal(upperName('Τηθύος'), 'ΤΗΘΥΟΣ');
  assert.equal(upperName('Λεωφ. Ελευθερίου Βενιζέλου'), 'ΛΕΩΦ. ΕΛΕΥΘΕΡΙΟΥ ΒΕΝΙΖΕΛΟΥ');
  assert.equal(upperName('Μπενάκη'), 'ΜΠΕΝΑΚΗ'); assert.equal(upperName('Ναρκίσσου'), 'ΝΑΡΚΙΣΣΟΥ'); assert.equal(upperName('ΐ'), 'Ι');
  assert.equal(upperName('Apollonos'), 'APOLLONOS'); assert.equal(upperName('Café Ελλάς'), 'CAFÉ ΕΛΛΑΣ'); assert.equal(upperName(null), '');
  assert.equal(upperName('Ηρώδου Αττικού'), upperName('Ηρώδου Αττικού').normalize('NFC'));
});
test('the picker, the HUD road name, route labels and signs all use it', () => {
  const read = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
  assert.match(read('src/spawn-select.js'), /name: upperName\(snap\.street\)/);
  assert.match(read('src/hud.js'), /rn = upperName\(rn\)\.replace/); assert.match(read('src/road.js'), /makeLabel\(upperName\(f\.n\)/);
  assert.match(read('src/events.js'), /upperName\(ctx\.route\.from \|\| 'START'\)/);
});
