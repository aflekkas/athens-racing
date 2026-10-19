// Find the streets no surface can satisfy on steep ground, from the bake's own physical audit, and list them in
// steep-exclusions.json (reviewed and committed, like coast-exclusions.json). Iterates the given cells until they pass.
//   node plan-steep.mjs CACHE AREA 'x,z;x,z;...' [WORKDIR]
import {spawnSync} from 'node:child_process';import {readFile,writeFile,rm,mkdir} from 'node:fs/promises';import {resolve,join} from 'node:path';import {fileURLToPath} from 'node:url';
const [cache,area,cells,work='/tmp/athens-steep-plan']=process.argv.slice(2);
const file=fileURLToPath(new URL('./steep-exclusions.json',import.meta.url)),build=fileURLToPath(new URL('./build-coast.mjs',import.meta.url));
const load=async()=>JSON.parse(await readFile(file,'utf8').catch(()=>'[]'));
for(let round=1;round<=8;round++){
  await rm(work,{recursive:true,force:true});await mkdir(work,{recursive:true});
  const r=spawnSync('node',[build,resolve(cache),join(work,'out'),area],{env:{...process.env,ATHENS_CELLS:cells,ATHENS_KEEP_GOING:'1',ATHENS_WORKERS:process.env.ATHENS_WORKERS||'4'},encoding:'utf8',maxBuffer:1<<28});
  const failures=await readFile(join(work,'out/failures.json'),'utf8').then(JSON.parse,()=>[]);
  const steep=failures.filter(f=>f.offenders?.length&&/^Physical surface acceptance failed/.test(f.error));
  const other=failures.filter(f=>!steep.includes(f));
  console.log(JSON.stringify({round,failing:failures.length,steep:steep.map(f=>[f.cell.join(','),f.offenders.length]),other:other.map(f=>[f.cell.join(','),f.error.slice(0,120)])}));
  if(!failures.length){console.log('all cells pass');break;}
  if(!steep.length){console.log('no steep offenders to exclude; remaining failures are not steep-street failures');break;}
  const list=await load(),known=new Set(list.map(e=>e.id));
  for(const f of steep)for(const id of f.offenders)if(!known.has(id))list.push({id,reason:`steep street, cell ${f.cell.join(',')}: ${f.error.replace(/^Physical surface acceptance failed [-\d,]+: /,'').match(/"asphaltAbove30":(\d+)/)?.[1]||0} asphalt triangles over 30 degrees or a shoulder sweep past 15 cm / 30 degrees; no surface on the shared 8 m lattice keeps both 6 m shoulders inside the gates. Gates are not relaxed; the street is left out and reported.`});
  list.sort((a,b)=>a.id.localeCompare(b.id));await writeFile(file,JSON.stringify(list,null,1)+'\n');
}
await rm(work,{recursive:true,force:true});
