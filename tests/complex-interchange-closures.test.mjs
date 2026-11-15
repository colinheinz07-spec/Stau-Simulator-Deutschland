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

test("generic terminal highway closes from its last escape over multiple Ways; exclusive exit fragments close but shared branch stays open",async()=>{
  const data={roads:[
    ["main","mainline","A7",3,[[50,7],[50,7.01],[50,7.015],[50,7.02]],"",1],
    ["after","mainline","A7",3,[[50,7.02],[50,7.04]],"",2],
    ["side","mainline","A8",2,[[50.03,7],[50.02,7],[50.01,7]],"",3],
    ["side-tail","mainline","A8",2,[[50.01,7],[50,7]],"",4],
    ["escape","mainline","A9",2,[[50.02,7],[50.02,7.04]],"",5],
    ["exit-head","ramp","A7",1,[[50,7.01],[50.005,7.01]],"Abfahrt",6],
    ["exit-tail","ramp","A7",1,[[50.005,7.01],[50.01,7.01]],"Rampenzweig",7],
    ["exit-shared","ramp","A9",1,[[50.01,7.01],[50.015,7.01]],"Rampenzweig",8],
    ["open-in","ramp","A9",1,[[50.02,7.01],[50.01,7.01]],"Abfahrt",9],
    ["ramp-trunk","ramp","A9",1,[[50.02,7.02],[50.01,7.02],[50,7.015]],"Überleitung",10],
    ["ramp-open","ramp","A9",1,[[50.01,7.02],[50.01,7.03]],"Abfahrt",11]
  ]};
  const sim=await scenario(data);
  sim.setSimulationStart(Date.parse("2026-11-13T02:00:00Z"));
  sim.warmStart();
  sim.setEvent({id:"terminal-feeder",edgeId:"main",kind:"closure",offsetM:0,
    lengthM:1400,closedLanes:[0,1,2],speedKmh:0,shoulder:"normal",hasShoulder:false});
  const side=sim.closureBands("side");
  assert.equal(side.length,1);
  assert.ok(Math.abs(side[0].fromM-1111.95)<1,"only suffix after open direct motorway fork");
  assert.ok(Math.abs(side[0].toM-2223.90)<1);
  assert.equal(state(sim,"side-tail"),true);
  assert.equal(state(sim,"escape"),false);
  assert.equal(sim.movementBlocked("side","escape"),false);
  assert.equal(sim.movementBlocked("side","side-tail"),false,"existing vehicles evacuate");
  assert.equal(state(sim,"exit-head"),true);
  assert.equal(state(sim,"exit-tail"),true,"exclusive downstream ramp fragment follows closure");
  assert.equal(state(sim,"exit-shared"),false,"shared open incoming transfer remains open");
  assert.equal(sim.movementBlocked("open-in","exit-shared"),false);
  const ramp=sim.closureBands("ramp-trunk");
  assert.equal(ramp.length,1);
  assert.ok(Math.abs(ramp[0].fromM-1111.95)<1,"shared ramp stays open to its own fork");
  assert.equal(state(sim,"ramp-open"),false);
  assert.equal(sim.movementBlocked("ramp-trunk","ramp-open"),false);
  assert.equal(state(sim,"after"),false);
  for(let i=0;i<120;i++)sim.advance(12);
  assert.ok(sim.edgeActivity("side-tail").vehicles<.5,"trapped feeder drains without new traffic");
  assert.ok(Math.abs(sim.totals().conservationResidual)<1e-6);
  sim.removeEvent("terminal-feeder");
  for(const id of ["side","side-tail","exit-head","exit-tail","ramp-trunk"])
    assert.equal(state(sim,id),false,"all derived intervals reopen: "+id);
});

