// Read only catalogue metadata; importing cars.js would require browser graphics.
// Entries have unique id fields. Bound capability scans to each entry's span.
import { CAR_MODELS } from '../src/car-catalog.js';
// Owner decision 2026-10-20 (docs/OWNER-DECISIONS.md): one car per model, its top trim. Specs of removed trims stay in the file for
// background traffic only; players, lobbies and leaderboards know the kept cars alone.
const PLAYABLE = new Set(CAR_MODELS.map(m => m.car));
const SPEC_NUMBERS = ['power', 'mass', 'torque', 'vmax', 'grip', 'gripRear', 'brake', 'zeroTo100', 'width', 'length'];
export function readCarCapabilities(source) {
  const literal = source.split('export const CARS = [')[1]?.split('\n];')[0];
  if (!literal) throw new Error('Missing playable car catalogue');
  const entries = [...literal.matchAll(/\bid:\s*'([^']+)'/g)];
  const spans = entries.map((entry, i) => literal.slice(entry.index, entries[i + 1]?.index));
  const specs = {};
  for (let i = 0; i < entries.length; i++) {
    const spec = {};
    for (const [, key, value] of spans[i].matchAll(/\b(power|mass|torque|vmax|grip|gripRear|brake|zeroTo100|width|length)\s*:\s*(\d+(?:\.\d+)?)/g)) {
      if (SPEC_NUMBERS.includes(key) && spec[key] === undefined) spec[key] = +value;
    }
    const drive = spans[i].match(/\bdrive\s*:\s*["'](\w+)["']/);
    if (drive) spec.drive = drive[1];
    // Display names for ruleset rejection messages ("GR YARIS is class A …").
    const short = spans[i].match(/\bshort\s*:\s*["']([^"']+)["']/);
    if (short) spec.short = short[1];
    const name = spans[i].match(/\bname\s*:\s*["']([^"']+)["']/);
    if (name) spec.name = name[1];
    specs[entries[i][1]] = spec;
  }
  const playable = entries.filter(entry => PLAYABLE.has(entry[1]));
  return {
    cars: playable.map(entry => entry[1]),
    nitrousCars: entries.filter((entry, i) => PLAYABLE.has(entry[1]) && /\bnitrous:\s*true\b/.test(spans[i])).map(entry => entry[1]),
    specs: Object.fromEntries(playable.map(entry => [entry[1], specs[entry[1]]])),
  };
}
