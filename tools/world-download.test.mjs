import test from 'node:test';import assert from 'node:assert/strict';import{gzipSync}from'node:zlib';import{createHash}from'node:crypto';import{mkdtemp,readFile,rm}from'node:fs/promises';import{tmpdir}from'node:os';import{resolve}from'node:path';
import{WorldDownloads,inflateWorldGzip}from'../src/world-download.js';import{writeWorldDownload,WORLD_DOWNLOAD_PART_BYTES}from'./world-download-assets.mjs';
const text=new TextEncoder(),body=value=>text.encode(value);
const response=value=>new Response(value,{headers:{'Content-Length':String(value.length)}});
async function fetcher(fn,run){const original=globalThis.fetch;globalThis.fetch=fn;try{return await run();}finally{globalThis.fetch=original;}}
const settle=()=>new Promise(resolve=>setImmediate(resolve));
test('progressing transfer survives beyond the old 45-second aggregate deadline',t=>{
 t.mock.timers.enable({apis:['setTimeout']});let controller,aborted=false;const seen=[];
 return fetcher(async(url,{signal})=>{signal.addEventListener('abort',()=>{aborted=true;});return new Response(new ReadableStream({start(c){controller=c;}}),{headers:{'Content-Length':'6'}});},async()=>{
 const transfer=new WorldDownloads({terrain:'/a'},{onProgress:d=>seen.push(d.loadedBytes)}),pending=transfer.run();await settle();
 for(let i=0;i<3;i++){t.mock.timers.tick(20000);controller.enqueue(body('ab'));await settle();}
 controller.close();await pending;assert.equal(aborted,false);assert.equal(await transfer.blob('terrain').text(),'ababab');assert.equal(seen.at(-1),6);
 });
});
for(const rangeSupported of [true,false])test(`retry retains completed files and resumes a partial body (Range ${rangeSupported?'206':'ignored 200'})`,()=>{
 let interrupted=true;const calls=[];
 return fetcher(async(url,options)=>{calls.push({url,range:options.headers?.Range});if(url==='/first')return response(body('123'));
 if(interrupted){return new Response(new ReadableStream({start(c){c.enqueue(body('abc'));},pull(c){c.error(new Error('connection reset'));}}),{headers:{'Content-Length':'6'}});}
 return rangeSupported?new Response(body('def'),{status:206,headers:{'Content-Length':'3','Content-Range':'bytes 3-5/6'}}):response(body('abcdef'));
 },async()=>{const transfer=new WorldDownloads({terrain:['/first','/second']},{concurrency:1});await assert.rejects(transfer.run());assert.equal(transfer.files[0].blob.size,3);assert.equal(transfer.files[1].received,3);interrupted=false;await transfer.run();assert.equal(await transfer.blob('terrain').text(),'123abcdef');assert.equal(calls.filter(c=>c.url==='/first').length,1);assert.equal(calls.at(-1).range,'bytes=3-');assert.equal(transfer.snapshot().loadedBytes,9);});
});
test('a corrupt cached part is discarded and reloaded without refetching good parts',()=>{
 const good=body('abc'),bad=body('xxx'),assets={'/a':{bytes:3,sha256:createHash('sha256').update(good).digest('hex')}};let calls=0;
 return fetcher(async(url,options)=>{calls++;if(calls===2)assert.equal(options.cache,'reload');return response(calls===1?bad:good);},async()=>{const transfer=new WorldDownloads({terrain:'/a'},{assets});await assert.rejects(transfer.run(),e=>e.code==='invalid');assert.equal(transfer.snapshot().loadedBytes,0);await transfer.run();assert.equal(await transfer.blob('terrain').text(),'abc');});
});
test('retry verifies a complete retained body without requesting an empty range',()=>{
 let calls=0;
 return fetcher(async()=>{calls++;return new Response(new ReadableStream({start(c){c.enqueue(body('abc'));},pull(c){c.error(Error('reset before EOF'));}}),{headers:{'Content-Length':'3'}});},async()=>{
 const transfer=new WorldDownloads({terrain:'/a'});await assert.rejects(transfer.run());assert.equal(transfer.files[0].received,3);await transfer.run();assert.equal(calls,1);assert.equal(await transfer.blob('terrain').text(),'abc');
 });
});
test('gzip decoding supports browsers without native DecompressionStream',async()=>{const before=globalThis.DecompressionStream;try{globalThis.DecompressionStream=undefined;const data=body('exact bake bytes');assert.deepEqual(new Uint8Array(await inflateWorldGzip(new Blob([gzipSync(data)]))),data);}finally{globalThis.DecompressionStream=before;}});
test('small download parts preserve every compressed byte, declare real totals and integrity',async()=>{const dir=await mkdtemp(resolve(tmpdir(),'asr-parts-'));try{const bytes=Buffer.alloc(WORLD_DOWNLOAD_PART_BYTES*2+71);for(let i=0;i<bytes.length;i++)bytes[i]=i%251;const assets={},paths=await writeWorldDownload(dir,'riviera-terrain-0123456789abcdef.bin.gz',bytes,assets);assert.equal(paths.length,3);const actual=[];for(const path of paths){const part=await readFile(resolve(dir,path.split('/').at(-1)));actual.push(part);assert.ok(part.length<=WORLD_DOWNLOAD_PART_BYTES);assert.equal(assets[path].bytes,part.length);assert.equal(assets[path].sha256,createHash('sha256').update(part).digest('hex'));}assert.deepEqual(Buffer.concat(actual),bytes);assert.equal(Object.values(assets).reduce((sum,x)=>sum+x.bytes,0),bytes.length);}finally{await rm(dir,{recursive:true,force:true});}});

test('compatibility gzip decoder rejects corrupt trailers and exposed-but-unsupported gzip APIs',async()=>{const original=globalThis.DecompressionStream;try{globalThis.DecompressionStream=class{constructor(){throw Error('gzip unsupported');}};const data=body('preserve exact bake');const compressed=gzipSync(data);assert.deepEqual(new Uint8Array(await inflateWorldGzip(new Blob([compressed]))),data);compressed[compressed.length-8]^=1;await assert.rejects(inflateWorldGzip(new Blob([compressed])),e=>e.code==='invalid');}finally{globalThis.DecompressionStream=original;}});
