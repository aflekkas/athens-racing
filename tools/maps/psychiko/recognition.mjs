// Hand-reduced observations from the 45 m lap survey. This module reads numeric/source records only;
// Google photographs are neither imported nor copied into the generated bundle.
import fs from 'node:fs';
export const LAP_SURVEY=JSON.parse(fs.readFileSync(new URL('./raw/lap-survey.json',import.meta.url)));
export const HOUSE_SURVEY=JSON.parse(fs.readFileSync(new URL('./raw/house-styles.json',import.meta.url)));
export const lapCharacter=s=>LAP_SURVEY.sections.find(q=>s>=q.s0&&s<q.s1);
const frontages=[
 {id:213205098,station:'lap-3150',label:'College ochre school block behind pines',h:12.5,lv:3,color:'#d6b474',facadeStyle:1,accent:'#e6ddc4'},
 // Existing OSM footprints, visual storeys/colours checked in the listed station (no brand marks).
 ...HOUSE_SURVEY.buildings,
 ...[
  [425080450,9.6,3,'#e6e0d2'],[425080471,7.2,2,'#dedbcf'],[425080457,12.8,4,'#dad9cf'],
  [425080459,10.1,3,'#e7e3d9'],[425080461,13.3,4,'#d9ddd8'],[425081844,16.3,5,'#d8d9d3'],
  [425081852,9.9,3,'#e9e3d4'],[425081854,7.3,2,'#dddcd2'],[424912505,12.4,4,'#dddcd1']
 ].map(([id,h,lv,color])=>({id,h,lv,color,station:'lap-0018',label:'Faros commercial continuation',facadeStyle:5,accent:'#4e6d70',commercial:true})),
 {id:329309489,station:'lap-0360',label:'A square balcony block',h:12.5,lv:4,color:'#e7dfcb',facadeStyle:1,accent:'#92754f'},
 {id:308022552,station:'lap-2138',label:'Davaki stacked brown balconies',h:11.3,lv:3,color:'#d2c3a9',facadeStyle:1,accent:'#665149'},
 {id:425320935,station:'lap-5310',label:'Kifisias glass office frontage',h:16,lv:5,color:'#81999c',facadeStyle:5,accent:'#355b6c',commercial:true},
];
export function buildRecognition(data,osm){
 const P=data.proj,project=n=>({x:+((n.lon-P.lon0)*P.mlon).toFixed(2),z:+(-(n.lat-P.lat0)*P.mlat).toFixed(2)}),nodes=new Map(osm.filter(e=>e.type==='node').map(e=>[e.id,e])),landmarks=[];
 const addNode=(id,kind,station,label,extra={})=>{const n=nodes.get(id);if(!n)throw Error('Missing landmark node '+id);landmarks.push({id,kind,station,label,...project(n),...extra});};
 addNode(4285024427,'kiosk','lap-0414','A square white periptero',{color:'#e9e7da',canopy:'#e8e4d3',yaw:.3});
 addNode(4285022967,'kiosk','lap-1035','B square green periptero',{color:'#35493d',canopy:'#c8c6ab',yaw:.4});
 addNode(3445319234,'kiosk','lap-4060','Michalakopoulou periptero',{color:'#3d5549',canopy:'#c5bd9b',yaw:1.6});
 addNode(8694632735,'schoolGate','lap-3195','Bizaniou College side gate',{yaw:1.35});
 addNode(6193531311,'schoolGate','lap-3645','Benaki College entrance',{yaw:-.6});
 for(const f of frontages){const b=data.buildings.find(b=>b.id===f.id);if(!b)throw Error('Missing frontage '+f.id);Object.assign(b,{h:f.h,lv:f.lv,color:f.color,pitched:false,facadeStyle:f.facadeStyle,storeyHeight:f.h/f.lv});
  landmarks.push({...f,kind:'frontage',x:b.p.filter((_,i)=>i%2===0).reduce((a,b)=>a+b,0)/(b.p.length/2),z:b.p.filter((_,i)=>i%2).reduce((a,b)=>a+b,0)/(b.p.length/2)});}
 // Preserve OSM footprint/setback and explicit source storeys; infer only untagged heights.
 const ways=new Map(osm.filter(e=>e.type==='way').map(e=>[e.id,e]));
 for(const b of data.buildings){
  if(frontages.some(f=>f.id===b.id)||b.k==='church')continue;
  const c=HOUSE_SURVEY.sections.find(q=>b.s>=q.s0&&b.s<q.s1);if(!c)continue;
  const seed=(Math.imul(b.id,2654435761)>>>0),r=(seed%1000)/1000;
  b.color=c.colors[(seed>>>10)%c.colors.length]; // pale town context also replaces distant orange blocks
  if(Math.abs(b.u)>100)continue;
  const tags=ways.get(b.id)?.tags||{};
  if(!tags.height&&!tags['building:levels']&&!b.rel){b.lv=c.storeys+(r<c.extraStoreyShare?1:0);b.h=+(b.lv*c.storeyHeight+.35).toFixed(2);}
  b.facadeStyle=r<.72?1:2;b.windowBay=c.windowBay;b.storeyHeight=c.storeyHeight;
  if(!tags['roof:shape'])b.pitched=((seed>>>16)%100)/100<c.tiledShare;
  if(Math.abs(b.u)<48)landmarks.push({id:b.id,kind:'frontage',station:c.stations[0],label:c.name+' surveyed house',x:b.p.filter((_,i)=>i%2===0).reduce((a,b)=>a+b,0)/(b.p.length/2),z:b.p.filter((_,i)=>i%2).reduce((a,b)=>a+b,0)/(b.p.length/2),balcony:c.balcony,bay:c.windowBay,pergola:!b.pitched&&((seed>>>22)%100)/100<c.pergolaShare,accent:r<.6?'#d6d4c8':'#a3a99c',residential:true});
 }
 // Curved cream office across the Elikonos light. Select the actual opposite footprint, not a new block.
 const x=(23.78045-P.lon0)*P.mlon,z=-(38.01008-P.lat0)*P.mlat;
 const b=data.buildings.map(b=>({b,x:b.p.filter((_,i)=>i%2===0).reduce((a,b)=>a+b,0)/(b.p.length/2),z:b.p.filter((_,i)=>i%2).reduce((a,b)=>a+b,0)/(b.p.length/2)})).sort((a,b)=>Math.hypot(a.x-x,a.z-z)-Math.hypot(b.x-x,b.z-z))[0];
 if(b){Object.assign(b.b,{h:17,lv:5,color:'#d8cdb5',pitched:false,facadeStyle:5});landmarks.push({id:b.b.id,kind:'frontage',station:'lap-5040',label:'Elikonos cream corner office',x:b.x,z:b.z,accent:'#4a637b',commercial:true});}
 return {source:'OSM footprints/nodes plus visual lap-survey observations; dimensions approximate; no photo-derived textures',landmarks};
}
