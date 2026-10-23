import {open} from 'node:fs/promises';
// No default policy cap: aggregate local build packages retain their own rules.
// Callers with an existing artifact limit apply it before allocation or reading.
export async function readOriginalBytes(path,{openFile=open,maxBytes=Infinity,label='JSON input'}={}){
 if(maxBytes!==Infinity&&(!Number.isSafeInteger(maxBytes)||maxBytes<1))throw Error('Invalid JSON input byte limit');
 const file=await openFile(path,'r');try{
  const before=await file.stat(),size=before.size;if(!before.isFile()||!Number.isSafeInteger(size)||size<1)throw Error('Invalid '+label.toLowerCase()+' file');
  if(size>maxBytes)throw Error(label+' exceeds existing byte limit');
  const bytes=new Uint8Array(size);let offset=0;while(offset<size){const {bytesRead}=await file.read(bytes,offset,size-offset,offset);if(!bytesRead)throw Error(label+' shrank while reading');offset+=bytesRead;}
  const extra=new Uint8Array(1);if((await file.read(extra,0,1,size)).bytesRead||(await file.stat()).size!==size)throw Error(label+' changed while reading');return bytes;
 }finally{await file.close();}
}
export async function readOriginalJSON(path,options){
 // Retain the old JSON.parse BOM rejection while rejecting malformed UTF8.
 return JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(await readOriginalBytes(path,options)));
}
