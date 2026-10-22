// Version scheme, CHANGELOG.md parsing and the show-once "What's new" logic (src/release-notes.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DEV_VERSION, SEEN_KEY, formatVersion, parseVersion, compareVersions, formatDate, versionLabel, parseChangelog,
  hasPriorPlay, readSeen, markSeen, whatsNewDecision } from '../src/release-notes.js';

const root = resolve(import.meta.dirname, '..');
class Storage { // the bits of localStorage the logic touches
  constructor(items = {}) { this.items = new Map(Object.entries(items)); }
  get length() { return this.items.size; }
  key(i) { return [...this.items.keys()][i] ?? null; }
  getItem(k) { return this.items.has(k) ? this.items.get(k) : null; }
  setItem(k, v) { this.items.set(k, String(v)); }
}

test('versions are YYYY.MM.DD.N: the date plus a counter for that day', () => {
  assert.equal(formatVersion('2026-10-15', 2), '2026.10.15.2');
  assert.equal(formatVersion(new Date('2026-01-05T23:59:00Z'), 1), '2026.01.05.1');
  assert.equal(formatVersion('2026-10-15', 12), '2026.10.15.12');
  for (const bad of ['2026-02-30', '2026-13-01', '15-10-2026', '']) assert.throws(() => formatVersion(bad, 1), /calendar date/, bad);
  for (const bad of [0, -1, 1.5, '2', NaN]) assert.throws(() => formatVersion('2026-10-15', bad), /counter/, String(bad));
  assert.deepEqual(parseVersion('2026.10.15.2'), { date: '2026-10-15', counter: 2 });
  for (const bad of [DEV_VERSION, null, undefined, '2026.10.15', '2026.10.15.0', '2026.13.01.1', '2026.02.30.1', 'v2026.10.15.1', '2026.10.15.1-rc']) assert.equal(parseVersion(bad), null, String(bad));
  assert.equal(parseVersion(formatVersion('2028-02-29', 3)).date, '2028-02-29', 'leap day');
});

test('versions order by date, then by the counter as a number', () => {
  const sorted = ['2026.10.15.10', '2026.10.14.7', '2026.10.15.9', '2027.01.01.1', '2026.10.15.2'].sort(compareVersions);
  assert.deepEqual(sorted, ['2026.10.14.7', '2026.10.15.2', '2026.10.15.9', '2026.10.15.10', '2027.01.01.1']);
  assert.equal(compareVersions('2026.10.15.2', '2026.10.15.2'), 0);
  assert.throws(() => compareVersions('dev', '2026.10.15.2'));
});

test('labels and dates read the same in every locale', () => {
  assert.equal(versionLabel('2026.10.15.2'), 'V2026.10.15.2');
  assert.equal(versionLabel(DEV_VERSION), 'DEV');
  assert.equal(versionLabel(undefined), 'DEV');
  assert.equal(formatDate('2026-10-05'), '5 Oct 2026');
  assert.equal(formatDate('2026-01-31'), '31 Jan 2026');
  assert.equal(formatDate('nope'), '');
});

const SAMPLE = `# Release notes
Intro prose is ignored.

## Unreleased
<!-- guidance -->
- Not shipped yet.

## 2026.10.15.2 — 2026-10-15
- First line
  continued on a second line.
* Star bullet

## 2026.10.15.1
- Only a version, no date

## 2026.10.14.1 - 2026-10-14
- Hyphen date separator
`;

test('parseChangelog reads sections newest first, ignoring comments and prose', () => {
  const log = parseChangelog(SAMPLE);
  assert.deepEqual(log.unreleased, ['Not shipped yet.']);
  assert.deepEqual(log.releases.map((r) => [r.version, r.date, r.items.length]), [['2026.10.15.2', '2026-10-15', 2], ['2026.10.15.1', '2026-10-15', 1], ['2026.10.14.1', '2026-10-14', 1]]);
  assert.equal(log.releases[0].items[0], 'First line continued on a second line.');
  assert.equal(log.releases[0].items[1], 'Star bullet');
  assert.deepEqual(parseChangelog('## Unreleased\n\n## 2026.10.15.1\n- x').unreleased, [], 'an empty Unreleased is fine');
  assert.deepEqual(parseChangelog('## 2026.10.15.1\r\n- crlf\r\n').releases[0].items, ['crlf']);
});

