import * as T from 'three';
// Black = every visible opaque vehicle surface (including instruments and mirrors).
// White = unobstructed exterior through the glass/open cockpit. No road-colour heuristic.
export function renderPovMask(renderer,model,camera,width=640,height=400){
 const scene=new T.Scene();scene.background=new T.Color(0xffffff);
 const parent=model.root.parent,oldIndex=parent?.children.indexOf(model.root);scene.add(model.root);
 const originals=[],materials=[];
 model.root.traverse(o=>{if(!o.isMesh)return;originals.push([o,o.material]);const convert=m=>{
  const instrument=/instrument|mirror/.test(o.name)||m===model.cockpit?.material;
  const clear=m.transparent&&!instrument;
  const mask=new T.MeshBasicMaterial({color:0x000000,side:m.side,transparent:clear,opacity:clear?0:1,depthWrite:!clear});materials.push(mask);return mask;
 };o.material=Array.isArray(o.material)?o.material.map(convert):convert(o.material);});
 const target=new T.WebGLRenderTarget(width,height,{depthBuffer:true}),previous=renderer.getRenderTarget(),oldTone=renderer.toneMapping,oldShadow=renderer.shadowMap.enabled;
 const pixels=new Uint8Array(width*height*4);
 try{renderer.toneMapping=T.NoToneMapping;renderer.shadowMap.enabled=false;renderer.setRenderTarget(target);renderer.render(scene,camera);renderer.readRenderTargetPixels(target,0,0,width,height,pixels);}
 finally{renderer.setRenderTarget(previous);renderer.toneMapping=oldTone;renderer.shadowMap.enabled=oldShadow;for(const [o,m]of originals)o.material=m;for(const m of materials)m.dispose();target.dispose();scene.remove(model.root);if(parent){parent.add(model.root);parent.children.splice(parent.children.indexOf(model.root),1);parent.children.splice(oldIndex,0,model.root);}}
 let open=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i]>250&&pixels[i+1]>250&&pixels[i+2]>250)open++;
 const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const ctx=canvas.getContext('2d'),data=ctx.createImageData(width,height);
 for(let y=0;y<height;y++)data.data.set(pixels.subarray((height-1-y)*width*4,(height-y)*width*4),y*width*4);ctx.putImageData(data,0,0);
 return {windscreenPercent:100*open/(width*height),openPixels:open,totalPixels:width*height,width,height,mask:canvas.toDataURL('image/png').split(',')[1]};
}
