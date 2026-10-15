// Street View station classes, 2026-10-15. Pure data policy shared by offline and runtime builders.
export function psychikoStreet(name = '', north = false) {
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
  const q = ((s % route.length) + route.length) % route.length;
  return psychikoStreet(route.names.findLast(n => n.s <= q)?.name, q > 4000);
}
