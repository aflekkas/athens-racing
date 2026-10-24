// Explicit derived release, never a runtime alias or a change to the source cache.
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, mkdtemp, rm, link, copyFile, rename, lstat } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { canonicalWorldJSON, composeWorldManifest } from '../../src/world-manifest.js';
import { canonicalJSON, sha256 } from '../../src/route-definition.js';
import { routeGeometryHash, resolveRoutePath } from '../../src/route-compile.js';
import { edgeValue, edgeLength, edgePoint, allowedTurn } from '../../src/route-geometry.js';
import { readEmittedRouteWorld } from '../../tools/emitted-route-world.mjs';
import { buildRouteCatalogue } from '../../server/route-definitions.mjs';
import { megaraSurfaceRepairContract, repairMegaraGraphCell } from '../../tools/world-gen/repair-megara-graph-surfaces.mjs';
import { verifyWorldRelease } from './export-world.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = async path => JSON.parse(await readFile(path, 'utf8'));
const CONTRACT = 'offline-megara-graph-surface-v1';
const BUDGET_CONTRACT = 'preserve-source-resident-budget-v1';

// Packet identity is intentionally stable across the metadata-only budget fix.
// The regional manifest has a new identity, while each cell explicitly names
// its original or repaired packet revision (and keeps its immutable bytes).
async function repairRevisions(input) {
  const packetRevision = await sha256(input);
  return { packetRevision, regionalRevision: await sha256({ schemaVersion: 1, contract: CONTRACT, packetRevision, budgetContract: BUDGET_CONTRACT }) };
}
export function repairedCellDescriptor(entry, result, { regionId, world, originalRevision, packetRevision }) {
  const next = { ...entry, source: { regionId, world, revision: result.changed ? packetRevision : originalRevision } };
  if (!result.changed) return next;
  const residentBytes = entry.residentBytes ?? entry.decodedBytes;
  if (!Number.isSafeInteger(residentBytes) || residentBytes <= 0) throw Error('Original resident budget unavailable');
  Object.assign(next, { sha256: result.hash, url: '/world/cells/' + result.hash + '.bin.gz', bytes: result.body.length, decodedBytes: result.rawBytes, residentBytes });
  if (next.transientBytes !== undefined) next.transientBytes = Math.max(next.transientBytes, 2 * next.decodedBytes + next.bytes);
  return next;
}


// Replay the compiler's unchanged graph walk without changing or resampling any
// geometry. Reproducing the original digest is mandatory before rebinding it.
export function routeReferencedEdges(compiled, graph) {
  const def = compiled.definition, ids = resolveRoutePath(def, graph), referenced = new Map(ids.map(id => [id, edgeValue(graph, id)]));
  const walk = (initial, at, remaining, backward) => {
    let edge = initial, index = backward ? 0 : ids.length - 1; const seen = new Set();
    while (remaining > 1e-6) {
      if (!edge || seen.size > 1000) throw Error('Derived route graph extension unavailable');
      seen.add(edge.id); referenced.set(edge.id, edge);
      const length = edgeLength(edge), take = Math.min(remaining, backward ? at : length - at); remaining -= take;
      if (remaining <= 1e-6) break;
      const previous = edge, candidates = backward
        ? [...graph.edges.keys()].map(id => edgeValue(graph, id)).filter(e => e.to === edge.from && allowedTurn(def, graph, e, edge, []))
        : [...(graph.outgoing.get(edge.to) || [])].map(id => edgeValue(graph, id)).sort((a, b) => a.id.localeCompare(b.id)).filter(e => allowedTurn(def, graph, edge, e, []));
      const tangent = edgePoint(edge, backward ? 0 : length);
      candidates.sort((a, b) => { const aa = edgePoint(a, backward ? edgeLength(a) : 0), bb = edgePoint(b, backward ? edgeLength(b) : 0); return bb.tx * tangent.tx + bb.tz * tangent.tz - aa.tx * tangent.tx - aa.tz * tangent.tz || a.id.localeCompare(b.id); });
      if (def.kind === 'circuit') { const period = ids[0] === ids.at(-1) ? ids.length - 1 : ids.length; index = (index + (backward ? -1 : 1) + period) % period; edge = candidates.find(e => e.id === ids[index]); }
      else edge = candidates.find(e => !seen.has(e.id));
      if (!edge) throw Error('Derived route runout disconnected');
      const a = backward ? edge.points.at(-1) : previous.points.at(-1), b = backward ? previous.points[0] : edge.points[0];
      if (Math.hypot(...a.map((v, i) => v - b[i])) > .025) throw Error('Derived route contact seam changed');
      at = backward ? edgeLength(edge) : 0;
    }
  };
  walk(edgeValue(graph, ids[0]), def.start.offsetM, 80, true);
  walk(edgeValue(graph, ids.at(-1)), def.finish.offsetM, 151, false);
  return referenced;
}

