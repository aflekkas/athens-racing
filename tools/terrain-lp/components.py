"""Exact free-variable decomposition; stable full-model row/variable IDs.
Default CLI is count-only. No real solve occurs without --solve --component.
"""
from array import array
from pathlib import Path
import argparse
import hashlib
import json
import math
import os
import sys
sys.dont_write_bytecode=True
sys.path.insert(0, str(Path(__file__).resolve().parent))
from model import Problem, basis, solve


class Partition:
    def __init__(self, problem):
        self.problem=problem
        parent={i:i for i,f in enumerate(problem.free) if f}
        def find(i):
            while parent[i]!=i:
                parent[i]=parent[parent[i]];i=parent[i]
            return i
        def join(items):
            items=[i for i in items if i in parent]
            if items:
                a=find(items[0])
                for i in items[1:]:parent[find(i)]=a
        for ts in problem.ct:join(problem.index[p] for p,v in ts.items() if abs(v)>1e-14)
        for x,z in problem.squares:
            for tri in [[(x,z),(x+8,z),(x,z+8)],[(x+8,z+8),(x,z+8),(x+8,z)]]:
                join(problem.index[p] for p in tri if p in problem.index)
        for q in problem.profiles:
            join(problem.index[(x,z)] for x,z,w,_,_ in basis(q['x'],q['z']) if abs(w)>1e-14 and (x,z) in problem.index)
        groups={}
        for i in parent:groups.setdefault(find(i),[]).append(i)
        self.nodes=sorted([sorted(v) for v in groups.values()],key=lambda v:v[0])
        self.ids=[','.join(map(str,problem.coords[v[0]])) for v in self.nodes]
        self.owner={i:k for k,ids in enumerate(self.nodes) for i in ids}
        for i,u in problem.absvars:self.owner[u]=self.owner[i]
        self.rows=[array('I') for _ in self.nodes]
        self.nnz=[0]*len(self.nodes)
        self.fixed_only_infeasible=[];self.redundant=0;self.full_row_count=0
        for r,(ts,b) in enumerate(problem.rows()):
            owners={self.owner[i] for i,a in ts if abs(a)>1e-14 and i in self.owner}
            if len(owners)>1:raise ValueError('Component membership crosses a full semantic row')
            if not owners:
                gc=sum(a for i,a in ts if i==problem.g)
                if gc==0 and b<0:self.fixed_only_infeasible.append({'fullRow':r,'rhs':b})
                elif gc<=0 and b>=0:self.redundant+=1
                else:raise ValueError('Unsupported shared-gradient-only constraint')
            else:
                k=next(iter(owners));self.rows[k].append(r)
                self.nnz[k]+=sum(abs(a)>1e-14 and (i in self.owner or i==problem.g) for i,a in ts)
            self.full_row_count=r+1

    def receipt(self):
        return {'schema':'terrain-lp-partition-1','fixedOnlyInfeasible':self.fixed_only_infeasible,'fixedOnlyRedundantRows':self.redundant,'fullRows':self.full_row_count,'components':[{'id':id_,'freeNodes':len(ids),'rows':len(rows),'nonzeros':nnz,'forecastBytes':self.forecast(k)} for k,(id_,ids,rows,nnz) in enumerate(zip(self.ids,self.nodes,self.rows,self.nnz))],'buildsMatrix':False,'emittedCells':0}

    def forecast(self,k):
        # Account for source model + row maps in addition to calibrated solver state.
        return 96*1024**2 + max(128*1024**2,math.ceil(1_200_000_000*max(len(self.rows[k])/678772,self.nnz[k]/1718136)))


