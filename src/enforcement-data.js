// ENFORCEMENT DATA — where speed/red-light cameras physically exist.
//
// Provenance rule: an entry is `verified: true` ONLY with a primary official
// source or dated geospatial evidence behind it (Hellenic Police / Ministry /
// dated Street View or aerial showing the post). Anything else is listed as
// unverified and NEVER enforced as real. Research uncertainty blocks the
// placement, never the mechanism (src/enforcement.js works on any list).
//
// Research status (2026-10-14, this environment has no web access — both
// search and page fetch return HTTP 403 — so no official source could be
// consulted):
//   - data/map.json `speedCameras` is EMPTY (no mapped camera posts on any
//     route), and no junction carries an explicit red-light-camera flag.
//     There is therefore nothing verified to place; the verified list below
//     is intentionally empty rather than invented.
//   - UNSUPPORTED (needs official confirmation before any placement):
//       * rumoured fixed speed cameras on the Athens Riviera / Poseidonos
//         avenue (press reports of new police road cameras; exact posts,
//         directions and activation status unverified);
//       * red-light cameras at signalised junctions on the route (which
//         junctions are camera-enforced is unpublished data);
//       * fine amounts / penalty points in the real Code (not modelled — the
//         game uses seconds, never euros or points).
// Do NOT invent coordinates or fines to fill this in. When an owner verifies
// a site, add { s, u, dir, limitKmh, source, status } with source cited.
//
// No DOM, no three.js: node can import this.
import { limitFor } from './enforcement.js';

/** Verified fixed speed-camera sites. Empty until a site is verified (see above). */
export const VERIFIED_CAMERAS = [];

/** Candidate sites reported but NOT verified — never enforced, listed for research. */
export const UNVERIFIED_CANDIDATES = [
  { area: 'Poseidonos avenue (Athens Riviera)', note: 'Press reports of new police road cameras; exact posts/directions/activation unverified.', source: 'press (uncited)', status: 'unverified' },
  { area: 'Signalised junctions on the route', note: 'Which junctions are red-light-camera enforced is unpublished.', source: 'none', status: 'unverified' },
];

/**
 * Build the enforced camera list for a loaded map bundle ({ data, route }).
 * Reads data.speedCameras [{ s, u, dir }] — the same array src/speed-signs.js
 * renders — attaches the posted limit from the route speed table (the speed
 * owner's data, reused not overwritten), and stamps provenance. Map-data
 * entries without an explicit verified flag ride as status 'map-data' and are
 * enforced only when opts.trustMapData is true (staging default false: with
 * an empty speedCameras array this changes nothing today).
 */
export function collectCameras(map, opts = {}) {
  const out = [];
  for (const c of VERIFIED_CAMERAS) out.push({ ...c, verified: true });
  if (opts.trustMapData) {
    const speeds = map?.data?.route?.speeds || map?.route?.speeds || [];
    for (const c of map?.data?.speedCameras || []) {
      out.push({
        s: c.s, u: c.u ?? 0, dir: c.dir ?? 0,
        limitKmh: c.limitKmh ?? limitFor(speeds, c.s),
        source: 'map-data speedCameras', status: 'map-data', verified: false,
      });
    }
  }
  return out;
}

/**
 * Red-light camera sites: junctions explicitly flagged enforced.
 * No flag exists in the data yet, so this returns [] — callers treat an
 * empty list as "no camera enforcement anywhere" (witnessed-by-police still
 * applies via src/police.js). Signature kept for the flag when it lands.
 */
export function collectRedLightSites(map) {
  void map;
  return [];
}
