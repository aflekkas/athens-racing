// Validate the emitted production chunks: codec workers serialize their own source.
import http from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, relative, extname } from 'node:path';
import { MeshoptEncoder } from './vendor/meshopt_encoder.mjs';
const root=resolve(import.meta.dirname,'..'),pub=resolve(root,'.deploy/assets'),out=resolve(root,'.scratch/perf-2026-10-15/textures-data');
const meta=JSON.parse(await readFile(resolve(root,'.deploy/browser-metafile.json'),'utf8'));
const chunk=suffix=>'/'+relative(pub,resolve(root,Object.entries(meta.outputs).find(([,v])=>v.entryPoint?.endsWith(suffix))[0]));
const { BASIS_TRANSCODER_PATH } = await import('../src/texture-manifest.js');
const ktx=chunk('KTX2Loader.js'),meshopt=chunk('meshopt_decoder.module.js');
await MeshoptEncoder.ready;const input=Uint8Array.from({length:192},(_,i)=>(i*13)&255),encoded=MeshoptEncoder.encodeGltfBuffer(input,16,12,'ATTRIBUTES');
const types={'.js':'text/javascript','.wasm':'application/wasm','.svg':'image/svg+xml','.html':'text/html'};
const server=http.createServer(async(req,res)=>{try{const p=new URL(req.url,'http://localhost').pathname;if(p==='/'){res.setHeader('Content-Type','text/html');res.end('<style>body{margin:0}</style>');return;}const file=p.startsWith('/vendor/')?resolve(root,'node_modules/three',p.slice(8)):resolve(pub,'.'+p);res.setHeader('Content-Type',types[extname(file)]||'application/octet-stream');res.end(await readFile(file));}catch{res.writeHead(404);res.end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const {chromium}=await import('/tmp/pw/node_modules/playwright/index.mjs'),browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const errors=[];try{const page=await browser.newPage({viewport:{width:800,height:400}});page.on('pageerror',e=>errors.push(e.stack));await page.goto('http://127.0.0.1:'+server.address().port+'/?assetcodec=1');
const report=await page.evaluate(async({ktx,meshopt,encoded,expected,basis})=>{
 const THREE=await import('/vendor/build/three.module.js'),{KTX2Loader}=await import(ktx),{MeshoptDecoder}=await import(meshopt);
 const renderer=new THREE.WebGLRenderer({preserveDrawingBuffer:true});renderer.setSize(800,400);document.body.append(renderer.domElement);
 const loader=new KTX2Loader().setTranscoderPath(basis).setWorkerLimit(1).detectSupport(renderer);
 await MeshoptDecoder.ready;MeshoptDecoder.useWorkers(1);const decoded=await MeshoptDecoder.decodeGltfBufferAsync(16,12,new Uint8Array(encoded),'ATTRIBUTES');
 if(!decoded.every((v,i)=>v===expected[i]))throw new Error('Production meshopt worker mismatch');
 return {meshoptWorkerRoundtrip:true,support:loader.workerConfig};
},{ktx,meshopt,encoded:[...encoded],expected:[...input],basis:BASIS_TRANSCODER_PATH});
// Load real colour + sharp badge through the emitted loader, not source modules.
const {TEXTURE_MANIFEST}=await import('../src/texture-manifest.js');const entries=Object.entries(TEXTURE_MANIFEST).filter(([url,e])=>e.enabled&&(url.includes('asphalt')&&!url.includes('_arm')||url.endsWith('atlas.svg'))).map(([,e])=>e);
report.textures=await page.evaluate(async({ktx,entries,basis})=>{const THREE=await import('/vendor/build/three.module.js'),{KTX2Loader}=await import(ktx),renderer=new THREE.WebGLRenderer({preserveDrawingBuffer:true});renderer.setSize(800,400);document.body.replaceChildren(renderer.domElement);const loader=new KTX2Loader().setTranscoderPath(basis).setWorkerLimit(1).detectSupport(renderer),scene=new THREE.Scene(),camera=new THREE.OrthographicCamera(-2,2,1,-1,.1,10);camera.position.z=2;const rows=[];for(let i=0;i<entries.length;i++){const texture=await loader.loadAsync(entries[i].url);if(!texture.isCompressedTexture||texture.mipmaps.length<2)throw new Error('Production KTX2 worker did not produce mips');const quad=new THREE.Mesh(new THREE.PlaneGeometry(1.8,1.8),new THREE.MeshBasicMaterial({map:texture,transparent:true}));quad.position.x=i*2-1;scene.add(quad);rows.push({url:entries[i].url,mips:texture.mipmaps.length,width:texture.image.width,gpuBytes:texture.mipmaps.reduce((n,m)=>n+m.data.byteLength,0)});}renderer.render(scene,camera);loader.dispose();return rows;},{ktx,entries,basis:BASIS_TRANSCODER_PATH});await mkdir(out,{recursive:true});await page.screenshot({path:resolve(out,'production-workers.png')});report.errors=errors;await writeFile(resolve(out,'production-workers.json'),JSON.stringify(report,null,2));if(errors.length)throw new Error(errors.join('\n'));console.log(report);
}finally{await browser.close();await new Promise(r=>server.close(r));}
