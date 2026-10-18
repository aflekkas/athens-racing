"""Continuous same-layer road influence, independent of geometry/DEM libraries.

Candidates are (stable id, profile height, polygon distance, centre distance,
width). The spatial caller must supply every polygon within SUPPORT metres.
"""
import math

SUPPORT = 64.
# Maximum accepted road half-width (30 m), default GEOS mitre limit (5),
# support, and mesh/colour halo. Rtree bounds describe centrelines, not ribbons.
ROAD_QUERY_HALO = 256.


def blended_height(baseline, candidates):
    values = []
    distance = math.inf
    for key, y, d, centre_distance, width in sorted(candidates):
        if d >= SUPPORT:
            continue
        distance = min(distance, d)
        radius = width / 2 + 16
        weight = (1 - d / SUPPORT) ** 2 / (1 + (centre_distance / radius) ** 4)
        values.append((y, weight))
    if not values:
        return baseline
    y = math.fsum(h * w for h, w in values) / math.fsum(w for h, w in values)
    shoulder_distance = max(0., distance - 6.)
    conformed = min(y + shoulder_distance * .15, max(y - shoulder_distance * .15, baseline))
    alpha = min(1., max(0., (SUPPORT - distance) / 32))
    alpha = alpha * alpha * (3 - 2 * alpha)
    return baseline + (conformed - baseline) * alpha


def profile_height(x, z, segments, radius):
    """Blend all segments of one road, including both arms of a hairpin.

    A nearest polyline projection is discontinuous at its internal medial
    axes too. Each segment projection is continuous; positive length-weighted
    kernels keep the aggregate continuous even at a sharp bend or end cap.
    segments: (ax, az, bx, bz, ya, yb). No geometry libraries are required.
    """
    values=[]
    for ax, az, bx, bz, ya, yb in segments:
        dx,dz=bx-ax,bz-az;l2=dx*dx+dz*dz
        if l2<=0:continue
        t=max(0.,min(1.,((x-ax)*dx+(z-az)*dz)/l2))
        d2=(x-ax-t*dx)**2+(z-az-t*dz)**2
        w=math.sqrt(l2)/(1+(d2/(radius*radius))**2)
        values.append((ya+(yb-ya)*t,w))
    if not values:raise ValueError('Road profile has no nonzero segments')
    return math.fsum(y*w for y,w in values)/math.fsum(w for y,w in values)


def lattice_height(x, z, sample, spacing=8):
    """Canonical global planes; the tessellator inserts these same diagonals."""
    gx=math.floor(x/spacing)*spacing;gz=math.floor(z/spacing)*spacing
    u=(x-gx)/spacing;v=(z-gz)/spacing
    a=sample(gx,gz);b=sample(gx+spacing,gz);c=sample(gx,gz+spacing)
    if u+v<=1:return a+(b-a)*u+(c-a)*v
    d=sample(gx+spacing,gz+spacing)
    return d+(c-d)*(1-u)+(b-d)*(1-v)


def smooth_lattice_sample(x, z, sample, spacing=8):
    """Symmetric global filter preserves affine road grades exactly.

    Five binomial taps span the DSM-scale neighbourhood without introducing
    tile boundaries or smoothing already-clipped roads independently.
    """
    weights=(1,4,6,4,1)
    return math.fsum(sample(x+(i-2)*spacing,z+(j-2)*spacing)*a*b
                     for i,a in enumerate(weights) for j,b in enumerate(weights))/256