test("real Köln-Süd–Eifeltor reopens the collector for local entry toward Aachen; Klettenberg–Köln-West instead closes its motorway merge",async()=>{
  const window={};
  for(const file of ["web/traffic-reference.js","web/legacy-geometry.js","web/offline-traffic.js"])
    runInNewContext(await readFile(file,"utf8"),{window,Date,Intl,console});
  const sim=window.createLegacyTrafficScenario(window.STAU_LEGACY_GEOMETRY);
  const r=id=>"extra-koelnwest-link-"+id;
  const first=closure(sim,"eifeltor","extra-a4-aachen",10150);
  assert.match(first.closureFrom,/Köln-Süd/);
  assert.match(first.closureTo,/Köln-Eifeltor/);
  const band=sim.closureBands("extra-a4-aachen")[0];
  assert.ok(band.toM>11260&&band.toM<11300,"mainline reopens at Eifeltor");
  assert.equal(state(sim,r(30760401)),true,"old motorway approach closes");
  assert.equal(state(sim,r(455315447)),true,"closed outgoing direction");
  for(const id of ["142169746","455315447:reverse","455315446","114123483",
    "455315451","30760403","224670396","10089982","71505392","10089983"]){
    assert.equal(state(sim,r(id)),false,"local entry and its complete onward chain stay open: "+id);
  }
  assert.equal(sim.edgeActivity(r(142169746)).source,true,"verified local street is an actual source");
  assert.equal(sim.movementBlocked(r(142169746),r("455315447:reverse")),false);
  assert.equal(sim.movementBlocked(r("455315447:reverse"),r(455315446)),false);
  assert.equal(sim.movementBlocked(r(224670396),"extra-a4-aachen"),false);
  sim.advance(1);
  assert.ok(sim.detourPlans().some(p=>p.reentryEdgeId===r(142169746)),
    "return from Köln-Süd closure via the verified Eifeltor ramp chain");
  sim.removeEvent("eifeltor");
  const second=closure(sim,"klettenberg","extra-a4-aachen",14500);
  assert.match(second.closureFrom,/Köln-Klettenberg/);
  assert.match(second.closureTo,/Köln-West/);
  assert.ok(Math.abs(sim.closureBands("extra-a4-aachen")[0].fromM-11260.059)<1,
    "mainline closure begins at Eifeltor collector diverge, the last lawful Klettenberg exit");
  for(const id of [30760401,142169746,455315446,114123483,455315451,30760403,10089982])
    assert.equal(state(sim,r(id)),false,"Eifeltor collector to Klettenberg exit stays open: "+id);
  for(const id of [224670396,71505392,10089983])
    assert.equal(state(sim,r(id)),true,"entry into now blocked A4 must close: "+id);
  assert.equal(state(sim,"extra-a4-olpe"),false);
  assert.ok(Math.abs(sim.totals().conservationResidual)<1e-6);
});

test("real Siebengebirge–Bonn/Siegburg leaves downstream motorway exits and A560 through movements available",async()=>{
  const window={};
  for(const file of ["web/traffic-reference.js","web/legacy-geometry.js","web/offline-traffic.js"])
    runInNewContext(await readFile(file,"utf8"),{window,Date,Intl,console});
  const sim=window.createLegacyTrafficScenario(window.STAU_LEGACY_GEOMETRY);
  const evt=closure(sim,"siegburg-end","A3-37264385",650,2);
  assert.match(evt.closureFrom,/Siebengebirge/);
  assert.match(evt.closureTo,/Bonn\/Siegburg/);
  assert.equal(state(sim,"A3-37264385"),true);
  for(const id of ["extra-siegburg-A3-koeln-to-A560-bonn","extra-siegburg-A3-koeln-to-A560-hennef",
    "extra-siegburg-A3-frankfurt-to-A560-bonn","extra-siegburg-A3-frankfurt-to-A560-hennef",
    "extra-siegburg-A560-bonn-to-A3-koeln","extra-siegburg-A560-hennef-to-A3-koeln",
    "extra-a560-bonn","extra-a560-hennef"]){
    assert.equal(state(sim,id),false,"downstream interchange exit or lawful reentry stays open: "+id);
  }
  sim.advance(1);
  assert.ok(Math.abs(sim.totals().conservationResidual)<1e-6);
});
