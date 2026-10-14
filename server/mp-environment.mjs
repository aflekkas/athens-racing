import { WorldLife } from '../src/world-life.js';
// The arena clock, including wet grip, continues through host changes/loading.
export function arenaEnvironment(lobby, event, now) {
  const key = JSON.stringify([lobby.raceId, lobby.generation, lobby.config?.time, lobby.config?.weather]);
  const world = new WorldLife();
  let wet, elapsed;
  if (lobby.world?.key === key) {
    world.adopt(lobby.world.state);
    wet = lobby.world.state.wet;
    elapsed = Math.max(0, (now - lobby.world.at) / 1000);
  } else {
    world.configure({ type: event.type, time: lobby.config?.time, weather: lobby.config?.weather });
    wet = world.sample().atmosphere.rain;
    elapsed = lobby.startAt ? Math.max(0, (now - lobby.startAt) / 1000) : 0;
  }
  while (elapsed > 0) {
    const dt = Math.min(1, elapsed), sample = world.advance(dt);
    const rain = sample.atmosphere.rain, tau = rain > wet ? 18 : 160;
    wet += (rain - wet) * -Math.expm1(-dt / tau); elapsed -= dt;
  }
  lobby.world = { key, state: { ...world.snapshot(), wet }, at: now, raceId: lobby.raceId, generation: lobby.generation || 0 };
  return lobby.world;
}
