import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {resolve,dirname,relative} from 'node:path';
import {testGroups} from './run-tests.mjs';
const root=resolve(import.meta.dirname,'..');
function uncovered(script,files,read) {
  const visited=new Set();
  const visit=file=>{
    if(visited.has(file))return;visited.add(file);
    for(const match of read(file).matchAll(/^\s*(?:import\s*(?:[^'";]*?\sfrom\s*)?|export\s+[^'";]*?\sfrom\s*)['"](\.[^'"]+)['"]/gm)) {
      const target=relative(root,resolve(root,dirname(file),match[1]));
      if(target.endsWith('.test.mjs'))visit(target);
    }
  };
  for(const token of script.matchAll(/(?:tools|server|worker)\/[\w./*-]+\.(?:mjs|js)/g)) {
    if(token[0].includes('*')) {
      const pattern=new RegExp('^'+token[0].split('*').map(s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('[^/]*')+'$');
      files.filter(f=>pattern.test(f)).forEach(visit);
    } else visit(token[0]);
  }
  return files.filter(f=>!visited.has(f));
}
test('npm test reaches every tools/server/worker test directly or through imports',()=>{
 const files=['tools','server','worker'].flatMap(dir=>readdirSync(resolve(root,dir),{recursive:true}).filter(f=>f.endsWith('.test.mjs')).map(f=>dir+'/'+f));
 const command=JSON.parse(readFileSync(resolve(root,'package.json'))).scripts.test;
 assert.equal(command,'node tools/run-tests.mjs');
 const direct=Object.values(testGroups).flat();
 assert.equal(new Set(direct).size,direct.length,'test files belong to only one group');
 const script=direct.join(' ');
 assert.deepEqual(uncovered(script,files,f=>readFileSync(resolve(root,f),'utf8')),[]);
});
test('coverage guard catches an unwired test and follows imported suites and globs',()=>{
 const files=['tools/a.test.mjs','tools/b.test.mjs','server/c.test.mjs','tools/new.test.mjs'];
 assert.deepEqual(uncovered('node --test tools/a.test.mjs server/*.test.mjs',files,f=>f==='tools/a.test.mjs'?"import './b.test.mjs';":''),['tools/new.test.mjs']);
});
