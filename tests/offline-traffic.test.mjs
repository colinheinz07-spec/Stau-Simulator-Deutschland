import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {runInNewContext} from "node:vm";

async function engine(){
  const window={};
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
