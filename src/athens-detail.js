// Procedural dressing for the streamed Athens world: ground, facade and sea textures made in code at load time.
// No image files and no per-place data. One small tileable noise texture (4 channels, 256 px, about 340 KB with mips)
// feeds every pattern; the shaders below read it at scales whose periods divide the 512 m cell, so tile-local UVs
// continue seamlessly across every tile border (the same rule the road scans follow).
// Locked look: unlit colour only. No lights, shadow maps, reflection or refraction pass.
import * as THREE from 'three';
import {worldDetailEnabled} from './world-detail-state.js';

// ---- ground classes ---------------------------------------------------------------------------------------------
// The bake colours every ground vertex by its OSM land class (tools/world-gen/appearance.py TERRAIN, kept equal by
// tools/athens-detail.test.mjs). Vertex colours interpolate across triangles, so the shader recovers soft class
// weights from the colour itself: a boundary between two land classes is a smooth blend, with zero bytes per cell.
export const GROUND_CLASS_COLOURS=Object.freeze({urban:'#86837a',earth:'#958669',grass:'#8ba352',scrub:'#6f7b55',forest:'#3d5638',sand:'#d8c78e',rock:'#868e96'});
export const GROUND_NAMES=Object.freeze(Object.keys(GROUND_CLASS_COLOURS));
export const GROUND_SHARPNESS=4;
const linear=h=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);
/** Colour feature: chroma (scaled) and log brightness, so the bake's +-6% brightness variation never changes the class. */
export const groundFeature=([r,g,b])=>{const s=Math.max(r+g+b,1e-3);return [r/s*12,g/s*12,Math.log(s)];};
const FEATURES=GROUND_NAMES.map(n=>groundFeature(linear(GROUND_CLASS_COLOURS[n])));
/** CPU mirror of the shader's classifier: weights per GROUND_NAMES, summing to 1. */
export function groundWeights(rgb){
  const f=groundFeature(rgb),w=FEATURES.map(c=>Math.exp(-GROUND_SHARPNESS*((f[0]-c[0])**2+(f[1]-c[1])**2+(f[2]-c[2])**2))),s=w.reduce((a,b)=>a+b,0)||1;
  return w.map(v=>v/s);
}

// ---- the one shared noise texture ---------------------------------------------------------------------------------
export const NOISE_SIZE=256;
function rng(seed){let s=seed>>>0||1;return()=>{s^=s<<13;s>>>=0;s^=s>>>17;s^=s<<5;s>>>=0;return s/4294967296;};}
function lattice(n,seed){const r=rng(seed),a=new Float32Array(n*n);for(let i=0;i<a.length;i++)a[i]=r();return a;}
/** Periodic value noise: `n` lattice cells across the texture, smooth interpolation, wraps at the edge. */
function valueNoise(lat,n,x,y){
  const fx=x*n,fy=y*n,x0=Math.floor(fx),y0=Math.floor(fy),tx=fx-x0,ty=fy-y0,sx=tx*tx*(3-2*tx),sy=ty*ty*(3-2*ty);
  const at=(i,j)=>lat[(((j%n)+n)%n)*n+(((i%n)+n)%n)];
  return (at(x0,y0)*(1-sx)+at(x0+1,y0)*sx)*(1-sy)+(at(x0,y0+1)*(1-sx)+at(x0+1,y0+1)*sx)*sy;
}
function stretch(a){let lo=Infinity,hi=-Infinity;for(const v of a){if(v<lo)lo=v;if(v>hi)hi=v;}const k=1/(hi-lo||1);for(let i=0;i<a.length;i++)a[i]=(a[i]-lo)*k;return a;}
/** RGBA bytes. R fine grain, G mid blotches (0.5..2 m at a 16 m period), B low-frequency patches, A ridged lines (cracks, wave crests). */
export function buildNoise(size=NOISE_SIZE){
  const n=size*size,R=new Float32Array(n),G=new Float32Array(n),B=new Float32Array(n),A=new Float32Array(n);
  const grain=lattice(size,11),mid=[8,16,32].map((c,i)=>[c,lattice(c,21+i),[.5,.3,.2][i]]),low=[2,4,8].map((c,i)=>[c,lattice(c,31+i),[.5,.3,.2][i]]),ridge=[8,16,32].map((c,i)=>[c,lattice(c,41+i),[.5,.3,.2][i]]);
  for(let j=0;j<size;j++)for(let i=0;i<size;i++){
    const k=j*size+i,x=i/size,y=j/size,g=(a,b)=>grain[((j+b+size)%size)*size+(i+a+size)%size];
    R[k]=.5*g(0,0)+.125*(g(1,0)+g(-1,0)+g(0,1)+g(0,-1));
    G[k]=mid.reduce((s,[c,l,w])=>s+w*valueNoise(l,c,x,y),0);
    B[k]=low.reduce((s,[c,l,w])=>s+w*valueNoise(l,c,x,y),0);
    const r=ridge.reduce((s,[c,l,w])=>s+w*valueNoise(l,c,x,y),0);A[k]=1-Math.abs(2*r-1);
  }
  stretch(R);stretch(G);stretch(B);for(let i=0;i<n;i++)A[i]=A[i]*A[i];stretch(A);
  const out=new Uint8Array(n*4);for(let i=0;i<n;i++){out[i*4]=Math.round(R[i]*255);out[i*4+1]=Math.round(G[i]*255);out[i*4+2]=Math.round(B[i]*255);out[i*4+3]=Math.round(A[i]*255);}
  return out;
}
let noise=null;
/** The shared texture, built on first use (about 20 ms) and uploaded once. */
export function detailNoise(){
  if(!noise){
    noise=new THREE.DataTexture(buildNoise(),NOISE_SIZE,NOISE_SIZE,THREE.RGBAFormat);
    noise.wrapS=noise.wrapT=THREE.RepeatWrapping;noise.magFilter=THREE.LinearFilter;noise.minFilter=THREE.LinearMipmapLinearFilter;noise.generateMipmaps=true;noise.anisotropy=4;noise.colorSpace=THREE.NoColorSpace;noise.needsUpdate=true;noise.name='athens-detail-noise';
  }
  return noise;
}
export const detailNoiseBytes=()=>Math.round(NOISE_SIZE*NOISE_SIZE*4*4/3);
/** Seconds, shared by every sea material; the render loop sets it. */
export const SEA_TIME={value:0};

