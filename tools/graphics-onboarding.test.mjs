import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
// The skip policy is tested without creating a WebGL context.
const {outputFiles}=await build({stdin:{contents:"export {skipQualityProbe} from './src/ui/graphics-onboarding.js';",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false,plugins:[{name:'browser-graphics',setup(b){b.onResolve({filter:/components\.js$/},()=>({path:'components',namespace:'mock'}));b.onResolve({filter:/graphics\.js$/},()=>({path:'graphics',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:'export const detectQualityTier=null; export const applyQualityTier=null; export const ui=null;'}));}}]});
const {skipQualityProbe}=await import('data:text/javascript;base64,'+Buffer.from(outputFiles[0].text).toString('base64'));
test('quality probing skips explicit quality, automation and every test-start key',()=>{
  for(const search of ['?quality=low','?quality=auto',...['simhook','autodrive','car','s','event','quick','fixeddt','turbo'].map(k=>'?'+k)])assert.equal(skipQualityProbe({search}),true,search);
  assert.equal(skipQualityProbe({webdriver:true}),true);
  assert.equal(skipQualityProbe({search:'?menu&map=penteli',webdriver:false}),false);
});
