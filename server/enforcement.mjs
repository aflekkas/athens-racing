// SERVER ENFORCEMENT — authoritative validation of violation claims.
//
// Trust model (same as positions: clients own physics, the server owns
// timing/results). A client that passes a camera / enforced red light sends
// { type: 'violation', id, kind, s, kmh, dir }. The server:
//   1. binds the claim to the SENDING connection only — a claim can never
//      penalise another player, and guests have no special path to fake one;
//   2. rejects duplicate claim ids (no double-apply across retries/resends);
//   3. re-validates existence: the camera/site must be in the server's own
//      list, the reported speed over limit+margin (camera), the position
//      near the site (red);
//   4. returns the authoritative penalty seconds (event rules), which the
//      core adds to that racer's finish — never a client-supplied number.
//
// What the server does NOT do: it does not simulate signal phases or measure
// the stop line itself, so red-phase precision is client-measured (same trust
// as snapshot positions, which core.mjs already bounds). No camera in the
// server list = no accepted claim = no magical omniscient checks.
//
// Hook for the session owner (NOT applied here — server/core.mjs is shared):
//   import { validateViolation, penaltyFor } from './enforcement.mjs';
//   const enf = camerasForLobby(l.mapId); // from map data speedCameras
//   if (m.type === 'violation') {
//     if (l.status !== 'race' || m.raceId !== l.raceId || c.finish !== null || c.dnf) return;
//     const v = validateViolation(m, { cameras: enf, redSites: enfRed, seen: c.enfSeen ??= new Set(), now });
//     if (!v.accept) return; // silent: invalid, duplicate or faked
//     c.enfPenalty = (c.enfPenalty || 0) + penaltyFor(m.kind, lobbyEvent(l)?.rules);
//     l.dirty = true; send(c.ws, { type: 'violation-ack', id: m.id, penalty: c.enfPenalty });
//   }
// and add c.enfPenalty into the finish computation. Reset c.enfSeen /
// c.enfPenalty where racers reset (start/rematch).
// No DOM/three/filesystem: node can import this.

export const ENF_MARGIN_KMH = 10; // must match src/enforcement.js ENF.cameraMarginKmh
export const ENF_CAM_RADIUS_M = 12;
export const ENF_RED_RADIUS_M = 25;
export const CLAIM_TTL_MS = 30000; // claims older than this are stale

export function penaltyFor(kind, rules = {}) {
  if (kind === 'red') return Number.isFinite(rules?.penalty) ? rules.penalty : 2;
  if (kind === 'camera') return Number.isFinite(rules?.cameraPenalty) ? rules.cameraPenalty : 3;
  return 0;
}

/**
 * Validate one violation claim. claim: { id (string), kind, s, kmh?, dir? }.
 * ctx: { cameras [{s,dir,limitKmh}], redSites [{s}], seen (Set, mutated),
 *        now (ms), at (ms client timestamp, optional) }.
 * Returns { accept: bool, reason?: string }.
 */
export function validateViolation(claim, ctx = {}) {
  if (!claim || typeof claim.id !== 'string' || !claim.id) return { accept: false, reason: 'id' };
  if (claim.kind !== 'camera' && claim.kind !== 'red') return { accept: false, reason: 'kind' };
  if (!Number.isFinite(claim.s)) return { accept: false, reason: 's' };
  const seen = ctx.seen ?? (ctx.seen = new Set());
  if (seen.has(claim.id)) return { accept: false, reason: 'duplicate' };
  if (ctx.now !== undefined && claim.at !== undefined && ctx.now - claim.at > CLAIM_TTL_MS) {
    return { accept: false, reason: 'stale' };
  }
  if (claim.kind === 'camera') {
    const cams = ctx.cameras || [];
    const cam = cams.find((c) => Math.abs(c.s - claim.s) < ENF_CAM_RADIUS_M &&
      (c.dir === undefined || c.dir === 0 || claim.dir === undefined || claim.dir === 0 || c.dir === claim.dir));
    if (!cam) return { accept: false, reason: 'no-camera' };
    if (!Number.isFinite(claim.kmh) || claim.kmh <= (cam.limitKmh ?? 50) + ENF_MARGIN_KMH) {
      return { accept: false, reason: 'speed' };
    }
  } else {
    const sites = ctx.redSites || [];
    if (!sites.some((j) => Math.abs((j.s ?? j) - claim.s) < ENF_RED_RADIUS_M)) {
      return { accept: false, reason: 'no-site' };
    }
  }
  seen.add(claim.id);
  return { accept: true };
}
