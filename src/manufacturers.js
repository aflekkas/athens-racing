// Shared manufacturer identity and atlas cells for cockpit badges and the UI. No renderer dependency.
export const BRAND_BADGES = {
  ferrari:{enabled:true,cell:17},
  alfaromeo: { enabled:true, cell:0 },
  bmw: { enabled:true, cell:1 },
  fiat: { enabled:true, cell:2 },
  honda: { enabled:true, cell:3 },
  lamborghini: { enabled:true, cell:4 },
  mazda: { enabled:true, cell:5 },
  mercedes: { enabled:true, cell:6 },
  mini: { enabled:true, cell:7 },
  porsche: { enabled:true, cell:8 },
  seat: { enabled:true, cell:9 },
  skoda: { enabled:true, cell:10 },
  toyota: { enabled:true, cell:11 },
  volkswagen: { enabled:true, cell:12 },
  nissan: { enabled:true, cell:13 },
  byd: { enabled:true, cell:14 },
  isuzu: { enabled:true, cell:16 },
};
const BRANDS={panda:'fiat',jazz:'honda',yaris:'toyota',gr_yaris:'toyota',corolla:'toyota',ibiza:'seat',golf:'volkswagen',mini:'mini',mini_hardtop:'mini',mini_jcw:'mini',z4:'bmw',e36:'bmw',carrera:'porsche',aventador:'lamborghini',huracan:'lamborghini',gtv:'alfaromeo',octavia:'skoda',taxi:'skoda',superb:'skoda',police_octavia:'skoda',gla:'mercedes',gla45:'mercedes',cla:'mercedes',cle:'mercedes',mx5:'mazda',aygo:'toyota',qashqai:'nissan',qashqai_dci:'nissan',dolphin:'byd',atto3:'byd',van:'fiat',van_150:'fiat',truck:'isuzu',bus:'mercedes',delivery:'honda',police_moto:'bmw'};
export function badgeBrand(spec){return spec.marque||BRANDS[spec.body]||BRANDS[spec.id];}

export const MANUFACTURER_NAMES = { alfaromeo:'ALFA ROMEO', bmw:'BMW', byd:'BYD', ferrari:'FERRARI', fiat:'FIAT', honda:'HONDA', isuzu:'ISUZU', lamborghini:'LAMBORGHINI', mazda:'MAZDA', mercedes:'MERCEDES-BENZ', mini:'MINI', nissan:'NISSAN', porsche:'PORSCHE', seat:'SEAT', skoda:'ŠKODA', toyota:'TOYOTA', volkswagen:'VOLKSWAGEN' };
export const manufacturerOptions = cars => [...new Set(cars.map(badgeBrand).filter(Boolean))].sort((a,b)=>MANUFACTURER_NAMES[a].localeCompare(MANUFACTURER_NAMES[b])).map(id=>[id,MANUFACTURER_NAMES[id]]);
