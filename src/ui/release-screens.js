import { legalLinks } from './legal-links.js';
// RELEASE SCREENS: version label, About (Settings), What's new, Credits and the one-time "What's new in <version>" card.
// Built from the shared components; src/menu.js only calls the hooks at the bottom of this file. The version arrives
// synchronously from <meta name="asr-version"> (tools/release-data.mjs, deploy builds only; local dev is "dev"); the
// notes and credits are bundled into the HTML shell, with /release.json and /credits.json as fallbacks.
import * as C from './components.js';
import { DEV_VERSION, parseVersion, versionLabel, formatDate, hasPriorPlay, readSeen, markSeen, whatsNewDecision } from '../release-notes.js';

const { esc, icon } = C;
export const SOURCE_URL = 'https://github.com/aflekkas/athens-racing';
export const CONTRIBUTING_URL = SOURCE_URL + '/blob/staging/CONTRIBUTING.md';
const CARD_ITEMS = 6;
const SCREENS = ['whatsNew', 'credits', 'creditFile', 'releaseImage'];

const meta = (name) => document.querySelector(`meta[name="${name}"]`)?.content || null;
/** this build: { version, sha, build }; version is DEV_VERSION unless the deploy stamped one */
export function buildInfo() {
  const version = meta('asr-version');
  return parseVersion(version) ? { version, sha: meta('asr-sha'), build: meta('asr-build') } : { version: DEV_VERSION, sha: null, build: null };
}
const racing = () => document.body.classList.contains('racing') || document.body.classList.contains('counting') || ['race', 'countdown'].includes(window.__flow?.state);

// ---------------------------------------------------------------- state (module singleton: one menu, one page)
// priorPlay is read once, at import, before this session writes anything, so a brand-new player is not taken for a returning one.
const bundled = (() => { try { return JSON.parse(document.getElementById('asr-release-data')?.textContent || '{}'); } catch { return {}; } })();
const state = { priorPlay: hasPriorPlay(), release: bundled.release || null, credits: bundled.credits || null, loading: {}, card: null, cardPictures: false, settled: false };
const fetchJson = (name) => fetch(new URL(name, document.baseURI), { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))));
/** null = not requested, false = unavailable (local dev), else the parsed file */
function ensure(menu, key, file) {
  if (state[key] !== null || state.loading[key]) return;
  state.loading[key] = fetchJson(file).catch(() => false).then((data) => {
    state[key] = data; state.loading[key] = null;
    if (key === 'release') settle(menu);
    if (menu.open && (SCREENS.includes(menu.screen) || menu.screen === 'settings' && menu.data.tab === 'about')) menu.refresh();
  });
}
/** decide the one-time card once the notes are known (and again later if the first chance was mid-race) */
function settle(menu, refresh = true) {
  if (state.settled || !state.release) return;
  const { version } = buildInfo(), entry = state.release.notes?.find((n) => n.version === version);
  const verdict = whatsNewDecision({ version, seen: readSeen(), priorPlay: state.priorPlay, racing: racing(), hasNotes: !!entry?.items.length });
  if (verdict === 'none' && racing()) return;
  state.settled = true;
  if (verdict === 'record') markSeen(null, version);
  else if (verdict === 'show') { state.card = { version, date: entry.date, items: entry.items, images: entry.images || [] }; if (refresh && menu.screen === 'title') menu.refresh(); }
}
function dismiss(menu) {
  if (!state.card) return;
  markSeen(null, state.card.version); state.card = null;
  if (menu.screen === 'title') menu.refresh();
}
export function openExternal(url) {
  if (!/^https:\/\//.test(url)) return;
  const a = document.createElement('a'); a.href = url; a.target = '_blank'; a.rel = 'noopener'; a.click();
}

// ---------------------------------------------------------------- markup helpers
const linkify = (s) => esc(s).replace(/https?:\/\/[^\s<]+/g, (u) => { const [, url, tail] = /^(.*?)([.,;:)]*)$/.exec(u); return `<a href="${url}" target="_blank" rel="noopener">${url}</a>${tail}`; });
const head = (menu, kick, hints = [['updown', 'SCROLL'], ['back', 'BACK']]) => ({ cls: 'scr--info', kick: menu.data.from === 'pause' ? 'PAUSED' : kick, hints });
const paragraphs = (body) => C.articleText(body.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean).map(linkify));
const article = (menu, frame, content, actions = '') => C.sheetList({ ...head(menu, frame.kick || 'ABOUT', frame.hints), variant: 'article', title: frame.title, rows: content, actions });
const note = (msg) => `<p class="empty">${msg}</p>`;

