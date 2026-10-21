import {WorldRoadGraph} from '../../../src/world-tile-graph.js';
export const revision='a'.repeat(64);
export function fixture(){const graph=new WorldRoadGraph(),edges=[
 {id:'a',from:'n0',to:'n1',points:[[100,0,500],[100,0,100]],surface:'road-a',layer:0,flags:1},
 {id:'b',from:'n1',to:'n2',points:[[100,0,100],[500,0,100]],surface:'road-b',layer:0,flags:1},
 {id:'c',from:'n2',to:'n3',points:[[500,0,100],[950,0,100]],surface:'road-c',layer:0,flags:1},
 {id:'exit',from:'n1',to:'n4',points:[[100,0,100],[100,0,10]],surface:'exit',layer:0,flags:1},
 {id:'parallel',from:'p0',to:'p1',points:[[100,0,112],[500,0,112]],surface:'parallel',layer:0,flags:1},
 {id:'bridge',from:'h0',to:'h1',points:[[100,12,100],[500,12,100]],surface:'bridge',layer:1,flags:1}];
 for(const e of edges){graph.edges.set(e.id,{value:e});if(!graph.outgoing.has(e.from))graph.outgoing.set(e.from,new Set());graph.outgoing.get(e.from).add(e.id);}
 const contacts={worldSetRevision:revision,eligible:k=>['0,0','1,0'].includes(k),surfaceAllowed:(e,c)=>e.surface===c.surfaceId,contact(x,z,{layer}){let surfaceId=layer===1?'bridge':z>100.001?'road-a':x<500?'road-b':'road-c';return{y:layer===1?12:0,layer,flags:1,surfaceId};},width:()=>({left:4,right:3,width:7}),safe:()=>true,sourceHashes:cells=>cells.map(k=>[k,'b'.repeat(64)])};
 // At a junction, either adjoining canonical road surface is valid.
 contacts.surfaceAllowed=(e,c)=>e.surface===c.surfaceId||(['road-a','road-b','road-c'].includes(e.surface)&&['road-a','road-b','road-c'].includes(c.surfaceId));
 const definition={$schema:'../../schemas/route.v1.schema.json',schemaVersion:1,id:'fixture-race',revision:1,worldId:'athens',regionId:'basin',name:'Original two-cell fixture',kind:'sprint',lengthM:950,path:{edges:['a','b','c']},start:{edgeId:'a',offsetM:100,lateralM:0,yawRad:0},finish:{edgeId:'c',offsetM:250,lateralM:0,yawRad:-Math.PI/2},turns:{allowed:[],disallowed:[]},timeOfDay:'afternoon',trafficLevel:0,rivals:0,sectorsM:[400]};return{graph,contacts,definition};}
