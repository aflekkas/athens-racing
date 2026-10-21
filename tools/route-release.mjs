import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {loadWorldDefinition} from '../src/world-manifest.js';

const hex64 = /^[a-f0-9]{64}$/;
const entryFields = ['sha256', 'bytes', 'decodedBytes', 'residentBytes', 'transientBytes', 'triangles', 'contactEligible'];
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export async function routeReleaseConfig(root, environment = 'staging') {
  const config = JSON.parse(await readFile(resolve(root, 'wrangler.jsonc'), 'utf8'));
  const key = config.env?.[environment]?.vars?.ATHENS_WORLD_MANIFEST;
  if (environment !== 'staging' || !/^manifests\/[a-f0-9]{64}\.json$/.test(key || '')) throw Error('Staging world manifest binding unavailable');
  const streets = JSON.parse(await readFile(resolve(root, 'assets/athens/streets.json'), 'utf8'));
  if (streets.manifest !== key || !hex64.test(streets.revision || '')) throw Error('Picker streets and deployed world manifest differ');
  return {key, revision: streets.revision};
}

export async function activeRouteWorld(root, environment = 'staging', options = {}) {
  const binding = await routeReleaseConfig(root, environment);
  const url = `https://staging.athensracing.com/world/${binding.key}`;
  const {manifest} = await loadWorldDefinition(url, options);
  if (manifest.revision !== binding.revision) throw Error('Picker streets and authenticated world release differ');
  return {manifest, binding};
}

// The shard is a proof of emitted graph/contact data. It may follow a composed
// release only when every source cell used by those proofs is byte-identical.
export function rebindRouteShard(shard, manifest) {
  if (shard.schemaVersion !== 1 || !hex64.test(shard.worldSetRevision || '') || !Array.isArray(shard.sourceHashes) || !shard.cells || !Array.isArray(shard.edges) || !shard.proofs) throw Error('Invalid emitted route proof shard');
  const hashes = new Map(shard.sourceHashes);
  if (hashes.size !== shard.sourceHashes.length || hashes.size !== Object.keys(shard.cells).length) throw Error('Incomplete emitted route source identities');
  const cells = {};
  for (const [key, prior] of Object.entries(shard.cells)) {
    const active = manifest.tiles?.[key];
    if (!active || hashes.get(key) !== prior.sha256 || entryFields.some(field => prior[field] !== active[field]) || !same(prior.dependencies, active.dependencies) || !same(prior.source, active.source)) throw Error(`Route proof cell changed: ${key}`);
    cells[key] = active;
  }
  return {world: {revision: manifest.revision, tiles: cells}, shard: {...shard, worldSetRevision: manifest.revision, cells}};
}

export async function checkBuiltRouteRelease(root, environment = 'staging') {
  if (environment !== 'staging') return {checked: 0};
  const {revision} = await routeReleaseConfig(root, environment);
  const out = resolve(root, '.deploy/assets');
  const index = JSON.parse(await readFile(resolve(out, 'data/routes/index.json'), 'utf8'));
  const config = JSON.parse(await readFile(resolve(out, 'route-config.json'), 'utf8'));
  const catalogue = JSON.parse(await readFile(resolve(root, '.deploy/catalogue.json'), 'utf8'));
  const entries = index.routes || [], enabled = config.routes || [], server = catalogue.routes || [];
  if (!entries.length || entries.length !== enabled.length || entries.length !== server.length) throw Error('Compiled route catalogue incomplete');
  for (const entry of entries) {
    const counterpart = enabled.find(r => r.id === entry.id), backend = server.find(r => r.id === entry.id);
    if (!counterpart || !backend || !hex64.test(entry.routeHash || '') || entry.worldSetRevision !== revision || counterpart.worldSetRevision !== revision || backend.worldSetRevision !== revision || counterpart.routeHash !== entry.routeHash || backend.routeHash !== entry.routeHash) throw Error(`Compiled route/world release mismatch: ${entry.id}`);
    const artifact = JSON.parse(await readFile(resolve(out, `data/routes/${entry.id}.${entry.routeHash}.json`), 'utf8'));
    if (artifact.worldSetRevision !== revision || artifact.routeHash !== entry.routeHash || artifact.geometryHash !== entry.geometryHash) throw Error(`Compiled route artifact/world release mismatch: ${entry.id}`);
  }
  return {checked: entries.length, revision};
}
