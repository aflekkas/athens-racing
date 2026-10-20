import {badgeBrand} from './manufacturers.js';
import {LEGACY_CAR_IDS, DEFAULT_CAR_ID, canonicalCarId, isLegacyCarId} from './car-ids.js';
export {LEGACY_CAR_IDS, DEFAULT_CAR_ID, canonicalCarId, isLegacyCarId};
// Owner decision 2026-10-20 (docs/OWNER-DECISIONS.md): one garage entry per model, and it is the top trim. `car` is the kept car's
// id, which stays the wire/physics id. The ids of the removed trims live in LEGACY_CAR_IDS and map to it.
export const CAR_MODELS = [
 {id:'sl65',name:'MERCEDES-BENZ SL R231',car:'sl65'},
 {id:'a160',name:'MERCEDES-BENZ A-CLASS W168',car:'a190'},
 {id:'p928',name:'PORSCHE 928 S4 / GT / GTS',car:'p928'},
 {id:'f348',name:'FERRARI 348',car:'f348_spider'},
 {id:'aygo',name:'TOYOTA AYGO II',car:'aygo'},
 {id:'qashqai',name:'NISSAN QASHQAI J11',car:'qashqai'},
 {id:'dolphin',name:'BYD DOLPHIN',car:'dolphin'},
 {id:'atto3',name:'BYD ATTO 3',car:'atto3'},
 {id:'van',name:'FIAT DUCATO L2H2',car:'van_150'},
 {id:'truck',name:'ISUZU NPR',car:'truck'},
 {id:'bus',name:'MERCEDES-BENZ CITARO O530',car:'bus'},
 {id:'police_octavia',name:'ŠKODA OCTAVIA · ΕΛ.ΑΣ.',car:'police_octavia'},
 {id:'panda',name:'FIAT PANDA 169',car:'panda_100hp'},
 {id:'jazz',name:'HONDA JAZZ GK',car:'jazz_dynamic'},
 {id:'yaris',name:'TOYOTA YARIS XP10',car:'yaris_ts'},
 {id:'ibiza',name:'SEAT IBIZA 6K',car:'ibiza_cupra'},
 {id:'golf',name:'VOLKSWAGEN GOLF VII',car:'golf_r'},
 {id:'mini',name:'MINI F56 / F57',car:'mini_jcw'},
 {id:'gr_yaris',name:'TOYOTA GR YARIS GXPA16',car:'gr_yaris'},
 {id:'gla',name:'MERCEDES-BENZ GLA H247',car:'gla45'},
 {id:'corolla',name:'TOYOTA COROLLA E210 SALOON',car:'corolla'},
 {id:'taxi',name:'ŠKODA OCTAVIA III 5E',car:'octavia_rs'},
 {id:'superb',name:'ŠKODA SUPERB III',car:'superb_4x4'},
 {id:'cla',name:'MERCEDES-BENZ CLA C118',car:'cla45s'},
 {id:'cle',name:'MERCEDES-BENZ CLE C236',car:'cle53'},
 {id:'z4',name:'BMW Z4 G29',car:'z4'},
 {id:'carrera',name:'PORSCHE 911 991.1',car:'carrera_gts'},
 {id:'aventador_svj',name:'LAMBORGHINI AVENTADOR',car:'aventador_svj'},
 {id:'huracan',name:'LAMBORGHINI HURACÁN EVO',car:'huracan'},
 {id:'gtv',name:'ALFA ROMEO 105 GTV',car:'gtv'},
 {id:'e36',name:'BMW 3 SERIES E36',car:'e36_m3'},
];
export const GARAGE_CLASSES = [
  ['city','CITY',['a160','panda','jazz','yaris','ibiza','golf','aygo']],
  ['hot hatch','HOT HATCH',['mini','gr_yaris']],
  ['sedan/coupe','SEDAN / COUPE',['corolla','taxi','superb','cla','cle']],
  ['suv','SUV',['gla','qashqai']],
  ['sports','SPORTS',['sl65','z4','carrera']],
  ['super','SUPER',['huracan','aventador_svj']],
  ['classic','CLASSIC',['f348','p928','gtv','e36']],
  ['electric','ELECTRIC',['dolphin','atto3']],
  ['commercial','COMMERCIAL / UTILITY',['van','truck']],
  ['public transport','PUBLIC TRANSPORT',['bus']],
  ['service','PUBLIC SERVICES',['police_octavia']],
];
export const CAR_CLASSES = GARAGE_CLASSES.map(([id])=>id);
export const GARAGE_CARS = GARAGE_CLASSES.flatMap(([, ,ids])=>ids);
// A kept id and every id that maps to it find the same model.
const MODELS = new Map(CAR_MODELS.flatMap(m=>[[m.car,m],...Object.entries(LEGACY_CAR_IDS).filter(([,kept])=>kept===m.car).map(([id])=>[id,m])]));
const CLASS_OF = new Map(GARAGE_CLASSES.flatMap(([id,,cars])=>cars.map(car=>[car,id])));
export const carModel = c => MODELS.get(c?.id ?? c);
export const inGarage = c => CAR_MODELS.some(m=>m.car===(c?.id ?? c));
export const classLabel = id => GARAGE_CLASSES.find(([k])=>k===id)?.[1] || String(id).toUpperCase();
export function carCategory(c) { return CLASS_OF.get(carModel(c)?.id) || (c?.police ? 'police' : 'sedan/coupe'); }
/** One presentation order: the garage lineup, then anything else by id. Never mutates the list. */
export function sortCars(cars) {
 const place=c=>{const i=GARAGE_CARS.indexOf(carModel(c)?.id);return i<0?GARAGE_CARS.length:i;};
 return [...cars].sort((a,b)=>place(a)-place(b)||a.id.localeCompare(b.id));
}
/** The saved garage choice as one kept car id (a removed trim maps to its model's top trim); null when nothing is saved.
 *  Reading a preference must not create a save. Understands the original string format and the 2026-10 `{entry,trim}` JSON. */
