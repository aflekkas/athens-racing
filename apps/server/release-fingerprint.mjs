import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

// Native checkouts can contain CRLF on Windows. JavaScript source identity
// ignores that checkout representation; immutable game/data bytes do not.
export const executableText = bytes => bytes.toString('utf8').replace(/\r\n/g, '\n');
export async function runtimeReleaseHash({ gameRoot, codeRoot }) {
  const hash = createHash('sha256');
  const source = async (path, label, normalize) => { const bytes = await readFile(path), value = normalize ? Buffer.from(executableText(bytes)) : bytes; hash.update(JSON.stringify([label, value.byteLength])); hash.update(value); };
  const scan = async (dir, prefix, normalize) => {
    for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
      const path = resolve(dir, entry.name), label = prefix + '/' + entry.name;
      if (entry.isDirectory()) await scan(path, label, normalize);
      else if (entry.isFile() && /\.(js|mjs|css)$/.test(entry.name) && !/\.test\.[cm]?js$/.test(entry.name)) await source(path, label, normalize);
    }
  };
  // The game directory is one shared artifact across all native installers.
  await scan(resolve(gameRoot, 'src'), 'src', false);
  await scan(resolve(codeRoot, 'server'), 'server', true);
  await scan(resolve(codeRoot, 'packages/contracts'), 'contracts', true);
  for (const name of ['runtime.mjs', 'release-fingerprint.mjs']) await source(resolve(codeRoot, 'apps/server', name), 'desktop/' + name, true);
  for (const name of ['desktop-manifest.json', 'catalogue.json', 'data/athens/manifest.json']) {
    try { await source(resolve(gameRoot, name), name, false); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return hash.digest('hex');
}
