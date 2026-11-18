import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {runInNewContext} from "node:vm";

async function engine(){
  const window={};
  runInNewContext(await readFile("web/traffic-reference.js","utf8"),{window});
  runInNewContext(await readFile("web/offline-traffic.js","utf8"),{window});
  return window.createLegacyTrafficScenario;
}
function network(){
  return {roads:[
    ["a","mainline","A3",3,[[50,7],[50,7.012]],"",11],
    ["b","mainline","A3",3,[[50,7.012],[50,7.024]],"",12],
    ["c","mainline","A3",3,[[50,7.024],[50,7.036]],"",13],
    ["r","ramp","A3",1,[[50,7.024],[50.003,7.03]],"AS-Rampe",14],
    ["rest","ramp","A3",1,[[50.003,7.03],[50.007,7.034]],"PWC Rastplatz",15]
  ]};
}
function conservation(stats){
  assert.ok(Math.abs(stats.conservationResidual)<1e-6,
    "Mass balance: generated = exited + roads + outside backlog");
  for(const key of ["generatedVehicles","exitedVehicles",
    "vehiclesOnNetwork","waitingOutsideSources"])
    assert.ok(stats[key]>=0&&Number.isFinite(stats[key]),key+" finite");
}
test("conservative local OSM network: no invented source, rest-area exit excluded",async()=>{
  const scenario=(await engine())(network());
  assert.equal(scenario.edgeCount(),4);
  assert.equal(scenario.totals().excludedRest,1);
  assert.equal(scenario.sourceCount(),1);
  assert.equal(scenario.reachable("a"),true);
  assert.equal(scenario.reachable("b"),true);
  assert.equal(scenario.reachable("rest"),false);
  assert.equal(scenario.color("a"),"free");
  scenario.setDemandPercent(125);
  for(let i=0;i<6;i++)scenario.advance(12);
  const result=scenario.totals();
  assert.equal(result.simSeconds,360);
  assert.ok(result.generatedVehicles>0);
  assert.ok(result.exitedVehicles>0);
  conservation(result);
});
test("independent real motorway components both receive boundary traffic",async()=>{
  const scenario=(await engine())({roads:[
    ["west1","mainline","A3",3,[[50,7],[50,7.015]],"",1],
    ["west2","mainline","A3",3,[[50,7.015],[50,7.035]],"",2],
    ["east1","mainline","A3",3,[[50.5,7.4],[50.5,7.42]],"",3],
    ["east2","mainline","A3",3,[[50.5,7.42],[50.5,7.45]],"",4]
  ]});
  assert.equal(scenario.sourceCount(),2,"separate physical corridors must have independent map-boundary input");
  scenario.setSimulationStart(Date.parse("2026-11-13T15:51:00Z"));
  for(let i=0;i<20;i++)scenario.advance(12);
  assert.ok(scenario.edgeActivity("west2",400).sectionVph>100);
  assert.ok(scenario.edgeActivity("east2",400).sectionVph>100);
  conservation(scenario.totals());
});

test("cut motorway lets through traffic leave the map despite a final one-lane exit",async()=>{
  const scenario=(await engine())({roads:[
    ["cut","mainline","A3",3,[[50,7],[50,7.015],[50,7.04]],"",11],
    ["exit","ramp","A3",1,[[50,7.04],[50.005,7.046]],"AS Beispiel · Abfahrt",12]
  ]});
  assert.equal(scenario.sourceCount(),1);
  assert.equal(scenario.edgeActivity("cut").boundaryExit,true);
  scenario.setSimulationStart(Date.parse("2026-11-13T15:51:00Z"));
  for(let i=0;i<35;i++)scenario.advance(12);
  assert.ok(scenario.edgeActivity("cut",2500).sectionVph>500);
  assert.ok(scenario.totals().exitedVehicles>150);
  assert.equal(scenario.jamSummaries().length,0,"map cut should not create queue");
  conservation(scenario.totals());
});

test("a single long authentic Way on A565 has a modelled peak and open exit",async()=>{
  const scenario=(await engine())({roads:[
    ["single","mainline","A565",2,[[50.8,7.1],[50.8,7.14]],"",1]
  ]});
  assert.equal(scenario.sourceCount(),1);
  scenario.setSimulationStart(Date.parse("2026-11-13T15:51:00Z"));
  for(let i=0;i<15;i++)scenario.advance(12);
  assert.ok(scenario.edgeActivity("single",1000).sectionVph>100);
  conservation(scenario.totals());
});

test("short orphan motorway fragment is never turned into a full 4000 vph generator",async()=>{
  const scenario=(await engine())({roads:[
    ["orphan","mainline","A3",3,[[50,7],[50,7.002]],"",1]
  ]});
  assert.equal(scenario.sourceCount(),0);
  scenario.advance(12);
  assert.equal(scenario.totals().generatedVehicles,0);
  conservation(scenario.totals());
});

test("full closure blocks its physical cross-section; upstream density slows",async()=>{
  const scenario=(await engine())(network());
  // A valid alternative off-ramp can clear a Sunday-night closure without
  // congestion. Use a documented heavy Friday demand for a strict queue test.
  scenario.setSimulationStart(Date.parse("2026-11-13T15:51:00Z"));
  scenario.setDemandPercent(150);
  scenario.setMode("c","closure");
  assert.equal(scenario.color("c"),"free",
    "closure is a separate red-white overlay, not an invented queue speed");
  for(let i=0;i<35;i++)scenario.advance(12);
  const snap=scenario.totals();
  conservation(snap);
  assert.equal(scenario.mode("c"),"closure");
  assert.ok(scenario.speed("a")<65||scenario.speed("b")<65,
    "backpressure must slow vehicles on actual upstream carriageways");
  assert.ok(snap.waitingOutsideSources>0,
    "queue reaching external graph boundary becomes conserved outside backlog");
  scenario.setMode("c","none");
  assert.equal(scenario.mode("c"),"none");
  scenario.reset(true);
  assert.equal(scenario.totals().generatedVehicles,0);
  assert.equal(scenario.totals().vehiclesOnNetwork,0);
  assert.equal(scenario.activeEvents().length,0);
});
test("0 percent traffic cannot create model vehicles; near-but-not-connected links stay separate",async()=>{
  const scenario=(await engine())({roads:[
    ["up","mainline","A48",2,[[50,7],[50,7.01]],"",3],
    ["down","mainline","A48",2,[[50,7.01],[50,7.022]],"",5],
    ["fake","ramp","A48",1,[[50,7.0102],[50,7.02]],"",4]
  ]});
  assert.equal(scenario.reachable("up"),true);
  assert.equal(scenario.reachable("fake"),false,
    "close but nonconnected OSM paths must not be given fictitious inflow");
  scenario.setDemandPercent(0);
  scenario.advance(12);
  assert.equal(scenario.totals().generatedVehicles,0);
  assert.equal(scenario.totals().vehiclesOnNetwork,0);
  assert.equal(scenario.totals().conservationResidual,0);
  scenario.setDemandPercent(100);
  scenario.advance(12);
  conservation(scenario.totals());
});
test("reject unsafe rates and unknown incidents",async()=>{
  const scenario=(await engine())(network());
  assert.throws(()=>scenario.setDemandPercent(201),/0–200/);
  assert.throws(()=>scenario.setDemandPercent(-1),/0–200/);
  assert.throws(()=>scenario.setMode("missing","closure"),/Unbekannter/);
  assert.throws(()=>scenario.setMode("a","unknown"),/Ungültiger/);
});

test("speed-limit signs alone never create congestion colors or phantom delay",async()=>{
  const scenario=(await engine())(network());
  scenario.setDemandPercent(0);
  scenario.setEvent({id:"limit-test",edgeId:"b",kind:"roadworks",
    closedLanes:[0],lengthM:300,offsetM:0,speedKmh:20,
    shoulder:"normal",hasShoulder:false,schedule:null});
  scenario.advance(12);
  assert.equal(scenario.color("b"),"free",
    "an empty 20 km/h work zone needs an event marker, not a red queue");
  assert.equal(scenario.visualBands("b").length,0);
  assert.equal(scenario.jamSummaries().length,0);
  conservation(scenario.totals());
});
test("congested connected OSM Ways have a queue length and positive delay",async()=>{
  const scenario=(await engine())(network());
  scenario.setSimulationStart(Date.parse("2026-11-13T15:51:00Z"));
  scenario.setDemandPercent(150);
  scenario.setMode("c","closure");
  for(let i=0;i<35;i++)scenario.advance(12);
  const jams=scenario.jamSummaries();
  assert.ok(jams.length>0,"a sustained closure must eventually generate measured queue statistics");
  assert.ok(jams.every(x=>x.lengthM>=100&&(x.delayMin===null||x.delayMin>=0)));
  assert.ok(jams.every(x=>(x.delayMin===null||Number.isFinite(x.delayMin))&&x.worstKmh>=0&&Number.isFinite(x.meanKmh)));
  assert.ok(jams.every(x=>Number.isFinite(x.delayMin)),"queue travel delay is independent of reopening");
  assert.ok(jams.some(x=>x.delayMin>0),"moving queue receives a positive delay");
  assert.ok(jams.some(x=>["a","b","c"].includes(x.edgeId)));
  conservation(scenario.totals());
  scenario.reset(true);
  assert.equal(scenario.jamSummaries().length,0);
});

test("shared OSM junction vertices connect mid-Way on/off ramps without invented nearby turns",async()=>{
  const make=await engine();
  const scenario=make({roads:[
    ["main","mainline","A3",3,[[50,7],[50,7.012],[50,7.015],[50,7.02]],"",11],
    ["next","mainline","A3",3,[[50,7.02],[50,7.04]],"",12],
    ["on","ramp","A3",1,[[50.004,7.008],[50,7.012]],"Test-AS · Auffahrt",13],
    ["off","ramp","A3",1,[[50,7.015],[50.004,7.022]],"Test-AS · Abfahrt",14],
    ["near-only","ramp","A3",1,[[50.004,7.03],[50.0001,7.012]],"Nicht angeschlossen",15]
  ]});
  assert.equal(scenario.sourceCount(),2,"mainline boundary and real local onramp");
  assert.equal(scenario.entryIncomingCount("main"),0,
    "merge in a middle cell must not erase motorway boundary demand");
  assert.equal(scenario.incomingCount("main"),1);
  assert.equal(scenario.reachable("on"),true);
  assert.equal(scenario.reachable("off"),true);
  assert.equal(scenario.reachable("near-only"),false,
    "geographic proximity cannot be a motorway movement");
  scenario.setSimulationStart(Date.parse("2026-11-13T15:51:00Z"));
  for(let minute=0;minute<12;minute++)scenario.advance(12);
  assert.ok(scenario.edgeActivity("on").enteredVph>100);
  assert.ok(scenario.edgeActivity("off").departedVph>50);
  conservation(scenario.totals());
});
test("two blocked of three lanes create a real upstream Friday queue with modeled demand",async()=>{
  const scenario=(await engine())({roads:[
    ["up","mainline","A3",3,[[50,7],[50,7.012],[50,7.02]],"",11],
    ["incident","mainline","A3",3,[[50,7.02],[50,7.04]],"",12]
  ]});
  scenario.setSimulationStart(Date.parse("2026-11-13T15:51:00Z"));
  for(let i=0;i<10;i++)scenario.advance(12);
  const normalSpeed=scenario.speed("up");
  scenario.setEvent({id:"two-lanes",edgeId:"incident",kind:"accident",
    offsetM:0,lengthM:150,closedLanes:[0,1],speedKmh:40,
    hasShoulder:false,shoulder:"normal",schedule:null});
  for(let i=0;i<25;i++)scenario.advance(12);
  assert.ok(scenario.speed("up")<65&&scenario.speed("up")<normalSpeed,
    "a 1-lane crash discharge must propagate a physical queue upstream");
  assert.ok(scenario.jamSummaries().some(j=>j.edgeId==="up"&&(j.delayMin===null||j.delayMin>.5)));
  assert.ok(scenario.edgeActivity("incident").enteredVph<1800,
    "merge losses make an accident more restrictive than a free single lane");
  conservation(scenario.totals());
});
test("Friday afternoon and Sunday night generate different modeled arrivals",async()=>{
  const make=await engine();
  const friday=make(network()),sunday=make(network());
  friday.setSimulationStart(Date.parse("2026-11-13T15:51:00Z"));
  sunday.setSimulationStart(Date.parse("2026-11-15T01:51:00Z"));
  for(let i=0;i<10;i++){friday.advance(12);sunday.advance(12);}
  assert.ok(friday.totals().generatedVehicles>2*sunday.totals().generatedVehicles);
  conservation(friday.totals());
  conservation(sunday.totals());
});