// ---- shader source ------------------------------------------------------------------------------------------------
const f=n=>n.toFixed(5);
const centroids=GROUND_NAMES.map((n,i)=>{const c=FEATURES[i];return `const vec3 GC${i}=vec3(${f(c[0])},${f(c[1])},${f(c[2])});`;}).join('\n');
const weights=GROUND_NAMES.map((n,i)=>`float w${i}=exp(-${GROUND_SHARPNESS.toFixed(1)}*dot(gf-GC${i},gf-GC${i}));`).join('\n');
const blend=GROUND_NAMES.map((n,i)=>`w${i}*g_${n}(p,a,b,low,fine)`).join('+');
const wsum=GROUND_NAMES.map((n,i)=>`w${i}`).join('+');
const NOISE_GLSL=`uniform sampler2D detailMap;uniform float uWorldDetail;
float h21(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}`;

/** Ground: a recipe per land class, each a brightness-neutral multiplier around 1, blended by the colour weights. */
export const GROUND_GLSL=`${NOISE_GLSL}
varying vec2 vGroundP;varying float vGroundDist;
${centroids}
vec3 g_urban(vec2 p,vec4 a,vec4 b,float low,vec4 fine){
  vec2 c=fract(p/2.56);float edge=min(min(c.x,1.-c.x),min(c.y,1.-c.y))*2.56;float joint=1.-smoothstep(.012,.05,edge);
  return vec3((.88+.24*b.r)*(.88+.24*a.g)*(1.-.22*joint)*(1.-.22*smoothstep(.8,1.,a.a)));}
vec3 g_earth(vec2 p,vec4 a,vec4 b,float low,vec4 fine){
  float peb=.7+.6*b.r;float blot=.72+.56*a.g;return vec3(peb*blot*(.94+.12*fine.r))*mix(vec3(1.07,1.,.88),vec3(.93,.98,1.07),low);}
vec3 g_grass(vec2 p,vec4 a,vec4 b,float low,vec4 fine){
  float dry=smoothstep(.5,.85,low*.6+a.b*.4);vec3 tone=mix(vec3(.84,1.06,.76),vec3(1.14,1.04,.72),dry);
  return tone*(.7+.6*a.g)*(.8+.4*b.r)*(.92+.16*fine.r);}
vec3 g_scrub(vec2 p,vec4 a,vec4 b,float low,vec4 fine){
  float bush=smoothstep(.46,.62,a.g*.55+b.g*.45);vec3 dryTone=vec3(1.16,1.05,.86);vec3 leaf=vec3(.6,.76,.52);
  return mix(dryTone,leaf,bush)*(.78+.44*b.r)*(.88+.24*low);}
vec3 g_forest(vec2 p,vec4 a,vec4 b,float low,vec4 fine){
  float needles=.5+.9*b.r;float dark=smoothstep(.42,.64,a.g);vec3 litter=mix(vec3(1.22,1.,.74),vec3(.78,.94,.8),dark);
  return litter*needles*(.8+.4*b.g)*(.94+.12*fine.r);}
vec3 g_sand(vec2 p,vec4 a,vec4 b,float low,vec4 fine){
  float rip=texture2D(detailMap,vec2(p.x/10.24,p.y/1.6)).a;return vec3((.92+.16*b.r)*(.9+.2*rip)*(.94+.12*low));}
vec3 g_rock(vec2 p,vec4 a,vec4 b,float low,vec4 fine){
  float crack=smoothstep(.7,.95,a.a);float strata=.88+.2*sin(p.y*.9+a.g*4.);return vec3((.74+.52*a.g)*strata*(1.-.45*crack)*(.86+.28*b.r));}
vec3 groundMul(vec2 p,vec3 base){
  vec4 a=texture2D(detailMap,p/16.),b=texture2D(detailMap,p/4.+.31),fine=texture2D(detailMap,p/1.28+.17);
  float low=(texture2D(detailMap,p/128.).b+texture2D(detailMap,p/(512./3.)+.37).b)*.5;
  float s=max(base.r+base.g+base.b,1e-3);vec3 gf=vec3(base.r/s*12.,base.g/s*12.,log(s));
  ${weights}
  vec3 m=(${blend}+vec3(1e-4))/(${wsum}+1e-4);return m*(.68+.64*low)*(.9+.2*a.b);}`;
