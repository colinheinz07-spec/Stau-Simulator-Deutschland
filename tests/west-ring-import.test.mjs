import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {runInNewContext} from "node:vm";
import {extendWesternRing} from "../scripts/import-west-ring.mjs";

const points=[[50,7],[49.99,7],[49.98,7],[49.97,7],[49.96,7]];
const road=(id,ids,ref)=>({type:"way",id,nodes:ids.map(i=>i+1),geometry:ids.map(i=>({lat:points[i][0],lon:points[i][1]})),tags:{highway:"motorway",ref,oneway:"yes",lanes:"3"}});
const base=()=>({roads:[["start","mainline","A1",3,points.slice(0,2),"",1],["finish","mainline","A61",3,points.slice(3),"",2]],junctions:[]});
const options={synthetic:true,anchors:[{from:"start",fromEnd:true,to:"finish",toEnd:false,direction:"south"}]};
test("shared A1/A61 roadway uses exactly one physical stock and preserves directed OSM nodes",()=>{
 const result=extendWesternRing(base(),[road(3,[1,2],"A 1;A 61"),road(4,[2,3],"A 61")],options);
 assert.equal(result.westRingAudit.addedMainlines,2);
 assert.deepEqual(result.westRingAudit.sharedWays,[3]);
 assert.equal(result.roads.filter(r=>r[6]===3).length,1);
 assert.equal(result.roads.find(r=>r[6]===3)[3],3);
});
test("missing or wrong-way connection fails closed instead of drawing a fictitious road",()=>{
 assert.throws(()=>extendWesternRing(base(),[road(3,[1,2],"A1;A61"),road(4,[3,2],"A61")],options),/Missing directed ring/);
 assert.throws(()=>extendWesternRing(base(),[road(3,[1,2],"A1;A61")],options),/No unique exact OSM anchor/);
});
test("published western ring passes the actual traffic graph in both directions",async t=>{
 const window={};
 for(const file of ["legacy-geometry","event-schedule","traffic-reference","offline-traffic"])
  runInNewContext(await readFile("web/"+file+".js","utf8"),{window,Date,Intl,console});
 const data=window.STAU_LEGACY_GEOMETRY;
 if(!data.westRingAudit){
   if(process.env.REQUIRE_WEST_RING==="1")assert.fail("No published western ring");
   return t.skip("OSM snapshot not yet published");
 }
 const sim=window.createLegacyTrafficScenario(data);
 for(const [a,b] of [["extra-a1-koblenz","A61-30169400"],["A61-55751508","extra-a1-dortmund"]]){
   const route=sim.directedPathInfo(a,b);
   assert.ok(route,"Directed corridor missing "+a+" → "+b);
   assert.ok(route.motorways.includes("A1")&&route.motorways.includes("A61"));
 }
 const publicIds=new Set(sim.publicReturnIds());
 assert.equal(data.roads.filter(r=>publicIds.has(r[0])&&/\b(?:AK|AD|Autobahnkreuz|Autobahndreieck)\b/i.test(r[5].split(" · ")[0])).length,0);
 assert.ok(Math.abs(sim.totals().conservationResidual)<1e-6);
});
