// Release data for the in-game About / What's new / Credits screens (src/ui/release-screens.js), built at deploy time:
//   /release.json  { version, date, sha, build, notes: [{ version, date, items }] }   <- CHANGELOG.md (never "Unreleased")
//   /credits.json  { team, ai, sections, sources }                                     <- CREDITS.md, git authors, every credits/licence file, README, package.json
// and <meta name="asr-version"> / <meta name="asr-sha"> in index.html, so the title screen can show the version synchronously.
// tools/prepare-deploy.mjs calls publishReleaseData() after the content build id exists, so none of this changes that id.
// Local dev has none of it: the game then reports "dev" (src/release-notes.js DEV_VERSION).
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { resolve, relative, basename, dirname, sep } from 'node:path';
import { promisify } from 'node:util';
import { validateChangelogImages } from './changelog-images.mjs';
import { parseChangelog } from '../src/release-notes.js';

const run = promisify(execFile);
const text = (root, rel) => readFile(resolve(root, rel), 'utf8');
const git = (root, args) => run('git', ['-C', root, ...args], { maxBuffer: 16 << 20 }).then((r) => r.stdout.trim(), () => null);

// ---------------------------------------------------------------- version, SHA, notes
/** short commit id: ASR_GIT_SHA / GITHUB_SHA (a `git archive` copy has no .git: set ASR_GIT_SHA=$(git rev-parse --short HEAD)), else git */
export async function gitSha(root, env = process.env) {
  const given = env.ASR_GIT_SHA || env.GITHUB_SHA;
  if (given && /^[0-9a-f]{7,40}$/i.test(given)) return given.slice(0, 7).toLowerCase();
  const sha = await git(root, ['rev-parse', '--short=7', 'HEAD']);
  return sha && /^[0-9a-f]{7,}$/.test(sha) ? sha : null;
}
export async function readChangelog(root) { const log = parseChangelog(await text(root, 'CHANGELOG.md')); await validateChangelogImages(root, log); return log; }
/** the build's identity: the newest CHANGELOG section is the version */
export async function buildReleaseInfo(root, { build, sha, changelog } = {}) {
  const log = changelog || await readChangelog(root);
  const latest = log.releases[0];
  if (!latest) throw new Error('CHANGELOG.md has no release section: add "## YYYY.MM.DD.N" (see deploy/README.md, Release notes)');
  return {
    version: latest.version, date: latest.date, sha: sha === undefined ? await gitSha(root) : sha, build: build || null,
    notes: log.releases.map(({ version, date, items, images = [] }) => ({ version, date, items, images })),
    unreleased: log.unreleased.length, unreleasedImages: log.unreleasedImages?.length || 0,
  };
}

// ---------------------------------------------------------------- credits
const SKIP_DIRS = new Set(['node_modules', '.git', '.deploy', '.scratch', '.wrangler', '.github']);
/** the credits / licence files that feed the in-game Credits screen; any new one is found by name */
const CREDIT_NAME = /^(?:credits.*|(?:attribution|licen[cs]e|notice)(?:\.(?:md|txt))?)$/i;
export const isCreditFile = (rel) => CREDIT_NAME.test(basename(rel)) || /^assets\/.*\/MODELS\.(md|txt)$/.test(rel);
const BOTS = /^(T3 Code|Claude\b|github-actions|dependabot|.*\[bot\])/i;

async function walk(root, dir = root, out = []) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') && e.isDirectory() || SKIP_DIRS.has(e.name)) continue;
    const p = resolve(dir, e.name);
    if (e.isDirectory()) await walk(root, p, out);
    else if (e.isFile() && isCreditFile(relative(root, p).split(sep).join('/'))) out.push(relative(root, p).split(sep).join('/'));
  }
  return out;
}
export const findCreditFiles = async (root) => (await walk(root)).sort();

