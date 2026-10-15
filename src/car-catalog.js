// Garage entries describe a generation/body style. Trim IDs remain the wire/physics IDs,
// so old saves, event links, traffic and remote players retain their exact drivetrain.
export const CAR_MODELS = [
  { id:'panda', name:'FIAT PANDA 169', trims:['panda'] },
  { id:'yaris', name:'TOYOTA YARIS XP10', trims:['yaris'] },
  { id:'ibiza', name:'SEAT IBIZA 6K', trims:['ibiza'] },
  { id:'golf', name:'VOLKSWAGEN GOLF VII', trims:['golf'] },
  { id:'mini', name:'MINI CONVERTIBLE F57', trims:['mini'] },
  { id:'mini_jcw', name:'MINI HATCH F56', trims:['mini_jcw'] },
  { id:'gr_yaris', name:'TOYOTA GR YARIS GXPA16', trims:['gr_yaris'] },
  { id:'gla', name:'MERCEDES-BENZ GLA H247', trims:['gla','gla45'] },
  { id:'corolla', name:'TOYOTA COROLLA E210 SALOON', trims:['corolla'] },
  { id:'taxi', name:'ŠKODA OCTAVIA IV TAXI', trims:['taxi'] },
  { id:'superb', name:'ŠKODA SUPERB III', trims:['superb'] },
  { id:'cla', name:'MERCEDES-BENZ CLA C178', trims:['cla'] },
  { id:'cle', name:'MERCEDES-BENZ CLE C236', trims:['cle200','cle','cle450','cle53'] },
  { id:'z4', name:'BMW Z4 G29', trims:['z4'] },
  { id:'carrera', name:'PORSCHE 911 991.1', trims:['carrera'] },
  { id:'huracan', name:'LAMBORGHINI HURACÁN EVO', trims:['huracan'] },
  { id:'gtv', name:'ALFA ROMEO 105 GTV', trims:['gtv'] },
  { id:'e36', name:'BMW 3 SERIES E36', trims:['e36','e36_m3'] },
];
export const GARAGE_CLASSES = [
  ['city','CITY',['panda','yaris','ibiza','golf']],
  ['hot hatch','HOT HATCH',['mini','mini_jcw','gr_yaris']],
  ['sedan/coupe','SEDAN / COUPE',['corolla','taxi','superb','cla','cle']],
  ['suv','SUV',['gla']],
  ['sports','SPORTS',['z4','carrera']],
  ['super','SUPER',['huracan']],
  ['classic','CLASSIC',['gtv','e36']],
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
  return { entry:model.id, trim:model.trims.includes(trim) ? trim : model.trims.includes(model.id) ? model.id : model.trims[0] };
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
