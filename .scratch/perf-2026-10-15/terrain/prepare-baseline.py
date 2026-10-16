# Run from a repository checkout/archive. Reads the baseline from the shared git
# object database without creating another checkout or modifying its index.
from pathlib import Path
import subprocess
root=Path.cwd();repo='/home/dev/projects/paraliaki-racing';sha='8940394cbbf49e766f1467d4f9cd431df155b52a'
names=['terrain','terrain-lod','terrain-slope','terrain-surface','terrain-refinement','baked-world']
for name in names:
    source=subprocess.check_output(['git','-C',repo,'show',sha+':src/'+name+'.js']).decode()
    for dep in names: source=source.replace("'./"+dep+".js'", "'./"+dep+"-base894.js'")
    (root/('src/'+name+'-base894.js')).write_text(source)
