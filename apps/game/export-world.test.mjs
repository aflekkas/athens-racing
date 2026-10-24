import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, readFile, writeFile, access, symlink, rename } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fixture } from '../../tools/fixtures/routes/fixture.mjs';
import { compileRoute } from '../../src/route-compile.js';
import { ATHENS_PROJECTION, canonicalWorldJSON } from '../../src/world-manifest.js';
import { exportWorldRelease, verifyWorldRelease } from './export-world.mjs';
const bytes = value => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value));
const hash = value => createHash('sha256').update(value).digest('hex');
const origin = 'https://fixture.test';

async function setup(change) {
  const directory = await mkdtemp(resolve(process.platform === 'win32' ? tmpdir() : '/tmp', 'athens-export-test.'));
  const cell = Buffer.from('synthetic compressed packet'), cellHash = hash(cell), cellURL = `/world/cells/${cellHash}.bin.gz`;
  const projection = { lat0: ATHENS_PROJECTION.lat0, lon0: ATHENS_PROJECTION.lon0, mlat: ATHENS_PROJECTION.metresPerLat, mlon: ATHENS_PROJECTION.metresPerLon };
  const packet = { url: cellURL, sha256: cellHash, bytes: cell.length, decodedBytes: 64, triangles: 0, dependencies: [] };
  const source = { tileVersion: 1, world: 'source', revision: 'a'.repeat(64), projection, tileMetres: 512, elevation: { datum: 'EVRS2000' }, externalPortals: [], spawn: { cell: [0, 0], anchor: 'start' }, tiles: { '0,0': packet, '1,0': packet } };
  change?.(source);
  const region = bytes(source), regionHash = hash(region), regionURL = `/world/manifests/${regionHash}.json`;
  const content = { schemaVersion: 1, id: 'athens', projection, tileMetres: 512, regions: [{ id: 'basin', manifestUrl: regionURL, manifestSha256: regionHash, sourceWorld: source.world, sourceRevision: source.revision, access: 'public', elevation: source.elevation, externalPortals: [] }] };
  const revision = hash(bytes(canonicalWorldJSON(content))), root = bytes({ ...content, revision }), rootURL = `/world/manifests/${hash(root)}.json`;
  const f = fixture(); f.contacts.worldSetRevision = revision;
  const compiled = await compileRoute(f.definition, f.graph, f.contacts, { worldSetRevision: revision });
  const routeURL = `/data/routes/${compiled.id}.${compiled.routeHash}.json`;
  const config = { environment: 'staging', online: false, world: false, routes: [{ id: compiled.id, routeHash: compiled.routeHash, geometryHash: compiled.geometryHash, worldSetRevision: revision, url: routeURL }] };
  const documents = new Map([[rootURL, root], [regionURL, region], [cellURL, cell], [routeURL, bytes(compiled)], ['/api/routes', bytes(config)]]), calls = [];
  const fetcher = async url => {
    assert.equal(new URL(url).origin, origin); const path = new URL(url).pathname; calls.push(path);
    if (path === '/data/athens/manifest.json') return new Response(null, { status: 307, headers: { location: rootURL } });
    const body = documents.get(path); return new Response(body || null, { status: body ? 200 : 404, headers: body ? { 'content-length': String(body.length) } : {} });
  };
  return { directory, out: resolve(directory, 'release'), cellURL, routeURL, documents, calls, fetcher, revision };
}
async function scoped(callback, change) {
  const f = await setup(change); try { await callback(f); } finally { await rm(f.directory, { recursive: true, force: true }); }
}
const run = (f, extra = {}) => exportWorldRelease({ out: f.out, origin, fetcher: f.fetcher, diskCheck: false, log() {}, ...extra });

test('eager export produces independently verified complete local world and route catalogue', () => scoped(async f => {
  const result = await run(f);
  assert.equal(result.worldSetRevision, f.revision); assert.equal(result.cells, 2); assert.deepEqual(result.routes, ['fixture-race']);
  assert.equal(f.calls.filter(path => path === f.cellURL).length, 1, 'duplicate immutable cell downloaded only once');
  assert.equal((await verifyWorldRelease(f.out)).files.length, result.files.length);
  const catalogue = JSON.parse(await readFile(resolve(f.out, 'catalogue.json')));
  assert.equal(catalogue.routes[0].worldSetRevision, f.revision);
  const world = JSON.parse(await readFile(resolve(f.out, 'world-flat.json')));
  assert.equal(world.tiles['0,0'].url, f.cellURL);
}));