/** Settings > About */
export function renderAbout(menu) {
  ensure(menu, 'release', 'release.json');
  const b = buildInfo(), v = parseVersion(b.version);
  const tiles = C.stats([['VERSION', b.version === DEV_VERSION ? 'dev' : esc(b.version)], ['RELEASED', v ? formatDate(v.date) : 'LOCAL BUILD'], ['COMMIT', esc(b.sha || '—')], ['BUILD', esc(b.build || '—')]], 'about-stats');
  return `<div class="group"><h3 class="group__title">${icon('info')}VERSION</h3>${tiles}
      ${C.option({ icon: 'star', title: "WHAT'S NEW", desc: 'Release notes for every version', act: 'whatsNew' })}
      ${C.option({ icon: 'users', title: 'CREDITS', desc: 'Team, map data, audio, fonts and open-source software', act: 'credits' })}</div>
    <div class="group"><h3 class="group__title">${icon('link')}OPEN SOURCE</h3>
      ${C.option({ icon: 'globe', title: 'VIEW SOURCE ON GITHUB', desc: 'aflekkas/athens-racing · opens in a new tab', act: 'openLink', attrs: { 'data-url': SOURCE_URL } })}
      ${C.option({ icon: 'wrench', title: 'CONTRIBUTE', desc: 'Pull requests go into the staging branch · read CONTRIBUTING.md', act: 'openLink', attrs: { 'data-url': CONTRIBUTING_URL } })}</div>${legalLinks}`;
}

/** Image bytes are requested only when this gallery is mounted by an open screen or explicit card action. */
function gallery(release, images = release.images || []) {
  if (!images.length) return '';
  return `<div class="release-gallery">${images.map(image => {
    const index = release.images.indexOf(image);
    const media = `<img src="${esc(image.src)}" alt="${esc(image.alt)}" loading="lazy" decoding="async" width="${image.width || 1280}" height="${image.height || 800}" />`;
    return C.card({ media, text: esc(image.caption), act: 'releaseImage', cls: 'card--photo', attrs: { 'data-release': release.version, 'data-image': index, 'aria-label': image.caption, title: 'Open photo' } });
  }).join('')}</div>`;
}

/** A full screen with the usual Back navigation, never a dialog. */
export function renderImage(menu) {
  const release = state.release?.notes?.find(n => n.version === menu.data.version);
  const image = release?.images?.[menu.data.image];
  const frame = { ...head(menu, "WHAT'S NEW"), cls: 'scr--info scr--release-image', title: 'PHOTO' };
  return image ? C.stageInspector({ ...frame, variant: 'media', stage: `<img src="${esc(image.src)}" alt="${esc(image.alt)}" decoding="async" />`, inspector: esc(image.caption) }) : C.sheetList({ ...frame, variant: 'reading', rows: C.panel('', note('PHOTO NOT AVAILABLE')) });
}

/** one release's bullets, with each screenshot inline where it belongs (lead pictures first), at the full column width */
function releaseBody(n) {
  const pictures = (match) => (n.images || []).filter(match).map((image) => C.articleFigure({ src: image.src, alt: image.alt, caption: image.caption, width: image.width || 1280, height: image.height || 800 })).join('');
  let out = pictures((image) => image.item == null), run = [];
  const flush = () => { if (run.length) out += C.articleList(run); run = []; };
  n.items.forEach((text, j) => {
    run.push(esc(text));
    const shots = pictures((image) => image.item === j);
    if (shots) { flush(); out += shots; }
  });
  flush();
  return out;
}

/** the What's new screen: every release, newest first, one section each on a single scrolling page */
export function renderWhatsNew(menu) {
  ensure(menu, 'release', 'release.json');
  const r = state.release, now = buildInfo().version, frame = { title: "WHAT'S NEW" };
  if (r === null) return article(menu, frame, note(`${C.spinner()} LOADING`));
  if (!r?.notes?.length) return article(menu, frame, note('RELEASE NOTES COME WITH PUBLISHED BUILDS'));
  return article(menu, frame, r.notes.map((n, i) => C.articleSection({ level: 'heading', id: 'release-' + n.version.replaceAll('.', '-'), title: esc(versionLabel(n.version)),
    meta: `${esc(formatDate(n.date))}${n.version === now ? C.chip('THIS VERSION', { tone: 'accent' }) : i === 0 ? C.chip('LATEST') : ''}`, body: releaseBody(n) })).join(''));
}

/** the Credits screen: the team, then each kind of credit; long attributions and licences open as their own page */
export function renderCredits(menu) {
  ensure(menu, 'credits', 'credits.json');
  const c = state.credits, frame = { title: 'CREDITS', hints: [['updown', 'SCROLL'], ['leftright', 'LINKS'], ['confirm', 'OPEN'], ['back', 'BACK']] };
  if (c === null) return article(menu, frame, note(`${C.spinner()} LOADING`));
  if (!c) return article(menu, frame, note('CREDITS COME WITH PUBLISHED BUILDS'));
  const text = (e, label, id, cls = 'ghost') => C.button({ label, iconRight: 'chevron-right', variant: cls, size: 'sm', act: 'creditFile', attrs: { 'data-credit': id } });
  const entry = (e) => C.articleEntry({ title: esc(e.title), desc: esc(e.detail || ''), credit: esc(e.credit || ''),
    side: (e.licences || []).map((l) => C.chip(esc(l))).join(''), links: (e.links || []).map((u) => C.articleLink(u)).filter(Boolean),
    actions: [e.text && text(e, e.extra?.length || e.file ? 'FULL CREDITS' : 'FULL ATTRIBUTION', e.id), ...(e.extra || []).map((x) => text(x, x.label.toUpperCase(), x.id))].filter(Boolean).join('') });
  const team = C.articleSection({ title: 'Team', body: `${c.team.map((m) => C.articleEntry({ title: esc(m.name), desc: esc(m.role),
    side: m.url ? C.articleLink(m.url, '@' + m.handle) : '' })).join('')}${c.ai ? `<p class="article-note">${esc(c.ai)}</p>` : ''}` });
  return article(menu, frame, team + c.sections.map((s) => C.articleSection({ title: esc(s.title), body: s.entries.map(entry).join('') })).join(''), legalLinks);
}

