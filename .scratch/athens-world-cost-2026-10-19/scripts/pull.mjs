import {mkdir,writeFile} from 'node:fs/promises';import {createHash} from 'node:crypto';
const app=process.argv[2],out=process.argv[3],key=process.argv[4];
const {credentials,apiClient,STAGING}=await import(app+'/tools/world-r2.mjs');
const api=apiClient(await credentials());
const manifestBytes=Buffer.from(await (await api(STAGING,'/'+key)).arrayBuffer());
if(createHash('sha256').update(manifestBytes).digest('hex')!==key.slice(10,74))throw Error('manifest hash mismatch');
const m=JSON.parse(manifestBytes);await mkdir(out+'/world/cells',{recursive:true});await writeFile(out+'/manifest.json',manifestBytes);
let n=0,bytes=0;
for(const e of Object.values(m.tiles)){const k=e.url.replace('/world/','');const b=Buffer.from(await (await api(STAGING,'/'+k)).arrayBuffer());
 if(createHash('sha256').update(b).digest('hex')!==e.sha256||b.length!==e.bytes)throw Error('cell hash mismatch '+k);await writeFile(out+'/world/'+k,b);n++;bytes+=b.length;}
console.log('pulled',n,'cells',bytes,'bytes');
