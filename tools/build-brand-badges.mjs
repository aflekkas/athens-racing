// Rebuild the shared texture without resampling or changing source aspect ratios.
import fs from 'node:fs/promises';
import { BRAND_BADGES } from '../src/brand-badges.js';
const root=new URL('../assets/brand-badges/',import.meta.url),parts=['<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">'];
for(const [brand,{cell}] of Object.entries(BRAND_BADGES)){
 const source=await fs.readFile(new URL(brand+'.svg',root),'utf8');
 if(!source.includes('viewBox="0 0 24 24"'))throw new Error(`${brand}: normalise the viewBox uniformly before packing`);
 const body=source.replace(/^.*?<title>.*?<\/title>/s,'').replace(/<\/svg>\s*$/,'');
 const shield=['lamborghini','porsche'].includes(brand),colour=shield?'#dfbd70':'#e6ebef';
 const outline=shield?body.match(/d="([^"]+?[zZ])/)[1]:null;
 const backing=outline?`<path fill="#101215" d="${outline}"/>`:'';
 parts.push(`<g transform="translate(${cell%4*128+22} ${Math.floor(cell/4)*128+22}) scale(3.5)" fill="${colour}">${backing}${body}</g>`);
}
parts.push('<g transform="translate(406 406)" fill="none" stroke="#d3dce5" stroke-width="6"><circle cx="42" cy="42" r="34"/><path d="M18 58L42 20 66 58Z"/></g></svg>');
await fs.writeFile(new URL('atlas.svg',root),parts.join(''));
