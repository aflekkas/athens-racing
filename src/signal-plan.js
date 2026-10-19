// The fixed-time plan every traffic signal in the game follows, on the Riviera route (src/signals.js) and in the streamed Athens world.
// One cycle of 28 s: the main road is green 16 s, amber 3 s, red 9 s; cross traffic goes during the main red.
export const CYCLE = 28, GREEN = 16, AMBER = 3;
export const RED0 = GREEN + AMBER;
/** Metres before the junction node at which a car stops (and a head is mounted). */
export const STOP_OFF = 9;
/** Speed (m/s) the green wave is timed for: 80 km/h. */
export const WAVE_V = 80 / 3.6;
/** 'G', 'A' or 'R' for a signal group at time t. Group 0 is the main road; group 1 the cross street, which gets the
 * main road's red (after a 1 s clearance) with 2.5 s of amber at its end. `offset` seconds shifts the junction in the wave. */
export function signalState(group, offset, t) {
  const c = (((t + offset) % CYCLE) + CYCLE) % CYCLE;
  if (group === 0) return c < GREEN ? 'G' : c < RED0 ? 'A' : 'R';
  return c < RED0 + 1 ? 'R' : c < CYCLE - 2.5 ? 'G' : 'A';
}
