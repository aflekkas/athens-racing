// One factory-glass recipe for every car (player, rivals, traffic, police, cockpit view). A light grey-green tint
// that still shows the cabin from outside in daylight and the road from inside; rear privacy glass sits a step
// darker but never black. Plain alpha blending (no transmission pass), so it costs no more than the old glass.
export const GLASS_TINT = Object.freeze({
  cabin: { color: '#a4b9b7', opacity: 0.20 },
  privacy: { color: '#7f979c', opacity: 0.38 },
  open: { color: '#c4d4cf', opacity: 0.12 },   // convertibles: the cabin is exposed anyway
  far: { color: '#7d949a', opacity: 1 },       // opaque merged far-LOD glazing: lighter than the old near-black
});

export function tintGlass(m, kind = 'cabin') {
  const t = GLASS_TINT[kind];
  m.color.set(t.color); m.opacity = t.opacity;
  if (m.metalness > 0.05) m.metalness = 0.05;
  return m;
}