test('corrupt immutable bytes fail before any complete release is published', () => scoped(async f => {
  f.documents.set(f.cellURL, Buffer.alloc(f.documents.get(f.cellURL).length));
  await assert.rejects(run(f), /hash mismatch/);
  await assert.rejects(access(resolve(f.out, 'offline-world-inventory.json')));
}));

test('declared cell sizes and total download ceilings are enforced', () => scoped(async f => {
  f.documents.set(f.cellURL, Buffer.from('too short'));
  await assert.rejects(run(f), /byte length mismatch/);
  await assert.rejects(run(f, { maxBytes: 20 }), /byte ceiling/);
}));

test('external immutable asset URLs are rejected without contacting them', () => scoped(async f => {
  await assert.rejects(run(f), /root-relative|external or unsafe/);
  assert.equal(f.calls.some(url => url.includes('outside')), false);
}, source => { source.tiles['0,0'] = { ...source.tiles['0,0'], url: 'https://outside.test/world/cells/' + 'b'.repeat(64) + '.bin.gz' }; }));

test('modified compiled route geometry is rejected even when the server tuple is unchanged', () => scoped(async f => {
  const compiled = JSON.parse(f.documents.get(f.routeURL)); compiled.points[0][0] += 1;
  f.documents.set(f.routeURL, bytes(compiled));
  await assert.rejects(run(f), /compiled route hash mismatch/);
}));

test('local release verification detects corruption after download', () => scoped(async f => {
  await run(f); await writeFile(resolve(f.out, f.cellURL.slice(1)), 'changed');
  await assert.rejects(verifyWorldRelease(f.out), /local asset corrupted/);
}));


test('inventory cannot omit a manifest dependency even after removing its file', () => scoped(async f => {
  await run(f);
  const path = resolve(f.out, 'offline-world-inventory.json'), inventory = JSON.parse(await readFile(path));
  inventory.files = inventory.files.filter(entry => entry.path !== f.cellURL.slice(1));
  await writeFile(path, JSON.stringify(inventory)); await rm(resolve(f.out, f.cellURL.slice(1)));
  await assert.rejects(verifyWorldRelease(f.out), /unlisted dependency/);
}));

test('local verification rejects symlinked cells even when their target has valid bytes', () => scoped(async f => {
  await run(f);
  const path = resolve(f.out, f.cellURL.slice(1)), target = resolve(f.directory, 'external-cell');
  await rename(path, target); await symlink(target, path);
  await assert.rejects(verifyWorldRelease(f.out), /symlink/);
}));

test('failed refresh preserves the previously verified export', () => scoped(async f => {
  const before = await run(f);
  f.documents.set(f.cellURL, Buffer.alloc(f.documents.get(f.cellURL).length));
  await assert.rejects(run(f), /hash mismatch/);
  assert.deepEqual((await verifyWorldRelease(f.out)).files, before.files);
}));

test('same-origin absolute manifest asset URLs cannot leak runtime requests back to the build server', () => scoped(async f => {
  await assert.rejects(run(f), /root-relative/);
}, source => { source.tiles['0,0'] = { ...source.tiles['0,0'], url: origin + source.tiles['0,0'].url }; }));


test('inventory cannot smuggle executable source into a verified export', () => scoped(async f => {
  await run(f);
  const path = resolve(f.out, 'offline-world-inventory.json'), inventory = JSON.parse(await readFile(path));
  inventory.files.push({ path: 'src/main.js', bytes: 1, sha256: 'a'.repeat(64) });
  await writeFile(path, JSON.stringify(inventory));
  await assert.rejects(verifyWorldRelease(f.out), /invalid local file descriptor/);
}));

test('private proof input must match the authenticated composed world', () => scoped(async f => {
  await run(f);
  const path = resolve(f.out, 'offline-world-inventory.json'), inventory = JSON.parse(await readFile(path));
  const file = resolve(f.out, 'world-flat.json'), flat = JSON.parse(await readFile(file)); flat.spawn.anchor = 'changed';
  const raw = bytes(flat); await writeFile(file, raw);
  Object.assign(inventory.files.find(entry => entry.path === 'world-flat.json'), { bytes: raw.length, sha256: hash(raw) });
  await writeFile(path, JSON.stringify(inventory));
  await assert.rejects(verifyWorldRelease(f.out), /private flat world differs/);
}));