export const GROUND_VERTEX_VARYINGS='varying vec2 vGroundP;varying float vGroundDist;';
export const GROUND_VERTEX_BODY='vGroundP=position.xz;vGroundDist=length((modelViewMatrix*vec4(position,1.)).xyz);';
export const GROUND_APPLY=`{float k=uWorldDetail*(1.-smoothstep(160.,360.,vGroundDist));diffuseColor.rgb*=mix(vec3(1.),groundMul(vGroundP,diffuseColor.rgb),k);}`;

/** Facade: tiled window / balcony / shopfront rhythm per 3.05 m floor, chosen by facade style 0..7 (FACADE_STYLES). */
export const FACADE_GLSL=`${NOISE_GLSL}
varying vec3 vFac;varying vec2 vFacP;varying float vFacDist;varying vec3 vFacW;varying vec3 vFacCam;
// Derived buildings carry no vertex colour: each flat face is shaded here from its own normal (screen-space derivatives of the
// local position), the bake's old face_shaded() values: roofs 1, walls .75+.10*(n.x*-.6+n.z*-.8) in display space, as linear.
// A mesh that still has vertex colours (an older bake) is shaded by them, through color_fragment, and gets 1 here.
float wallShade(){
#ifdef USE_COLOR
  return 1.;
#else
  vec3 n=normalize(cross(dFdx(vFacW),dFdy(vFacW)));
  if(dot(n,vFacCam-vFacW)<0.)n=-n; // the visible face is the outward one, whatever the handedness of the view (mirrors flip it)
  float level=abs(n.y)>.9?1.:.75+.10*(n.x*-.6+n.z*-.8);
  return level<=.04045?level/12.92:pow((level+.055)/1.055,2.4);
#endif
}
float rect(vec2 q,vec2 lo,vec2 hi,vec2 aa){vec2 s=smoothstep(lo-aa,lo+aa,q)-smoothstep(hi-aa,hi+aa,q);return s.x*s.y;}
vec3 signColour(float r){return r<.25?vec3(.62,.36,.3):r<.5?vec3(.3,.42,.5):r<.75?vec3(.82,.76,.58):vec3(.42,.52,.42);}
vec3 facadeMul(float u,float v,float st){
  float bayW=st>4.5&&st<5.5?2.2:st>6.5?5.2:st<.5?3.6:3.1;
  float bx=u/bayW,by=v/3.05;vec2 cell=vec2(floor(bx),floor(by)),q=vec2(fract(bx),fract(by));
  vec2 aa=max(fwidth(vec2(bx,by))*.8,vec2(.002));float rnd=h21(cell+st*7.),rnd2=h21(vec2(cell.x,3.)+st);
  vec3 m=vec3(.97+.06*texture2D(detailMap,vec2(u,v)/6.4).g);bool ground=cell.y<.5;
  if(st>6.5){ // industrial: vertical sheet profile and one high window band
    m*=.9+.1*mix(.5,step(.5,fract(u/.4)),1.-smoothstep(.05,.14,fwidth(u)));float band=rect(vec2(0.,v),vec2(-1.,4.4),vec2(1.,5.9),vec2(1.,aa.y*3.05));
    return mix(m,vec3(.2,.26,.29),band*.9);}
  if(st>4.5&&st<5.5&&!ground){ // offices: continuous glazing ribbon between spandrels
    float ribbon=rect(q,vec2(-1.,.2),vec2(2.,.76),aa)*(1.-rect(vec2(q.x,0.),vec2(-.01,-1.),vec2(.05,1.),aa));
    vec3 gl=mix(vec3(.16,.23,.28),vec3(.32,.42,.48),q.y);return mix(m*.96,gl,ribbon*.92);}
  if(st>5.5&&st<6.5){float rows=fract(v/.28),cols=fract(u/.5+.5*floor(v/.28));float mj=1.-smoothstep(.04,.1,fwidth(v));m*=1.-mj*(.1*(1.-smoothstep(.0,.05,rows))+.1*(1.-smoothstep(.0,.04,cols)))-.06*(1.-mj);}
  // upper floors and ground floor share the window rhythm; the ground floor swaps it for shopfront or door
  bool balcony=st>.5&&st<1.5||st>2.5&&st<3.5;
  vec2 lo=balcony?vec2(.22,.13):vec2(.28,.3),hi=balcony?vec2(.78,.84):vec2(.72,.8);
  bool shop=ground&&(st>3.5&&st<4.5||(st>.5&&st<1.5||st>2.5&&st<3.5)&&rnd2>.55);
  if(shop){
    float glass=rect(q,vec2(.06,.1),vec2(.94,.7),aa),mull=rect(vec2(q.x,0.),vec2(.47,-1.),vec2(.53,1.),aa);
    vec3 gl=vec3(.1,.13,.15)+.14*rnd;m=mix(m,gl,glass*(1.-mull*.8));
    float board=rect(q,vec2(.04,.74),vec2(.96,.93),aa);m=mix(m,signColour(rnd2)*.9,board);
    if(st>2.5&&st<3.5){float stripe=mix(.5,step(.5,fract(u/.5)),1.-smoothstep(.12,.3,fwidth(u)));m=mix(m,mix(vec3(.62,.24,.18),vec3(.9,.86,.76),stripe),rect(q,vec2(0.,.64),vec2(1.,.8),aa)*.85);}
    return m*(ground?.94:1.);}
  float win=rect(q,lo,hi,aa);vec3 gl=mix(vec3(.12,.16,.19),vec3(.32,.4,.44),smoothstep(.3,.8,q.y)*.6+rnd*.3);
  if(rnd>.8)gl=vec3(.42,.4,.34);if(rnd<.12)gl=vec3(.19,.27,.22);
  float frame=rect(q,lo-vec2(.035,.03),hi+vec2(.035,.03),aa)-win;m*=1.-frame*.1;m=mix(m,gl,win);
  m*=1.-rect(q,vec2(lo.x-.05,lo.y-.06),vec2(hi.x+.05,lo.y),aa)*.14;
  if(st>1.5&&st<2.5){float sh=rect(q,vec2(lo.x-.15,lo.y-.02),vec2(lo.x-.01,hi.y+.02),aa)+rect(q,vec2(hi.x+.01,lo.y-.02),vec2(hi.x+.15,hi.y+.02),aa);m=mix(m,vec3(.2,.34,.26)*(.8+.4*rnd),sh*.9);}
  if(balcony&&!ground){ // slab edge, then dark railing bars with a handrail above them
    m*=1.-.12*(1.-smoothstep(.07,.1,q.y));
    float rail=rect(q,vec2(-1.,.1),vec2(2.,.4),aa)*mix(.5,step(.45,fract(u/.15)),1.-smoothstep(.03,.08,fwidth(u))),hand=rect(q,vec2(-1.,.38),vec2(2.,.43),aa);
    m=mix(m,vec3(.17,.19,.2),max(rail*.8,hand*.95));}
  if(ground){m*=.9;float door=rect(q,vec2(.34,0.),vec2(.66,.72),aa)*step(mod(cell.x,3.),.5);m=mix(m,vec3(.2,.14,.1),door*.85);}
  return m;}
vec3 roofMul(vec2 p){vec4 n=texture2D(detailMap,p/8.);return vec3((.78+.14*n.r)*(.92+.14*n.g));}
vec3 facadeOrRoof(){
  bool roof=vFac.x>6553.;vec3 m=roof?roofMul(vFacP):facadeMul(vFac.x,vFac.y,floor(vFac.z+.5));
  float k=uWorldDetail*(1.-smoothstep(150.,260.,vFacDist));return mix(vec3(1.),mix(vec3(.86),m,k),uWorldDetail);}`;
