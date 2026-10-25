import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm, mkdir, writeFile, symlink, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { MAPS } from '../../src/map-catalog.js';
import { WebSocket } from 'ws';
import { parseLanAddress, privateAddress, startDesktopRuntime, immutableLocalRequest } from './runtime.mjs';
import { DESKTOP_SERVICE, MULTIPLAYER_PROTOCOL } from '../../packages/contracts/desktop.mjs';

const packet = (ws, type) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => { cleanup(); reject(Error('Timed out waiting for ' + type)); }, 4000);
  const cleanup = () => { clearTimeout(timer); ws.off('message', receive); ws.off('error', fail); };
  const fail = error => { cleanup(); reject(error); };
  const receive = bytes => { const value = JSON.parse(bytes); if (value.type === type) { cleanup(); resolve(value); } };
  ws.on('message', receive); ws.on('error', fail);
});
const connect = url => new WebSocket(url.replace(/^http:/, 'ws:') + '/ws?protocol=' + MULTIPLAYER_PROTOCOL, { origin: url });

test('LAN addresses accept private literals only and reject credentials, paths, public and ambiguous targets', () => {
  for (const value of ['192.168.1.2:17834', '10.2.3.4:17834', '172.16.2.3:17834', 'localhost:17834', '[::1]:17834', '[fd00::12]:17834']) assert.ok(parseLanAddress(value).startsWith('http://'));
  for (const value of ['https://192.168.1.2:17834', '8.8.8.8:17834', 'example.com:17834', '192.168.1.2', 'user:pass@192.168.1.2:17834', '192.168.1.2:17834/game', '192.168.1.2:17834?x', ' 192.168.1.2:17834', '192.168.1.2:99999', '127.1:17834']) {
    // URL normalizes shorthand IPv4; that normalization is safe because resulting address is rechecked.
    if (value === '127.1:17834') assert.equal(parseLanAddress(value), 'http://127.0.0.1:17834');
    else assert.throws(() => parseLanAddress(value), undefined, value);
  }
  assert.equal(privateAddress('172.32.0.1'), false);
  assert.equal(privateAddress('::ffff:8.8.8.8'), false);
});

