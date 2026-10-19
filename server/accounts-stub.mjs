// Stubbed Google sign-in for tests: an in-memory D1-style database over node:sqlite plus a login
// that drives the real OAuth start/callback handlers with a mocked Google. Real session cookies come out.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { accounts } from '../worker/accounts.mjs';

let keys;
const b64 = value => Buffer.from(value).toString('base64url');
async function googleToken(claims) {
  keys ||= await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const input = b64(JSON.stringify({ alg: 'RS256', kid: 'test-key' })) + '.' + b64(JSON.stringify(claims));
  return input + '.' + b64(new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keys.privateKey, new TextEncoder().encode(input))));
}
const jwks = async () => Response.json({ keys: [{ ...(await crypto.subtle.exportKey('jwk', keys.publicKey)), kid: 'test-key', alg: 'RS256' }] });

export function accountsDatabase() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../migrations/0001_accounts.sql', import.meta.url), 'utf8'));
  const db = {
    prepare: sql => ({ bind: (...values) => ({
      first: async () => sqlite.prepare(sql).get(...values) || null,
      all: async () => ({ results: sqlite.prepare(sql).all(...values) }),
      run: async () => sqlite.prepare(sql).run(...values),
    }) }),
    async batch(statements) {
      sqlite.exec('BEGIN');
      try { const out = []; for (const s of statements) out.push(await s.run()); sqlite.exec('COMMIT'); return out; }
      catch (e) { sqlite.exec('ROLLBACK'); throw e; }
    },
  };
  return { db, sqlite };
}

// `origin` is the public origin the game is served from. `env` is what the game server or Worker sees.
export function accountsStub(origin = 'https://staging.athensracing.com') {
  const { db, sqlite } = accountsDatabase();
  const env = { ACCOUNTS: db, SESSION_SECRET: 'test-only-secret-32-random-test-bytes', GOOGLE_CLIENT_ID: 'client', GOOGLE_CLIENT_SECRET: 'test-client-secret' };
  let ip = 0;
  const call = (path, data, auth = {}, fetcher) => accounts(new Request(origin + path, {
    method: data === undefined ? 'GET' : 'POST',
    headers: { Origin: origin, 'CF-Connecting-IP': String(++ip), ...(auth.cookie ? { Cookie: auth.cookie } : {}), ...(auth.csrf ? { 'X-CSRF-Token': auth.csrf } : {}) },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  }), env, fetcher);
  // Full OAuth round trip with a mocked Google; returns the real ar_session cookie the browser would hold.
  async function signIn(subject, displayName) {
    const start = await call('/api/auth/google/start');
    const dest = new URL(start.headers.get('location'));
    const done = await call('/api/auth/google/callback?state=' + dest.searchParams.get('state') + '&code=mock', undefined, { cookie: start.headers.get('set-cookie').split(';')[0] }, async url => {
      if (url.includes('/certs')) return jwks();
      if (url.includes('/token')) return Response.json({ access_token: 'mock', id_token: await googleToken({ sub: subject, nonce: dest.searchParams.get('nonce'), aud: 'client', iss: 'https://accounts.google.com', exp: Date.now() / 1000 + 60 }) });
      return Response.json({ sub: subject });
    });
    assert.equal(done.status, 302);
    const cookie = done.headers.get('set-cookie').split(';')[0];
    const state = await (await call('/api/auth/session', undefined, { cookie })).json();
    const auth = { cookie, csrf: state.csrf, id: state.user.id };
    if (displayName) assert.equal((await call('/api/account/profile', { displayName, plate: 'GR-123' }, auth)).status, 200);
    return auth;
  }
  return { env, sqlite, call, signIn };
}
