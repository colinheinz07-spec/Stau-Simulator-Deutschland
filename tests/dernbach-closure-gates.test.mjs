import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {runInNewContext} from "node:vm";

async function realNet(){
  const window={};
  for(const file of ["web/traffic-reference.js","web/legacy-geometry.js","web/offline-traffic.js"])
    runInNewContext(await readFile(file,"utf8"),{window,Date,Intl,console});
  return window.createLegacyTrafficScenario(window.STAU_LEGACY_GEOMETRY);
}
function full(sim,id,edgeId,offset=100){
  const laneCount=3;
  return sim.setEvent({id,edgeId,offsetM:offset,kind:"closure",lengthM:200,
    closedLanes:Array.from({length:laneCount},(_,i)=>i),speedKmh:0,
    shoulder:"normal",hasShoulder:false});
}
function closed(sim,id){return sim.closureBands(id).length>0;}

test("AD Dernbach to AS Ransbach Köln begins EXACTLY at A3/A48 diverge, Koblenz stays open",async()=>{
  const sim=await realNet();
  const event=full(sim,"ad-dernbach-ransbach","A3-25993915",300);
  assert.match(event.closureFrom,/A3 39 AD Dernbach/);
  assert.match(event.closureTo,/A3 38 Ransbach-Baumbach/);
  const boundaries=sim.closureGatePoints().filter(p=>
    p.eventId==="ad-dernbach-ransbach");
  assert.equal(boundaries.map(p=>p.type).join(","),"start,reopen",
    "map must show ONE road closure start and ONE downstream reopening");
  assert.equal(boundaries[0].edgeId,"A3-31352382",
    "physical closure gate on A3 must be at the directed A3/A48 fork");
  assert.ok(boundaries[0].offsetM<3);
  assert.ok(boundaries[1].edgeId.startsWith("A3-"));
  assert.equal(closed(sim,"A3-35484181"),false,
    "A3 motorway before the A48 Koblenz fork stays open and can still diverge");
  const closedFirst=sim.closureBands("A3-31352382");
  assert.ok(closedFirst.length&&closedFirst[0].fromM<3,
    "Cologne A3 MUST close at true A3/A48 fork, not 1.5 km after it; actual "+
      JSON.stringify(closedFirst)+"; further="+
      JSON.stringify(sim.closureBands("A3-224110315")));
  assert.equal(closed(sim,"ramp-a3-to-a48-from-frankfurt"),false,
    "physical A3->A48 Koblenz escape route MUST remain open");
  assert.equal(closed(sim,"ramp-a48-to-koeln"),true,
    "A48 inbound feeder into blocked A3 Cologne must close");
  assert.equal(closed(sim,"ramp-a48-to-frankfurt"),false,
    "A48 to Frankfurt transfer is unaffected");
  assert.equal(closed(sim,"A3-1322908523"),false,
    "opposite Frankfurt mainline remains open");
  assert.equal(closed(sim,"extra-heumar-4452557"),true,
    "Ransbach exit at downstream end is blocked");
  assert.equal(closed(sim,"extra-heumar-807709861"),false,
    "Ransbach entry reopens the A3 toward Cologne");
  assert.equal(closed(sim,"A3-35484185"),false,
    "A3 beyond Ransbach must stay open toward Dierdorf");
  assert.ok(event.coveredLengthM>1500&&event.coveredLengthM<7000);
});
test("Ransbach to Dierdorf Köln must not close remote A48/AD Dernbach access",async()=>{
  const sim=await realNet();
  const event=full(sim,"ransbach-dierdorf","A3-35484185",220);
  assert.match(event.closureFrom,/Ransbach-Baumbach/);
  assert.match(event.closureTo,/Dierdorf/);
  assert.equal(closed(sim,"ramp-a48-to-koeln"),false,
    "A48 approach two junctions upstream must not be closed by a remote event");
  assert.equal(closed(sim,"A3-31352382"),false,
    "A3 on AD Dernbach may not become a distant second closure");
  assert.equal(closed(sim,"extra-heumar-4452557"),false,
    "last available Ransbach exit before closure must stay open");
  assert.equal(closed(sim,"extra-heumar-807709861"),true,
    "Ransbach on-ramp feeding closed A3 must close");
  assert.equal(closed(sim,"extra-heumar-24492793"),true,
    "Dierdorf exit inside closed area must close");
  assert.equal(closed(sim,"extra-heumar-1352049124"),false,
    "Dierdorf on-ramp for return stays open");
});

