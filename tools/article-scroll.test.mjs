// Article pages (Credits, What's new): keys, page jumps and link stepping without a browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { articleAction, clearArticleFocus, jump } from '../src/ui/article-scroll.js';

const el = (cls = []) => ({ classList: { contains: (c) => cls.includes(c), remove: (c) => { cls = cls.filter((x) => x !== c); } }, scrollIntoView() {} });
function fake({ items = [], article = true } = {}) {
  const box = { scrollTop: 100, clientHeight: 400, scrollHeight: 3000, calls: [], scrollTo(o) { this.calls.push(o); }, querySelector: (q) => q === '.mi.focus' ? items.find((i) => i.classList.contains('focus')) : null };
  const menu = { open: true, focus: 0, items: () => items, h: { ui() {} }, setFocus(i) { items.forEach((it, k) => { it.classList.remove('focus'); if (k === i) it.on = true; }); this.focus = i; items.forEach((it, k) => { if (k === i) { const c = it.classList; it.classList = { contains: (x) => x === 'focus', remove() {} }; } }); },
    root: { querySelector: (q) => q === '[data-article-scroll]' && article ? box : null, querySelectorAll: () => items } };
  return { menu, box };
}

test('pages jump by most of a screen; Home and End go to the ends', () => {
  const { box } = fake();
  jump(box, 1); jump(box, -1); jump(box, 'top'); jump(box, 'end');
  assert.deepEqual(box.calls.map((c) => Math.round(c.top)), [440, -240, 0, 3000]);
});

test('up and down are glided per frame, so the menu action only swallows them; Q / E (LB / RB) page', () => {
  const { menu, box } = fake();
  assert.equal(articleAction(menu, 'up'), true); assert.equal(articleAction(menu, 'down'), true);
  assert.equal(box.calls.length, 0);
  assert.equal(articleAction(menu, 'shiftDown'), true); assert.equal(box.calls.length, 1);
  assert.equal(articleAction(fake({ article: false }).menu, 'up'), false, 'other screens keep their focus movement');
});

test('left / right step through the links and buttons; Enter does nothing until one is highlighted', () => {
  const items = [el(), el(), el()], { menu } = fake({ items });
  assert.equal(articleAction(menu, 'confirm'), true, 'nothing highlighted: swallowed, so an unseen button never opens');
  articleAction(menu, 'right'); assert.equal(menu.focus, 0);
  articleAction(menu, 'right'); assert.equal(menu.focus, 1);
  articleAction(menu, 'left'); articleAction(menu, 'left'); assert.equal(menu.focus, 2, 'wraps');
  assert.equal(menu.articleNavigated !== undefined, true);
});

test('a freshly drawn article clears the default highlight, a stepped-through one keeps it', () => {
  const lit = el(['focus']), { menu } = fake({ items: [lit] });
  clearArticleFocus(menu); assert.equal(lit.classList.contains('focus'), false);
  const again = el(['focus']), second = fake({ items: [again] });
  second.menu.articleNavigated = second.box;
  clearArticleFocus(second.menu); assert.equal(again.classList.contains('focus'), true);
});
