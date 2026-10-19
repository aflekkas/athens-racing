import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../src/ui/components.js';
const cases = [
 ['heroTiles', 'hero-tiles', { hero: 'PRIMARY', tiles: 'SECONDARY' }, ['primary','tiles']],
 ['sidebarContent', 'sidebar-content', { nav: 'NAVIGATION', content: 'CONTENT' }, ['nav','content']],
 ['browseGrid', 'browse-grid', { filters: 'FILTERS', items: 'ITEMS' }, ['filters','items']],
 ['stageInspector', 'stage-inspector', { stage: 'VIEWER', inspector: 'INSPECTOR' }, ['stage','inspector']],
 ['mapStage', 'map-stage', { stage: 'MAP', card: 'CARD' }, ['map','map-card']],
 ['sheetList', 'sheet-list', { rows: 'ROWS', aside: 'ASIDE', actions: 'ACTIONS' }, ['rows','aside','actions']],
];
for (const [builder, name, slots, regions] of cases) test(`${builder} owns its frame and places each slot once`, () => {
 const html = C[builder]({ ...slots, title:'TEST TITLE', kick:'TEST BREADCRUMB', hints:[['back','RETURN']], body:'UNSUPPORTED_BODY', head:'UNSUPPORTED_HEAD', account:true });
 assert.equal((html.match(/class="scr /g)||[]).length,1);
 assert.match(html,new RegExp(`data-layout="${name}"`));
 for (const region of regions) assert.match(html,new RegExp(`data-layout-region="${region}"`));
 for (const value of Object.values(slots)) assert.equal(html.split(value).length-1,1);
 for (const text of ['scr__back','TEST BREADCRUMB','TEST TITLE','scr__foot','RETURN']) assert.ok(html.includes(text));
 assert.doesNotMatch(html,/UNSUPPORTED_|hu-driver|hu-clock/);
});
test('optional regions disappear; row collections use the list variant',()=>{
 assert.doesNotMatch(C.browseGrid(),/data-layout-region="filters"/);
 assert.doesNotMatch(C.sheetList(),/data-layout-region="(?:aside|actions)"/);
 assert.match(C.browseGrid({list:true}),/layout__items--list/);
});
test('content retains its action and focus identifiers; escaped driver names stay escaped',()=>{
 const html=C.sheetList({actions:C.button({label:'RETRY',act:'retry',attrs:{'data-fid':'retry-race'}}),back:false,rows:C.esc('<driver>')});
 assert.match(html,/data-act="retry"/);assert.match(html,/data-fid="retry-race"/);
 assert.match(html,/&lt;driver&gt;/);assert.doesNotMatch(html,/scr__back/);
});

test('pause uses the inset reference header and one shared full-screen sheet', () => {
  const html = C.sheetList({ variant: 'pause', title: 'PAUSED', kick: 'QUICK RACE', status: '01:24.50', rows: C.option({ title: 'RESUME', act: 'resume' }), actions: C.button({ label: 'CONTROLS', act: 'controls' }), hints: [['back', 'RESUME']] });
  assert.match(html, /data-layout="sheet-list"/); assert.match(html, /sheet-head__title[^>]*>PAUSED/);
  assert.match(html, /sheet-head__status/); assert.match(html, /pause-sheet/);
  assert.match(html, /data-layout-region="rows"/); assert.match(html, /data-layout-region="actions"/);
  assert.doesNotMatch(html, /role="dialog"|hu-driver|hu-clock/);
});

test('split sheets keep actions with the summary and supporting panels in an aside', () => {
 const html=C.sheetList({variant:'split',rows:'SUMMARY',actions:'RETRY',aside:'SPLITS'});
 assert.match(html,/layout--sheet-list-split/);
 assert.ok(html.indexOf('SUMMARY') < html.indexOf('RETRY'));
 assert.ok(html.indexOf('RETRY') < html.indexOf('SPLITS'));
 for (const slot of ['rows','actions','aside']) assert.match(html,new RegExp('data-layout-region="'+slot+'"'));
});

test('reading sheets own the scroll region and media stages own their figure/caption', () => {
 assert.match(C.sheetList({variant:'reading',rows:C.panel('', 'READ')}),/scr__body" data-layout-region="rows"/);
 const media=C.stageInspector({variant:'media',stage:'IMAGE',inspector:'CAPTION'});
 assert.match(media,/<figure[^>]+>IMAGE<figcaption data-layout-region="inspector">CAPTION<\/figcaption><\/figure>/);
});

test('profile layouts retain action slots and the sign-in exception owns its shell', () => {
 assert.match(C.sidebarContent({variant:'balanced',nav:'PROFILE',content:'FRIENDS'}),/layout-sidebar-balanced/);
 assert.match(C.sheetList({variant:'narrow',rows:'FORM'}),/layout-sheet-narrow/);
 assert.match(C.dialog({fullScreen:true}),/data-layout="dialog"/);
 assert.doesNotMatch(C.dialog(),/scr--signin/);
});

test('filtered browsers keep categories before the filter rail and announce result loading', () => {
 const html=C.browseGrid({variant:'filtered',filters:'TABS',aside:'FILTERS',items:'RESULTS',busy:true});
 assert.ok(html.indexOf('TABS')<html.indexOf('FILTERS'));
 assert.match(html,/aria-live="polite" aria-busy="true"/);
});

test('overview stages keep their actions in the shared footer', () => {
 const html=C.stageInspector({variant:'overview',stage:'TRACK',inspector:'TIMES',actions:'RACE'});
 assert.ok(html.indexOf('scr__foot')<html.indexOf('RACE'));
 assert.match(html,/data-layout-region="inspector"/);
});

test('catalogues and vehicle stages retain renderer hooks inside kit-owned regions', () => {
 const html=C.stageInspector({variant:'vehicle',stage:'VIEWER',stageAttrs:{id:'carStage','aria-label':'A & B'},inspector:'SPECS'});
 assert.match(html,/id="carStage"/);assert.match(html,/aria-label="A &amp; B"/);
 assert.match(C.browseGrid({variant:'catalog',filters:'FILTER',items:'CARS'}),/catalog-toolbar" data-layout-region="filters"/);
});

test('rail layout owns section navigation and the scrolling content panel', () => {
 const html=C.sidebarContent({variant:'rail',nav:C.nav({key:'section',options:[['about','ABOUT']]}),content:'CONTENT'});
 assert.match(html,/class="scr__headr" data-layout-region="nav"/);
 assert.match(html,/class="set-panel panel scroll-y" data-layout-region="content">CONTENT/);
 assert.equal((html.match(/data-layout="sidebar-content"/g)||[]).length,1);
});

test('floating maps own the stage, navigation and live scrolling card', () => {
 const html=C.mapStage({variant:'floating',stage:'CANVAS',stageAttrs:{role:'img','aria-label':'Map & routes'},nav:'PREV NEXT',card:'DETAILS',cardAttrs:{'data-map':'riviera'}});
 assert.match(html,/data-layout-region="map" role="img" aria-label="Map &amp; routes"/);
 assert.match(html,/data-layout-region="map-card" data-map="riviera"/);
 assert.match(html,/aria-live="polite" data-layout-region="content">DETAILS/);
 assert.doesNotMatch(html,/role="dialog"/);
});

test('lobby, track and showroom profiles own their page regions and renderer mount', () => {
 const lobby=C.browseGrid({variant:'lobby',join:'CODE',identity:'DRIVER',actions:'HOST',items:'LOBBIES'});
 assert.ok(lobby.indexOf('CODE')<lobby.indexOf('DRIVER')&&lobby.indexOf('DRIVER')<lobby.indexOf('HOST'));
 assert.match(lobby,/layout--browse-grid layout--browse-grid-lobby/);
 assert.match(C.stageInspector({variant:'tracks',stage:'TRACKS'}),/class="mp-tracks scroll-y" data-layout-region="collection">TRACKS/);
 assert.doesNotMatch(C.stageInspector({variant:'tracks',stage:'EMPTY',collection:false}),/class="mp-tracks/);
 assert.match(C.stageInspector({variant:'showroom',summary:'CAR'}),/id="carStage" class="mp-stage" data-ui-keep="stage"/);
 assert.match(C.sheetList({variant:'form',rows:'RULES'}),/data-layout-region="rows">RULES/);
});

test('article pages scroll as one region under the shared header and hints, with a centred reading column', () => {
 const html = C.sheetList({ variant: 'article', title: 'CREDITS', kick: 'ABOUT', hints: [['updown', 'SCROLL']], rows: C.articleSection({ title: 'Team', body: C.articleEntry({ title: 'Ada', desc: 'Maker', side: 'SIDE', links: [C.articleLink('https://example.com/a')] }) }), actions: 'FOOT' });
 assert.match(html, /data-layout="sheet-list"/); assert.match(html, /layout--sheet-list-article/);
 assert.equal((html.match(/data-article-scroll/g) || []).length, 1, 'exactly one scrolling region');
 assert.match(html, /class="layout-article scroll-y" data-layout-region="rows"[^>]*><article class="layout-article__column">/);
 assert.ok(html.indexOf('scr__head') < html.indexOf('layout-article') && html.indexOf('layout-article') < html.indexOf('scr__foot'), 'header and key hints stay outside the scroller');
 assert.ok(html.indexOf('Team') < html.indexOf('Ada') && html.indexOf('FOOT') < html.indexOf('</article>'));
 assert.match(html, /<a class="article-link" href="https:\/\/example\.com\/a" target="_blank" rel="noopener">https:\/\/example\.com\/a<\/a>/, 'the address is its own visible label');
 assert.equal(C.articleLink('javascript:alert(1)'), '', 'only https links');
 assert.doesNotMatch(html, /hu-driver|hu-clock/);
});

test('article figures reserve their size, lazy-load, and escape text', () => {
 const html = C.articleFigure({ src: 'assets/x.webp', alt: 'A "car"', caption: '<b>', width: 1280, height: 720 });
 assert.match(html, /loading="lazy" decoding="async" width="1280" height="720"/);
 assert.match(html, /alt="A &quot;car&quot;"/); assert.match(html, /&lt;b&gt;/);
 assert.match(C.articleList(['one', 'two']), /<ul class="article-list"><li>one<\/li><li>two<\/li><\/ul>/);
 assert.equal((C.articleEntry({ title: 'T', credit: 'a\nb' }).match(/article-entry__credit/g) || []).length, 2, 'each credit line is its own paragraph');
});
