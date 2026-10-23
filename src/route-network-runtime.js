import { RouteRuntime } from './route-runtime.js';
/** Composite runtime for an already authenticated online grid. Competitive
 * geometry stays byte-identical; only negative entry stations use its separate
 * physical approach. Positive stations and every circuit lap use the core. */
export class RouteNetworkRuntime extends RouteRuntime {
  constructor(compiled, onlineGrid) {
    super(compiled);
    if (onlineGrid?.routeId !== compiled.id || ['routeHash', 'geometryHash', 'worldSetRevision'].some(k => onlineGrid[k] !== compiled[k])) throw Error('Online approach release mismatch');
    this.onlineGrid = onlineGrid;
    const approach = onlineGrid.approach;
    this.networkApproach = approach?.points?.length ? new RouteRuntime({ ...compiled, definition: { ...compiled.definition, kind: 'sprint' }, points: approach.points, occurrences: approach.occurrences, runIn: [], runOut: [] }) : null;
  }
  frame(s, out = {}) { return s < 0 && this.networkApproach ? this.networkApproach.frame(s, out) : super.frame(s, out); }
  edgeAt(s) { return s < 0 && this.networkApproach ? this.networkApproach.edgeAt(s) : super.edgeAt(s); }
  project(x, z, options = {}) {
    const core = super.project(x, z, options);
    if (!this.networkApproach) return core;
    const opts = typeof options === 'number' ? { hint: options } : options || {};
    const hint = typeof opts.hint === 'object' ? opts.hint?.s : opts.hint;
    if (Number.isFinite(hint) && hint >= 0) return core;
    const entry = this.networkApproach.project(x, z, opts);
    return entry.occurrence >= 0 && (core.occurrence < 0 || entry.score <= core.score + 1e-7) ? entry : core;
  }
}
export const createNetworkRoute = (compiled, onlineGrid) => new RouteNetworkRuntime(compiled, onlineGrid);
