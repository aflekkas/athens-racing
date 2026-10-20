// Guard: third-party / copyrighted reference media must never be committed.
// Such material (Street View, Google Maps/Earth captures, web images, photos,
// map tiles, unlicensed audio/video) belongs in `.reference/` (git-ignored,
// local-only). See `.reference/README.md` and AGENTS.md.
//
// This test never shells out to git: the release train runs it inside a
// `git archive` copy with no `.git` directory, and an archive only contains
// tracked files, so walking the filesystem (minus .reference/, node_modules
// and .git) is equivalent to listing tracked files.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

/** All files under root, relative posix paths, skipping .git, node_modules and .reference/. */
function files() {
  const out = [];
  const walk = (dir, rel) => {
    for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
      if (entry.name === '.git' || entry.name === 'node_modules' || (dir === '.' && entry.name === '.reference')) continue;
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(join(dir, entry.name), relPath);
      else if (entry.isFile()) out.push(relPath);
    }
  };
  walk('.', '');
  return out;
}

/** The two .gitignore lines this guard relies on, and what they mean. */
function referenceIgnoreRules() {
  const lines = readFileSync(join(root, '.gitignore'), 'utf8').split('\n').map((l) => l.trim());
  return {
    ignoresContents: lines.includes('.reference/*'),
    whitelistsReadme: lines.includes('!.reference/README.md'),
  };
}

/** True when path falls under the ignored `.reference/` contents (README excepted). */
function isReferenceIgnored(path, rules = referenceIgnoreRules()) {
  return rules.ignoresContents && path.startsWith('.reference/') && path !== '.reference/README.md';
}

const MEDIA_RE = /\.(png|jpe?g|webp|gif|bmp|tiff?|mp4|mov|webm|mp3|wav|ogg)$/i;
const MARKER_RE = /street-?view|streetview|google-?maps/i;
const GOOGLE_RE = /© Google|Google Maps|Street View/i;

// Own-game captures whose source and licence are recorded, so the path-marker
// check lets them through. `psychiko-street-view.webp` is a game-pane crop
// (provenance in assets/changelog/README.md), not Street View imagery.
const PROVENANCE_ALLOWLIST = new Set(['assets/changelog/2026.10.16.1/psychiko-street-view.webp']);

test('`.reference/` is git-ignored but `.reference/README.md` is tracked', () => {
  const rules = referenceIgnoreRules();
  assert.ok(rules.ignoresContents, '.gitignore must ignore .reference/ contents (.reference/*)');
  assert.ok(rules.whitelistsReadme, '.gitignore must whitelist !.reference/README.md');
  assert.ok(isReferenceIgnored('.reference/probe.webp', rules), '.reference/ contents must be ignored');
  assert.ok(!isReferenceIgnored('.reference/README.md', rules), '.reference/README.md must NOT be ignored');
  assert.ok(existsSync(join(root, '.reference/README.md')), '.reference/README.md must exist (tracked)');
});

test('no tracked media outside `.reference/` has a third-party marker in its path', () => {
  const bad = files().filter((f) => !isReferenceIgnored(f) && !PROVENANCE_ALLOWLIST.has(f) && MEDIA_RE.test(f) && MARKER_RE.test(f));
  assert.deepEqual(bad, [], `third-party reference media must live in .reference/, never committed elsewhere: ${bad.slice(0, 10).join(', ')}`);
});

test('no tracked media remains under `.scratch/psychiko-realism/` (moved to `.reference/`)', () => {
  const leftovers = files().filter((f) => f.startsWith('.scratch/psychiko-realism/') && MEDIA_RE.test(f));
  assert.deepEqual(leftovers, [], `reference images belong in .reference/psychiko-realism/ (local-only): ${leftovers.slice(0, 10).join(', ')}`);
});

test('no tracked image has a sibling caption mentioning Google, Street View or Maps', () => {
  const bad = [];
  for (const f of files()) {
    if (isReferenceIgnored(f) || PROVENANCE_ALLOWLIST.has(f) || !MEDIA_RE.test(f)) continue;
    const base = join(root, f).replace(MEDIA_RE, '');
    for (const ext of ['.txt', '.caption']) {
      const sib = base + ext;
      if (existsSync(sib) && GOOGLE_RE.test(readFileSync(sib, 'utf8')))
        bad.push(`${f} (sibling ${ext} mentions Google/Street View/Maps)`);
    }
  }
  assert.deepEqual(bad, [], `third-party reference media must live in .reference/: ${bad.slice(0, 10).join('; ')}`);
});

test('no suspect media carries Google bytes', () => {
  const bad = [];
  for (const f of files()) {
    if (isReferenceIgnored(f) || PROVENANCE_ALLOWLIST.has(f) || !MEDIA_RE.test(f)) continue;
    if (!(f.startsWith('.scratch/psychiko-realism/') || f.startsWith('.scratch/riviera-rails/refs/') || MARKER_RE.test(f))) continue;
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
