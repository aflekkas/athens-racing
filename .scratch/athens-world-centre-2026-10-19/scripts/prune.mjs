// List (and with --delete, remove) the OLD COAST objects of the staging bucket: referenced by the first coast manifest
// and by neither the manifest the repo's wrangler var currently points at (Piraeus) nor the new one. Nothing else is touched.
import {credentials,apiClient,inventory,STAGING} from '/home/dev/data/athens-world-cache/wt-centre/tools/world-r2.mjs';
const [oldCoast,piraeus,current]=process.argv.slice(2,5),doDelete=process.argv.includes('--delete');
const api=apiClient(await credentials());
const refs=async key=>{const m=JSON.parse(Buffer.from(await (await api(STAGING,'/'+key)).arrayBuffer()));return new Set([key,...Object.values(m.tiles).map(e=>e.url.replace('/world/',''))]);};
const [A,B,C]=await Promise.all([refs(oldCoast),refs(piraeus),refs(current)]);
const inv=await inventory(api,STAGING);const keep=new Set([...B,...C]);
const victims=inv.filter(o=>A.has(o.key)&&!keep.has(o.key));const others=inv.filter(o=>!A.has(o.key)&&!keep.has(o.key));
console.log(JSON.stringify({bucketObjects:inv.length,bucketBytes:inv.reduce((n,o)=>n+o.size,0),oldCoastReferenced:A.size,pruneCandidates:victims.length,pruneBytes:victims.reduce((n,o)=>n+o.size,0),unreferencedOther:others.length,keptByPiraeusOrCurrent:inv.filter(o=>keep.has(o.key)).length,missingFromBucket:[...keep].filter(k=>!inv.some(o=>o.key===k)).length}));
console.log(victims.slice(0,5).map(o=>o.key).join('\n'),'...',victims.at(-1)?.key);
if(doDelete){let n=0;for(const o of victims){await api(STAGING,'/'+o.key,{method:'DELETE'});n++;}console.log('deleted',n);const after=await inventory(api,STAGING);console.log(JSON.stringify({objects:after.length,bytes:after.reduce((x,o)=>x+o.size,0),stillReferencedMissing:[...keep].filter(k=>!after.some(o=>o.key===k)).length}));}