test('desktop runtime keeps assets/auth local while hosting and joining a real LAN lobby', { timeout: 20000 }, async () => {
  const temp = await mkdtemp(join(tmpdir(), 'athens-lan-runtime.'));
  const runtimes = [], sockets = [];
  try {
    const host = await startDesktopRuntime({ dataDir: join(temp, 'host'), port: 0, lanPort: 0 }); runtimes.push(host);
    const guest = await startDesktopRuntime({ dataDir: join(temp, 'guest'), port: 0, lanPort: 0 }); runtimes.push(guest);
    assert.equal(host.getSession().mode, 'solo');
    assert.deepEqual(await (await fetch(host.url + '/api/auth/config')).json(), { providers: [], required: false });
    const localSession = await fetch(host.url + '/api/auth/session');
    assert.equal(localSession.status, 200); assert.deepEqual(await localSession.json(), { user: null });
    const initial = host.url;
    const hosted = await host.host();
    assert.equal(hosted.mode, 'host'); assert.equal(host.url, initial);
    const lanAddress = `127.0.0.1:${hosted.port}`;
    await assert.rejects(host.join(lanAddress), /another player/);
    await assert.rejects(host.join(`localhost:${hosted.port}`), /another player/);
    assert.equal(host.getSession().mode, 'host');
    assert.equal((await fetch('http://' + lanAddress + '/src/cars.js')).status, 404);
    assert.equal((await fetch('http://' + lanAddress + '/api/auth/config')).status, 404);
    const health = await (await fetch('http://' + lanAddress + '/health')).json();
    assert.equal(health.protocol, MULTIPLAYER_PROTOCOL);
    const hostedSocket = connect(host.url); sockets.push(hostedSocket);
    const hello = await packet(hostedSocket, 'hello');
    assert.ok(hello.maps.length, 'bundled local maps are advertised');
    const map = hello.maps[0];
    const created = packet(hostedSocket, 'lobby');
    hostedSocket.send(JSON.stringify({ type: 'create', car: 'mini', mapId: map.id, eventId: map.events[0].id, name: 'HOST', driverId: 'host-test-123' }));
    const { lobby } = await created;
    const guestOrigin = guest.url;
    const joined = await guest.join(lanAddress); assert.equal(joined.mode, 'join'); assert.equal(guest.url, guestOrigin);
    assert.equal((await (await fetch(guest.url + '/api/lobbies')).json())[0].code, lobby.code);
    assert.deepEqual(await (await fetch(guest.url + '/api/auth/config')).json(), { providers: [], required: false });
    assert.equal((await fetch(guest.url + '/src/cars.js')).status, 200);
    const guestSocket = connect(guest.url); sockets.push(guestSocket); await packet(guestSocket, 'hello');
    const member = packet(guestSocket, 'lobby'); guestSocket.send(JSON.stringify({ type: 'join', code: lobby.code, car: 'mini', name: 'GUEST', driverId: 'guest-test-123' }));
    assert.equal((await member).lobby.players.length, 2);
    const closed = new Promise(resolve => guestSocket.once('close', resolve)); await guest.solo(); await closed;
    assert.equal(guest.getSession().mode, 'solo'); assert.deepEqual(await (await fetch(guest.url + '/api/lobbies')).json(), []);
    hostedSocket.terminate();
    assert.equal((await (await fetch(host.url + '/api/lobbies')).json()).length, 1, 'transport loss retains the reserved lobby');
    await host.solo(); assert.equal(host.getSession().addresses.length, 0);
    await host.host(); assert.deepEqual(await (await fetch(host.url + '/api/lobbies')).json(), []); await host.solo();
    await assert.rejects(fetch('http://' + lanAddress + '/health'));
    assert.equal((await fetch(host.url + '/api/lobbies', { headers: { Origin: 'https://evil.example' } })).status, 403);
    const foreignHost = await new Promise((resolve, reject) => { const request = http.request(host.url + '/api/lobbies', { headers: { Host: 'evil.example:' + new URL(host.url).port } }, response => { response.resume(); resolve(response.statusCode); }); request.on('error', reject); request.end(); });
    assert.equal(foreignHost, 403);
    await assert.rejects(new Promise((resolve, reject) => { const invalid = new WebSocket(host.url.replace('http:', 'ws:') + '/ws?protocol=' + MULTIPLAYER_PROTOCOL, { origin: 'http://evil.example', headers: { Host: 'evil.example' } }); invalid.on('open', () => { invalid.terminate(); resolve(); }); invalid.on('error', reject); }));
    const rejected = await new Promise((resolve, reject) => { const request = http.request(host.url, { path: 'http://8.8.8.8/health' }, response => { response.resume(); resolve(response.statusCode); }); request.on('error', reject); request.end(); });
    assert.equal(rejected, 400);
  } finally { for (const socket of sockets) socket.terminate(); for (const runtime of runtimes.reverse()) await runtime.close(); await rm(temp, { recursive: true, force: true }); }
});

test('LAN preflight rejects incompatible protocols without leaving solo mode', { timeout: 10000 }, async () => {
  const temp = await mkdtemp(join(tmpdir(), 'athens-lan-protocol.'));
  const other = http.createServer((req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ service: DESKTOP_SERVICE, protocol: MULTIPLAYER_PROTOCOL + 1 })); });
  let runtime;
  try {
    await new Promise(resolve => other.listen(0, '127.0.0.1', resolve));
    runtime = await startDesktopRuntime({ dataDir: temp, port: 0 });
    await assert.rejects(runtime.join(`127.0.0.1:${other.address().port}`), /incompatible/);
    assert.equal(runtime.getSession().mode, 'solo');
    await assert.rejects(runtime.join(runtime.url), /another player/);
  } finally { await runtime?.close(); await new Promise(resolve => other.close(resolve)); await rm(temp, { recursive: true, force: true }); }
});


test('bundled world cells preserve gzip bytes and reject traversal and symlink escape', { timeout: 10000 }, async () => {
  const temp = await mkdtemp(join(tmpdir(), 'athens-world-runtime.'));
  const root = join(temp, 'game'), source = fileURLToPath(new URL('../..', import.meta.url));
  let runtime;
  try {
    await mkdir(join(root, 'world'), { recursive: true });
    for (const name of ['src', 'data']) await symlink(resolve(source, name), join(root, name), 'dir');
    const bytes = gzipSync(Buffer.from('immutable world cell'));
    await writeFile(join(root, 'world', '0,0.bin.gz'), bytes);
    await writeFile(join(temp, 'secret.txt'), 'private');
    await symlink(join(temp, 'secret.txt'), join(root, 'world', 'escape.bin'));
    runtime = await startDesktopRuntime({ root, dataDir: join(temp, 'saves'), port: 0 });
    const response = await fetch(runtime.url + '/world/0,0.bin.gz');
    assert.equal(response.status, 200); assert.equal(response.headers.get('content-encoding'), null);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
    assert.equal((await fetch(runtime.url + '/world/escape.bin')).status, 404);
    assert.equal((await fetch(runtime.url + '/world/%2e%2e%2fsecret.txt')).status, 404);
  } finally { await runtime?.close(); await rm(temp, { recursive: true, force: true }); }
});

