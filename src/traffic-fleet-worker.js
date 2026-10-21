// Canvas drawing stays procedural and matches the browser's 2D canvas API.
// The external badge atlas is rebound to the render thread's canonical texture.
const deferredImage=()=>({addEventListener(){},removeEventListener(){},set src(value){if(value!=='/assets/brand-badges/atlas.svg')throw Error('Unexpected fleet image');}});
globalThis.document={createElementNS(namespace,tag){if(tag!=='img')throw Error('Unexpected fleet worker element');return deferredImage();},createElement(tag){if(tag!=='canvas')throw Error('Unexpected fleet worker element: '+tag);return new OffscreenCanvas(1,1);}};
const {TRAFFIC_TYPES}=await import('./cars.js');
const {fleetTemplateSet}=await import('./traffic-fleet.js');
const {packFleetTemplate}=await import('./fleet-template-codec.js');
self.onmessage=({data:{id,type}})=>{try{const spec=TRAFFIC_TYPES.find(t=>t.id===type);if(!spec)throw Error('Unknown fleet type');self.postMessage({id,templates:fleetTemplateSet(spec).map(packFleetTemplate)});}catch(error){self.postMessage({id,error:error.stack||error.message});}};
