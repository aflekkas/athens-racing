// Shared cheap asphalt treatment. World metres keep adjacent strips/chunks aligned;
// the scan and its normal are shared library textures, never allocated per street.
export const ASPHALT_GLSL = `
uniform sampler2D roadAlbedo;
uniform sampler2D roadNormal;
vec3 roadAsphalt(vec2 world, float edge, float gravel) {
 vec2 uv=world/4.2;
 vec3 scan=texture2D(roadAlbedo,uv).rgb;
 float grain=dot(scan,vec3(.333));
 // The former narrow grey multiplier erased the scan's aggregate and repairs.
 vec3 base=mix(vec3(grain),scan,.5)*1.5;
 float macro=.94+.06*sin(world.x*.073+sin(world.y*.041));
 base*=macro*mix(.76,1.,smoothstep(0.,.65,edge));
 return mix(base,vec3(.27,.23,.16)*(.65+grain*1.4),gravel);
}
vec3 roadAsphaltNormal(vec3 eye,vec3 n,vec2 world,float strength) {
 vec2 uv=world/4.2;vec3 tn=texture2D(roadNormal,uv).xyz*2.-1.;
 vec3 q0=dFdx(eye),q1=dFdy(eye);vec2 st0=dFdx(uv),st1=dFdy(uv);
 vec3 T=cross(q1,n)*st0.x+cross(n,q0)*st1.x;
 vec3 B=cross(q1,n)*st0.y+cross(n,q0)*st1.y;
 float scale=inversesqrt(max(max(dot(T,T),dot(B,B)),1e-10));
 return normalize(mat3(T*scale,B*scale,n)*vec3(tn.xy*strength,tn.z));
}`;
