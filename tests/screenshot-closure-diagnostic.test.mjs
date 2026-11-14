import test from "node:test";
import {readFile} from "node:fs/promises";
import {runInNewContext} from "node:vm";
function locateOffset(row,latLon){
  const p=row[4],R=6371000,rad=Math.PI/180;let cumulative=0,best=Infinity,offset=0;
  for(let i=1;i<p.length;i++){
    const a=p[i-1],b=p[i],x=(b[1]-a[1])*R*rad*Math.cos(latLon[0]*rad),y=(b[0]-a[0])*R*rad;
    const qx=(latLon[1]-a[1])*R*rad*Math.cos(latLon[0]*rad),qy=(latLon[0]-a[0])*R*rad;
    const t=Math.min(1,Math.max(0,(x*qx+y*qy)/Math.max(1,x*x+y*y)));
    const d=Math.hypot(qx-x*t,qy-y*t),len=Math.hypot(x,y);
    if(d<best){best=d;offset=cumulative+t*len;}
    cumulative+=len;
  }
  return {offset,distance:best,total:cumulative};
}
test("diagnostic Köln screenshots: selected edge -> actual motorway corridor, feeder closures",async()=>{
 const w={};
 for(const path of ["web/traffic-reference.js","web/legacy-geometry.js","web/offline-traffic.js"])
   runInNewContext(await readFile(path,"utf8"),{window:w});
 const data=w.STAU_LEGACY_GEOMETRY;
 const sights=[
  ["Poll","A4",[50.902,6.996]],["Heumar A4","A4",[50.9206018,7.0498108]],
  ["Heumar A59","A59",[50.9284616,7.0557273]]];
 for(const [name,ref,pos] of sights){
  for(const row of data.roads.filter(x=>x[1]==="mainline"&&x[2]===ref)){
   const info=locateOffset(row,pos);
   if(info.distance>360)continue;
   for(const dir of [-550,-200,40,300,800]){
    const tap=Math.max(0,Math.min(info.total-1,info.offset+dir));
    const sim=w.createLegacyTrafficScenario(data);
    const rec=sim.recommendedClosureLength(row[0],tap);
    if(!rec)continue;
    const evt=sim.setEvent({id:"diag",edgeId:row[0],kind:"closure",
      closedLanes:Array.from({length:row[3]},(_,i)=>i),
      offsetM:tap,lengthM:rec.lengthM,speedKmh:0,
      hasShoulder:false,shoulder:"normal",schedule:null});
    const closed=data.roads.filter(x=>sim.closureBands(x[0]).length);
    const ramp=closed.filter(x=>x[1]==="ramp");
    const lines=closed.filter(x=>x[1]==="mainline");
    console.log("DIAG",JSON.stringify({name,ref,road:row[0],direction:row[5],metre:Math.round(tap),
      junctionProjectionM:Math.round(info.offset),junctionErrorM:Math.round(info.distance),
      from:evt.closureFrom,to:evt.closureTo,
      mainlines:lines.map(x=>x[0]).slice(0,10),
      closedRamps:ramp.map(x=>({id:x[0],name:x[5]})).slice(0,20),
      badges:sim.closureAccessPoints().map(x=>x.edgeId).slice(0,15)}));
   }
  }
 }
});