// Greek capitals carry no tonos (ΤΗΘΥΟΣ, not ΤΗΘΎΟΣ). CSS and String.toUpperCase keep the accent of a lower-case street or place
// name, so every place that shows one in capitals goes through upperName. Latin letters keep theirs. Pure: no DOM.
const GREEK_MARKS = /([Ͱ-Ͽἀ-῿])[̀-ͯ]+/g;
/** upper-case a place or street name; Greek accents (tonos, dialytika, breathings) are dropped */
export const upperName = text => String(text ?? '').normalize('NFD').replace(GREEK_MARKS, '$1').toUpperCase().normalize('NFC');
