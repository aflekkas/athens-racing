// The class the first-run check picked, kept so the frame governor (src/perf-governor.js) never climbs back past it.
export const PERF_CEILING_KEY='paraliaki.perfCeiling.v1';
export function storedPerfCeiling() { try { const c=localStorage.getItem(PERF_CEILING_KEY); return ['potato','low','med','high'].includes(c)?c:'high'; } catch { return 'high'; } }
