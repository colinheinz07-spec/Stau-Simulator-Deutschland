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
test("full closure blocks its physical cross-section; upstream density slows",async()=>{
  const scenario=(await engine())(network());
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
