// Authenticated source support, never a placement or physical-acceptance policy.
// No catalog, selected span or parsed source tree is supplied by a caller.
import {openSync,closeSync,readSync,fstatSync,statSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {types} from 'node:util';
import {vegetationRadius} from '../../src/vegetation-clearance.js';

export const SCENERY_PROJECTION_VERSION='complete-support-1';
export const SCENERY_PROJECTION_LIMIT=64*1024**2;
const MAX=SCENERY_PROJECTION_LIMIT,SLAB=65536,SOURCE_MAX=4*1024**2,ROWS=8192,FIELDS=64;
const MAX_RADIUS=16.205882352941178,HALO=17;
// A source change requires a new reviewed selector ABI, even if a caller offers
// a freshly computed code proof. In particular a changed height clamp is unsafe.
const POLICY_ABI={scenery:'0d85be480a23a412a6673632311845bfe811ae1888fc12fb77f0c2ea58e5fe14',clearance:'b1f6f3481b3f0f9d318cf63822dea4e1dbb8dce280e17cd6d4482e1441647a0c'};
const DATUM={lat0:37.98,lon0:23.73,mlat:111320,mlon:87745.27512677578};
const ROOT=['areas','attribution','cacheSha256','clearanceEvidenceReady','counts','errors','exclusionErrors','exclusions','extractor','limits','placementValidated','points','projection','source','version'];
const FEATURE=['areas','points','exclusions'];
const REQUIRED_KEYS=[...ROOT,'source','tags','geometry','id','inference','x','z','kind','seed','type','coordinates'].filter((v,i,a)=>a.indexOf(v)===i);
const catalogs=new WeakMap(),verified=new WeakMap();
const typed=Object.getPrototypeOf(Uint8Array.prototype);
const slot=Object.fromEntries(['buffer','byteOffset','byteLength'].map(k=>[k,Object.getOwnPropertyDescriptor(typed,k).get]));
const backingLength=Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'byteLength').get;
const hash=b=>createHash('sha256').update(b).digest('hex');
const die=s=>{throw Error('Scenery projection: '+s);};
const isHash=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
function plain(o,keys,label){
 if(!o||types.isProxy(o)||Object.getPrototypeOf(o)!==Object.prototype)die(label+' plain data required');
 for(const k of Reflect.ownKeys(o)){const d=Object.getOwnPropertyDescriptor(o,k);if(typeof k!=='string'||!keys.includes(k)||!Object.hasOwn(d,'value')||!d.enumerable)die(label+' unexpected field/accessor');}
}
function vector(a,label){
 if(types.isProxy(a)||!Array.isArray(a)||Object.getPrototypeOf(a)!==Array.prototype)die(label+' dense vector');
 const keys=Reflect.ownKeys(a);if(keys.length!==3||keys[0]!=='0'||keys[1]!=='1'||keys[2]!=='length')die(label+' vector own fields');
 for(let i=0;i<2;i++){const d=Object.getOwnPropertyDescriptor(a,String(i));if(!Object.hasOwn(d,'value')||!d.enumerable||typeof d.value!=='number'||!Number.isFinite(d.value))die(label+' finite data');}
 return [a[0],a[1]];
}
function bytesView(b){
 if(types.isProxy(b)||!types.isUint8Array(b)||![Uint8Array.prototype,Buffer.prototype].includes(Object.getPrototypeOf(b)))die('native bytes required');
 // Reject data shadows too: structuredClone uses intrinsic backing slots.
 for(const root of [Buffer.prototype,typed,ArrayBuffer.prototype])for(let p=root;p;p=Object.getPrototypeOf(p))for(const k of Reflect.ownKeys(p))if(Object.hasOwn(b,k))die('byte layout shadow');
 const backing=Reflect.apply(slot.buffer,b,[]);
 if(!types.isArrayBuffer(backing)||Object.getPrototypeOf(backing)!==ArrayBuffer.prototype)die('private fixed backing required');
 for(const k of Reflect.ownKeys(backing))die('backing own fields forbidden: '+String(k));
 if(Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'resizable')?.get.call(backing))die('resizable backing');
 return {view:new Uint8Array(backing,Reflect.apply(slot.byteOffset,b,[]),Reflect.apply(slot.byteLength,b,[])),backingBytes:Reflect.apply(backingLength,backing,[])};
}
function ledger(retained=0){
 if(!Number.isSafeInteger(retained)||retained<0||retained>MAX)die('retained budget');
 return {used:retained,base:retained,add(n,label){if(!Number.isSafeInteger(n)||n<0||this.used+n>MAX)die(label+' workspace budget BEFORE allocation');this.used+=n;},get own(){return this.used-this.base;}};
}
function codeSource(path,budget){
 const fd=openSync(new URL(path,import.meta.url),'r');try{const st=fstatSync(fd);if(!st.isFile()||st.size>262144)die('code file bound');budget.add(2*(st.size+1),'code hash');const b=Buffer.alloc(st.size+1);exactRead(fd,b,st.size,0);if(readSync(fd,b,st.size,1,st.size)!==0||!sameStat(st,fstatSync(fd)))die('code TOCTOU');return hash(b.subarray(0,st.size));}finally{closeSync(fd);}
}
export function sceneryProjectionCodeProof(options={}){
 plain(options,['retainedBytes'],'code options');const {retainedBytes=0}=options;const b=ledger(retainedBytes);return Object.freeze({projection:codeSource('./scenery-projection.mjs',b),scenery:codeSource('../scenery-cell.mjs',b),clearance:codeSource('../../src/vegetation-clearance.js',b)});
}
function sourcePin(s,budget){
 plain(s,['sourcePath','sourceBytes','sourceSha256','codeProof'],'source');plain(s.codeProof,['projection','scenery','clearance'],'code proof');
 if(typeof s.sourcePath!=='string'||s.sourcePath.length>4096||!Number.isSafeInteger(s.sourceBytes)||s.sourceBytes<2||s.sourceBytes>SOURCE_MAX||!isHash(s.sourceSha256))die('source pin');
 for(const k of ['projection','scenery','clearance'])if(!isHash(s.codeProof[k]))die('code pin');
 budget.add(16384,'source descriptor snapshot');
 const pin={sourcePath:s.sourcePath,sourceBytes:s.sourceBytes,sourceSha256:s.sourceSha256,codeProof:{...s.codeProof}};
 const actual={projection:codeSource('./scenery-projection.mjs',budget),scenery:codeSource('../scenery-cell.mjs',budget),clearance:codeSource('../../src/vegetation-clearance.js',budget)};
 if(Object.keys(actual).some(k=>actual[k]!==pin.codeProof[k])||Object.keys(POLICY_ABI).some(k=>actual[k]!==POLICY_ABI[k]))die('code binding/maximum crown ABI changed');
 const maximum=Math.max(...[0,1,2,3,4].map(species=>vegetationRadius(species,10,false)));
 if(maximum!==MAX_RADIUS||Math.ceil(maximum+0.001)!==HALO)die('maximum crown ABI changed');
 return pin;
}
function selectionPin(s,budget){
 plain(s,['cell','originXZ','tileMetres','selectorVersion','haloMetres'],'selection');budget.add(4096,'selection snapshot');
 const cell=vector(s.cell,'cell'),originXZ=vector(s.originXZ,'origin');
 if(!cell.every(Number.isSafeInteger)||!originXZ.every((v,i)=>Math.abs(v)<=2**20&&v===cell[i]*512)||s.tileMetres!==512||s.selectorVersion!==SCENERY_PROJECTION_VERSION||s.haloMetres!==HALO)die('cell/origin/halo/selector binding');
 return {cell,originXZ,tileMetres:512,selectorVersion:s.selectorVersion,haloMetres:HALO};
}
const sameStat=(a,b)=>a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&(a.mtimeNs??a.mtimeMs)===(b.mtimeNs??b.mtimeMs)&&(a.ctimeNs??a.ctimeMs)===(b.ctimeNs??b.ctimeMs);
function authenticatedRange(fd,out,start,end,chunks,scratch,size){
 let at=0;for(let p=start;p<end;){const chunk=Math.floor(p/SLAB),offset=chunk*SLAB,n=Math.min(SLAB,size-offset);exactRead(fd,scratch,n,offset);if(hash(scratch.subarray(0,n))!==chunks.subarray(chunk*32,chunk*32+32).toString('hex'))die('authenticated chunk changed');const first=p-offset,take=Math.min(n-first,end-p);scratch.copy(out,at,first,first+take);at+=take;p+=take;}
}
function exactRead(fd,out,n,position){let done=0;while(done<n){const got=readSync(fd,out,done,n-done,position+done);if(!got)die('source truncated');done+=got;}}
// Numbers are accumulated as outward-rounded intervals, without allocating a
// string for each coordinate. Every arithmetic operation widens by one ULP.
const bits=new DataView(new ArrayBuffer(8));
function up(x){if(x===Infinity)return x;if(x===0)return Number.MIN_VALUE;bits.setFloat64(0,x);let hi=bits.getUint32(0),lo=bits.getUint32(4);if(x>0){lo=(lo+1)>>>0;if(lo===0)hi=(hi+1)>>>0;}else{if(lo===0)hi=(hi-1)>>>0;lo=(lo-1)>>>0;}bits.setUint32(0,hi);bits.setUint32(4,lo);return bits.getFloat64(0);}
const down=x=>-up(-x);
class Reader{
 constructor(fd,size,budget){this.fd=fd;this.size=size;this.pos=0;this.start=-1;this.count=0;this.budget=budget;budget.add(2*SLAB+8192+Math.ceil(size/SLAB)*32+33*64*32+33*8+2048+256*(512+32+128),'stream slabs/chunk hashes/string scratch');this.buf=Buffer.alloc(SLAB);this.scratch=Buffer.alloc(SLAB);this.str=Buffer.alloc(8192);this.chunks=Buffer.alloc(Math.ceil(size/SLAB)*32);this.full=createHash('sha256');this.heap=128;this.tokens=0;this.numericTokens=0;this.nlo=0;this.nhi=0;this.coords=new Float64Array(8*10);this.keyHashes=Buffer.alloc(33*64*32);this.objectLevel=0;this.keyBytes=Buffer.alloc(256*512);this.keyDigests=Buffer.alloc(256*32);this.keyLengths=new Uint16Array(256);this.keyNames=new Array(256);this.keyCount=0;this.lastKey=-1;}
 peek(){if(this.pos>=this.size)return -1;if(this.pos<this.start||this.pos>=this.start+this.count){this.start=this.pos;this.count=Math.min(SLAB,this.size-this.pos);exactRead(this.fd,this.buf,this.count,this.pos);const chunk=this.buf.subarray(0,this.count);this.full.update(chunk);createHash('sha256').update(chunk).digest().copy(this.chunks,Math.floor(this.pos/SLAB)*32);}return this.buf[this.pos-this.start];}
 get(){const c=this.peek();if(c<0)die('unexpected EOF');this.pos++;return c;}
 ws(){for(;;){const c=this.peek();if(c!==32&&c!==9&&c!==10&&c!==13)return;this.pos++;}}
 expect(c){this.ws();if(this.get()!==c)die('JSON punctuation');}
 string(decode=false,keyToken=false){
 this.ws();if(this.get()!==34)die('JSON string');let n=0,closed=false;
 while(this.pos<this.size){const c=this.get();if(c===34){closed=true;break;}if(c<32)die('string control');if(n>=8190)die('string token bound');this.str[n++]=c;if(c===92){const e=this.get();this.str[n++]=e;if(![34,92,47,98,102,110,114,116,117].includes(e))die('JSON escape');if(e===117)for(let j=0;j<4;j++){if(n>=8190)die('string token bound');const h=this.get();if(!((h>=48&&h<=57)||(h>=65&&h<=70)||(h>=97&&h<=102)))die('JSON unicode escape');this.str[n++]=h;}}
 }
 if(!closed)die('unterminated string');
 // Validate omitted scalar UTF8 without constructing a string. Only object
 // keys and source IDs need decoding; no omitted geometry tree is constructed.
 for(let i=0;i<n;i++){const c=this.str[i];if(c<128)continue;let count,min,max;if(c>=0xc2&&c<=0xdf){count=1;min=0x80;max=0xbf;}else if(c>=0xe0&&c<=0xef){count=2;min=c===0xe0?0xa0:0x80;max=c===0xed?0x9f:0xbf;}else if(c>=0xf0&&c<=0xf4){count=3;min=c===0xf0?0x90:0x80;max=c===0xf4?0x8f:0xbf;}else die('invalid UTF8');if(i+count>=n||this.str[i+1]<min||this.str[i+1]>max)die('invalid UTF8');for(let j=2;j<=count;j++)if(this.str[i+j]<0x80||this.str[i+j]>0xbf)die('invalid UTF8');i+=count;}
 this.heap+=328+4*(n+1);this.tokens++;if(!decode)return null;
 if(keyToken){if(n>512)die('key token bound');for(let k=0;k<this.keyCount;k++)if(this.keyLengths[k]===n){let equal=true;for(let i=0;i<n;i++)if(this.str[i]!==this.keyBytes[k*512+i]){equal=false;break;}if(equal){this.lastKey=k;return this.keyNames[k];}}if(this.keyCount>=256)die('distinct key capacity');}
 this.budget.add(768+20*n,'decoded scalar history');const text=new TextDecoder('utf-8',{fatal:true}).decode(this.str.subarray(0,n));let value;try{value=JSON.parse('"'+text+'"');}catch{die('JSON string');}for(let i=0;i<value.length;i++){const c=value.charCodeAt(i);if(c>=0xd800&&c<=0xdbff){const d=value.charCodeAt(++i);if(!(d>=0xdc00&&d<=0xdfff))die('unpaired scalar surrogate');}else if(c>=0xdc00&&c<=0xdfff)die('unpaired scalar surrogate');}if(keyToken){const k=this.keyCount++;this.keyLengths[k]=n;this.str.copy(this.keyBytes,k*512,0,n);this.keyNames[k]=value;this.budget.add(512,'new key hash history');createHash('sha256').update(value,'utf16le').digest().copy(this.keyDigests,k*32);this.lastKey=k;}return value;
 }
 number(){
 this.ws();let negative=false;if(this.peek()===45){negative=true;this.get();}let lo=0,hi=0,digits=0,frac=0,exponent=0;
 const digit=()=>{const d=this.get()-48;if(++digits>64)die('numeric token bound');lo=Math.max(0,down(lo*10));lo=Math.max(0,down(lo+d));hi=up(up(hi*10)+d);};
 if(this.peek()===48){digit();if(this.peek()>=48&&this.peek()<=57)die('leading zero');}else{if(this.peek()<49||this.peek()>57)die('JSON number');while(this.peek()>=48&&this.peek()<=57)digit();}
 if(this.peek()===46){this.get();if(this.peek()<48||this.peek()>57)die('JSON fraction');while(this.peek()>=48&&this.peek()<=57){digit();frac++;}}
 if(this.peek()===101||this.peek()===69){this.get();let sign=1;if(this.peek()===43||this.peek()===45)sign=this.get()===45?-1:1;if(this.peek()<48||this.peek()>57)die('JSON exponent');let count=0;while(this.peek()>=48&&this.peek()<=57){exponent=exponent*10+this.get()-48;if(++count>3||exponent>400)die('numeric exponent bound');}exponent*=sign;}
 for(let e=exponent-frac;e<0;e++){lo=Math.max(0,down(lo/10));hi=up(hi/10);}for(let e=exponent-frac;e>0;e--){lo=Math.max(0,down(lo*10));hi=up(hi*10);}
 if(!Number.isFinite(hi))die('nonfinite number');this.heap+=72;this.tokens++;this.numericTokens++;this.nlo=negative?-hi:lo;this.nhi=negative?-lo:hi;
 }
 literal(word){for(let i=0;i<word.length;i++)if(this.get()!==word.charCodeAt(i))die('JSON literal');this.heap+=72;this.tokens++;}
 object(each,depth=0){
 if(depth>32||this.objectLevel>=33)die('JSON depth');this.expect(123);this.heap+=136;const base=this.objectLevel++*64*32;let count=0,mask=0;this.ws();if(this.peek()===125){this.get();this.objectLevel--;return mask;}
 for(;;){if(count>=64)die('object key bound');const key=this.string(true,true),digestAt=this.lastKey*32;for(let i=0;i<count;i++){let equal=true;for(let j=0;j<32;j++)if(this.keyHashes[base+i*32+j]!==this.keyDigests[digestAt+j]){equal=false;break;}if(equal)die('duplicate JSON key');}this.keyDigests.copy(this.keyHashes,base+count++*32,digestAt,digestAt+32);const bit=REQUIRED_KEYS.indexOf(key);if(bit>=0)mask|=1<<bit;
 this.expect(58);each(key,depth+1);this.ws();const c=this.get();if(c===125)break;if(c!==44)die('JSON object delimiter');this.ws();if(this.peek()===125)die('JSON trailing comma');}
 this.objectLevel--;return mask;
 }
 array(each,depth=0){if(depth>32)die('JSON depth');this.expect(91);this.heap+=136;let n=0;this.ws();if(this.peek()===93){this.get();return n;}for(;;){if(n>=65536)die('array length bound');each(n++,depth+1);this.ws();const c=this.get();if(c===93)break;if(c!==44)die('JSON array delimiter');this.ws();if(this.peek()===93)die('JSON trailing comma');}return n;}
 value(depth=0){this.ws();const c=this.peek();if(c===123)this.object((_,d)=>this.value(d),depth);else if(c===91)this.array((_,d)=>this.value(d),depth);else if(c===34)this.string();else if(c===116)this.literal('true');else if(c===102)this.literal('false');else if(c===110)this.literal('null');else this.number();}
 rangeHash(start,end){const h=createHash('sha256');for(let p=start;p<end;p+=SLAB){const n=Math.min(SLAB,end-p);exactRead(this.fd,this.scratch,n,p);h.update(this.scratch.subarray(0,n));}return h.digest();}
}
function required(seen,list){for(const k of list)if(typeof seen==='number'?!(seen&(1<<REQUIRED_KEYS.indexOf(k))):!seen.has(k))die('missing '+k);}
function tags(r){r.object(()=>r.string());}
function coordinates(r,bbox,depth=0){
 if(depth>4)die('geometry depth');r.ws();if(r.peek()!==91)die('geometry array');r.expect(91);r.heap+=136;r.ws();if(r.peek()===93)die('empty geometry');
 const c=r.coords,at=depth*10;
 if(r.peek()!==91){r.number();const xl=r.nlo,xh=r.nhi;r.expect(44);r.number();const zl=r.nlo,zh=r.nhi;r.expect(93);if(Math.max(Math.abs(xl),Math.abs(xh),Math.abs(zl),Math.abs(zh))>1e9)die('geometry datum range');bbox[0]=Math.min(bbox[0],xl);bbox[1]=Math.min(bbox[1],zl);bbox[2]=Math.max(bbox[2],xh);bbox[3]=Math.max(bbox[3],zh);c[at]=xl;c[at+1]=xh;c[at+2]=zl;c[at+3]=zh;for(let j=0;j<4;j++)c[at+4+j]=c[at+j];return 0;}
 let count=0,level=-1;for(;;){const child=coordinates(r,bbox,depth+1),ca=(depth+1)*10;if(level!==-1&&level!==child)die('mixed geometry nesting');level=child;if(count===0)for(let j=0;j<4;j++)c[at+j]=c[ca+j];for(let j=0;j<4;j++)c[at+4+j]=c[ca+4+j];if(++count>65536)die('geometry count');r.ws();const b=r.get();if(b===93)break;if(b!==44)die('geometry delimiter');}
 if(level===0){if(count<4)die('short ring');for(let j=0;j<4;j++)if(c[at+j]!==c[at+4+j])die('unclosed ring');}return level+1;
}
function geometry(r,bbox){let type,level;const seen=r.object(k=>{if(k==='type')type=r.string(true);else if(k==='coordinates')level=coordinates(r,bbox);else die('geometry schema');});required(seen,['type','coordinates']);if(type!=='Polygon'&&type!=='MultiPolygon'||level!==(type==='Polygon'?2:3))die('geometry type/nesting');}
function feature(r,kind,bbox){let source='';const seen=r.object(k=>{
 if(k==='source'){source=r.string(true);if(!source||source.length>512)die('source ID bound');}
 else if(k==='tags')tags(r);
 else if(k==='geometry'&&kind!==1)geometry(r,bbox);
 else if((k==='id'||k==='inference')&&kind===1)r.string();
 else if((k==='x'||k==='z')&&kind===1){r.number();if(Math.max(Math.abs(r.nlo),Math.abs(r.nhi))>1e9)die('point datum range');const i=k==='x'?0:1;bbox[i]=r.nlo;bbox[i+2]=r.nhi;}
 else if((k==='kind'||k==='seed')&&kind===1){const before=r.pos;r.number();const integer=Math.round((r.nlo+r.nhi)/2);if(r.pos-before>10||integer<0||integer>(k==='kind'?2:4294967295)||r.nlo>integer||r.nhi<integer||r.nhi-r.nlo>0.0001)die('point integer schema');}
 else die('feature schema '+k);
 });required(seen,kind===1?['id','inference','source','tags','x','z','kind','seed']:['source','tags','geometry']);return source;
}
const catalogFixed=ROWS*9*8+ROWS*64+FIELDS*24+8192+65536;
export function openVerifiedSceneryCatalog(source,options={}){
 plain(options,['retainedBytes'],'catalog options');const {retainedBytes=0}=options;const budget=ledger(retainedBytes),pin=sourcePin(source,budget);budget.add(catalogFixed,'catalog/index capacity');
 const index=new Float64Array(ROWS*9),hashes=Buffer.alloc(ROWS*64),globalSpans=new Float64Array(FIELDS*3),fieldKeys=[];let rows=0;
 const fd=openSync(pin.sourcePath,'r');let reader,globalsBytes=0,globalsHeap=0;
 try{
 const before=fstatSync(fd,{bigint:true});if(!before.isFile()||before.size!==BigInt(pin.sourceBytes))die('source size');reader=new Reader(fd,pin.sourceBytes,budget);
 reader.object(key=>{
 if(!ROOT.includes(key))die('root schema '+key);if(fieldKeys.length>=FIELDS)die('root field bound');const field=fieldKeys.length;fieldKeys.push(key);reader.ws();globalSpans[field*3]=reader.pos;
 if(FEATURE.includes(key))reader.array(ordinal=>{
 if(rows>=ROWS)die('catalog row capacity');budget.add(2048,'feature scalar/hash history');reader.ws();const start=reader.pos,heap=reader.heap,bbox=[Infinity,Infinity,-Infinity,-Infinity],kind=FEATURE.indexOf(key),id=feature(reader,kind,bbox),end=reader.pos;if(end-start>262144)die('feature byte bound');
 const at=rows*9;index[at]=start;index[at+1]=end;for(let i=0;i<4;i++)index[at+2+i]=bbox[i];index[at+6]=kind;index[at+7]=ordinal;index[at+8]=reader.heap-heap;
 createHash('sha256').update(id).digest().copy(hashes,rows*64);reader.rangeHash(start,end).copy(hashes,rows*64+32);rows++;
 });else{const h=reader.heap;reader.value();const n=reader.pos-globalSpans[field*3];if(n>65536||globalsBytes+n>65536)die('global metadata bound');globalsBytes+=n;globalsHeap+=reader.heap-h;}
 globalSpans[field*3+1]=reader.pos;globalSpans[field*3+2]=FEATURE.indexOf(key);
 });
 reader.ws();if(reader.pos!==pin.sourceBytes||reader.full.digest('hex')!==pin.sourceSha256)die('full source hash/EOF');required(new Set(fieldKeys),ROOT);
 const eof=Buffer.alloc(1);if(readSync(fd,eof,0,1,pin.sourceBytes)!==0||!sameStat(before,fstatSync(fd,{bigint:true}))||!sameStat(before,statSync(pin.sourcePath,{bigint:true})))die('source TOCTOU/growth');
 // Metadata only, never feature geometry. Budget UTF8 + parsed tree before parse.
 budget.add(4*(globalsHeap+7*globalsBytes)+65536,'global metadata parse histories');
 const metadata={};for(let f=0;f<fieldKeys.length;f++)if(globalSpans[f*3+2]===-1){const n=globalSpans[f*3+1]-globalSpans[f*3];const b=Buffer.alloc(n);authenticatedRange(fd,b,globalSpans[f*3],globalSpans[f*3+1],reader.chunks,reader.scratch,pin.sourceBytes);metadata[fieldKeys[f]]=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(b));}
 if(metadata.version!==1||metadata.clearanceEvidenceReady!==true||metadata.placementValidated!==false||!isHash(metadata.cacheSha256)||!isHash(metadata.extractor)||typeof metadata.attribution!=='string'||typeof metadata.limits!=='string')die('global schema');
 for(const k of ['counts','errors','exclusionErrors','source'])if(!metadata[k]||Array.isArray(metadata[k])||typeof metadata[k]!=='object')die('global schema '+k);
 if(JSON.stringify(metadata.projection)!==JSON.stringify(DATUM))die('projection datum');
 if(!sameStat(before,fstatSync(fd,{bigint:true})))die('metadata TOCTOU');
 const digest=createHash('sha256').update(new Uint8Array(index.buffer,0,rows*9*8)).update(hashes.subarray(0,rows*64)).update(reader.chunks).update(new Uint8Array(globalSpans.buffer)).digest('hex');
 let fixedHeap=reader.heap;for(let i=0;i<rows;i++)fixedHeap-=index[i*9+8];
 const report=Object.freeze({sourceBytes:pin.sourceBytes,sourceSha256:pin.sourceSha256,catalogSha256:digest,rows,chunkCount:reader.chunks.length/32,numericAndScalarTokens:reader.tokens,numericTokens:reader.numericTokens,featureCounts:Object.freeze(FEATURE.map((_,kind)=>{let n=0;for(let i=0;i<rows;i++)if(index[i*9+6]===kind)n++;return n;})),reservationBytes:budget.own,maxRadius:MAX_RADIUS,haloMetres:HALO});
 const token=Object.freeze(Object.create(null));catalogs.set(token,{pin,sourceStat:before,index,hashes,globalSpans,fieldKeys,rows,chunks:reader.chunks,report,fixedHeap});return Object.freeze({catalog:token,report});
 }finally{closeSync(fd);}
}
function sameID(h,a,b){for(let i=0;i<32;i++)if(h[a*64+i]!==h[b*64+i])return false;return true;}
function chosen(c,s,budget){budget.add(ROWS,'selection flags');const keep=new Uint8Array(ROWS),[ox,oz]=s.originXZ,box=[ox-HALO,oz-HALO,ox+512+HALO,oz+512+HALO];
 for(let i=0;i<c.rows;i++){const p=i*9,kind=c.index[p+6];if(kind===1){const xmin=Math.fround(c.index[p+2]-ox),zmin=Math.fround(c.index[p+3]-oz),xmax=Math.fround(c.index[p+4]-ox),zmax=Math.fround(c.index[p+5]-oz);if(!(xmax<0||zmax<0||xmin>=512||zmin>=512))keep[i]=1;}else if(!(c.index[p+4]<box[0]||c.index[p+2]>box[2]||c.index[p+5]<box[1]||c.index[p+3]>box[3]))keep[i]=1;}
 for(let i=0;i<c.rows;i++)if(c.index[i*9+6]===0&&!keep[i])for(let j=0;j<c.rows;j++)if(keep[j]&&c.index[j*9+6]===1&&sameID(c.hashes,i,j)){keep[i]=1;break;}
 return keep;
}
function derive(c,s,budget){
 const keep=chosen(c,s,budget),counts=[0,0,0];let size=2,heap=c.fixedHeap;
 for(let f=0;f<c.fieldKeys.length;f++){const key=c.fieldKeys[f],kind=c.globalSpans[f*3+2];size+=Buffer.byteLength(JSON.stringify(key))+1+(f?1:0);if(kind<0)size+=c.globalSpans[f*3+1]-c.globalSpans[f*3];else{size+=2;for(let i=0;i<c.rows;i++)if(keep[i]&&c.index[i*9+6]===kind){size+=c.index[i*9+1]-c.index[i*9]+(counts[kind]?1:0);heap+=c.index[i*9+8];counts[kind]++;}}}
 // Includes private output, exposed output, verification snapshot, UTF16 and
 // four parse/copy histories. No instant-GC credit or exported-buffer authority.
 const parseReservation=4*(heap+7*size);budget.add(parseReservation+8*size+2*SLAB+65536+counts.reduce((n,c)=>n+c,0)*2048,'projection/string/parser overlap');
 const output=Buffer.alloc(size),scratch=Buffer.alloc(SLAB);let at=0;const fd=openSync(c.pin.sourcePath,'r');
 try{const before=fstatSync(fd,{bigint:true});if(before.size!==BigInt(c.pin.sourceBytes))die('source size changed');if(!sameStat(before,c.sourceStat))die('source TOCTOU since catalog');
 const range=(start,end,expected)=>{const h=createHash('sha256'),begin=at;for(let p=start;p<end;){const chunk=Math.floor(p/SLAB),offset=chunk*SLAB,n=Math.min(SLAB,c.pin.sourceBytes-offset);exactRead(fd,scratch,n,offset);if(hash(scratch.subarray(0,n))!==c.chunks.subarray(chunk*32,chunk*32+32).toString('hex'))die('authenticated chunk changed');const first=p-offset,take=Math.min(n-first,end-p);scratch.copy(output,at,first,first+take);h.update(scratch.subarray(first,first+take));at+=take;p+=take;}if(expected&&h.digest('hex')!==expected)die('feature span changed');return begin;};
 const text=t=>{at+=output.write(t,at,'utf8');};text('{');
 for(let f=0;f<c.fieldKeys.length;f++){if(f)text(',');text(JSON.stringify(c.fieldKeys[f])+':');const kind=c.globalSpans[f*3+2];if(kind<0)range(c.globalSpans[f*3],c.globalSpans[f*3+1]);else{text('[');let count=0;for(let i=0;i<c.rows;i++)if(keep[i]&&c.index[i*9+6]===kind){if(count++)text(',');range(c.index[i*9],c.index[i*9+1],c.hashes.subarray(i*64+32,i*64+64).toString('hex'));}text(']');}}text('}');
 if(at!==size)die('projection byte accounting');if(readSync(fd,scratch,0,1,c.pin.sourceBytes)!==0||!sameStat(before,fstatSync(fd,{bigint:true}))||!sameStat(before,statSync(c.pin.sourcePath,{bigint:true})))die('source TOCTOU/growth');
 }finally{closeSync(fd);}
 const projectedSha256=hash(output),proof=Object.freeze({schema:SCENERY_PROJECTION_VERSION,sourceSha256:c.pin.sourceSha256,sourceBytes:c.pin.sourceBytes,catalogSha256:c.report.catalogSha256,codeProof:Object.freeze({...c.pin.codeProof}),cell:Object.freeze([...s.cell]),originXZ:Object.freeze([...s.originXZ]),haloMetres:HALO,maxRadius:MAX_RADIUS,selectedCounts:Object.freeze(counts),projectedSha256,projectedBytes:size});
 return {bytes:output,proof,parseReservation};
}
export function projectScenerySupport(catalog,selection,options={}){
 plain(options,['retainedBytes'],'project options');const {retainedBytes=0}=options;const c=catalogs.get(catalog);if(!c)die('opaque catalog required');const budget=ledger(retainedBytes);budget.add(c.report.reservationBytes,'live catalog');const s=selectionPin(selection,budget),r=derive(c,s,budget);return {projectedBytes:Buffer.from(r.bytes),projectedSha256:r.proof.projectedSha256,supportProof:r.proof,reservationBytes:budget.own};
}
export function verifyScenerySupport(args){
 plain(args,['source','selection','projectedSha256','retainedBytes'],'verification');const {source,selection,projectedSha256,retainedBytes=0}=args;
 if(!isHash(projectedSha256))die('expected projected SHA');const budget=ledger(retainedBytes),s=selectionPin(selection,budget),opened=openVerifiedSceneryCatalog(source,{retainedBytes:budget.used});budget.add(opened.report.reservationBytes,'verified catalog lifetime');const c=catalogs.get(opened.catalog),r=derive(c,s,budget);
 if(r.proof.projectedSha256!==projectedSha256)die('projection reconstruction hash');const token=Object.freeze(Object.create(null));verified.set(token,{bytes:r.bytes,proof:r.proof,selection:s,reservationBytes:budget.own});return Object.freeze({token,report:Object.freeze({binding:r.proof,reservationBytes:budget.own})});
}
export function consumeVerifiedScenerySupport(token,args){
 plain(args,['cell','originXZ','retainedBytes'],'consumption');const {cell,originXZ,retainedBytes=0}=args;const state=verified.get(token);if(!state)die('opaque verified single-use support required');const budget=ledger(retainedBytes);budget.add(state.reservationBytes,'verified projection lifetime');const actualCell=vector(cell,'actual cell'),actualOrigin=vector(originXZ,'actual origin');if(actualCell.some((v,i)=>v!==state.selection.cell[i])||actualOrigin.some((v,i)=>v!==state.selection.originXZ[i]))die('actual cell/origin substitution');verified.delete(token);
 // Bytes and parser input are private. No exposed projection/report can rewrite
 // the authenticated support between verification and consumption.
 const scenery=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(state.bytes));return {scenery,binding:state.proof,reservationBytes:state.reservationBytes};
}
// Validation helper for external expected bytes: no caller buffer becomes a seal.
export function assertProjectedBytes(bytes,expectedSha256,options={}){plain(options,['retainedBytes'],'byte options');const {retainedBytes=0}=options;const b=ledger(retainedBytes),v=bytesView(bytes);b.add(v.backingBytes+v.view.byteLength,'expected bytes snapshot');if(!isHash(expectedSha256))die('expected bytes SHA');const snapshot=Buffer.from(v.view);if(hash(snapshot)!==expectedSha256)die('expected bytes changed');return Object.freeze({sha256:expectedSha256,bytes:snapshot.length,reservationBytes:b.own});}
