import { getPlayableMaps } from './enabled-maps.js';

// Catalogue metadata only: title copy must never need a loaded world.
export function mapTagline(catalogue) {
  const names = getPlayableMaps(catalogue).map(({ name }) => name.toLocaleLowerCase('en').replace(/(^|\s)(\p{L})/gu, (_, space, letter) => space + letter.toLocaleUpperCase('en')));
  return names.length ? `Drive Attica: ${new Intl.ListFormat('en', { type: 'conjunction' }).format(names)}.` : 'Drive Attica.';
}
