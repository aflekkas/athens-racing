// Focused KTX2 validation, through tools/browser-slot.sh. No map construction.
import http from 'node:http';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
const root=resolve(import.meta.dirname,'..'),out=resolve(process.argv[2]||'.scratch/perf-2026-10-15/textures-data');await mkdir(out,{recursive:true});
const types={'.js':'text/javascript','.html':'text/html','.wasm':'application/wasm','.svg':'image/svg+xml','.json':'application/json','.webp':'image/webp'};
const server=http.createServer(async(req,res)=>{let path=new URL(req.url,'http://localhost').pathname;try{if(path==='/'){res.setHeader('Content-Type','text/html');res.end('<script type="importmap">{"imports":{"three":"/vendor/build/three.module.js","three/addons/":"/vendor/examples/jsm/"}}</script><style>body{margin:0;background:#222;color:white}canvas{display:block}</style>');return;}const file=path.startsWith('/vendor/')?resolve(root,'node_modules/three',path.slice(8)):resolve(root,'.'+path);const body=await readFile(file);res.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream'});res.end(body);}catch{res.writeHead(404);res.end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const {chromium}=await import('/tmp/pw/node_modules/playwright/index.mjs');const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});const report={runs:[],errors:[]};
try{for(const side of (process.env.SIDES||'before,after,etc2,unsupported,missing').split(',')){const context=await browser.newContext({viewport:{width:1280,height:960}}),page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.stack));page.on('console',m=>{if(m.type()==='error'||/KTX2/.test(m.text()))console.log(side,m.text());});if(side==='missing')await page.route('**/*.ktx2',r=>r.abort());await page.goto(`http://127.0.0.1:${server.address().port}/?${side!=='before'?'assetcodec=1&bakedownload=1':''}`);
const metrics=await page.evaluate(async side=>{
 const THREE=await import('three'),{configureTextureCodecs,loadCompressedTexture}=await import('/src/compressed-textures.js'),{TEXTURE_MANIFEST}=await import('/src/texture-manifest.js');
 const {setAssetCodecMap}=await import('/src/asset-metrics.js');setAssetCodecMap('riviera');
 const {decodeMeshoptPack,MESHOPT_MAGIC}=await import('/src/meshopt-pack.js');
 const rawMeta=new TextEncoder().encode(JSON.stringify({version:2,views:[{type:'Uint8Array',offset:0,length:3,byteLength:3,codec:'raw'}]})),rawPack=new Uint8Array(12+rawMeta.length+3),rawHeader=new DataView(rawPack.buffer);
 rawHeader.setUint32(0,MESHOPT_MAGIC,true);rawHeader.setUint32(4,rawMeta.length,true);rawHeader.setUint32(8,12+rawMeta.length,true);rawPack.set(rawMeta,12);rawPack.set([5,10,15],12+rawMeta.length);
 const decoded=await decodeMeshoptPack(rawPack.buffer);if(decoded.arrays[0][2]!==15)throw new Error('Raw-only ASR2 roundtrip failed');
 const rawOnlyDecoderFetches=performance.getEntriesByType('resource').filter(r=>r.name.includes('meshopt_decoder')).length;if(rawOnlyDecoderFetches)throw new Error('Raw-only pack fetched MeshoptDecoder');
 const renderer=new THREE.WebGLRenderer({antialias:false,preserveDrawingBuffer:true});renderer.setSize(1280,960);document.body.append(renderer.domElement);if(side==='unsupported')renderer.extensions.has=()=>false;else if(side==='etc2'){const has=renderer.extensions.has.bind(renderer.extensions);renderer.extensions.has=name=>name==='WEBGL_compressed_texture_etc'&&has(name);}configureTextureCodecs(renderer);
 const scene=new THREE.Scene(),camera=new THREE.OrthographicCamera(-4,4,3,-3,.1,10);camera.position.z=3;
 const rows=[],refs=[];let i=0;
 for(const [url,entry] of Object.entries(TEXTURE_MANIFEST)){
  const texture=new THREE.Texture();if(!/_nor\.|_arm\.|waternormals/.test(url))texture.colorSpace=THREE.SRGBColorSpace;
  const loadStart=performance.now();
  let loaded=side!=='before'&&await loadCompressedTexture(texture,url);
  if(!loaded){const img=new Image();img.src=url;await img.decode();texture.image=img;texture.needsUpdate=true;}
  const loadWallMs=performance.now()-loadStart;
  const quad=new THREE.Mesh(new THREE.PlaneGeometry(.92,.92),new THREE.MeshBasicMaterial({map:texture,transparent:true}));quad.position.set((i%8)-3.5,2.5-Math.floor(i/8),0);scene.add(quad);i++;
  const started=performance.now();renderer.initTexture(texture);const uploadMs=performance.now()-started;
  refs.push({url,texture});rows.push({url,loadWallMs,compressed:!!texture.isCompressedTexture,width:texture.image.width,height:texture.image.height,mips:texture.mipmaps.length,gpuBytes:texture.isCompressedTexture?texture.mipmaps.reduce((n,m)=>n+m.data.byteLength,0):Math.round(texture.image.width*texture.image.height*4*4/3),format:texture.format,uploadMs});
 }
 renderer.render(scene,camera);return {rows,rawOnlyDecoderFetches,assets:window.__assetMetrics};
},side);report.runs.push({side,...metrics});await page.screenshot({path:resolve(out,`${side}-texture-sheet.png`)});
const icons=(await readdir(resolve(root,'assets/icons'))).filter(n=>n.endsWith('.svg')).sort();
await page.evaluate(async icons=>{document.body.innerHTML='<div style="display:grid;grid-template-columns:repeat(12,1fr);gap:12px;padding:16px;background:#151c24;color:white">'+icons.map(name=>'<div style="text-align:center;font:10px sans-serif"><img style="filter:invert(1)" width="36" height="36" src="/assets/icons/'+name+'"><div>'+name.replace('.svg','')+'</div></div>').join('')+'</div>';await Promise.all([...document.images].map(image=>image.decode()));},icons);
await page.screenshot({path:resolve(out,`${side}-ui-icons.png`)});await context.close();}
}finally{await writeFile(resolve(out,'texture-browser.json'),JSON.stringify(report,null,2));await browser.close();await new Promise(r=>server.close(r));}
const {TEXTURE_MANIFEST}=await import('../src/texture-manifest.js');const expected=Object.values(TEXTURE_MANIFEST).filter(e=>e.enabled).length;
for(const r of report.runs){const count=r.rows.filter(t=>t.compressed).length;if(['after','etc2'].includes(r.side)&&count!==expected)throw new Error(`Expected ${expected} compressed textures, got ${count}`);if(r.rows.some(t=>t.compressed&&t.mips!==Math.floor(Math.log2(Math.max(t.width,t.height)))+1))throw new Error('Incomplete resident mip chain');if(['unsupported','missing'].includes(r.side)&&count)throw new Error('Fallback retained compressed textures');if(r.rows.find(t=>t.url.endsWith('atlas.svg'))?.compressed && r.assets.textures.find(t=>t.url===TEXTURE_MANIFEST['/assets/brand-badges/atlas.svg'].url)?.width!==512)throw new Error('Badge mip was reduced');}
if(report.errors.length)throw new Error(report.errors.join('\n'));console.log(report.runs.map(r=>({side:r.side,compressed:r.rows.filter(t=>t.compressed).length,gpuBytes:r.rows.reduce((n,t)=>n+t.gpuBytes,0)})));
