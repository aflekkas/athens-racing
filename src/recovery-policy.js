// Recovery offers never change the vehicle's input or velocity.
export const TOW_PROMPT_SECONDS = 3;
export const TOW_PROMPT_COOLDOWN = 20;
export function towCondition({ offroad, beyond, water, inverted, disabled, speed }, dt, state) {
  state.offT = offroad ? state.offT + dt : 0;
  state.stuckT = offroad && speed < 3 / 3.6 ? (state.stuckT || 0) + dt : 0;
  state.severeT = inverted && speed < 1 || disabled || water > 0.2 ? (state.severeT || 0) + dt : 0;
  return state.severeT > 2.5 || state.stuckT > 3 || offroad && beyond > 8 && state.offT > 6 || state.offT > 10;
}
export function recoveryHeld(towing, state) {
  return towing || state.recovering === true && state.hold > 0;
}