export async function routeGraphDigest(compiled, graph, manifest) {
  const referenced = routeReferencedEdges(compiled, graph);
  return sha256({ edges: [...referenced].sort(([a], [b]) => a.localeCompare(b)), restrictions: [...graph.turns.values()].map(v => v.value || v).filter(t => referenced.has(t.from) || t.sequence?.some(id => referenced.has(id))), contactSources: compiled.cells.map(key => [key, manifest.tiles[key].sha256]) });
}

export async function rebindCompiledWorld(compiled, revision, graphDigest) {
  const next = structuredClone(compiled), before = await routeGeometryHash(compiled);
  if (before !== compiled.geometryHash) throw Error('Original route geometry hash mismatch');
  next.worldSetRevision = revision; next.graphDigest = graphDigest;
  let rivalPlanHash;
  if (next.rivalPlan) {
    const { hash: originalHash, ...originalPlan } = next.rivalPlan;
    if (await sha256(originalPlan) !== originalHash) throw Error('Original rival plan hash mismatch');
    next.rivalPlan.worldSetRevision = revision;
    const { hash: _, ...body } = next.rivalPlan; rivalPlanHash = await sha256(body); next.rivalPlan.hash = rivalPlanHash;
  }
  next.routeHash = await sha256({ definition: next.definition, geometryHash: next.geometryHash, worldSetRevision: revision, ...(rivalPlanHash ? { rivalPlanHash } : {}) });
  if (await routeGeometryHash(next) !== before) throw Error('Derived route changed competitive geometry');
  return next;
}