test('join compares bundled release fingerprints and strips cookies and credentials from proxied APIs', { timeout: 10000 }, async () => {
  const temp = await mkdtemp(join(tmpdir(), 'athens-lan-headers.'));
  let runtime, release = 'different-release';
  const seen = [];
  const other = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/api/desktop/info') res.end(JSON.stringify({ service: DESKTOP_SERVICE, protocol: MULTIPLAYER_PROTOCOL, release }));
    else { seen.push(req.headers); res.setHeader('Set-Cookie', 'remote-secret=1'); res.end(JSON.stringify({ routes: ['remote-config'] })); }
  });
  try {
    await new Promise(resolve => other.listen(0, '127.0.0.1', resolve));
    runtime = await startDesktopRuntime({ dataDir: temp, port: 0 });
    const address = `127.0.0.1:${other.address().port}`;
    await assert.rejects(runtime.join(address), /incompatible/);
    release = (await (await fetch(runtime.url + '/health')).json()).release;
    await runtime.join(address);
    const response = await fetch(runtime.url + '/api/routes', { headers: { Cookie: 'local-secret=1', Authorization: 'Bearer private' } });
    assert.deepEqual(await response.json(), { routes: ['remote-config'] });
    assert.equal(seen[0].cookie, undefined); assert.equal(seen[0].authorization, undefined);
    assert.equal(response.headers.get('set-cookie'), null);
  } finally { await runtime?.close(); await new Promise(resolve => other.close(resolve)); await rm(temp, { recursive: true, force: true }); }
});

