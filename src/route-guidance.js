import {RoutePaint} from './route-guidance/paint.js';
import {drawRouteOverlay,drawTurnPreview} from './route-guidance/minimap.js';
export {decisionPoints} from './route-guidance/route.js';

/** Visual consumer of GuidanceDataV1, docs/plans/unified-world.md §7.
 * Navigation owns projection, occurrence, off-route state and earned progress.
 * contact(x,z,referenceY,layer,cell) must return an active road contact or null.
 */
export class RouteGuidance {
  constructor(scene,{contact,maxInstances=128}={}){
    this.scene=scene;this.options={contact,maxInstances};this.paint=null;this.data=null;
    this.lastFrame=null;this.activeCells=new Set();this.isRace=false;this.cursorS=0;
  }
  setRoute(data){
    if(data!==null&&(data.version!==1||!Array.isArray(data.polyline)||!Array.isArray(data.decisions)||!Number.isFinite(data.lengthM)||data.lengthM<=0))throw Error('Expected GuidanceDataV1');
    this.paint?.dispose();this.paint=null;this.data=data;this.isRace=false;this.lastFrame=null;
    if(!data)return;
    this.paint=new RoutePaint(this.scene,data.polyline,{...this.options,closed:data.closed,timing:data});
    this.paint.setDecisions(data.decisions);
    for(const key of this.activeCells)this.paint.addCell(key);
  }
  onTileActivated(key){if(this.activeCells.has(key))return;this.activeCells.add(key);this.paint?.addCell(key);}
  onTileRemoved(key){if(!this.activeCells.delete(key))return;this.paint?.removeCell(key);}
  update({cursorS,occurrence,lap,position,heading,origin={x:0,z:0},activeCells,isRace}){
    this.isRace=isRace===true;
    if(!this.paint||!this.isRace||!Number.isFinite(cursorS)){this.paint?.hide();this.lastFrame=null;return;}
    if(activeCells&&activeCells!==this.activeCells){
      for(const key of this.activeCells)if(!activeCells.has(key))this.onTileRemoved(key);
      for(const key of activeCells)this.onTileActivated(key);
    }
    this.cursorS=this.data.closed?((cursorS%this.data.lengthM)+this.data.lengthM)%this.data.lengthM:Math.max(0,Math.min(this.data.lengthM,cursorS));
    const now=performance.now(),previous=this.lastFrame;
    if(Number.isFinite(position?.vLong))this.paint.preview.value=Math.max(48,Math.min(80,48+Math.abs(position.vLong)*1.6));
    else if(previous&&position){const dt=(now-previous.time)/1000;if(dt>.001&&dt<.5){const speed=Math.hypot(position.x-previous.x,position.z-previous.z)/dt;this.paint.preview.value=Math.max(48,Math.min(80,48+speed*1.6));}}
    if(position)this.lastFrame={x:position.x,z:position.z,time:now};
    this.paint.update(this.cursorS,origin);
  }
  // Call inside the existing minimap world transform; no route layers in free roam.
  drawMinimap(context,scale=1){if(this.isRace&&this.paint)drawRouteOverlay(context,this.paint.chunks.route,this.cursorS,this.data.decisions,scale,{closed:this.data.closed,finish:this.data.finish});}
  drawTurnPreview(context,width,height){if(this.isRace&&this.paint)drawTurnPreview(context,width,height,this.cursorS,this.data.lengthM,this.data.decisions,{closed:this.data.closed});}
  get stats(){return this.paint?.stats??{instances:0,rebuilds:0};}
  get decisions(){return this.isRace?this.data?.decisions??[]:[];}
  dispose(){this.paint?.dispose();this.paint=null;this.data=null;this.activeCells.clear();this.isRace=false;}
}
