// Prepare only the deterministic terrain/road buffers for a local review capture.
import { bakeWorlds } from './bake-world.mjs';
import { mkdir, copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const root=resolve(import.meta.dirname,'..'),out=resolve(root,'.scratch/psychiko/browser-bake');
await mkdir(resolve(out,'data/maps/psychiko'),{recursive:true});
await copyFile(resolve(root,'data/maps/psychiko/map.json'),resolve(out,'data/maps/psychiko/map.json'));
await bakeWorlds(root,out,['psychiko']);
