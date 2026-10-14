// Read only catalogue metadata; importing cars.js would require browser graphics.
// Entries have unique id fields. Bound capability scans to each entry's span.
export function readCarCapabilities(source) {
  const literal = source.split('export const CARS = [')[1]?.split('\n];')[0];
  if (!literal) throw new Error('Missing playable car catalogue');
  const entries = [...literal.matchAll(/\bid:\s*'([^']+)'/g)];
  return {
    cars: entries.map(entry => entry[1]),
    nitrousCars: entries.filter((entry, i) => /\bnitrous:\s*true\b/.test(literal.slice(entry.index, entries[i + 1]?.index))).map(entry => entry[1])
  };
}
