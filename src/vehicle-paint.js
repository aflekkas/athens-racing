// Screen approximations of period factory finishes; references live in tools/vehicle-model-notes.md.
// Taxicab yellow is an additional fleet finish; GR Yaris grey includes the 2024 Ogier special edition.
export const PAINTS = {
  panda: [["Light Blue","#92b5c8"],["Bossa Nova White","#e4e2d3"],["New Orleans Blue","#355c89"],["Pasodoble Red","#b73836"],["Vanilla Yellow","#ddd29c"],["Chemical Grey","#939995"]],
  ibiza: [["Faded Tornado Red","#8d4948"],["Chalky Alpine White","#cac8b9"],["Weathered Jade Green","#668172"],["Faded Flash Yellow","#c1b16d"],["Oxidised Blue","#647b92"],["Dull Silver","#9c9f9a"]],
  gla: [['Iridium Silver','#b5bdc3'],['Night Black','#14171b'],['Polar White','#ededeb'],['Mountain Grey','#646a70'],['Denim Blue','#36536d'],['Patagonia Red','#98253b']],
  cle: [['High-tech Silver','#929b9f'],['Obsidian Black','#111419'],['Polar White','#ebece7'],['Graphite Grey','#535a60'],['Spectral Blue','#24486f'],['Patagonia Red','#8e172b']],
  huracan: [['Arancio Xanto','#ea701d'],['Verde Mantis','#68b42c'],['Giallo Inti','#e3ba23'],['Bianco Icarus','#ededdf'],['Nero Helene','#191c20'],['Blu Nethuns','#2066a1']],
  mini_jcw: [['British Racing Green','#22513d'],['Chili Red','#b51c28'],['Pepper White','#eee9d8'],['Midnight Black','#191c22'],['Rebel Green','#243a32'],['Moonwalk Grey','#797e83']],
  mini: [['Blazing Red','#bd1626'],['Pepper White','#eee9d8'],['Midnight Black','#17191d'],['British Racing Green','#164d38'],['Caribbean Aqua','#329995'],['Melting Silver','#a7a6a1'],['Deep Blue','#244774'],['Volcanic Orange','#e88b13']],
  z4: [['Misano Blue','#22679d'],['Alpine White','#efefea'],['Black Sapphire','#191c23'],['Glacier Silver','#b9bfc5'],['San Francisco Red','#a52327'],['Frozen Grey II','#777e83']],
  taxi: [['Athens Taxi Yellow','#eebd19'],['Candy White','#eaece7'],['Brilliant Silver','#b6bec4'],['Race Blue','#245b9d'],['Lava Blue','#245463'],['Velvet Red','#9d1928'],['Quartz Grey','#606566'],['Black Magic','#191b21']],
  carrera: [['GT Silver','#c6c9cb'],['Guards Red','#c02624'],['Racing Yellow','#eccf24'],['Carrara White','#edede6'],['Basalt Black','#202328'],['Aqua Blue','#276490'],['Agate Grey','#64655f'],['Lime Gold','#aaa875']],
  gr_yaris: [['Super White','#e7e8e3'],['Platinum White Pearl','#eeeee5'],['Precious Black','#191b21'],['Emotional Red','#b61b28'],['Precious Metal','#777e86'],['Matt Stealth Grey · Ogier','#555c63']],
  gtv: [['Rosso Alfa','#b52125'],['Bianco Spino','#e8e4d8'],['Giallo Ocra','#c89431'],['Verde Pino','#264c38'],['Blu Olandese','#192e46'],['Prugna','#5a293f'],['Grigio Indaco','#737780'],['Azzurro Le Mans','#548da5']],
  golf: [['Limestone Grey','#526a83'],['Pure White','#ededeb'],['Tornado Red','#b92827'],['Deep Black','#15191d'],['Reflex Silver','#bac0c3'],['Pacific Blue','#254e7c']],
  corolla: [['Silver Metallic','#d2d5d3'],['Pure White','#ecece7'],['Eclipse Black','#191c22'],['Scarlet Flare','#a71f2c'],['Deep Blue','#234f77'],['Manhattan Grey','#656b70']],
  superb: [['Lava Blue','#25475b'],['Moon White','#e8ebe5'],['Brilliant Silver','#bdc3c5'],['Black Magic','#1b1d23'],['Velvet Red','#982434'],['Business Grey','#6f7271']],
  police_octavia: [['Police White','#eceee9'],['Fleet Silver','#b9c1c8'],['Graphite Grey','#656c73'],['Navy Blue','#243d63'],['Black Magic','#181c24'],['Candy White','#f4f3ed']],
};
export function validPaint(color) { return typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color); }
export function savedPaint(spec) {
  try { const c=localStorage.getItem('paraliaki.paint.'+spec.id);if(validPaint(c))return c.toLowerCase(); } catch {}
  return spec.color;
}
export function savePaint(id,color) {
  if(!validPaint(color))return false;
  try { localStorage.setItem('paraliaki.paint.'+id,color.toLowerCase()); } catch { /* Live painting still works when storage is unavailable. */ }
  return true;
}
// Changes this instance only. The catalogue, glass, tyres, lights and other cars keep their own materials.
export function setPaint(model,color) {
  if(!model?.paint||!validPaint(color))return false;
  model.paint.color.set(color);model.paintColor=color.toLowerCase();
  for(const m of model.paintAccents||[])m.color.set(color);
  const name=PAINTS[model.spec?.id]?.find(p=>p[1]===model.paintColor)?.[0]||'';
  const matte=/^(Frozen|Matt |Faded|Chalky|Weathered|Oxidised|Dull)/.test(name);
  model.paint.roughness=matte?.62:.26;
  if('clearcoat' in model.paint)model.paint.clearcoat=matte?.05:1;
  return true;
}
