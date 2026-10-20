// node evidence.mjs <screen>... : before/<s>/*.png (or before-race/) + after/<s>/*.png -> <s>/{before,after}-<w>x<h>.webp (lossy q82, the commit evidence)
import { mkdirSync, existsSync, readdirSync } from 'node:fs';
const sharp = (await import('/home/dev/projects/paraliaki-racing/node_modules/sharp/dist/index.cjs')).default;
const here = new URL('.', import.meta.url).pathname;
for (const s of process.argv.slice(2)) {
  mkdirSync(here + s, { recursive: true });
  for (const phase of ['before', 'after']) for (const root of [phase, phase + '-race']) {
    const dir = `${here}${root}/${s}`; if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir).filter(f => f.endsWith('.png'))) {
      const size = f.match(/(\d+x\d+)\.png$/)[1];
      await sharp(`${dir}/${f}`).webp({ quality: 82 }).toFile(`${here}${s}/${phase}-${size}.webp`);
    }
  }
  console.log(s, readdirSync(here + s).join(' '));
}