test("2200 Kfz/h per mainline lane is consistent with imported road capacity",async()=>{
  const scenario=(await engine())(network());
  assert.equal(scenario.edgeActivity("a").capacityVph,3*2200);
  assert.equal(scenario.edgeActivity("r").capacityVph,1500);
});
test("a full corridor closure marks the exclusive feeder ramp chain but not the open upstream exit",async()=>{
  const scenario=(await engine())({roads:[
    ["a","mainline","A3",3,[[50,7],[50,7.012]],"",11],
    ["b","mainline","A3",3,[[50,7.012],[50,7.024]],"",12],
    ["c","mainline","A3",3,[[50,7.024],[50,7.036]],"",13],
    ["r","ramp","A3",1,[[50.002,7.020],[50,7.024]],
      "AS Beispiel · Auffahrt auf A3 → Köln",14],
    ["r0","ramp","A3",1,[[50.003,7.018],[50.002,7.020]],
      "AS Beispiel · Rampenzweig",16],
    ["exit","ramp","A3",1,[[50,7.012],[50.004,7.015]],
      "AS Beispiel · Abfahrt von A3",15]
  ]});
  scenario.setEvent({id:"c1",edgeId:"b",kind:"closure",closedLanes:[0,1,2],
    offsetM:0,lengthM:1300,speedKmh:0,shoulder:"normal",hasShoulder:false});
  assert.equal(scenario.closureBands("r").length,1);
  assert.equal(scenario.closureBands("r0").length,1);
  assert.equal(scenario.mode("exit"),"none");
  assert.equal(scenario.closureBands("exit").length,0);
  for(let i=0;i<20;i++)scenario.advance(12);
  conservation(scenario.totals());
});
test("finger-selected off-ramp closure blocks the complete directed exit, not the motorway",async()=>{
  const scenario=(await engine())({roads:[
    ["a","mainline","A3",3,[[50,7],[50,7.015],[50,7.03]],"",11],
    ["b","mainline","A3",3,[[50,7.03],[50,7.05]],"",12],
    ["off-head","ramp","A3",1,[[50,7.015],[50.002,7.017]],
      "AS Test · Abfahrt von A3",13],
    ["off-tail","ramp","A3",1,[[50.002,7.017],[50.004,7.019]],
      "AS Test · Rampenzweig",14],
    ["on","ramp","A3",1,[[50.005,7.03],[50,7.03]],
      "AS Test · Auffahrt auf A3",15]
  ]});
  const span=scenario.recommendedClosureLength("off-tail",30);
  assert.equal(span.rampOnly,true);
  assert.ok(span.lengthM>500,"the full off-ramp is longer than tapped fragment");
  const ev=scenario.setEvent({id:"exit-only",edgeId:"off-tail",kind:"closure",
    closedLanes:[0],offsetM:30,lengthM:100,speedKmh:0,
    hasShoulder:false,shoulder:"normal",schedule:null});
  assert.equal(ev.edgeId,"off-tail","the closure icon stays at the finger-selected ramp");
  assert.equal(ev.offsetM,30,"do not silently move the marker to upstream AS");
  assert.equal(ev.lengthM,span.lengthM);
  assert.equal(scenario.closureBands("off-head").length,1);
  assert.equal(scenario.closureBands("off-tail").length,1);
  assert.equal(scenario.closureBands("a").length,0);
  assert.equal(scenario.closureBands("b").length,0);
  assert.equal(scenario.closureBands("on").length,0);
  assert.equal(scenario.mode("a"),"none");
  assert.ok(scenario.closureAccessPoints().some(p=>p.edgeId==="off-head"),
    "access closure symbol at actual entrance to the exit ramp");
  for(let i=0;i<6;i++)scenario.advance(12);
  conservation(scenario.totals());
});
test("a closed ramp branch must not close its shared open approach or adjacent branch",async()=>{
  const scenario=(await engine())({roads:[
    ["a","mainline","A4",3,[[50,7],[50,7.015],[50,7.032]],"",11],
    ["shared","ramp","A4",1,[[50,7.015],[50.002,7.018]],
      "AK Test · Abfahrt",12],
    ["left","ramp","A4",1,[[50.002,7.018],[50.005,7.018]],
      "AK Test · Richtung Stadt",13],
    ["right","ramp","A4",1,[[50.002,7.018],[50.002,7.025]],
      "AK Test · Richtung Anschluss",14]
  ]});
  scenario.setEvent({id:"left-only",edgeId:"left",kind:"closure",
    closedLanes:[0],offsetM:10,lengthM:100,speedKmh:0,
    hasShoulder:false,shoulder:"normal",schedule:null});
  assert.ok(scenario.closureBands("left").length);
  for(const id of ["shared","right","a"])
    assert.equal(scenario.closureBands(id).length,0,
      "unselected accessible road must remain open: "+id);
});

test("two explicitly closed transfer ramps close their common trunk and route to real entries in both directions",async()=>{
  const sim=(await engine())({roads:[
    ["approach","mainline","A4",3,[[50,7],[50,7.02],[50,7.05]],"",1],
    ["exit","ramp","A4",1,[[50,7.02],[50.004,7.02]],"AS Vorne · Abfahrt",2],
    ["branch-a","ramp","A3",1,[[50,7.05],[50.01,7.06]],"AD Test · Überleitung",3],
    ["branch-b","ramp","A59",1,[[50,7.05],[49.99,7.06]],"AD Test · Überleitung",4],
    ["a","mainline","A3",3,[[50.01,7.06],[50.01,7.07],[50.01,7.08],[50.01,7.11]],"",5],
    ["b","mainline","A59",2,[[49.99,7.06],[49.99,7.08],[49.99,7.11]],"",6],
    ["fake","ramp","A3",1,[[50.014,7.07],[50.01,7.07]],"AD Test · Auffahrt auf A3",7],
    ["real-a","ramp","A3",1,[[50.014,7.08],[50.01,7.08]],"AS Danach · Auffahrt auf A3",8],
    ["real-b","ramp","A59",1,[[49.986,7.08],[49.99,7.08]],"AS Danach · Auffahrt auf A59",9]
  ]});
  const close=(id,edgeId)=>sim.setEvent({id,edgeId,kind:"closure",closedLanes:[0],
    offsetM:10,lengthM:100,speedKmh:0,shoulder:"normal",hasShoulder:false});
  close("a-closed","branch-a");
  assert.equal(sim.closureBands("approach").length,0);
  close("b-closed","branch-b");
  assert.ok(sim.closureBands("approach").some(s=>Math.abs(s.fromM-1429.5)<2),
    "the common carriageway must close precisely after its last local exit");
  assert.equal(sim.closureBands("exit").length,0);
  assert.ok(!sim.sourceIds().includes("fake"),"an AD transfer is not an external traffic source");
  sim.advance(1);
  const plan=sim.detourPlans().find(p=>p.terminalEdgeId==="exit");
  assert.ok(plan,"explicit ramp closures must generate detours too");
  assert.deepEqual(Array.from(plan.reentries,e=>e.edgeId).sort(),["real-a","real-b"]);
  assert.ok(Math.abs(plan.reentries.reduce((s,e)=>s+e.weight,0)-1)<1e-9);
  sim.removeEvent("b-closed");
  assert.equal(sim.closureBands("approach").length,0);
  conservation(sim.totals());
});

test("AS-to-AS closure uses physical off-ramp fork to downstream on-ramp merge; never blocks the reentry",async()=>{
  const scenario=(await engine())({roads:[
    ["main","mainline","A7",3,[[50,7],[50,7.01],[50,7.014],[50,7.016],
      [50,7.024],[50,7.028],[50,7.031],[50,7.034],[50,7.04]],"",1],
    ["before-off","ramp","A7",1,[[50,7.01],[50.005,7.01]],
      "AS 1 Vorne · Abfahrt von A7",2],
    ["before-on","ramp","A7",1,[[50.005,7.016],[50,7.016]],
      "AS 1 Vorne · Auffahrt auf A7",3],
    ["after-off","ramp","A7",1,[[50,7.028],[50.005,7.028]],
      "AS 2 Hinten · Abfahrt von A7",4],
    ["after-on","ramp","A7",1,[[50.005,7.034],[50,7.034]],
      "AS 2 Hinten · Auffahrt auf A7",5]
  ],junctions:[
    ["A7","1","Vorne",[50,7.014]],["A7","2","Hinten",[50,7.031]]
  ]});
  const tap=(.024)*111194.93*Math.cos(50*Math.PI/180);
  const e=scenario.setEvent({id:"korridor",kind:"closure",edgeId:"main",
    closedLanes:[0,1,2],offsetM:tap,lengthM:100,
    speedKmh:0,hasShoulder:false,shoulder:"normal"});
  assert.match(e.closureFrom,/A7 1/);
  assert.match(e.closureTo,/A7 2/);
  const band=scenario.closureBands("main")[0];
  const metresPerDegree=111194.93*Math.cos(50*Math.PI/180);
  assert.ok(Math.abs(band.fromM-.01*metresPerDegree)<35,
    "start must be at OFF-RAMP split, not AS centre: "+band.fromM);
  assert.ok(Math.abs(band.toM-.034*metresPerDegree)<35,
    "end must be at ON-RAMP merge, not AS centre: "+band.toM);
  assert.equal(scenario.closureBands("before-off").length,0,
    "last available exit before closure MUST remain open");
  assert.ok(scenario.closureBands("before-on").length>0,
    "upstream on-ramp feeds closed mainline and MUST close");
  assert.ok(scenario.closureBands("after-off").length>0,
    "exit just before downstream reentry MUST close");
  assert.equal(scenario.closureBands("after-on").length,0,
    "downstream reentry ramp MUST remain open");
  const downstream=sim => sim.closureBands("main")[0];
  assert.ok(downstream(scenario).toM<.04*metresPerDegree,
    "mainline AFTER downstream reentry remains open");
});


test("real A3 Dierdorf to Neuwied: last exit open, both entry/exit gates correct, first reentry open",async()=>{
 const w={};
 for(const path of ["web/traffic-reference.js","web/legacy-geometry.js","web/offline-traffic.js"])
   runInNewContext(await readFile(path,"utf8"),{window:w});
 const data=w.STAU_LEGACY_GEOMETRY,sim=w.createLegacyTrafficScenario(data);
 // Use only real imported directed mainline geometry near the physical
 // midpoint. The same planner is used for every motorway nationwide.
 const candidates=data.roads.filter(r=>r[1]==="mainline"&&r[2]==="A3")
   .map(r=>({row:r,dist:Math.min(...r[4].map(p=>
     Math.hypot((p[0]-50.55)*111000,(p[1]-7.56)*71000)))}))
   .sort((a,b)=>a.dist-b.dist).slice(0,40);
 let chosen=null;
 for(const {row} of candidates){
   const path=row[4];let walked=0,best=Infinity,offset=0;
   for(let k=1;k<path.length;k++){
     const a=path[k-1],b=path[k],x=(b[1]-a[1])*71000,y=(b[0]-a[0])*111000;
     const qx=(7.56-a[1])*71000,qy=(50.55-a[0])*111000;
     const t=Math.min(1,Math.max(0,(x*qx+y*qy)/Math.max(1,x*x+y*y)));
     const delta=Math.hypot(qx-t*x,qy-t*y);
     if(delta<best){best=delta;offset=walked+t*Math.hypot(x,y);}
     walked+=Math.hypot(x,y);
   }
   const info=sim.recommendedClosureLength(row[0],Math.max(0,offset));
   if(info&&/A3 37 Dierdorf\s*–\s*A3 36 Neuwied/.test(info.label)){
     chosen={id:row[0],offset,info};break;
   }
 }
 assert.ok(chosen,"directed A3 Dierdorf -> Neuwied corridor must resolve");
 const row=data.roads.find(x=>x[0]===chosen.id);
 const evt=sim.setEvent({id:"a3-dierdorf-neuwied",edgeId:chosen.id,kind:"closure",
   closedLanes:Array.from({length:row[3]},(_,i)=>i),
   offsetM:Math.min(chosen.offset-0.001,
     sim.edgeActivity(chosen.id,chosen.offset).lengthM||chosen.offset+1),
   lengthM:chosen.info.lengthM,speedKmh:0,
   hasShoulder:false,shoulder:"normal",schedule:null});
 assert.match(evt.closureFrom,/Dierdorf/);
 assert.match(evt.closureTo,/Neuwied/);
 const cases=[
  ["extra-heumar-24492793",false,"Dierdorf Abfahrt Köln must stay OPEN"],
  ["extra-heumar-1352049124",true,"Dierdorf Auffahrt Köln must CLOSE"],
  ["extra-heumar-24492231",true,"Neuwied Abfahrt Köln must CLOSE"],
  ["extra-heumar-24492229",false,"Neuwied Auffahrt Köln must stay OPEN"]
 ];
 for(const [id,blocked,meaning] of cases)
   assert.equal(sim.closureBands(id).length>0,blocked,meaning+
     "; segment="+evt.closureFrom+"→"+evt.closureTo+
     "; nearby mainlines="+JSON.stringify(["A3-314180029","A3-314180033","A3-314180030"]
       .map(id=>({id,closed:sim.closureBands(id)})))+
     "; turn blocked="+sim.movementBlocked("A3-314180029","extra-heumar-24492231"));
 assert.ok(evt.coveredLengthM<18000,
   "Dierdorf-Neuwied closure may not extend toward Siebengebirge");
});

test("published 2026/27 vacation windows and Easter public holidays change modeled daily traffic",async()=>{
  const window={};
  runInNewContext(await readFile("web/traffic-reference.js","utf8"),{window});
  const cal=window.StauTrafficReference;
  const first=[[50.95,7.0],[50.96,7.0]];
  const nrw=cal.calendarStatus("A3",first,Date.parse("2026-10-23T11:00:00Z"));
  assert.equal(nrw.state,"NW");
  assert.equal(nrw.schoolHoliday,true);
  const westerwald=cal.calendarStatus("A48",[[50.4,7.5]],
    Date.parse("2026-10-23T11:00:00Z"));
  assert.equal(westerwald.schoolHoliday,false);
  const christmas=cal.calendarStatus("A48",[[50.4,7.5]],
    Date.parse("2026-12-25T07:00:00Z"));
  assert.equal(christmas.holiday,true);
  assert.ok(christmas.factor<1);
  const goodFriday=cal.calendarStatus("A48",[[50.4,7.5]],
    Date.parse("2027-03-26T10:00:00Z"));
  assert.equal(goodFriday.holiday,true);
});
test("two hours of Sunday night traffic on real imported snapshot do not produce unexplained queues",async()=>{
  const window={};
  runInNewContext(await readFile("web/traffic-reference.js","utf8"),{window});
  runInNewContext(await readFile("web/legacy-geometry.js","utf8"),{window});
  runInNewContext(await readFile("web/offline-traffic.js","utf8"),{window});
  const scenario=window.createLegacyTrafficScenario(window.STAU_LEGACY_GEOMETRY);
  scenario.setSimulationStart(Date.parse("2026-11-15T01:00:00Z"));
  for(let i=0;i<90;i++)scenario.advance(12);
  assert.equal(scenario.jamSummaries().length,0,
    "an unimpeded, low-demand overnight network must remain free flowing");
  conservation(scenario.totals());
});

