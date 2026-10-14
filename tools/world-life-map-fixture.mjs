import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadMap } from '../src/map.js';
export async function worldLifeMap(id) {
  const root = resolve(import.meta.dirname, '..'), oldFetch = globalThis.fetch;
  globalThis.fetch = async path => { try { return new Response(await readFile(resolve(root, String(path)))); } catch { return new Response('', { status: 404 }); } };
  try { return await loadMap(null, './', id, { preload: false }); } finally { globalThis.fetch = oldFetch; }
}
