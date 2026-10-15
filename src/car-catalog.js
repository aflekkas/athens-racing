// Garage entries describe a generation/body style. Trim IDs remain the wire/physics IDs,
// so old saves, event links, traffic and remote players retain their exact drivetrain.
export const CAR_MODELS = [
  {"id": "aygo", "name": "TOYOTA AYGO II", "trims": ["aygo"]},
  {"id": "qashqai", "name": "NISSAN QASHQAI J11", "trims": ["qashqai", "qashqai_dci"]},
  {"id": "dolphin", "name": "BYD DOLPHIN", "trims": ["dolphin"]},
  {"id": "atto3", "name": "BYD ATTO 3", "trims": ["atto3"]},
  {"id": "van", "name": "FIAT DUCATO L2H2", "trims": ["van", "van_150"]},
  {"id": "truck", "name": "ISUZU NPR", "trims": ["truck"]},
  {"id": "bus", "name": "MERCEDES-BENZ CITARO O530", "trims": ["bus"]},
  {"id": "delivery", "name": "HONDA SH150i DELIVERY", "trims": ["delivery"]},
  {"id": "scooter", "name": "PIAGGIO BEVERLY 300", "trims": ["scooter"]},
  {"id": "moto", "name": "YAMAHA TRACER 900", "trims": ["moto"]},
  {"id": "police_octavia", "name": "ŠKODA OCTAVIA · ΕΛ.ΑΣ.", "trims": ["police_octavia"]},
  {"id": "police_moto", "name": "BMW R 1250 RT · ΔΙ.ΑΣ.", "trims": ["police_moto"]},
  { id:'panda', name:'FIAT PANDA 169', trims:['panda','panda_11','panda_100hp'] },
  { id:'jazz', name:'HONDA JAZZ GK', trims:['jazz','jazz_dynamic','jazz_drift'] },
  { id:'yaris', name:'TOYOTA YARIS XP10', trims:['yaris','yaris_13','yaris_ts'] },
  { id:'ibiza', name:'SEAT IBIZA 6K', trims:['ibiza','ibiza_cupra'] },
  { id:'golf', name:'VOLKSWAGEN GOLF VII', trims:['golf','golf_gti','golf_gtd','golf_r'] },
  { id:'mini', name:'MINI F56 / F57', trims:['mini','mini_cooper','mini_s','mini_jcw','mini_cabrio_cooper','mini_cabrio_jcw'], bodies:[['hardtop','HARDTOP',['mini_cooper','mini_s','mini_jcw']],['convertible','CONVERTIBLE',['mini_cabrio_cooper','mini','mini_cabrio_jcw']]] },
  { id:'gr_yaris', name:'TOYOTA GR YARIS GXPA16', trims:['gr_yaris'] },
  { id:'gla', name:'MERCEDES-BENZ GLA H247', trims:['gla','gla250','gla45'] },
  { id:'corolla', name:'TOYOTA COROLLA E210 SALOON', trims:['corolla','corolla_15'] },
  { id:'taxi', name:'ŠKODA OCTAVIA III 5E', trims:['taxi','octavia_16tdi','octavia_rs'] },
  { id:'superb', name:'ŠKODA SUPERB III', trims:['superb','superb_15','superb_4x4'] },
  { id:'cla', name:'MERCEDES-BENZ CLA C118', trims:['cla','cla250','cla35','cla45s'] },
  { id:'cle', name:'MERCEDES-BENZ CLE C236', trims:['cle200','cle','cle300e','cle450','cle53'] },
  { id:'z4', name:'BMW Z4 G29', trims:['z4','z4_20i','z4_30i'] },
  { id:'carrera', name:'PORSCHE 911 991.1', trims:['carrera','carrera_s','carrera_gts'] },
  { id:'huracan', name:'LAMBORGHINI HURACÁN EVO', trims:['huracan','huracan_rwd'] },
  { id:'gtv', name:'ALFA ROMEO 105 GTV', trims:['gtv','gtv1750'] },
  { id:'e36', name:'BMW 3 SERIES E36', trims:['e36','e36_318i','e36_m3'] },
];
export const GARAGE_CLASSES = [
  ['city','CITY',['panda','jazz','yaris','ibiza','golf','aygo']],
  ['hot hatch','HOT HATCH',['mini','gr_yaris']],
  ['sedan/coupe','SEDAN / COUPE',['corolla','taxi','superb','cla','cle']],
  ['suv','SUV',['gla','qashqai']],
  ['sports','SPORTS',['z4','carrera']],
  ['super','SUPER',['huracan']],
  ['classic','CLASSIC',['gtv','e36']],
  ['electric','ELECTRIC',['dolphin','atto3']],
  ['commercial','COMMERCIAL / UTILITY',['van','truck']],
  ['public transport','PUBLIC TRANSPORT',['bus']],
  ['motorcycle','MOTORCYCLES',['delivery','scooter','moto']],
  ['service','PUBLIC SERVICES',['police_octavia','police_moto']],
];
export const CAR_CLASSES = GARAGE_CLASSES.map(([id])=>id);
export const GARAGE_CARS = GARAGE_CLASSES.flatMap(([, ,ids])=>ids);
const MODELS = new Map(CAR_MODELS.flatMap(m=>m.trims.map(id=>[id,m])));
const CLASS_OF = new Map(GARAGE_CLASSES.flatMap(([id,,cars])=>cars.map(car=>[car,id])));
export const carModel = c => MODELS.get(c?.id ?? c);
export const inGarage = c => MODELS.has(c?.id ?? c);
export const classLabel = id => GARAGE_CLASSES.find(([k])=>k===id)?.[1] || String(id).toUpperCase();
export function carCategory(c) { return CLASS_OF.get(carModel(c)?.id) || (c?.police ? 'police' : 'sedan/coupe'); }
// Idempotent migration, including the original string-only selection format.
export function migrateCarSelection(saved) {
  const trim = typeof saved === 'string' ? saved : saved?.trim;
  const model = carModel(trim) || CAR_MODELS.find(m=>m.id===saved?.entry) || carModel('mini');
  const selected=model.trims.includes(trim) ? trim : model.trims.includes(model.id) ? model.id : model.trims[0];
  const body=model.bodies?.find(([, ,ids])=>ids.includes(selected))?.[0];
  return { entry:model.id, trim:selected, ...(body?{body}:{}) };
}
export function filterCars(cars, filters = {}) {
  const q=String(filters.search||'').trim().toLocaleLowerCase(), list=[];
  for(const id of GARAGE_CARS){
    const model=carModel(id), members=model.trims.map(t=>({car:cars.find(c=>c.id===t),index:cars.findIndex(c=>c.id===t)})).filter(x=>x.car);
    const match=members.filter(({car:c})=>(!q || `${model.name} ${c.name} ${c.short} ${c.tag}`.toLocaleLowerCase().includes(q)) &&
      (!filters.category || filters.category==='all' || carCategory(c)===filters.category) &&
      (!filters.drive || filters.drive==='all' || c.drive.toUpperCase()===filters.drive) &&
      (!filters.power || filters.power==='all' || (filters.power==='low'?c.power*1.341<150:filters.power==='mid'?c.power*1.341>=150&&c.power*1.341<=300:c.power*1.341>300)));
    if(match.length)list.push(match.find(x=>x.car.id===id)||match[0]);
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

export function trimChoices(current, {allowedCars, def} = {}) {
  const model=carModel(current), body=model?.bodies?.find(([, ,ids])=>ids.includes(current));
  return (body?.[2] || model?.trims || []).filter(id=>(!allowedCars || allowedCars.includes(id)) && (!def?.car || def.car===id));
}
export function stepTrim(current, direction, rules) {
  const ids=trimChoices(current,rules);if(!ids.length)return null;
  return ids[(Math.max(0,ids.indexOf(current))+direction+ids.length)%ids.length];
}

// Fleet and fantasy builds remain available to players, never the fallback AI race pool.
export const isRivalCar = car => !car.nonRacing && !car.police && !car.fantasy;
