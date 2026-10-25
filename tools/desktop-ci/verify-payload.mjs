import assert from 'node:assert/strict';
import { readFile, readdir, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const root=resolve(process.argv[2]);
const manifest=JSON.parse(await readFile(resolve(root,'desktop-manifest.json'),'utf8'));
assert.equal(manifest.build,process.env.EXPECTED_GAME_BUILD);
const actual=[];
async function walk(dir=''){for(const entry of await readdir(resolve(root,dir),{withFileTypes:true})){const name=(dir?dir+'/':'')+entry.name;assert.ok(!entry.isSymbolicLink());if(entry.isDirectory())await walk(name);else actual.push(name);}}
await walk();assert.deepEqual(actual.sort(),['desktop-manifest.json',...Object.keys(manifest.files)].sort());
for(const [name,expected]of Object.entries(manifest.files)){assert.ok(!name.includes('..')&&!name.startsWith('/'));const file=resolve(root,name);assert.equal((await lstat(file)).size,expected.bytes);assert.equal(createHash('sha256').update(await readFile(file)).digest('hex'),expected.sha256,name);}
const {runtimeReleaseHash}=await import(pathToFileURL(resolve('apps/server/release-fingerprint.mjs')));
const runtime=await runtimeReleaseHash({gameRoot:root,codeRoot:process.cwd()});
assert.equal(runtime,process.env.EXPECTED_RUNTIME_HASH);
console.log(JSON.stringify({passed:true,build:manifest.build,files:actual.length,runtime},null,2));
