// Resolve the frozen production solver against the real source dependencies.
export async function resolve(spec,ctx,next){
 if(ctx.parentURL?.endsWith('/bus-suspension/physics-before.js')&&spec.startsWith('./')){
  const path=spec==='./road.js'?'../../tools/physics-test/road-stub.mjs':'../../src/'+spec.slice(2);
  return next(new URL(path,import.meta.url).href,ctx);
 }
 return next(spec,ctx);
}
