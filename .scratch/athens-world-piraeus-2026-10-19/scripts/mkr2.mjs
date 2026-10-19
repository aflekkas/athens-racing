// Stage a bake's cells/manifest.json as a local R2-shaped tree (manifest.json + world/cells/<sha>.bin.gz symlinks), using the
// publisher's own rewrite, so the app can be tested exactly as served by the Worker without uploading anything.
// node mkr2.mjs APP CELLS_DIR OUT
import {mkdir,symlink,writeFile,rm} from 'node:fs/promises';import {resolve,join} from 'node:path';
const [app,cells,out]=process.argv.slice(2);const {publication}=await import(resolve(app)+'/tools/world-r2.mjs');
const build=await publication(join(resolve(cells),'manifest.json'));
await rm(out,{recursive:true,force:true});await mkdir(join(out,'world/cells'),{recursive:true});
await writeFile(join(out,'manifest.json'),JSON.stringify(build.manifest));
for(const o of build.objects)if(o.file)await symlink(o.file,join(out,'world',o.key));
console.log(JSON.stringify({manifest:build.key,objects:build.objects.length,bytes:build.objects.reduce((n,o)=>n+o.size,0)}));
