import { importWithUpdate } from '../client-release.js';
// Loaded only after the garage opens. One renderer, a bounded memory cache and a lazy disk cache.
const memory = new Map(), LIMIT = 80;
export const thumbnailKey = (id, paint, build = 'dev') => `${build}/${id}/${paint.toLowerCase().replace('#','')}`;
const disk = async () => { try { return await globalThis.caches?.open('athens-garage-thumbnails-v2'); } catch { return null; } };
const cacheUrl = key => new URL('/__ui-car-thumbnails__/' + key + '.webp', location.href).href;
async function readBlob(key) { if(memory.has(key))return memory.get(key); try{return await (await (await disk())?.match(cacheUrl(key)))?.blob();}catch{return null;} }
async function writeBlob(key, blob) {
  memory.set(key,blob);if(memory.size>LIMIT)memory.delete(memory.keys().next().value);
  try { const cache=await disk();if(!cache)return;await cache.put(cacheUrl(key),new Response(blob,{headers:{'Content-Type':'image/webp'}}));const keys=await cache.keys();for(const key of keys.slice(0,Math.max(0,keys.length-LIMIT)))await cache.delete(key); } catch { /* a private browser can still use memory */ }
}
const studioFactory = async () => (await importWithUpdate(() => import('../title-hero-studio.js'))).createHeroStudio();
const snapshot = canvas => new Promise(resolve => canvas.toBlob(resolve,'image/webp',.86));
export function mountGarageThumbnails(root, cars, paintFor, { Observer = IntersectionObserver, createStudio = studioFactory, read = readBlob, write = writeBlob, capture = snapshot, build = document.querySelector('meta[name="asr-build"]')?.content || 'dev' } = {}) {
  let stopped=false, studio, running=null, rendered=0, cacheHits=0, peakGeometries=0, peakTextures=0;const queue=[],urls=new Set();
  const display = async (img,blob) => {if(stopped||!img.isConnected)return;const url=URL.createObjectURL(blob);urls.add(url);img.src=url;try{await img.decode();}catch{}if(!stopped)img.dataset.thumbReady='true';};
  const pump = () => running ||= (async()=>{
    while(queue.length&&!stopped){const img=queue.shift(),spec=cars.find(c=>c.id===img.dataset.carThumb);if(!spec)continue;
      const paint=paintFor(spec),key=thumbnailKey(spec.id,paint,build);let blob=await read(key);if(stopped)break;
      if(blob)cacheHits++;if(!blob){studio ||= await createStudio();if(stopped)break;studio.setVehicle(spec,paint);await studio.draw(480,240);rendered++;peakGeometries=Math.max(peakGeometries,studio.info?.geometries||0);peakTextures=Math.max(peakTextures,studio.info?.textures||0);if(stopped)break;blob=await capture(studio.canvas);if(blob)await write(key,blob);}
      if(blob){img.dataset.thumbKey=key;await display(img,blob);}await new Promise(resolve=>setTimeout(resolve,0));
    }
  })().catch(error=>{if(!stopped)console.warn('Garage thumbnail unavailable',error);}).finally(()=>{running=null;if(stopped)studio?.dispose();});
  const observer=new Observer(entries=>{for(const e of entries)if(e.isIntersecting){queue.push(e.target);observer.unobserve(e.target);}void pump();},{root:root.querySelector('.car-grid'),rootMargin:'120px'});
  root.querySelectorAll('[data-car-thumb]').forEach(img=>observer.observe(img));
  return {get info(){return {rendered,cacheHits,renderers:studio?1:0,peakGeometries,peakTextures};},whenIdle:()=>running||Promise.resolve(),dispose(){stopped=true;observer.disconnect();queue.length=0;urls.forEach(url=>URL.revokeObjectURL(url));if(!running)studio?.dispose();}};
}