test("closed A3 redirects arrivals to the actual preceding open exit while preserving an upstream queue",async()=>{
  const scenario=(await engine())({roads:[
    ["a","mainline","A3",3,[[50,7],[50,7.012],[50,7.020]],"",11],
    ["b","mainline","A3",3,[[50,7.020],[50,7.032]],"",12],
    ["exit","ramp","A3",1,[[50,7.012],[50.006,7.019]],
      "AS Muster · Abfahrt",13]
  ]});
  scenario.setSimulationStart(Date.parse("2026-11-13T15:51:00Z"));
  for(let i=0;i<5;i++)scenario.advance(12);
  const ordinaryExit=scenario.edgeActivity("exit").enteredVph;
  scenario.setEvent({id:"closed-b",edgeId:"b",kind:"closure",
    closedLanes:[0,1,2],offsetM:0,lengthM:1200,speedKmh:0,
    shoulder:"normal",hasShoulder:false});
  for(let i=0;i<20;i++)scenario.advance(12);
  const diversion=scenario.edgeActivity("exit").enteredVph;
  assert.ok(diversion>ordinaryExit*2,
    "actual off-ramp should absorb more traffic after an announced closure");
  assert.ok(diversion<=1550,"one-lane exit must not pass impossible flow");
  assert.ok(scenario.jamSummaries().some(x=>x.edgeId==="a"),
    "excess demand must physically queue before the closure");
  conservation(scenario.totals());
});

test("route choice grows with net time advantage, with a small minority staying on an open road",async()=>{
  const scenario=(await engine())(network());
  assert.equal(scenario.diversionShare(0),0);
  assert.equal(scenario.diversionShare(10),0);
  assert.ok(scenario.diversionShare(45)>0&&scenario.diversionShare(45)<.4);
  assert.ok(scenario.diversionShare(120)>.7);
  assert.ok(scenario.diversionShare(240)>.97&&scenario.diversionShare(240)<1);
  assert.ok(scenario.diversionShare(360)>.98&&scenario.diversionShare(360)<1);
});

test("growing accident queue: nearly all new through traffic prefers a faster real exit",async()=>{
  const s=(await engine())({roads:[
    ["up","mainline","A3",3,[[50,7],[50,7.012],[50,7.022]],"",11],
    ["jam","mainline","A3",3,[[50,7.022],[50,7.22]],"",12],
    ["after","mainline","A3",3,[[50,7.22],[50,7.226],[50,7.25]],"",13],
    ["out","ramp","A3",1,[[50,7.012],[50.006,7.014]],"AS 1 · Abfahrt von A3",14],
    ["in","ramp","A3",1,[[50.005,7.226],[50,7.226]],"AS 2 · Auffahrt auf A3",15]
  ]});
  s.setSimulationStart(Date.parse("2026-11-13T12:00:00Z"));
  s.setDemandPercent(145);s.warmStart();
  s.setEvent({id:"acc",kind:"accident",edgeId:"jam",offsetM:13600,lengthM:100,
    closedLanes:[0,1,2],speedKmh:0,shoulder:"normal",hasShoulder:false});
  s.advance(12);
  assert.ok(s.routingDelayAhead("up",850)<45,"initially not a long queue");
  assert.equal(s.totals().detouredVehicles,0);
  for(let i=0;i<65;i++)s.advance(12);
  assert.ok(s.routingDelayAhead("up",850)>=90,
    "a real, sustained accident queue still forms, while earlier diversions should limit the delay");
  const through=s.edgeActivity("jam").enteredVph, diverted=s.edgeActivity("out").departedVph;
  assert.ok(through<diverted*.4,"most drivers prefer the detour even with finite return capacity: "+through+" / "+diverted);
  assert.ok(s.edgeActivity("out").departedVph>650&&s.edgeActivity("out").departedVph<=705);
  assert.ok(s.detourPlans().some(p=>p.terminalEdgeId==="out"&&p.reentryEdgeId==="in"));
  assert.ok(s.totals().returnedVehicles>100,"diverted vehicles reenter the correct direction");
  conservation(s.totals());
});

test("prolonged full closure activates earlier real exits without abandoning the primary signed exit",async()=>{
  const s=(await engine())({roads:[
    ["approach","mainline","A3",3,[[50,7],[50,7.03],[50,7.08],[50,7.14],[50,7.145]],"",1],
    ["blocked","mainline","A3",3,[[50,7.145],[50,7.18]],"",2],
    ["after","mainline","A3",3,[[50,7.18],[50,7.19],[50,7.22]],"",3],
    ["early","ramp","A3",1,[[50,7.03],[50.006,7.03]],"AS 1 · Abfahrt",4],
    ["middle","ramp","A3",1,[[50,7.08],[50.006,7.08]],"AS 2 · Abfahrt",5],
    ["last","ramp","A3",1,[[50,7.14],[50.006,7.14]],"AS 3 · Abfahrt",6],
    ["return","ramp","A3",1,[[50.006,7.19],[50,7.19]],"AS 4 · Auffahrt",7]
  ]});
  s.setSimulationStart(Date.parse("2026-11-13T15:00:00Z"));
  s.setDemandPercent(160);s.warmStart();
  s.setEvent({id:"full",edgeId:"blocked",kind:"closure",offsetM:0,lengthM:100,
    closedLanes:[0,1,2],speedKmh:0,shoulder:"normal",hasShoulder:false});
  s.advance(12);
  assert.equal(s.edgeActivity("early").divertedVehiclesOnEdge,0);
  let anticipatoryExit=false;
  for(let i=0;i<40;i++){
    s.advance(12);
    const early=s.detourRouteAccounting().find(a=>a.terminalEdgeId==="early");
    const exitMetre=2144;
    if(early?.assigned>1&&!s.visualBands("approach").some(b=>b.toM>exitMetre&&b.fromM<exitMetre+1500))anticipatoryExit=true;
  }
  assert.ok(anticipatoryExit,"drivers can choose an earlier exit while the next 1.5 km remain clear");
  for(const id of ["early","middle","last"]){
    const a=s.edgeActivity(id);
    assert.ok(a.divertedVehiclesOnEdge>5,id+" must receive actual bypass traffic");
    assert.ok(a.departedVph>600&&a.departedVph<=705,id+" retains finite ramp capacity");
    assert.ok(s.detourPlans().some(p=>p.terminalEdgeId===id&&p.reentryEdgeId==="return"&&p.closureId==="full"),
      "a long queue must not override the closure route with a return before the gate");
  }
  assert.ok(s.edgeActivity("blocked").enteredVph<1);
  assert.ok(s.totals().returnedVehicles>100);
  assert.equal(s.edgeActivity("return").localAdmissionVph,700);
  assert.ok(s.edgeActivity("return").enteredVph<=705,
    "normal and returning traffic must share the limited local entry service");
  assert.equal(s.visualBands("return").length,0,
    "a free motorway must not acquire a ramp jam from unlimited local-road demand");
  assert.ok(s.totals().vehiclesOnDetours>100,"excess demand waits outside the ramp");
  conservation(s.totals());
});

test("full closure sends ALL approaching demand to a legal exit, with ramp congestion instead of illegal driving",async()=>{
  const scenario=(await engine())({roads:[
    ["up","mainline","A3",3,[[50,7],[50,7.012],[50,7.02]],"",11],
    ["blocked","mainline","A3",3,[[50,7.02],[50,7.04]],"",12],
    ["exit","ramp","A3",1,[[50,7.012],[50.006,7.019]],"AS Beispiel · Abfahrt",13]
  ]});
  scenario.setSimulationStart(Date.parse("2026-11-13T15:51:00Z"));
  for(let i=0;i<5;i++)scenario.advance(12);
  scenario.setEvent({id:"full",edgeId:"blocked",kind:"closure",
    closedLanes:[0,1,2],offsetM:0,lengthM:1200,speedKmh:0,
    shoulder:"normal",hasShoulder:false});
  for(let i=0;i<28;i++)scenario.advance(12);
  assert.ok(scenario.edgeActivity("exit").enteredVph>500,
    "open ramp remains a usable capacity-constrained escape");
  assert.ok(scenario.edgeActivity("exit").enteredVph<=1550);
  assert.ok(scenario.edgeActivity("exit").departedVph>650&&scenario.edgeActivity("exit").departedVph<=705,
    "saturated exit discharges at its local junction capacity, not motorway capacity");
  assert.ok(scenario.edgeActivity("exit").vehicles<=scenario.edgeActivity("exit").storageVehicles,
    "physical exit storage never overfills");
  assert.ok(scenario.edgeActivity("blocked").enteredVph<20,
    "none of the newer arrivals can drive into the fully closed road");
  assert.ok(scenario.jamSummaries().some(x=>x.edgeId==="up"),
    "excess cars must wait before the full exit, never teleport");
  conservation(scenario.totals());
  scenario.removeEvent("full");
  scenario.setDemandPercent(15);
  for(let i=0;i<40;i++)scenario.advance(12);
  conservation(scenario.totals());
  assert.equal(scenario.jamSummaries().length,0,
    "the physical queue dissolves after the motorway reopens");
});

test("real alternative motorway reconnects downstream without a local-road detour",async()=>{
  const s=(await engine())({roads:[
    ["up","mainline","A3",3,[[50,7],[50,7.02]],"",1],
    ["blocked","mainline","A3",3,[[50,7.02],[50,7.05]],"",2],
    ["after","mainline","A3",3,[[50,7.05],[50,7.09]],"",3],
    ["alt","mainline","A4",3,[[50,7.02],[50.012,7.035],[50,7.05]],"",4]
  ]});
  s.setSimulationStart(Date.parse("2026-11-13T12:00:00Z"));
  s.setEvent({id:"closed",kind:"closure",edgeId:"blocked",offsetM:0,lengthM:100,
    closedLanes:[0,1,2],speedKmh:0,shoulder:"normal",hasShoulder:false});
  for(let i=0;i<20;i++)s.advance(12);
  assert.ok(s.edgeActivity("alt").departedVph>500,JSON.stringify(s.edgeActivity("alt")));
  assert.ok(s.edgeActivity("after").sectionVph>500);
  assert.ok(s.edgeActivity("blocked").enteredVph<1);
  assert.ok(s.detourRouteAccounting().some(a=>a.terminalEdgeId==="after"&&a.arrived>100));
  assert.equal(s.totals().vehiclesOnDetours,0);
  conservation(s.totals());
});

test("motorway bypass may rejoin several links beyond an accident and keeps its destination",async()=>{
  const s=(await engine())({roads:[
    ["up","mainline","A3",3,[[50,7],[50,7.02]],"",1],
    ["acc-road","mainline","A3",3,[[50,7.02],[50,7.05]],"",2],
    ["mid","mainline","A3",3,[[50,7.05],[50,7.07]],"",3],
    ["after","mainline","A3",3,[[50,7.07],[50,7.1]],"",4],
    ["alternative","mainline","A4",3,[[50,7.02],[50.015,7.041],[50,7.07]],"",5]
  ]});
  s.setSimulationStart(Date.parse("2026-11-13T12:00:00Z"));
  assert.equal(s.edgeActivity("alternative").source,false,"connected motorway branch is not a new source");
  for(let i=0;i<15;i++)s.advance(12);
  const regular=s.edgeActivity("alternative").enteredVph;
  s.setEvent({id:"acc",kind:"accident",edgeId:"acc-road",offsetM:500,lengthM:100,
    closedLanes:[0,1,2],speedKmh:0,shoulder:"normal",hasShoulder:false});
  for(let i=0;i<30;i++)s.advance(12);
  assert.ok(s.edgeActivity("alternative").enteredVph>regular*1.3,JSON.stringify({regular,alt:s.edgeActivity("alternative"),acc:s.edgeActivity("acc-road"),accounting:s.detourRouteAccounting()}));
  assert.ok(s.detourRouteAccounting().some(a=>a.terminalEdgeId==="after"&&a.arrived>100&&Math.abs(a.residual)<1e-6));
  conservation(s.totals());
});

test("a congested transfer cannot turn waiting cars into through traffic or create a false diversion on the open motorway",async()=>{
  const s=(await engine())({roads:[
    ["approach","mainline","A3",3,[[50,7],[50,7.02]],"",1],
    ["straight","mainline","A3",3,[[50,7.02],[50,7.05]],"",2],
    ["branch","ramp","A48",1,[[50,7.02],[50.003,7.023]],"Überleitung",3],
    ["other","mainline","A48",2,[[50.003,7.023],[50.015,7.04]],"",4]
  ]});
  s.setSimulationStart(Date.parse("2026-11-13T12:00:00Z"));
  s.setDemandPercent(45);s.warmStart();
  for(let i=0;i<15;i++)s.advance(12);
  const regular=s.edgeActivity("straight").enteredVph;
  s.setEvent({id:"ramp-crash",edgeId:"branch",kind:"accident",offsetM:180,lengthM:100,
    closedLanes:[0],speedKmh:0,shoulder:"normal",hasShoulder:false});
  for(let i=0;i<20;i++)s.advance(12);
  const waiting=s.edgeActivity("approach").turnCommitments.find(x=>x.targetEdgeId==="branch");
  assert.ok(waiting?.vehicles>5,"blocked branch destinations remain individually committed: "+JSON.stringify(waiting));
  assert.ok(s.edgeActivity("straight").enteredVph>regular*.45,"through drivers retain usable service while the ramp backs up: "+JSON.stringify({regular,straight:s.edgeActivity("straight"),approach:s.edgeActivity("approach")}));
  assert.equal(s.edgeActivity("branch").divertedVehiclesOnEdge,0);
  assert.equal(s.totals().detouredVehicles,0);
  assert.ok(s.speed("branch")<20);
  conservation(s.totals());
  s.removeEvent("ramp-crash");s.setDemandPercent(10);
  for(let i=0;i<30;i++)s.advance(12);
  assert.ok(s.speed("branch")>50&&s.speed("approach")>65,"committed queues drain through the reopened branch");
  conservation(s.totals());
});