export async function verifyRepairedWorldRelease({ root = resolve(import.meta.dirname, '../..'), release = resolve(root, '.desktop/world-release'), out = resolve(root, '.desktop/world-release-repaired') } = {}) {
  await verifyWorldRelease(release); const inventory = await verifyWorldRelease(out), proof = inventory.derivation;
  if (proof?.schemaVersion !== 1 || proof.contract !== CONTRACT || proof.sourceInventoryHash !== hash(await readFile(resolve(release, 'offline-world-inventory.json')))) throw Error('Derived world is not bound to the original verified export');
  const sourceRoot = await json(resolve(release, 'data/athens/manifest.json')), sourceRegion = sourceRoot.regions?.find(r => r.id === 'megara');
  if (!sourceRegion) throw Error('Derived source Megara region missing');
  const sourceBytes = await readFile(resolve(release, sourceRegion.manifestUrl.slice(1))), sourceRegional = JSON.parse(sourceBytes);
  const repairToolHash = hash(await readFile(resolve(root, 'tools/world-gen/repair-megara-graph-surfaces.mjs')));
  const { packetRevision, regionalRevision } = await repairRevisions({ schemaVersion: 1, contract: CONTRACT, originalManifestHash: sourceRegion.manifestSha256, originalRevision: sourceRegional.revision, sourceInventoryHash: proof.sourceInventoryHash, repairToolHash });
  if (proof.repairToolHash !== repairToolHash || proof.originalWorldRevision !== sourceRoot.revision || proof.originalRegionalRevision !== sourceRegional.revision || proof.derivedRegionalRevision !== regionalRevision || proof.packetRevision !== packetRevision || proof.budgetContract !== BUDGET_CONTRACT) throw Error('Derived source/tool provenance changed');
  const contract = megaraSurfaceRepairContract({ manifestBytes: sourceBytes, expectedManifestHash: sourceRegion.manifestSha256, mapBytes: await readFile(resolve(root, 'data/maps/megara/map.json')), contextBytes: await readFile(resolve(root, 'tools/maps/megara/raw/context.json')) });
  const expectedRegional = structuredClone(sourceRegional), changed = [];
  expectedRegional.revision = regionalRevision;
  expectedRegional.regions = [{ id: sourceRegion.id, sourceWorld: sourceRegional.world, sourceRevision: regionalRevision }];
  expectedRegional.sourceIdentities = [{ regionId: sourceRegion.id, world: sourceRegional.world, revision: sourceRegional.revision }, { regionId: sourceRegion.id, world: sourceRegional.world, revision: packetRevision }];
  for (const [key, entry] of Object.entries(sourceRegional.tiles)) {
    const result = repairMegaraGraphCell(await readFile(resolve(release, 'world/cells', entry.sha256 + '.bin.gz')), contract, { cell: key, newRevision: packetRevision });
    expectedRegional.tiles[key] = repairedCellDescriptor(entry, result, { regionId: sourceRegion.id, world: sourceRegional.world, originalRevision: sourceRegional.revision, packetRevision });
    if (!result.changed) continue;
    changed.push({ cell: key, before: entry.sha256, after: result.hash, edges: result.edges });
  }
  if (canonicalJSON(changed) !== canonicalJSON(proof.changed)) throw Error('Derived graph repair audit changed');
  const regionalHash = hash(Buffer.from(JSON.stringify(expectedRegional))), regionalURL = '/world/manifests/' + regionalHash + '.json';
  if (canonicalJSON(await json(resolve(out, regionalURL.slice(1)))) !== canonicalJSON(expectedRegional)) throw Error('Derived regional manifest differs from guarded source repair');
  const expectedRoot = structuredClone(sourceRoot); Object.assign(expectedRoot.regions.find(r => r.id === sourceRegion.id), { manifestUrl: regionalURL, manifestSha256: regionalHash, sourceRevision: regionalRevision });
  const { revision: _, ...content } = expectedRoot; expectedRoot.revision = hash(Buffer.from(canonicalWorldJSON(content)));
  if (canonicalJSON(await json(resolve(out, 'data/athens/manifest.json'))) !== canonicalJSON(expectedRoot) || proof.derivedWorldRevision !== expectedRoot.revision) throw Error('Derived root changed unrelated source data');
  const old = await json(resolve(release, 'catalogue.json')), next = await json(resolve(out, 'catalogue.json'));
  if (old.routes.length !== next.routes.length) throw Error('Derived route count changed');
  const beforeFlat = await json(resolve(release, 'world-flat.json')), afterFlat = await json(resolve(out, 'world-flat.json'));
  for (const route of old.routes) {
    const counterpart = next.routes.find(c => c.id === route.id);
    if (!counterpart || counterpart.geometryHash !== route.geometryHash || !proof.routes.some(c => c.id === route.id && c.originalRouteHash === route.routeHash && c.derivedRouteHash === counterpart.routeHash && c.originalGraphDigest === route.graphDigest && c.derivedGraphDigest === counterpart.graphDigest)) throw Error('Derived route provenance mismatch');
    if (route.cells.every(key => beforeFlat.tiles[key]?.sha256 === afterFlat.tiles[key]?.sha256) && counterpart.graphDigest !== route.graphDigest) throw Error('Unchanged graph digest was rebound');
    const a = structuredClone(route), b = structuredClone(counterpart);
    for (const value of [a, b]) { delete value.worldSetRevision; delete value.graphDigest; delete value.routeHash; if (value.rivalPlan) { delete value.rivalPlan.worldSetRevision; delete value.rivalPlan.hash; } }
    if (canonicalJSON(a) !== canonicalJSON(b)) throw Error('Derived release changed route or rival numeric data');
  }
  return inventory;
}

export async function resolveEffectiveWorldRelease({ root = resolve(import.meta.dirname, '../..'), release = resolve(root, '.desktop/world-release'), repaired = resolve(root, '.desktop/world-release-repaired') } = {}) {
  try { await lstat(resolve(repaired, 'offline-world-inventory.json')); }
  catch (error) { if (error.code === 'ENOENT') return release; throw error; }
  await verifyRepairedWorldRelease({ root, release, out: repaired }); return repaired;
}

