// Requires KTX-Software 4.4.2 (TOKTX=/path/to/toktx) and sharp (SHARP_MODULE optional).
// Generated files are checked in: production builds need no native encoder. Rebuild after source changes.
import { readFile, writeFile, mkdir, readdir, mkdtemp, rm, copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
export async function buildTextures(root) {
  const dir = resolve(root, 'assets/tex/ktx2'); await mkdir(dir, { recursive: true });
  let previous = {}; try { previous = (await import(pathToFileURL(resolve(root, 'src/texture-manifest.js')))).TEXTURE_MANIFEST; } catch {}
  const { textureSources } = await import(pathToFileURL(resolve(root, 'src/tex.js')));
  const sources = textureSources();
  sources.push('assets/brand-badges/atlas.svg');
  const manifest = {}, stage = await mkdtemp(resolve(tmpdir(), 'asr-ktx-build-'));
  try {
    let sharp;
    for (const source of sources) {
      const input = await readFile(resolve(root, source)), badge = source.endsWith('.svg'), linear = /_nor\.|_arm\.|waternormals/.test(source);
      const mode = badge || /_nor\.|waternormals/.test(source) ? 'uastc' : 'etc1s';
      const options = ['--t2', '--genmipmap', '--lower_left_maps_to_s0t0', '--assign_oetf', linear ? 'linear' : 'srgb', '--encode', mode, ...(mode === 'uastc' ? ['--uastc_quality', '3', '--uastc_rdo_l', badge ? '0.25' : '1.5', '--zcmp', '18'] : ['--qlevel', '255', '--clevel', '2']), '--threads', '2'];
      const hash = createHash('sha256').update('toktx-4.4.2-rdo1.5-v2').update(input).update(JSON.stringify(options)).digest('hex');
      const key = '/' + source;
      let cached;
      if (previous[key]?.sourceHash === hash) {
        try {
          const bytes = await readFile(resolve(root, previous[key].url.slice(1)));
          const digest = createHash('sha256').update(bytes).digest('hex').slice(0,16);
          if (bytes.length === previous[key].bytes && previous[key].url.includes(digest)) cached = bytes;
        } catch (e) { if (e.code !== 'ENOENT') throw e; }
      }
      if (cached) {
        const entry = { ...previous[key] }, bytes = cached;
        const digest = createHash('sha256').update(bytes).digest('hex').slice(0,16), canonical = `${source.split('/').pop().split('.')[0]}-${digest}.ktx2`;
        await writeFile(resolve(dir, canonical), bytes); entry.url = '/assets/tex/ktx2/' + canonical;
        entry.enabled = badge || (bytes.length - input.length <= 128 * 1024 && (bytes.readUInt32LE(20) >= 1024 || bytes.length <= input.length * 1.25));
        manifest[key] = entry; continue;
      }
      sharp ||= (await import(process.env.SHARP_MODULE || 'sharp')).default;
      const image = sharp(input), dimensions = await image.metadata(), stats = await image.clone().resize(16, 16).ensureAlpha().raw().toBuffer();
      let r = 0, g = 0, b = 0, n = 0;
      for (let i = 0; i < stats.length; i += 4) if (stats[i+3] > 128) { r += stats[i]; g += stats[i+1]; b += stats[i+2]; n++; }
      const average = n ? [r/n/255, g/n/255, b/n/255] : null;
      const png = resolve(stage, 'input.png'), file = `${source.split('/').pop().split('.')[0]}-${hash.slice(0,16)}.ktx2`, output = resolve(dir, file);
      await image.png().toFile(png);
      execFileSync(process.env.TOKTX || 'toktx', [...options, output, png], { stdio: 'inherit' });
      const encoded = await readFile(output), bytes = encoded.length, canonical = `${source.split('/').pop().split('.')[0]}-${createHash('sha256').update(encoded).digest('hex').slice(0,16)}.ktx2`;
      await writeFile(resolve(dir, canonical), encoded); if (bytes > 25 * 1024 * 1024) throw new Error('KTX2 exceeds 25 MiB');
      manifest[key] = { url: '/assets/tex/ktx2/' + canonical, sourceHash: hash, bytes, mode, sharp: badge, average, enabled: badge || (bytes - input.length <= 128 * 1024 && (dimensions.width >= 1024 || bytes <= input.length * 1.25)) };
      console.log(`${source}: ${input.length} -> ${bytes} bytes (${mode})`);
    }
    const active = new Set(Object.values(manifest).map(e => e.url.split('/').pop()));
    for (const file of await readdir(dir)) if (file.endsWith('.ktx2') && !active.has(file)) await rm(resolve(dir, file));
    const vendor = resolve(root, 'assets/codecs/basis'); await mkdir(vendor, { recursive: true });
    const js = await readFile(resolve(root, 'node_modules/three/examples/jsm/libs/basis/basis_transcoder.js'));
    const wasm = await readFile(resolve(root, 'node_modules/three/examples/jsm/libs/basis/basis_transcoder.wasm'));
    const version = createHash('sha256').update(js).update(wasm).digest('hex').slice(0,16), path = '/assets/codecs/basis/' + version + '/';
    await mkdir(resolve(root, path.slice(1)), { recursive: true });
    await writeFile(resolve(root, path.slice(1), 'basis_transcoder.js'), js);
    await writeFile(resolve(root, path.slice(1), 'basis_transcoder.wasm'), wasm);
    await copyFile(resolve(root, 'node_modules/three/examples/jsm/libs/basis/README.md'), resolve(vendor, 'README.md'));
    for (const name of ['basis_transcoder.js', 'basis_transcoder.wasm']) await rm(resolve(vendor, name), { force: true });
    for (const file of await readdir(vendor, { withFileTypes: true })) if (file.isDirectory() && file.name !== version) await rm(resolve(vendor, file.name), { recursive: true });
    await writeFile(resolve(root, 'src/texture-manifest.js'), '// Generated by tools/build-textures.mjs. Do not edit.\nexport const BASIS_TRANSCODER_PATH = ' + JSON.stringify(path) + ';\nexport const TEXTURE_MANIFEST = ' + JSON.stringify(manifest, null, 2) + ';\n');
    return manifest;
  } finally { await rm(stage, { recursive: true, force: true }); }
}
if (process.argv[1] === new URL(import.meta.url).pathname) await buildTextures(resolve(import.meta.dirname, '..'));
