from pathlib import Path
import base64,json
root=Path(__file__).parent

def image(name):
 p=root/name;mime='image/webp' if p.suffix=='.webp' else 'image/png'
 return 'data:'+mime+';base64,'+base64.b64encode(p.read_bytes()).decode()
html='''<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;font:14px/1.5 var(--font-sans,system-ui);color:var(--foreground,#17202a);background:transparent}p{margin:0 0 12px}table{width:100%;border-collapse:collapse;margin:8px 0 20px}th,td{text-align:left;padding:7px 8px;border-bottom:1px solid var(--border,#ddd)}th{font-size:12px;color:var(--muted-foreground,#667)}td:nth-child(2){color:#d35b47}td:nth-child(3){color:#167f9b;font-weight:650}figure{margin:16px 0 24px}img{display:block;width:100%;height:auto;border-radius:var(--radius,8px)}figcaption{font-size:12px;color:var(--muted-foreground,#667);margin-top:6px}.plot{height:480px;object-fit:contain;background:white}@media(max-width:500px){.plot{height:300px}}.detail{font-size:12px;color:var(--muted-foreground,#667)}
</style></head><body>
<p><b>12 t Citaro · Riviera · Low graphics</b><br>Commercial tyre and axle mass, controlled roll damping, and progressive travel stops.</p>
<table><thead><tr><th>Measured result</th><th>Before</th><th>After</th></tr></thead><tbody>
<tr><td>Junction peak roll</td><td>8.63° · 43 unloaded frames</td><td>2.34° · all wheels loaded</td></tr>
<tr><td>Kerb peak roll</td><td>6.02°</td><td>3.27° · all wheels loaded</td></tr>
<tr><td>Roll amplitude after 2 s</td><td>79.51% remaining</td><td>0.42% remaining</td></tr>
</tbody></table>
<figure><img class="plot" src="DROP" alt="Before and after pitch, roll and heave during a controlled body release"><figcaption>Identical 6 cm release. The original roll mode is barely damped.</figcaption></figure>
<figure><img class="plot" src="KERB" alt="Before and after body telemetry in the same Riviera kerb scenario"><figcaption>Real game, original and corrected solvers in the same dry daylight scene.</figcaption></figure>
<figure><img src="STRIP" alt="Matched before and after chase-camera frames at one, three and six seconds"><figcaption>Matched Riviera chase frames. Raw per-wheel compression, tyre deflection, loads and contact traces are retained with the evidence.</figcaption></figure>
<p class="detail">708 fleet stability checks pass across all 70 configurations, including two five-minute cruise cases each. All 62 unchanged configurations match every original Vehicle state field across 900 frames. Evidence: .scratch/bus-suspension/.</p>
</body></html>'''
preview=html
for token,path in [('DROP','controlled-drop.png'),('KERB','riviera-matched-kerb.png'),('STRIP','bus-riviera-kerb-strip.webp')]:
 html=html.replace(token,image(path))
 preview=preview.replace(token,str(Path('/home/dev/artifacts/bus-suspension')/path))
(root/'evidence.html').write_text(html)
Path('/tmp/bus-evidence-preview.html').write_text(preview)
print('Built',root/'evidence.html',len(html),'bytes')