test("unrestricted theoretical capacity is not the operating capacity under dense traffic",async()=>{
  const make=await engine(),low=make(network()),high=make(network());
  for(const [s,demand] of [[low,15],[high,135]]){
    s.setSimulationStart(Date.parse("2026-11-13T15:51:00Z"));
    s.setDemandPercent(demand);s.warmStart();
    for(let i=0;i<30;i++)s.advance(12);
  }
  assert.equal(high.edgeActivity("a").capacityVph,6600);
  assert.ok(high.edgeActivity("a").operatingCapacityVph<low.edgeActivity("a").operatingCapacityVph);
  assert.ok(high.speed("a")<low.speed("a"));
  conservation(high.totals());conservation(low.totals());
});

test("ramps and mainline drain when demand falls while a closure remains active",async()=>{
  const s=(await engine())({roads:[
    ["up","mainline","A3",3,[[50,7],[50,7.012],[50,7.03]],"",1],
    ["blocked","mainline","A3",3,[[50,7.03],[50,7.05]],"",2],
    ["after","mainline","A3",3,[[50,7.05],[50,7.058],[50,7.09]],"",3],
    ["off","ramp","A3",1,[[50,7.012],[50.012,7.012]],"AS 1 · Abfahrt",4],
    ["in","ramp","A3",1,[[50.006,7.058],[50,7.058]],"AS 2 · Auffahrt",5]
  ]});
  s.setSimulationStart(Date.parse("2026-11-13T15:51:00Z"));
  s.setDemandPercent(125);s.warmStart();
  s.setEvent({id:"full",kind:"closure",edgeId:"blocked",offsetM:0,lengthM:100,
    closedLanes:[0,1,2],speedKmh:0,shoulder:"normal",hasShoulder:false});
  for(let i=0;i<30;i++)s.advance(12);
  const peak=s.edgeActivity("off").vehicles;
  assert.ok(s.jamSummaries().length>0&&peak>5);
  s.setDemandPercent(3);
  for(let i=0;i<480;i++)s.advance(12);
  assert.ok(s.edgeActivity("off").vehicles<peak*.1,JSON.stringify({edge:s.edgeActivity("off"),totals:s.totals()}));
  assert.equal(s.jamSummaries().length,0);
  assert.equal(s.mode("blocked"),"closure");
  conservation(s.totals());
});

test("generic local roundabout with omitted public road is a usable exit, not an infinite ramp cycle",async()=>{
  const roads=[
    ["up","mainline","A4",3,[[50,7],[50,7.01],[50,7.03],[50,7.035]],"",1],
    ["blocked","mainline","A4",3,[[50,7.035],[50,7.06]],"",2],
    ["after","mainline","A4",3,[[50,7.06],[50,7.065],[50,7.09]],"",3],
    ["early","ramp","A4",1,[[50,7.01],[50.003,7.01]],"AS 1 · Abfahrt",4],
    ["exit","ramp","A4",1,[[50,7.03],[50.002,7.03]],"AS 2 · Abfahrt",5],
    ["entry","ramp","A4",2,[[50.002,7.03],[50.003,7.03]],"AS 2 · Rampenzweig",6],
    ["circle-a","ramp","A4",1,[[50.003,7.03],[50.0035,7.031],[50.004,7.03]],"AS 2 · Rampenzweig",7],
    ["circle-b","ramp","A4",1,[[50.004,7.03],[50.0035,7.029],[50.003,7.03]],"AS 2 · Rampenzweig",8],
    ["return","ramp","A4",1,[[50.003,7.065],[50,7.065]],"AS 3 · Auffahrt",9]
  ];
  const s=(await engine())({roads});
  assert.equal(s.edgeActivity("entry").boundaryExit,true);
  assert.equal(s.edgeActivity("entry").localDischargeVph,700);
  assert.equal(s.reachable("circle-a"),false,"no trapped circulation on the omitted public-road junction");
  s.setSimulationStart(Date.parse("2026-11-13T15:00:00Z"));s.warmStart();
  s.setEvent({id:"full",edgeId:"blocked",kind:"closure",offsetM:0,lengthM:100,
    closedLanes:[0,1,2],speedKmh:0,shoulder:"normal",hasShoulder:false});
  for(let i=0;i<5;i++)s.advance(12);
  assert.ok(s.detourPlans().some(p=>p.terminalEdgeId==="entry"&&p.reentryEdgeId==="return"));
  assert.ok(s.edgeActivity("entry").departedVph>100,JSON.stringify(s.edgeActivity("entry")));
  assert.equal(s.detourRouteAccounting().some(r=>r.terminalEdgeId==="early"&&r.assigned>0),false);
  conservation(s.totals());
  // The same geometry at an AK is not a public-road sink: its loops must
  // never become invented local exits merely because they are cyclic.
  const motorway=(await engine())({roads:roads.map(r=>[...r.slice(0,5),r[5].replace("AS 2","AK 2"),...r.slice(6)])});
  assert.equal(motorway.edgeActivity("entry").boundaryExit,false);
});

test("A3 Heumar–Köln-Ost closes the A59 exactly from AD Porz, including the whole trapped feeder",async()=>{
  const w={};
  for(const path of ["web/traffic-reference.js","web/legacy-geometry.js","web/offline-traffic.js"])
    runInNewContext(await readFile(path,"utf8"),{window:w});
  const sim=w.createLegacyTrafficScenario(w.STAU_LEGACY_GEOMETRY);
  const closure=sim.setEvent({id:"heumar-a3",edgeId:"A3-132624375",kind:"closure",
    closedLanes:[0,1,2],offsetM:3,lengthM:200,
    speedKmh:0,shoulder:"normal",hasShoulder:false});
  assert.match(closure.closureFrom,/A3 28 AD Köln-Heumar/);
  assert.match(closure.closureTo,/A3 27 AK Köln-Ost/);
  const a59=sim.closureBands("extra-a59-koeln");
  assert.equal(a59.length,1);
  assert.ok(Math.abs(a59[0].fromM-22940.907)<1,
    "closure starts at the real A559 diverge at AD Porz, not at the previous AS or Heumar");
  assert.ok(Math.abs(a59[0].toM-25954.604)<1,
    "entire A59 suffix (about 3 km) must be closed up to A3");
  assert.equal(sim.closureBands("extra-a59-bonn").length,0);
  assert.equal(sim.closureBands("extra-a559-gremberg").length,0);
  assert.equal(sim.movementBlocked("extra-a59-koeln","extra-a559-gremberg"),false,
    "Porz escape toward A559 remains open");
  assert.equal(sim.closureBands("extra-heumar-132618574").length,1,
    "Rath entrance that joins the A59 AFTER the last Porz exit closes");
  assert.equal(sim.closureBands("A3-26164974").length,0,
    "opposite A3 carriageway stays fully open");
  const approaching=sim.closureDistanceAhead("extra-a59-koeln",0,50000);
  assert.ok(Number.isFinite(approaching)&&approaching>0&&approaching<50000,
    "A59 traffic must recognize a downstream A3 closure before reaching the Heumar junction");
  assert.ok(sim.closureBands("A3-132624375").length>0,
    "A3 section beyond A59 join is physically closed");
  assert.equal(sim.movementBlocked("extra-a59-koeln","A3-132624375"),false,
    "vehicles already inside the closed A59 suffix evacuate through the closed A3");
  assert.ok(sim.closureAccessPoints().some(p=>p.edgeId==="extra-a59-koeln"&&
    Math.abs(p.offsetM-a59[0].fromM)<1),"access sign at the true Porz gate");
  for(const id of ["extra-heumar-132624422","extra-heumar-208913379",
    "extra-heumar-753544621"])
    assert.ok(sim.closureBands(id).length,"closed Köln-Ost exit including small fragments: "+id);
  for(const id of ["extra-heumar-132624449","extra-heumar-132614508",
    "extra-a4-aachen"])
    assert.equal(sim.closureBands(id).length,0,"open shared/opposite transfer stays available: "+id);
  sim.removeEvent("heumar-a3");
  assert.equal(sim.closureBands("extra-a59-koeln").length,0,"derived feeder reopens with event");
});

test("cars already inside a road closure evacuate, but a separate three-lane crash stops them",async()=>{
  const make=await engine();
  const roads={roads:[
    ["a","mainline","A3",3,[[50,7],[50,7.018]],"",11],
    ["b","mainline","A3",3,[[50,7.018],[50,7.058]],"",12]
  ]};
  const evacuated=make(structuredClone(roads));
  const crashed=make(structuredClone(roads));
  const date=Date.parse("2026-11-13T15:51:00Z");
  for(const sim of [evacuated,crashed]){
    sim.setSimulationStart(date);
    sim.warmStart();
    sim.setEvent({id:"road-closed",edgeId:"b",kind:"closure",
      offsetM:0,lengthM:2600,closedLanes:[0,1,2],speedKmh:0,
      hasShoulder:false,shoulder:"normal"});
  }
  crashed.setEvent({id:"full-crash",edgeId:"b",kind:"accident",
    offsetM:600,lengthM:100,closedLanes:[0,1,2],speedKmh:0,
    hasShoulder:false,shoulder:"normal"});
  for(let i=0;i<3;i++){
    evacuated.advance(12);
    crashed.advance(12);
  }
  const freeExit=evacuated.edgeActivity("b",620).sectionVph;
  const crashExit=crashed.edgeActivity("b",620).sectionVph;
  assert.ok(freeExit>100,"existing cars can leave a closed but physically clear road");
  assert.ok(crashExit<1,"a full lane-blocking accident prevents internal evacuation traffic");
  conservation(evacuated.totals());conservation(crashed.totals());
});

test("a pre-existing car on an administratively blocked feeder ramp clears the corridor instead of staying at its red-white gate",async()=>{
  const model=(await engine())({roads:[
    ["a","mainline","A3",3,[[50,7],[50,7.02]],"",11],
    ["b","mainline","A3",3,[[50,7.02],[50,7.05]],"",12],
    ["on","ramp","A3",1,[[50.006,7.018],[50,7.02]],"AS 1 Beispiel · Auffahrt auf A3",13]
  ]});
  model.setSimulationStart(Date.parse("2026-11-13T15:51:00Z"));
  for(let i=0;i<12;i++)model.advance(12);
  assert.ok(model.edgeActivity("on").vehicles>0,"the on-ramp contained traffic before the administrative closure");
  model.setEvent({id:"close-b",edgeId:"b",kind:"closure",
    closedLanes:[0,1,2],offsetM:0,lengthM:2000,speedKmh:0,
    hasShoulder:false,shoulder:"normal"});
  assert.ok(model.closureBands("on").length>0,"the exclusive feeder must close to *new* entrants");
  const before=model.edgeActivity("on").vehicles;
  for(let i=0;i<15;i++)model.advance(12);
  assert.ok(model.edgeActivity("on").vehicles<before*.2,
    "existing ramp traffic must be allowed to clear into the administratively closed, physically free corridor");
  conservation(model.totals());
});

test("real OSM exit plus downstream real OSM on-ramp allow a conserved timed diversion with reentry",async()=>{
  const model=(await engine())({roads:[
    ["a","mainline","A3",3,[[50,7],[50,7.012],[50,7.020]],"",11],
    ["b","mainline","A3",3,[[50,7.020],[50,7.040]],"",12],
    ["c","mainline","A3",3,[[50,7.040],[50,7.048],[50,7.070]],"",13],
    ["out","ramp","A3",1,[[50,7.012],[50.005,7.019]],"AS 1 Beispiel · Abfahrt von A3",14],
    ["in","ramp","A3",1,[[50.005,7.048],[50,7.048]],"AS 2 Beispiel · Auffahrt auf A3",15]
  ]});
  model.setSimulationStart(Date.parse("2026-11-13T15:51:00Z"));
  model.warmStart();
  model.setEvent({id:"close-b",edgeId:"b",kind:"closure",
    closedLanes:[0,1,2],offsetM:0,lengthM:1100,speedKmh:0,
    hasShoulder:false,shoulder:"normal"});
  model.advance(12);
  const plans=model.detourPlans();
  assert.ok(plans.some(p=>p.terminalEdgeId==="out"&&p.reentryEdgeId==="in"),
    "the diversion requires two real imported OSM access ramps, not fabricated geometry");
  for(let i=0;i<28;i++)model.advance(12);
  assert.ok(model.totals().detouredVehicles>10,"cars actually leave via the real exit");
  assert.ok(model.totals().vehiclesOnDetours>0,"travel time is conserved outside the displayed model");
  conservation(model.totals());
  for(let i=0;i<24;i++)model.advance(12);
  assert.ok(model.totals().returnedVehicles>5,"cars automatically return at the downstream real on-ramp");
  assert.ok(model.edgeActivity("in").enteredVph>0);
  conservation(model.totals());
});

