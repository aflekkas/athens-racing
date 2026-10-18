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
