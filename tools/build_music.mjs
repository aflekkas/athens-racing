#!/usr/bin/env node
// Rebuild the radio playlist in assets/audio/music from tracks.json. Requires ffmpeg.
// Usage: node tools/build_music.mjs [--cache /tmp/paraliaki-music]
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEST = join(ROOT, 'assets/audio/music');
const ci = process.argv.indexOf('--cache');
const CACHE = ci > 0 ? process.argv[ci + 1] : join(ROOT, '.cache/music');
mkdirSync(CACHE, { recursive: true });
const { tracks } = JSON.parse(readFileSync(join(DEST, 'tracks.json'), 'utf8'));
for (const t of tracks) {
  const src = join(CACHE, t.file);
  if (!existsSync(src)) {
    console.log('Downloading', t.title);
    const r = await fetch(t.downloadUrl, { headers: { Referer: t.pageUrl } });
    if (!r.ok) throw new Error(`${r.status} ${t.downloadUrl}`);
    writeFileSync(src, Buffer.from(await r.arrayBuffer()));
  }
  // Static gain to -16 LUFS integrated (no dynamic loudnorm pumping), true-peak safe.
  const m = spawnSync('ffmpeg', ['-nostats', '-i', src, '-af', 'loudnorm=print_format=json', '-f', 'null', '-'], { encoding: 'utf8' }).stderr;
  const stats = JSON.parse(m.slice(m.lastIndexOf('{')));
  const gain = Math.min(-16 - +stats.input_i, -1 - +stats.input_tp);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', src, '-map_metadata', '-1', '-af', `volume=${gain.toFixed(2)}dB`, '-ar', '44100', '-ac', '2', '-c:a', 'libmp3lame', '-b:a', '128k', join(DEST, t.file)]);
  console.log(t.file, `${gain.toFixed(1)} dB`);
}
writeFileSync(join(DEST, 'CREDITS.txt'), `PARALIAKI RACING — RADIO\n\nLevelled to -16 LUFS and re-encoded; otherwise unchanged.\n\n${tracks.map((t) => `${t.file}\n  ${t.credit}\n  ${t.license}: ${t.licenseUrl}\n  ${t.pageUrl}`).join('\n')}\n`);
