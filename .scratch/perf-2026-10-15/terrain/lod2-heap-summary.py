import json,collections,pathlib
out={}
for label in ['before','after']:
 s=json.load(open('/tmp/terrain-'+label+'.heapsnapshot'));meta=s['snapshot']['meta'];nf=meta['node_fields'];ef=meta['edge_fields'];N=len(nf);E=len(ef);n=s['nodes'];e=s['edges'];strings=s['strings'];types=meta['node_types'][0];etypes=meta['edge_types'][0];ni={k:nf.index(k) for k in nf};ei={k:ef.index(k) for k in ef};offsets={};off=0;groups=collections.Counter()
 for i in range(0,len(n),N):
  offsets[i]=off;off+=n[i+ni['edge_count']]*E;typ=types[n[i]];name=strings[n[i+ni['name']]];size=n[i+ni['self_size']]
  if typ=='native':category='native backing stores'
  elif typ=='array' and name=='(object elements)':category='JS array element storage'
  elif typ=='array':category='Map/Set and other internal tables'
  elif typ=='number':category='boxed numbers'
  elif typ=='object' and name in ['Float32Array','Uint16Array','Int8Array','Uint8Array','Float64Array','Int32Array','ArrayBuffer']:category='typed-array and buffer wrappers'
  else:category='other managed objects/code/strings'
  groups[category]+=size
 owners=[];seen=set()
 for i in range(0,len(n),N):
  if strings[n[i+ni['name']]]!='system / Context':continue
  for j in range(offsets[i],offsets[i]+n[i+ni['edge_count']]*E,E):
   if etypes[e[j]]!='context':continue
   key=strings[e[j+ei['name_or_index']]];target=e[j+ei['to_node']];name=strings[n[target+ni['name']]]
   if key not in ['heights','vertices','pos','col','nor','urb'] or name not in ['Map','Array'] or target in seen:continue
   seen.add(target);backing=0
   for k in range(offsets[target],offsets[target]+n[target+ni['edge_count']]*E,E):
    if etypes[e[k]]=='internal' and strings[e[k+ei['name_or_index']]] in ['table','elements']:backing+=n[e[k+ei['to_node']]+ni['self_size']]
   if backing>100000:owners.append({'contextBinding':key,'type':name,'backingBytes':backing})
 out[label]={'shallowRetainedBytes':dict(groups),'largeBuildContextBindings':owners}
pathlib.Path('/tmp/terrain-lod2-heap-summary.json').write_text(json.dumps(out,indent=2));print(json.dumps(out,indent=2))