/** How a credits directory reads on the Credits screen; anything not listed gets a generated title and the section by path. */
const KNOWN = {
  'assets/audio/engines': { title: 'Engine recordings', detail: 'Edited recordings of real engines', section: 'audio' },
  'assets/audio/tyres': { title: 'Tyre sounds', detail: 'Procedural synthesis and one recorded tyre squeal', section: 'audio' },
  'assets/audio/world': { title: 'World sounds', detail: 'Sea, cicadas, crowds, traffic and impacts', section: 'audio' },
  'assets/audio/world/ambience': { title: 'Ambience', detail: 'Wind, birds and distant farm sounds', section: 'audio' },
  'assets/audio/voice': { title: 'Greek voices', detail: 'Synthetic Greek voice reactions, made offline with Piper', section: 'audio' },
  'assets/brand-badges': { title: 'Manufacturer badges', detail: 'Vector artwork from Simple Icons', section: 'textures', links: ['https://simpleicons.org'] },
  'assets/icons': { title: 'Lucide icons', detail: 'User-interface icons, with the upstream Feather MIT notice', section: 'visuals', links: ['https://lucide.dev'] },
  'assets/codecs/basis': { title: 'Basis Universal', detail: 'GPU texture transcoder', section: 'software', links: ['https://github.com/BinomialLLC/basis_universal'] },
  'assets/fonts': { into: 'fonts' },
  'tools/world-gen': { into: 'openstreetmap' },
};
const humanize = (s) => s.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
function titleFor(file) {
  const dir = dirname(file), name = basename(file), base = KNOWN[dir]?.title || humanize(dir.split('/').slice(-2).join(' · '));
  return /^models/i.test(name) ? base + ': models and licences' : base;
}
const sectionFor = (file) => KNOWN[dirname(file)]?.section || (file.startsWith('assets/audio/') ? 'audio' : file.startsWith('assets/') ? 'visuals' : 'more');
const extraLabel = (file) => /^licen[cs]e/i.test(basename(file)) ? 'Licence text' : /^models/i.test(basename(file)) ? 'Model notes' : 'More credits';
/** the first real copyright line of a credits / licence text, as an attribution line */
const copyrightLine = (body) => {
  const m = /^Copyright(?: \(c\))? ([^\n[]+)$/im.exec(body); if (!m) return '';
  return '© ' + m[1].replace(/\s*\(https?:[^)]*\)/g, '').replace(/[.\s]+$/, '');
};

const LICENCES = [['SIL OFL 1.1', /SIL Open Font License(?:,? Version)? 1\.1/i], ['CC0', /\bCC0\b|publicdomain\/zero/i], ['CC BY 4.0', /CC[ -]BY[ -]4\.0|licenses\/by\/4\.0|By Attribution 4\.0/i], ['CC BY 3.0', /CC[ -]BY[ -]3\.0|licenses\/by\/3\.0/i],
  ['CC BY 2.0', /CC[ -]BY[ -]2\.0|licenses\/by\/2\.0/i], ['ISC', /\bISC License\b/i], ['MIT', /\bMIT\b/], ['Apache-2.0', /Apache[ -]2\.0|Apache License,?\s+Version 2\.0/i], ['ODbL', /\bODbL\b/]];
/** licence names a credits file mentions (not for model-evaluation notes, which also name rejected, unshipped licences) */
export const detectLicences = (body) => LICENCES.filter(([, re]) => re.test(body)).map(([name]) => name);

