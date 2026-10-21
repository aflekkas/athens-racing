// node launch-sheet.mjs BEFORE_DIR AFTER_DIR OUT.webp : per scenario, the first frame (600 ms) and the settled screen, before and after
import { readFileSync } from 'node:fs';
const sharp = (await import('/home/dev/projects/paraliaki-racing/node_modules/sharp/dist/index.cjs')).default;
const [bd, ad, out] = process.argv.slice(2), W = 288, H = 180, G = 8, L = 360, names = ['signed-in', 'returning', 'signed-out', 'expired', 'offline', 'slow', 'slow-returning'];
const tl = d => JSON.parse(readFileSync(d + '/launch.json', 'utf8')), B = tl(bd), A = tl(ad), comp = [];
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
for (const [y, n] of names.entries()) {
  const parts = r => (r[n] || []).map(s => `${(s.t / 1000).toFixed(1)}s ${s.what.replace('SCREEN:scr--', '').replace('BOOT:', 'launch: ').toLowerCase()}`);
  const wrap = r => { const out = ['']; for (const p of parts(r)) { const next = out.at(-1) ? out.at(-1) + ' → ' + p : p; if (next.length > 58 && out.at(-1)) out.push('→ ' + p); else out[out.length - 1] = next; } return [...out, '', ''].slice(0, 2); };
  const line = r => wrap(r).join('\u0000');
  comp.push({ input: Buffer.from(`<svg width="${L}" height="${H}"><text x="8" y="28" font-family="sans-serif" font-size="18" fill="#e4effa">${n}</text>
    <text x="8" y="60" font-family="sans-serif" font-size="11" fill="#8fa3b3">before: ${esc(wrap(B)[0])}</text><text x="8" y="76" font-family="sans-serif" font-size="11" fill="#8fa3b3">${esc(wrap(B)[1])}</text>
    <text x="8" y="104" font-family="sans-serif" font-size="11" fill="#cfe3f2">after: ${esc(wrap(A)[0])}</text><text x="8" y="120" font-family="sans-serif" font-size="11" fill="#cfe3f2">${esc(wrap(A)[1])}</text></svg>`), left: 0, top: G + y * (H + G) });
  for (const [x, f] of [bd + `/${n}-early.png`, bd + `/${n}-final.png`, ad + `/${n}-early.png`, ad + `/${n}-final.png`].entries())
    comp.push({ input: await sharp(f).resize(W, H).toBuffer(), left: L + x * (W + G) + (x >= 2 ? 24 : 0), top: G + y * (H + G) });
}
await sharp({ create: { width: L + 4 * (W + G) + 24, height: G + names.length * (H + G), channels: 3, background: '#05080b' } }).composite(comp).webp({ quality: 78 }).toFile(out);
console.log(out);
