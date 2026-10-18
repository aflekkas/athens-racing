import fs from 'node:fs/promises';import {createHash} from 'node:crypto';import {inflateSync} from 'node:zlib';
// Cabin follow-up evidence lives together; unchanged PNGs reuse the original
// catalogue capture instead of duplicating hundreds of binary artifacts.
export const POV_EVIDENCE_DIR='.scratch/cabin-fixes/evidence';
export async function readPovEvidence(name){
 try{return await fs.readFile(POV_EVIDENCE_DIR+'/'+name);}catch(e){if(e.code!=='ENOENT')throw e;return fs.readFile('.scratch/pov-camera/'+name);}
}
const hash=s=>createHash('sha256').update(s).digest('hex');
export async function povSourceHashes(){
 const names=(await fs.readdir('src')).filter(n=>/^(cars|car-catalog|vehicle-.*|glass-tint|player-.*|traffic-.*-models|police-models|cockpit.*|fleet-(cockpit|interiors|instruments)|pov-.*|seat-position)\.js$/.test(n)).map(n=>'src/'+n).sort();
 names.push('tools/pov-mask.js','tools/cockpit-structure-mask.js','tools/pov-audit.js','src/brand-badges.js','src/manufacturers.js','assets/brand-badges/atlas.svg');const hashes={};for(const n of names)hashes[n]=hash(await fs.readFile(n));
 const {TEXTURE_MANIFEST}=await import('../src/texture-manifest.js');const badge=TEXTURE_MANIFEST['/assets/brand-badges/atlas.svg'];hashes['src/texture-manifest.js#badge']=hash(JSON.stringify(badge)+hash(await fs.readFile('.'+badge.url)));
 const weather=await fs.readFile('src/weather.js','utf8');hashes['src/weather.js#cockpit-rain']=hash(weather.slice(weather.indexOf('// ---- drops on the cockpit windscreen'),weather.indexOf('// ------------------------------------------------------------------ state'))+weather.slice(weather.indexOf('  // ---- windscreen drops (cockpit view only)')));
 const main=await fs.readFile('src/main.js','utf8'),eye=main.indexOf('const eye = player.cockpit.eye'),start=main.lastIndexOf("if (G.cam === 'cockpit')",eye),end=main.indexOf("} else if (G.cam === 'chase')",eye);
 if(start<0||end<0)throw Error('POV guard cannot locate the live camera branch; review docs/OWNER-DECISIONS.md');
 hashes['src/main.js#cockpit-camera']=hash(main.slice(start,end));return hashes;
}
export function readMaskPNG(png){
 let width,height,channels,depth;const idat=[];
 for(let p=8;p<png.length;){const n=png.readUInt32BE(p),type=png.toString('ascii',p+4,p+8),data=png.subarray(p+8,p+8+n);if(type==='IHDR'){width=data.readUInt32BE(0);height=data.readUInt32BE(4);depth=data[8];channels=data[9]===6?4:data[9]===2?3:0;if(data[12])throw Error('Interlaced mask unsupported');}if(type==='IDAT')idat.push(data);p+=12+n;}
 if(depth!==8||!channels)throw Error('Expected an 8-bit RGB(A) mask PNG');
 const raw=inflateSync(Buffer.concat(idat)),stride=width*channels;let prior=new Uint8Array(stride),openPixels=0,p=0;
 const rgb=new Uint8Array(width*height*3);
 const paeth=(a,b,c)=>{const v=a+b-c,aa=Math.abs(v-a),bb=Math.abs(v-b),cc=Math.abs(v-c);return aa<=bb&&aa<=cc?a:bb<=cc?b:c;};
 for(let y=0;y<height;y++){const filter=raw[p++],row=new Uint8Array(stride);for(let x=0;x<stride;x++){const a=x>=channels?row[x-channels]:0,b=prior[x],c=x>=channels?prior[x-channels]:0;row[x]=(raw[p++]+(filter===0?0:filter===1?a:filter===2?b:filter===3?Math.floor((a+b)/2):filter===4?paeth(a,b,c):NaN))&255;}for(let x=0;x<stride;x+=channels)if(row[x]>250&&row[x+1]>250&&row[x+2]>250)openPixels++;for(let x=0;x<width;x++)rgb.set(row.subarray(x*channels,x*channels+3),(y*width+x)*3);prior=row;}
 return {rgb,width,height,openPixels,totalPixels:width*height,windscreenPercent:100*openPixels/(width*height)};
}

export function countMaskPNG(png){const {rgb,...counts}=readMaskPNG(png);return counts;}
