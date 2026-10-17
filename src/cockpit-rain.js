import * as T from 'three';
// One shared 128px beading mask covers the whole glass; no repeated droplet grid.
let tile;
export function cockpitDropTexture(){
 if(tile)return tile;
 const canvas=document.createElement('canvas');canvas.width=canvas.height=128;
 const c=canvas.getContext('2d');
 let seed=831;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
 for(let i=0;i<95;i++){
  const x=random()*128,y=random()*128,r=.20+random()*.30;
  c.fillStyle='rgba(215,228,238,.24)';c.beginPath();c.ellipse(x,y,r,r*1.4,0,0,Math.PI*2);c.fill();
  c.strokeStyle='rgba(75,91,105,.16)';c.lineWidth=.35;c.stroke();
 }
 tile=new T.CanvasTexture(canvas);tile.name='cockpit-droplet-alpha-tile';tile.wrapS=tile.wrapT=T.RepeatWrapping;tile.generateMipmaps=false;tile.minFilter=T.LinearFilter;return tile;
}
export function cockpitDropMaterial(time){
 return new T.ShaderMaterial({name:'cockpit-rain-overlay',uniforms:{uTime:time,uRain:{value:0},uSpeed:{value:0},uHasWipers:{value:0},uAmb:{value:new T.Vector3(.3,.3,.3)},uWipe:{value:1.25},uDrops:{value:cockpitDropTexture()}},
 vertexShader:'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
 fragmentShader:`uniform sampler2D uDrops;uniform float uTime,uRain,uWipe,uSpeed,uHasWipers;uniform vec3 uAmb;varying vec2 vUv;
 const float TAU=6.2831853, SWEEP=2.3, ARM=.50;
 float since(vec2 m,vec2 P,float w,float omega){vec2 r=m-P;if(length(r)>ARM||r.y<0.)return 100.;float s=(3.14159265-atan(r.y,r.x))/SWEEP;if(s<0.||s>1.)return 100.;float a=acos(clamp(1.-2.*s,-1.,1.));return min(mod(w-a,TAU),mod(w-(TAU-a),TAU))/omega;}
 void main(){vec2 m=vUv*vec2(1.3,.75);float omega=TAU/uWipe,w=mod(uTime*omega,TAU);float age=min(since(m,vec2(.52,0.),w,omega),since(m,vec2(1.04,0.),w,omega));float speed=clamp(uSpeed/40.,0.,1.);vec2 beadUv=vUv+vec2(0.,-uTime*(.001+speed*.006)*(1.-uHasWipers));vec4 d=texture2D(uDrops,beadUv);float clear=mix(1.-.78*speed,smoothstep(.08,1.6,age),uHasWipers);float a=d.a*uRain*clear;if(a<.003)discard;gl_FragColor=vec4(d.rgb*clamp(uAmb*2.,vec3(.025),vec3(1.)),a);}`,
 transparent:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-2,side:T.DoubleSide});
}
// The same UV stations and sweep constants drive physical blades and the
// alpha wipe mask. Pivots sit on the cowl; blades stay on the glass plane.
export function attachCockpitWipers(model,group,corners,material){
 const [bl,br,tr,tl]=corners,geometry=new T.BufferGeometry();
 geometry.setAttribute('position',new T.Float32BufferAttribute(corners.flatMap(v=>v.toArray()),3));geometry.setAttribute('uv',new T.Float32BufferAttribute([0,0,1,0,1,1,0,1],2));geometry.setIndex([0,1,2,0,2,3]);geometry.computeVertexNormals();
 model.cockpitWindscreen=new T.Mesh(geometry); // Attachment surface only; never added/drawn as glass.
 const surface=model.cockpitWindscreen;surface.name='cockpit-windscreen-rain-surface';surface.userData.cockpitRainSurface=true;
 const point=(u,v,out)=>out.copy(bl).lerp(br,u).lerp(new T.Vector3().copy(tl).lerp(tr,u),v);
 const yAxis=new T.Vector3(0,1,0),a=new T.Vector3(),b=new T.Vector3(),delta=new T.Vector3();
 const blades=[.4,.8].map(u=>{const g=new T.Group();g.name='cockpit-wiper';group.add(g);const arm=new T.Mesh(new T.BoxGeometry(.007,1,.006),material);arm.name='cockpit-wiper-blade';arm.userData.cockpitStructure='wiper';g.add(arm);const pivot=new T.Mesh(new T.BoxGeometry(.022,.016,.018),material);pivot.name='cockpit-wiper-pivot';pivot.userData.cockpitStructure='wiper';point(u,0,pivot.position);g.add(pivot);return {u,arm};});
 model.updateCockpitWipers=(time,rain)=>{const angle=Math.PI-2.3*(rain?.5-.5*Math.cos(time*Math.PI*2/1.25):0);for(const {u,arm}of blades){point(u,0,a);point(u+Math.cos(angle)*.50/1.3,Math.sin(angle)*.50/.75,b);arm.position.copy(a).add(b).multiplyScalar(.5);delta.copy(b).sub(a);arm.scale.y=delta.length();arm.quaternion.setFromUnitVectors(yAxis,delta.normalize());}};
 model.updateCockpitWipers(0,false);return surface;
}
