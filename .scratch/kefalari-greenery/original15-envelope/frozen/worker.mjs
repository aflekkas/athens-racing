// TASK-LOCAL diagnostic only. No geometry decoder, mutation, projection or packer.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
export const MAX=67108864;
export function validateRuntime(v){if(v.node!=='22.23.3'||v.openssl!=='3.5.8'||v.platform!=='linux'||v.arch!=='x64')throw Error('Native accounting runtime pin mismatch');}
export const TARGET=Object.freeze({checkpoint:'6721129cc1cc99dfac81afcfe2c1f60704f77c8b',sha256:'d3fc0efacc9ddeaba0fd3565ffa1127d0306e4d3081c7cca2876b35ca00d9b8d',wireBytes:289767,decodeCap:4104578,path:'/tmp/athens-loaders.OfMh/cells/d3fc0efacc9ddeaba0fd3565ffa1127d0306e4d3081c7cca2876b35ca00d9b8d.bin.gz',world:'athens-east-development',revision:'2881ca7fd0b8aeea46ac66a296e14cd6033d78936fb113ffc0cb8d5015b1da39'});
const sha=b=>createHash('sha256').update(b).digest('hex');
const fail=(message,phase)=>{throw Object.assign(Error(message),{phase});};
const same=(a,b)=>a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&a.mtimeNs===b.mtimeNs&&a.ctimeNs===b.ctimeNs;
const descriptor=s=>Object.fromEntries(['dev','ino','size','mtimeNs','ctimeNs'].map(k=>[k,String(s[k])]));
export function validateTarget(p){
 const o=p?.original,s=o?.source,e=o?.entry;
 if(p?.sourceCheckpoint!==TARGET.checkpoint||o?.cachePath!==TARGET.path||e?.sha256!==TARGET.sha256||e?.bytes!==TARGET.wireBytes||e?.decodedBytes!==TARGET.decodeCap||s?.world!==TARGET.world||s?.revision!==TARGET.revision||JSON.stringify(s?.cell)!=='[15,-21]')fail('Wrong original/source/target pin','target');
}
// This is the pinned assembler's byte/token estimate, without per-token strings.
export function tokenHeap(b){let heap=128;for(let i=0;i<b.length;){const c=b[i++];if(c===34){const start=i;let closed=false;while(i<b.length){const v=b[i++];if(v===92){i++;continue;}if(v===34){closed=true;break;}}if(!closed)fail('Invalid metadata string','metadata token scan');heap+=328+4*(i-start);}else if(c===91||c===123)heap+=136;else if(c===93||c===125||c===44||c===58||c===32||c===9||c===10||c===13)continue;else{heap+=72;while(i<b.length&&b[i]!==44&&b[i]!==93&&b[i]!==125&&b[i]!==32&&b[i]!==9&&b[i]!==10&&b[i]!==13&&b[i]!==58)i++;}if(heap>MAX)fail('Metadata token heap before UTF8/parse','metadata token scan');}return heap;}
export function readWire(path,spec,io=fs){
 if(!Number.isSafeInteger(spec.wireBytes)||spec.wireBytes<1||spec.wireBytes>TARGET.wireBytes)fail('Wire bound','compressed snapshot');
 let fd;try{
 const pathBefore=io.lstatSync(path,{bigint:true});if(!pathBefore.isFile()||String(pathBefore.size)!==String(spec.wireBytes)||JSON.stringify(descriptor(pathBefore))!==JSON.stringify(spec.descriptor))fail('Original path descriptor drift','original stat');
 fd=io.openSync(path,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);spec.counters.originalOpens++;
 const before=io.fstatSync(fd,{bigint:true});if(!before.isFile()||!same(before,pathBefore))fail('Original replaced before read','original stat');
 const wire=Buffer.alloc(spec.wireBytes),eof=Buffer.alloc(1);let at=0,reads=0;
 while(at<wire.length){if(++reads>Math.ceil(spec.wireBytes/65536))fail('Compressed short-read history bound','compressed read');const n=io.readSync(fd,wire,at,Math.min(65536,wire.length-at),at);if(!Number.isInteger(n)||n<=0||n>wire.length-at)fail('Original early EOF','compressed read');at+=n;spec.counters.compressedBytesRead+=n;}
 spec.counters.eofProbes=(spec.counters.eofProbes??0)+1;
 if(io.readSync(fd,eof,0,1,at)!==0)fail('Original grew at EOF','compressed EOF');
 if(!same(before,io.fstatSync(fd,{bigint:true}))||!same(before,io.lstatSync(path,{bigint:true})))fail('Original changed/replaced','compressed final stat');
 if(sha(wire)!==spec.sha256)fail('Original compressed SHA mismatch','compressed SHA');spec.counters.compressedShaAuthenticated=true;return wire;
 }finally{if(fd!==undefined)io.closeSync(fd);}
}
// Test dependencies are JS functions, never accepted through the executable's
// JSON payload. CLI always uses native IO/inflater/parser and the literal target.
export function inspectEnvelope(wire,spec,deps={}){
 const inflate=deps.inflate??gunzipSync,parse=deps.parse??JSON.parse,decode=deps.decode??(b=>new TextDecoder('utf-8',{fatal:true}).decode(b));
 const r={status:'STARTED-ENVELOPE-ONLY',cell:spec.cell,actualProjections:0,actualMutations:0,actualPacks:0,geometryArraysConstructed:0,ledger:[],metadataParses:0,noCellAdmission:true};
 const fixed=spec.controllerReservedBytes+2*1024*1024+1024*1024+2*wire.length+65536;
 const admit=(phase,n)=>{r.phase=phase;r.ledger.push({phase,reservationBytes:n});if(!Number.isSafeInteger(n)||n>MAX)fail('Workload budget BEFORE '+phase,phase);};
 try{
 if(!Number.isSafeInteger(spec.controllerReservedBytes)||spec.controllerReservedBytes<0||!Number.isSafeInteger(spec.decodeCap)||spec.decodeCap<12||spec.decodeCap>TARGET.decodeCap)fail('Probe bound','bootstrap');
 admit('bounded inflate',fixed+3*Math.max(spec.decodeCap,65536));
 const raw=inflate(wire,{maxOutputLength:spec.decodeCap});r.actualInflatedBytes=raw.length;r.actualRawBackingBytes=raw.buffer.byteLength;r.declaredDecodedCap=spec.decodeCap;
 if(raw.length>spec.decodeCap||raw.length<12||raw.readUInt32LE(0)!==0x31525341)fail('ASR1 header/output bound','ASR header');
 const size=raw.readUInt32LE(4),start=raw.readUInt32LE(8);r.metadataBytes=size;
 if(size>262144||size>raw.length-12||start<12+size||start>raw.length||start%4)fail('Metadata/header bound before UTF8/parse','ASR header');
 const bytes=raw.subarray(12,12+size),heap=tokenHeap(bytes);
 // EXACT pinned authenticate formula. The cap above is never substituted for
 // newly observed raw size/backing here.
 const retained=15*Math.max(raw.buffer.byteLength,raw.length,65536)+6*(heap+6*size);
 r.metadataTokenHeapBound=heap;r.originalSourceRetainedFormula=retained;
 if(!Number.isSafeInteger(spec.knownOtherRetainedFloor)||spec.knownOtherRetainedFloor<0)fail('Known floor bound','metadata reservation');
 r.knownFutureFloor=retained+spec.knownOtherRetainedFloor;
 admit('metadata UTF8/parse',fixed+Math.max(3*Math.max(spec.decodeCap,65536),retained));
 if(r.knownFutureFloor>MAX){r.status='STOP-KNOWN-COMBINED-OVERBUDGET';return r;}
 const m=parse(decode(bytes));r.metadataParses++;
 if(m.version!==1||m.world!==spec.world||m.revision!==spec.revision||JSON.stringify(m.cell)!==JSON.stringify(spec.cell)||!Array.isArray(m.views)||m.views.length>512)fail('Metadata source/view diagnostic bound','metadata identity');
 const widths={Int8Array:1,Uint8Array:1,Uint8ClampedArray:1,Int16Array:2,Uint16Array:2,Int32Array:4,Uint32Array:4,Float32Array:4,Float64Array:8};let arrayBytes=0,elements=0,logical=0,count=0;
 for(const v of m.views){const w=widths[v.type],n=v.length*w;if(!w||!Number.isSafeInteger(v.length)||v.length<0||!Number.isSafeInteger(v.offset)||v.offset<0||v.offset%w||start+v.offset+n>raw.length||!Number.isSafeInteger(n)||(arrayBytes+=n)>spec.decodeCap)fail('Original view envelope','metadata views');elements+=v.length;}
 if(!m.tables||typeof m.tables!=='object'||Array.isArray(m.tables))fail('Logical table metadata','metadata tables');
 for(const key in m.tables)if(Object.hasOwn(m.tables,key)){if(++count>64)fail('Diagnostic table bound','metadata tables');const i=m.tables[key];if(!Number.isInteger(i)||i<0||i>=m.views.length)fail('Table view ref','metadata tables');logical+=m.views[i].length;}
 Object.assign(r,{status:'METADATA-METRICS-ONLY-NOT-ADMITTED',viewCount:m.views.length,rawViewBytes:arrayBytes,rawViewElements:elements,declaredLogicalTableCount:count,declaredLogicalTableElements:logical,numericValuesJSONCharUpper:32*(elements+logical),synthesizedTablesExactNumericCharsAndPostrepairCounts:'UNKNOWN'});return r;
 }catch(e){r.status='STOP-FAIL-CLOSED';r.error={phase:e.phase??r.phase??'unknown',message:String(e.message).slice(0,1000)};return r;}
}
function payload(){
 const n=Number(process.argv[process.argv.indexOf('--payload-bytes')+1]),expected=process.argv[process.argv.indexOf('--payload-sha')+1];if(!Number.isSafeInteger(n)||n<1||n>32768||!/^[a-f0-9]{64}$/.test(expected??''))fail('Payload bounds','payload');
 const b=Buffer.alloc(n),eof=Buffer.alloc(1);let at=0;while(at<n){const got=fs.readSync(0,b,at,n-at,null);if(!got)fail('Payload EOF','payload');at+=got;}if(fs.readSync(0,eof,0,1,null)!==0||sha(b)!==expected||tokenHeap(b)>262144)fail('Payload SHA/token bound','payload');return JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(b));
}
function main(){
 let r;const counters={originalOpens:0,compressedBytesRead:0};try{
 if(process.env.ATHENS_SINGLE15_ENVELOPE_GRANT!=='6721129')fail('Explicit future grant marker required','bootstrap');validateRuntime({node:process.versions.node,openssl:process.versions.openssl,platform:process.platform,arch:process.arch});const p=payload();validateTarget(p);const spec={cell:p.original.source.cell,world:p.original.source.world,revision:p.original.source.revision,wireBytes:TARGET.wireBytes,sha256:TARGET.sha256,descriptor:{dev:p.original.stat.dev,ino:p.original.stat.ino,size:String(p.original.stat.bytes),mtimeNs:p.original.stat.mtimeNs,ctimeNs:p.original.stat.ctimeNs},counters,decodeCap:TARGET.decodeCap,controllerReservedBytes:p.controllerReservedBytes,knownOtherRetainedFloor:p.knownOtherRetainedFloor};
 if(!Number.isSafeInteger(spec.controllerReservedBytes)||spec.controllerReservedBytes<0||spec.controllerReservedBytes+3*1024*1024+2*TARGET.wireBytes+65536+3*TARGET.decodeCap>MAX)fail('Snapshot reservation before original open','compressed snapshot');
 const wire=readWire(TARGET.path,spec);r=inspectEnvelope(wire,spec);
 }catch(e){r={status:'STOP-FAIL-CLOSED',error:{phase:e.phase??'bootstrap',message:String(e.message).slice(0,1000)},noCellAdmission:true};}
 r.counters=counters;r.memory=process.memoryUsage();r.resource=process.resourceUsage();r.resourceCapacityClaim=false;r.accounting={nativeAllowances:'ESTIMATES NOT PROVEN NATIVE ALLOCATION BOUNDS',bootstrapBytes:2097152,nativeHashInflaterBytes:1048576,noGarbageCollectionCredit:true,node:'22.23.3',openssl:'3.5.8',platform:'linux',arch:'x64'};r.geometryArraysConstructed=0;r.actualProjections=0;r.actualMutations=0;r.actualPacks=0;
 const out=JSON.stringify(r);if(Buffer.byteLength(out)>32768){fs.writeSync(1,'{"status":"STOP-OUTPUT-CAP","resourceCapacityClaim":false}\n');process.exitCode=1;}else{fs.writeSync(1,out+'\n');process.exitCode=r.status==='STOP-FAIL-CLOSED'?1:0;}
}
if(process.argv.includes('--execute-envelope'))main();
