import * as T from 'three';
// Mask colour IDs 9–10 stay reserved so existing car fixtures keep their encoding.
export const STRUCTURE_ROLES=['dash','deck','pillar','header','door-top','wheel-rim','wheel-hub','wheel-badge','reserved-9','reserved-10','mirror-mount','wiper','binnacle','console','vent','headliner'];
// One colour per semantic part, with every other vehicle surface still writing
// depth. This catches hidden, occluded and off-screen geometry, not just names.
export function renderStructureMask(renderer,model,camera,width=1280,height=800){
 const scene=new T.Scene();scene.background=new T.Color(0xffffff);const parent=model.root.parent,index=parent?.children.indexOf(model.root);scene.add(model.root);
 const originals=[],materials=[];model.root.traverse(o=>{if(!o.isMesh)return;originals.push([o,o.material]);const role=STRUCTURE_ROLES.indexOf(o.userData.cockpitStructure);const convert=m=>{const clear=m.transparent&&!/instrument|mirror/.test(o.name)&&role<0;const material=new T.MeshBasicMaterial({color:role<0?0x000000:(role+1)*0x10000,side:m.side,transparent:clear,opacity:clear?0:1,depthWrite:!clear});if(role>=0)material.color.setRGB((role+1)/255,0,0);materials.push(material);return material;};o.material=Array.isArray(o.material)?o.material.map(convert):convert(o.material);});
 const target=new T.WebGLRenderTarget(width,height),previous=renderer.getRenderTarget(),tone=renderer.toneMapping,shadow=renderer.shadowMap.enabled,pixels=new Uint8Array(width*height*4);
 try{renderer.setRenderTarget(target);renderer.toneMapping=T.NoToneMapping;renderer.shadowMap.enabled=false;renderer.render(scene,camera);renderer.readRenderTargetPixels(target,0,0,width,height,pixels);}
 finally{renderer.setRenderTarget(previous);renderer.toneMapping=tone;renderer.shadowMap.enabled=shadow;for(const [o,m]of originals)o.material=m;materials.forEach(m=>m.dispose());target.dispose();if(parent){parent.add(model.root);parent.children.splice(parent.children.indexOf(model.root),1);parent.children.splice(index,0,model.root);}}
 const roles=Object.fromEntries(STRUCTURE_ROLES.map(role=>[role,{pixels:0,minX:width,maxX:-1,minY:height,maxY:-1}]));
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=(y*width+x)*4;if(pixels[i+1]||pixels[i+2])continue;const role=STRUCTURE_ROLES[pixels[i]-1];if(!role)continue;const row=roles[role];row.pixels++;row.minX=Math.min(row.minX,x);row.maxX=Math.max(row.maxX,x);row.minY=Math.min(row.minY,height-1-y);row.maxY=Math.max(row.maxY,height-1-y);}
 const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const ctx=canvas.getContext('2d'),data=ctx.createImageData(width,height);for(let y=0;y<height;y++)data.data.set(pixels.subarray((height-1-y)*width*4,(height-y)*width*4),y*width*4);ctx.putImageData(data,0,0);
 return {roles,image:canvas.toDataURL().split(',')[1]};
}
