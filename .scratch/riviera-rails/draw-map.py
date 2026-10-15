from PIL import Image,ImageDraw
import json
p='.scratch/riviera-rails/';d=json.load(open(p+'placement.json'));im=Image.new('RGB',(1280,900),'#14212b');g=ImageDraw.Draw(im)
g.text((35,25),'ATHENS RACING / RIVIERA GUARDRAIL PLACEMENT',fill='white',font_size=24)
g.text((35,60),'Orange: steel   Cyan: route   Dots: capture stations. Existing concrete: s2411-2681.',fill='#cad4df',font_size=17)
pts=d['route'];xs=[q[0]for q in pts];zs=[q[1]for q in pts];x0,x1=min(xs),max(xs);z0,z1=min(zs),max(zs);scale=min(1180/(x1-x0),700/(z1-z0))
f=lambda x,z:(50+(x-x0)*scale,110+(z-z0)*scale)
g.line([f(*p)for p in pts],fill='#438ba8',width=3)
for run in d['runs']:g.line([f(q['x'],q['z'])for q in run['pts']],fill='#ffae4d',width=5)
for s in [2860,3920,8200]:
 q=min((q for r in d['runs']for q in r['pts']),key=lambda q:abs(q['s']-s));x,z=f(q['x'],q['z']);g.ellipse((x-7,z-7,x+7,z+7),outline='white',width=2);g.text((x+12,z),'s='+str(s),fill='white',font_size=18)
g.text((35,850),'15 runs / 2602 metres / 18 beam chunks / 613 instanced posts',fill='white',font_size=20);im.save(p+'placement-map.png')