test("traffic uses FIRST lawful post-closure on-ramp by default; farther OD groups return later with conservation",async()=>{
  const sim=(await engine())({roads:[
    ["up","mainline","A3",3,[[50,7],[50,7.012],[50,7.020]],"",11],
    ["closed","mainline","A3",3,[[50,7.020],[50,7.040]],"",12],
    ["after","mainline","A3",3,[[50,7.040],[50,7.046],[50,7.056],[50,7.066],[50,7.080]],"",13],
    ["off","ramp","A3",1,[[50,7.012],[50.006,7.014]],"AS 10 Test-Ausfahrt · Abfahrt von A3",14],
    ["near","ramp","A3",1,[[50.006,7.046],[50,7.046]],"AS 11 Direkt dahinter · Auffahrt auf A3",15],
    ["far","ramp","A3",1,[[50.006,7.056],[50,7.056]],"AS 12 Weiterfahrt · Auffahrt auf A3",16],
    ["farthest","ramp","A3",1,[[50.006,7.066],[50,7.066]],"AS 13 Fernziel · Auffahrt auf A3",17]
  ]});
  sim.setSimulationStart(Date.parse("2026-11-13T15:51:00Z"));
  sim.warmStart();
  sim.setEvent({id:"closure",edgeId:"closed",kind:"closure",
    offsetM:0,lengthM:1100,closedLanes:[0,1,2],speedKmh:0,
    hasShoulder:false,shoulder:"normal"});
  sim.advance(1);
  const plan=sim.detourPlans().find(p=>p.terminalEdgeId==="off");
  assert.ok(plan,"real upstream exit must be used");
  assert.equal(plan.reentryEdgeId,"near","default return must be at the NEXT motorway entrance");
  assert.equal(plan.reentries.length,3);
  assert.deepEqual(Array.from(plan.reentries,x=>x.edgeId),["near","far","farthest"]);
  assert.equal(plan.reentries[0].weight,1,
    "without real OD data ALL through traffic returns at the first lawful AS");
  assert.equal(plan.reentries[1].weight,0);
  assert.equal(plan.reentries[2].weight,0);
  assert.ok(Math.abs(plan.reentries.reduce((n,x)=>n+x.weight,0)-1)<1e-10);
  for(let i=0;i<100;i++)sim.advance(12);
  assert.ok(sim.totals().detouredVehicles>20);
  assert.ok(sim.totals().returnedVehicles>10);
  assert.ok(sim.edgeActivity("near").enteredVph>0||
    sim.edgeActivity("far").enteredVph>0);
  assert.ok(sim.totals().vehiclesOnDetours>=0);
  conservation(sim.totals());
});

test("detoured trips survive a second closure of their planned return ramp",async()=>{
  const s=(await engine())({roads:[
    ["up","mainline","A3",3,[[50,7],[50,7.012],[50,7.02]],"",1],
    ["closed","mainline","A3",3,[[50,7.02],[50,7.04]],"",2],
    ["after","mainline","A3",3,[[50,7.04],[50,7.046],[50,7.056],[50,7.08]],"",3],
    ["exit","ramp","A3",1,[[50,7.012],[50.006,7.012]],"AS 1 · Abfahrt",4],
    ["near","ramp","A3",1,[[50.006,7.046],[50,7.046]],"AS 2 · Auffahrt",5],
    ["far","ramp","A3",1,[[50.006,7.056],[50,7.056]],"AS 3 · Auffahrt",6]
  ]});
  s.setSimulationStart(Date.parse("2026-11-13T12:00:00Z"));s.warmStart();
  s.setEvent({id:"primary",kind:"closure",edgeId:"closed",offsetM:0,lengthM:100,
    closedLanes:[0,1,2],speedKmh:0,shoulder:"normal",hasShoulder:false});
  for(let i=0;i<7;i++)s.advance(12);
  assert.ok(s.totals().vehiclesOnDetours>10);
  s.setEvent({id:"second",kind:"closure",edgeId:"near",offsetM:0,lengthM:100,
    closedLanes:[0],speedKmh:0,shoulder:"normal",hasShoulder:false});
  for(let i=0;i<60;i++)s.advance(12);
  assert.ok(s.totals().returnedVehicles>100);
  assert.ok(s.edgeActivity("near").enteredVph<1);
  assert.ok(s.edgeActivity("far").enteredVph>100);
  conservation(s.totals());
});

test("no identified downstream OSM entrance means no invented returning cars",async()=>{
  const model=(await engine())({roads:[
    ["a","mainline","A3",3,[[50,7],[50,7.012],[50,7.020]],"",11],
    ["b","mainline","A3",3,[[50,7.020],[50,7.040]],"",12],
    ["out","ramp","A3",1,[[50,7.012],[50.005,7.019]],"AS 1 Beispiel · Abfahrt von A3",14]
  ]});
  model.setSimulationStart(Date.parse("2026-11-13T15:51:00Z"));
  model.setEvent({id:"close-b",edgeId:"b",kind:"closure",
    closedLanes:[0,1,2],offsetM:0,lengthM:1100,speedKmh:0,
    hasShoulder:false,shoulder:"normal"});
  for(let i=0;i<25;i++)model.advance(12);
  assert.equal(model.detourPlans().length,0,"without a mapped downstream ramp there is no reentry plan");
  assert.equal(model.totals().returnedVehicles,0);
  assert.equal(model.totals().vehiclesOnDetours,0);
  conservation(model.totals());
});

test("AD Dernbach A3 Frankfurt closure closes FULL A48 to Frankfurt ramp and blocks A48 approach, not open Köln ramp",async()=>{
  const w={};
  for(const path of ["web/traffic-reference.js","web/legacy-geometry.js","web/offline-traffic.js"])
    runInNewContext(await readFile(path,"utf8"),{window:w});
  const data=w.STAU_LEGACY_GEOMETRY;
  const sim=w.createLegacyTrafficScenario(data);
  sim.setSimulationStart(Date.parse("2026-11-14T17:00:00Z"));
  const closure=sim.setEvent({id:"dernbach-frankfurt",edgeId:"A3-232272183",kind:"closure",
    offsetM:50,lengthM:200,closedLanes:[0,1,2],speedKmh:0,
    shoulder:"normal",hasShoulder:false});
  assert.match(closure.closureFrom,/A3 39 AD Dernbach/);
  assert.match(closure.closureTo,/A3 40 Montabaur/);
  const frankfurt="ramp-a48-to-frankfurt",koeln="ramp-a48-to-koeln";
  const parts=data.roads.filter(x=>x[0]===frankfurt||x[0].startsWith(frankfurt+"-"));
  assert.equal(parts.length,2);
  assert.deepEqual(Array.from(parts,p=>p[3]),[2,1],"actual lane drop on the Frankfurt ramp");
  for(const part of parts){
    const fullLength=sim.edgeActivity(part[0]).lengthM,bands=sim.closureBands(part[0]);
    assert.equal(bands.length,1,"one full red-white band on each ramp segment");
    assert.ok(bands[0].fromM<.05&&bands[0].toM>fullLength-2,
      "entire Frankfurt ramp from the A48 split to its A3 merge must be closed: "+part[0]);
  }
  assert.equal(sim.closureBands(koeln).length,0,
    "the independent turn A48 to A3 Köln remains open");
  assert.equal(sim.movementBlocked("A48-127602519",frankfurt),true,
    "A48 traffic may not enter the closed ramp at the Dernbach fork");
  assert.equal(sim.movementBlocked("A48-127602519",koeln),false,
    "legal A48 to Köln exit remains available");
  assert.equal(sim.closureExposureAhead(frankfurt),1,
    "physical Frankfurt connector leads only into the closed destination");
  assert.equal(sim.closureExposureAhead(koeln),0,
    "physical Köln connector reaches an open destination");
  const splitRisk=sim.closureExposureAhead("A48-127602519");
  assert.ok(splitRisk>.2&&splitRisk<.8,
    "A48 approach must foresee closed Frankfurt vs OPEN Köln ramps; risk "+splitRisk);
  const approaching=sim.closureExposureAhead("A48-224110323");
  assert.ok(approaching>.2&&approaching<.8,
    "A48 traffic near AS Höhr-Grenzhausen must anticipate Frankfurt closure "+
    "before the final AD Dernbach fork, risk "+approaching);
  sim.warmStart();
  sim.advance(1);
  const plans=sim.detourPlans();
  assert.ok(plans.some(p=>/extra-heumar-/.test(p.terminalEdgeId)&&
    /extra-heumar-/.test(p.reentryEdgeId)),
    "a real early A48 exit must be offered as a detour to real A3 after closure; "+
    JSON.stringify(plans.slice(0,8)));
  const initial=sim.edgeActivity(frankfurt).vehicles;
  for(let i=0;i<9;i++)sim.advance(12);
  assert.ok(sim.edgeActivity(frankfurt).vehicles<Math.max(.2,initial*.1),
    "cars already on the ramp must evacuate rather than form a permanent queue");
  assert.ok(sim.jamSummaries().every(x=>x.edgeId!==frankfurt),
    "no phantom jam at the administrative ramp closure");
  conservation(sim.totals());
});

test("real Montabaur full closure identifies real upstream ramp and downstream motorway reentry",async()=>{
  const w={};
  for(const path of ["web/traffic-reference.js","web/legacy-geometry.js","web/offline-traffic.js"])
    runInNewContext(await readFile(path,"utf8"),{window:w});
  const sim=w.createLegacyTrafficScenario(w.STAU_LEGACY_GEOMETRY);
  sim.setSimulationStart(Date.parse("2026-11-13T15:51:00Z"));
  const event=sim.setEvent({id:"full-montabaur",edgeId:"A3-232272183",
    kind:"closure",closedLanes:[0,1,2],offsetM:50,lengthM:200,
    speedKmh:0,hasShoulder:false,shoulder:"normal"});
  assert.match(event.closureFrom,/A3 39 AD Dernbach/);
  assert.match(event.closureTo,/A3 40 Montabaur/);
  sim.advance(1);
  const options=sim.detourPlans();
  assert.ok(options.some(p=>p.closureId==="full-montabaur"&&
    /extra-heumar-/.test(p.terminalEdgeId)&&/extra-heumar-/.test(p.reentryEdgeId)),
    "a real Ransbach/Montabaur exit and an OSM on-ramp beyond the closure must form a valid detour; available plans: "+
    JSON.stringify(options.slice(0,6)));
  conservation(sim.totals());
});

test("real A3 Heumar to Köln-Ost closure does not invent a local entrance at the motorway cross",async()=>{
  const w={};
  for(const path of ["web/traffic-reference.js","web/legacy-geometry.js","web/offline-traffic.js"])
    runInNewContext(await readFile(path,"utf8"),{window:w});
  const sim=w.createLegacyTrafficScenario(w.STAU_LEGACY_GEOMETRY);
  sim.setSimulationStart(Date.parse("2026-11-13T15:51:00Z"));
  const event=sim.setEvent({id:"koeln-heumar",edgeId:"A3-132624375",
    kind:"closure",closedLanes:[0,1,2],offsetM:3,lengthM:200,
    speedKmh:0,hasShoulder:false,shoulder:"normal"});
  assert.match(event.closureFrom,/A3 28 AD Köln-Heumar/);
  assert.match(event.closureTo,/A3 27 AK Köln-Ost/);
  sim.advance(1);
  const plans=sim.detourPlans();
  const byId=new Map(w.STAU_LEGACY_GEOMETRY.roads.map(r=>[r[0],r]));
  for(const p of plans.filter(x=>x.closureId==="koeln-heumar"))
    for(const entry of p.reentries)
      assert.doesNotMatch(byId.get(entry.edgeId)[5].split(" · ")[0],/\b(?:AK|AD)\b/);
  assert.ok(!plans.some(p=>p.reentryEdgeId==="extra-heumar-208913377"),
    "the Köln-Ost transfer is not a proven local-road entrance in this extract");
  conservation(sim.totals());
});

test("simultaneous Heumar north/south closures seal A4 from Gremberg and only use real local entries",async()=>{
  const w={};
  for(const path of ["web/traffic-reference.js","web/legacy-geometry.js","web/offline-traffic.js"])
    runInNewContext(await readFile(path,"utf8"),{window:w});
  const sim=w.createLegacyTrafficScenario(w.STAU_LEGACY_GEOMETRY);
  const close=(id,edgeId,offsetM)=>sim.setEvent({id,edgeId,offsetM,kind:"closure",
    closedLanes:[0,1,2],lengthM:200,speedKmh:0,shoulder:"normal",hasShoulder:false});
  close("north","A3-132614491",20);
  const gate=()=>Math.min(...sim.closureBands("extra-a4-olpe").map(x=>x.fromM));
  const single=gate();
  close("south","A3-318531283",150);
  assert.ok(Math.abs(gate()-15626.576)<1,"last remaining exit is at Gremberg");
  assert.ok(single-gate()>1700,"two closures must extend the A4 gate upstream");
  assert.equal(sim.closureBands("extra-a4-aachen").length,0,"opposite direction remains open");
  sim.advance(1);
  const plans=sim.detourPlans();
  assert.ok(plans.some(p=>p.reentryEdgeId==="extra-heumar-29242778"),
    "A3 Frankfurt reentry at genuine AS Königsforst");
  const byId=new Map(w.STAU_LEGACY_GEOMETRY.roads.map(r=>[r[0],r]));
  for(const plan of plans)for(const entry of plan.reentries)
    assert.doesNotMatch(byId.get(entry.edgeId)[5].split(" · ")[0],/\b(?:AK|AD)\b/);
  sim.removeEvent("south");
  assert.equal(gate(),single,"removing one event restores its independent open branch");
  conservation(sim.totals());
});