export async function repairWorldRelease({ root = resolve(import.meta.dirname, '../..'), release = resolve(root, '.desktop/world-release'), out = resolve(root, '.desktop/world-release-repaired'), log = console.log } = {}) {
  root = resolve(root); release = resolve(release); out = resolve(out);
  if (out === release || out.startsWith(release + '/')) throw Error('Derived output must be separate from the original export');
  const originalInventory = await verifyWorldRelease(release), sourceInventoryHash = hash(await readFile(resolve(release, 'offline-world-inventory.json')));
  const sourceRoot = await json(resolve(release, 'data/athens/manifest.json')), region = sourceRoot.regions?.find(r => r.id === 'megara');
  if (!region) throw Error('Original verified Megara region required');
  const manifestBytes = await readFile(resolve(release, region.manifestUrl.slice(1))), regional = JSON.parse(manifestBytes);
  const contract = megaraSurfaceRepairContract({ manifestBytes, expectedManifestHash: region.manifestSha256, mapBytes: await readFile(resolve(root, 'data/maps/megara/map.json')), contextBytes: await readFile(resolve(root, 'tools/maps/megara/raw/context.json')) });
  const repairToolHash = hash(await readFile(resolve(root, 'tools/world-gen/repair-megara-graph-surfaces.mjs')));
  const { packetRevision, regionalRevision: revision } = await repairRevisions({ schemaVersion: 1, contract: CONTRACT, originalManifestHash: region.manifestSha256, originalRevision: regional.revision, sourceInventoryHash, repairToolHash });
  const temp = await mkdtemp('/tmp/athens-world-repair.'); const stage = resolve(temp, 'release');
  await mkdir(stage); const files = new Map(originalInventory.files.map(entry => [entry.path, entry]));
  const store = async (path, bytes) => {
    path = path.replace(/^\//, ''); const target = resolve(stage, path); await mkdir(dirname(target), { recursive: true });
    await rm(target, { force: true }); // Break the task's hardlink before any write.
    await writeFile(target, bytes); files.set(path, { path, bytes: bytes.length, sha256: hash(bytes) });
  };
  try {
    for (const entry of originalInventory.files) {
      const target = resolve(stage, entry.path); await mkdir(dirname(target), { recursive: true });
      try { await link(resolve(release, entry.path), target); } catch (error) { if (error.code !== 'EXDEV') throw error; await copyFile(resolve(release, entry.path), target); }
    }
    const repaired = structuredClone(regional), changed = [];
    repaired.revision = revision;
    repaired.regions = [{ id: region.id, sourceWorld: regional.world, sourceRevision: revision }];
    repaired.sourceIdentities = [{ regionId: region.id, world: regional.world, revision: regional.revision }, { regionId: region.id, world: regional.world, revision: packetRevision }];
    for (const [key, entry] of Object.entries(regional.tiles)) {
      const result = repairMegaraGraphCell(await readFile(resolve(release, 'world/cells', entry.sha256 + '.bin.gz')), contract, { cell: key, newRevision: packetRevision });
      const target = repaired.tiles[key] = repairedCellDescriptor(entry, result, { regionId: region.id, world: regional.world, originalRevision: regional.revision, packetRevision });
      if (!result.changed) continue;
      await store(target.url, result.body); changed.push({ cell: key, before: entry.sha256, after: result.hash, edges: result.edges });
    }
    if (!changed.length) throw Error('Original export has no supported Megara graph surface words to repair');
    const regionalBytes = Buffer.from(JSON.stringify(repaired)), regionalHash = hash(regionalBytes), regionalURL = '/world/manifests/' + regionalHash + '.json';
    await store(regionalURL, regionalBytes);
    const derivedRoot = structuredClone(sourceRoot), derivedRegion = derivedRoot.regions.find(r => r.id === region.id);
    Object.assign(derivedRegion, { manifestUrl: regionalURL, manifestSha256: regionalHash, sourceRevision: revision });
    const { revision: oldRootRevision, ...rootContent } = derivedRoot; derivedRoot.revision = hash(Buffer.from(canonicalWorldJSON(rootContent)));
    const rootBytes = Buffer.from(JSON.stringify(derivedRoot)); await store('/data/athens/manifest.json', rootBytes); await store('/world/manifests/' + hash(rootBytes) + '.json', rootBytes);
    const sources = {};
    for (const region of derivedRoot.regions) sources[region.id] = { url: 'https://offline.invalid' + region.manifestUrl, manifest: await json(resolve(stage, region.manifestUrl.slice(1))) };
    const flat = composeWorldManifest(derivedRoot, sources); flat.tiles = Object.fromEntries(Object.entries(flat.tiles).map(([key, entry]) => [key, { ...entry, url: new URL(entry.url).pathname }]));
    await store('/world-flat.json', Buffer.from(JSON.stringify(flat)));
    const oldCatalogue = await json(resolve(release, 'catalogue.json')), originalFlat = await json(resolve(release, 'world-flat.json')), routes = [], routeProofs = [];
    for (const route of oldCatalogue.routes) {
      const unchangedSources = route.cells.every(key => originalFlat.tiles[key]?.sha256 === flat.tiles[key]?.sha256);
      let graphDigest = route.graphDigest;
      if (!unchangedSources) {
        const input = await readEmittedRouteWorld({ world: resolve(release, 'world-flat.json'), cells: resolve(release, 'world/cells'), keys: new Set(route.cells) });
        try {
          const originalDigest = await routeGraphDigest(route, input.roads.graph, input.manifest);
          if (originalDigest !== route.graphDigest) throw Error('Cannot replay original route graph digest: ' + route.id);
        } finally { input.roads.graph.dispose(); input.tiles.clear(); }
        const nextInput = await readEmittedRouteWorld({ world: resolve(stage, 'world-flat.json'), cells: resolve(stage, 'world/cells'), keys: new Set(route.cells) });
        try { graphDigest = await routeGraphDigest(route, nextInput.roads.graph, nextInput.manifest); }
        finally { nextInput.roads.graph.dispose(); nextInput.tiles.clear(); }
      }
      const next = await rebindCompiledWorld(route, flat.revision, graphDigest); routes.push(next);
      await store(`/data/routes/${next.id}.${next.routeHash}.json`, Buffer.from(canonicalJSON(next)));
      routeProofs.push({ id: route.id, geometryHash: route.geometryHash, originalRouteHash: route.routeHash, derivedRouteHash: next.routeHash, originalGraphDigest: route.graphDigest, derivedGraphDigest: graphDigest });
      log('Rebound exact route geometry: ' + route.id);
    }
    const config = { ...oldCatalogue.routeConfig, online: false, onlineAvailable: false, routes: routes.map(route => ({ id: route.id, routeHash: route.routeHash, geometryHash: route.geometryHash, worldSetRevision: route.worldSetRevision, url: `/data/routes/${route.id}.${route.routeHash}.json` })) };
    await store('/route-config.json', Buffer.from(JSON.stringify(config)));
    await store('/data/routes/index.json', Buffer.from(JSON.stringify({ schemaVersion: 1, routes: buildRouteCatalogue(routes).map(({ runtime, ...r }) => r) })));
    await store('/catalogue.json', Buffer.from(JSON.stringify({ routeConfig: config, routes, routeGrids: [], routeRoads: [] })));
    // Keep only the derived graph's dependency closure; old immutable objects stay
    // in the original source export, not duplicated into the final installed game.
    const needed = new Set(['catalogue.json', 'route-config.json', 'world-flat.json', 'data/athens/manifest.json', 'data/routes/index.json', 'world/manifests/' + hash(rootBytes) + '.json', ...derivedRoot.regions.map(r => r.manifestUrl.slice(1)), ...routes.map(c => `data/routes/${c.id}.${c.routeHash}.json`), ...Object.values(flat.tiles).map(e => e.url.slice(1)), ...(flat.regionalAssets || []).map(e => e.url.slice(1)), ...(flat.enrichments || []).map(e => e.url.slice(1))]);
    for (const path of [...files.keys()]) if (!needed.has(path)) { await rm(resolve(stage, path)); files.delete(path); }
    const inventory = { ...originalInventory, worldSetRevision: flat.revision, files: [...files.values()].sort((a, b) => a.path.localeCompare(b.path)), derivation: { schemaVersion: 1, contract: CONTRACT, sourceInventoryHash, originalWorldRevision: oldRootRevision, derivedWorldRevision: flat.revision, originalRegionalRevision: regional.revision, derivedRegionalRevision: revision, packetRevision, budgetContract: BUDGET_CONTRACT, repairToolHash, changed, routes: routeProofs } };
    delete inventory.bytes; await writeFile(resolve(stage, 'offline-world-inventory.json'), JSON.stringify(inventory));
    await verifyRepairedWorldRelease({ root, release, out: stage });
    await mkdir(dirname(out), { recursive: true }); const previous = resolve(temp, 'previous'); let exists = false;
    try { await lstat(out); exists = true; const previousInventory = await verifyWorldRelease(out); if (previousInventory.derivation?.sourceInventoryHash !== sourceInventoryHash || previousInventory.derivation?.contract !== CONTRACT) throw Error('Previous derived source binding mismatch'); await rename(out, previous); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    try { await rename(stage, out); } catch (error) { if (exists) await rename(previous, out); throw error; }
    log(`Derived offline world ready: ${out}; ${changed.length} repaired cells; ${flat.revision}`);
    return verifyRepairedWorldRelease({ root, release, out });
  } finally { await rm(temp, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await repairWorldRelease();
