// The deploy-time half: version stamping (tools/release-data.mjs) and the generated Credits screen. The key guarantee:
// every credits / licence file in the repo reaches the in-game Credits screen, so a new one cannot be forgotten.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, basename, relative, sep } from 'node:path';
import { buildReleaseInfo, buildCredits, publishReleaseData, findCreditFiles, isCreditFile, parseCreditsMd, mergeTeam, gitAuthors, gitSha, cleanText, detectLicences } from './release-data.mjs';
import { parseChangelog, parseVersion } from '../src/release-notes.js';

const root = resolve(import.meta.dirname, '..');

// ---------------------------------------------------------------- version stamping
test('the newest CHANGELOG section is the build version; the build id and SHA ride along', async () => {
  const changelog = parseChangelog('## Unreleased\n- soon\n\n## 2026.10.15.2 — 2026-10-15\n- b\n\n## 2026.10.15.1\n- a\n');
  const info = await buildReleaseInfo(root, { build: 'abc123def456', sha: 'a15a9ed', changelog });
  assert.equal(info.version, '2026.10.15.2');
  assert.equal(info.date, '2026-10-15');
  assert.equal(info.sha, 'a15a9ed');
  assert.equal(info.build, 'abc123def456');
  assert.equal(info.unreleased, 1);
  assert.deepEqual(info.notes.map((n) => n.version), ['2026.10.15.2', '2026.10.15.1'], 'Unreleased never ships to players');
  await assert.rejects(buildReleaseInfo(root, { changelog: parseChangelog('## Unreleased\n- x\n') }), /no release section/);
});

test('gitSha prefers the environment (a git-archive copy has no .git) and rejects junk', async () => {
  assert.equal(await gitSha(root, { ASR_GIT_SHA: 'A15A9ED0123456789' }), 'a15a9ed');
  assert.equal(await gitSha(root, { GITHUB_SHA: '4bc8d91' + 'f'.repeat(33) }), '4bc8d91');
  const bogus = await gitSha('/nonexistent-dir', { ASR_GIT_SHA: 'not a sha' });
  assert.equal(bogus, null);
});