test("A59 Köln-Heumar full closure starts AFTER the last A4 Aachen escape, not at the junction label",async()=>{
  const w={};
  for(const path of ["web/traffic-reference.js","web/legacy-geometry.js","web/offline-traffic.js"])
    runInNewContext(await readFile(path,"utf8"),{window:w});
  const sim=w.createLegacyTrafficScenario(w.STAU_LEGACY_GEOMETRY);
  // Exactly the old persisted 200-m event: must auto-upgrade to full corridor.
  const event=sim.setEvent({id:"old-short",edgeId:"extra-a59-bonn",
    kind:"closure",closedLanes:[0,1,2],offsetM:950,lengthM:200,
    speedKmh:0,shoulder:"normal",hasShoulder:false});
  assert.match(event.closureFrom,/A59 31 AD Köln-Heumar/);
  assert.match(event.closureTo,/A59 32 Rath/);
  assert.ok(event.coveredLengthM>1700&&event.coveredLengthM<1750);
  assert.equal(event.offsetM,950,
    "keep user's originally tapped point rather than moving the event icon");
  const span=sim.closureBands("extra-a59-bonn")[0];
  assert.ok(Math.abs(span.fromM-507.736)<1,"last A4 branch is the true gate");
  assert.ok(span.toM-span.fromM>1700,"all 1.7 km must have red-white overlay");
  assert.equal(sim.closureBands("extra-a59-koeln").length,0,
    "opposite direction must remain open");
  assert.equal(sim.movementBlocked("A3-258495162","extra-a59-bonn"),false,
    "shared A3 approach to A4 Aachen stays accessible before the closure gate");
  assert.equal(sim.movementBlocked("extra-a59-bonn","extra-a4-aachen"),false,
    "direct A4 Aachen exit at the closure gate remains usable");
  assert.equal(sim.closureBands("extra-a4-aachen").length,0);
  assert.equal(sim.closureBands("extra-heumar-328948525").length,0,
    "A59 Wahn ramp far downstream must NOT be closed merely due to shared OSM Way");
  assert.ok(sim.closureBands("extra-heumar-132618673").length>0,
    "downstream Rath EXIT is inside the blocked corridor and must close");
  assert.equal(sim.closureBands("extra-heumar-132618574").length,0,
    "opposite-direction Rath on-ramp remains open");
  const normal=sim.recommendedClosureLength("extra-a59-bonn",950);
  assert.equal(normal.lengthM,1716);
});
test("A3 Köln-Ost to Heumar motorway closure covers all connected Ways and feeder ramps",async()=>{
  const w={};
  for(const path of ["web/traffic-reference.js","web/legacy-geometry.js","web/offline-traffic.js"])
    runInNewContext(await readFile(path,"utf8"),{window:w});
  const sim=w.createLegacyTrafficScenario(w.STAU_LEGACY_GEOMETRY);
  const event=sim.setEvent({id:"a3-full",edgeId:"A3-26164974",
    kind:"closure",closedLanes:[0,1,2],offsetM:460,lengthM:200,
    speedKmh:0,shoulder:"normal",hasShoulder:false});
  assert.match(event.closureFrom,/A3 27 AK Köln-Ost/);
  assert.match(event.closureTo,/A3 28 AD Köln-Heumar/);
  // Physical closure gates extend from the final exit fork to the first
  // subsequent on-ramp merge, not merely the two junction label centres.
  assert.ok(event.coveredLengthM>3500&&event.coveredLengthM<5500,
    "observed physical closure length: "+Math.round(event.coveredLengthM)+
    " metres; "+event.closureFrom+" -> "+event.closureTo);
  const closedWays=w.STAU_LEGACY_GEOMETRY.roads
    .filter(row=>row[1]==="mainline"&&sim.closureBands(row[0]).length);
  const closedRamps=w.STAU_LEGACY_GEOMETRY.roads
    .filter(row=>row[1]==="ramp"&&sim.closureBands(row[0]).length);
  assert.ok(closedWays.length>=15,"closure spans original A3 OSM Way splits");
  assert.ok(closedRamps.length>=1,"actual feeder ramp into this closed corridor is included");
  assert.ok(Math.abs(closedWays.reduce((sum,row)=>
    sum+sim.closureBands(row[0]).reduce((n,b)=>n+b.toM-b.fromM,0),0)-
    event.coveredLengthM)<1);
});

test("48 reversed A3/A48 OSM Ways are normalized into continuous directed motorway carriageways",async()=>{
  const w={};
  for(const path of ["web/traffic-reference.js","web/legacy-geometry.js","web/offline-traffic.js"])
    runInNewContext(await readFile(path,"utf8"),{window:w});
  const scenario=w.createLegacyTrafficScenario(w.STAU_LEGACY_GEOMETRY);
  assert.equal(scenario.normalizedReversedWays().length,48,
    "the old import left exact endpoint-connected motorway segments pointing backward");
  const main=w.STAU_LEGACY_GEOMETRY.roads.filter(r=>
    r[1]==="mainline"&&(r[2]==="A3"||r[2]==="A48"));
  assert.equal(main.length,970);
  assert.equal(main.filter(r=>scenario.reachable(r[0])).length,970,
    "real A3 and A48 OSM carriageways must not become dead-end subgraphs");
  assert.ok(scenario.sourceProfiles().some(p=>p.direction==="A48-koblenz"));
  assert.ok(scenario.sourceProfiles().some(p=>p.direction==="A48-dernbach"));
});
test("Saturday afternoon has no widespread phantom jams; real 2-of-3-lane accident creates an upstream queue",async()=>{
  const w={};
  for(const path of ["web/traffic-reference.js","web/legacy-geometry.js","web/offline-traffic.js"])
    runInNewContext(await readFile(path,"utf8"),{window:w});
  const s=w.createLegacyTrafficScenario(w.STAU_LEGACY_GEOMETRY);
  s.setSimulationStart(Date.parse("2026-11-14T13:00:00Z"));
  const warm=s.warmStart();
  assert.ok(warm.initialVehicles>1000,"old app's pre-existing traffic must occupy the network");
  assert.equal(warm.generatedVehicles,0,"warm start must not claim that vehicles spawned during simulation");
  const count=warm.initialVehicles;
  assert.equal(s.warmStart().initialVehicles,count,"warm start only once");
  conservation(s.totals());
  for(let i=0;i<25;i++)s.advance(12);
  assert.ok(s.jamSummaries().every(g=>g.lengthM<1000&&g.delayMin<10),
    "brief recurring junction congestion is allowed, but not widespread unexplained standstill");
  s.setEvent({id:"acc",edgeId:"A3-310863194",kind:"accident",
    closedLanes:[0,1],offsetM:0,lengthM:120,speedKmh:40,
    shoulder:"normal",hasShoulder:false});
  for(let i=0;i<25;i++)s.advance(12);
  const jams=s.jamSummaries();
  assert.ok(jams.some(j=>j.edgeId.startsWith("A3")&&j.lengthM>=350),
    "one remaining lane must cause a real Saturday queue upstream of Montabaur");
  assert.ok(s.edgeActivity("A3-310863194").enteredVph<=1550);
  conservation(s.totals());
});
test("a workzone plus a further accident can block the actual remaining motorway lanes",async()=>{
  const w={};
  for(const path of ["web/traffic-reference.js","web/legacy-geometry.js","web/offline-traffic.js"])
    runInNewContext(await readFile(path,"utf8"),{window:w});
  const s=w.createLegacyTrafficScenario(w.STAU_LEGACY_GEOMETRY);
  s.setSimulationStart(Date.parse("2026-11-14T13:00:00Z"));
  s.warmStart();
  s.setEvent({id:"works",edgeId:"A3-310863194",kind:"roadworks",
    closedLanes:[0],offsetM:0,lengthM:300,speedKmh:80,
    shoulder:"normal",hasShoulder:false});
  s.setEvent({id:"acc",edgeId:"A3-310863194",kind:"accident",
    closedLanes:[1,2],offsetM:0,lengthM:100,speedKmh:40,
    shoulder:"normal",hasShoulder:false});
  for(let i=0;i<30;i++)s.advance(12);
  assert.ok(s.jamSummaries().some(x=>x.lengthM>600&&(x.delayMin===null||x.delayMin>=1)),
    "closed remaining lanes must stop real flow and form a substantial upstream queue");
  assert.ok(s.edgeActivity("A3-310863194").enteredVph<50,
    "all three lanes are blocked collectively, not separately treated as two open events");
  conservation(s.totals());
});
test("previously failing five-metre AS fragments now resolve full motorway sections including Bonn Auerberg",async()=>{
  const w={};
  for(const path of ["web/traffic-reference.js","web/legacy-geometry.js","web/offline-traffic.js"])
    runInNewContext(await readFile(path,"utf8"),{window:w});
  const s=w.createLegacyTrafficScenario(w.STAU_LEGACY_GEOMETRY);
  for(const {id,offset,from,to,minLength} of [
    {id:"A3-23478515",offset:0,from:/A3 43 Limburg-Süd/,to:/A3 44 Bad Camberg/,minLength:14000},
    {id:"A3-232272183",offset:50,from:/A3 39 AD Dernbach/,to:/A3 40 Montabaur/,minLength:5000},
    {id:"A48-24351899",offset:150,from:/A48 9 AK Koblenz/,to:/A48 10 Koblenz-Nord/,minLength:5000},
    {id:"extra-a565-siegburg",offset:1800,from:/A565 3 Bonn-Auerberg/,
      to:/A565 2 Bonn-Beuel-Nord/,minLength:1600}
  ]){
    const road=w.STAU_LEGACY_GEOMETRY.roads.find(r=>r[0]===id);
    const event=s.setEvent({id:"as_"+id,edgeId:id,kind:"closure",
      offsetM:offset,lengthM:5,closedLanes:Array.from({length:road[3]},(_,i)=>i),
      speedKmh:0,hasShoulder:false,shoulder:"normal"});
    assert.match(event.closureFrom,from);
    assert.match(event.closureTo,to);
    assert.ok(event.coveredLengthM>=minLength,
      "never save a five-metre closure when actual AS-to-AS corridor exists");
    assert.equal(event.truncated,false);
  }
});

test("Dernbach Frankfurt: Ransbach from both A3 and A48, Höhr fallback after primary exit, Montabaur reentry",async()=>{
  const w={};
  for(const path of ["web/traffic-reference.js","web/legacy-geometry.js","web/offline-traffic.js"])
    runInNewContext(await readFile(path,"utf8"),{window:w});
  const sim=w.createLegacyTrafficScenario(w.STAU_LEGACY_GEOMETRY);
  sim.setSimulationStart(Date.parse("2026-11-13T15:51:00Z"));
  sim.warmStart();
  sim.setEvent({id:"full-montabaur",edgeId:"A3-232272183",
    kind:"closure",closedLanes:[0,1,2],offsetM:50,lengthM:200,
    speedKmh:0,hasShoulder:false,shoulder:"normal"});
  sim.advance(1);
  const plans=sim.detourPlans();
  for(const terminal of ["extra-heumar-8298586","extra-heumar-4452557","extra-heumar-25149856"])
    assert.ok(plans.some(p=>p.terminalEdgeId===terminal&&p.reentryEdgeId==="extra-heumar-243834109"),
      "physical exit "+terminal+" must return at the first open Montabaur AS");
  assert.ok(sim.designatedDetourRoutes("full-montabaur").some(s=>/A48.*Ransbach-Baumbach.*Montabaur/.test(s)));
  let initialFallbackAssigned=0;
  for(let i=0;i<22;i++){
    sim.advance(12);
    if(i===14)initialFallbackAssigned=sim.detourRouteAccounting().find(x=>
      x.terminalEdgeId==="extra-heumar-25149856")?.assigned??0;
  }
  const ransbach=sim.edgeActivity("extra-heumar-8298586");
  assert.equal(ransbach.localDischargeVph,700);
  assert.ok(ransbach.departedVph>550&&ransbach.departedVph<=705,"finite local junction discharge");
  assert.ok(sim.edgeActivity("ramp-a3-to-a48-from-koeln").enteredVph>100,"Koblenz-bound traffic continues");
  const transfer=sim.edgeActivity("ramp-a48-to-koeln"),northExit=sim.edgeActivity("extra-heumar-4452557");
  assert.ok(transfer.divertedVehiclesOnEdge>1&&transfer.divertedVehiclesOnEdge<transfer.vehicles*.9,
    "only Frankfurt-bound portion of A48 is diverted; Köln-bound traffic remains normally routed");
  assert.ok(northExit.divertedVehiclesOnEdge>1&&northExit.departedVph<=705&&northExit.departedVph>550,
    "A48 diversions actually exit at northbound Ransbach under finite capacity");
  assert.ok(northExit.storageVehicles>ransbach.storageVehicles,"longer physical ramp stores more cars");
  // Colour reflects actual queue density, NOT capacity utilisation alone.
  // A ramp that discharges about 700 vph without accumulating vehicles can
  // remain green; an overflowing ramp must display its measured standstill.
  assert.ok(sim.visualBands("extra-heumar-8298586")
    .some(b=>b.color==="jam"||b.color==="standstill"),
    "the genuinely queued Ransbach exit must be rendered red");
  const northState=sim.edgeActivity("extra-heumar-4452557");
  if(northState.vehicles>northState.storageVehicles*.5)
    assert.ok(sim.visualBands("extra-heumar-4452557")
      .some(b=>b.color==="jam"||b.color==="standstill"),
      "a physically stored A48 queue must display its measured congestion");
  else assert.ok(northState.departedVph>550,
    "a free-flowing A48 exit may be green while serving normal discharge");
  assert.ok(sim.edgeActivity("extra-heumar-25149856").enteredVph>100,"vehicles already beyond Ransbach exit via the actual Höhr AS");
  assert.ok(sim.jamSummaries().some(g=>g.endEdgeId==="A3-326138758"&&g.lengthM>500),
    "saturated local exit spills back onto A3");
  const queue=sim.jamSummaries().find(g=>g.endEdgeId==="A3-326138758");
  assert.equal(sim.queueRoadInfo(queue).direction,"A3-frankfurt");
  assert.match(sim.queueRoadInfo(queue).location,/Dierdorf.*Ransbach-Baumbach/);
  assert.match(sim.queueRoadInfo(queue).bottleneck,/Ransbach-Baumbach/);
  assert.ok(sim.totals().returnedVehicles>0);
  const accounting=sim.detourRouteAccounting();
  const signed=accounting.find(x=>x.terminalEdgeId==="extra-heumar-4452557");
  assert.ok(signed&&signed.assigned>100&&signed.arrived>50,
    "Frankfurt transfer vehicles must reach their assigned physical Ransbach exit");
  assert.ok(signed.arrived+signed.remaining>100);
  for(const route of accounting)assert.ok(Math.abs(route.residual)<1e-6,
    "assigned vehicles must reach their own exit or remain visibly in the corridor");
  const fallback=accounting.find(x=>x.terminalEdgeId==="extra-heumar-25149856");
  assert.ok(initialFallbackAssigned>0&&fallback&&Math.abs(fallback.assigned-initialFallbackAssigned)<1e-6,
    "once traffic already beyond Ransbach has evacuated, no new Frankfurt traffic may be sent to Höhr");
  assert.ok(sim.edgeActivity("extra-heumar-807709863").localSourceDetourFraction>0,
    "Frankfurt-bound origins at the signed exit start their bypass locally, not via Höhr");
  conservation(sim.totals());
});

