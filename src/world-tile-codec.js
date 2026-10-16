// Budget/dispatch only. The shared codecs own every byte of ASR decoding.
import { decodeGeometryPack } from './baked-geometry.js';
import { decodeMeshoptPack, MESHOPT_MAGIC } from './meshopt-pack.js';
export async function decodeTilePack(buffer,maxBytes) {
  if(!Number.isSafeInteger(maxBytes)||maxBytes<1||buffer.byteLength>maxBytes||buffer.byteLength<12)throw new Error('Tile codec byte budget');
  const header=new DataView(buffer),magic=header.getUint32(0,true),size=header.getUint32(4,true),start=header.getUint32(8,true);
  if(size>buffer.byteLength-12||start<12+size||start>buffer.byteLength)throw new Error('Tile codec header');
  const metadata=JSON.parse(new TextDecoder().decode(new Uint8Array(buffer,12,size)));
  if(!Array.isArray(metadata.views))throw new Error('Tile codec views');
  let allocations=0;
  for(const view of metadata.views){
    const width=globalThis[view.type]?.BYTES_PER_ELEMENT;
    const bytes=magic===MESHOPT_MAGIC&&view.codec==='ATTRIBUTES'?view.count*view.stride:view.length*width;
    if(!Number.isSafeInteger(bytes)||bytes<0||bytes>maxBytes-allocations)throw new Error('Tile codec decoded byte budget');
    allocations+=bytes;
  }
  return magic===MESHOPT_MAGIC?decodeMeshoptPack(buffer):decodeGeometryPack(buffer);
}
