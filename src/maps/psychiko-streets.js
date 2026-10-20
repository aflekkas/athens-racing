// Street View cross-section classes (municipal survey 2026-10-19). Pure data policy shared by offline and runtime builders.
// Kerb-to-kerb widths include kerb parking. Mirrors tools/maps/psychiko/raw/street-classes.json (asserted by tools/psychiko-world.test.mjs);
// the per-OSM-way memberships stay offline and reach the runtime as each road's `k`.
export const PSYCHIKO_CLASSES = Object.freeze({
  J13: { w: 13, footway: 1.7, paint: 'split', kind: 'avenue' },
  A9: { w: 9, footway: 1.7, paint: 'double', kind: 'avenue' },
  A8: { w: 8, footway: 1.5, paint: 'double', kind: 'avenue' },
  R6: { w: 6, footway: 1.2, paint: 'none', kind: 'residential' },
  N5: { w: 5.5, footway: 1, paint: 'none', kind: 'lane' },
  N4: { w: 3.5, footway: .6, paint: 'none', kind: 'lane' },
  H6: { w: 6, footway: 1, paint: 'none', kind: 'hill' },
  P7: { w: 7, footway: 1.3, paint: 'none', kind: 'park' },
  I7: { w: 7, footway: 1.2, paint: 'double', kind: 'school' },
  F5: { w: 5, footway: 1, paint: 'none', kind: 'frontage' },
  D8: { w: 8, footway: 1.3, paint: 'dashed', kind: 'arterial' },
  T10: { w: 10.5, footway: 1.7, paint: 'dashed', kind: 'arterial' },
  C7: { w: 7, footway: 1.5, paint: 'none', kind: 'ring' },
});
// Paint code read by the road shaders: 1 double solid centre line, 0.25 dashed same-direction lane dividers.
const PAINT = { double: 1, split: .6, dashed: .25, none: 0 };
// Share of kerb sides with parked cars per class, from the surveyed stations ((2·both + one side) / 2·stations).
const PARKING = { J13: 0, A9: .71, A8: .73, R6: .68, N5: .62, N4: .5, H6: .51, P7: .22, I7: .75, F5: .36, D8: .13, T10: 0, C7: .88 };

/** Cross-section for a street. `k` is the surveyed per-way class; C7 rings and unsurveyed ways keep the earlier name defaults. */
export function psychikoStreet(name = '', north = false, k = null) {
  const c = k && k !== 'C7' ? PSYCHIKO_CLASSES[k] : null;
  if (c) return { k, w: c.w, sw: c.footway, paint: PAINT[c.paint], kind: c.kind, parking: PARKING[k] };
  if (/Diamant|Διαμαντ/i.test(name)) return { w: 9, sw: 1.7, paint: 1, kind: 'avenue', parking: .72 };
  if (/Vasileos Pavlou|Βασιλέως Παύλου/i.test(name)) return { w: 8, sw: 1.6, paint: 1, kind: 'cypress', parking: .45 };
  if (/Benak|Μπενάκη/i.test(name)) return { w: 8, sw: 1.3, paint: 1, kind: 'school', parking: .4 };
  if (/25is Martiou|25ης Μαρτίου/i.test(name)) return { w: north ? 7 : 8, sw: 1.6, paint: north ? .45 : 1, kind: 'avenue', parking: .5 };
  if (/Marathon|Μαραθων/i.test(name)) return { w: 5, sw: 1, paint: 0, kind: 'frontage', parking: .5 };
  if (/Tay?get|Taiget|Ταϋγ|Ταυγ/i.test(name)) return { w: 5.5, sw: 1.2, paint: 0, kind: 'olive', parking: .72 };
  if (/Pavlou Mela|Παύλου Μελά/i.test(name) && north) return { w: 5.5, sw: 1.1, paint: 0, kind: 'blocks', parking: .35 };
  return { w: /Sisman|Σισμαν|Parasch|Παράσχ|Bizan|Μπιζαν/i.test(name) ? 5.5 : 6, sw: 1.3, paint: 0, kind: 'residential', parking: .42 };
}
export function psychikoSection(route, s) {
  const q = ((s % route.length) + route.length) % route.length, n = route.names.findLast(n => n.s <= q);
  return psychikoStreet(n?.name, q > 4000, n?.k);
}