test("simultaneous Diez and Dernbach closures never assign A48 Frankfurt traffic to the opposite Diez detour",async()=>{
  const w={};
  for(const path of ["web/traffic-reference.js","web/legacy-geometry.js","web/offline-traffic.js"])
    runInNewContext(await readFile(path,"utf8"),{window:w});
  const sim=w.createLegacyTrafficScenario(w.STAU_LEGACY_GEOMETRY);
  sim.setSimulationStart(Date.parse("2026-11-18T07:00:00Z"));
  sim.setDemandPercent(110);sim.warmStart();
  for(const [id,edgeId,offsetM] of [["diez","A3-326086102",10],["montabaur","A3-232272183",50]])
    sim.setEvent({id,edgeId,offsetM,kind:"closure",lengthM:100,closedLanes:[0,1,2],
      speedKmh:0,shoulder:"normal",hasShoulder:false});
  for(let i=0;i<40;i++)sim.advance(12);
  const plans=sim.detourPlans();
  assert.ok(sim.designatedDetourRoutes("montabaur").some(s=>/A48.*Ransbach-Baumbach.*Montabaur/.test(s)));
  assert.ok(plans.some(p=>p.terminalEdgeId==="extra-heumar-4452557"&&
    p.reentryEdgeId==="extra-heumar-243834109"&&p.closureId==="montabaur"));
  assert.ok(!plans.some(p=>p.closureId==="diez"&&
    ["extra-heumar-26923440","extra-heumar-25149856","extra-heumar-4452557"].includes(p.terminalEdgeId)),
    "unrelated opposite-direction closure must never claim these exits");
  assert.ok(sim.edgeActivity("extra-heumar-4452557").departedVph>600);
  assert.ok(sim.edgeActivity("extra-heumar-4452557").divertedVehiclesOnEdge>5);
  // A distant exit can become attractive before the queue reaches it. Its
  // detour must nevertheless rejoin beyond the correct closure.
  assert.ok(!plans.some(p=>p.terminalEdgeId==="extra-heumar-4007900"&&p.closureId==="montabaur"),
    "opposite-direction closure must not claim this exit");
  assert.ok(sim.totals().returnedVehicles>100);
  conservation(sim.totals());
});
test("Wednesday 06:30 Montabaur to Diez: initially no premature diversion, finite exit and motorway spillback",async()=>{
  const w={};
  for(const path of ["web/traffic-reference.js","web/legacy-geometry.js","web/offline-traffic.js"])
    runInNewContext(await readFile(path,"utf8"),{window:w});
  const sim=w.createLegacyTrafficScenario(w.STAU_LEGACY_GEOMETRY);
  sim.setSimulationStart(Date.parse("2026-11-18T04:45:00Z"));
  sim.warmStart();
  const evt=sim.setEvent({id:"full",edgeId:"A3-326086108",kind:"closure",closedLanes:[0,1,2],
    offsetM:5,lengthM:100,speedKmh:0,hasShoulder:false,shoulder:"normal"});
  assert.match(evt.closureFrom,/Montabaur/);assert.match(evt.closureTo,/Diez/);
  sim.advance(12);
  for(const id of ["extra-heumar-24492798","extra-heumar-25149856","extra-heumar-8298586"])
    assert.ok(sim.edgeActivity(id).divertedVehiclesOnEdge<1,id+" must not be used before a meaningful time advantage");
  for(let i=1;i<45;i++)sim.advance(12);
  assert.equal(sim.totals().simSeconds,2700);
  assert.ok(sim.edgeActivity("ramp-a48-to-frankfurt").departedVph>500,"A48 remains connected to Montabaur");
  assert.ok(sim.jamSummaries().some(g=>g.lengthM>=2500&&sim.queueRoadInfo(g).direction==="A3-frankfurt"&&
    /Dernbach.*Montabaur/.test(sim.queueRoadInfo(g).location)));
  const route=sim.detourRouteAccounting().find(r=>r.terminalEdgeId==="extra-heumar-30449934");
  assert.ok(route&&route.arrived>300&&Math.abs(route.residual)<1e-6);
  const terminal=route.terminalEdgeId,rates=new Set();
  for(let i=0;i<12;i++){sim.advance(1);rates.add(sim.edgeActivity(terminal).localDischargeRateVph);}
  assert.ok(rates.size>1&&Math.max(...rates)<=700,"variable junction discharge, not unlimited parallel ramp capacity");
  assert.ok(sim.edgeActivity("extra-heumar-259584301").departedVph>500,"Diez reentry remains open");
  conservation(sim.totals());
});
test("Neustadt/Wied to Bad Honnef: the last local roundabout exit works and earlier exits are time-dependent",async()=>{
  const w={};
  for(const path of ["web/traffic-reference.js","web/legacy-geometry.js","web/offline-traffic.js"])
    runInNewContext(await readFile(path,"utf8"),{window:w});
  const sim=w.createLegacyTrafficScenario(w.STAU_LEGACY_GEOMETRY);
  sim.setSimulationStart(Date.parse("2026-11-18T05:00:00Z"));sim.warmStart();
  const evt=sim.setEvent({id:"full",edgeId:"A3-326138752",kind:"closure",closedLanes:[0,1,2],
    offsetM:5,lengthM:100,speedKmh:0,hasShoulder:false,shoulder:"normal"});
  assert.match(evt.closureFrom,/Neustadt/);assert.match(evt.closureTo,/Bad Honnef/);
  const actualExit="extra-heumar-556849668",priorExit="extra-heumar-24492231";
  assert.equal(sim.edgeActivity(actualExit).boundaryExit,true);
  assert.equal(sim.closureBands("extra-heumar-4927299").length,0);
  assert.equal(sim.closureBands("extra-heumar-556852241").length,0);
  sim.advance(12);
  assert.ok(!sim.detourRouteAccounting().some(a=>a.terminalEdgeId===priorExit&&a.assigned>1),
    "before congestion the nearer lawful exit remains attractive");
  for(let i=1;i<30;i++)sim.advance(12);
  const accounts=sim.detourRouteAccounting(),route=accounts.find(a=>a.terminalEdgeId===actualExit);
  assert.ok(route&&route.arrived>250&&Math.abs(route.residual)<1e-6);
  assert.ok(accounts.every(a=>Math.abs(a.residual)<1e-6));
  assert.ok(sim.detourPlans().some(p=>p.terminalEdgeId===actualExit&&p.reentryEdgeId==="extra-heumar-556852241"));
  assert.ok(sim.edgeActivity(actualExit).departedVph>550);
  assert.ok(sim.jamSummaries().some(g=>/Neustadt\/Wied/.test(sim.queueRoadInfo(g).bottleneck||"")));
  conservation(sim.totals());
});
test("all named local exits in the imported network have a public-road boundary, including A59 Wahn",async()=>{
  const w={};
  for(const path of ["web/traffic-reference.js","web/legacy-geometry.js","web/offline-traffic.js"])
    runInNewContext(await readFile(path,"utf8"),{window:w});
  const sim=w.createLegacyTrafficScenario(w.STAU_LEGACY_GEOMETRY);
  const exits=w.STAU_LEGACY_GEOMETRY.roads.filter(r=>r[1]==="ramp"&&/\bAS\b.*· Abfahrt/.test(r[5])&&sim.hasEdge(r[0]));
  assert.ok(exits.length>=73);
  for(const r of exits){
    const terminal=sim.edgeActivity(r[0]).localExitTerminalId;
    assert.ok(terminal,r[5]+" has no actual external exit");
    assert.equal(sim.edgeActivity(terminal).boundaryExit,true,r[5]);
  }
  sim.setSimulationStart(Date.parse("2026-11-18T05:00:00Z"));sim.warmStart();
  const evt=sim.setEvent({id:"full",edgeId:"extra-a59-bonn",kind:"closure",closedLanes:[0,1,2],
    offsetM:8500,lengthM:100,speedKmh:0,hasShoulder:false,shoulder:"normal"});
  assert.match(evt.closureFrom,/Wahn/);assert.match(evt.closureTo,/Lind/);
  for(let i=0;i<15;i++)sim.advance(12);
  const terminals=["extra-heumar-315516300","extra-heumar-10526454"];
  assert.ok(sim.detourRouteAccounting().some(a=>terminals.includes(a.terminalEdgeId)&&a.arrived>50));
  assert.ok(sim.detourPlans().some(p=>terminals.includes(p.terminalEdgeId)&&p.closureId==="full"));
  conservation(sim.totals());
});
test("nonzero queue speeds produce harmonic average speed and a consistent travel delay",async()=>{
  const sim=(await engine())({roads:[
    ["a","mainline","A3",3,[[50,7],[50,7.012]],"",1],
    ["b","mainline","A3",3,[[50,7.012],[50,7.024]],"",2],
    ["c","mainline","A3",3,[[50,7.024],[50,7.036]],"",3]
  ]});
  sim.setSimulationStart(Date.parse("2026-11-13T15:51:00Z"));
  sim.setDemandPercent(150);
  sim.setEvent({id:"accident",edgeId:"b",kind:"accident",closedLanes:[0,1],
    offsetM:0,lengthM:200,speedKmh:40,shoulder:"normal",hasShoulder:false});
  for(let i=0;i<20;i++)sim.advance(12);
  const jam=sim.jamSummaries().find(g=>g.delayMin!==null&&g.meanKmh>1);
  assert.ok(jam,"finite speed queue expected");
  assert.ok(Math.abs(jam.delayMin-(jam.lengthM/1000*60*(1/jam.meanKmh-1/120)))<.001);
});

test("short auxiliary lane islands do not inflate motorway through capacity",async()=>{
  const data={roads:[
    ["a","mainline","A48",2,[[50,7],[50,7.012]],"",1],
    ["b","mainline","A48",3,[[50,7.012],[50,7.015]],"",2],
    ["c","mainline","A48",3,[[50,7.015],[50,7.018]],"",3],
    ["d","mainline","A48",2,[[50,7.018],[50,7.031]],"",4],
    ["e","mainline","A48",3,[[50,7.031],[50,7.06]],"",5]
  ]};
  const sim=(await engine())(data);
  assert.equal(sim.edgeActivity("b").capacityVph,4400);
  assert.equal(sim.edgeActivity("c").capacityVph,4400);
  assert.equal(sim.edgeActivity("e").capacityVph,6600);
  const oldClosure={id:"saved",edgeId:"b",kind:"closure",closedLanes:[0,1,2],
    offsetM:0,lengthM:100,speedKmh:0,shoulder:"normal",hasShoulder:false};
  assert.throws(()=>sim.setEvent(oldClosure),/Fahrstreifen/);
  assert.equal(sim.restoreEvent(oldClosure).closedLanes.length,2);
});

test("Dernbach Köln closure: A48 has lawful bypass choices returning beyond Ransbach",async()=>{
  const w={};
  for(const path of ["web/traffic-reference.js","web/legacy-geometry.js","web/offline-traffic.js"])
    runInNewContext(await readFile(path,"utf8"),{window:w});
  const sim=w.createLegacyTrafficScenario(w.STAU_LEGACY_GEOMETRY);
  sim.setSimulationStart(Date.parse("2026-11-13T15:51:00Z"));
  sim.setDemandPercent(180);sim.warmStart();
  const e=sim.setEvent({id:"north",edgeId:"A3-25993915",kind:"closure",
    offsetM:50,lengthM:100,closedLanes:[0,1,2],speedKmh:0,shoulder:"normal",hasShoulder:false});
  assert.match(e.closureFrom,/AD Dernbach/);assert.match(e.closureTo,/Ransbach/);
  for(let i=0;i<25;i++)sim.advance(12);
  const terminal="extra-heumar-26923440";
  const plans=sim.detourPlans().filter(p=>p.closureId==="north"&&p.reentryEdgeId==="extra-heumar-807709861");
  assert.ok(plans.some(p=>p.terminalEdgeId===terminal),"Höhr is a real possible bypass, not a fixed assignment");
  assert.ok(sim.detourRouteAccounting().some(a=>plans.some(p=>p.terminalEdgeId===a.terminalEdgeId)&&a.arrived>100));
  assert.ok(sim.edgeActivity(terminal).departedVph<=705);
  assert.ok(sim.edgeActivity("ramp-a48-to-koeln").enteredVph<1,"closed connector receives no new vehicles");
  assert.ok(sim.edgeActivity("extra-heumar-807709861").enteredVph>100,"bypass returns in the correct direction");
  assert.ok(sim.edgeActivity("ramp-a48-to-frankfurt").enteredVph>100);
  assert.ok(sim.jamSummaries().every(g=>Number.isFinite(g.delayMin)));
  conservation(sim.totals());
});

