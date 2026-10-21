import {sampleRoute} from './route.js';
/** Draw in world coordinates on an existing minimap context (no outline or glow). */
export function drawRouteOverlay(g,route,progress,decisions,scale=1,{isRace=true,closed=false,finish=null}={}){
  if(!isRace)return;
  const stroke=(start,end,colour,width)=>{if(end<=start)return;const a=sampleRoute(route,start),b=sampleRoute(route,end);if(!a||!b)return;
    g.beginPath();g.moveTo(a.x,a.z);for(let i=1;i<route.points.length;i++)if(route.stations[i]>start&&route.stations[i]<end)g.lineTo(route.points[i].x,route.points[i].z);g.lineTo(b.x,b.z);g.strokeStyle=colour;g.lineWidth=width/scale;g.stroke();};
  g.lineCap='round';g.lineJoin='round';stroke(0,progress,'#596268',3);stroke(progress,route.length,'#b5c9c0',3);
  const next=decisions.find(d=>d.s>=progress-2)||(closed?decisions[0]:null);if(next)stroke(Math.max(next.s<progress?0:progress,next.s-24),Math.min(route.length,next.s+18),'#f1dca3',4);
  if(finish){g.save();g.translate(finish.x,finish.z);g.scale(1/scale,1/scale);g.fillStyle='#d1dbc7';g.fillRect(0,-8,1,10);g.fillRect(1,-8,6,4);g.restore();}
}
/** Athens uses the existing #minimap canvas / #mapBox HUD, with the resident streets. */
export function streetPaths(graph){
  const paths=new Map();
  for(const [key,owner]of graph.owners){const path=new Path2D();for(const id of owner.edges){const e=graph.edges.get(id)?.value;if(!e||e.flags&8)continue;e.points.forEach((p,i)=>i?path.lineTo(p[0],p[2]):path.moveTo(p[0],p[2]));}paths.set(key,path);}return paths;
}
export function drawGuidanceMinimap(canvas,paths,route,progress,decisions,car){
  const g=canvas.getContext('2d'),W=canvas.width,H=canvas.height,scale=W/260,rot=-Math.PI/2-Math.atan2(-Math.cos(car.yaw),-Math.sin(car.yaw));
  g.setTransform(1,0,0,1,0,0);g.fillStyle='#081420';g.fillRect(0,0,W,H);g.save();g.translate(W/2,H*.65);g.rotate(rot);g.scale(scale,scale);g.translate(-car.x,-car.z);
  g.lineCap='round';g.strokeStyle='#39464d';g.lineWidth=5/scale;
  for(let x=Math.floor((car.x-220)/512);x<=Math.floor((car.x+220)/512);x++)for(let z=Math.floor((car.z-220)/512);z<=Math.floor((car.z+220)/512);z++){const path=paths.get(`${x},${z}`);if(path)g.stroke(path);}
  drawRouteOverlay(g,route,progress,decisions,scale,{closed:true,finish:route.points.at(-1)});g.restore();drawTurnPreview(g,W,H,progress,route.length,decisions);g.fillStyle='#fff';g.beginPath();g.moveTo(W/2,H*.65-9);g.lineTo(W/2+6,H*.65+6);g.lineTo(W/2,H*.65+3);g.lineTo(W/2-6,H*.65+6);g.closePath();g.fill();
}

/** A small map-corner preview; never placed over the driving view. */
export function drawTurnPreview(g,W,H,progress,length,decisions,{closed=true}={}){
  const next=decisions.find(d=>d.s>=progress)||(closed&&decisions.length?decisions[0]:null);if(!next)return;
  const distance=(next.s-progress+length)%length,x=42,y=32,sign=next.turn==='left'?-1:next.turn==='right'?1:0;
  g.save();g.strokeStyle='#f1dca3';g.lineWidth=2;g.lineCap='round';g.lineJoin='round';g.beginPath();
  g.moveTo(x,y+8);g.lineTo(x,y-4);g.lineTo(x+sign*9,y-4-(sign?0:6));g.stroke();
  g.beginPath();if(sign){g.moveTo(x+sign*5,y-8);g.lineTo(x+sign*9,y-4);g.lineTo(x+sign*5,y);}else{g.moveTo(x-4,y-6);g.lineTo(x,y-10);g.lineTo(x+4,y-6);}g.stroke();
  g.fillStyle='#f1dca3';g.font='12px sans-serif';g.textAlign='left';g.fillText(`${Math.round(distance/5)*5} m`,x+18,y+3);g.restore();
}
