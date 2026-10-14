// Reviewed 2026-10-14. Primary publications establish the pilot programme and
// its dates, not the exact post/direction at Ermou. Never promote press leads
// or a junction coordinate into a surveyed, active camera placement.
import { limitFor } from './enforcement.js';
export const VERIFIED_CAMERAS = [];
export const VERIFIED_RED_LIGHT_SITES = [];
export const UNVERIFIED_CANDIDATES = [
  { id: 'poseidonos-ermou', area: 'Poseidonos / Ermou, Vouliagmeni', mapId: 'riviera', s: 220,
    lat: 37.81273, lon: 23.78194, precision: 'OSM intersection centre, not camera post',
    direction: 'unverified', status: 'site reported; current individual activation unverified',
    source: 'https://menoumealimo.gr/ai-kameres-xekinisan-oi-kliseis-pou-grafoun-ston-alimo/',
    programmeSource: 'https://www.mindigital.gr/archives/8471', verified: false, active: false },
  { id: 'poseidonos-alimou', area: 'Poseidonos / Alimou, Alimos', mapId: null,
    precision: 'named intersection only; outside all playable routes', direction: 'unverified',
    status: 'installation reported; not mapped into game',
    source: 'https://www.patt.gov.gr/wp-content/uploads/2025/10/Αποφ.-226-ΕΓΚΡΙΣΗ-ΠΑΡΑΤ-1ης-2ης-ΤΜΗΜ-ΠΡΟΘ.-ΚΑΜΕΡΕΣ-ΚΟΚ.pdf',
    verified: false, active: false },
];
const mapIdOf = map => map?.id || map?.mapId;
function sitesFor(map, catalogue, kind) {
  const id = mapIdOf(map), data = map?.data || map;
  if (!id) return [];
  return catalogue.filter(c => c.mapId === id && c.verified === true && c.active === true &&
    Number.isFinite(c.s) && c.s >= 0 && c.s <= (data?.route?.length ?? map?.route?.length ?? -1) &&
    [1, -1, 0].includes(c.dir) && typeof c.id === 'string' && typeof c.source === 'string' &&
    (kind !== 'camera' || Number.isFinite(c.limitKmh))).map(c => ({ ...c }));
}
export function collectCameras(map, opts = {}) {
  const data = map?.data || map;
  const catalogue = [...VERIFIED_CAMERAS, ...(data?.speedCameras || [])];
  const out = sitesFor(map, catalogue, 'camera');
  // Explicit fixture/developer-only option; production never enables this.
  if (opts.trustMapData) for (const [i, c] of (data?.speedCameras || []).entries()) {
    if (c.verified || !Number.isFinite(c.s)) continue;
    out.push({ ...c, id: c.id || `fixture-camera-${i}`, mapId: mapIdOf(map), dir: c.dir,
      limitKmh: c.limitKmh ?? limitFor(data?.route?.speeds, c.s), source: 'fixture map-data', status: 'fixture', verified: false, active: false });
  }
  return out;
}
export function collectRedLightSites(map) {
  return sitesFor(map, [...VERIFIED_RED_LIGHT_SITES, ...((map?.data || map)?.redLightSites || [])], 'red');
}
