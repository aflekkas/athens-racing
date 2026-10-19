// AI traffic at a real signal: a car 40 m before a stop line is held while the signal is red, and goes when it turns green.
// node signals-ai.mjs APP CELLSDIR OUT.json
import {writeFile} from 'node:fs/promises';import {startServer,launch,counters} from './lib.mjs';
const [app,r2,out]=process.argv.slice(2),c=counters(),{server,port}=await startServer({app,r2,c});const {browser,page}=await launch();const result={};
try{
  await page.goto(`http://127.0.0.1:${port}/?map=athens`,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__athens,null,{timeout:600000});
  await page.evaluate(async([x,z])=>{const A=window.__athens;const near=()=>[...A.roads.anchors({validate:true})].sort((a,b)=>Math.hypot(a.x-x,a.z-z)-Math.hypot(b.x-x,b.z-z))[0];let a=near();
    for(let i=0;i<4&&(!a||Math.hypot(a.x-x,a.z-z)>60);i++){await A.stream.teleport({x,z},()=>{});await new Promise(r=>setTimeout(r,4000));a=near();}
    await A.goto(a.id,a.x,a.z);},[506,456]);
  await page.waitForTimeout(5000);
  for(const scenario of [{name:'red-then-green',start:0,switchAt:8000,then:12},{name:'green-all-the-way',start:12,switchAt:null,then:null},{name:'detail-off-ignores-signals',start:0,switchAt:null,then:null,off:true}]){
    result[scenario.name]=await page.evaluate(async sc=>{
      const A=window.__athens,{setSetting}=await import('/src/settings.js');setSetting('worldDetail',!sc.off);
      await A.advance(3);                      // spawns traffic
      const rec=[...A.props.byEdge.values()].find(r=>r.x>480&&r.x<500&&r.z>430&&r.z<450&&r.group===1)||[...A.props.byEdge.values()][0];
      const edge=A.roads.graph.edges.get(rec.edge).value,pts=edge.points,end=pts.at(-1);
      // walk 40 m back from the edge end
      let acc=0,i=pts.length-1,p=null;for(;i>0;i--){const a=pts[i-1],b=pts[i],l=Math.hypot(b[0]-a[0],b[2]-a[2]);if(acc+l>=40){const f=(40-acc)/l;p={x:b[0]+(a[0]-b[0])*f,y:b[1]+(a[1]-b[1])*f,z:b[2]+(a[2]-b[2])*f,yaw:Math.atan2(-(b[0]-a[0]),-(b[2]-a[2]))};break;}acc+=l;}
      if(!p)p={x:pts[0][0],y:pts[0][1],z:pts[0][2],yaw:0};
      const car=A.traffic.find(t=>t.active)||A.traffic[0];car.active=true;car.model.root.visible=true;car.point={...p,edge:rec.edge,layer:0};Object.assign(car.veh,car.point);Object.assign(car.veh,car.veh.route.project(p.x,p.z));
      A.props.timeOverride=sc.start;const log=[],t0=performance.now();
      const timer=setInterval(()=>{const d=Math.hypot(end[0]-car.point.x,end[2]-car.point.z);log.push([+((performance.now()-t0)/1000).toFixed(1),car.point.edge===rec.edge?+d.toFixed(1):null,A.props.timeOverride,car.veh.vLong]);},500);
      if(sc.switchAt)setTimeout(()=>{A.props.timeOverride=sc.then;},sc.switchAt);
      await A.advance(16,{renderEvery:3});clearInterval(timer);A.props.timeOverride=null;setSetting('worldDetail',true);
      return {signal:{edge:rec.edge,group:rec.group,offset:rec.offset},samples:log};
    },scenario);
    const s=result[scenario.name].samples;console.log(scenario.name,JSON.stringify(s.map(x=>x[1])));
  }
}catch(e){result.failure=e.stack;console.log(e.stack);}finally{await browser.close();server.close();await writeFile(out,JSON.stringify(result,null,1));}