export const FACADE_VERTEX_VARYINGS='attribute vec2 aFacade;varying vec3 vFac;varying vec2 vFacP;varying float vFacDist;varying vec3 vFacW;varying vec3 vFacCam;';
export const FACADE_VERTEX_BODY='vFac=vec3(aFacade.x*.1,mod(aFacade.y,4096.)*.1,floor(aFacade.y/4096.));vFacP=position.xz;vFacW=position;vFacCam=cameraPosition-modelMatrix[3].xyz;vFacDist=length((modelViewMatrix*vec4(position,1.)).xyz);';
export const FACADE_APPLY='diffuseColor.rgb*=facadeOrRoof()*wallShade();';

/** Sea: colour only. Two scrolling ridge layers (different scales and directions) over slow deep/shallow patches. */
export const SEA_GLSL=`${NOISE_GLSL}
uniform float uSeaTime;varying vec2 vSeaP;
vec3 seaColour(vec3 base,vec2 p){
  float t=uSeaTime;
  vec4 w1=texture2D(detailMap,p/64.+vec2(.006,.002)*t),w2=texture2D(detailMap,p*.01171875+vec2(-.004,.007)*t+.41),w3=texture2D(detailMap,p/128.+vec2(.002,-.001)*t),sp=texture2D(detailMap,p/16.+vec2(.02,.012)*t);
  float wave=(w1.a+w2.a)*.5,crest=smoothstep(.45,.9,wave);float body=.92+.16*w3.b;
  vec3 c=base*body*(.94+.12*sp.g);c+=vec3(.025,.05,.06)*crest;return c;}`;
