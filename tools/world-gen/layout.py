"""Emit the shared terrain-u16-v1 layout without changing contact coordinates."""
import math
import numpy as np
from surfaces import f32


def compact_positions(values):
    if not values or len(values)%3 or any(not math.isfinite(v) for v in values):raise ValueError('Invalid terrain positions')
    original=[f32(v) for v in values];low=min(original[1::3]);high=max(original[1::3])
    scale=[.01,2**math.ceil(math.log2(max(1e-6,high-low)/65534)),.01]
    # A binary-grid origin includes exact zero. Using the arbitrary minimum
    # can lose one ULP when residual addition cancels across sea level.
    offset=[0.,math.floor(low/scale[1])*scale[1],0.];quantized=[];residual=[]
    for i in range(0,len(original),3):
        for axis in range(3):
            value=original[i+axis];q=math.floor((value-offset[axis])/scale[axis]+.5)
            if not 0<=q<=65535:raise ValueError('Terrain exceeds Uint16 extent')
            quantized.append(q);decoded=f32(offset[axis]+q*scale[axis])
            if axis==1:
                correction=f32(value-decoded);residual.append(correction)
                if f32(decoded+correction)!=value:raise ValueError('Height residual loses contact precision')
            elif decoded!=value:raise ValueError('Terrain is not on the canonical centimetre lattice')
    return quantized,residual,dict(version=1,offset=offset,scale=scale)


def vertex_normals(positions,triangles):
    points=np.asarray(positions,dtype=np.float64).reshape(-1,3);indices=np.asarray(triangles,dtype=np.int64).reshape(-1,3)
    faces=np.cross(points[indices[:,1]]-points[indices[:,0]],points[indices[:,2]]-points[indices[:,0]])
    normals=np.zeros_like(points)
    for axis in range(3):np.add.at(normals,indices[:,axis],faces)
    lengths=np.linalg.norm(normals,axis=1);normals[lengths==0]=[0,1,0];lengths[lengths==0]=1
    return np.rint(np.clip(normals/lengths[:,None],-1,1)*127).astype(np.int8).reshape(-1).tolist()
