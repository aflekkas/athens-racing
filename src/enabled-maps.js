// Shared enabled-map registry (owner: MP session/modes).
// Single source for which maps are playable: menus filter offerings through
// getPlayableMaps/isMapEnabled, and the server rejects disabled maps in
// create/options. Circuit and public-road maps share the same registry. No three.js/DOM: node imports this for validation.
export const PLAYABLE_MAPS = Object.freeze(['riviera', 'megara', 'penteli']);

export const isMapEnabled = (id) => PLAYABLE_MAPS.includes(id);

// Filters a catalogue of map entries ({ id } or plain ids) to playable ones,
// preserving catalogue order.
export function getPlayableMaps(catalogue = []) {
  return [...catalogue].filter((m) => isMapEnabled(m?.id ?? m));
}
