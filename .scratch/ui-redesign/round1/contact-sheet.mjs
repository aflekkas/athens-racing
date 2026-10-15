import fs from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium} from '/tmp/pw/node_modules/playwright/index.mjs';
const out=resolve(process.argv[2] || new URL('.',import.meta.url).pathname);
const embed=async(phase,name,width)=>'data:image/png;base64,'+(await fs.readFile(resolve(out,phase,`${name}-${width}.png`))).toString('base64');
const names=[['garage','GARAGE'],['setup','RACE SETUP'],['settings-video','VIDEO SETTINGS']];
const rows=[];
for(const [name,label] of names){const imgs=[];for(const [phase,width] of [['before',1280],['after',1280],['before',390],['after',390]])imgs.push(`<figure><figcaption>${phase.toUpperCase()} · ${width}</figcaption><img src="${await embed(phase,name,width)}"></figure>`);rows.push(`<section><h2>${label}</h2><div class="row">${imgs.join('')}</div></section>`);}
const html=`<!doctype html><meta charset="utf-8"><style>body{margin:0;padding:22px;background:#0b141a;color:#f3f6ef;font:12px Arial}h1{font-size:24px;margin:0 0 8px}p{color:#bbc9cf}h2{font-size:15px;letter-spacing:.12em;margin:26px 0 12px}.row{display:grid;grid-template-columns:440px 440px 200px 200px;gap:12px}figure{margin:0}figcaption{font-size:10px;letter-spacing:.12em;margin-bottom:8px;color:#dcfa4c}img{display:block;width:100%}</style><h1>ATHENS RACING / ROUND ONE</h1><p>Baseline: 694a9cf · Garage, Race setup and Video settings · 1280×720 / 390×844</p>${rows.join('')}`;
await fs.writeFile(resolve(out,'contact-sheet.html'),html);
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});try{const page=await browser.newPage({viewport:{width:1360,height:900},deviceScaleFactor:1});await page.setContent(html);await page.evaluate(()=>Promise.all([...document.images].map(i=>i.decode())));await page.screenshot({path:resolve(out,'contact-sheet.png'),fullPage:true});}finally{await browser.close();}
