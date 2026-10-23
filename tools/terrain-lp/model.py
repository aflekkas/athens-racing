"""Offline sparse LP construction. SciPy is imported only by the explicit solve CLI.
No project/runtime dependency and no emitted-cell mutation or packing.
"""
import argparse
from array import array
import hashlib
import json
import math
import os
from pathlib import Path
import time

STEP = 8
AMP = .75
SAG = .5
SUPPORT = 32


def basis(x, z):
    ax, az = math.floor(x / 8) * 8, math.floor(z / 8) * 8
    u, v = (x - ax) / 8, (z - az) / 8
    if u + v <= 1:
        return [(ax, az, 1-u-v, -.125, -.125), (ax+8, az, u, .125, 0), (ax, az+8, v, 0, .125)]
    return [(ax+8, az+8, u+v-1, .125, .125), (ax, az+8, 1-u, -.125, 0), (ax+8, az, 1-v, 0, -.125)]


def terms(chord):
    a, b, c = (chord[k] for k in ('a', 'b', 'c'))
    bx, bz = b['x']-(a['x']+c['x'])/2, b['z']-(a['z']+c['z'])/2
    result = {}
    for p, scale, bent in [(a, -.5, False), (b, 1, True), (c, -.5, False)]:
        for x, z, w, dx, dz in basis(p['x'], p['z']):
            result[(x, z)] = result.get((x, z), 0) + scale*w - (bx*dx+bz*dz if bent else 0)
    return {k: v for k, v in result.items() if abs(v) > 1e-12}


class Problem:
    def __init__(self, data, mode='inner', stage='gradient', gradient_cap=None, facets=16):
        if mode not in ('inner', 'outer') or stage not in ('gradient', 'correction') or facets not in (8, 16, 32):
            raise ValueError('Invalid LP mode/stage/facets')
        if stage == 'correction' and (mode != 'inner' or gradient_cap is None or not math.isfinite(gradient_cap) or gradient_cap <= 0):
            raise ValueError('Correction requires independently verified inner gradient cap')
        if data.get('schema') != 'terrain-lp-input-1' or not data.get('sourceRevision'):
            raise ValueError('Missing pinned source input')
        self.data, self.mode, self.stage, self.facets = data, mode, stage, facets
        if len(data.get('chords',[]))>5000 or len(data.get('nodes',[]))>50000 or len(data.get('source',{}).get('cells',[]))>5: raise ValueError('Bounded five-cell analysis only')
        self.chords = sorted(data['chords'], key=lambda c: c['id'])
        if not self.chords or len({c['id'] for c in self.chords}) != len(self.chords):
            raise ValueError('Missing or duplicate chord observations')

        for c in self.chords:
            if not math.isfinite(c['signedSag']) or not all(math.isfinite(c[k][axis]) for k in ('a','b','c') for axis in ('x','z')): raise ValueError('Invalid observation')
        self.ct = [terms(c) for c in self.chords]
        seeds = set(k for ts in self.ct for k in ts)
        coords = set((x+dx, z+dz) for x,z in seeds for dx in range(-32,33,8) for dz in range(-32,33,8) if dx*dx+dz*dz <= 32**2)
        self.coords = sorted(coords)
        self.index = {p:i for i,p in enumerate(self.coords)}
        declared = {(n['x'],n['z']): n['free'] for n in data['nodes']}
        if len(declared) != len(data['nodes']) or set(declared) != coords or any(type(v) is not bool for v in declared.values()):
            raise ValueError('Support/node declaration mismatch')
        self.n = len(coords)
        self.g = self.n
        self.free = [declared[p] for p in self.coords]
        self.bounds = [(-AMP,AMP) if f else (0,0) for f in self.free] + ([(0,None)] if stage == 'gradient' else [(gradient_cap,gradient_cap)])
        self.objective = [0.] * (self.n+1)
        if stage == 'gradient': self.objective[self.g] = 1
        self.absvars = []
        if stage == 'correction':
            for i,p in enumerate(self.coords):
                if self.free[i]:
                    self.absvars.append((i,len(self.bounds)))
                    self.bounds.append((0,None))
                    weight=data.get('correctionWeights',{}).get(f'{p[0]},{p[1]}',1)
                    if not math.isfinite(weight) or not 1 <= weight <= 100: raise ValueError('Invalid correction/geography weight')
                    self.objective.append(float(weight))
        self.profiles = data.get('geography',{}).get('fixedSamples',[])
        if not self.profiles or not any(p.get('kind')=='summit' for p in self.profiles) or not any(p.get('kind')=='profile' for p in self.profiles):
            raise ValueError('Fixed summit and declared source profile constraints required')
        for p in self.profiles:
            if not p.get('id') or not p.get('sourceSHA256') or not all(math.isfinite(p[k]) for k in ('x','z','sourceY')):
                raise ValueError('Invalid source profile receipt')
        self.squares = sorted(set((x+dx,z+dz) for x,z in coords for dx,dz in [(0,0),(-8,0),(0,-8),(-8,-8)]))
        self.factor = math.cos(math.pi/facets) if mode == 'inner' else 1.

    def rows(self):
        for c,ts in zip(self.chords,self.ct):
            for sign in (1,-1):
                yield [(self.index[p],sign*v) for p,v in ts.items()], SAG-sign*c['signedSag']
        for x,z in self.squares:
            for tri in ([(x,z,-.125,-.125),(x+8,z,.125,0),(x,z+8,0,.125)],[(x+8,z+8,.125,.125),(x,z+8,-.125,0),(x+8,z,0,-.125)]):
                for j in range(self.facets):
                    angle=2*math.pi*j/self.facets
                    row=[(self.index[(a,b)],dx*math.cos(angle)+dz*math.sin(angle)) for a,b,dx,dz in tri if (a,b) in self.index]
                    yield row+[(self.g,-self.factor)], 0.
        for p in self.profiles:
            ts=[(self.index[(x,z)],w) for x,z,w,_,_ in basis(p['x'],p['z']) if (x,z) in self.index]
            for sign in (1,-1): yield [(i,sign*v) for i,v in ts], 0.
        for i,u in self.absvars:
            yield [(i,1),(u,-1)],0.
            yield [(i,-1),(u,-1)],0.

    def forecast(self):
        rows=2*len(self.chords)+2*len(self.squares)*self.facets+2*len(self.profiles)+2*len(self.absvars)
        # Measured predecessor: 678772 rows/1.718m nnz -> 959492096 RSS.
        # Include 25% margin and additional absolute-value variables, not only CSR storage.
        nnz_upper=2*sum(len(ts) for ts in self.ct)+8*len(self.squares)*self.facets+6*len(self.profiles)+4*len(self.absvars)
        forecast=max(128*1024**2,math.ceil(1_200_000_000*max(rows/678772,nnz_upper/1718136))+len(self.absvars)*512)
        return dict(nonzeroUpperBound=nnz_upper,nodes=self.n,variables=len(self.bounds),rows=rows,gradientTriangles=2*len(self.squares),facets=self.facets,forecastBytes=forecast,calibrationRSS=959492096,buildsMatrix=False)


