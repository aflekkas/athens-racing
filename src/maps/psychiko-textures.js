// Original Psychiko scenery textures, isolated from the simplified maps' library.
import * as THREE from 'three';
import { TX as shared } from '../tex.js';
export { GLSL_HELPERS } from '../tex.js';
export const TX = Object.create(shared);
let pending;
export function loadPsychikoTextures() {
  if (pending) return pending;
  const list = {
    plaster:['painted_plaster_wall','diff nor arm'], rock:['rock_face_03','arm'],
    palmbark:['palm_tree_bark','diff nor'], pinebark:['pine_bark','diff nor'],
  };
  const files = Object.entries(list).flatMap(([key,[file,maps]]) => maps.split(' ').map(map => [key+'_'+map,file+'_'+map,map==='diff',false]));
  for (const [key,file] of Object.entries({leafBroad:'leaves_broad',leafNarrow:'leaves_narrow',foliage:'foliage_atlas',frond:'palm_frond'})) files.push([key,file,true,key==='foliage'||key==='frond']);
  const loader = new THREE.TextureLoader();
  return pending = Promise.all(files.map(([key,file,srgb,clamp]) => new Promise((resolve,reject) => {
    const t = TX[key] = loader.load('./assets/tex/'+file+'.webp',resolve,undefined,reject);
    t.wrapS=t.wrapT=clamp?THREE.ClampToEdgeWrapping:THREE.RepeatWrapping;
    t.anisotropy=8; if(srgb)t.colorSpace=THREE.SRGBColorSpace;
  })));
}