test("full closure: through traffic continues past earlier off-ramps to LAST lawful exit",async()=>{
  const window={};
  for(const file of ["web/traffic-reference.js","web/offline-traffic.js"])
    runInNewContext(await readFile(file,"utf8"),{window,Date,Intl,console});
  const model=window.createLegacyTrafficScenario({roads:[
    ["approach","mainline","A3",3,
      [[50,7],[50,7.010],[50,7.025],[50,7.032],[50,7.038]],"",1],
    ["closed","mainline","A3",3,[[50,7.038],[50,7.055]],"",2],
    ["after","mainline","A3",3,[[50,7.055],[50,7.070]],"",3],
    ["early","ramp","A3",1,[[50,7.010],[50.007,7.010]],
      "AS 1 Früh · Abfahrt von A3",4],
    ["last","ramp","A3",1,[[50,7.032],[50.008,7.032]],
      "AS 2 Letzte · Abfahrt von A3",5],
    ["return","ramp","A3",1,[[50.008,7.060],[50,7.060]],
      "AS 3 Hinter der Sperre · Auffahrt auf A3",6]
  ]});
  model.setSimulationStart(Date.parse("2026-11-13T15:51:00Z"));
  model.warmStart();
  model.setEvent({id:"test-closure",edgeId:"closed",offsetM:0,
    kind:"closure",lengthM:1000,closedLanes:[0,1,2],
    speedKmh:0,shoulder:"normal",hasShoulder:false});
  assert.equal(closed(model,"early"),false,"earlier exit must remain open");
  assert.equal(closed(model,"last"),false,"last exit must remain open");
  assert.equal(closed(model,"return"),false,"later entrance is open");
  for(let i=0;i<40;i++)model.advance(12);
  const firstFlow=model.edgeActivity("early").enteredVph;
  const lastFlow=model.edgeActivity("last").enteredVph;
  assert.ok(lastFlow>firstFlow*3,
    "farther-away exit must not absorb the forced diversion if a later exit "+
      "exists; earlier="+firstFlow+" vph, last="+lastFlow+" vph");
  assert.ok(lastFlow>300,"last open exit carries the diverted vehicles");
  assert.ok(Math.abs(model.totals().conservationResidual)<1e-6);
});

test("different taps between adjacent junctions select the same closure regardless of OSM subdivision",async()=>{
  const window={};
  for(const file of ["web/traffic-reference.js","web/offline-traffic.js"])
    runInNewContext(await readFile(file,"utf8"),{window,Date,Intl,console});
  const sim=window.createLegacyTrafficScenario({roads:[
    ["main","mainline","A7",3,
      [[50,7],[50,7.010],[50,7.014],[50,7.016],[50,7.028],
      [50,7.031],[50,7.034],[50,7.045]],"",11],
    ["before-off","ramp","A7",1,[[50,7.010],[50.005,7.010]],"AS 1 · Abfahrt",12],
    ["before-on","ramp","A7",1,[[50.005,7.016],[50,7.016]],"AS 1 · Auffahrt",13],
    ["end-off","ramp","A7",1,[[50,7.028],[50.005,7.028]],"AS 2 · Abfahrt",14],
    ["end-on","ramp","A7",1,[[50.005,7.034],[50,7.034]],"AS 2 · Auffahrt",15]
  ],junctions:[
    ["A7","1","Vorne",[50,7.014]],
    ["A7","2","Hinten",[50,7.031]]
  ]});
  const metresPerDegree=111194.93*Math.cos(50*Math.PI/180);
  const justBefore=sim.recommendedClosureLength("main",.020*metresPerDegree);
  const justAfterLabel=sim.recommendedClosureLength("main",.025*metresPerDegree);
  assert.ok(justBefore&&justAfterLabel,
    "both taps in the between-AS corridor must select the same closure");
  assert.equal(justAfterLabel.label,justBefore.label,
    "different taps between the same two AS must not move closure boundaries");
  const evt=full(sim,"physical-centre","main",.025*metresPerDegree);
  assert.match(evt.closureFrom,/Vorne/);
  assert.match(evt.closureTo,/Hinten/);
  assert.equal(closed(sim,"end-on"),false);
  assert.equal(closed(sim,"end-off"),true);
});

