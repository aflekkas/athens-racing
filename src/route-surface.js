// The imported Megara circuit graph retains a generic road label while its
// authenticated wheel-contact triangles carry these authored asphalt labels.
export const MEGARA_RACEWAY=/^megara:e:raceway-70043234:\d+:[fr]$/;
export const MEGARA_DRIVE_SURFACES=Object.freeze(['surface:megaraAsphalt','surface:megaraWornAsphalt','surface:megaraRubber']);
export function routeSurfaceAllowed(edge,contact,graph){
 if(contact.layer!==edge.layer)return false;
 if(MEGARA_RACEWAY.test(edge.id)&&edge.surface==='surface:roads'&&edge.layer===0&&!(edge.flags&8))return MEGARA_DRIVE_SURFACES.includes(contact.surfaceId);
 return [...graph.edges.values()].some(v=>v.value.surface===contact.surfaceId&&v.value.layer===contact.layer);
}
