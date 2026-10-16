import sharp from 'sharp';
import fs from 'node:fs/promises';
const root=new URL('../.scratch/detail-pass/',import.meta.url),report=JSON.parse(await fs.readFile(new URL('budgets.json',root)));
for(const r of report.rows){
 const input=[];
 for(const [i,key] of ['before','off','on'].entries()){
  input.push({input:await fs.readFile(new URL(r[key].name+'.png',root)),left:i*800,top:36});
  input.push({input:Buffer.from(`<svg width="800" height="36"><rect width="800" height="36" fill="#151e24"/><text x="12" y="24" font-family="sans-serif" font-size="18" fill="white">${key==='before'?'Production baseline':key==='off'?'World detail Off':'World detail On'} — ${r.name}</text></svg>`),left:i*800,top:0});
 }
 await sharp({create:{width:2400,height:536,channels:3,background:'#151e24'}}).composite(input).webp({quality:86}).toFile(new URL('review-'+r.name+'.webp',root).pathname);
}
const r=report.rows.find(r=>r.name==='psychiko-mid-day-chase');
await sharp(new URL('review-'+r.name+'.webp',root).pathname).extract({left:800,top:0,width:1600,height:536}).resize(1200).webp({quality:86}).toFile(new URL('../assets/changelog/2026.10.16.1/world-detail.webp',import.meta.url).pathname);
for(const place of ['riviera-start','riviera-mid','penteli-mid','megara-overview','psychiko-mid']){
 const rows=report.rows.filter(r=>r.name.startsWith(place));const inputs=[];
 for(const [i,r] of rows.entries())inputs.push({input:await fs.readFile(new URL('review-'+r.name+'.webp',root)),top:i*536,left:0});
 await sharp(await sharp({create:{width:2400,height:rows.length*536,channels:3,background:'#151e24'}}).composite(inputs).png().toBuffer()).resize(1800).webp({quality:87}).toFile(new URL('review-all-'+place+'.webp',root).pathname);
}
