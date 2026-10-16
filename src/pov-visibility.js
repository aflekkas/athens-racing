// The exterior shell is drawn for every external camera. From inside, its back
// faces/wheel wells otherwise occupy the lower windshield despite a thin dash.
// Keep authored cockpit furniture and mirror meshes; no geometry/anchors change.
const targets=new WeakMap();
export function setPovExteriorView(model,enabled){
 let meshes=targets.get(model);
 if(!meshes){meshes=[];model.root.traverse(o=>{
  if(!o.isMesh)return;
  let cabin=false;for(let p=o.parent;p&&p!==model.root;p=p.parent)if(p.name==='cockpit-lod'||p.name==='fleet-cockpit')cabin=true;
  if(cabin||/mirror/i.test(o.name)||[].concat(o.material||[]).some(m=>m.userData?.vehicleGlass))return;
  meshes.push(o);});targets.set(model,meshes);}
 for(const o of meshes){
  if(enabled){if(o.userData.povExteriorVisible===undefined)o.userData.povExteriorVisible=o.visible;o.visible=false;}
  else if(o.userData.povExteriorVisible!==undefined){o.visible=o.userData.povExteriorVisible;delete o.userData.povExteriorVisible;}
 }
}
