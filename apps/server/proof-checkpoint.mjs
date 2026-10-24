import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFile, writeFile, mkdir, mkdtemp, rm, realpath, lstat, rename, readdir } from 'node:fs/promises';
import { resolve, dirname, basename, relative, sep } from 'node:path';
import { canonicalJSON } from '../../src/route-definition.js';
const OWNER = 'athens-desktop-physical-proof-v1';
const HEX = /^[a-f0-9]{64}$/;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const readJSON = async path => { const stat = await lstat(path); if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 128 * 1024) throw Error('Invalid proof checkpoint metadata.'); return JSON.parse(await readFile(path, 'utf8')); };

export async function physicalProofSemanticHash(root = resolve(import.meta.dirname, '../..')) {
  const hash = createHash('sha256'); hash.update(process.version + ':' + process.platform + ':' + process.arch + ':' + process.versions.openssl);
  const add = async path => { hash.update(relative(root, path).split(sep).join('/')); hash.update(await readFile(path)); };
  const scan = async dir => { for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) { const path = resolve(dir, entry.name); if (entry.isDirectory()) await scan(path); else if (entry.isFile() && /\.[cm]?js$/.test(entry.name) && !/\.test\./.test(entry.name)) await add(path); } };
  await add(resolve(root, 'package-lock.json'));
  await scan(resolve(root, 'src')); await scan(resolve(root, 'server'));
  for (const path of ['tools/strict-json-file.mjs', 'tools/build-world-recovery.mjs', 'tools/build-online-grids.mjs', 'tools/emitted-route-world.mjs', 'apps/server/recovery-worker.mjs', 'apps/server/recovery-pool.mjs', 'apps/server/proof-checkpoint.mjs', 'apps/server/recovery-spatial-index.mjs']) await add(resolve(root, path));
  return hash.digest('hex');
}

export function checkpointSignature(key, binding, result) {
  if (!HEX.test(key) || !HEX.test(binding)) throw Error('Invalid proof checkpoint binding.');
  return createHmac('sha256', Buffer.from(key, 'hex')).update(canonicalJSON({ binding, result })).digest('hex');
}
export function authenticateCheckpoint(record, key, binding) {
  if (!record || !HEX.test(record.signature || '')) throw Error('Proof checkpoint authentication failed.');
  const expected = checkpointSignature(key, binding, record.result);
  if (!timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(record.signature, 'hex'))) throw Error('Proof checkpoint authentication failed.');
  return record.result;
}

async function clearPublication(directory, owner, out) {
  const path = resolve(directory, '.publication.json'); let record;
  try { record = await readJSON(path); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  const value = authenticateCheckpoint(record, owner.key, owner.binding), prefix = basename(out) + '.staging-';
  if (value.out !== out || typeof value.stage !== 'string' || dirname(value.stage) !== dirname(out) || !basename(value.stage).startsWith(prefix) || !/^[a-f0-9-]{36}$/.test(basename(value.stage).slice(prefix.length))) throw Error('Refusing to clean an unowned publication staging path.');
  await rm(value.stage, { recursive: true, force: true }); await rm(path);
}

export async function openProofWorkspace({ out, sourceInventoryHash, semanticHash }) {
  if (!HEX.test(sourceInventoryHash) || !HEX.test(semanticHash)) throw Error('Invalid proof source/semantic identity.');
  out = resolve(out); const pointerPath = out + '.work.json', parent = process.platform === 'win32' ? dirname(out) : '/tmp';
  const binding = digest(canonicalJSON({ sourceInventoryHash, semanticHash }));
  await mkdir(dirname(out), { recursive: true });
  let directory, owner, pointer;
  try { pointer = await readJSON(pointerPath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (pointer) {
    if (typeof pointer.directory !== 'string' || !/^athens-online-proof\.[A-Za-z0-9]+$/.test(basename(pointer.directory)) || await realpath(dirname(pointer.directory)) !== await realpath(parent) || (await lstat(pointer.directory)).isSymbolicLink()) throw Error('Proof checkpoint directory is not task-owned.');
    const stored = await readJSON(resolve(pointer.directory, '.owner.json'));
    if (stored.owner !== OWNER || stored.out !== out || stored.id !== pointer.id || !HEX.test(stored.key || '') || stored.binding !== pointer.binding) throw Error('Proof checkpoint owner mismatch.');
    if (process.platform !== 'win32' && ((await lstat(pointer.directory)).mode & 0o077 || (await lstat(resolve(pointer.directory, '.owner.json'))).mode & 0o077 || (await lstat(pointerPath)).mode & 0o077)) throw Error('Proof checkpoint key/directory permissions are not private.');
    if (stored.binding === binding) { directory = pointer.directory; owner = stored; }
    else { await clearPublication(pointer.directory, stored, out); await rm(pointer.directory, { recursive: true, force: true }); await rm(pointerPath); }
  }
  if (!directory) {
    directory = await mkdtemp(resolve(parent, 'athens-online-proof.'));
    owner = { owner: OWNER, out, id: randomUUID(), key: randomBytes(32).toString('hex'), binding, sourceInventoryHash, semanticHash };
    await writeFile(resolve(directory, '.owner.json'), JSON.stringify(owner), { mode: 0o600 });
    const pointerTemp = pointerPath + '.' + owner.id + '.tmp';
    await writeFile(pointerTemp, JSON.stringify({ directory, id: owner.id, binding }), { mode: 0o600 }); await rename(pointerTemp, pointerPath);
  }
  await clearPublication(directory, owner, out);
  const candidate = resolve(directory, 'candidate'), records = resolve(directory, 'cells');
  for (const child of ['candidate', 'cells', 'candidate/world', 'candidate/world/recovery', 'candidate/data', 'candidate/data/routes']) {
    const path = resolve(directory, child);
    try { const info = await lstat(path); if (!info.isDirectory() || info.isSymbolicLink()) throw Error('Proof checkpoint output directory is not task-owned.'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    await mkdir(path, { recursive: true });
  }
  return {
    directory, candidate, records, binding, key: owner.key,
    publicationStage: async () => {
      const result = { out, stage: out + '.staging-' + randomUUID() };
      await writeFile(resolve(directory, '.publication.json'), JSON.stringify({ result, signature: checkpointSignature(owner.key, owner.binding, result) }), { mode: 0o600 });
      return result.stage;
    },
    clearPublication: () => clearPublication(directory, owner, out),
    cleanup: async () => {
      const pointer = await readJSON(pointerPath), currentOwner = await readJSON(resolve(directory, '.owner.json'));
      if (pointer.id !== owner.id || pointer.directory !== directory || currentOwner.id !== owner.id || currentOwner.key !== owner.key) throw Error('Refusing to clean a different proof checkpoint owner.');
      await clearPublication(directory, owner, out);
      await rm(directory, { recursive: true, force: true }); await rm(pointerPath);
    }
  };
}
