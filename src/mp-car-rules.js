// Multiplayer car rules: host speed-range rulesets, eligibility and Balance of
// Performance. Pure and dependency-free (imports only car-performance, which is
// also pure): the browser lobby UI, the Node server and the Cloudflare worker
// share this module, so the server enforces exactly what the host UI offers.
//
// A ruleset picks WHO may race (preset + parameters); the per-car allow list
// survives as an Advanced override that can only narrow the field further.
// When `balanced` is on, the server derives per-car ballast / power caps from
// the PI gap so the entered cars end up close in pace, and syncs the table so
// every client shows the same "+40 KG BALLAST" effect line.
import { classifyCar, carPerformanceIndex, PI_CLASSES } from './car-performance.js';
import { canonicalCarId } from './car-ids.js';

export const RULESET_PRESETS = ['open', 'same-class', 'max-pi', 'category', 'spec', 'balanced'];
export const MAX_BALLAST_KG = 150;
const clampInt = (v, lo, hi) => Math.min(hi, Math.max(lo, Math.round(+v)));

export function defaultCarRules() {
  return { preset: 'open', class: null, maxPI: null, category: null, spec: null, balanced: false, allowedCars: null };
}

/** Pace view of one catalogue entry used by every rule check. */
export function carRuleView(car = {}) {
  const { pi, class: cls } = classifyCar(car);
  return { id: car.id, name: car.short || car.name || car.id, pi, class: cls, category: car.category || null };
}

function hasSpecs(ctx) { return ctx?.haveSpecs !== false; }

/**
 * Validate host-submitted rules. ctx: { classes, categories, knownIds, haveSpecs }.
 * Returns { rules } or { error }. Anything invalid is rejected, never coerced.
 */
export function sanitizeCarRules(input, ctx = {}) {
  if (input === undefined) return { rules: null }; // no change
  if (input === null || typeof input !== 'object') return { error: 'Car rules must be an object.' };
  const classes = ctx.classes || PI_CLASSES;
  const categories = ctx.categories || [];
  const known = new Set(ctx.knownIds || []);
  const preset = input.preset ?? 'open';
  if (!RULESET_PRESETS.includes(preset)) return { error: `Unknown car ruleset "${preset}".` };
  const needsSpecs = ['same-class', 'max-pi', 'balanced'].includes(preset) || input.balanced === true;
  if (needsSpecs && !hasSpecs(ctx)) return { error: 'Car performance data is unavailable on this server.' };
  const rules = defaultCarRules();
  rules.preset = preset;
  if (preset === 'same-class' || preset === 'balanced') {
    if (!classes.includes(input.class)) return { error: `Pick a class: ${classes.join(' / ')}.` };
    rules.class = input.class;
  }
  if (preset === 'max-pi') {
    const maxPI = clampInt(input.maxPI, 150, 900);
    if (!Number.isFinite(+input.maxPI)) return { error: 'Pick a maximum performance index.' };
    rules.maxPI = maxPI;
  }
  if (preset === 'category') {
    if (!categories.includes(input.category)) return { error: 'Pick a car category.' };
    rules.category = input.category;
  }
  if (preset === 'spec') {
    const spec = canonicalCarId(input.spec, known);
    if (typeof spec !== 'string' || (known.size && !known.has(spec))) return { error: 'Pick a single car for the spec race.' };
    rules.spec = spec;
  }
  if (input.balanced === true) {
    if (['open', 'spec'].includes(preset)) return { error: 'Balancing needs a class, PI cap or category field to equalize.' };
    rules.balanced = true;
  } else if (preset === 'balanced') {
    rules.balanced = true;
  }
  if (input.allowedCars !== undefined && input.allowedCars !== null) {
    if (!Array.isArray(input.allowedCars)) return { error: 'Allow at least one car.' };
    const list = [...new Set(input.allowedCars.map(id => canonicalCarId(id, known)).filter((id) => !known.size || known.has(id)))].slice(0, 64);
    if (!list.length) return { error: 'Allow at least one car.' };
    rules.allowedCars = list;
  }
  return { rules };
}

/** Why a car is (not) eligible. car: rule view; rules: sanitized. */
export function carEligibility(car, rules = defaultCarRules()) {
  const r = rules || defaultCarRules();
  const label = car.name || car.id;
  // The ruleset reason wins over the Advanced list: both reject, but the
  // garage should explain the speed range first ("class A in a class-B race").
  const preset = (() => {
    switch (r.preset) {
      case 'open': return null;
      case 'same-class':
      case 'balanced':
        return car.class !== r.class ? `${label} is class ${car.class} · this lobby races class ${r.class}.` : null;
      case 'max-pi':
        return car.pi > r.maxPI ? `${label} is PI ${car.pi} · the lobby caps at ${r.maxPI}.` : null;
      case 'category':
        return car.category !== r.category ? `${label} is ${String(car.category || 'uncategorized').toUpperCase()} · this lobby races ${String(r.category).toUpperCase()} only.` : null;
      case 'spec':
        return car.id !== r.spec ? `${label} is not the spec car · everyone races ${r.spec}.` : null;
      default: return `${label} is not covered by these car rules.`;
    }
  })();
  if (preset) return { ok: false, reason: preset };
  if (r.allowedCars && !r.allowedCars.includes(car.id)) return { ok: false, reason: `${label} is on the host's excluded list.` };
  return { ok: true };
}

