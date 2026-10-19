import sharp from '/home/dev/projects/paraliaki-racing/node_modules/sharp/dist/index.cjs';
const H='/home/dev/data/athens-world-cache/h',D=process.argv[2];
const set=[['shots/syntagma','syntagma-street'],['shots/syntagma-above','syntagma-above'],['shots/omonia','omonia-street'],['shots/omonia-above','omonia-above'],['shots/plaka','plaka-street'],['shots2/syngrou','syngrou-avenue'],['shots2/syngrou-above','syngrou-above'],['shots/overview','overview-centre-acropolis']];
for(const [s,n] of set){const i=await sharp(`${H}/${s}.png`).webp({quality:82}).toFile(`${D}/${n}.webp`);console.log(n,i.size,i.width+'x'+i.height);}
