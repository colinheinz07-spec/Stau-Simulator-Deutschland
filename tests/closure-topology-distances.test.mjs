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
