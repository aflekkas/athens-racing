// Real Three geometry and Ground/Vehicle code, with only the browser road builder stubbed.
import { registerHooks } from 'node:module';
const road = 'data:text/javascript,' + encodeURIComponent(`export const ROAD = {
  gutter: .18, curbH: () => .16, sidewalk: () => 2,
  limits(route, s, out = {}) { out.max = 1e4; out.min = -1e4; return out; }
};`);
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === './road.js' && /\/(physics|ground)\.js$/.test(context.parentURL || '')) return { url: road, shortCircuit: true };
  return nextResolve(specifier, context);
} });