export const SEA_VERTEX_VARYINGS='varying vec2 vSeaP;';
export const SEA_VERTEX_BODY='vSeaP=position.xz;';
export const SEA_APPLY='diffuseColor.rgb=mix(diffuseColor.rgb,seaColour(diffuseColor.rgb,vSeaP),uWorldDetail);';

/** Shore foam: a strip along the coastline, aFoam 1 at the water's edge falling to 0 about 6 m out. Opaque; pieces below the
 * swash threshold are discarded, so the foam needs neither blending nor a second pass. */
export const FOAM_GLSL=`${NOISE_GLSL}
uniform float uSeaTime;varying vec2 vSeaP;varying float vFoam;`;
export const FOAM_VERTEX_VARYINGS='attribute float aFoam;varying vec2 vSeaP;varying float vFoam;';
export const FOAM_VERTEX_BODY='vSeaP=position.xz;vFoam=aFoam;';
export const FOAM_APPLY=`{float t=uSeaTime;float n=texture2D(detailMap,vSeaP/8.+vec2(.02,.013)*t).g*.6+texture2D(detailMap,vSeaP/6.4+vec2(-.015,.02)*t+.3).r*.4;
  float swash=.18*sin(t*.8+vSeaP.x*.07+vSeaP.y*.05);float edge=vFoam-.42+swash+.5*(n-.5);if(edge<0.||uWorldDetail<.5)discard;
  diffuseColor.rgb=mix(vec3(.78,.88,.9),vec3(.97,.99,.99),smoothstep(0.,.35,edge));}`;

/** Wire a MeshBasicMaterial to one of the snippets above. `uniforms` are shared objects. */
export function patchMaterial(material,{key,vertexVaryings,vertexBody,fragmentGlsl,apply,uniforms={}}){
  material.customProgramCacheKey=()=>key;
  material.onBeforeCompile=shader=>{
    shader.uniforms.detailMap={value:detailNoise()};shader.uniforms.uWorldDetail=worldDetailEnabled;for(const [k,v] of Object.entries(uniforms))shader.uniforms[k]=v;
    shader.vertexShader=shader.vertexShader.replace('#include <common>',`#include <common>\n${vertexVaryings}`).replace('#include <begin_vertex>',`#include <begin_vertex>\n${vertexBody}`);
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>\n${fragmentGlsl}`).replace('#include <color_fragment>',`#include <color_fragment>\n${apply}`);
  };
  return material;
}
