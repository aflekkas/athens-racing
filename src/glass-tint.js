import {setPovExteriorView} from './pov-visibility.js';
// 2026-10-17 owner authorization: normal lightly tinted reflective exterior glass.
// Alpha blending avoids a transmission render pass. Own POV glazing stays hidden.
export const GLASS_TINT=Object.freeze({
 cabin:{color:'#a4b9b7',opacity:.20},privacy:{color:'#8ca5a8',opacity:.28},
 open:{color:'#c4d4cf',opacity:.12},far:{color:'#a4b9b7',opacity:.20},
});
export function tintGlass(m,kind='cabin'){
 const t=GLASS_TINT[kind]||GLASS_TINT.cabin;
 m.color.set(t.color);m.opacity=t.opacity;m.transparent=true;m.depthWrite=false;
 m.metalness=0;m.roughness=.08;m.envMapIntensity=.7;m.forceSinglePass=true;
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
