import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {runInNewContext} from "node:vm";

async function scenario(data){
  const window={};
  for(const file of ["web/traffic-reference.js","web/offline-traffic.js"])
    runInNewContext(await readFile(file,"utf8"),{window,Date,Intl,console});
  return window.createLegacyTrafficScenario(data);
}
function closure(sim,id,edgeId,offsetM,lanes=3){
  return sim.setEvent({id,edgeId,kind:"closure",offsetM,
    lengthM:120,closedLanes:Array.from({length:lanes},(_,i)=>i),
    speedKmh:0,shoulder:"normal",hasShoulder:false});
}
function state(sim,id){
  return sim.closureBands(id).length>0;
}

test("generic multi-arm junction: closure blocks only feeder to closed A7, not shared escape or through A8/A9",async()=>{
  const data={roads:[
    ["a7","mainline","A7",3,[[50,7],[50,7.01],[50,7.014],
      [50,7.016],[50,7.024],[50,7.028],[50,7.031],
      [50,7.034],[50,7.05]],"",1],
    ["a7-reverse","mainline","A7",3,
      [[50.0006,7.05],[50.0006,7.03],[50.0006,7]],"",2],
    ["a8","mainline","A8",2,[[50.012,7.001],[50.012,7.020],
      [50.012,7.04]],"",3],
    ["a9","mainline","A9",2,[[50.015,7.029],[50.015,7.05]],"",4],
    ["first-exit","ramp","A7",1,[[50,7.01],[50.006,7.01]],
      "AS 1 Start · Abfahrt von A7",11],
    ["first-entry","ramp","A7",1,[[50.006,7.016],[50,7.016]],
      "AS 1 Start · Auffahrt auf A7",12],
    ["last-exit","ramp","A7",1,[[50,7.028],[50.006,7.028]],
      "AS 2 Ende · Abfahrt von A7",13],
    ["last-entry","ramp","A7",1,[[50.006,7.034],[50,7.034]],
      "AS 2 Ende · Auffahrt auf A7",14],
    ["shared-arm","ramp","A8",1,[[50.012,7.020],[50.010,7.022]],
      "AK Test · gemeinsamer Abzweig",21],
    ["to-closed-a7","ramp","A7",1,
      [[50.010,7.022],[50.005,7.023],[50,7.024]],
      "AK Test · Überleitung auf A7",22],
    ["to-open-a9","ramp","A9",1,
      [[50.010,7.022],[50.015,7.029]],
      "AK Test · Überleitung auf A9",23]
  ],junctions:[
    ["A7","1","Start",[50,7.014]],
    ["A7","2","Ende",[50,7.031]]
  ]};
  const sim=await scenario(data);
  const event=closure(sim,"junction","a7",.024*111194.93*Math.cos(50*Math.PI/180));
  assert.match(event.closureFrom,/A7 1 Start/);
  assert.match(event.closureTo,/A7 2 Ende/);
  for(const id of ["a7","first-entry","last-exit","to-closed-a7"]){
    assert.equal(state(sim,id),true,id+" must close");
  }
  for(const id of ["a7-reverse","a8","a9","first-exit",
    "last-entry","shared-arm","to-open-a9"]){
    assert.equal(state(sim,id),false,id+" must stay open");
  }
  assert.equal(sim.movementBlocked("shared-arm","to-closed-a7"),true,
    "no vehicle can turn from common fork into closed feeder");
  assert.equal(sim.movementBlocked("shared-arm","to-open-a9"),false,
    "the other branch is a real lawful escape");
  assert.equal(sim.movementBlocked("a7","first-exit"),false,
    "last exit before mainline closure is open");
  for(let i=0;i<18;i++)sim.advance(12);
  assert.ok(Math.abs(sim.totals().conservationResidual)<1e-6,
    "complex junction must conserve all vehicles");
});

test("real AK Köln-Gremberg A4 closure leaves A559 and reverse A4 through routes open",async()=>{
  const window={};
  for(const path of ["web/traffic-reference.js","web/legacy-geometry.js","web/offline-traffic.js"])
    runInNewContext(await readFile(path,"utf8"),{window,Date,Intl,console});
  const sim=window.createLegacyTrafficScenario(window.STAU_LEGACY_GEOMETRY);
  const preview=sim.recommendedClosureLength("extra-a4-olpe",13166);
  assert.ok(preview,"the eastbound A4 from Köln-Poll towards Gremberg must resolve");
  assert.match(preview.label,/Köln-Poll/);
  assert.match(preview.label,/Köln-Gremberg/);
  const evt=closure(sim,"gremberg","extra-a4-olpe",13166);
  assert.match(evt.closureFrom,/Köln-Poll/);
  assert.match(evt.closureTo,/Köln-Gremberg/);
  assert.equal(state(sim,"extra-a4-olpe"),true,"targeted eastbound A4 closed");
  for(const id of ["extra-a4-aachen","extra-a559-porz","extra-a559-gremberg"]){
    assert.equal(state(sim,id),false,
      "independent opposite/carriageway movement must remain open: "+id);
  }
  assert.equal(state(sim,"extra-koelnsued-link-225924655"),true,
    "entrance into the closed A4 corridor at Poll must close");
  assert.ok(evt.coveredLengthM>1000&&evt.coveredLengthM<15000,
    "Gremberg closure must not extend into unrelated A4 corridors");
  sim.advance(1);
  assert.ok(Math.abs(sim.totals().conservationResidual)<1e-6);
});

test("real AK Bonn/Siegburg: A560 through open, only ramps into closed A3 Köln blocked",async()=>{
  const window={};
  for(const file of ["web/traffic-reference.js","web/legacy-geometry.js","web/offline-traffic.js"])
    runInNewContext(await readFile(file,"utf8"),{window,Date,Intl,console});
  const sim=window.createLegacyTrafficScenario(window.STAU_LEGACY_GEOMETRY);
  const id="A3-266009538",preview=sim.recommendedClosureLength(id,150);
  assert.ok(preview,"real A3 motorway segment at Bonn/Siegburg must resolve");
  assert.match(preview.label,/AK Bonn\/Siegburg/);
  const event=closure(sim,"siegburg",id,150);
  assert.equal(state(sim,id),true);
  for(const through of ["extra-a560-bonn","extra-a560-hennef"]){
    assert.equal(state(sim,through),false,
      "A560 through-traffic must remain open: "+through);
  }
  for(const feeder of ["extra-siegburg-A560-bonn-to-A3-koeln",
    "extra-siegburg-A560-hennef-to-A3-koeln"]){
    assert.equal(state(sim,feeder),true,
      "all feeders into the blocked A3 toward Köln must be closed: "+feeder);
  }
  for(const other of ["extra-siegburg-A560-bonn-to-A3-frankfurt",
    "extra-siegburg-A560-hennef-to-A3-frankfurt"]){
    assert.equal(state(sim,other),false,
      "other A3 direction must remain accessible: "+other);
  }
  for(let i=0;i<6;i++)sim.advance(12);
  assert.ok(Math.abs(sim.totals().conservationResidual)<1e-6);
});