test("legacy service areas are removed even with misleading AS labels; genuine exits remain",async()=>{
  const w={};
  for(const path of ["web/traffic-reference.js","web/legacy-geometry.js","web/offline-traffic.js"])
    runInNewContext(await readFile(path,"utf8"),{window:w});
  const sim=w.createLegacyTrafficScenario(w.STAU_LEGACY_GEOMETRY);
  for(const id of [407503235,407503237,546687699,546687703,407502471,407502472,
    31056168,1512535542,384059762,407505963,38028821,38050873,
    372478868,372478869,536172766]){
    const rows=w.STAU_LEGACY_GEOMETRY.roads.filter(r=>r[6]===id);
    assert.ok(rows.length);
    for(const row of rows)assert.equal(sim.hasEdge(row[0]),false,row[0]);
  }
  for(const id of ["extra-heumar-5201206","extra-heumar-25149763",
    "extra-heumar-26923440","extra-heumar-8298586","extra-heumar-5217076"])
    assert.equal(sim.hasEdge(id),true,id);
  assert.ok(sim.totals().excludedRest>=52);
  assert.equal(sim.hasEdge("extra-turn-A3-frankfurt-to-A3-koeln-5217076"),false);
  assert.equal(sim.edgeActivity("extra-heumar-26923440").localDischargeVph,700);
});

test("Montabaur upstream one-lane incident does not block ordinary exit; Dernbach turns are directional",async()=>{
  const w={};
  for(const path of ["web/traffic-reference.js","web/legacy-geometry.js","web/offline-traffic.js"])
    runInNewContext(await readFile(path,"utf8"),{window:w});
  const sim=w.createLegacyTrafficScenario(w.STAU_LEGACY_GEOMETRY);
  sim.setSimulationStart(Date.parse("2026-11-13T15:00:00Z"));
  sim.warmStart();
  // Measure actual flows, not a rendered arrow or a configured ratio alone.
  for(let i=0;i<40;i++)sim.advance(12);
  const north=sim.edgeActivity("ramp-a3-to-a48-from-frankfurt").enteredVph;
  const south=sim.edgeActivity("ramp-a3-to-a48-from-koeln").enteredVph;
  assert.ok(north>south&&south>100,"wider northbound transfer carries more ordinary traffic, without imposing the former fixed ratio: "+north+" vs "+south);
  sim.setEvent({id:"upstream",edgeId:"A3-35484170",kind:"accident",
    offsetM:200,lengthM:100,closedLanes:[0,1],speedKmh:40,shoulder:"normal",hasShoulder:false});
  for(let i=0;i<80;i++)sim.advance(12);
  const local=sim.edgeActivity("extra-heumar-23608535");
  assert.ok(local.departedVph>30&&local.departedVph<700,"local B255 exit remains usable");
  assert.ok(sim.speed("extra-heumar-5201206")>30,"upstream accident must not create false exit gridlock");
  assert.ok(sim.edgeActivity("extra-heumar-310778679").enteredVph<1,
    "ordinary exit traffic must not be routed back onto the motorway");
  conservation(sim.totals());
});

test("Dernbach Frankfurt: actual lane drop, no forced turn on an open A3, old events remain restorable",async()=>{
  const w={};
  for(const path of ["web/traffic-reference.js","web/legacy-geometry.js","web/offline-traffic.js"])
    runInNewContext(await readFile(path,"utf8"),{window:w});
  const sim=w.createLegacyTrafficScenario(w.STAU_LEGACY_GEOMETRY);
  const entry="ramp-a48-to-frankfurt",tail=entry+"-75746365";
  const head=sim.edgeActivity(entry),last=sim.edgeActivity(tail);
  assert.equal(head.capacityVph,3000);
  assert.equal(last.capacityVph,1500);
  assert.ok(head.lengthM>1000&&last.lengthM>400);
  assert.equal(sim.restoreEvent({id:"old-ramp",edgeId:entry,kind:"closure",
    offsetM:head.lengthM+20,lengthM:100,closedLanes:[0],speedKmh:0,shoulder:"normal"}).edgeId,tail);
  assert.ok(sim.closureBands(entry).length&&sim.closureBands(tail).length);
  sim.removeEvent("old-ramp");
  sim.setSimulationStart(Date.parse("2026-11-18T10:00:00Z"));sim.warmStart();
  for(let i=0;i<15;i++)sim.advance(12);
  const south="ramp-a3-to-a48-from-koeln";
  assert.ok(sim.speed("A3-232272183")>65,"A3 southbound remains free");
  assert.ok(sim.edgeActivity("A3-232272183").sectionVph>2000,"through traffic actually continues to Montabaur");
  assert.ok(sim.edgeActivity(south).enteredVph<1000,"ordinary Koblenz traffic only");
  assert.equal(sim.edgeActivity(south).divertedVehiclesOnEdge,0,"no diversion without an obstruction");
  assert.equal(sim.totals().detouredVehicles,0);
  // A downstream A48 bottleneck must not make Frankfurt-bound A3 traffic
  // take the Koblenz ramp. The two destinations stay distinct.
  sim.setEvent({id:"a48-crash",edgeId:"A48-1308398832",kind:"accident",
    offsetM:30,lengthM:100,closedLanes:[0,1],speedKmh:40,shoulder:"normal",hasShoulder:false});
  for(let i=0;i<20;i++)sim.advance(12);
  assert.equal(sim.edgeActivity(south).divertedVehiclesOnEdge,0);
  assert.ok(sim.speed("A3-232272183")>65&&sim.edgeActivity("A3-232272183").sectionVph>1000,
    "open A3 mainline beyond Dernbach must still pass traffic toward Frankfurt");
  assert.ok(sim.edgeActivity(south).enteredVph<1000,"no additional forced A3 to A48 diversion");
  conservation(sim.totals());
});

test("Friday peak near Montabaur reaches over 4000 vehicles per hour on actual motorway cells",async()=>{
  const w={};
  for(const path of ["web/traffic-reference.js","web/legacy-geometry.js","web/offline-traffic.js"])
    runInNewContext(await readFile(path,"utf8"),{window:w});
  const sim=w.createLegacyTrafficScenario(w.STAU_LEGACY_GEOMETRY);
  sim.setSimulationStart(Date.parse("2026-11-13T12:00:00Z"));
  sim.warmStart();
  for(let i=0;i<48;i++)sim.advance(12);
  assert.ok(sim.edgeActivity("A3-310863190").sectionVph>4000);
  assert.ok(sim.edgeActivity("A48-108889855").sectionVph>3000);
  conservation(sim.totals());
});

test("weekday overnight freeway profile retains through traffic without inflating local ramps",async()=>{
  const window={};
  runInNewContext(await readFile("web/traffic-reference.js","utf8"),{window});
  const t=window.StauTrafficReference;
  const point=[[50.446,7.83],[50.445,7.82]];
  const wed=Date.parse("2026-11-18T03:15:00Z"),sun=Date.parse("2026-11-15T03:15:00Z");
  for(const [ref,key] of [["A3","A3-koeln"],["A61","extra-a61-nord"],
    ["A1","extra-a1-dortmund"],["A4","extra-a4-aachen"],["A48","A48-dernbach"]]){
    const main=t.profileFactor(key,ref,wed,point,"mainline");
    const local=t.profileFactor(key,ref,wed,point,"ramp");
    assert.ok(main>local*1.5,ref+" preserves through traffic overnight");
    assert.ok(main>t.profileFactor(key,ref,sun,point,"mainline"),ref+" Sunday is quieter");
  }
  const key="A3-koeln",factor=t.profileFactor(key,"A3",wed,point);
  assert.ok(factor*t.REFERENCE_PEAKS[key]>=1000);
  assert.ok(t.profileFactor(key,"A3",Date.parse("2026-11-18T11:00:00Z"),point)>=.75,
    "A3 has substantial daytime demand even outside rush hour");
});

test("Wednesday 04:15 Montabaur mainline flows retain substantial traffic in both directions",async()=>{
  const w={};
  for(const path of ["web/traffic-reference.js","web/legacy-geometry.js","web/offline-traffic.js"])
    runInNewContext(await readFile(path,"utf8"),{window:w});
  const sim=w.createLegacyTrafficScenario(w.STAU_LEGACY_GEOMETRY);
  sim.setSimulationStart(Date.parse("2026-11-18T02:15:00Z"));
  sim.warmStart();
  for(let i=0;i<60;i++)sim.advance(12);
  for(const id of ["A3-310863190","A3-310863191"]){
    const flow=sim.edgeActivity(id).sectionVph;
    assert.ok(flow>=600&&flow<=1800,id+" actual flow: "+flow);
  }
  assert.equal(sim.jamSummaries().length,0);
  conservation(sim.totals());
});

test("A48 receiving bottleneck backs up both Dernbach transfer ramps",async()=>{
  const w={};
  for(const path of ["web/traffic-reference.js","web/legacy-geometry.js","web/offline-traffic.js"])
    runInNewContext(await readFile(path,"utf8"),{window:w});
  const sim=w.createLegacyTrafficScenario(w.STAU_LEGACY_GEOMETRY);
  sim.setSimulationStart(Date.parse("2026-11-13T15:00:00Z"));
  sim.setDemandPercent(180);sim.warmStart();
  sim.setEvent({id:"downstream",edgeId:"A48-1308398832",kind:"accident",
    offsetM:30,lengthM:100,closedLanes:[0,1],speedKmh:40,shoulder:"normal",hasShoulder:false});
  for(let i=0;i<15;i++)sim.advance(12);
  for(const id of ["ramp-a3-to-a48-from-frankfurt","ramp-a3-to-a48-from-koeln"]){
    const chain=w.STAU_LEGACY_GEOMETRY.roads.filter(r=>r[0]===id||r[0].startsWith(id+"-")).map(r=>r[0]);
    assert.ok(chain.some(part=>sim.visualBands(part).some(b=>b.color==="jam"||b.color==="standstill")),id);
    assert.ok(sim.edgeActivity(chain[0]).enteredVph>sim.edgeActivity(chain.at(-1)).departedVph,
      "physical queue grows across the entire ramp, not necessarily its first short section");
  }
  conservation(sim.totals());
});


test("A48-like motorway-ending transfer ramp incident offers an earlier A48 exit to the same A3 destination",async()=>{
  const make=await engine();
  const roads=[
    ["feeder","mainline","A48",2,[[50,7],[50,7.025],[50,7.06],[50,7.09]],"",1],
    ["early","ramp","A48",1,[[50,7.025],[50.006,7.026]],"AS West · Abfahrt von A48",2],
    ["late","ramp","A48",1,[[50,7.06],[50.006,7.061]],"AS Ost · Abfahrt von A48",3],
    ["frankfurt","ramp","A3",1,[[50,7.09],[50.003,7.105]],"AD Test · Überleitung Frankfurt",4],
    ["towards-frankfurt","mainline","A3",3,[[50.003,7.105],[50.003,7.135],[50.003,7.15],[50.003,7.18]],"",5],
    ["return","ramp","A3",1,[[50.009,7.15],[50.003,7.15]],"AS Hinter Unfall · Auffahrt A3",6],
    ["koeln","ramp","A3",1,[[50,7.09],[50.01,7.085]],"AD Test · Überleitung Köln",7],
    ["towards-koeln","mainline","A3",3,[[50.01,7.085],[50.01,7.045]],"",8]
  ];
  const free=make({roads}),blocked=make({roads});
  for(const s of [free,blocked]){
    s.setSimulationStart(Date.parse("2026-11-13T11:00:00Z"));
    s.setDemandPercent(185);s.warmStart();
  }
  free.advance(12);
  assert.equal(free.totals().detouredVehicles,0,
    "a normal motorway split must not generate a phantom diversion");
  blocked.setEvent({id:"ramp-incident",kind:"accident",edgeId:"frankfurt",
    offsetM:850,lengthM:100,closedLanes:[0],speedKmh:0,
    shoulder:"normal",hasShoulder:false});
  for(let i=0;i<40;i++)blocked.advance(12);
  const plans=blocked.detourPlans();
  assert.ok(plans.some(p=>["early","late"].includes(p.terminalEdgeId)&&
    p.reentryEdgeId==="return"),
    "ramp congestion must reach earlier A48 exits and the downstream A3 reentry: "+
    JSON.stringify(plans.slice(0,20)));
  assert.ok(blocked.totals().detouredVehicles>5,
    "A48 drivers must actually take an off-ramp before an impassable A3 connector: "+
    JSON.stringify({totals:blocked.totals(),early:blocked.edgeActivity("early"),late:blocked.edgeActivity("late")}));
  assert.equal(blocked.closureBands("koeln").length,0,
    "the independently connected Köln destination remains legally open");
  conservation(blocked.totals());conservation(free.totals());
});


test("real A48 ramps divert before Dernbach for an A3-transfer accident WITHOUT a motorway full closure",async()=>{
  const w={};
  for(const file of ["web/traffic-reference.js","web/legacy-geometry.js","web/offline-traffic.js"])
    runInNewContext(await readFile(file,"utf8"),{window:w});
  const s=w.createLegacyTrafficScenario(w.STAU_LEGACY_GEOMETRY);
  s.setSimulationStart(Date.parse("2026-11-13T15:51:00Z"));
  s.setDemandPercent(160);s.warmStart();
  s.setEvent({id:"real-transfer-incident",edgeId:"ramp-a48-to-frankfurt",
    kind:"accident",offsetM:880,lengthM:100,closedLanes:[0,1],
    speedKmh:0,hasShoulder:false,shoulder:"normal"});
  for(let i=0;i<16;i++)s.advance(12);
  assert.equal(s.mode("ramp-a48-to-frankfurt"),"accident",
    "this test must divert for a full-lane accident, not a formal full closure");
  const asExit="extra-heumar-26923440";
  const detour=s.detourPlans().find(p=>p.terminalEdgeId===asExit&&
    p.kind==="congestion"&&p.reentryEdgeId==="extra-heumar-243834109");
  assert.ok(detour,"A48 traffic needs a real exit before the congested A3-Frankfurt transfer");
  const diverted=s.detourRouteAccounting().find(p=>p.terminalEdgeId===asExit);
  assert.ok(diverted?.assigned>10&&s.edgeActivity(asExit).divertedVehiclesOnEdge>1,
    "actual A48 cars must leave at that exit, not simply receive a route recommendation");
  assert.equal(s.closureBands("ramp-a48-to-koeln").length,0,
    "the independent Köln branch must not be administratively closed");
  conservation(s.totals());
});
