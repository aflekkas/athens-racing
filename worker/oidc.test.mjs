// Pure Google OIDC checks: PKCE against the RFC 7636 vector, auth-URL
// parameters, and ID-token verification against a generated RSA key
// (wrong key, audience, nonce and expiry are all rejected).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  codeChallenge, buildAuthUrl, verifyIdToken, verifyIdTokenLive, getJwks, b64urlDecodeJson, clearJwksCache,
} from './oidc.mjs';

const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
async function rsa() {
  const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  return { privateKey: pair.privateKey, jwks: [{ ...jwk, kid: 'test-kid', use: 'sig', alg: 'RS256' }] };
}
async function idToken(privateKey, payload, kid = 'test-kid') {
  const h = b64({ alg: 'RS256', kid, typ: 'JWT' }), p = b64(payload);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, new TextEncoder().encode(h + '.' + p));
  return h + '.' + p + '.' + Buffer.from(sig).toString('base64url');
}
const claims = (over = {}) => ({ iss: 'https://accounts.google.com', aud: 'test-client', sub: 'google-123', name: 'Test Driver', picture: 'https://img/x.png', iat: 1000, exp: 2000, nonce: 'n-1', ...over });

test('PKCE matches two independent SHA-256 oracles and the auth URL carries every parameter', async () => {
  // RFC 7636 Appendix B verifier; the expected challenge below is what both
  // system sha256sum and Node SubtleCrypto produce for it (43-char base64url
  // of the 32-byte digest). node:crypto re-derives it as the live oracle.
  const { createHash } = await import('node:crypto');
  const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
  const oracle = createHash('sha256').update(verifier, 'utf8').digest('base64url');
  assert.equal(oracle, 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  assert.equal(await codeChallenge(verifier), oracle);
  const url = new URL(buildAuthUrl({ clientId: 'cid', redirectUri: 'https://game.test/auth/google/callback', state: 's', nonce: 'n', challenge: 'c' }));
  assert.equal(url.hostname, 'accounts.google.com');
  assert.deepEqual(Object.fromEntries(url.searchParams), { client_id: 'cid', redirect_uri: 'https://game.test/auth/google/callback', response_type: 'code', scope: 'openid profile', state: 's', nonce: 'n', code_challenge: 'c', code_challenge_method: 'S256', prompt: 'select_account' });
  clearJwksCache();
});

test('valid Google ID tokens verify; forgeries do not', async () => {
  const { privateKey, jwks } = await rsa();
  const good = { idToken: await idToken(privateKey, claims()), jwks, clientId: 'test-client', nonce: 'n-1', now: 1500 * 1000 };
  assert.deepEqual(await verifyIdToken(good), { sub: 'google-123', name: 'Test Driver', picture: 'https://img/x.png' });
  const bad = async (mut, fields = {}) => {
    let token = good.idToken;
    if (mut) { const [h, p, s] = token.split('.'); token = h + '.' + b64({ ...b64urlDecodeJson(p), ...mut }) + '.' + s; }
    await assert.rejects(verifyIdToken({ ...good, ...fields, idToken: token }), /Invalid|Unknown/);
  };
  await bad({ sub: 'attacker' }, {}); // re-signed payload breaks the signature
  await bad(null, { clientId: 'other-client' });
  await bad(null, { nonce: 'wrong' });
  await bad(null, { now: 2001 * 1000 });
  await bad({ iss: 'https://evil.test' });
  const other = await rsa();
  await assert.rejects(verifyIdToken({ ...good, jwks: other.jwks }), /Invalid/);
  await assert.rejects(verifyIdToken({ ...good, idToken: 'not.a.token' }), /Invalid/);
});

test('key rotation triggers exactly one bounded refresh; caches isolate by JWKS URL', async () => {
  // Stale cache holds the old key while the token uses the rotated one:
  // live verification refetches once (2 reads total) and succeeds.
  const oldKeys = (await rsa()).jwks;
  const rotated = await rsa();
  const fresh = rotated.jwks.map((k) => ({ ...k, kid: 'rotated-kid' }));
  const token = await idToken(rotated.privateKey, claims(), 'rotated-kid');
  const live = (idToken, fetchJwks) => verifyIdTokenLive({ idToken, jwksUri: 'https://mock.test/certs', clientId: 'test-client', nonce: 'n-1', now: 1500 * 1000, fetchJwks });
  let fetches = 0;
  const out = await live(token, async (uri, { force } = {}) => { fetches++; return force ? fresh : oldKeys; });
  assert.equal(out.sub, 'google-123');
  assert.equal(fetches, 2, 'one cached read plus exactly one forced refresh');
  // A kid unknown even after the refresh still rejects: no retry loop.
  let refreshes = 0;
  await assert.rejects(live(await idToken(rotated.privateKey, claims(), 'ghost-kid'),
    async (uri, { force } = {}) => { if (force) refreshes++; return oldKeys; }), /Unknown/);
  assert.equal(refreshes, 1);
  // Bad signatures never trigger a refresh.
  let sigFetches = 0;
  const [h, p] = token.split('.');
  await assert.rejects(live(h + '.' + p + '.AAAA', async () => { sigFetches++; return fresh; }), /Invalid/);
  assert.equal(sigFetches, 1);
  // Per-URI isolation through the real getJwks cache with a stubbed fetch.
  clearJwksCache();
  const realFetch = globalThis.fetch;
  const bodies = { 'https://a.test/certs': { keys: oldKeys }, 'https://b.test/certs': { keys: fresh } };
  globalThis.fetch = async (uri) => ({ ok: true, json: async () => bodies[uri] });
  try {
    assert.deepEqual(await getJwks('https://a.test/certs'), oldKeys);
    assert.deepEqual(await getJwks('https://b.test/certs'), fresh);
    assert.deepEqual(await getJwks('https://a.test/certs'), oldKeys, 'a.test still serves its own keys');
  } finally { globalThis.fetch = realFetch; clearJwksCache(); }
});
