// RELEASE NOTES: the pure logic shared by the deploy build (tools/release-data.mjs) and the game (src/ui/release-screens.js).
// No DOM and no Node imports, so tools/release-notes.test.mjs runs it directly.
//
// Version scheme:  YYYY.MM.DD.N  (the release date, then a counter for that day: 2026.10.15.2 is the second release of
// 15 Oct 2026). CHANGELOG.md declares it, one `## <version>` section per release; the newest section is the build's version.
// tools/prepare-deploy.mjs adds the short git SHA and the build id, and writes them into index.html and /release.json.
// A build without them (local dev) is DEV_VERSION.

export const DEV_VERSION = 'dev';
export const SEEN_KEY = 'paraliaki.releaseSeen';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n, w = 2) => String(n).padStart(w, '0');
const validDay = (y, m, d) => { const t = new Date(Date.UTC(y, m - 1, d)); return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d; };

/** '2026-10-15' (or a Date, read in UTC) + counter -> '2026.10.15.2' */
export function formatVersion(date, counter) {
  const iso = date instanceof Date ? date.toISOString().slice(0, 10) : String(date);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m || !validDay(+m[1], +m[2], +m[3])) throw new Error(`Not a calendar date (YYYY-MM-DD): ${iso}`);
  if (!Number.isInteger(counter) || counter < 1) throw new Error(`Release counter must be a whole number from 1: ${counter}`);
  return `${m[1]}.${m[2]}.${m[3]}.${counter}`;
}
/** '2026.10.15.2' -> { date: '2026-10-15', counter: 2 }, or null when it is not a version (including 'dev') */
export function parseVersion(version) {
  const m = /^(\d{4})\.(\d{2})\.(\d{2})\.([1-9]\d*)$/.exec(String(version ?? ''));
  return m && validDay(+m[1], +m[2], +m[3]) ? { date: `${m[1]}-${m[2]}-${m[3]}`, counter: +m[4] } : null;
}
/** negative / 0 / positive like a sort comparator; both must be versions */
export function compareVersions(a, b) {
  const x = parseVersion(a), y = parseVersion(b);
  if (!x || !y) throw new Error(`Cannot compare ${a} with ${b}`);
  return x.date < y.date ? -1 : x.date > y.date ? 1 : x.counter - y.counter;
}
/** '2026-10-15' -> '15 Oct 2026' (fixed English month names, so it reads the same in every locale) */
export function formatDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? ''));
  return m ? `${+m[3]} ${MONTHS[+m[2] - 1]} ${m[1]}` : '';
}
/** the label a player sees: 'V2026.10.15.2', or 'DEV' */
export const versionLabel = (version) => parseVersion(version) ? 'V' + version : 'DEV';

/**
 * CHANGELOG.md -> { unreleased: string[], releases: [{ version, date, items: string[] }] }, newest first.
 * Strict on purpose (it runs at deploy time, so a typo fails the build instead of silently dropping notes):
 * only `## Unreleased` or `## <version>[ — <date>]` headings, bullets and local Markdown photos below them, versions in descending order,
 * a heading's date must match its version, and every release needs at least one bullet.
 * Text before the first `##` and <!-- comments --> are ignored. An indented line continues the bullet above it.
 */