export function readCarSelection(storage) {
 try{
  const legacy=storage.getItem('paraliaki.car'),packed=storage.getItem('paraliaki.car.selection');
  if(!legacy&&!packed)return null;
  let saved;try{saved=JSON.parse(packed||'null');}catch{}
  return migrateCarSelection(legacy||saved);
 }catch{return null;}
}
/** Idempotent: any saved value (an id, or the old `{entry,trim}` object) becomes a kept car id; unknown values fall back to the default car. */
export function migrateCarSelection(saved) {
  const id=canonicalCarId(typeof saved==='string'?saved:saved?.trim);
  if(inGarage(id))return id;
  const entry=CAR_MODELS.find(m=>m.id===saved?.entry);
  return entry?.car||DEFAULT_CAR_ID;
}
// Persist the normalized car, so boot, garage and online joins agree. The old packed `{entry,trim,body}` key is dropped, and a
// paint chosen on a removed trim carries over to the kept car unless that car already has its own.
export function migrateStoredCarSelection(storage) {
  const car=readCarSelection(storage);
  let chosen;try{chosen=storage.getItem('paraliaki.car');}catch{}
  if(car){
    try{storage.setItem('paraliaki.car',car);}catch{} // Private browsing can allow reads but deny writes.
    try{storage.removeItem?.('paraliaki.car.selection');}catch{}
  }
  try{
    // The paint of the removed trim the player had selected wins over the paints of its siblings; the fastest single-car time carries over.
    for(const id of new Set([chosen,...Object.keys(LEGACY_CAR_IDS)])){
      if(!isLegacyCarId(id))continue;
      const kept=LEGACY_CAR_IDS[id],paint=storage.getItem('paraliaki.paint.'+id);
      if(paint&&!storage.getItem('paraliaki.paint.'+kept))storage.setItem('paraliaki.paint.'+kept,paint);
      const best=+storage.getItem('paraliaki.best.'+id)||0,have=+storage.getItem('paraliaki.best.'+kept)||0;
      if(best&&(!have||best<have))storage.setItem('paraliaki.best.'+kept,String(best));
    }
  }catch{}
  return car;
}
/** Garage list: one {car,index} per model (the kept car), filtered by search, brand, class, drive and power. */
export function filterCars(cars, filters = {}) {
  const q=String(filters.search||'').trim().toLocaleLowerCase(), list=[];
  for(const model of CAR_MODELS){
    const index=cars.findIndex(c=>c.id===model.car),c=cars[index];
    if(!c)continue;
    if((!q || `${model.name} ${c.name} ${c.short} ${c.tag}`.toLocaleLowerCase().includes(q)) &&
      (!filters.brand || filters.brand==='all' || badgeBrand(c)===filters.brand) &&
      (!filters.category || filters.category==='all' || carCategory(c)===filters.category) &&
      (!filters.drive || filters.drive==='all' || c.drive.toUpperCase()===filters.drive) &&
      (!filters.power || filters.power==='all' || (filters.power==='low'?c.power*1.341<150:filters.power==='mid'?c.power*1.341>=150&&c.power*1.341<=300:c.power*1.341>300)))list.push({car:c,index});
  }
  return list.sort((a,b)=>CAR_CLASSES.indexOf(carCategory(a.car))-CAR_CLASSES.indexOf(carCategory(b.car)) ||
    (filters.sort==='power'?b.car.power-a.car.power:filters.sort==='weight'?a.car.mass-b.car.mass:GARAGE_CARS.indexOf(carModel(a.car).id)-GARAGE_CARS.indexOf(carModel(b.car).id)));
}

// Fleet and fantasy builds remain available to players, never the fallback AI race pool.
export const isRivalCar = car => !car.nonRacing && !car.police && !car.fantasy;
