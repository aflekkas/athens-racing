#!/usr/bin/env node
// Rebuild the world sounds (ambience beds, traffic loops, impacts) from their CC0 sources. Requires ffmpeg.
// Usage: node tools/build_world_audio.mjs [--cache /tmp/paraliaki-world-audio]
// Sources, trims and filters: assets/audio/world/sources.json. Writes the MP3s, sounds.json (loop lengths for
// the game) and CREDITS.txt next to it.
//  loop: crossfaded into a seamless loop; the game loops exactly `frames` frames, so MP3 padding never plays
//  bed:  long non-looping texture the game plays windows of (gulls)
//  shot: one-shot, peak normalised
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEST = join(ROOT, 'assets/audio/world');
const SR = 44100;
const ci = process.argv.indexOf('--cache');
const CACHE = ci > 0 ? process.argv[ci + 1] : join(ROOT, '.cache/world-audio');
mkdirSync(CACHE, { recursive: true });
const sha = (b) => createHash('sha256').update(b).digest('hex');

const manifest = JSON.parse(readFileSync(join(DEST, 'sources.json'), 'utf8'));
for (const [id, s] of Object.entries(manifest.sources)) {
  const path = join(CACHE, id + '.mp3');
  if (!existsSync(path)) {
    console.log('Downloading', id, s.title);
    const r = await fetch(s.downloadUrl);
    if (!r.ok) throw new Error(`${r.status} ${s.downloadUrl}`);
    writeFileSync(path, Buffer.from(await r.arrayBuffer()));
  }
  const digest = sha(readFileSync(path));
  if (s.sha256 && s.sha256 !== digest) throw new Error('Source checksum mismatch: ' + id);
  s.sha256 = digest; s.licenseUrl = 'https://creativecommons.org/publicdomain/zero/1.0/';
}

/** decode a trimmed, filtered part to planar Float32Arrays */
function decode(part, channels) {
  const filters = [part.filter, `aresample=${SR}`].filter(Boolean).join(',');
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-ss', String(part.trim[0]), '-to', String(part.trim[1]), '-i', join(CACHE, part.source + '.mp3'),
    '-af', filters, '-ac', String(channels), '-f', 'f32le', '-'], { maxBuffer: 1 << 30 });
  const x = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4), n = x.length / channels;
  return Array.from({ length: channels }, (_, c) => { const d = new Float32Array(n); for (let i = 0; i < n; i++) d[i] = x[i * channels + c] * (part.gain ?? 1); return d; });
}

const rmsOf = (ch) => { let s = 0, n = 0; for (const d of ch) for (const v of d) { s += v * v; n++; } return Math.sqrt(s / n); };
const peakOf = (ch) => { let p = 0; for (const d of ch) for (const v of d) p = Math.max(p, Math.abs(v)); return p; };

const out = {};
for (const a of manifest.assets) {
  const C = a.channels;
  const parts = a.parts.map((p) => decode(p, C));
  const n = Math.min(...parts.map((p) => p[0].length));
  let ch = Array.from({ length: C }, (_, c) => { const d = new Float32Array(n); for (const p of parts) for (let i = 0; i < n; i++) d[i] += p[c][i]; return d; });
  for (const d of ch) { let m = 0; for (const v of d) m += v; m /= d.length; for (let i = 0; i < d.length; i++) d[i] -= m; }
  let frames = n;
  if (a.kind === 'loop') {
    // Fold the last X seconds over the first X (equal power: the material is uncorrelated noise / texture).
    const X = Math.round((a.xfade ?? 1.5) * SR); frames = n - X;
    ch = ch.map((d) => { const o = d.slice(0, frames); for (let i = 0; i < X; i++) { const t = (i + 0.5) / X; o[i] = d[i] * Math.sin(t * Math.PI / 2) + d[frames + i] * Math.cos(t * Math.PI / 2); } return o; });
  } else {
    const fi = Math.round(0.004 * SR), fo = Math.min(Math.round(0.25 * SR), Math.floor(n * 0.2));
    for (const d of ch) { for (let i = 0; i < fi; i++) d[i] *= i / fi; for (let i = 0; i < fo; i++) d[n - 1 - i] *= i / fo; }
  }
  const k = a.peak ? a.peak / peakOf(ch) : Math.min(a.rms / rmsOf(ch), 0.9 / peakOf(ch));
  for (const d of ch) for (let i = 0; i < d.length; i++) d[i] *= k;
  // Loops carry a short guard copy of their start, so the loop region never touches the encoder padding.
  const guard = a.kind === 'loop' ? Math.round(0.3 * SR) : 0, total = frames + guard;
  const inter = new Float32Array(total * C);
  for (let i = 0; i < total; i++) for (let c = 0; c < C; c++) inter[i * C + c] = ch[c][i % frames];
  const file = join(DEST, a.file);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'f32le', '-ar', String(SR), '-ac', String(C), '-i', '-', '-c:a', 'libmp3lame', '-b:a', C === 2 ? '112k' : '80k', file],
    { input: Buffer.from(inter.buffer) });
  a.frames = frames; a.duration = +(frames / SR).toFixed(4); a.sha256 = sha(readFileSync(file));
  out[a.file.replace(/\.mp3$/, '')] = { file: a.file, kind: a.kind, frames, sampleRate: SR, channels: C };
  console.log(a.file.padEnd(20), a.kind.padEnd(5), a.duration + ' s', `gain ${(20 * Math.log10(k)).toFixed(1)} dB`);
}
writeFileSync(join(DEST, 'sources.json'), JSON.stringify(manifest, null, 2) + '\n');
writeFileSync(join(DEST, 'sounds.json'), JSON.stringify(out, null, 1) + '\n');
const used = new Map();
for (const a of manifest.assets) for (const p of a.parts) used.set(p.source, [...(used.get(p.source) || []), a.file]);
writeFileSync(join(DEST, 'CREDITS.txt'), `PARALIAKI RACING — WORLD SOUNDS

Edited field recordings from Freesound (public HQ previews). All are CC0 1.0
(public domain): https://creativecommons.org/publicdomain/zero/1.0/
Changes: trimmed, filtered, mixed, level matched, looped with crossfades.
Rebuild with tools/build_world_audio.mjs; sources.json lists trims and checksums.

${[...used].map(([id, files]) => { const s = manifest.sources[id]; return `${files.join(', ')}\n  "${s.title}" by ${s.author}\n  ${s.pageUrl}`; }).join('\n')}
`);