test('parseChangelog fails the build on mistakes instead of dropping notes', () => {
  const bad = (md, re) => assert.throws(() => parseChangelog(md), re, md);
  bad('## Unreleased\n- a\n## Unreleased\n- b', /only one Unreleased/);
  bad('## Next week\n- x', /heading must be/);
  bad('## 2026.10.15\n- x', /not a version/);
  bad('## 2026.02.30.1\n- x', /not a version/);
  bad('## 2026.10.15.1 — 2026-10-16\n- x', /does not match/);
  bad('## 2026.10.15.1\n- a\n## 2026.10.15.2\n- b', /older than/);
  bad('## 2026.10.15.1\n- a\n## 2026.10.15.1\n- b', /older than/);
  bad('## 2026.10.15.1\n', /no bullets/);
  bad('## 2026.10.15.1\n- a\n## 2026.10.14.1\n\nJust a paragraph.\n', /bullets/);
  bad('## 2026.10.15.1\nStray text\n- a', /bullets/);
  bad('## 2026.10.15.1\n- a\n## Unreleased\n- b', /Unreleased must come first/);
  bad('## Unreleased — 2026-10-15\n- b', /no date/);
});

test('the real CHANGELOG.md is valid, newest first, and written for players', () => {
  const md = readFileSync(resolve(root, 'CHANGELOG.md'), 'utf8'), log = parseChangelog(md);
  assert.ok(md.indexOf('## Unreleased') > 0 && md.indexOf('## Unreleased') < md.indexOf('## 2026.'), 'an Unreleased section sits above the releases');
  const versions = log.releases.map((r) => r.version);
  for (const v of ['2026.10.14.1', '2026.10.15.1', '2026.10.15.2', '2026.10.15.3']) assert.ok(versions.includes(v), v);
  assert.deepEqual([...versions].sort((a, b) => compareVersions(b, a)), versions);
  for (const text of [...log.unreleased, ...log.releases.flatMap((r) => r.items)]) {
    assert.ok(text.length <= 170, `short bullets (${text.length}): ${text}`);
    assert.ok(!/`|\b[0-9a-f]{7,40}\b|\b(?:src|tools|server|worker|assets)\/|\.m?js\b|\bAPI\b|protocol/i.test(text), `no internal jargon: ${text}`);
    assert.match(text, /[.!?]$/, `ends like a sentence: ${text}`);
  }
  for (const text of log.unreleased) {
    if (!/\btrim/i.test(text)) continue;
    assert.match(text, /top trim|no trim/i, `only the one-car-per-model removal note may mention trims: ${text}`);
  }
  const current = log.releases[0]; // Unreleased is excluded from the player-facing release data.
  assert.ok(!/\btrims?\b/i.test(JSON.stringify({items: current.items, images: current.images})), 'current shipped notes and images do not advertise the removed trim picker');
});

test('hasPriorPlay ignores what the game writes at startup and sees real play data', () => {
  assert.equal(hasPriorPlay(new Storage()), false);
  const boot = { 'paraliaki.audio-default-version': '1', 'paraliaki.tyre-default-version': '1', 'paraliaki.driver': 'GR-1234', 'paraliaki.driverId': 'x', 'paraliaki.graphicsPrompt.v1': 'seen', [SEEN_KEY]: '2026.10.15.3', 'other.app': 'y' };
  assert.equal(hasPriorPlay(new Storage(boot)), false);
  for (const key of ['paraliaki.settings', 'paraliaki.car', 'paraliaki.raceSetup', 'paraliaki.best.riviera', 'paraliaki.personalBests.v1', 'paraliaki.graphics'])
    assert.equal(hasPriorPlay(new Storage({ ...boot, [key]: '1' })), true, key);
  assert.equal(hasPriorPlay({ get length() { throw new Error('blocked'); } }), false, 'blocked storage');
  assert.equal(hasPriorPlay(null), false);
});

test('seen version round-trips and ignores junk', () => {
  const s = new Storage();
  assert.equal(readSeen(s), null);
  assert.equal(markSeen(s, '2026.10.15.2'), true);
  assert.equal(readSeen(s), '2026.10.15.2');
  assert.equal(markSeen(s, DEV_VERSION), false, 'dev is never recorded');
  assert.equal(readSeen(s), '2026.10.15.2');
  s.setItem(SEEN_KEY, 'garbage'); assert.equal(readSeen(s), null);
  assert.equal(markSeen({ setItem() { throw new Error('full'); } }, '2026.10.15.2'), false);
});

test('whatsNewDecision: show once per version, never in a race, never for a brand-new player', () => {
  const v = '2026.10.15.3', d = (o) => whatsNewDecision({ version: v, ...o });
  assert.equal(d({ seen: '2026.10.15.2', priorPlay: true }), 'show', 'returning player on a newer version');
  assert.equal(d({ seen: null, priorPlay: true }), 'show', 'existing player meeting the feature for the first time');
  assert.equal(d({ seen: null, priorPlay: false }), 'record', 'very first launch: no card, just remember');
  assert.equal(d({ seen: v, priorPlay: true }), 'none', 'already seen');
  assert.equal(d({ seen: '2026.10.16.1', priorPlay: true }), 'none', 'rolled back: an older build never nags');
  assert.equal(d({ seen: '2026.10.15.2', priorPlay: true, racing: true }), 'none', 'never during a race');
  assert.equal(d({ seen: null, priorPlay: false, racing: true }), 'none', 'a race defers recording too');
  assert.equal(d({ seen: '2026.10.15.2', priorPlay: true, hasNotes: false }), 'record', 'nothing to show');
  assert.equal(whatsNewDecision({ version: DEV_VERSION, seen: null, priorPlay: true }), 'none', 'local dev');
  assert.equal(whatsNewDecision({ version: undefined }), 'none');
  assert.equal(d({ seen: 'garbage', priorPlay: true }), 'show', 'unreadable marker counts as unseen');
});

test('launch sequence: new player, then updates, dismissal remembered across launches', () => {
  const s = new Storage();
  const launch = (version, { racing = false } = {}) => { // what src/ui/release-screens.js does at boot, with this storage
    const verdict = whatsNewDecision({ version, seen: readSeen(s), priorPlay: hasPriorPlay(s), racing });
    if (verdict === 'record' || verdict === 'show') markSeen(s, version);
    return verdict;
  };
  assert.equal(launch('2026.10.15.1'), 'record', 'brand-new player, first launch');
  s.setItem('paraliaki.settings', '{}'); // they play and change something
  assert.equal(launch('2026.10.15.1'), 'none', 'same version again');
  assert.equal(launch('2026.10.15.2', { racing: true }), 'none', 'update arrives mid-race: nothing shown, nothing lost');
  assert.equal(readSeen(s), '2026.10.15.1');
  assert.equal(launch('2026.10.15.2'), 'show', 'first launch after the update');
  assert.equal(launch('2026.10.15.2'), 'none', 'only once');
  assert.equal(launch('2026.10.16.1'), 'show', 'the next version shows again');
});

test('Markdown photos belong to a release or to the preceding indented bullet', () => {
  const path = 'assets/changelog/2026.10.15.3/golf-trims.webp';
  const log = parseChangelog(`## Unreleased\n- Soon.\n  ![Garage](${path})\n## 2026.10.15.3\n![Garage overview](${path} "Pick your trim.")\n- A change.\n\n  ![Engine choices](${path})\n- Another change.\n  ![Paint choices](${path} "Choose a colour.")`);
  assert.equal(log.unreleasedImages[0].item, 0);
  assert.deepEqual(log.releases[0].images.map(({ alt, caption, item }) => ({ alt, caption, item })), [
    { alt: 'Garage overview', caption: 'Pick your trim.', item: null },
    { alt: 'Engine choices', caption: 'Engine choices', item: 0 },
    { alt: 'Paint choices', caption: 'Choose a colour.', item: 1 },
  ]);
  assert.deepEqual(log.releases[0].items, ['A change.', 'Another change.']);
});

test('photos require alt text and a safe local versioned WebP path', () => {
  const p = 'assets/changelog/2026.10.15.3/photo.webp';
  for (const image of [`![](${p})`, `![  ](${p})`, '![Photo](https://example.com/photo.webp)', '![Photo](assets/changelog/2026.10.15.3/../photo.webp)', '![Photo](assets/changelog/2026.02.30.1/photo.webp)', '![Photo](assets/changelog/2026.10.15.3/photo.png)']) {
    assert.throws(() => parseChangelog(`## 2026.10.15.3\n- Change.\n${image}`), /alt text|image path/);
  }
  assert.throws(() => parseChangelog(`## 2026.10.15.3\n  ![Photo](${p})\n- Change.`), /must follow a bullet/);
});
