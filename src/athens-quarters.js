// The old quarters of Athens, where the buildings are neoclassical houses with pitched tile roofs rather than polykatoikies (concrete
// flat-roofed apartment blocks): Plaka and Anafiotika, Monastiraki, Thiseio and Psyrri, Makrygianni and Koukaki, Kolonaki, Exarchia and
// Neapoli, Metaxourgeio, Pangrati and Mets. Rough boxes in latitude / longitude, turned into world metres with the cells' own projection.
// They only bias the procedural facade and roof choice (src/world-tile-buildings.js); OSM's own roof / heritage tags win where a bake has them.
const PROJECTION = { lat0: 37.98, lon0: 23.73, mlat: 111320, mlon: 87745.27512677578 };
const metres = (lat, lon) => [(lon - PROJECTION.lon0) * PROJECTION.mlon, -(lat - PROJECTION.lat0) * PROJECTION.mlat];
/** name, south, north, west, east (degrees) */
export const OLD_QUARTERS = Object.freeze([
  ['plaka-anafiotika-monastiraki', 37.9685, 37.9782, 23.7250, 23.7335],
  ['thiseio-psyrri', 37.9765, 37.9835, 23.7180, 23.7285],
  ['makrygianni-koukaki', 37.9595, 37.9690, 23.7185, 23.7310],
  ['kolonaki', 37.9760, 37.9845, 23.7375, 23.7475],
  ['exarchia-neapoli', 37.9840, 37.9905, 23.7265, 23.7395],
  ['metaxourgeio-kerameikos', 37.9840, 37.9895, 23.7150, 23.7260],
  ['pangrati-mets', 37.9615, 37.9765, 23.7435, 23.7560],
].map(([name, south, north, west, east]) => { const [x0, z1] = metres(south, west), [x1, z0] = metres(north, east); return Object.freeze({ name, x0, x1, z0, z1 }); }));
/** Is the world point (x, z), metres, inside an old quarter? */
export function inOldQuarter(x, z) {
  for (const q of OLD_QUARTERS) if (x >= q.x0 && x <= q.x1 && z >= q.z0 && z <= q.z1) return true;
  return false;
}