def solve(problem, input_sha, seconds, memory_bytes):
    forecast=problem.forecast()
    if forecast['forecastBytes'] > memory_bytes: raise ValueError('Calibrated forecast exceeds explicit allocation')
    for name in ('OMP_NUM_THREADS','OPENBLAS_NUM_THREADS','MKL_NUM_THREADS'): os.environ[name]='1'
    import numpy as np
    from scipy.sparse import coo_matrix
    from scipy.optimize import linprog
    import resource
    start=time.monotonic(); rr,cc,vv,bb=array('i'),array('i'),array('d'),array('d')
    for terms_,bound in problem.rows():
        r=len(bb);bb.append(bound)
        for c,v in terms_:
            if abs(v)>1e-14:rr.append(r);cc.append(c);vv.append(v)
    matrix=coo_matrix((np.asarray(vv),(np.asarray(rr),np.asarray(cc))),shape=(len(bb),len(problem.bounds))).tocsr()
    rhs=np.asarray(bb);del rr,cc,vv,bb
    result=linprog(problem.objective,A_ub=matrix,b_ub=rhs,bounds=problem.bounds,method='highs',options={'time_limit':seconds,'threads':1})
    certificate=dict(schema='terrain-lp-certificate-1',inputSHA256=input_sha,mode=problem.mode,stage=problem.stage,facets=problem.facets,solverStatus=int(result.status),message=result.message,forecast=forecast,seconds=time.monotonic()-start,maxRSS=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss*1024,emittedCells=0)
    if result.success:
        certificate.update(gradientCap=problem.bounds[problem.g][0] if problem.stage=='correction' else None,values=list(map(float,result.x)),dual=[[i,float(y)] for i,y in enumerate(result.ineqlin.marginals) if y != 0],objective=float(result.fun))
    return certificate


def main():
    p=argparse.ArgumentParser();p.add_argument('input');p.add_argument('--sha256',required=True);p.add_argument('--mode',choices=['inner','outer'],default='inner');p.add_argument('--stage',choices=['gradient','correction'],default='gradient');p.add_argument('--prior-certificate');p.add_argument('--facets',type=int,default=16);p.add_argument('--solve',action='store_true');p.add_argument('--seconds',type=int,default=120);p.add_argument('--memory-bytes',type=int,default=1024**3);p.add_argument('--output');a=p.parse_args()
    raw=Path(a.input).read_bytes();digest=hashlib.sha256(raw).hexdigest()
    if digest != a.sha256: raise ValueError('Pinned input hash mismatch')
    cap=None
    if a.stage=='correction':
        if not a.prior_certificate: raise ValueError('Verified prior certificate required')
        import subprocess
        verify=Path(__file__).with_name('verify.mjs')
        check=subprocess.run(['node',str(verify),a.input,a.prior_certificate,a.sha256],check=True,capture_output=True,text=True)
        prior=json.loads(check.stdout)
        if not prior['primalPassed'] or not prior['dualPassed'] or prior['mode']!='inner' or prior['stage']!='gradient' or prior['dualityGap']>1e-6: raise ValueError('Prior inner optimum is not verified')
        cap=prior['gradientVariable']
    if a.solve:
        available=next(int(line.split()[1])*1024 for line in Path('/proc/meminfo').read_text().splitlines() if line.startswith('MemAvailable:'))
        if available<6*1024**3: raise ValueError('Less than 6GiB available system memory')
        if not 1<=a.seconds<=150: raise ValueError('Bounded solver timeout required')
    problem=Problem(json.loads(raw),a.mode,a.stage,cap,a.facets)
    result=solve(problem,digest,a.seconds,a.memory_bytes) if a.solve else dict(problem.forecast(),mode=a.mode,stage=a.stage,sourceRevision=problem.data['sourceRevision'],emittedCells=0)
    if a.output:Path(a.output).write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps(result if not a.solve else {k:v for k,v in result.items() if k not in ('values','dual')}))

if __name__=='__main__':main()
