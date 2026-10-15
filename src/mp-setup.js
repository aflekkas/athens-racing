// MP setup adapter: the multiplayer lobby config speaks the same language
// as single-player race setup (src/race-setup.js). Pure logic, no DOM: the
// menu/setup UI binds its controls to getLobbyConfig/setLobbyConfig and the
// game applies lobbyConfigToRaceSetup through applySetup like any saved setup.
import { TIMES, WEATHERS, MAX_RIVALS, isPoliceLevel } from './race-setup.js';

export const MP_CONFIG_DEFAULTS = Object.freeze({
  rivals: 3, traffic: 1, time: 'afternoon', weather: 'clear',
  reverse: false, police: false, sessionDuration: 300, enforcement: null,
});
// Optional police setup keys (absent on older lobbies): POLICE level and CAN BE BUSTED.
export const MP_POLICE_DEFAULTS = Object.freeze({ policeLevel: 'normal', busted: true });

const validTime = v => TIMES.some(([id]) => id === v);
const validWeather = v => WEATHERS.some(([id]) => id === v);

// The effective lobby config: server values over local defaults.
export function configFromLobby(lobby) {
  return { ...MP_CONFIG_DEFAULTS, ...(lobby?.config || {}) };
}

// The race-setup-shaped subset ({ rivals, traffic, reverse, time, weather,
// police, policeLevel, busted }) for applySetup/loadSetup/saveSetup interop.
export function lobbyConfigToRaceSetup(config = {}) {
  const c = { ...MP_CONFIG_DEFAULTS, ...config };
  const rivals = Number.isFinite(+c.rivals) ? Math.max(0, Math.min(MAX_RIVALS, Math.round(+c.rivals))) : MP_CONFIG_DEFAULTS.rivals;
  const traffic = Number.isFinite(+c.traffic) ? Math.max(0, Math.min(2, +c.traffic)) : MP_CONFIG_DEFAULTS.traffic;
  return {
    rivals,
    traffic,
    reverse: c.reverse === true,
    time: validTime(c.time) ? c.time : MP_CONFIG_DEFAULTS.time,
    weather: validWeather(c.weather) ? c.weather : MP_CONFIG_DEFAULTS.weather,
    police: c.police === true,
    policeLevel: isPoliceLevel(c.policeLevel) ? c.policeLevel : MP_POLICE_DEFAULTS.policeLevel,
    busted: c.busted !== false,
  };
}

// Legacy single-player traffic checkbox <-> lobby traffic level.
export function trafficBoolToLevel(on) { return on === true ? 1 : 0; }
export function trafficLevelToBool(level) { return (level ?? 0) > 0; }

// Human mode label for the lobby/room UI ("mode unclear" playtest note).
// Only the supported session modes have player-facing labels.
export function describeMode(type) {
  return { sprint: 'QUICK RACE', free: 'FREE ROAM' }[type || 'sprint'] || 'UNAVAILABLE MODE';
}
