// The black overlay never outlives its owner: every blackout carries a watchdog, so no code path (a throw, a cancelled
// session, a lost reply) can leave the screen black. `onTimeout` runs only when the watchdog (not the owner) ends it.
export const BLACKOUT_MAX_MS = 5000;
export function createBlackout(onTimeout, { body = document.body, max = BLACKOUT_MAX_MS } = {}) {
  let timer = 0;
  return function blackout(on, { onTimeout: notify = false } = {}) {
    clearTimeout(timer); body.classList.toggle('fading', on);
    if (on) timer = setTimeout(() => { body.classList.remove('fading'); if (notify) onTimeout(); }, max);
  };
}
