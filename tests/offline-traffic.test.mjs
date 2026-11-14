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
  assert.ok(jams.every(x=>x.lengthM>=350&&x.delayMin>=.5));
  assert.ok(jams.every(x=>Number.isFinite(x.delayMin)&&x.worstKmh>=0));
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
  assert.ok(scenario.jamSummaries().some(j=>j.edgeId==="up"&&j.delayMin>.5));
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
   if(info&&/A3 37 Dierdorf/.test(info.label)&&/A3 36 Neuwied/.test(info.label)){
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
   assert.equal(sim.closureBands(id).length>0,blocked,meaning);
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

test("diversion grows from 45 minutes to full willingness at 240 minutes",async()=>{
  const scenario=(await engine())(network());
  assert.equal(scenario.diversionShare(0),0);
  assert.equal(scenario.diversionShare(44.99),0);
  assert.equal(scenario.diversionShare(45),0);
  assert.ok(scenario.diversionShare(90)>0&&scenario.diversionShare(90)<.3);
  assert.ok(scenario.diversionShare(150)>.45&&scenario.diversionShare(150)<.7);
  assert.equal(scenario.diversionShare(240),1);
  assert.equal(scenario.diversionShare(360),1);
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
  assert.ok(scenario.edgeActivity("blocked").enteredVph<20,
    "none of the newer arrivals can drive into the fully closed road");
  assert.ok(scenario.jamSummaries().some(x=>x.edgeId==="up"),
    "excess cars must wait before the full exit, never teleport");
  conservation(scenario.totals());
  scenario.removeEvent("full");
  for(let i=0;i<40;i++)scenario.advance(12);
  conservation(scenario.totals());
  assert.equal(scenario.jamSummaries().length,0,
    "the physical queue dissolves after the motorway reopens");
});

test("A3 Heumar–Köln-Ost closure blocks the A59 feeder turn but leaves A59 through lanes open",async()=>{
  const w={};
  for(const path of ["web/traffic-reference.js","web/legacy-geometry.js","web/offline-traffic.js"])
    runInNewContext(await readFile(path,"utf8"),{window:w});
  const sim=w.createLegacyTrafficScenario(w.STAU_LEGACY_GEOMETRY);
  const closure=sim.setEvent({id:"heumar-a3",edgeId:"A3-132624375",kind:"closure",
    closedLanes:[0,1,2],offsetM:3,lengthM:200,
    speedKmh:0,shoulder:"normal",hasShoulder:false});
  assert.match(closure.closureFrom,/A3 28 AD Köln-Heumar/);
  assert.match(closure.closureTo,/A3 27 AK Köln-Ost/);
  assert.equal(sim.closureBands("extra-a59-koeln").length,0,
    "A59 mainline remains open and green");
  assert.equal(sim.closureBands("A3-26164974").length,0,
    "opposite A3 carriageway stays fully open");
  const approaching=sim.closureDistanceAhead("extra-a59-koeln",0,50000);
  assert.ok(Number.isFinite(approaching)&&approaching>0&&approaching<50000,
    "A59 traffic must recognize a downstream A3 closure before reaching the Heumar junction");
  assert.ok(sim.closureBands("A3-132624375").length>0,
    "A3 section beyond A59 join is physically closed");
  assert.equal(sim.movementBlocked("extra-a59-koeln","A3-132624375"),true,
    "A59 vehicles cannot enter the closed A3 direction");
  assert.ok(sim.closureAccessPoints().some(p=>p.edgeId==="extra-a59-koeln"),
    "the unavailable transition is marked instead of painting A59 closed");
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
  const ramp=data.roads.find(x=>x[0]===frankfurt);
  const fullLength=ramp[4].slice(1).reduce((n,p,i)=>{
    const q=ramp[4][i],dy=(p[0]-q[0])*111100,
      dx=(p[1]-q[1])*111100*Math.cos(p[0]*Math.PI/180);
    return n+Math.hypot(dy,dx);
  },0);
  const bands=sim.closureBands(frankfurt);
  assert.equal(bands.length,1,"one full red-white ramp, no fragment gaps");
  assert.ok(bands[0].fromM<.05&&bands[0].toM>fullLength-2,
    "entire Frankfurt ramp from the A48 split to its A3 merge must be closed: "+
    JSON.stringify(bands)+" vs "+fullLength);
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

test("real A3 Heumar to Köln-Ost closure offers a genuine A59 upstream off-ramp and A3 reentry",async()=>{
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
  assert.ok(plans.some(x=>x.closureId==="koeln-heumar"&&
    x.terminalEdgeId.startsWith("extra-heumar-")&&
    x.reentryEdgeId.startsWith("extra-heumar-")),
    "must identify real A59 off-ramp and after-closure A3 entrance; actual "+
    JSON.stringify(plans.slice(0,10))+"; A3 ramp sources="+
    JSON.stringify(sim.sourceProfiles().filter(x=>x.kind==="ramp"&&
      (x.ref==="A3"||x.ref==="A59")).map(x=>({id:x.id,name:x.name,direction:x.direction})).slice(0,28))+
    "; A59 lookahead "+sim.closureDistanceAhead("extra-a59-koeln",16000,16000));
  conservation(sim.totals());
});

test("A59 Köln-Heumar full closure is AS 31 to AS 32, not an OSM fragment, and blocks A3 entering turn",async()=>{
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
  assert.ok(event.coveredLengthM>2000&&event.coveredLengthM<2400);
  assert.equal(event.offsetM,950,
    "keep user's originally tapped point rather than moving the event icon");
  const span=sim.closureBands("extra-a59-bonn")[0];
  assert.ok(span.toM-span.fromM>2000,"all 2.1 km must have red-white overlay");
  assert.equal(sim.closureBands("extra-a59-koeln").length,0,
    "opposite direction must remain open");
  assert.equal(sim.movementBlocked("A3-258495162","extra-a59-bonn"),true,
    "A3 to A59 Heumar turning movement must not enter after closure");
  assert.equal(sim.closureBands("extra-heumar-328948525").length,0,
    "A59 Wahn ramp far downstream must NOT be closed merely due to shared OSM Way");
  assert.equal(sim.closureBands("extra-heumar-132618673").length,0,
    "Rath exit at end of closure stays usable");
  const normal=sim.recommendedClosureLength("extra-a59-bonn",950);
  assert.equal(normal.lengthM,2132);
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
test("Saturday afternoon free motorways have no phantom jams; real 2-of-3-lane accident creates an upstream queue",async()=>{
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
  assert.equal(s.jamSummaries().length,0,
    "properly sized CTM connectors must not invent jams at tiny A3 ways or end ramps");
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
  assert.ok(s.jamSummaries().some(x=>x.lengthM>600&&x.delayMin>=1),
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
