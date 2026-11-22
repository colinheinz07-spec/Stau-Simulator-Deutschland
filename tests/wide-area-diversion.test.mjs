import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {runInNewContext} from "node:vm";

async function engine(real=false){
  const window={};
  for(const file of ["traffic-reference",...(real?["legacy-geometry"]:[]),"offline-traffic"])
    runInNewContext(await readFile(`web/${file}.js`,"utf8"),{window,Date,Intl,console});
  return window;
}
function close(sim,id,edgeId){
  return sim.setEvent({id,edgeId,offsetM:100,kind:"closure",lengthM:200,
    closedLanes:[0,1,2],speedKmh:0,shoulder:"normal",hasShoulder:false});
}

test("Dernbach–Montabaur full closure in both directions offers distinct A61 alternatives",async()=>{
  const w=await engine(true),s=w.createLegacyTrafficScenario(w.STAU_LEGACY_GEOMETRY);
  const south=close(s,"south","A3-232272183"),north=close(s,"north","A3-35484178");
  assert.match(south.closureFrom,/Dernbach/);assert.match(south.closureTo,/Montabaur/);
  assert.match(north.closureFrom,/Montabaur/);assert.match(north.closureTo,/Dernbach/);
  assert.equal(s.wideDetourRoutes("south")[0]?.id,"a61-sued");
  assert.equal(s.wideDetourRoutes("north")[0]?.id,"a61-nord");
  assert.notEqual(s.wideDetourRoutes("south")[0].targetEdgeId,s.wideDetourRoutes("north")[0].targetEdgeId);
  assert.equal(s.wideDiversionShare(59),0);
  assert.ok(s.wideDiversionShare(120)>0&&s.wideDiversionShare(120)<.1);
  assert.ok(s.wideDiversionShare(360)>s.wideDiversionShare(240));
  assert.equal(s.wideDiversionShare(600),.9);
});

test("24-hour closure: covered exits keep draining and a wide detour conserves vehicles",async()=>{
  const w=await engine(),s=w.createLegacyTrafficScenario({roads:[
    ["approach","mainline","A3",3,[[50,7],[50,7.80],[50,7.825],[50,7.85],[50,7.875],[50,7.90]],"",1],
    ["closed","mainline","A3",3,[[50,7.90],[50,7.92]],"",2],
    ["after","mainline","A3",3,[[50,7.92],[50,7.93],[50,7.96]],"",3],
    ["early","ramp","A3",1,[[50,7.825],[50.006,7.825]],"AS 1 · Abfahrt",4],
    ["middle","ramp","A3",1,[[50,7.85],[50.006,7.85]],"AS 2 · Abfahrt",5],
    ["last","ramp","A3",1,[[50,7.875],[50.006,7.875]],"AS 3 · Abfahrt",6],
    ["return","ramp","A3",1,[[50.006,7.93],[50,7.93]],"AS 4 · Auffahrt",7]
  ],wideCorridors:[{id:"wide",ref:"A3",label:"Alternative motorway",reentryId:"return",
    targetId:"after",via:[[50.1,7.3]],capacityVph:1800}]});
  s.setSimulationStart(Date.parse("2026-11-13T15:00:00Z"));
  s.setDemandPercent(180);s.warmStart();
  close(s,"full","closed");
  assert.equal(s.wideDetourRoutes("full")[0]?.id,"wide");
  let drainingMinutes=0,maxDelay=0;
  for(let i=0;i<1440;i++){
    s.advance(12);
    const offset=s.edgeActivity("approach").lengthM* .825/.90;
    maxDelay=Math.max(maxDelay,s.routingDelayAhead("approach",0,Infinity));
    if(s.queueAtExit("approach",offset)&&s.routingDelayToNextExit("approach",offset)<60&&
      s.routingDelayAhead("approach",offset)>=60&&s.edgeActivity("early").diversionDemandFraction>0&&
      s.edgeActivity("early").departedVph>100)drainingMinutes++;
  }
  assert.ok(drainingMinutes>60,"an earlier exit keeps draining for over an hour even when the next exit is close");
  assert.ok(maxDelay>480,"extreme scenario actually reaches a projected delay of over eight hours: "+maxDelay);
  const a=s.wideDetourAccounting()[0];
  assert.ok(a.assigned>1000&&a.returned>100,"actual diversion and return, not just a route label");
  assert.ok(Math.abs(a.assigned-a.returned-a.outside)<1e-6);
  assert.ok(s.edgeActivity("closed").enteredVph<1);
  assert.ok(Math.abs(s.totals().conservationResidual)<1e-6);
});