export function parseChangelog(text) {
  const src = String(text).replace(/\r\n?/g, '\n').replace(/<!--[\s\S]*?-->/g, (c) => c.replace(/[^\n]/g, ''));
  const out = { unreleased: [], unreleasedImages: [], releases: [] };
  let section = null, item = null, lastItem = null, unreleasedSeen = false;
  const fail = (n, msg) => { throw new Error(`CHANGELOG.md:${n}: ${msg}`); };
  const close = (n) => {
    if (section?.version && !section.items.length) fail(n, `release ${section.version} has no bullets`);
    section = item = lastItem = null;
  };
  const lines = src.split('\n');
  lines.forEach((raw, i) => {
    const n = i + 1, line = raw.replace(/\s+$/, '');
    const head = /^##\s+(.*)$/.exec(line);
    if (head) {
      close(n);
      const h = /^(Unreleased|[\d.]+?)(?:\s+[—–-]+\s+(\d{4}-\d{2}-\d{2}))?$/i.exec(head[1].trim());
      if (!h) fail(n, `heading must be "Unreleased" or "YYYY.MM.DD.N [— YYYY-MM-DD]": ${head[1]}`);
      if (/^unreleased$/i.test(h[1])) {
        if (out.releases.length) fail(n, 'Unreleased must come first');
        if (unreleasedSeen) fail(n, 'only one Unreleased section is allowed');
        unreleasedSeen = true;
        if (h[2]) fail(n, 'Unreleased has no date');
        section = { items: out.unreleased, images: out.unreleasedImages };
      } else {
        const v = parseVersion(h[1]);
        if (!v) fail(n, `not a version (YYYY.MM.DD.N): ${h[1]}`);
        if (h[2] && h[2] !== v.date) fail(n, `heading date ${h[2]} does not match version ${h[1]}`);
        const prev = out.releases.at(-1);
        if (prev && compareVersions(prev.version, h[1]) <= 0) fail(n, `${h[1]} must be older than ${prev.version} (newest first, no duplicates)`);
        section = { version: h[1], date: v.date, items: [], images: [] };
        out.releases.push(section);
      }
      return;
    }
    if (!section || !line.trim()) { item = null; return; }
    const picture = /^(\s*)!\[([^\]]*)\]\(([^()\s]+)(?:\s+"([^"]*)")?\)$/.exec(line);
    if (picture) {
      const [, indent, alt, src, caption] = picture;
      if (!alt.trim()) fail(n, 'images need meaningful alt text');
      const path = /^assets\/changelog\/([\d.]+)\/[a-zA-Z0-9_-]+\.webp$/.exec(src);
      if (!path || !parseVersion(path[1])) fail(n, 'image path must be assets/changelog/YYYY.MM.DD.N/name.webp');
      if (indent && lastItem == null) fail(n, 'an indented image must follow a bullet');
      section.images.push({ src, alt: alt.trim(), caption: caption?.trim() || alt.trim(), item: indent ? lastItem : null });
      return;
    }
    const bullet = /^[-*]\s+(\S.*)$/.exec(line);
    if (bullet) { section.items.push(bullet[1].trim()); item = lastItem = section.items.length - 1; return; }
    if (/^\s+\S/.test(line) && item != null) { section.items[item] += ' ' + line.trim(); return; }
    if (/^#\s/.test(line)) return;
    fail(n, `only "- " bullets and Markdown images are allowed under a release heading: ${line.trim().slice(0, 60)}`);
  });
  close(lines.length + 1);
  return out;
}

// ---------------------------------------------------------------- the one-time "What's new" card
/** keys that only exist once someone has actually played (not the markers settings.js writes at import) */
const PLAY_KEYS = /^paraliaki\.(?:(?:settings|graphics|car|car\.selection|raceSetup|personalBests\.v1)$|(?:best|events|ghost|input|paint)\.|youtube)/;
const store = (s) => { try { return s ?? globalThis.localStorage ?? null; } catch { return null; } };

/** true when this browser already holds saved play data (settings, a chosen car, records...). Call it at startup, before
 *  this session writes anything, so a brand-new player is not mistaken for a returning one. */
export function hasPriorPlay(storage) {
  const s = store(storage);
  try { for (let i = 0; i < (s?.length ?? 0); i++) if (PLAY_KEYS.test(s.key(i) || '')) return true; } catch { /* storage blocked */ }
  return false;
}
/** the last version whose notes were shown (or skipped for a new player); null if none or unreadable */
export function readSeen(storage) {
  try { const v = store(storage)?.getItem(SEEN_KEY); return parseVersion(v) ? v : null; } catch { return null; }
}
export function markSeen(storage, version) {
  if (!parseVersion(version)) return false;
  try { const s = store(storage); if (!s) return false; s.setItem(SEEN_KEY, version); return true; } catch { return false; }
}
/**
 * What the card does for this launch:
 *   'none'   nothing: dev build, already seen (or a newer version was seen: a rollback never nags), or mid-race
 *   'record' mark this version seen silently: a brand-new player's very first launch, or a release with nothing to show
 *   'show'   show the latest section once
 * `racing` defers everything (nothing is recorded) so the card can never appear during a race.
 */
export function whatsNewDecision({ version, seen = null, priorPlay = false, racing = false, hasNotes = true } = {}) {
  if (!parseVersion(version) || racing) return 'none';
  if (parseVersion(seen) && compareVersions(version, seen) <= 0) return 'none';
  if (!parseVersion(seen) && !priorPlay) return 'record';
  return hasNotes ? 'show' : 'record';
}
