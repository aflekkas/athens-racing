// One clean body per car (owner decision 2026-10-20, docs/OWNER-DECISIONS.md, "Simpler car styling": "we have these weird body
// panels and stuff"). Every model builder may still draw its add-on pieces; this single shared pass takes them off before the
// body is grouped and compacted, so no car, trim or builder keeps decorative panels. What stays: the paint-coloured body, glass,
// lights, grilles, wheels, exhausts, mirrors, plates and badges, and a livery that is a vehicle's identity (police, bus, truck).
//   aero add-ons ........ spoilers, wings and their uprights, diffusers and their fins, splitters, canards, flying buttresses
//   kit pieces .......... rub strips, protective and side mouldings, sill and rocker strips, wide-arch lips
//   stripes ............. bonnet and grille stripes (the police stripe is livery and stays)
//   decorative vents .... bonnet scoops, side intakes, gills, ducts, louvres and engine-cover slats
export const ADD_ON_PANEL = new RegExp([
  '(?:^|-)(?:spoiler|diffuser|splitter|scoop|louvre|wing-endplate|wing-mount|wing-upright|flying-buttress)(?:-|$)',
  '^(?:trim-big-rear-wing|svj-fixed-wing|distant-wing|diffuser-strake|boot-lip-spoiler)$',
  'rub-strip|protection-strip|moulding|rocker-panel|wheel-arch-lip|evo-arch-lip|amg-wide-arch|roof-side-rail|^sill-|-sill$|^sill$|side-strake|strake-depth|black-lower-quarter',
  '(?<!police-)stripe',
  'side-intake|corner-vent|cover-louvre|quarter-vent|side-cooling-duct|side-duct|bonnet-vent|wing-gill|air-breather|engine-cover-slat|engine-grille-slot|intake-louvre',
].join('|'));
/** Removes every add-on panel under `root`; returns how many parts went. Idempotent. */
export function stripAddOnPanels(root) {
  const doomed = [];
  root.traverse(o => { if (o !== root && o.name && ADD_ON_PANEL.test(o.name) && !doomed.some(p => p === o.parent)) doomed.push(o); });
  for (const o of doomed) { o.removeFromParent(); o.traverse(m => m.geometry?.dispose?.()); }
  return doomed.length;
}
