import json,sys,glob,os
d=sys.argv[1]
for f in sorted(glob.glob(d+'/*.json')):
    s=json.load(open(f))['summary']; print(os.path.basename(f)[:-5].ljust(18), 'calls',s['calls'],'main',s['callsMain'],'max',s['callsMax'],'tris',s['triangles']//1000,'k submit',s['renderSubmitMs'],'mats',s['materials'])
