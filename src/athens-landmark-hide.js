// OSM buildings whose flat default-height boxes the landmark models replace (the Parthenon is mapped as a 9.6 m block). Plain data, no three.js:
// the tile worker reads it. A tile keeps those rows as a separate mesh (`landmarkBox`) that is hidden while World detail is on.
import { LANDMARK_SITES } from './athens-landmark-data.js';
export const LANDMARK_HIDDEN = Object.freeze(new Set(Object.values(LANDMARK_SITES).flatMap(site => site.hide || [])));
/** The OSM way / relation id inside a building row id (`building:w910010406:0/-1:1` -> `w910010406`). */
export const osmBuildingId = id => String(id || '').split(':')[1] || '';
