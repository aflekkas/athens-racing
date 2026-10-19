import sharp from '/home/dev/projects/paraliaki-racing/node_modules/sharp/dist/index.cjs';
import {readdirSync} from 'node:fs';
const [from,to]=process.argv.slice(2);
for(const f of readdirSync(from).filter(n=>n.endsWith('.png'))){const i=await sharp(`${from}/${f}`).webp({quality:82}).toFile(`${to}/${f.replace('.png','.webp')}`);console.log(f,i.size,i.width+'x'+i.height);}
