import fs from 'node:fs/promises';import sharp from 'sharp';
const files=(await fs.readdir('.scratch/dash-logos')).filter(f=>/^after-.*-hub.png$/.test(f)),ids=files.map(f=>f.slice(6,-8));
for(let start=0;start<ids.length;start+=6){const tiles=[];for(const [row,id]of ids.slice(start,start+6).entries())for(const [col,view]of ['hub','front','rear'].entries()){
 const path=`.scratch/dash-logos/after-${id}-${view}.png`;tiles.push({input:await sharp(path).extract({left:480,top:275,width:480,height:450}).resize(360,338).png().toBuffer(),left:col*360,top:row*360});tiles.push({input:Buffer.from(`<svg width="360" height="22"><rect width="360" height="22" fill="#111820"/><text x="8" y="16" fill="white" font-size="14">${id} / ${view}</text></svg>`),left:col*360,top:row*360+338});}
 await sharp({create:{width:1080,height:Math.min(6,ids.length-start)*360,channels:4,background:'#111820'}}).composite(tiles).png().toFile(`.scratch/dash-logos/badges-contact-${start/6+1}.png`);
}
