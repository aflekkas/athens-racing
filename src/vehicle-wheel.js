import * as THREE from 'three';
// Keep the steering/spin pivots, caliper and radius. Only the spinning visual is
// rebuilt; planar spokes carry trim count/colour and the shared badge decal.
export function blockyWheel(w,{width=.215,rim=w.r*.68,rubber,metal,back=metal,badge,spokes=5}={}){
  w.spin.clear();
  const add=(g,m,name)=>{const o=new THREE.Mesh(g,m);o.name=name;w.spin.add(o);return o;};
  const profile=[[rim,-width*.5],[w.r,-width*.5],[w.r,width*.5],[rim,width*.5]].map(p=>new THREE.Vector2(...p));
  const tyre=new THREE.LatheGeometry(profile,8);tyre.rotateZ(Math.PI/2);add(tyre,rubber,'blocky-tyre');
  for(const s of w.side===0?[-1,1]:[w.side]){
    const x=s*width*.505;
    const disc=(r,m,offset)=>{const g=new THREE.CircleGeometry(r,8);g.rotateY(s*Math.PI/2);const o=add(g,m,'wheel-disc');o.position.x=x+s*offset;};
    disc(rim,back,0);
    for(let i=0;i<spokes;i++){
      const a=i*Math.PI*2/spokes,r0=.035,r1=rim*.94,da=.09;
      const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute([x+s*.001,Math.cos(a-da)*r0,Math.sin(a-da)*r0,x+s*.001,Math.cos(a+da)*r0,Math.sin(a+da)*r0,x+s*.001,Math.cos(a+da)*r1,Math.sin(a+da)*r1,x+s*.001,Math.cos(a-da)*r1,Math.sin(a-da)*r1],3));g.setAttribute('uv',new THREE.Float32BufferAttribute([0,0,1,0,1,1,0,1],2));g.setIndex(s>0?[0,2,1,0,3,2]:[0,1,2,0,2,3]);g.computeVertexNormals();add(g,metal,'wheel-spoke');
    }
    disc(.031,badge||metal,.003);
  }
}
export function blockyFleetWheels(car){
  const m=car.materials;
  for(const w of car.wheels){
    w.spin.updateMatrixWorld(true);const bounds=new THREE.Box3().setFromObject(w.spin),width=Math.max(.08,Math.min(.4,bounds.max.x-bounds.min.x));
    blockyWheel(w,{width,rubber:m.rubber||m.black,metal:m.alloy||m.chrome||m.silver||m.paint,back:m.darkAlloy||m.black,badge:m.badge});
  }
}
