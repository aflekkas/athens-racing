// Shared deterministic far-tree positions: the audit checks exactly what draws.
export function forestTree(asset,i,j){
  const {arrays:a,metadata:m}=asset,{nx}=m.forest,p=a[0],seed=(i*1664525+j*1013904223)>>>0;
  const u=(j%2+.25+(seed%40)/100)/2,v=(Math.floor(j/2)+.25+((seed>>>8)%40)/100)/2;
  return {x:p[i*3]+u*m.spacing,z:p[i*3+2]+v*m.spacing,y:(1-u)*(1-v)*p[i*3+1]+u*(1-v)*p[(i+1)*3+1]+(1-u)*v*p[(i+nx)*3+1]+u*v*p[(i+nx+1)*3+1]-.7,scale:1.25+(seed%50)/100,seed};
}
export function* forestCandidates(asset){
  const {arrays:a,metadata:m}=asset;if(!m.forest)return;const {array,nx,nz}=m.forest,mask=a[array];
  for(let z=0;z<nz-1;z++)for(let x=0;x<nx-1;x++){const i=z*nx+x;if(!mask[i]||!mask[i+1]||!mask[i+nx]||!mask[i+nx+1])continue;
    for(let j=0;j<4;j++){const r=forestTree(asset,i,j);if(mask[i]===2&&r.seed%4!==0)continue;yield {i,j,...r};}
  }
}
export const forestRadius=scale=>4.7*scale*1.4+3;
