import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { extname } from 'node:path';
function attributes(tag) {
  return Object.fromEntries([...tag.matchAll(/([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)].map(([, key, a, b, c]) => [key.toLowerCase(), (a ?? b ?? c).replaceAll('&amp;', '&')]));
}
export function deployedModules(html, base, sw) {
  const page = new URL(base + '/'), tags = html.replace(/<!--[\s\S]*?-->/g, '');
  const meta = [...tags.matchAll(/<meta\b[^>]*>/gi)].map(m => attributes(m[0])).find(a => a.name === 'asr-build');
  const build = meta?.content;
  let release = null;
  if (build) {
    const manifest = sw?.match(/^\s*self\.ASR_RELEASE\s*=\s*(\{[^\n]*\})\s*;/)?.[1];
    assert.ok(manifest, '/sw.js release manifest missing'); release = JSON.parse(manifest);
    assert.equal(release.build, build, 'index.html and sw.js must describe the same release');
  }
  const modules = [...tags.matchAll(/<script\b[^>]*>/gi)].map(m => attributes(m[0])).filter(a => a.type === 'module' && a.src).map(a => {
    const url = new URL(a.src, page); assert.equal(url.origin, page.origin, `Module must be served by the deployment: ${url}`);
    const hash = release?.files[url.pathname];
    if (release) assert.match(hash || '', /^[a-f0-9]{16}$/, `${url.pathname} missing from sw.js release`);
    return { url, hash, immutable: hash ? new URL(`/_c/${hash}${extname(url.pathname).toLowerCase()}`, page) : null };
  });
  assert.ok(modules.length, 'index.html has no external module entry');
  return { build, modules, entry: modules.at(-1).url.pathname };
}
export async function checkDeployedEntry(base) {
  async function get(url) {
    const r = await fetch(url, { signal: AbortSignal.timeout(15000) }); assert.equal(r.status, 200, `${url} HTTP ${r.status}`);
    const bytes = new Uint8Array(await r.arrayBuffer()); assert.ok(bytes.byteLength, `${url} is empty`); return bytes;
  }
  const html = new TextDecoder().decode(await get(base + '/'));
  const hasBuild = [...html.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<meta\b[^>]*>/gi)].some(m => { const a = attributes(m[0]); return a.name === 'asr-build' && a.content; });
  const sw = hasBuild ? new TextDecoder().decode(await get(base + '/sw.js')) : null;
  const result = deployedModules(html, base, sw);
  for (const module of result.modules) for (const url of [module.url, module.immutable].filter(Boolean)) {
    const bytes = await get(url);
    if (module.hash) assert.equal(createHash('sha256').update(bytes).digest('hex').slice(0, 16), module.hash, `${url} does not match the release content hash`);
  }
  return { build: result.build, entry: result.entry };
}