/** plain text for the in-game sheet: markdown tables become one line per row */
export function cleanText(raw) {
  const separator = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
  const rows = String(raw).replace(/\r\n?/g, '\n').split('\n').filter((l) => !separator.test(l)).map((l) => {
    const t = l.replace(/\s+$/, '').replace(/`|\*\*/g, '');
    return /^\s*\|.*\|\s*$/.test(t) ? '• ' + t.trim().slice(1, -1).split('|').map((c) => c.trim()).filter(Boolean).join(' — ') : t.replace(/^#{1,6}\s+/, '');
  });
  return rows.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** CREDITS.md: `## Team` lines `- Name | github-handle | role | alias; alias`, and `## AI` text */
export function parseCreditsMd(md) {
  const parts = String(md).replace(/\r\n?/g, '\n').split(/^##\s+/m).slice(1), team = []; let ai = '';
  for (const part of parts) {
    const [head, ...rest] = part.split('\n'), body = rest.join('\n').trim();
    if (/^team/i.test(head)) {
      for (const line of body.split('\n')) {
        const m = /^[-*]\s+(.+)$/.exec(line.trim()); if (!m) continue;
        const [name, handle = '', role = 'Contributor', aliases = ''] = m[1].split('|').map((s) => s.trim());
        if (name) team.push({ name, handle, role, aliases: aliases.split(';').map((s) => s.trim()).filter(Boolean) });
      }
    } else if (/^ai\b/i.test(head)) ai = body.replace(/\s*\n\s*/g, ' ');
  }
  return { team, ai };
}
/** human git authors: [{ name, email }] over every branch; agents and bots are the AI note's business, not people */
export async function gitAuthors(root) {
  const out = await git(root, ['log', '--all', '--format=%aN%x09%aE']);
  if (!out) return null;
  const seen = new Map();
  for (const line of out.split('\n')) {
    const [name, email = ''] = line.split('\t');
    if (!name || BOTS.test(name) || /@anthropic\.com$/i.test(email)) continue;
    seen.set(name.toLowerCase(), { name, email });
  }
  return [...seen.values()];
}
const known = (member, name) => [member.name, ...member.aliases].some((n) => n.toLowerCase() === name.toLowerCase());
/** the listed team plus any git author nobody listed yet (so a new contributor appears automatically) */
export function mergeTeam(listed, authors) {
  const team = listed.map(({ aliases, ...m }) => ({ ...m, url: m.handle ? `https://github.com/${m.handle}` : '' }));
  const unlisted = (authors || []).filter((a) => !listed.some((m) => known(m, a.name)));
  return { team: [...team, ...unlisted.map((a) => ({ name: a.name, handle: '', role: 'Contributor', url: '' }))], unlisted: unlisted.map((a) => a.name) };
}

const attr = (html, re) => [...html.matchAll(re)];
/** where a README "Data and credits" bullet's provider is credited from; the first match wins */
const PROVIDER_LINKS = [[/Poly Haven/i, 'https://polyhaven.com/']];
const oneSentence = (s, max = 110) => { const first = String(s || '').split(/(?<=[.!?])\s/)[0].replace(/[.\s]+$/, ''); return first.length > max ? first.slice(0, max - 1).replace(/\s+\S*$/, '') + '…' : first; };

export async function buildCredits(root, { authors } = {}) {
  const sources = [], use = (f) => { if (!sources.includes(f)) sources.push(f); };
  const sections = { data: [], textures: [], audio: [], visuals: [], software: [], more: [] };
  const entries = [], add = (section, entry) => { sections[section].push(entry); entries.push(entry); return entry; };

  // team + AI note
  use('CREDITS.md');
  const { team: listed, ai } = parseCreditsMd(await text(root, 'CREDITS.md'));
  const { team, unlisted } = mergeTeam(listed, authors === undefined ? await gitAuthors(root) : authors);

  // map data and textures: the README's "Data and credits" bullets (audio is covered by the files below)
  use('README.md');
  const readme = await text(root, 'README.md'), block = /^## Data and credits\n([\s\S]*?)(?=\n## |$(?![\s\S]))/m.exec(readme)?.[1] || '';
  const html = await text(root, 'index.html'); use('index.html');
  const anchors = attr(html, /<a href="(https?:[^"]+)"[^>]*>([^<]+)<\/a>/g).map((m) => ({ href: m[1], label: m[2] }));
  let elevation = null;
  for (const line of block.split('\n')) {
    const m = /^-\s+(.+)$/.exec(line.trim()); if (!m || /assets\/audio\//.test(m[1])) continue;
    const body = m[1].replace(/`/g, '').replace(/,? in (?:data|assets)\/[\w/]*\.?$/, '.').replace(/\.$/, '');
    const [, label = '', rest = body] = /^(.+?):\s+(.+)$/.exec(body) || [];
    const licence = /\(([^)]+)\)\s*$/.exec(rest)?.[1], who = rest.replace(/\s*\([^)]*\)\s*$/, '').replace(/^©\s*/, '').trim();
    if (/^elevation$/i.test(label)) { elevation = { rest }; continue; } // merged with the Copernicus attribution below
    const section = /^textures?$/i.test(label) ? 'textures' : 'data';
    const title = who.replace(/ contributors$/, '');
    add(section, { id: title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'readme-' + entries.length, title, detail: /^textures?$/i.test(label) ? 'Material textures' : label,
      credit: rest.startsWith('©') ? '© ' + who : '', licences: licence ? [licence] : [],
      links: [...anchors.filter((a) => body.includes(a.label.replace(/ \/ ODbL$/, ''))).map((a) => a.href), ...PROVIDER_LINKS.filter(([re]) => re.test(who)).map(([, u]) => u)].slice(0, 1) });
  }
  // Regional map elevation attribution is maintained beside the map source: one entry with the EU-DEM line.
  use('tools/maps/attica/README.md');
  const mapNotes = await text(root, 'tools/maps/attica/README.md');
  const elevationNote = /^- Regional elevation: (.+)$/m.exec(mapNotes)?.[1];
  if (elevationNote || elevation) {
    const note = elevationNote ? cleanText(elevationNote) : '';
    add('data', { id: 'copernicus', title: 'EU-DEM / Copernicus', detail: 'Terrain elevation' + (elevation ? ' · ' + elevation.rest : ''),
      credit: /Produced using[^.]*\./.exec(note)?.[0] || '', licences: [], links: [], ...(note ? { text: note } : {}) });
  }

  // fonts: the families index.html loads
  const families = [...html.matchAll(/[?&]family=([^:&"]+)/g)].map((m) => decodeURIComponent(m[1]).replace(/\+/g, ' ')).filter((f, i, a) => a.indexOf(f) === i);
  if (families.length) add('visuals', { id: 'fonts', title: families.join(' and '), detail: 'Typefaces, served by Google Fonts', credit: '', licences: [], links: [`https://fonts.google.com/specimen/${families.at(-1).replace(/ /g, '+')}`] });

  // every credits / licence file: one entry per directory, the CREDITS file first, any licence text attached to it
  const byDir = new Map();
  for (const file of (await findCreditFiles(root)).filter((f) => f !== 'CREDITS.md')) {
    use(file);
    const dir = dirname(file); byDir.set(dir, [...(byDir.get(dir) || []), file]);
  }
  const idFor = (file) => file.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  for (const [dir, files] of byDir) {
    files.sort((a, b) => (/^licen[cs]e|^models/i.test(basename(a)) ? 1 : 0) - (/^licen[cs]e|^models/i.test(basename(b)) ? 1 : 0) || a.localeCompare(b));
    const known = KNOWN[dir] || {}, texts = [];
    for (const file of files) texts.push({ file, raw: await text(root, file), notes: /^models/i.test(basename(file)) });
    const [primary, ...others] = texts;
    const target = known.into && entries.find((e) => e.id === known.into);
    const licences = [...new Set(texts.filter((t) => !t.notes).flatMap((t) => detectLicences(t.raw)))];
    const extra = others.map((t) => ({ id: idFor(t.file), file: t.file, label: extraLabel(t.file), text: cleanText(t.raw) }));
    if (target) { // the Barlow notice and the world-gen source notes belong to the entry they describe
      Object.assign(target, { file: primary.file, text: cleanText(primary.raw), ...(extra.length ? { extra } : {}) });
      target.licences = [...new Set([...target.licences, ...licences])];
      if (!target.credit) target.credit = copyrightLine(primary.raw);
      continue;
    }
    let title = titleFor(primary.file);
    if (/LICENSE$/i.test(primary.file) && !known.title) { const c = /^Copyright \(c\) \d{4}\s+(.+)$/im.exec(primary.raw); if (c) title = `${title} (${c[1].trim()})`; }
    add(sectionFor(primary.file), { id: idFor(primary.file), title, detail: known.detail || '', credit: copyrightLine(primary.raw), file: primary.file, licences: primary.notes ? [] : licences, links: known.links || [], text: cleanText(primary.raw), ...(extra.length ? { extra } : {}) });
  }
  // the Copernicus DEM notice sits in the world-gen file; surface its product link and © line on the elevation entry
  const worldGen = entries.find((e) => e.id === 'openstreetmap')?.text || '', dem = entries.find((e) => e.id === 'copernicus');
  if (dem) {
    dem.links = [...(/https:\/\/land\.copernicus\.eu\/\S+/.exec(worldGen) || [])];
    const dm = /Copernicus DEM: ([^;]+)/.exec(worldGen)?.[1].replace(/\s+/g, ' ').trim();
    if (dm) dem.credit = [dem.credit, 'Copernicus DEM: ' + dm + '.'].filter(Boolean).join('\n');
  }

  // open-source software: package.json
  use('package.json');
  const pkg = JSON.parse(await text(root, 'package.json'));
  for (const name of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).sort()) {
    let meta = {}; try { meta = JSON.parse(await text(root, `node_modules/${name}/package.json`)); } catch { /* not installed */ }
    const licence = typeof meta.license === 'string' ? meta.license : meta.license?.type || null;
    add('software', { id: 'pkg-' + name, title: name === 'three' ? 'three.js' : name, detail: oneSentence(meta.description), credit: [meta.version && 'v' + meta.version, licence].filter(Boolean).join(' · '),
      licences: [], links: [meta.homepage || `https://www.npmjs.com/package/${name}`].filter((u) => /^https:/.test(u)) });
  }
  return { team, unlisted, ai, sections: [
    ['data', 'Map data'], ['textures', 'Textures and artwork'], ['audio', 'Audio'], ['visuals', 'Fonts and icons'], ['software', 'Software'], ['more', 'More credits'],
  ].filter(([id]) => sections[id].length).map(([id, title]) => ({ id, title, entries: sections[id] })), sources };
}

// ---------------------------------------------------------------- publish
/** write release.json, credits.json and the version meta tags into the deploy directory */
export async function publishReleaseData(root, out, { build, sha, env } = {}) {
  const info = await buildReleaseInfo(root, { build, sha: sha ?? await gitSha(root, env) });
  const credits = await buildCredits(root);
  await writeFile(resolve(out, 'release.json'), JSON.stringify({ version: info.version, date: info.date, sha: info.sha, build: info.build, notes: info.notes }));
  await writeFile(resolve(out, 'credits.json'), JSON.stringify(credits));
  const path = resolve(out, 'index.html'), html = await readFile(path, 'utf8');
  const meta = `<meta name="asr-version" content="${info.version}" />\n${info.sha ? `<meta name="asr-sha" content="${info.sha}" />\n` : ''}`;
  if (!html.includes('</head>')) throw new Error('index.html has no </head>');
  // Bundle the generated data into the HTML shell too: available offline immediately,
  // and stamped only after the content hash, avoiding a build-id/hash cycle.
  const bundled = JSON.stringify({ release: { version: info.version, date: info.date, sha: info.sha, build: info.build, notes: info.notes }, credits }).replace(/</g, '\\u003c');
  await writeFile(path, html.replace('</head>', meta + `<script id="asr-release-data" type="application/json">${bundled}</script>\n</head>`));
  return { ...info, credits: credits.sources.length, unlistedAuthors: credits.unlisted };
}
