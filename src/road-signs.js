import { signFaceOffset } from './sign-mount.js';
import { squarePost, signFace } from './world-prop-geometries.js';
import * as THREE from 'three';
import { CellInstances, canvasTex } from './util.js';
import { roadSignLayout } from './road-sign-layout.js';

// One atlas/material for all faces, one instanced pool per atlas tile. Text and
// symbols are drawn here; no Street View pixels are part of the game assets.
export function buildRoadSigns(map,parent,heightC) {
  const layout=roadSignLayout(map),group=new THREE.Group();group.name='Greek direction and warning signs';parent.add(group);
  const obstacles=[];if(!layout.length)return {group,obstacles,layout};
  const keys=[...new Set(layout.map(s=>s.kind+'|'+(s.text||'')))],size=256,cols=4,rows=Math.ceil(keys.length/cols);
  const atlas=roadSignAtlas(keys);
  const faceMat=new THREE.MeshStandardMaterial({map:atlas,alphaTest:.2,roughness:.7,side:THREE.FrontSide});
  const metal=new THREE.MeshStandardMaterial({color:'#91999d',metalness:.55,roughness:.5});
  const posts=new CellInstances(squarePost(.09,1),metal,{cell:500,far:750});
  const faces=new Map();
  for(const sign of layout){const key=sign.kind+'|'+(sign.text||'');let pool=faces.get(key);const board=sign.kind==='direction'||sign.kind==='village',w=board?2.8:.8,h=board?1.15:.8;
    if(!pool){const i=keys.indexOf(key),geometry=new THREE.PlaneGeometry(1,1).translate(0,0,signFaceOffset(.09)),uv=geometry.attributes.uv;for(let k=0;k<uv.count;k++)uv.setXY(k,(i%cols+uv.getX(k))/cols,1-(Math.floor(i/cols)+1-uv.getY(k))/rows);pool=new CellInstances(geometry,faceMat,{cell:500,far:750,shadow:false});faces.set(key,pool);}
    const y=Math.max(heightC(sign.x,sign.z),sign.y-.3),height=board?2.65:2.1;
    posts.addTRS(sign.x,y+height/2,sign.z,sign.yaw,1,height,1);
    // Board atlas includes transparent top/bottom margins; scale to preserve text proportions.
    pool.addTRS(sign.x,y+height-.2,sign.z,sign.yaw,w,board?h*256/140:h,1);
    obstacles.push({x:sign.x,z:sign.z,yaw:sign.yaw,hw:.09,hl:.09});
  }
  for(const pool of [posts,...faces.values()])pool.build(group);
  group.userData.signCount=layout.length;return {group,obstacles,layout};
}

export function roadSignAtlas(keys){const size=256,cols=4,rows=Math.ceil(keys.length/cols);
  const atlas=canvasTex(cols*size,rows*size,g=>{
    for(const [i,key] of keys.entries()){
      const [kind,text]=key.split('|');g.save();g.translate(i%cols*size,Math.floor(i/cols)*size);g.clearRect(0,0,size,size);
      if(kind==='direction'||kind==='village'){
        g.fillStyle=kind==='direction'?'#155180':'#f6f4e8';g.fillRect(2,50,252,140);g.strokeStyle=kind==='direction'?'white':'#152029';g.lineWidth=4;g.strokeRect(6,54,244,132);
        g.fillStyle=kind==='direction'?'white':'#152029';g.textAlign='center';g.textBaseline='middle';g.font='bold 23px sans-serif';const lines=text.split(' / ');lines.forEach((t,k)=>g.fillText(t,128,96+k*46,232));
      }else if(kind==='yield'||kind==='curve'){
        g.beginPath();if(kind==='yield'){g.moveTo(12,30);g.lineTo(244,30);g.lineTo(128,232);}else{g.moveTo(128,16);g.lineTo(244,226);g.lineTo(12,226);}g.closePath();g.fillStyle='#f2d35d';g.fill();g.strokeStyle='#bc242b';g.lineWidth=22;g.lineJoin='round';g.stroke();
        if(kind==='curve'){g.strokeStyle='#171d20';g.lineWidth=20;g.beginPath();g.moveTo(99,191);g.bezierCurveTo(99,135,167,154,160,105);g.stroke();}
      }else{
        g.fillStyle='#fff';g.fillRect(5,30,246,196);g.fillStyle='#111';const left=kind==='chevron-left';g.beginPath();g.moveTo(left?166:90,42);g.lineTo(left?58:198,128);g.lineTo(left?166:90,214);g.lineTo(left?218:38,214);g.lineTo(left?110:146,128);g.lineTo(left?218:38,42);g.closePath();g.fill();
      }g.restore();
    }
  });
 atlas.userData.penteliRecipe={kind:'road-sign',keys};return atlas;
}
