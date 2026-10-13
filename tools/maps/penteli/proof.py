#!/usr/bin/env python3
"""Render geographic/elevation proof. Requires numpy, matplotlib, Pillow (not game deps)."""
import json, pathlib, numpy as np, matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from PIL import Image, ImageDraw, ImageFont
ROOT=pathlib.Path(__file__).resolve().parents[3];D=ROOT/'.scratch/penteli';D.mkdir(parents=True,exist_ok=True)
r=json.loads((ROOT/'tools/maps/penteli/raw/route.json').read_text());p=json.loads((ROOT/'tools/maps/penteli/raw/profile.json').read_text());stations=json.loads((D/'stations.json').read_text());proj=r['proj']
s=np.arange(len(p['raw']))*p['step'];mask=(s>=p['start'])&(s<=p['finish']);km=(s-p['start'])/1000
plt.rcParams.update({'font.family':'DejaVu Sans','font.size':11,'axes.spines.top':False,'axes.spines.right':False})
fig,axs=plt.subplots(2,1,figsize=(13,7),sharex=True,gridspec_kw={'height_ratios':[3,1]},layout='constrained')
axs[0].plot(km[mask],np.array(p['raw'])[mask],color='#8d969d',lw=1,label='EU-DEM v1.1 · direct samples every24m (25m source)')
axs[0].plot(km[mask],np.array(p['smoothed'])[mask],color='#007fa5',lw=2.2,label='Drivable profile · Gaussian σ120m · no grade cap')
axs[0].axvline((r['fork']-r['start'])/1000,color='#cb672c',ls='--');axs[0].text((r['fork']-r['start'])/1000+.1,470,'Agios Petros fork\nRight toward Penteli',color='#a14e20')
axs[0].set(ylabel='Elevation above sea level (m)',title='Dionysos → Agios Petros → Karakanta | actual DEM compared with game road')
axs[0].legend(loc='upper left',fontsize=9);axs[0].grid(alpha=.2)
y=np.array(p['smoothed']);g=np.gradient(y,2)*100
axs[1].plot(km[mask],g[mask],color='#007fa5');axs[1].axhline(0,color='#555',lw=.7);axs[1].set(ylabel='Grade (%)',xlabel='Race distance (km)',xlim=(0,(r['finish']-r['start'])/1000));axs[1].grid(alpha=.2)
st=p['stats'];fig.text(.58,.52,f"{st['startElevation']:.0f} → {st['finishElevation']:.0f} m | +{st['ascent']:.0f} / −{st['descent']:.0f} m\nRaw cliff/road-cut spikes remain visible in grey.",fontsize=10,bbox={'facecolor':'white','alpha':.85,'edgecolor':'none'})
fig.savefig(D/'elevation-profile.png',dpi=150);plt.close(fig)
# Esri export was made in geographic EPSG4326; preserve its native extent exactly.
im=Image.open(D/'satellite.jpg');fig,ax=plt.subplots(figsize=(12,9),layout='constrained');fig.set_layout_engine('constrained',rect=(0,.03,1,.97));ax.imshow(im,extent=[23.886,23.941,38.06,38.10],aspect='auto')
lon=proj['lon0']+np.array(r['x'])/proj['mlon'];lat=proj['lat0']-np.array(r['z'])/proj['mlat'];ax.plot(lon,lat,color='black',lw=4);ax.plot(lon,lat,color='#ffe76a',lw=2)
for q in stations:ax.scatter(q['lon'],q['lat'],s=60,c='#fff',edgecolor='#152b35');ax.annotate(q['id'],(q['lon'],q['lat']),xytext=(7,5),textcoords='offset points',color='white',weight='bold')
ax.set(xlabel='Longitude° E',ylabel='Latitude° N',title='Penteli route on Esri World Imagery · 8 matching camera stations',xlim=(23.886,23.941),ylim=(38.06,38.10));fig.text(.5,.008,'© Esri, Maxar, Earthstar Geographics and GIS User Community · imagery capture date unknown · OSM route © contributors',ha='center',fontsize=8);fig.savefig(D/'satellite-overlay.png',dpi=150);plt.close(fig)
# Assemble only actual source imagery, never mock a missing street view.
for q in stations:
 a,b=D/f"street-{q['id']}.png",D/f"game-{q['id']}.png"
 if not a.exists() or not b.exists():continue
 meta=D/f"street-{q['id']}.json"
 if meta.exists() and 'No Street View imagery' in json.loads(meta.read_text()).get('text',''):continue
 left=Image.open(a).convert('RGB');right=Image.open(b).convert('RGB');w,h=960,600
 left=left.resize((w,h));right=right.resize((w,h));canvas=Image.new('RGB',(w*2,h+70),'#10242e');canvas.paste(left,(0,70));canvas.paste(right,(w,70));d=ImageDraw.Draw(canvas);font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',18)
 d.text((18,12),f"{q['id']}  GOOGLE STREET VIEW",font=font,fill='white');d.text((w+18,12),'PARALIAKI · ACTUAL IN-GAME RENDER',font=font,fill='white');d.text((18,40),f"{q['lat']:.6f}°N {q['lon']:.6f}°E · heading {q['heading']:.0f}° · station {q['s']}m",font=font,fill='#adceda');canvas.save(D/f"comparison-{q['id']}.png")
print('Wrote satellite overlay, elevation profile and available paired imagery')
