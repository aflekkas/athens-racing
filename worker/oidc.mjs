// Google OpenID Connect (authorization-code + PKCE) without dependencies.
// Runs in the Worker and in plain node --test: only global fetch/subtle.
//
// Overridable endpoints (tests point them at a local mock; production uses
// the defaults):
//   env.GOOGLE_AUTH_URL   default https://accounts.google.com/o/oauth2/v2/auth
//   env.GOOGLE_TOKEN_URL  default https://oauth2.googleapis.com/token
//   env.GOOGLE_JWKS_URL   default https://www.googleapis.com/oauth2/v3/certs
// env.GOOGLE_CLIENT_ID (wrangler var) and env.GOOGLE_CLIENT_SECRET
// (wrangler secret, never committed) are required for the live flow.
export const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';

const b64urlEncode = (bytes) => BufferShim.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
// Buffer exists in the Worker (Node compat) and in Node; the fallback keeps
// this module importable in bare browsers for unit tests.
const BufferShim = globalThis.Buffer || {
  from(input) {
    const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
    if (typeof input === 'string') {
      let bin = '';
      for (const b of bytes) bin += String.fromCharCode(b);
      return { toString: () => btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') };
    }
    return { toString: () => { let bin = ''; for (const b of bytes) bin += String.fromCharCode(b); return btoa(bin); } };
  },
};
export function b64urlDecodeBytes(s) {
  const normalized = String(s).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(normalized);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
export const b64urlDecodeJson = (s) => JSON.parse(new TextDecoder().decode(b64urlDecodeBytes(s)));

export const newSecret = (n = 32) => b64urlEncode(globalThis.crypto.getRandomValues(new Uint8Array(n)));
export async function codeChallenge(verifier) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return b64urlEncode(new Uint8Array(digest));
}

export function buildAuthUrl({ authEndpoint = GOOGLE_AUTH_URL, clientId, redirectUri, state, nonce, challenge }) {
  const q = new URLSearchParams({
    client_id: clientId, redirect_uri: redirectUri, response_type: 'code',
    scope: 'openid profile', state, nonce,
    code_challenge: challenge, code_challenge_method: 'S256', prompt: 'select_account',
  });
  return `${authEndpoint}?${q}`;
}

export async function exchangeCode({ tokenEndpoint = GOOGLE_TOKEN_URL, clientId, clientSecret, code, redirectUri, verifier }) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code', client_id: clientId, client_secret: clientSecret,
    code, redirect_uri: redirectUri, code_verifier: verifier,
  });
  const res = await fetch(tokenEndpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.id_token) {
    throw Object.assign(new Error(data.error_description || data.error || 'Google token exchange failed.'), { status: 502 });
  }
  return data;
}

// Process-wide JWKS cache keyed by JWKS URL (mock endpoints in tests never
// share production keys), refreshed at most every 6 h. A cold isolate
// refetches once; verification never blocks on rotation.
const jwksCache = new Map();
export function clearJwksCache() { jwksCache.clear(); }
export async function getJwks(jwksUri = GOOGLE_JWKS_URL, { force = false } = {}) {
  const cached = jwksCache.get(jwksUri);
  if (!force && cached && Date.now() - cached.at < 6 * 3600 * 1000) return cached.keys;
  const res = await fetch(jwksUri);
  if (!res.ok) throw Object.assign(new Error('Google key fetch failed.'), { status: 502 });
  const data = await res.json();
  if (!Array.isArray(data.keys)) throw Object.assign(new Error('Google key fetch failed.'), { status: 502 });
  jwksCache.set(jwksUri, { at: Date.now(), keys: data.keys });
  return data.keys;
}
// Live verification entry point: on an unknown signing kid (Google key
// rotation) it forces exactly ONE bounded refetch and retries once, so a
// rotation never locks out logins for the six-hour cache window. Any other
// failure (bad signature, audience, expiry, nonce) throws immediately, and
// a still-unknown kid after the refresh throws too — never a retry loop.
export async function verifyIdTokenLive({ idToken, jwksUri = GOOGLE_JWKS_URL, clientId, nonce, now, fetchJwks = getJwks }) {
  try {
    return await verifyIdToken({ idToken, jwks: await fetchJwks(jwksUri), clientId, nonce, now });
  } catch (e) {
    if (!e || e.message !== 'Unknown Google signing key.') throw e;
    return verifyIdToken({ idToken, jwks: await fetchJwks(jwksUri, { force: true }), clientId, nonce, now });
  }
}

export async function verifyIdToken({ idToken, jwks, clientId, nonce, now = Date.now() }) {
  const parts = String(idToken || '').split('.');
  if (parts.length !== 3) throw Object.assign(new Error('Invalid Google identity.'), { status: 401 });
  let header, payload;
  try { header = b64urlDecodeJson(parts[0]); payload = b64urlDecodeJson(parts[1]); }
  catch { throw Object.assign(new Error('Invalid Google identity.'), { status: 401 }); }
  const key = (jwks || []).find((k) => k.kid === header.kid && k.kty === 'RSA');
  if (!key || header.alg !== 'RS256') throw Object.assign(new Error('Unknown Google signing key.'), { status: 401 });
  const cryptoKey = await globalThis.crypto.subtle.importKey('jwk', key, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await globalThis.crypto.subtle.verify('RSASSA-PKCS1-v1_5', cryptoKey, b64urlDecodeBytes(parts[2]), new TextEncoder().encode(parts[0] + '.' + parts[1]));
  if (!ok) throw Object.assign(new Error('Invalid Google identity.'), { status: 401 });
  const at = Math.floor(now / 1000);
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (payload.iss !== 'https://accounts.google.com' && payload.iss !== 'accounts.google.com') throw Object.assign(new Error('Invalid Google identity.'), { status: 401 });
  if (!aud.includes(clientId)) throw Object.assign(new Error('Invalid Google identity.'), { status: 401 });
  if (!(payload.exp > at && payload.iat <= at + 300)) throw Object.assign(new Error('Invalid Google identity.'), { status: 401 });
  if (nonce !== undefined && payload.nonce !== nonce) throw Object.assign(new Error('Invalid Google identity.'), { status: 401 });
  if (typeof payload.sub !== 'string' || !payload.sub) throw Object.assign(new Error('Invalid Google identity.'), { status: 401 });
  return { sub: payload.sub, name: payload.name, picture: payload.picture };
}
