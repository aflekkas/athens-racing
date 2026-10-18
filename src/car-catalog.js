import {badgeBrand} from './manufacturers.js';
import {carPerformanceIndex} from './car-performance.js';
// Garage entries describe a generation/body style. Trim IDs remain the wire/physics IDs,
// so old saves, event links, traffic and remote players retain their exact drivetrain.
export const CAR_MODELS = [
 {id:'sl65',name:'MERCEDES-BENZ SL R231',trims:["sl400","sl500","sl63","sl65"]},
 {id:'a160',name:'MERCEDES-BENZ A-CLASS W168',trims:["a160","a190"]},
 {id:'p928',name:'PORSCHE 928 S4 / GT / GTS',trims:["p928_s4","p928_gt","p928"]},
 {id:'f348',name:'FERRARI 348',trims:["f348_ts","f348","f348_spider"],bodies:[['berlinetta','BERLINETTA',['f348']],['targa','TARGA',['f348_ts']],['spider','SPIDER',['f348_spider']]]},
  {"id": "aygo", "name": "TOYOTA AYGO II", "trims": ["aygo"]},
  {"id": "qashqai", "name": "NISSAN QASHQAI J11", "trims": ["qashqai_dci","qashqai"]},
  {"id": "dolphin", "name": "BYD DOLPHIN", "trims": ["dolphin"]},
  {"id": "atto3", "name": "BYD ATTO 3", "trims": ["atto3"]},
  {"id": "van", "name": "FIAT DUCATO L2H2", "trims": ["van","van_150"]},
  {"id": "truck", "name": "ISUZU NPR", "trims": ["truck"]},
  {"id": "bus", "name": "MERCEDES-BENZ CITARO O530", "trims": ["bus"]},
  {"id": "police_octavia", "name": "ŠKODA OCTAVIA · ΕΛ.ΑΣ.", "trims": ["police_octavia"]},
  { id:'panda', name:'FIAT PANDA 169', trims:["panda_11","panda","panda_100hp"] },
  { id:'jazz', name:'HONDA JAZZ GK', trims:["jazz","jazz_dynamic","jazz_drift"] },
  { id:'yaris', name:'TOYOTA YARIS XP10', trims:["yaris","yaris_13","yaris_ts"] },
  { id:'ibiza', name:'SEAT IBIZA 6K', trims:["ibiza","ibiza_cupra"] },
  { id:'golf', name:'VOLKSWAGEN GOLF VII', trims:["golf","golf_gtd","golf_gti","golf_r"] },
  { id:'mini', name:'MINI F56 / F57', trims:["mini_cabrio_cooper","mini_cooper","mini","mini_s","mini_cabrio_jcw","mini_jcw"], bodies:[['hardtop','HARDTOP',['mini_cooper','mini_s','mini_jcw']],['convertible','CONVERTIBLE',['mini_cabrio_cooper','mini','mini_cabrio_jcw']]] },
  { id:'gr_yaris', name:'TOYOTA GR YARIS GXPA16', trims:["gr_yaris"] },
  { id:'gla', name:'MERCEDES-BENZ GLA H247', trims:["gla","gla250","gla45"] },
  { id:'corolla', name:'TOYOTA COROLLA E210 SALOON', trims:["corolla_15","corolla"] },
  { id:'taxi', name:'ŠKODA OCTAVIA III 5E', trims:["octavia_16tdi","taxi","octavia_rs"] },
  { id:'superb', name:'ŠKODA SUPERB III', trims:["superb_15","superb","superb_4x4"] },
  { id:'cla', name:'MERCEDES-BENZ CLA C118', trims:["cla","cla250","cla35","cla45s"] },
  { id:'cle', name:'MERCEDES-BENZ CLE C236', trims:["cle200","cle","cle300e","cle450","cle53"] },
  { id:'z4', name:'BMW Z4 G29', trims:["z4_20i","z4_30i","z4"] },
  { id:'carrera', name:'PORSCHE 911 991.1', trims:["carrera","carrera_s","carrera_gts"] },
  { id:'aventador_svj', name:'LAMBORGHINI AVENTADOR', trims:["aventador_svj"] },
  { id:'huracan', name:'LAMBORGHINI HURACÁN EVO', trims:["huracan_rwd","huracan"] },
  { id:'gtv', name:'ALFA ROMEO 105 GTV', trims:["gtv1750","gtv"] },
  { id:'e36', name:'BMW 3 SERIES E36', trims:["e36_318i","e36","e36_m3"] },
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
const MODELS = new Map(CAR_MODELS.flatMap(m=>m.trims.map(id=>[id,m])));
const CLASS_OF = new Map(GARAGE_CLASSES.flatMap(([id,,cars])=>cars.map(car=>[car,id])));
export const carModel = c => MODELS.get(c?.id ?? c);
export const inGarage = c => MODELS.has(c?.id ?? c);
export const classLabel = id => GARAGE_CLASSES.find(([k])=>k===id)?.[1] || String(id).toUpperCase();
export function carCategory(c) { return CLASS_OF.get(carModel(c)?.id) || (c?.police ? 'police' : 'sedan/coupe'); }
// Used only after performance ties: the represented factory hierarchy wins over spelling.
const HIERARCHY=new Map([
 ['cle200','cle220d','cle','cle300e','cle450','cle53'],['golf','golf_gtd','golf_gti','golf_r'],
 ['sl400','sl500','sl63','sl65'],['jazz','jazz_dynamic','jazz_drift'],['p928_s4','p928_gt','p928'],
 ['f348','f348_ts','f348_spider'],['mini_cooper','mini_cabrio_cooper','mini_s','mini','mini_jcw','mini_cabrio_jcw'],
].flatMap(ids=>ids.map((id,i)=>[id,i])));
/** One presentation order: keep generations together, then fantasy last, kW, PI and factory hierarchy. Never mutates CARS. */
export function sortTrims(cars) {
 const generation=c=>GARAGE_CARS.indexOf(carModel(c)?.id), tier=c=>HIERARCHY.get(c.id)??carModel(c)?.trims.indexOf(c.id)??0;
 return [...cars].sort((a,b)=>generation(a)-generation(b)||Number(!!a.fantasy)-Number(!!b.fantasy)||
  (a.power||0)-(b.power||0)||carPerformanceIndex(a)-carPerformanceIndex(b)||tier(a)-tier(b)||a.id.localeCompare(b.id));
}
export function baseTrim(model) { return model?.bodies?.[0]?.[2]?.[0]||model?.trims[0]; }
// Reading a preference must not create a save or replace an explicit live trim choice.
export function readCarSelection(storage) {
 try{
  const legacy=storage.getItem('paraliaki.car'),packed=storage.getItem('paraliaki.car.selection');
  if(!legacy&&!packed)return null;
  let saved;try{saved=JSON.parse(packed||'null');}catch{}
  return migrateCarSelection(legacy||saved);
 }catch{return null;}
}
// Idempotent migration, including the original string-only selection format.
export function migrateCarSelection(saved) {
  const trim = typeof saved === 'string' ? saved : saved?.trim;
  const model = carModel(trim) || CAR_MODELS.find(m=>m.id===saved?.entry) || carModel('mini');
  const selected=model.trims.includes(trim) ? trim : model.trims.includes(model.id) ? model.id : model.trims[0];
  const body=model.bodies?.find(([, ,ids])=>ids.includes(selected))?.[0];
  return { entry:model.id, trim:selected, ...(body?{body}:{}) };
}
// Persist the normalized trim too, so boot, garage and online joins agree.
export function migrateStoredCarSelection(storage) {
  const selection=readCarSelection(storage);if(!selection)return null;
  for(const [key,value]of [['paraliaki.car',selection.trim],['paraliaki.car.selection',JSON.stringify(selection)]]){
    try{storage.setItem(key,value);}catch{} // Private browsing can allow reads but deny writes.
  }
  return selection;
}
export function filterCars(cars, filters = {}, selection = null) {
  const q=String(filters.search||'').trim().toLocaleLowerCase(), list=[];
  for(const id of GARAGE_CARS){
    const model=carModel(id), members=sortTrims(cars.filter(c=>model.trims.includes(c.id))).map(car=>({car,index:cars.indexOf(car)}));
    const match=members.filter(({car:c})=>(!q || `${model.name} ${c.name} ${c.short} ${c.tag}`.toLocaleLowerCase().includes(q)) &&
      (!filters.brand || filters.brand==='all' || badgeBrand(c)===filters.brand) &&
      (!filters.category || filters.category==='all' || carCategory(c)===filters.category) &&
      (!filters.drive || filters.drive==='all' || c.drive.toUpperCase()===filters.drive) &&
      (!filters.power || filters.power==='all' || (filters.power==='low'?c.power*1.341<150:filters.power==='mid'?c.power*1.341>=150&&c.power*1.341<=300:c.power*1.341>300)));
    const preferred=carModel(selection?.trim)===model?selection.trim:baseTrim(model);
    if(match.length)list.push(match.find(x=>x.car.id===preferred)||match[0]);
  }
  return list.sort((a,b)=>CAR_CLASSES.indexOf(carCategory(a.car))-CAR_CLASSES.indexOf(carCategory(b.car)) ||
    (filters.sort==='power'?b.car.power-a.car.power:filters.sort==='weight'?a.car.mass-b.car.mass:GARAGE_CARS.indexOf(carModel(a.car).id)-GARAGE_CARS.indexOf(carModel(b.car).id)));
}

// Switch body at the same engine level. Host/event rules may remove combinations.
export function bodyTrim(model, current, body, allowed) {
  const from=model?.bodies?.find(([, ,ids])=>ids.includes(current));
  const to=model?.bodies?.find(([id])=>id===body);
  if(!from || !to)return null;
  const wanted=to[2][from[2].indexOf(current)];
  return (!allowed || allowed.includes(wanted)) ? wanted : to[2].find(id=>!allowed || allowed.includes(id)) || null;
}

export function trimChoices(current, {allowedCars, def, cars} = {}) {
  const model=carModel(current), body=model?.bodies?.find(([, ,ids])=>ids.includes(current));
  const ids=body?.[2] || model?.trims || [], ordered=cars?sortTrims(cars.filter(c=>ids.includes(c.id))).map(c=>c.id):ids;
  return ordered.filter(id=>(!allowedCars || allowedCars.includes(id)) && (!def?.car || def.car===id));
}
export function stepTrim(current, direction, rules) {
  const ids=trimChoices(current,rules);if(!ids.length)return null;
  return ids[(Math.max(0,ids.indexOf(current))+direction+ids.length)%ids.length];
}

// Fleet and fantasy builds remain available to players, never the fallback AI race pool.
export const isRivalCar = car => !car.nonRacing && !car.police && !car.fantasy;
