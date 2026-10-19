import sharp from '/home/dev/projects/paraliaki-racing/node_modules/sharp/dist/index.cjs';
const P='/home/dev/data/athens-world-cache/p3',D=process.argv[2];
const set=[['shots-d/d-street-piraeus','street-piraeus'],['shots-d/d-street-faliro','street-faliro'],['shots-d/d-junction-faliro','junction-faliro'],['shots-c/c-port-basin','port-harbour'],['shots-d/d-overview','overview-faliro-coast'],['shots-d/d-deck-car','bridge-deck'],['shots-d/d-deck-side','bridge-deck-rail-side'],['shots-d/d-above','bridge-above'],['shots-d/d-under','bridge-under']];
for(const [s,n] of set){const i=await sharp(`${P}/${s}.png`).webp({quality:82}).toFile(`${D}/${n}.webp`);console.log(n,i.size,i.width+'x'+i.height);}
