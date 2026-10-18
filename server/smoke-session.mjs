// Smoke sessions are a deployment-test credential, never a player account.
// They exist only while SMOKE_TOKEN is configured, expire within ten minutes,
// and are accepted only on live play and public discovery paths. Account,
// friends and presence routes never see them, and leaderboard writes reject them.
export const SMOKE_HEADER = 'X-Smoke-Session';
export const SMOKE_TTL_MS = 600000;
// Clients mint a little under the server's ceiling so modest clock skew never rejects a fresh token.
export const SMOKE_CLIENT_TTL_MS = 540000;
const MIN_SECRET_LENGTH = 32;
const encoder = new TextEncoder();
const base64url = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
const pattern = /^smoke:([a-f0-9]{32}):(\d{1,15})$/;
export const smokeEnabled = env => typeof env?.SMOKE_TOKEN === 'string' && env.SMOKE_TOKEN.length >= MIN_SECRET_LENGTH;
export const smokePayload = (nonce, expires) => `smoke:${nonce}:${expires}`;
// The nonce fixes the display name and driver ID, so reconnects with a fresh signature resume the same seat.
export const smokeName = nonce => `SMOKE-${String(parseInt(nonce.slice(0, 4), 16) % 1000).padStart(3, '0')}`;
export const canSaveResults = identity => !identity?.smoke;
// Compares every byte so a mismatch does not reveal how many leading characters matched.
export function constantTimeEqual(a, b) {
  const x = encoder.encode(a), y = encoder.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}
async function mac(secret, payload) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return base64url(await crypto.subtle.sign('HMAC', key, encoder.encode(payload)));
}
// Returns a smoke identity, or null for every other case (absent, malformed, forged, expired, or disabled).
export async function smokeSession(request, env, now = Date.now()) {
  if (!smokeEnabled(env)) return null;
  const value = request.headers.get(SMOKE_HEADER);
  const dot = value ? value.lastIndexOf('.') : -1;
  if (dot < 0 || value.length > 256) return null;
  const payload = value.slice(0, dot), match = pattern.exec(payload);
  if (!match) return null;
  // Verify the signature before trusting the expiry; a validly signed token must also fit the ten-minute lifetime.
  if (!constantTimeEqual(value.slice(dot + 1), await mac(env.SMOKE_TOKEN, payload))) return null;
  const expires = Number(match[2]);
  if (!Number.isSafeInteger(expires) || expires <= now || expires - now > SMOKE_TTL_MS) return null;
  return { smoke: true, userId: 'smoke-' + match[1].slice(0, 16), name: smokeName(match[1]), expires, sessionToken: null };
}
