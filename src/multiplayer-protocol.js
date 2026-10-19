// Increment only for incompatible multiplayer wire-format/meaning changes.
// Asset/build changes alone must not disconnect a compatible client.
// 8 adds free-body quaternion, vertical velocity, angular velocity and contact
// state. Worker and client must deploy together: protocol-7 clients reload.
export const MULTIPLAYER_PROTOCOL = 8;
// Car-state cadence (compatible additions, no protocol bump: old peers ignore `trail` and `contact`). Cars are sampled at 20 Hz of
// the SENDER's clock, whatever its frame rate, two samples per message so the arena still takes at most 10 messages/s/player.
// The arena relays every 50 ms and forwards each accepted sample (`trail`), so receivers interpolate real data, not the newest one.
export const STATE_INTERVAL_MS = 50;
export const STATE_BATCHING = true;
export const RELAY_MS = 50;
export const UPDATE_CLOSE_CODE = 4001;
// The account session ended (sign-out, expiry, revocation). Not an update: the client shows the sign-in gate instead of reloading.
export const AUTH_CLOSE_CODE = 4401;
export const protocolVersion = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;
export function connectionProtocol(url) {
  const value = url.searchParams.get('protocol');
  return { protocol: value === null ? 0 : protocolVersion(Number(value)), build: url.searchParams.get('build') || null };
}
export function clientHello(doc) {
  const build = doc?.querySelector?.('meta[name="asr-build"]')?.content;
  return { type: 'hello', protocol: MULTIPLAYER_PROTOCOL, ...(build ? { build } : {}) };
}
