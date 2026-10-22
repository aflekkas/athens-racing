import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
// The skip policy is tested without creating a WebGL context.
const {outputFiles}=await build({stdin:{contents:"export {skipPerformanceProbe} from './src/ui/graphics-onboarding.js';",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false,plugins:[{name:'browser-graphics',setup(b){b.onResolve({filter:/settings\.js$/},()=>({path:'settings',namespace:'mock'}));b.onResolve({filter:/graphics\.js$/},()=>({path:'graphics',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:'export const detectPerformance=null; export const settings={}; export const setSetting=null; export const PERFORMANCE={};'}));}}]});
const {skipPerformanceProbe}=await import('data:text/javascript;base64,'+Buffer.from(outputFiles[0].text).toString('base64'));
test('the silent first-run performance probe skips automation and every test-start key',()=>{
  for(const search of ['simhook','autodrive','car','s','event','quick','fixeddt','turbo'].map(k=>'?'+k))assert.equal(skipPerformanceProbe({search}),true,search);
  assert.equal(skipPerformanceProbe({webdriver:true}),true);
  assert.equal(skipPerformanceProbe({search:'?menu&map=penteli',webdriver:false}),false);
});