test('HTTP and WebSocket proxy targets cannot escape the selected authority via URL normalization', { timeout: 10000 }, async () => {
  const temp = await mkdtemp(join(tmpdir(), 'athens-lan-origin.'));
  let runtime, requests = 0, upgrades = 0;
  const spy = http.createServer((req, res) => { requests++; res.end('ESCAPED'); });
  spy.on('upgrade', (req, socket) => { upgrades++; socket.destroy(); });
  try {
    await new Promise(resolve => spy.listen(0, '127.0.0.1', resolve));
    runtime = await startDesktopRuntime({ dataDir: temp, port: 0 });
    const authority = `127.0.0.1:${spy.address().port}`;
    const rawRequest = (path, websocket = false) => new Promise((resolve, reject) => {
      const request = http.request(runtime.url, { path, ...(websocket ? { headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==' } } : {}) }, response => { response.resume(); resolve(response.statusCode); });
      request.on('error', error => websocket && error.code === 'ECONNRESET' ? resolve(400) : reject(error)); request.end();
    });
    for (const path of ['/' + String.fromCharCode(92) + authority + '/ws', '//' + authority + '/ws', '/%5c%5c' + authority + '/ws', '/%2f%2f' + authority + '/ws', '/api/lobbies#fragment']) {
      assert.ok([400, 404].includes(await rawRequest(path)), path);
      assert.ok([400, 404].includes(await rawRequest(path, true)), path);
    }
    assert.equal(requests, 0); assert.equal(upgrades, 0);
  } finally { await runtime?.close(); await new Promise(resolve => spy.close(resolve)); await rm(temp, { recursive: true, force: true }); }
});


test('mode changes preserve backpressured immutable local bytes, cancel session APIs and close all streams at shutdown', { timeout: 20000 }, async () => {
  const temp = await mkdtemp(join(tmpdir(), 'athens-mode-assets.'));
  const root = join(temp, 'game'), source = fileURLToPath(new URL('../..', import.meta.url));
  const bytes = Buffer.alloc(32 * 1024 * 1024, 0x59), digest = value => createHash('sha256').update(value).digest('hex');
  const responses = []; let runtime, release, remoteSeen, remoteClosed;
  const bounded = (promise, label) => { let timer; return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error(label)), 4000); })]).finally(() => clearTimeout(timer)); };
  const seen = new Promise(resolve => { remoteSeen = resolve; });
  const remote = http.createServer((req, res) => {
    if (req.url === '/api/desktop/info') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ service: DESKTOP_SERVICE, protocol: MULTIPLAYER_PROTOCOL, release })); }
    else { assert.equal(req.url, '/api/lobbies', 'installed assets must never reach the selected remote'); remoteClosed = new Promise(resolve => res.once('close', resolve)); remoteSeen(); }
  });
  const pausedAsset = () => new Promise((resolve, reject) => {
    const request = http.get(runtime.url + '/%61ssets/mode-fixture.bin', response => {
      assert.equal(response.statusCode, 200); response.pause(); responses.push(response);
      const chunks = [];
      const body = new Promise((resolveBody, rejectBody) => { response.on('data', chunk => chunks.push(chunk)); response.on('end', () => resolveBody(Buffer.concat(chunks))); response.on('error', rejectBody); });
      // Shutdown deliberately aborts one body; attach a handler before transition.
      body.catch(() => {}); resolve({ response, body });
    }); request.on('error', reject);
  });
  try {
    await mkdir(join(root, 'src'), { recursive: true }); await mkdir(join(root, 'assets'), { recursive: true });
    await copyFile(join(source, 'src/cars.js'), join(root, 'src/cars.js'));
    for (const map of MAPS) { const target = join(root, map.dataUrl); await mkdir(resolve(target, '..'), { recursive: true }); await copyFile(join(source, map.dataUrl), target); }
    await writeFile(join(root, 'assets/mode-fixture.bin'), bytes);
    runtime = await startDesktopRuntime({ root, dataDir: join(temp, 'saves'), port: 0, lanPort: 0 });
    release = (await (await fetch(runtime.url + '/api/desktop/info')).json()).release;
    await runtime.host();
    const first = await pausedAsset();
    await runtime.solo(); first.response.resume();
    assert.equal(digest(await bounded(first.body, 'asset body interrupted by Host→Solo')), digest(bytes), 'Host→Solo retains every actual local asset byte');
    await new Promise(resolve => remote.listen(0, '127.0.0.1', resolve));
    await runtime.join(`127.0.0.1:${remote.address().port}`);
    const pendingAPI = fetch(runtime.url + '/api/lobbies'); await bounded(seen, 'remote API never reached host');
    const second = await pausedAsset();
    await runtime.solo();
    assert.equal((await bounded(pendingAPI, 'old API not canceled')).status, 502, 'old session API is canceled rather than delivered after mode change');
    await bounded(remoteClosed, 'remote API transport survived mode change'); second.response.resume();
    assert.equal(digest(await bounded(second.body, 'asset body interrupted by Join→Solo')), digest(bytes), 'Join→Solo still uses complete installed local assets');
    assert.deepEqual(await (await fetch(runtime.url + '/api/lobbies')).json(), []);
    const final = await pausedAsset(), closed = new Promise(resolve => final.response.once('close', resolve));
    await runtime.close(); runtime = null; final.response.resume(); await bounded(closed, 'shutdown left local asset stream open');
    assert.equal(final.response.complete, false, 'final shutdown cancels even immutable pending streams');
  } finally {
    for (const response of responses) response.destroy(); await runtime?.close();
    remote.closeAllConnections?.(); await new Promise(resolve => remote.close(resolve)); await rm(temp, { recursive: true, force: true });
  }
});


test('only decoded immutable installed GET/HEAD paths escape session cancellation', () => {
  const check = (path, options = {}) => immutableLocalRequest({ local: true, remote: false, method: 'GET', path, ...options });
  for (const path of ['/', '/index.html', '/style.css', '/assets/audio/world/wind.mp3', '/%61ssets/track.bin', '/src/chunk.js', '/data/routes/map.json']) {
    assert.equal(check(path), true, path); assert.equal(check(path, { method: 'HEAD' }), true, path);
    assert.equal(check(path, { remote: true }), false, 'selected remote never inherits installed exemption');
    assert.equal(check(path, { local: false }), false, 'LAN listener never serves installed assets');
    assert.equal(check(path, { method: 'POST' }), false, 'mutation requests remain session bound');
  }
  for (const path of ['/api/routes', '/%61pi/routes', '/api%2flobbies', '/auth/callback', '/%61uth/callback', '/assets/../api/lobbies', '/assets/%2e%2e/api/lobbies', '/assets/.secret', '/assets/%zz', '//remote/assets/wind.mp3', 'http://remote/assets/wind.mp3']) assert.equal(check(path), false, path);
});
