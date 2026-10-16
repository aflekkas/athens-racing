"""Baked face colours for the owner-locked unlit block style."""
import math
from appearance import linear


def face_shaded(positions,indices):
    """Duplicate face vertices, not triangles, so adjacent walls stay distinct.

    RGB factors multiply the palette in linear space. Roofs retain full colour;
    walls are about 15–35% darker in display space, using a fixed NW sun vector.
    No dynamic lights, shadows, textures or extra geometry are required.
    """
    vertices=[];colours=[]
    for offset in range(0,len(indices),3):
        points=[positions[i*3:i*3+3] for i in indices[offset:offset+3]]
        a,b,c=points;u=[b[i]-a[i] for i in range(3)];v=[c[i]-a[i] for i in range(3)]
        normal=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]]
        length=math.sqrt(sum(n*n for n in normal))
        if length<=1e-12:raise ValueError('Degenerate building face')
        normal=[n/length for n in normal]
        level=1 if normal[1]>.9 else .75+.10*(normal[0]*-.6+normal[2]*-.8)
        factor=level/12.92 if level<=.04045 else ((level+.055)/1.055)**2.4
        for point in points:vertices.extend(point);colours.extend([factor]*3)
    return vertices,list(range(len(vertices)//3)),colours


ROAD=linear('#41484c')
PAVEMENT=linear('#a7aaa9')
KERB_TOP=linear('#d5d8d6')
KERB_SIDE=linear('#969b9b')
MARKING=linear('#e5e5dd')
