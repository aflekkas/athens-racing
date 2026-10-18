import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { build } from 'esbuild';
import { signSmokeSession } from '../tools/resumable-smoke-client.mjs';
import { SMOKE_HEADER } from '../server/smoke-session.mjs';

// The public Worker and the GameArena Durable Object share one gate. These tests bundle the real
// worker/index.mjs with stub Cloudflare bindings, as the anonymous-gameplay test in server/accounts.test.mjs does.
const SECRET = 'worker-smoke-test-secret-0123456789abcdef';
const OAUTH = { GOOGLE_CLIENT_ID: 'test', GOOGLE_CLIENT_SECRET: 'test' };
const origin = 'https://staging.athensracing.com';

async function loadWorker() {
  const bundled = await build({ entryPoints: ['worker/index.mjs'], bundle: true, write: false, format: 'esm', platform: 'node', plugins: [{ name: 'worker-test-bindings', setup(b) {
    b.onResolve({ filter: /^cloudflare:workers$/ }, () => ({ path: 'cloudflare', namespace: 'stub' }));
    b.onResolve({ filter: /\.deploy\/catalogue\.json$/ }, () => ({ path: 'catalogue', namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, args => ({ contents: args.path === 'cloudflare'
      ? 'export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }'
      : 'export default { maps: [{ id: "riviera", track: { version: "test", start: 0, finish: 1 }, definitions: [] }], cars: ["mini"] };', loader: 'js' }));
  } }] });
  return import('data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0].text).toString('base64'));
}

const signed = (secret = SECRET, now) => signSmokeSession(secret, randomBytes(16).toString('hex'), now);

test('Worker admits a valid smoke session to live play and discovery only', async () => {
  const { default: worker } = await loadWorker();
  const forwarded = [];
  const env = { ...OAUTH, SMOKE_TOKEN: SECRET, GAME: { idFromName: x => x, get: () => ({ fetch: request => { forwarded.push(new URL(request.url).pathname); return Response.json([]); } }) } };
  const headers = { [SMOKE_HEADER]: signed() };
  assert.equal((await worker.fetch(new Request(origin + '/api/lobbies', { headers }), env)).status, 200);
  assert.equal((await worker.fetch(new Request(origin + '/ws', { headers }), env)).status, 200);
  assert.deepEqual(forwarded, ['/api/lobbies', '/ws']);
  for (const path of ['/api/account/presence', '/api/account/export', '/api/account/profile']) {
    assert.equal((await worker.fetch(new Request(origin + path, { headers }), env)).status, 401, path);
  }
  assert.deepEqual(forwarded, ['/api/lobbies', '/ws'], 'account and friends routes must not reach the arena');
});

test('Worker refuses forged, expired and unconfigured smoke credentials before the arena', async () => {
  const { default: worker } = await loadWorker();
  let forwarded = 0;
  const game = { idFromName: x => x, get: () => ({ fetch: () => { forwarded++; return Response.json([]); } }) };
  const expired = signed(SECRET, Date.now() - 11 * 60000);
  const cases = [
    ['forged', { ...OAUTH, SMOKE_TOKEN: SECRET }, signed('another-secret-0123456789abcdefghijkl')],
    ['expired', { ...OAUTH, SMOKE_TOKEN: SECRET }, expired],
    ['unset', { ...OAUTH }, signed()],
    ['empty', { ...OAUTH, SMOKE_TOKEN: '' }, signed()],
  ];
  for (const [name, extra, token] of cases) {
    const env = { ...extra, GAME: game };
    for (const path of ['/ws', '/api/lobbies', '/api/leaderboard']) {
      const response = await worker.fetch(new Request(origin + path, { headers: { [SMOKE_HEADER]: token } }), env);
      assert.equal(response.status, 401, `${name} ${path}`);
    }
  }
  assert.equal(forwarded, 0);
});

test('Durable Object refuses smoke leaderboard submissions and writes no record', async () => {
  const { GameArena } = await loadWorker();
  const statements = [];
  const sql = { exec(statement) { statements.push(statement); return []; } };
  const ctx = {
    storage: { sql, get: async () => undefined, put: async () => {}, transactionSync: fn => fn(), deleteAlarm: async () => {}, setAlarm: async () => {} },
    blockConcurrencyWhile: fn => fn(),
    getWebSockets: () => [],
    setWebSocketAutoResponse: () => {},
  };
  globalThis.WebSocketRequestResponsePair ??= class { constructor() {} };
  const env = { ...OAUTH, SMOKE_TOKEN: SECRET };
  const arena = new GameArena(ctx, env);
  const submit = (headers = {}) => arena.fetch(new Request(origin + '/api/leaderboard', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ valid: true }) }));
  assert.equal((await submit({ [SMOKE_HEADER]: signed() })).status, 403);
  assert.equal((await submit()).status, 401);
  assert.equal(statements.some(s => /INTO times/.test(s)), false, 'no leaderboard row may be written for a smoke session');
});
