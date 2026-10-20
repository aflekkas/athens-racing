// Guard: third-party / copyrighted reference media must never be committed.
// Such material (Street View, Google Maps/Earth captures, web images, photos,
// map tiles, unlicensed audio/video) belongs in `.reference/` (git-ignored,
// local-only). See `.reference/README.md` and AGENTS.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
const tracked = () => git(['ls-files', '-z']).split('\0').filter(Boolean);
const isIgnored = (path) => spawnSync('git', ['check-ignore', '-q', path], { cwd: root }).status === 0;

const MEDIA_RE = /\.(png|jpe?g|webp|gif|bmp|tiff?|mp4|mov|webm|mp3|wav|ogg)$/i;
const MARKER_RE = /street-?view|streetview|google-?maps/i;
const GOOGLE_RE = /© Google|Google Maps|Street View/i;

// Own-game captures whose source and licence are recorded, so the path-marker
// check lets them through. `psychiko-street-view.webp` is a game-pane crop
// (provenance in assets/changelog/README.md), not Street View imagery.
const PROVENANCE_ALLOWLIST = new Set(['assets/changelog/2026.10.16.1/psychiko-street-view.webp']);

test('`.reference/` is git-ignored but `.reference/README.md` is tracked', () => {
  const ignore = readFileSync(join(root, '.gitignore'), 'utf8');
  assert.match(ignore, /^\.reference\/\*$/m, '.gitignore must ignore .reference/ contents');
  assert.match(ignore, /^!\.reference\/README\.md$/m, '.gitignore must whitelist .reference/README.md');
  assert.ok(isIgnored('.reference/probe.webp'), '.reference/ must be ignored by git');
  assert.ok(!isIgnored('.reference/README.md'), '.reference/README.md must NOT be ignored');
  assert.ok(tracked().includes('.reference/README.md'), '.reference/README.md must be tracked');
});

test('no tracked media outside `.reference/` has a third-party marker in its path', () => {
  const bad = tracked().filter(
    (f) => !f.startsWith('.reference/') && !PROVENANCE_ALLOWLIST.has(f) && MEDIA_RE.test(f) && MARKER_RE.test(f),
  );
  assert.deepEqual(bad, [], `third-party reference media must live in .reference/, never committed elsewhere: ${bad.slice(0, 10).join(', ')}`);
});

test('no tracked media remains under `.scratch/psychiko-realism/` (moved to `.reference/`)', () => {
  const leftovers = tracked().filter((f) => f.startsWith('.scratch/psychiko-realism/') && MEDIA_RE.test(f));
  assert.deepEqual(leftovers, [], `reference images belong in .reference/psychiko-realism/ (local-only): ${leftovers.slice(0, 10).join(', ')}`);
});

test('no suspect media carries a Google caption or Google bytes', () => {
  const suspects = tracked().filter(
    (f) =>
      !f.startsWith('.reference/') &&
      !PROVENANCE_ALLOWLIST.has(f) &&
      MEDIA_RE.test(f) &&
      (f.startsWith('.scratch/psychiko-realism/') || MARKER_RE.test(f)),
  );
  const bad = [];
  for (const f of suspects) {
    const base = join(root, f).replace(MEDIA_RE, '');
    for (const ext of ['.txt', '.caption']) {
      const sib = base + ext;
      if (existsSync(sib) && GOOGLE_RE.test(readFileSync(sib, 'utf8'))) bad.push(`${f} (sibling ${ext} mentions Google/Street View)`);
    }
    const head = readHead(join(root, f));
    if (head !== null && GOOGLE_RE.test(head)) bad.push(`${f} (file bytes mention Google/Street View)`);
  }
  assert.deepEqual(bad, [], `third-party reference media must live in .reference/: ${bad.slice(0, 10).join('; ')}`);
});

/** First 64 KiB of a file as latin1, or null when unreadable. Keeps the check cheap. */
function readHead(abs) {
  try {
    return readFileSync(abs).subarray(0, 64 * 1024).toString('latin1');
  } catch {
    return null;
  }
}
