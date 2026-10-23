// Strict JSON ownership for asynchronous authentication. Callers retain their
// existing wire policy; conservative live-phase accounting precedes cloning.
const PHASE_LIMIT=12*1024*1024;
const fail=()=>{throw Error('Authentication input unavailable or snapshot budget exceeded');};
export function snapshotJSONForAuthentication(value,{maxCombinedBytes=PHASE_LIMIT,maxWireBytes=Infinity,extraCopyCount=0,selection=true}={}){
 if(!Number.isSafeInteger(maxCombinedBytes)||maxCombinedBytes<1||maxWireBytes!==Infinity&&(!Number.isSafeInteger(maxWireBytes)||maxWireBytes<1)||!Number.isSafeInteger(extraCopyCount)||extraCopyCount<0)fail();
 const copies=2+extraCopyCount;
 let dataBytes=0,bytes=0,codeUnits=0,scratchBytes=0;const active=new Set();
 const add=(n,b=n)=>{codeUnits+=n;bytes+=b;if(bytes>maxWireBytes)fail();};
 const string=s=>{add(2);for(let i=0;i<s.length;i++){const c=s.charCodeAt(i);if(c===34||c===92||c===8||c===9||c===10||c===12||c===13)add(2);else if(c<32)add(6);else if(c>=0xd800&&c<=0xdbff&&s.charCodeAt(i+1)>=0xdc00&&s.charCodeAt(i+1)<=0xdfff){add(2,4);i++;}else if(c>=0xd800&&c<=0xdfff)add(6);else add(1,c<128?1:c<2048?2:3);}};
 const fields=(v,spec)=>{
  const keys=Reflect.ownKeys(v);scratchBytes=Math.max(scratchBytes,keys.length*192);
  if(copies*dataBytes+scratchBytes>maxCombinedBytes||keys.some(k=>typeof k!=='string'))fail();
  if(spec!==true&&spec.fields){const selected=[];for(const k of Object.keys(spec.fields)){const d=Object.getOwnPropertyDescriptor(v,k);if(d){if(!d.enumerable||!Object.hasOwn(d,'value'))fail();selected.push(k);}}return selected;}
  return keys;
 };
 const visit=(v,depth=0,spec=true)=>{
  if(depth>32)fail();
  dataBytes+=typeof v==='string'?48+2*v.length:v&&typeof v==='object'?96:16;
  if(copies*dataBytes>maxCombinedBytes)fail();
  if(v===null){add(4);return;}
  if(typeof v==='string'){string(v);return;}
  if(typeof v==='boolean'){add(v?4:5);return;}
  if(typeof v==='number'){if(!Number.isFinite(v))fail();add(JSON.stringify(Object.is(v,-0)?0:v).length);return;}
  if(typeof v!=='object'||active.has(v))fail();
  const array=Array.isArray(v),prototype=Object.getPrototypeOf(v);if(array?prototype!==Array.prototype:prototype!==Object.prototype&&prototype!==null)fail();
  active.add(v);const keys=fields(v,spec);
  if(array){
   if(spec!==true&&!spec.array)fail();
   const length=Object.getOwnPropertyDescriptor(v,'length');if(!length||!Number.isSafeInteger(length.value)||length.value<0||keys.length!==length.value+1)fail();
   add(2+Math.max(0,length.value-1));
   for(let i=0;i<length.value;i++){const d=Object.getOwnPropertyDescriptor(v,String(i));if(!d||!d.enumerable||!Object.hasOwn(d,'value'))fail();dataBytes+=48+String(i).length*2;visit(d.value,depth+1,spec===true?true:spec.array);}
  }else{
   if(spec!==true&&!spec.fields&&!spec.record)fail();
   add(2+Math.max(0,keys.length-1)+keys.length);
   for(const k of keys){const d=Object.getOwnPropertyDescriptor(v,k);if(!d||!d.enumerable||!Object.hasOwn(d,'value'))fail();dataBytes+=48+2*k.length;string(k);visit(d.value,depth+1,spec===true?true:spec.fields?spec.fields[k]:spec.record);}
  }
  active.delete(v);
 };
 visit(value,0,selection);
 // The caller remains live. Charge its complete graph again for the private
 // copy, full canonical UTF16, UTF8 output, and a conservative digest copy.
 const authenticationBytes=copies*dataBytes+2*codeUnits+2*bytes+scratchBytes;
 if(authenticationBytes>maxCombinedBytes)fail();
 // Projection allocation happens only after the complete selected ORIGINAL
 // graph has passed descriptor inspection and simultaneous-copy accounting.
 const capture=(v,spec)=>{
  if(spec===true)return structuredClone(v);
  if(spec.array){const length=Object.getOwnPropertyDescriptor(v,'length').value,out=new Array(length);for(let i=0;i<length;i++)out[i]=capture(Object.getOwnPropertyDescriptor(v,String(i)).value,spec.array);return out;}
  const out={};for(const k of fields(v,spec)){const d=Object.getOwnPropertyDescriptor(v,k);Object.defineProperty(out,k,{value:capture(d.value,spec.fields?spec.fields[k]:spec.record),enumerable:true,writable:true,configurable:true});}return out;
 };
 const body=capture(value,selection);
 const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
 return {body:freeze(body),metrics:Object.freeze({bytes,codeUnits,callerObjectBytes:dataBytes,snapshotBytes:dataBytes,snapshotPhaseBytes:copies*dataBytes,extraCopyBytes:extraCopyCount*dataBytes,scratchBytes,authenticationBytes})};
}