test("full closure spans physical AS gates even when junctions are only 2 metres apart",async()=>{
  const window={};
  for(const file of ["web/traffic-reference.js","web/offline-traffic.js"])
    runInNewContext(await readFile(file,"utf8"),{window,Date,Intl,console});
  const sim=window.createLegacyTrafficScenario({roads:[
    ["main","mainline","A7",3,[[50,7],[50,7.000010],
      [50,7.000020],[50,7.000030],[50,7.000040],
      [50,7.000060]],"",11],
    ["exit","ramp","A7",1,[[50,7.000010],[50.000020,7.000010]],
      "AS 1 · Abfahrt",12],
    ["entry","ramp","A7",1,[[50.000020,7.000040],[50,7.000040]],
      "AS 2 · Auffahrt",13]
  ],junctions:[
    ["A7","1","Vorne",[50,7.000015]],
    ["A7","2","Hinten",[50,7.000035]]
  ]});
  const projected=.000025*111194.93*Math.cos(50*Math.PI/180);
  const suggestion=sim.recommendedClosureLength("main",projected);
  assert.ok(suggestion,"no arbitrary 100-m minimum for adjoining AS gates");
  const event=sim.setEvent({id:"tiny-real-gates",edgeId:"main",kind:"closure",
    offsetM:projected,lengthM:suggestion.lengthM,
    closedLanes:[0,1,2],speedKmh:0,shoulder:"normal",hasShoulder:false});
  assert.match(event.closureFrom,/Vorne/);
  assert.match(event.closureTo,/Hinten/);
  assert.ok(event.coveredLengthM>=1&&event.coveredLengthM<10,
    "actual graph-derived AS closure length is only a few metres");
  assert.equal(closed(sim,"entry"),false,
    "next AS on-ramp is open regardless of AS separation");
});

test("last usable AS exit still forces diversion if the next full closure is over 30km ahead",async()=>{
  const window={};
  for(const file of ["web/traffic-reference.js","web/offline-traffic.js"])
    runInNewContext(await readFile(file,"utf8"),{window,Date,Intl,console});
  const sim=window.createLegacyTrafficScenario({roads:[
    ["approach","mainline","A3",3,
      [[50,7],[50,7.010],[50,7.430]],"",1],
    ["closed","mainline","A3",3,[[50,7.430],[50,7.450]],"",2],
    ["beyond","mainline","A3",3,[[50,7.450],[50,7.460],[50,7.490]],"",3],
    ["off","ramp","A3",1,
      [[50,7.010],[50.005,7.012]],"AS 1 Weit davor · Abfahrt von A3",4],
    ["in","ramp","A3",1,
      [[50.005,7.460],[50,7.460]],"AS 2 Dahinter · Auffahrt auf A3",5]
  ]});
  sim.setSimulationStart(Date.parse("2026-11-13T15:51:00Z"));
  sim.warmStart();
  sim.setEvent({id:"very-long-gap",edgeId:"closed",kind:"closure",
    lengthM:1000,offsetM:0,closedLanes:[0,1,2],
    shoulder:"normal",hasShoulder:false,speedKmh:0});
  sim.advance(12);
  const plans=sim.detourPlans();
  assert.ok(plans.some(p=>p.closureId==="very-long-gap"&&
    p.terminalEdgeId==="off"&&p.reentryEdgeId==="in"),
    "full closure detour must find a real last AS exit and next legal on-ramp "+
    "regardless of any 16/25/60km search limits; plans="+
      JSON.stringify(plans)+"; ahead="+
      sim.closureDistanceAhead("approach",0,Infinity)+
      "; exposure="+sim.closureExposureAhead("approach",0,Infinity)+
      "; offSink="+JSON.stringify(sim.edgeActivity("off"))+
      "; onSource="+JSON.stringify(sim.edgeActivity("in")));
  for(let i=0;i<20;i++)sim.advance(12);
  assert.ok(sim.edgeActivity("off").enteredVph>500,
    "all obstructed traffic diverts at the last exit, even if >30km from the barrier; got "+
    sim.edgeActivity("off").enteredVph+" vph");
  assert.ok(Math.abs(sim.totals().conservationResidual)<1e-6);
});
