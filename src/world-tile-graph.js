import { tileTables } from './world-tile-format.js';
// Decode the graph in the tile worker; the activation transaction only interns ready records.
export function readGraphShard(pack){const m=pack.metadata,t=pack.tables||tileTables(pack),nodes=[],edges=[],turns=[];
 for(let i=0;i<t.nodes.length;i+=2){const p=t.nodes[i+1]*3,id=m.ids[t.nodes[i]];nodes.push({id,x:t.nodePositions[p]+m.origin[0],y:t.nodePositions[p+1],z:t.nodePositions[p+2]+m.origin[2]});}
 for(let i=0;i<t.edges.length;i+=10){const a=t.edges,points=[];for(let j=a[i+3];j<a[i+3]+a[i+4];j++)points.push([t.edgePoints[j*3]+m.origin[0],t.edgePoints[j*3+1],t.edgePoints[j*3+2]+m.origin[2]]);let length=0;for(let j=1;j<points.length;j++)length+=Math.hypot(...points[j].map((v,k)=>v-points[j-1][k]));edges.push({id:m.ids[a[i]],from:m.ids[a[i+1]],to:m.ids[a[i+2]],points,name:m.strings[a[i+5]],lanes:a[i+6],speedKph:a[i+7],flags:a[i+8],surface:m.ids[a[i+9]],layer:t.edgeLayers[i/10],length});}
 for(let i=0;i<t.turns.length;i+=4){const a=t.turns;turns.push({from:m.ids[a[i]],via:m.ids[a[i+1]],to:m.ids[a[i+2]],rule:a[i+3]});}return{nodes,edges,turns};
}
// Tile graph ownership is independent of scene objects. World IDs survive portal crossings and eviction.
export class WorldRoadGraph {
  constructor(){this.nodes=new Map();this.edges=new Map();this.outgoing=new Map();this.turns=new Map();this.owners=new Map();}
  install(key,pack){for(const _ of this.installSteps(key,pack))void _;}
  *installSteps(key,pack,{batchSize=32}={}){
    if(this.owners.has(key))throw new Error('Graph tile already installed');
    const shard=pack.roadGraph||readGraphShard(pack),owned={nodes:[],edges:[],turns:[]};
    const intern=(registry,id,value)=>{const old=registry.get(id);if(old){if(JSON.stringify(old.value)!==JSON.stringify(value))throw new Error(`Conflicting graph portal ${id}`);old.refs++;}else registry.set(id,{value,refs:1});};
    this.owners.set(key,owned);let count=0;
    try{
      for(const node of shard.nodes){intern(this.nodes,node.id,node);owned.nodes.push(node.id);if(++count%batchSize===0)yield {stage:'graph'};}
      for(const edge of shard.edges){intern(this.edges,edge.id,edge);owned.edges.push(edge.id);let out=this.outgoing.get(edge.from);if(!out)this.outgoing.set(edge.from,out=new Set());out.add(edge.id);if(++count%batchSize===0)yield {stage:'graph'};}
      for(const rule of shard.turns){const id=JSON.stringify(rule);intern(this.turns,id,rule);owned.turns.push(id);if(++count%batchSize===0)yield {stage:'graph'};}
      this.owners.set(key,owned);
    }catch(error){this.owners.set(key,owned);this.remove(key);throw error;}
  }
  remove(key){const owned=this.owners.get(key);if(!owned)return;this.owners.delete(key);
    for(const id of owned.edges){const e=this.edges.get(id);if(--e.refs===0){this.outgoing.get(e.value.from)?.delete(id);if(!this.outgoing.get(e.value.from)?.size)this.outgoing.delete(e.value.from);this.edges.delete(id);}}
    for(const [kind,ids]of[[this.nodes,owned.nodes],[this.turns,owned.turns]])for(const id of ids){const value=kind.get(id);if(--value.refs===0)kind.delete(id);}
  }
  legal(from,edge){if(edge.flags&8)return false;if(!from)return true;
    for(const {value:r}of this.turns.values())if(r.from===from&&r.via===edge.from){if(r.rule===1&&r.to===edge.id||r.rule===2&&r.to!==edge.id)return false;}
    return true;
  }
  /** Bounded Dijkstra on loaded shards. Unknown/unloaded destinations return null for worker routing/prefetch. */
  route(from,to,{defaultSpeedKph=50,maxVisited=50000,initialEdge=null,terminalEdge=null}={}){
    if(!this.nodes.has(from)||!this.nodes.has(to))return null;
    const start=JSON.stringify([from,initialEdge]),queue=[{node:from,via:initialEdge,cost:0,key:start}],dist=new Map([[start,0]]),previous=new Map();let visited=0;
    while(queue.length&&visited++<maxVisited){queue.sort((a,b)=>b.cost-a.cost);const q=queue.pop();
      if(dist.get(q.key)!==q.cost)continue;
      if(q.node===to&&(!terminalEdge||this.legal(q.via,terminalEdge))){const path=[];let key=q.key;while(previous.has(key)){const p=previous.get(key);path.push(p.edge);key=p.key;}return {edges:path.reverse(),seconds:q.cost};}
      for(const id of this.outgoing.get(q.node)||[]){
        const e=this.edges.get(id)?.value;if(!e||!this.legal(q.via,e)||!this.nodes.has(e.to))continue;
        const speed=(e.speedKph||defaultSpeedKph)/3.6;if(!(speed>0))continue;
        const key=JSON.stringify([e.to,id]),cost=q.cost+e.length/speed;
        if(cost>=(dist.get(key)??Infinity)||dist.size>=maxVisited)continue;
        dist.set(key,cost);previous.set(key,{key:q.key,edge:id});queue.push({node:e.to,via:id,cost,key});
      }
    }return null;
  }
  /** Layer-aware projection supports GPS, road anchors and low-density local traffic. */
  nearest(x,z,{layer=null,referenceY=0,maxDistance=100}={}){
    let best=null,distance=maxDistance;
    for(const {value:e}of this.edges.values()){
      if(e.flags&8||layer!==null&&e.layer!==layer)continue;
      for(let i=1;i<e.points.length;i++){
        const a=e.points[i-1],b=e.points[i],dx=b[0]-a[0],dz=b[2]-a[2],f=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[2])*dz)/(dx*dx+dz*dz||1))),px=a[0]+dx*f,pz=a[2]+dz*f,y=a[1]+(b[1]-a[1])*f,d=Math.hypot(x-px,z-pz)+(layer===null?Math.abs(y-referenceY)*.25:0);
        if(d<distance){distance=d;best={edge:e.id,x:px,y,z:pz,yaw:Math.atan2(-dx,-dz),layer:e.layer,name:e.name,distance:d};}
      }
    }return best;
  }
  dispose(){for(const key of this.owners.keys())this.remove(key);}
}
