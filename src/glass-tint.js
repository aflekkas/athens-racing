import {setPovExteriorView} from './pov-visibility.js';
// Owner-locked: dark, opaque exterior windows; no glazing in the owner's POV.
export const GLASS_TINT = Object.freeze(Object.fromEntries(['cabin','privacy','open','far'].map(k=>[k,Object.freeze({color:'#0b151b',opacity:1})])));
export function tintGlass(m,kind='cabin') {
  const t=GLASS_TINT[kind]||GLASS_TINT.cabin;
  m.color.set(t.color);m.opacity=1;m.transparent=false;m.depthWrite=true;
  m.metalness=0;m.roughness=.22;m.envMap=null;
  if('clearcoat' in m)m.clearcoat=0;
  if('transmission' in m)m.transmission=0;
  m.userData.vehicleGlass=true;
  return m;
}
// Called after damage/LOD updates. Only this car is affected; mirrors and other
// cars keep their exterior glazing. Preserve prior visibility across switches.
export function setVehicleCockpitView(car,cockpit){
  car.root.traverse(o=>{
    if(!o.isMesh)return;
    if(![].concat(o.material||[]).some(m=>m.userData?.vehicleGlass))return;
    if(cockpit){if(o.userData.cockpitGlassVisible===undefined)o.userData.cockpitGlassVisible=o.visible;o.visible=false;}
    else if(o.userData.cockpitGlassVisible!==undefined){o.visible=o.userData.cockpitGlassVisible;delete o.userData.cockpitGlassVisible;}
  });
  const rider=car.body.getObjectByName('attached-rider');if(rider)rider.visible=!cockpit;
  setPovExteriorView(car,cockpit);car.cockpitView=!!cockpit;
}
