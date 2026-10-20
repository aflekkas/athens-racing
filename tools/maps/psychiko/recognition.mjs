// Hand-reduced observations from the 45 m lap survey. This module reads numeric/source records only;
// Google photographs are neither imported nor copied into the generated bundle.
import fs from 'node:fs';
export const LAP_SURVEY=JSON.parse(fs.readFileSync(new URL('./raw/lap-survey.json',import.meta.url)));
export const lapCharacter=s=>LAP_SURVEY.sections.find(q=>s>=q.s0&&s<q.s1);
const frontages=[
 {id:213205098,station:'lap-3150',label:'College ochre school block behind pines',h:12.5,lv:3,color:'#d6b474',facadeStyle:1,accent:'#e6ddc4'},
 // Existing OSM footprints, visual storeys/colours checked in the listed station (no brand marks).
 {id:425080433,station:'lap-0000',label:'Faros shopping block',h:14,lv:4,color:'#d3cbb9',facadeStyle:4,accent:'#d56539',commercial:true},
 {id:425080449,station:'lap-0018',label:'Faros corner shops',h:9.5,lv:3,color:'#ded9c7',facadeStyle:4,accent:'#3a627b',commercial:true},
 {id:425080469,station:'lap-0018',label:'Faros retail frontage',h:10,lv:3,color:'#e3dccc',facadeStyle:4,accent:'#cf6237',commercial:true},
 {id:345403871,station:'lap-0360',label:'A square balcony block',h:11.6,lv:3,color:'#e7dfcb',facadeStyle:1,accent:'#92754f'},
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
 for(const f of frontages){const b=data.buildings.find(b=>b.id===f.id);if(!b)throw Error('Missing frontage '+f.id);Object.assign(b,{h:f.h,lv:f.lv,color:f.color,pitched:false,facadeStyle:f.facadeStyle});
  landmarks.push({...f,kind:'frontage',x:b.p.filter((_,i)=>i%2===0).reduce((a,b)=>a+b,0)/(b.p.length/2),z:b.p.filter((_,i)=>i%2).reduce((a,b)=>a+b,0)/(b.p.length/2)});}
 // Each footprint keeps its source position. Palette/roof mix is restricted to the surveyed lap's plots.
 for(const b of data.buildings){if(frontages.some(f=>f.id===b.id))continue;const c=lapCharacter(b.s),near=Math.abs(b.u)<65;if(!c||!near||b.k==='church')continue;
  const seed=Math.abs(b.id)%100;b.color=['#eae7dc','#ecece5','#dcd8c8','#e1ded4','#e7e5d9'][seed%5];
  if(/villas|retaining|college|lane/.test(c.character)){b.facadeStyle=seed<65?1:2;if(!b.roof)b.pitched=seed>77;}
 }
 // Curved cream office across the Elikonos light. Select the actual opposite footprint, not a new block.
 const x=(23.78045-P.lon0)*P.mlon,z=-(38.01008-P.lat0)*P.mlat;
 const b=data.buildings.map(b=>({b,x:b.p.filter((_,i)=>i%2===0).reduce((a,b)=>a+b,0)/(b.p.length/2),z:b.p.filter((_,i)=>i%2).reduce((a,b)=>a+b,0)/(b.p.length/2)})).sort((a,b)=>Math.hypot(a.x-x,a.z-z)-Math.hypot(b.x-x,b.z-z))[0];
 if(b){Object.assign(b.b,{h:17,lv:5,color:'#d8cdb5',pitched:false,facadeStyle:5});landmarks.push({id:b.b.id,kind:'frontage',station:'lap-5040',label:'Elikonos cream corner office',x:b.x,z:b.z,accent:'#4a637b',commercial:true});}
 return {source:'OSM footprints/nodes plus visual lap-survey observations; dimensions approximate; no photo-derived textures',landmarks};
}
