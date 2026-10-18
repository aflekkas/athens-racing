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

const TITLES = { 'assets/audio/engines': 'Engine recordings', 'assets/audio/tyres': 'Tyre sounds', 'assets/audio/world': 'World sounds',
  'assets/audio/world/ambience': 'Ambience', 'assets/audio/voice': 'Greek voices', 'assets/icons': 'Icons' };
const humanize = (s) => s.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
function titleFor(file) {
  const dir = dirname(file), name = basename(file);
  const base = TITLES[dir] || humanize(dir.split('/').slice(-2).join(' · '));
  return /^models/i.test(name) ? base + ': models and licences' : base;
}
const sectionFor = (file) => file.startsWith('assets/audio/') ? 'audio' : file.startsWith('assets/') ? 'visuals' : 'more';

const LICENCES = [['SIL OFL 1.1', /SIL Open Font License(?:,? Version)? 1\.1/i], ['CC0', /\bCC0\b|publicdomain\/zero/i], ['CC BY 4.0', /CC[ -]BY[ -]4\.0|licenses\/by\/4\.0|By Attribution 4\.0/i], ['CC BY 3.0', /CC[ -]BY[ -]3\.0|licenses\/by\/3\.0/i],
  ['CC BY 2.0', /CC[ -]BY[ -]2\.0|licenses\/by\/2\.0/i], ['ISC', /\bISC License\b/i], ['MIT', /\bMIT\b/], ['Apache-2.0', /Apache[ -]2\.0/i], ['ODbL', /\bODbL\b/]];
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
export async function buildCredits(root, { authors } = {}) {
  const sources = [], use = (f) => { if (!sources.includes(f)) sources.push(f); };
  const sections = { data: [], audio: [], visuals: [], software: [], more: [] };

  // team + AI note
  use('CREDITS.md');
  const { team: listed, ai } = parseCreditsMd(await text(root, 'CREDITS.md'));
  const { team, unlisted } = mergeTeam(listed, authors === undefined ? await gitAuthors(root) : authors);

  // map data and textures: the README's "Data and credits" bullets (audio is covered by the files below)
  use('README.md');
  const readme = await text(root, 'README.md'), block = /^## Data and credits\n([\s\S]*?)(?=\n## |$(?![\s\S]))/m.exec(readme)?.[1] || '';
  const html = await text(root, 'index.html'); use('index.html');
  const anchors = attr(html, /<a href="(https?:[^"]+)"[^>]*>([^<]+)<\/a>/g).map((m) => ({ href: m[1], label: m[2] }));
  for (const line of block.split('\n')) {
    const m = /^-\s+(.+)$/.exec(line.trim()); if (!m || /assets\/audio\//.test(m[1])) continue;
    const body = m[1].replace(/`/g, '').replace(/,? in (?:data|assets)\/[\w/]*\.?$/, '.');
    sections.data.push({ id: 'readme-' + sections.data.length, title: body, links: anchors.filter((a) => body.includes(a.label.replace(/ \/ ODbL$/, ''))).map((a) => a.href).slice(0, 1) });
  }
  // Regional map elevation attribution is maintained beside the map source.
  use('tools/maps/attica/README.md');
  const mapNotes = await text(root, 'tools/maps/attica/README.md');
  const elevation = /^- Regional elevation: (.+)$/m.exec(mapNotes)?.[1];
  if (elevation) sections.data.push({ id: 'copernicus', title: 'EU-DEM / Copernicus elevation', text: cleanText(elevation) });

  // fonts: the families index.html loads
  const families = [...html.matchAll(/[?&]family=([^:&"]+)/g)].map((m) => decodeURIComponent(m[1]).replace(/\+/g, ' ')).filter((f, i, a) => a.indexOf(f) === i);
  if (families.length) sections.visuals.push({ id: 'fonts', title: `Fonts: ${families.join(', ')}`, detail: 'Served by Google Fonts', links: [`https://fonts.google.com/specimen/${families.at(-1).replace(/ /g, '+')}`] });

  // every credits / licence file
  for (const file of (await findCreditFiles(root)).filter((f) => f !== 'CREDITS.md')) {
    use(file);
    const raw = await text(root, file), notes = /^models/i.test(basename(file));
    let title = titleFor(file);
    if (/LICENSE$/i.test(file)) { const c = /^Copyright \(c\) \d{4}\s+(.+)$/im.exec(raw); if (c) title = `${title} (${c[1].trim()})`; }
    const entry = { id: file.toLowerCase().replace(/[^a-z0-9]+/g, '-'), title, file, licences: notes ? [] : detectLicences(raw), text: cleanText(raw) };
    sections[sectionFor(file)].push(entry);
  }

  // open-source software: package.json
  use('package.json');
  const pkg = JSON.parse(await text(root, 'package.json'));
  for (const name of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).sort()) {
    let meta = {}; try { meta = JSON.parse(await text(root, `node_modules/${name}/package.json`)); } catch { /* not installed */ }
    const licence = typeof meta.license === 'string' ? meta.license : meta.license?.type || null;
    sections.software.push({ id: 'pkg-' + name, title: name === 'three' ? 'three.js' : name, detail: [meta.version && 'v' + meta.version, licence].filter(Boolean).join(' · '),
      licences: licence ? [licence] : [], links: [meta.homepage || `https://www.npmjs.com/package/${name}`].filter((u) => /^https:/.test(u)) });
  }
  return { team, unlisted, ai, sections: [
    ['data', 'Map data and textures'], ['audio', 'Audio'], ['visuals', 'Models, textures, icons and fonts'], ['software', 'Open-source software'], ['more', 'More credits'],
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
