// Node ESM loader hooks: lets src/physics.js run headless. 'three' -> a tiny stub, and physics.js's
// import of ./road.js (which drags in WebGL materials) -> a stub with ROAD.limits only.
const STUB_THREE = new URL('./three-stub.mjs', import.meta.url).href;
const STUB_ROAD = new URL('./road-stub.mjs', import.meta.url).href;
export async function resolve(spec, ctx, next) {
  if (spec === 'three') return { url: STUB_THREE, shortCircuit: true };
  if (spec === './road.js' && /physics[^/]*\.js$/.test(ctx.parentURL || '')) return { url: STUB_ROAD, shortCircuit: true };
  return next(spec, ctx);
}