test('publishReleaseData writes release.json, credits.json and the version meta tags', async () => {
  const out = await mkdtemp(join(tmpdir(), 'asr-release-'));
  try {
    await writeFile(join(out, 'index.html'), readFileSync(resolve(root, 'index.html'), 'utf8').replace('</head>', '<meta name="asr-build" content="abc123def456" />\n</head>'));
    const info = await publishReleaseData(root, out, { build: 'abc123def456', sha: 'a15a9ed' });
    const release = JSON.parse(await readFile(join(out, 'release.json'), 'utf8'));
    assert.equal(release.version, info.version);
    assert.ok(parseVersion(release.version));
    assert.deepEqual([release.sha, release.build], ['a15a9ed', 'abc123def456']);
    assert.ok(release.notes.length >= 4 && !('unreleased' in release));
    const html = await readFile(join(out, 'index.html'), 'utf8');
    assert.equal(html.match(/<meta name="asr-version" content="([^"]+)"/)?.[1], release.version);
    assert.equal(html.match(/<meta name="asr-sha" content="([^"]+)"/)?.[1], 'a15a9ed');
    assert.equal(html.match(/<meta name="asr-version"/g).length, 1);
    const bundled = JSON.parse(html.match(/<script id="asr-release-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);
    assert.deepEqual(bundled.release, release);
    assert.ok(!/<img[^>]+assets\/changelog/.test(html), 'boot HTML holds metadata, never image elements or image bytes');
    const credits = JSON.parse(await readFile(join(out, 'credits.json'), 'utf8'));
    assert.deepEqual(bundled.credits, credits);
    assert.ok(credits.team.length >= 2 && credits.sections.length >= 4);
  } finally { await rm(out, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------- credits
/** an independent, deliberately broad walk (not the collector's own): anything that looks like a credits file */
function looksLikeCredits(dir = root, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', '.deploy', '.scratch', '.wrangler', '.github'].includes(e.name)) continue;
    const p = join(dir, e.name), rel = relative(root, p).split(sep).join('/');
    if (e.isDirectory()) looksLikeCredits(p, out);
    else if (/^(?:credits.*|(?:attribution|licen[cs]e|notice)(?:\.(?:md|txt))?)$/i.test(e.name) || /^MODELS\.(md|txt)$/.test(e.name) && rel.startsWith('assets/')) out.push(rel);
  }
  return out;
}

test('every credits / licence file in the repo is in the generated Credits screen', async () => {
  const found = looksLikeCredits();
  assert.ok(found.length >= 8, `expected the audio, icon and team credits, found ${found.join(', ')}`);
  const credits = await buildCredits(root, { authors: null });
  const entries = credits.sections.flatMap((s) => s.entries);
  for (const file of found) {
    assert.ok(credits.sources.includes(file), `${file} exists but is not included in the Credits screen (tools/release-data.mjs)`);
    if (file !== 'CREDITS.md') {
      const entry = entries.find((e) => e.file === file), extra = entries.flatMap((e) => (e.extra || []).map((x) => ({ ...x, title: e.title }))).find((x) => x.file === file);
      assert.ok((entry || extra)?.text?.length > 40, `${file} has no readable entry`);
      assert.ok((entry || extra).title, `${file} has no title`);
    }
  }
  assert.deepEqual((await findCreditFiles(root)).filter((f) => f !== 'CREDITS.md').sort(), found.filter((f) => f !== 'CREDITS.md').sort());
  const ids = entries.flatMap((e) => [e.id, ...(e.extra || []).map((x) => x.id)]); assert.equal(new Set(ids).size, ids.length, 'entry ids are unique (they address the sheets)');
});

test('a credits file added anywhere is picked up by name', async () => {
  for (const name of ['assets/audio/new/CREDITS.txt', 'assets/audio/new/CREDITS-extra.md', 'assets/models/CREDITS.md', 'assets/fonts/LICENSE', 'assets/x/NOTICE.txt', 'assets/audio/voice/MODELS.md']) assert.ok(isCreditFile(name), name);
  for (const name of ['src/ui/notice-style.js', 'tools/models.html', 'tools/notice-style.test.mjs', 'assets/icons/car.svg', 'docs/MODELS.md']) assert.ok(!isCreditFile(name), name);
  const dir = await mkdtemp(join(tmpdir(), 'asr-credits-'));
  try {
    await mkdir(join(dir, 'tools/maps/attica'), { recursive: true });
    await writeFile(join(dir, 'tools/maps/attica/README.md'), readFileSync(resolve(root, 'tools/maps/attica/README.md')));
    for (const f of ['package.json', 'README.md', 'index.html', 'CREDITS.md']) await writeFile(join(dir, f), readFileSync(resolve(root, f)));
    await mkdir(join(dir, 'assets/models/cars'), { recursive: true }); await mkdir(join(dir, 'node_modules/x'), { recursive: true });
    await writeFile(join(dir, 'assets/models/cars/CREDITS.txt'), 'CAR MODELS\n\n"Hatchback" by Someone Real, CC BY 4.0: https://creativecommons.org/licenses/by/4.0/\n');
    await writeFile(join(dir, 'node_modules/x/CREDITS.txt'), 'ignored');
    const credits = await buildCredits(dir, { authors: null });
    assert.ok(credits.sources.includes('assets/models/cars/CREDITS.txt'));
    assert.ok(!credits.sources.some((s) => s.startsWith('node_modules')));
    const entry = credits.sections.flatMap((s) => s.entries).find((e) => e.file === 'assets/models/cars/CREDITS.txt');
    assert.deepEqual(entry.licences, ['CC BY 4.0']);
    assert.equal(entry.title, 'Models · Cars');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('the team is Alexandros and Vassilis; agents and bots are the AI note, not people', async () => {
  const credits = await buildCredits(root, { authors: null });
  const by = Object.fromEntries(credits.team.map((m) => [m.name, m]));
  assert.equal(by['Alexandros Lekkas'].handle, 'aflekkas');
  assert.match(by['Alexandros Lekkas'].role, /creator and maintainer/i);
  assert.equal(by['Alexandros Lekkas'].url, 'https://github.com/aflekkas');
  assert.equal(by['Vassilis Perrotis'].handle, 'Vas-Per');
  assert.equal(by['Vassilis Perrotis'].role, 'Contributor');
  assert.equal(credits.team.length, 2);
  assert.match(credits.ai, /AI coding agents/);
  const listed = parseCreditsMd(readFileSync(resolve(root, 'CREDITS.md'), 'utf8')).team;
  const merged = mergeTeam(listed, [{ name: 'Alex Flekkas' }, { name: 'Alexandros Lekkas' }, { name: 'New Person' }]);
  assert.deepEqual(merged.unlisted, ['New Person'], 'aliases match; a stranger is listed automatically');
  assert.equal(merged.team.at(-1).role, 'Contributor');
});

test('every human git author is listed in CREDITS.md (skipped without .git)', async (t) => {
  const authors = existsSync(join(root, '.git')) ? await gitAuthors(root) : null;
  if (!authors) return t.skip('no git history here');
  assert.ok(!authors.some((a) => /T3 Code|\[bot\]|anthropic/i.test(a.name + a.email)), 'agents are filtered out');
  const { unlisted } = mergeTeam(parseCreditsMd(readFileSync(resolve(root, 'CREDITS.md'), 'utf8')).team, authors);
  assert.deepEqual(unlisted, [], `add to CREDITS.md (## Team): ${unlisted.join(', ')}`);
});

test('data, fonts, audio and software sections come from the repo files, not from memory', async () => {
  const credits = await buildCredits(root, { authors: null }), sec = (id) => credits.sections.find((s) => s.id === id)?.entries || [];
  const all = (e) => [e.title, e.detail, e.credit].join('\n');
  const data = sec('data').map(all).join('\n');
  assert.match(data, /© OpenStreetMap contributors/);
  assert.ok(sec('data').find((e) => /OpenStreetMap/.test(e.title)).licences.includes('ODbL'));
  assert.match(data, /EU-DEM v1\.1/);
  assert.match(data, /Copernicus/);
  assert.match(data, /DLR e\.V\. 2010–2014 and © Airbus Defence and Space GmbH 2014–2018/, 'the Copernicus DEM notice is on the screen, not only in the full text');
  assert.deepEqual(sec('data').find((e) => /OpenStreetMap/.test(e.title)).links, ['https://www.openstreetmap.org/copyright']);
  assert.ok(sec('data').every((e) => !/assets\/audio/.test(e.title)), 'audio is covered by its own credits files');
  assert.equal(sec('data').filter((e) => /EU-DEM|Copernicus/i.test(e.title)).length, 1, 'EU-DEM and Copernicus are one entry, not two');
  assert.ok(sec('data').find((e) => /Copernicus/.test(e.title)).text.length > 40, 'the full Copernicus attribution stays readable');
  const poly = sec('textures').find((e) => e.title === 'Poly Haven');
  assert.deepEqual(poly.licences, ['CC0']);
  const fonts = sec('visuals').find((e) => e.id === 'fonts');
  assert.match(fonts.title, /Barlow Condensed and Barlow/);
  assert.deepEqual(fonts.licences, ['SIL OFL 1.1']);
  assert.equal(fonts.extra[0].file, 'assets/fonts/LICENSE.txt', 'the licence text hangs off the font entry instead of a second row');
  assert.ok(!credits.sections.flatMap((s) => s.entries).some((e) => e.file === 'assets/fonts/CREDITS.txt' && e.id !== 'fonts'));
  const audio = sec('audio').map((e) => e.file);
  for (const f of ['engines', 'tyres', 'world', 'world/ambience', 'voice']) assert.ok(audio.includes(`assets/audio/${f}/CREDITS.txt`), f);
  const voice = sec('audio').find((e) => e.file === 'assets/audio/voice/CREDITS.txt');
  assert.match(voice.text, /Piper/); assert.ok(voice.licences.includes('Apache-2.0') && voice.licences.includes('MIT'));
  const notes = voice.extra.find((x) => x.file === 'assets/audio/voice/MODELS.md');
  assert.equal(notes.label, 'Model notes'); assert.ok(notes.text.length > 40);
  assert.ok(!voice.extra.some((x) => x.licences), 'evaluation notes do not claim licences for the shipped files');
  const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')), software = sec('software');
  for (const name of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })) assert.ok(software.some((e) => e.id === 'pkg-' + name), name);
  assert.equal(software.find((e) => e.id === 'pkg-three').title, 'three.js');
  if (existsSync(join(root, 'node_modules/three/package.json'))) assert.match(software.find((e) => e.id === 'pkg-three').credit, /MIT/);
  assert.ok(software.find((e) => e.file === 'assets/codecs/basis/LICENSE.txt').licences.includes('Apache-2.0'));
  const icons = sec('visuals').find(e => e.file === 'assets/icons/LICENSE');
  assert.equal(icons.title, 'Lucide icons');
  assert.equal(icons.credit, '© 2026 Lucide Icons and Contributors');
  assert.ok(icons.licences.includes('ISC'));
  assert.ok(icons.licences.includes('MIT'), 'retain upstream Feather attribution');
  assert.deepEqual(credits.sections.map((s) => s.title).slice(0, 5), ['Map data', 'Textures and artwork', 'Audio', 'Fonts and icons', 'Software']);
});

test('credits read as sentences: unique entries, no all-caps titles, links are https', async () => {
  const credits = await buildCredits(root, { authors: null }), entries = credits.sections.flatMap((s) => s.entries);
  const titles = entries.map((e) => e.title.toLowerCase());
  assert.equal(new Set(titles).size, titles.length, 'no entry is listed twice');
  for (const e of entries) {
    assert.ok(!(/[A-Z]{4}/.test(e.title) && e.title === e.title.toUpperCase()), `${e.title} is shouty: sentence case`);
    assert.ok(e.title.length < 60 && !/…$/.test(e.title), `${e.title}: titles are names, not sentences`);
    for (const url of e.links || []) assert.match(url, /^https:\/\//);
  }
});

test('credits text is plain and readable; licences are only those the file names', () => {
  assert.equal(cleanText('# Title\n\n| a | b |\n|---|:--|\n| `x` | y **z** |\n\n\n\nend  '), 'Title\n\n• a — b\n• x — y z\n\nend');
  assert.deepEqual(detectLicences('CC0 1.0 and CC BY 3.0, plus MIT; ODbL data; Apache-2.0'), ['CC0', 'CC BY 3.0', 'MIT', 'Apache-2.0', 'ODbL']);
  assert.deepEqual(detectLicences('Apache License\n Version 2.0, January 2004'), ['Apache-2.0']);
  assert.deepEqual(detectLicences('all rights reserved'), []);
  assert.equal(basename(resolve(root, 'CREDITS.md')), 'CREDITS.md');
});

test('release screenshots exist, have alt text, are small lossy WebPs, and keep layout dimensions', async () => {
  const { validateChangelogImages } = await import('./changelog-images.mjs');
  const log = parseChangelog(readFileSync(resolve(root, 'CHANGELOG.md'), 'utf8'));
  const photos = await validateChangelogImages(root, log);
  for (const version of ['2026.10.14.1', '2026.10.15.1', '2026.10.15.2', '2026.10.15.3']) {
    const n = log.releases.find(n => n.version === version);
    assert.ok(n.images.length >= 1 && n.images.length <= 3, `${version} needs 1–3 inspected backfill photos`);
  }
  assert.ok(photos.every(p => p.width >= 960 && p.width <= 1280 && p.height >= 200 && p.alt && p.caption));
  const { UNCACHED } = await import('./release-cache.mjs');
  for (const p of photos) assert.ok(UNCACHED.some(re => re.test('/' + p.src)), 'photos never enter service-worker boot prefetch');
});

test('media validation rejects missing, oversized, non-WebP and oversized-dimension images', async () => {
  const { validateChangelogImages, MAX_IMAGE_BYTES, webpDimensions } = await import('./changelog-images.mjs');
  const dir = await mkdtemp(join(tmpdir(), 'asr-picture-test-'));
  const src = 'assets/changelog/2026.10.15.3/photo.webp';
  const log = () => ({ unreleased: [], releases: [{ images: [{ src, alt: 'Real photo' }] }] });
  try {
    await mkdir(join(dir, 'assets/changelog/2026.10.15.3'), { recursive: true });
    await assert.rejects(validateChangelogImages(dir, log()), /Missing changelog image/);
    await writeFile(join(dir, src), Buffer.alloc(MAX_IMAGE_BYTES));
    await assert.rejects(validateChangelogImages(dir, log()), /under 150 KB/);
    await writeFile(join(dir, src), Buffer.from('this is not a WebP screenshot'));
    await assert.rejects(validateChangelogImages(dir, log()), /not a WebP/);
    const data = Buffer.from(readFileSync(resolve(root, 'assets/changelog/2026.10.15.3/golf-trims.webp')));
    const frame = data.indexOf(Buffer.from('9d012a', 'hex'));
    data.writeUInt16LE(2000, frame + 3);
    await writeFile(join(dir, src), data);
    await assert.rejects(validateChangelogImages(dir, log()), /1280 px wide/);
    assert.throws(() => webpDimensions(Buffer.alloc(31)), /not a WebP/);
    const missingAlt = log(); missingAlt.releases[0].images[0].alt = '';
    await assert.rejects(validateChangelogImages(dir, missingAlt), /alt text/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('Unreleased without photos warns without blocking the automatic release train', async () => {
  const { missingPicturesWarning } = await import('./changelog-images.mjs');
  assert.match(missingPicturesWarning({ unreleased: ['A change.'], unreleasedImages: [] }), /WARNING:.*NO SCREENSHOTS/);
  assert.equal(missingPicturesWarning({ unreleased: [], unreleasedImages: [] }), null);
  assert.equal(missingPicturesWarning({ unreleased: ['A change.'], unreleasedImages: [{}] }), null);
});

test('the actual content manifest omits changelog photos even with a broad asset core', async () => {
  const { buildRelease } = await import('./release-cache.mjs');
  const out = await mkdtemp(join(tmpdir(), 'asr-picture-cache-'));
  try {
    await mkdir(join(out, 'assets/changelog/2026.10.15.3'), { recursive: true });
    await mkdir(join(out, 'src'), { recursive: true });
    await writeFile(join(out, 'assets/changelog/2026.10.15.3/photo.webp'), readFileSync(resolve(root, 'assets/changelog/2026.10.15.3/golf-trims.webp')));
    await writeFile(join(out, 'src/shell.js'), 'console.log("menu");');
    const release = await buildRelease(out, { core: ['/assets/', '/src/'] });
    assert.deepEqual(Object.keys(release.files), ['/src/shell.js']);
  } finally { await rm(out, { recursive: true, force: true }); }
});
