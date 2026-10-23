import {readOriginalJSON} from './strict-json-file.mjs';
import {checkRivalPlan,rivalSourceHash} from './build-rival-plans.mjs';
import {readFile,writeFile,rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {loadWorldDefinition,canonicalWorldJSON} from '../src/world-manifest.js';

const hex64 = /^[a-f0-9]{64}$/;
const entryFields = ['sha256', 'bytes', 'decodedBytes', 'residentBytes', 'transientBytes', 'triangles', 'contactEligible'];
const same = (a, b) => canonicalWorldJSON(a??null) === canonicalWorldJSON(b??null);

export async function routeReleaseConfig(root, environment = 'staging') {
  const config = JSON.parse(await readFile(resolve(root, 'wrangler.jsonc'), 'utf8'));
  const key = config.env?.[environment]?.vars?.ATHENS_WORLD_MANIFEST;
  if (!['staging', 'production'].includes(environment) || !/^manifests\/[a-f0-9]{64}\.json$/.test(key || '')) throw Error('World manifest binding unavailable');
  const streets = JSON.parse(await readFile(resolve(root, 'assets/athens/streets.json'), 'utf8'));
  if (streets.manifest !== key || !hex64.test(streets.revision || '')) throw Error('Picker streets and deployed world manifest differ');
  return {key, revision: streets.revision};
}

export async function activeRouteWorld(root, environment = 'staging', options = {}) {
  const binding = await routeReleaseConfig(root, environment);
  // Promotion builds read the already tested immutable source; R2 is copied before activation.
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
  if (!['staging', 'production'].includes(environment)) return {checked: 0};
  const {revision} = await routeReleaseConfig(root, environment);
  const out = resolve(root, '.deploy/assets');
  const index = await readOriginalJSON(resolve(out, 'data/routes/index.json'));
  const config = await readOriginalJSON(resolve(out, 'route-config.json'));
  const catalogue = await readOriginalJSON(resolve(root, '.deploy/catalogue.json'));
  const entries = index.routes || [], enabled = config.routes || [], server = catalogue.routes || [];
  if (!entries.length || entries.length !== enabled.length || entries.length !== server.length) throw Error('Compiled route catalogue incomplete');
  const sourceHash=await rivalSourceHash(root);
  for (const entry of entries) {
    const counterpart = enabled.find(r => r.id === entry.id), backend = server.find(r => r.id === entry.id);
    if (!counterpart || !backend || !hex64.test(entry.routeHash || '') || entry.worldSetRevision !== revision || counterpart.worldSetRevision !== revision || backend.worldSetRevision !== revision || counterpart.routeHash !== entry.routeHash || backend.routeHash !== entry.routeHash) throw Error(`Compiled route/world release mismatch: ${entry.id}`);
    const artifact = await readOriginalJSON(resolve(out,`data/routes/${entry.id}.${entry.routeHash}.json`),{maxBytes:2*1024*1024,label:'Compiled route artifact'});
    if (artifact.worldSetRevision !== revision || artifact.routeHash !== entry.routeHash || artifact.geometryHash !== entry.geometryHash) throw Error(`Compiled route artifact/world release mismatch: ${entry.id}`);
    await checkRivalPlan(artifact,{sourceHash});
  }
  return {checked: entries.length, revision};
}

export const readRouteValidationRoot=root=>readOriginalJSON(resolve(root,'data/routes/validation/athens.inputs.json'),{maxBytes:8*1024*1024,label:'Route validation root'});

// Keep regional proofs bounded while rebinding every sibling to the same release.
export async function writeRouteProofs(root, source, manifest, directory) {
  const names=source.shards||[];if(!Array.isArray(names)||names.length>3||names.some(name=>!(/^[a-z][a-z0-9-]*\.inputs\.json$/).test(name)))throw Error('Invalid regional route proof siblings');
  const bound=rebindRouteShard(source,manifest),files=[];
  try {
    for(const name of names){const extra=await readOriginalJSON(resolve(root,'data/routes/validation',name),{maxBytes:8*1024*1024,label:'Regional route proof'});if(extra.shards)throw Error('Nested route proof siblings');const regional=rebindRouteShard(extra,manifest);const file=resolve(directory,name);await writeFile(file,JSON.stringify(regional.shard));files.push(file);}
    return {bound,cleanup:()=>Promise.all(files.map(file=>rm(file,{force:true})))};
  } catch(error){await Promise.all(files.map(file=>rm(file,{force:true})));throw error;}
}
export function selectRouteRelease(build, ids) {
  const enabled=new Set(ids);for(const id of enabled)if(!build.index.routes.some(route=>route.id===id))throw Error('Unknown enabled route: '+id);
  return {...build,index:{...build.index,routes:build.index.routes.filter(route=>enabled.has(route.id))},server:{...build.server,routes:build.server.routes.filter(route=>enabled.has(route.id))}};
}
