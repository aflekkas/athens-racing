// Core owns the sender, validated snapshots, configuration and receipt clock.
// This reducer cannot validate a packet without that context. Client physics
// remain client-owned; penalties, cooldowns and result seconds are server-owned.
export const ENF_MARGIN_KMH = 10;
export const ENF_CAM_RADIUS_M = 12;
export const ENF_RED_RADIUS_M = 25;
export const CLAIM_TTL_MS = 5000;
export const MAX_CLAIMS = 256;
const COOLDOWN_MS = 60000;
const reject = reason => ({ accept: false, reason });
const boundedPenalty = (v, fallback) => Number.isFinite(v) && v >= 0 && v <= 60 ? v : fallback;
export function penaltyFor(kind, rules = {}) {
  if (kind === 'red') return boundedPenalty(rules?.penalty, 2);
  if (kind === 'camera') return boundedPenalty(rules?.cameraPenalty, 3);
  return 0;
}
export function createEnforcementState(raceId, generation) {
  return { raceId, generation, claims: new Map(), sites: new Map() };
}
// Invoke after each accepted pose: leaving a site re-arms its pass latch.
// No timers, polling or extra packets; state is bounded by the map's sites.
export function observeEnforcementState(enforcement, snapshot, sites, now) {
  if (!enforcement || !snapshot || !Number.isFinite(now)) return;
  for (const site of sites || []) {
    const p = enforcement.sites.get(site.id);
    if (p && Math.abs(snapshot.s - site.s) > ENF_RED_RADIUS_M + 15) p.inside = false;
  }
}
export function validateViolation(claim, ctx = {}) {
  if (ctx.enabled !== true || ctx.active !== true) return reject('disabled');
  const e = ctx.enforcement;
  if (!e || !ctx.raceId || claim?.raceId !== ctx.raceId || claim?.generation !== ctx.generation ||
      e.raceId !== ctx.raceId || e.generation !== ctx.generation) return reject('race');
  if (typeof claim.id !== 'string' || !/^[a-zA-Z0-9:_-]{1,64}$/.test(claim.id)) return reject('id');
  if (claim.kind !== 'camera' && claim.kind !== 'red') return reject('kind');
  if (!Number.isFinite(claim.at) || !Number.isFinite(ctx.now) || claim.at > ctx.now + 2000 || ctx.now - claim.at > CLAIM_TTL_MS) return reject('stale');
  if (e.claims.has(claim.id)) return reject('duplicate');
  const st = ctx.state;
  if (!st || !Number.isFinite(ctx.stateAt) || ctx.stateAt > ctx.now || ctx.now - ctx.stateAt > 1500 ||
      !Number.isFinite(st.s) || !Number.isFinite(st.u) || !Number.isFinite(st.vLong) || Math.abs(st.u) > 25) return reject('snapshot');
  if (!Number.isFinite(claim.s) || Math.abs(claim.s - st.s) > 30 ||
      ![1, -1].includes(claim.dir) || claim.dir !== ctx.dir) return reject('position');
  const sites = claim.kind === 'camera' ? ctx.cameras : ctx.redSites;
  const site = (sites || []).find(s => s.id === claim.siteId && s.mapId === ctx.mapId && s.verified === true && s.active === true &&
    [1, -1, 0].includes(s.dir) && (s.dir === 0 || s.dir === ctx.dir));
  if (!site) return reject('no-site');
  const radius = claim.kind === 'camera' ? ENF_CAM_RADIUS_M : ENF_RED_RADIUS_M;
  if (Math.abs(site.s - st.s) > radius + 15 || Math.abs(site.s - claim.s) > radius + 15) return reject('proximity');
  if (claim.kind === 'camera') {
    const kmh = Math.abs(st.vLong) * 3.6;
    if (!Number.isFinite(site.limitKmh) || !Number.isFinite(claim.kmh) || Math.abs(kmh - claim.kmh) > 30 ||
        kmh <= site.limitKmh + ENF_MARGIN_KMH) return reject('speed');
  } else {
    // Core may supply a phase derived from its deterministic signal plan.
    // A client red flag or witness boolean is never sufficient evidence.
    if (ctx.redWitness?.(site, st, ctx.now) !== true) return reject('witness');
    const phase = ctx.redPhase?.(site, ctx.now);
    if (!(phase?.main === 'R' && phase.redT > 0.3 && phase.toGreen > 0.3)) return reject('phase');
  }
  const pass = e.sites.get(site.id);
  if (pass?.inside || ctx.now - (pass?.at ?? -Infinity) < COOLDOWN_MS) return reject('cooldown');
  e.sites.set(site.id, { at: ctx.now, inside: true });
  e.claims.set(claim.id, ctx.now);
  while (e.claims.size > MAX_CLAIMS) e.claims.delete(e.claims.keys().next().value);
  return { accept: true, siteId: site.id, penaltySec: penaltyFor(claim.kind, ctx.rules) };
}
