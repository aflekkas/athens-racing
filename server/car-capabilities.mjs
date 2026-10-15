// Read only catalogue metadata; importing cars.js would require browser graphics.
// Entries have unique id fields. Bound capability scans to each entry's span.
const SPEC_NUMBERS = ['power', 'mass', 'torque', 'vmax', 'grip', 'gripRear', 'brake', 'zeroTo100'];
export function readCarCapabilities(source) {
  const literal = source.split('export const CARS = [')[1]?.split('\n];')[0];
  if (!literal) throw new Error('Missing playable car catalogue');
  const entries = [...literal.matchAll(/\bid:\s*'([^']+)'/g)];
  const spans = entries.map((entry, i) => literal.slice(entry.index, entries[i + 1]?.index));
  const specs = {};
  for (let i = 0; i < entries.length; i++) {
    const spec = {};
    for (const [, key, value] of spans[i].matchAll(/\b(power|mass|torque|vmax|grip|gripRear|brake|zeroTo100)\s*:\s*(\d+(?:\.\d+)?)/g)) {
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
  return {
    cars: entries.map(entry => entry[1]),
    nitrousCars: entries.filter((entry, i) => /\bnitrous:\s*true\b/.test(spans[i])).map(entry => entry[1]),
    specs,
  };
}