/** one credits / licence file, as readable paragraphs */
export function renderCreditFile(menu) {
  const all = state.credits?.sections?.flatMap((s) => s.entries.flatMap((e) => [e, ...(e.extra || []).map((x) => ({ ...x, title: `${e.title}: ${x.label.toLowerCase()}` }))])) || [];
  const entry = all.find((e) => e.id === menu.data.id);
  return article(menu, { title: esc(entry?.title || 'CREDITS'), kick: 'CREDITS', hints: [['updown', 'SCROLL'], ['back', 'BACK']] }, entry ? C.articleSection({ body: paragraphs(entry.text) }) : note('NOT AVAILABLE'));
}

// ---------------------------------------------------------------- title screen: version corner + one-time card
export function titleExtras(menu) {
  ensure(menu, 'release', 'release.json');
  settle(menu, false); // already rendering the title
  const b = buildInfo(), card = racing() ? null : state.card, more = card ? card.items.length - CARD_ITEMS : 0;
  return `<div class="title-meta">${b.version === DEV_VERSION ? '' : C.button({ label: versionLabel(b.version), variant: 'ghost', size: 'sm', act: 'whatsNew', cls: 'title-meta__btn', title: "What's new" })}${C.button({ label: 'CREDITS', variant: 'ghost', size: 'sm', act: 'credits', cls: 'title-meta__btn' })}</div>${card ? `
    ${C.panel(`WHAT'S NEW IN ${esc(versionLabel(card.version))}`, `<ul class="release__items">${card.items.slice(0, CARD_ITEMS).map((t) => `<li>${esc(t)}</li>`).join('')}</ul>${more > 0 ? `<p class="group__note">+ ${more} MORE IN WHAT'S NEW</p>` : ''}
      ${card.images?.length ? state.cardPictures ? gallery(card) : C.button({ label: `VIEW ${card.images.length} PHOTO${card.images.length === 1 ? '' : 'S'}`, variant: 'ghost', size: 'sm', act: 'newsPictures' }) : ''}
      <div class="field-actions">${C.button({ label: 'GOT IT', icon: 'check', variant: 'primary', size: 'sm', act: 'dismissNews' })}${C.button({ label: "WHAT'S NEW", variant: 'ghost', size: 'sm', act: 'whatsNew' })}</div>`, { cls: 'news-panel', right: `<span class="kick">${esc(formatDate(card.date))}</span>`, attrs: { 'aria-label': `What's new in ${card.version}` } })}` : ''}`;
}

// ---------------------------------------------------------------- hooks for src/menu.js
/** a menu action; true when handled here. Any action taken on the title with the card up counts as dismissing it. */
export function act(menu, el) {
  const a = el.dataset.act;
  if (menu.screen === 'title' && state.card && !['dismissNews', 'newsPictures', 'releaseImage'].includes(a)) { markSeen(null, state.card.version); state.card = null; }
  switch (a) {
    case 'newsPictures': state.cardPictures = true; menu.refresh(); return true;
    case 'releaseImage': menu.show('releaseImage', { version: el.dataset.release, image: Number(el.dataset.image) }, true); return true;
    case 'dismissNews': dismiss(menu); return true;
    case 'whatsNew': menu.show('whatsNew', {}, true); return true;
    case 'credits': menu.show('credits', {}, true); return true;
    case 'creditFile': menu.show('creditFile', { id: el.dataset.credit }, true); return true;
    case 'openLink': openExternal(el.dataset.url || ''); return true;
  }
  return false;
}
/** call once from the Menu constructor: the in-race footer's credits link, and an early fetch for the one-time card */
export function install(menu) {
  document.addEventListener('click', (e) => {
    const link = e.target.closest?.('a[data-credits]'); if (!link) return;
    e.preventDefault();
    if (!menu.open) window.__flow?.pause?.(); // like the in-race SETTINGS button: pause first, Back returns to the pause menu
    menu.show('credits', { from: menu.screen || 'pause' }, true);
  });
  const { version } = buildInfo();
  if (parseVersion(version)) {
    // a brand-new player's first launch is recorded straight away, so a failed fetch cannot turn them into a "returning" one
    if (whatsNewDecision({ version, seen: readSeen(), priorPlay: state.priorPlay }) === 'record') { markSeen(null, version); state.settled = true; }
    else ensure(menu, 'release', 'release.json');
  }
}
export const isReleaseScreen = (screen) => SCREENS.includes(screen);
