// Owner decisions 2026-10-20 ("One car per model (top trim only), no SVJ exhaust pops, simpler car styling, punishing damage"),
// docs/OWNER-DECISIONS.md. Do not bring any of this back without a new owner decision. Ask the owner before changing.
import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, readFileSync, readdirSync} from 'node:fs';
import {CARS} from '../src/cars.js';
import {validateStateExtras} from '../server/mp-lifecycle.mjs';
import {CAR_MODELS,inGarage,canonicalCarId} from '../src/car-catalog.js';
import {ADD_ON_PANEL} from '../src/vehicle-styling.js';
import {hasElectricHandbrake} from '../src/cockpit-handbrake.js';

const OWNER = 'Owner-locked decision (2026-10-20, docs/OWNER-DECISIONS.md). Ask the owner before changing.';
const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const sources = dir => readdirSync(new URL(dir, root), {recursive: true, withFileTypes: true})
  .filter(f => f.isFile() && /\.(m?js)$/.test(f.name) && !/\.test\.m?js$/.test(f.name))
  .map(f => `${dir}${(f.parentPath ?? f.path).replace(new URL(dir, root).pathname, '')}/${f.name}`.replace('//', '/'));

test('the SVJ has no exhaust pops: no flames, no pop audio, no warm-up, no shared flash light, no toggle', () => {
  for (const file of ['src/exhaust-pops.js', 'src/exhaust-flames.js', 'src/audio/exhaust-voice.js']) assert.equal(existsSync(new URL(file, root)), false, `${file} is gone. ${OWNER}`);
  assert.equal(CARS.some(c => 'exhaustPops' in c), false, OWNER);
  const files = [...sources('src/'), ...sources('server/'), ...sources('worker/')];
  assert.ok(files.length > 100, 'the scan reads the sources');
  for (const file of files) assert.doesNotMatch(read(file), /exhaustPops|ExhaustFlames|exhaustFlames|ExhaustPulse|exhaustPulse|warmFlamePipelines|flashLight|ExhaustVoice|exhaustSerial|exhaustEnabled/, `${file}: ${OWNER}`);
  assert.deepEqual(validateStateExtras({exhaustSerial: 5, exhaustKind: 2, exhaustEnabled: true}), {}, 'old clients\' pop fields are ignored on the wire');
  assert.doesNotMatch(read('src/car-select.js'), /EXHAUST POPS/, OWNER);
});

test('one car per model, its top trim: no trims, no body choice, no trim UI, no Jazz drift spec', () => {
  assert.equal(CAR_MODELS.length, 31);
  for (const m of CAR_MODELS) { assert.equal(typeof m.car, 'string', m.id); assert.equal(m.trims, undefined, `${m.id}: ${OWNER}`); assert.equal(m.bodies, undefined, `${m.id}: ${OWNER}`); assert.equal(inGarage(m.car), true); }
  assert.equal(CARS.some(c => c.id === 'jazz_drift' || c.fantasy && /jazz/i.test(c.id + c.name)), false, OWNER);
  for (const file of [...sources('src/'), ...sources('server/'), ...sources('worker/')]) assert.doesNotMatch(read(file), /trimPicker|stepTrim|trimChoices|bodyTrim|sortTrims|baseTrim|trimName|carTrim:|data-trim-current|carTrimNext/, `${file}: ${OWNER}`);
  for (const gone of ['TRIM', 'BODY', 'carBody', 'HARDTOP']) assert.doesNotMatch(read('src/car-select.js'), new RegExp(`\\b${gone}\\b`), OWNER);
  for (const [old, kept] of [['golf_gti', 'golf_r'], ['mini_cabrio_cooper', 'mini_jcw'], ['jazz_drift', 'jazz_dynamic'], ['taxi', 'octavia_rs']]) assert.equal(canonicalCarId(old), kept, `${old}: ${OWNER}`);
});

test('simpler car styling: one shared pass takes the add-on panels off every car', () => {
  const models = read('src/vehicle-models.js');
  assert.match(models, /stripAddOnPanels\(car\.body\)/, OWNER);
  assert.doesNotMatch(models, /trim-big-rear-wing|trim-front-splitter|trim-rear-diffuser|trim-spoiler-lip|m-front-splitter|trim-grille-stripe|trim-diffuser-fin|visual\??\.(wing|kit|lip)\b/, OWNER);
  assert.match(models, /d\.blackRoof=false;d\.archTrim=false/, `no two-tone roof or arch trim. ${OWNER}`);
  for (const name of ['rear-diffuser', 'front-splitter', 'jcw-roof-spoiler', 'hatch-roof-spoiler', 'bonnet-stripe', 'front-bumper-rub-strip', 'svj-deep-side-intake', 'svj-fixed-wing', 'svj-diffuser-fin', 'evo-side-intake', 'bonnet-scoop', 'side-sill', 'rocker-panel']) assert.ok(ADD_ON_PANEL.test(name), name);
  for (const name of ['police-stripe', 'front-bumper', 'rear-bumper', 'windscreen', 'front-lamp-housing', 'mini-hex-grille', 'undertray', 'brand-badge', 'exhaust', 'wheel-spin', 'door_lf']) assert.ok(!ADD_ON_PANEL.test(name), `${name} stays on the car`);
  assert.equal(CARS.some(c => c.visual && ('kit' in c.visual || 'wing' in c.visual || 'lip' in c.visual)), false, OWNER);
});

test('the handbrake shows in the cabin: a lever that swings up, or a lit button on an electric parking brake', () => {
  assert.match(read('src/cockpit.js'), /buildHandbrake\(/, OWNER);
  assert.match(read('src/fleet-interiors.js'), /buildHandbrake\(/, OWNER);
  assert.match(read('src/fleet-cockpit.js'), /handbrake\?\.update\(dt,!!st\.handbrake\)/, OWNER);
  assert.match(read('src/main.js'), /handbrake: \(input\.handbrake \|\| pv\.handbrakeInput === true\)/, `the cabin follows the vehicle's held handbrake. ${OWNER}`);
  for (const id of ['golf_r', 'z4', 'cle53', 'carrera_gts', 'huracan']) assert.ok(hasElectricHandbrake({ id }), id);
  for (const id of ['mini_jcw', 'gtv', 'jazz_dynamic', 'gr_yaris', 'p928', 'bus']) assert.ok(!hasElectricHandbrake({ id }), id);
});
