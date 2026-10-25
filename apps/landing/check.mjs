import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
const root=dirname(fileURLToPath(import.meta.url)),pub=resolve(root,'public');
const manifest=JSON.parse(await readFile(resolve(root,'manifest.json')));
let files=0;
for(const [path,expected] of Object.entries(manifest.files)){
 const bytes=await readFile(resolve(pub,path));assert.equal(bytes.length,expected.bytes,path);assert.equal(createHash('sha256').update(bytes).digest('hex'),expected.sha256,path);files++;
}
const html=await readFile(resolve(pub,'index.html'),'utf8'),css=await readFile(resolve(pub,'styles.css'),'utf8');
const meta=new Map([...html.matchAll(/<meta (?:property|name)="([^"]+)" content="([^"]*)"/g)].map(m=>[m[1],m[2]]));
for(const key of ['og:title','og:description','og:type','og:url','og:site_name','og:image','og:image:alt','twitter:title','twitter:description','twitter:image','twitter:image:alt'])assert.ok(meta.get(key),key);
assert.equal(meta.get('og:url'),'https://athensracing.com/');assert.equal(meta.get('og:image'),'https://athensracing.com/assets/athens-racing-share.jpg');assert.equal(meta.get('twitter:card'),'summary_large_image');assert.equal(meta.get('twitter:image'),meta.get('og:image'));assert.equal(meta.get('og:image:width'),'1200');assert.equal(meta.get('og:image:height'),'630');assert.match(html,/<link rel="canonical" href="https:\/\/athensracing.com\/">/);
const jpg=await readFile(resolve(pub,'assets/athens-racing-share.jpg'));let size;for(let i=2;i<jpg.length;){if(jpg[i]!==255){i++;continue;}const marker=jpg[i+1];if(marker>=0xc0&&marker<=0xc3){size=[jpg.readUInt16BE(i+7),jpg.readUInt16BE(i+5)];break;}i+=2+jpg.readUInt16BE(i+2);}assert.deepEqual(size,[1200,630]);
const png=await readFile(resolve(pub,'assets/apple-touch-icon.png'));assert.deepEqual([png.readUInt32BE(16),png.readUInt32BE(20)],[180,180]);
assert.match(html,/connect-src 'none'/);assert.doesNotMatch(html,/\.scratch|\.\.\/|TBD|To be measured|state=available|<audio|<iframe/);
const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(x=>x[1]);assert.equal(new Set(ids).size,ids.length,'unique IDs');
for(const match of html.matchAll(/\b(?:href|src)="([^"]+)"/g)){
 const path=match[1];if(path.startsWith('#')){assert.ok(ids.includes(path.slice(1)),'fragment '+path);continue;}if(path.startsWith('https://'))continue;assert.ok(manifest.files[path],'local asset '+path);
}
for(const match of html.matchAll(/<img\b[^>]*>/g))assert.match(match[0],/\balt="[^"]*"/);
assert.ok(!css.includes('@import'));assert.match(css,/stroke-dashoffset: 0/);
const script=await readFile(resolve(pub,'downloads.js'),'utf8');
function run(artifact,version='1.0'){
 const links=[];const node=()=>({className:'dl-btn',append(){},cloneNode(){return this;},set textContent(value){},replaceWith(value){links.push(value);}});
 const card={dataset:{os:'mac'},classList:{add(){}},querySelector(selector){if(selector==='.dl-btn'){const button=node();button.querySelector=()=>node();return button;}if(selector==='.dl-meta')return{replaceChildren(){},append(){}};return node();}};
 const document={querySelectorAll:()=>[card],createElement:()=>node(),getElementById:()=>node()};
 vm.runInNewContext(script,{window:{ATHENS_RELEASE:{version,artifacts:{mac:artifact}}},document,URL,Number});return links;
}
const valid={url:'https://github.com/aflekkas/athens-racing/releases/download/v1/test.dmg',sha256:'a'.repeat(64),bytes:42,nativeVerified:true,file:'DMG'};
let cases=0;assert.equal(run(valid).length,1);cases++;
for(const value of [{},{...valid,nativeVerified:false},{...valid,sha256:'x'},{...valid,bytes:0},{...valid,url:'https://evil.test/release.dmg'},{...valid,url:'javascript:alert(1)'},{...valid,url:'https://github.com/another/repo/releases/download/v1/test.exe'},{...valid,url:valid.url+'?token=x'},{...valid,url:valid.url+'#hash'},{...valid,url:'https://user@github.com/aflekkas/athens-racing/releases/download/v1/test.dmg'}]){assert.equal(run(value).length,0);cases++;}
assert.equal(run(valid,null).length,0);cases++;
console.log(JSON.stringify({filesVerified:files,downloadCases:cases,staticChecks:'passed'}));
