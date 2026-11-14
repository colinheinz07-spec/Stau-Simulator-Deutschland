import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {runInNewContext} from "node:vm";

test("ONE directed graph rule works with 2m, 20m, 150m, 2km, 14km junction gaps and complex shared forks",async()=>{
  const window={};
  for(const file of ["web/traffic-reference.js","web/offline-traffic.js"])
    runInNewContext(await readFile(file,"utf8"),{window,Date,Intl,console});
  for(const metres of [2,20,150,2000,14000]){
    const deg=metres/(111194.93*Math.cos(50*Math.PI/180));
    const lon=f=>Number((7+f*deg).toFixed(7));
    const data={roads:[
      ["main","mainline","A7",3,[[50,lon(0)],[50,lon(.1)],[50,lon(.18)],
        [50,lon(.2)],[50,lon(.5)],[50,lon(.8)],[50,lon(.85)],
        [50,lon(.92)],[50,lon(1)]],"",1],
      ["reverse","mainline","A7",3,
        [[50.0007,lon(1)],[50.0007,lon(0)]],"",2],
      ["side","mainline","A8",2,
        [[50.007,lon(.4)],[50.007,lon(.5)]],"",3],
      ["other","mainline","A9",2,
        [[50.01,lon(.5)],[50.015,lon(.5)]],"",4],
      ["up-off","ramp","A7",1,
        [[50,lon(.1)],[50.005,lon(.1)]],"AS A Vorne · Abfahrt",11],
      ["up-on","ramp","A7",1,
        [[50.005,lon(.18)],[50,lon(.18)]],"AS A Vorne · Auffahrt",12],
      ["down-off","ramp","A7",1,
        [[50,lon(.8)],[50.005,lon(.8)]],"AS B Hinten · Abfahrt",13],
      ["down-on","ramp","A7",1,
        [[50.005,lon(.92)],[50,lon(.92)]],"AS B Hinten · Auffahrt",14],
      ["common","ramp","A8",1,
        [[50.007,lon(.5)],[50.005,lon(.5)]],"AK Beispiel · gemeinsamer Arm",21],
      ["to-blocked","ramp","A7",1,
        [[50.005,lon(.5)],[50,lon(.5)]],"AK Beispiel · A8 auf A7",22],
      ["to-open","ramp","A9",1,
        [[50.005,lon(.5)],[50.01,lon(.5)]],"AK Beispiel · A8 auf A9",23]
    ],junctions:[
      ["A7","1","Vorne",[50,lon(.2)]],
      ["A7","2","Hinten",[50,lon(.85)]]
    ]};
    const sim=window.createLegacyTrafficScenario(data);
    const recommended=sim.recommendedClosureLength("main",metres*.55);
    assert.ok(recommended,metres+"m: any AS pair must resolve");
    const e=sim.setEvent({id:"length"+metres,edgeId:"main",kind:"closure",
      offsetM:metres*.55,lengthM:recommended.lengthM,
      closedLanes:[0,1,2],speedKmh:0,
      shoulder:"normal",hasShoulder:false});
    assert.match(e.closureFrom,/Vorne/);
    assert.match(e.closureTo,/Hinten/);
    const bands=sim.closureBands("main");
    assert.equal(bands.length,1,metres+"m: one contiguous closure");
    assert.ok(Math.abs(bands[0].fromM-metres*.1)<Math.max(.2,metres*.02),
      metres+"m: start is at the last upstream exit fork, not label");
    assert.ok(Math.abs(bands[0].toM-metres*.92)<Math.max(.2,metres*.02),
      metres+"m: end is at the first legal return merge, not label");
    for(const id of ["up-on","down-off","to-blocked"])
      assert.ok(sim.closureBands(id).length,
        metres+"m: required incoming/within-closure ramp "+id+" blocked");
    for(const id of ["up-off","down-on","common","to-open",
      "reverse","side","other"])
      assert.equal(sim.closureBands(id).length,0,
        metres+"m: unrelated or alternative road "+id+" must remain open");
    assert.equal(sim.movementBlocked("common","to-blocked"),true);
    assert.equal(sim.movementBlocked("common","to-open"),false);
  }
});

test("missing AS topology rejects motorway full closure instead of painting arbitrary remote 200m OSM interval",async()=>{
  const window={};
  for(const file of ["web/traffic-reference.js","web/offline-traffic.js"])
    runInNewContext(await readFile(file,"utf8"),{window,Date,Intl,console});
  const sim=window.createLegacyTrafficScenario({roads:[
    ["unknown","mainline","A8",3,[[50,7],[50,7.04]],"",10]
  ],junctions:[
    ["A7","1","Other motorway",[50,7]],
    ["A7","2","Other motorway AS",[50,7.04]]
  ]});
  assert.equal(sim.recommendedClosureLength("unknown",120),null);
  assert.throws(()=>sim.setEvent({id:"no-silent-closure",
    edgeId:"unknown",kind:"closure",offsetM:120,lengthM:200,
    closedLanes:[0,1,2],speedKmh:0,shoulder:"normal",hasShoulder:false}),
    /Fehlende OSM-Knoten/);
  assert.equal(sim.closureBands("unknown").length,0,
    "no arbitrary partial closure or unrelated no-entry badges");
});

test("feeder closure respects last open exit across OSM Way boundaries, never road length",async()=>{
  const window={};
  for(const file of ["web/traffic-reference.js","web/offline-traffic.js"])
    runInNewContext(await readFile(file,"utf8"),{window,Date,Intl,console});
  const sim=window.createLegacyTrafficScenario({roads:[
    ["upstream","mainline","A3",3,
      [[50,7],[50,7.015],[50,7.020]],"",1],
    ["intermediate","mainline","A3",3,
      [[50,7.020],[50,7.030],[50,7.035],[50,7.040]],"",2],
    ["blocked","mainline","A3",3,
      [[50,7.040],[50,7.060]],"",3],
    ["beyond","mainline","A3",3,
      [[50,7.060],[50,7.070]],"",4],
    ["early-on","ramp","A3",1,
      [[50.004,7.015],[50,7.015]],"AS Früh · Auffahrt auf A3",11],
    ["last-off","ramp","A3",1,
      [[50,7.030],[50.005,7.030]],"AS Letzte · Abfahrt von A3",12],
    ["late-on","ramp","A3",1,
      [[50.004,7.035],[50,7.035]],"AS Zu spät · Auffahrt auf A3",13],
    ["return-on","ramp","A3",1,
      [[50.004,7.070],[50,7.070]],"AS Hinten · Auffahrt auf A3",14]
  ]});
  sim.setEvent({id:"multi-way",edgeId:"blocked",kind:"closure",
    offsetM:0,lengthM:700,closedLanes:[0,1,2],
    speedKmh:0,shoulder:"normal",hasShoulder:false});
  assert.equal(sim.closureBands("early-on").length,0,
    "incoming ramp before LAST available off-ramp stays OPEN even over other OSM Ways");
  assert.equal(sim.closureBands("last-off").length,0,
    "last off-ramp must be usable");
  assert.ok(sim.closureBands("late-on").length>0,
    "ramp after last off-ramp cannot feed the physical closure on another OSM Way");
  assert.equal(sim.closureBands("return-on").length,0,
    "open motorway reentry after obstruction is unaffected");
  assert.equal(sim.movementBlocked("late-on","intermediate"),true,
    "closed on-ramp may not merge onto the later mainline in the closure direction");
  for(let i=0;i<12;i++)sim.advance(12);
  assert.ok(Math.abs(sim.totals().conservationResidual)<1e-6);
});
