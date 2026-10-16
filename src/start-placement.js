// Only initial placements move. Event timing lines, checkpoint stations and tow targets do not.
export const FREE_START_CLEARANCE = 20;
export const GRID_START_CLEARANCE = 30;
// The reversed street-circuit approach bends towards the start gantry; keep
// its supports beyond the near cockpit view for tall cabs as well.
const gridClearance = (route, dir) => route.streetCircuit && dir < 0 ? 40 : GRID_START_CLEARANCE;
const station = (route, s) => route.closed ? s : Math.max(5, Math.min(route.length - 5, s));
export function soloStartPosition(route, base, dir, free = false) {
  const s = station(route, base + dir * (free ? FREE_START_CLEARANCE : -gridClearance(route, dir)));
  return { s, u: route.closed ? 0 : dir * route.laneU(s, Math.min(1, route.lanes(s) - 1)) };
}
export function raceGridSlot(route, base, dir, i, playerLength = 4.4) {
  const columns = route.closed || route.lanes(base) > 1 ? 2 : 1;
  const spacing = Math.max(8, (playerLength + 4.9) / 2 + 2);
  const s = station(route, base - dir * (gridClearance(route, dir) + Math.floor(i / columns) * spacing));
  const lane = Math.min(i % 2, route.lanes(s) - 1);
  const u = route.closed ? (i % 2 ? 1 : -1) * Math.min(2.25, Math.max(.5, route.edge(s) - 1.2)) : dir * route.laneU(s, lane);
  return { s, u, lane, yaw: Math.atan2(-route.lin(route.TX, s), -route.lin(route.TZ, s)) + (dir < 0 ? Math.PI : 0) };
}
