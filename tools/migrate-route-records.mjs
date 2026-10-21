// Read-old/write-new migration. Default is a dry run; originals are retained byte-for-byte.
import {readFile,writeFile,rename,unlink} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';import {fileURLToPath} from 'node:url';
import {migrateRouteRecords} from '../src/route-migrations.js';
export async function migrateFile(path,{write=false,out=path+'.routes-v2.json'}={}){
 const original=await readFile(path),data=JSON.parse(original),entries=Array.isArray(data)?data:data.entries;if(!Array.isArray(entries))throw Error('Expected records array');
 const next={schema:2,entries:migrateRouteRecords(entries,{source:'server-json'}),originalCount:entries.length};
 const result={input:path,out,dryRun:!write,before:entries.length,after:next.entries.length,mapped:next.entries.filter(r=>r.identity).length,originalsPreserved:next.entries.every((r,i)=>JSON.stringify(r.migration?.original||r)===JSON.stringify(entries[i].migration?.original||entries[i]))};
 if(!result.originalsPreserved)throw Error('Migration changed an original');
 if(write){const temp=out+'.'+randomUUID()+'.tmp';try{await writeFile(temp,JSON.stringify(next)+'\n',{mode:0o600,flag:'wx'});await rename(temp,out);}finally{await unlink(temp).catch(e=>{if(e.code!=='ENOENT')throw e;});}}
 return result;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){const args=process.argv.slice(2),path=args.find(a=>!a.startsWith('--'));if(!path||args.some(a=>a.startsWith('--')&&!['--dry-run','--write'].includes(a)))throw Error('Usage: migrate-route-records.mjs FILE [--dry-run|--write]');console.log(JSON.stringify(await migrateFile(path,{write:args.includes('--write')}),null,2));}