class ComponentProblem:
    def __init__(self, full, component_id, partition=None):
        self.full=full;self.partition=partition or Partition(full)
        if self.partition.problem is not full:raise ValueError('Partition model identity mismatch')
        if self.partition.fixed_only_infeasible:raise ValueError('Fixed-only infeasible full semantic row')
        if component_id not in self.partition.ids:raise ValueError('Unknown component ID')
        self.k=self.partition.ids.index(component_id);self.component_id=component_id
        owned=self.partition.nodes[self.k]
        self.global_variables=owned+[full.g]+[u for i,u in full.absvars if self.partition.owner[i]==self.k]
        self.local={i:j for j,i in enumerate(self.global_variables)}
        self.full_rows=self.partition.rows[self.k]
        self.bounds=[full.bounds[i] for i in self.global_variables];self.objective=[full.objective[i] for i in self.global_variables]
        self.n=len(owned);self.g=self.local[full.g];self.mode=full.mode;self.stage=full.stage;self.facets=full.facets

    def rows(self):
        selected=iter(self.full_rows);want=next(selected,None)
        for r,(ts,b) in enumerate(self.full.rows()):
            if r!=want:continue
            yield [(self.local[i],a) for i,a in ts if i in self.local and abs(a)>1e-14],b
            want=next(selected,None)
            if want is None:break
        if want is not None:raise ValueError('Full row ID remap incomplete')

    def forecast(self):
        return {'componentId':self.component_id,'nodes':self.n,'variables':len(self.bounds),'rows':len(self.full_rows),'nonzeros':self.partition.nnz[self.k],'forecastBytes':self.partition.forecast(self.k),'fullModelRows':self.partition.full_row_count,'buildsMatrix':False}

    def remap_certificate(self, certificate):
        if certificate.get('stage')!=self.stage or certificate.get('mode')!=self.mode or certificate.get('facets')!=self.facets:raise ValueError('Certificate model mismatch')
        result={**certificate,'schema':'terrain-lp-component-1','componentId':self.component_id,'globalVariables':self.global_variables,'fullRowCount':self.partition.full_row_count,'partitionVersion':1}
        if 'values' in certificate and len(certificate['values'])!=len(self.global_variables):raise ValueError('Component variable remap mismatch')
        seen=set();dual=[]
        for local,y in certificate.get('dual',[]):
            if not isinstance(local,int) or local<0 or local>=len(self.full_rows) or local in seen:raise ValueError('Component dual row remap mismatch')
            seen.add(local);dual.append([self.full_rows[local],y])
        if 'dual' in certificate:result['dual']=dual
        return result


def main():
    p=argparse.ArgumentParser();p.add_argument('input');p.add_argument('--sha256',required=True);p.add_argument('--mode',choices=['inner','outer'],default='inner');p.add_argument('--component');p.add_argument('--stage',choices=['gradient','correction'],default='gradient');p.add_argument('--prior-bundle');p.add_argument('--solve',action='store_true');p.add_argument('--seconds',type=int,default=30);p.add_argument('--memory-bytes',type=int,default=1024**3);p.add_argument('--method',choices=['highs','highs-ds','highs-ipm'],default='highs');p.add_argument('--output');a=p.parse_args()
    raw=sys.stdin.buffer.read() if a.input=='-' else Path(a.input).read_bytes();digest=hashlib.sha256(raw).hexdigest()
    if digest!=a.sha256:raise ValueError('Pinned input hash mismatch')
    cap=None
    if a.stage=='correction':
        if not a.prior_bundle: raise ValueError('Independently verified prior bundle required')
        if a.input=='-':raise ValueError('Secondary prior verification requires a pinned input file')
        import subprocess
        verifier=Path(__file__).with_name('components.mjs')
        check=subprocess.run(['node',str(verifier),a.input,a.prior_bundle,a.sha256],check=True,capture_output=True,text=True)
        prior=json.loads(check.stdout)
        if prior['mode']!='inner' or prior['stage']!='gradient' or not prior['fullPrimalPassed'] or not prior['fullDualPassed'] or prior['dualityGap']>1e-6:raise ValueError('Prior optimum not independently verified')
        cap=prior['gradientVariable']
    full=Problem(json.loads(raw),a.mode,a.stage,cap);part=Partition(full)
    if a.solve:
        if not a.component:raise ValueError('Explicit component required')
        if part.fixed_only_infeasible:raise ValueError('Fixed-only infeasible full row')
        available=next(int(s.split()[1])*1024 for s in Path('/proc/meminfo').read_text().splitlines()if s.startswith('MemAvailable:'))
        if available<6*1024**3 or not 1<=a.seconds<=120:raise ValueError('Memory/timeout allocation guard')
        view=ComponentProblem(full,a.component,part)
        result=view.remap_certificate(solve(view,digest,a.seconds,a.memory_bytes,method=a.method,presolve=True,display=True))
    else:result=part.receipt()
    if a.output:Path(a.output).write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps({k:v for k,v in result.items()if k not in ('values','dual','globalVariables')}))

if __name__=='__main__':main()
