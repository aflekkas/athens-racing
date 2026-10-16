import fs from 'node:fs/promises';import sharp from 'sharp';
const out='.scratch/real-interiors',mode=process.argv[2]||'fixture';await fs.mkdir(out+'/sheets',{recursive:true});
const rows=JSON.parse(await fs.readFile(mode==='fixture'?'.scratch/pov-camera/mask-audit.json':out+'/after-world.json'));
const escape=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;');
for(let start=0;start<rows.length;start+=4){const batch=rows.slice(start,start+4),width=1280,height=mode==='fixture'?864:1728,tiles=[];
 for(let i=0;i<batch.length;i++){const id=batch[i].id,phases=mode==='fixture'?['after']:['before','after'],weathers=mode==='fixture'?['fixture']:['dry'];
  for(let p=0;p<phases.length;p++)for(let w=0;w<weathers.length;w++){const col=mode==='fixture'?i%2:w*2+p,row=mode==='fixture'?Math.floor(i/2):i,tw=640,th=400,x=col*tw,y=row*(th+32),label=id+' · '+phases[p]+' · '+weathers[w];
   const file=mode==='fixture'?'.scratch/pov-camera/after-'+id+'-image.png':out+'/'+phases[p]+'-'+id+'-'+weathers[w]+'.webp';tiles.push({input:await sharp(file).resize(tw,th).toBuffer(),left:x,top:y+32});tiles.push({input:Buffer.from(`<svg width="${tw}" height="32"><rect width="100%" height="100%" fill="#15191d"/><text x="12" y="22" font-size="18" font-family="sans-serif" fill="white">${escape(label)}</text></svg>`),left:x,top:y});
  }
 }
 await sharp({create:{width,height,channels:3,background:'#15191d'}}).composite(tiles).webp({quality:93}).toFile(out+'/sheets/'+mode+'-'+String(start/4+1).padStart(2,'0')+'.webp');
}