export function eligibleIds(cars, rules) {
  return (cars || []).filter((c) => carEligibility(c, rules).ok).map((c) => c.id);
}

/**
 * Balance of Performance for the entered cars. Equalizes power-to-weight to
 * the slowest car in the field: faster cars earn integer ballast, and when
 * the gap needs more than MAX_BALLAST_KG the remainder becomes a power cap.
 * Returns { targetId, targetPI, cars: { id: { ballastKg, powerCapKW, label, balancedPI } } }.
 */
export function balanceTable(cars) {
  const list = (cars || []).map((c) => ({ ...c, pi: Number.isFinite(+c.pi) ? +c.pi : carPerformanceIndex(c) }));
  const table = { targetId: null, targetPI: null, cars: {} };
  if (!list.length) return table;
  const phys = (c) => (Number.isFinite(+c.power) && +c.power > 0 && Number.isFinite(+c.mass) && +c.mass > 0 ? { power: +c.power, mass: +c.mass } : null);
  const pace = list.filter((c) => phys(c));
  const target = (pace.length ? pace : list).reduce((a, b) => (b.pi < a.pi ? b : a));
  table.targetId = target.id;
  table.targetPI = target.pi;
  const targetPhys = phys(target);
  const targetPw = targetPhys ? (targetPhys.power * 1000) / targetPhys.mass : 0;
  table.targetPw = Math.round(targetPw * 10) / 10;
  for (const c of list) {
    const p = phys(c);
    // Without power/mass figures a car cannot be equalized: it races as-is.
    if (!p || !targetPw) { table.cars[c.id] = { ballastKg: 0, powerCapKW: 0, label: 'EVEN PACE', balancedPI: c.pi, effPw: p ? Math.round((p.power * 1000) / p.mass * 10) / 10 : null }; continue; }
    const { mass, power } = p;
    const need = Math.round((power * 1000) / targetPw - mass);
    let ballastKg = 0, powerCapKW = 0;
    if (need > 0) {
      ballastKg = Math.min(need, MAX_BALLAST_KG);
      if (need > MAX_BALLAST_KG) powerCapKW = Math.round((targetPw * (mass + MAX_BALLAST_KG)) / 1000);
    }
    const effPower = powerCapKW > 0 ? Math.min(power, powerCapKW) : power;
    const effMass = mass + ballastKg;
    const balancedPI = classifyCar({ ...c, mass: effMass, power: effPower }).pi;
    table.cars[c.id] = { ballastKg, powerCapKW, label: balanceLabel(ballastKg, powerCapKW), balancedPI, effPw: Math.round((effPower * 1000) / effMass * 10) / 10 };
  }
  return table;
}

export function balanceLabel(ballastKg, powerCapKW) {
  if (powerCapKW > 0) return `POWER CAP ${powerCapKW} KW + ${ballastKg} KG`;
  if (ballastKg > 0) return `+${ballastKg} KG BALLAST`;
  return 'EVEN PACE';
}

/** One-line host-rules summary for lobby rows and discovery. */
export function describeRules(rules = defaultCarRules(), names = {}) {
  const r = rules || defaultCarRules();
  const extra = r.allowedCars ? ' · CUSTOM LIST' : '';
  switch (r.preset) {
    case 'open': return r.allowedCars ? `CUSTOM LIST · ${r.allowedCars.length} CARS` : 'OPEN · ANY CAR';
    case 'same-class': return `CLASS ${r.class} ONLY${r.balanced ? ' · BALANCED' : ''}${extra}`;
    case 'balanced': return `CLASS ${r.class} · BALANCED${extra}`;
    case 'max-pi': return `MAX PI ${r.maxPI}${r.balanced ? ' · BALANCED' : ''}${extra}`;
    case 'category': return `${String(r.category).toUpperCase()} ONLY${r.balanced ? ' · BALANCED' : ''}${extra}`;
    case 'spec': return `SPEC · ${names[r.spec] || r.spec}${extra}`;
    default: return 'CUSTOM CAR RULES';
  }
}

/**
 * Physics-ready spec for the local car: ballast adds mass, a power cap trims
 * peak power (torque curve and handling stay catalogue). Returns the same
 * reference when there is nothing to apply, so solo play is untouched.
 */
export function applyBalance(spec, balance) {
  if (!spec || !balance) return spec;
  const ballast = Math.max(0, Math.round(+balance.ballastKg || 0));
  const cap = +balance.powerCapKW || 0;
  if (!ballast && !(cap > 0 && cap < spec.power)) return spec;
  const out = { ...spec };
  if (ballast) out.mass = spec.mass + ballast;
  if (cap > 0 && cap < spec.power) out.power = cap;
  return out;
}
