import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {runInNewContext} from "node:vm";

test("five contiguous A3 closures Heumar–Bonn/Siegburg retain the A59/A560 motorway bypass",async()=>{
  const window={};
  for(const file of ["legacy-geometry","event-schedule","traffic-reference","offline-traffic"])
    runInNewContext(await readFile("web/"+file+".js","utf8"),{window,Date,Intl,console});
  const sim=window.createLegacyTrafficScenario(window.STAU_LEGACY_GEOMETRY);
  const rows=window.STAU_LEGACY_GEOMETRY.roads;
  const ids=["A3-37570673","A3-546688024","A3-547624606","A3-1036896865","A3-28519406"];
  for(const [i,id] of ids.entries()){
    const r=rows.find(r=>r[0]===id);
    sim.setEvent({id:"heumar-"+i,edgeId:id,kind:"closure",offsetM:0,lengthM:1,
      closedLanes:Array.from({length:r[3]},(_,i)=>i),speedKmh:0});
  }
  const route=sim.directedPathInfo("A3-281773996","A3-840177209");
  assert.deepEqual(Array.from(route.motorways),["A3","A59","A560","A3"]);
  assert.ok(route.minutes>0&&route.minutes<40);
  assert.equal(sim.directedPathInfo("A3-753473366","A3-840177209"),null,
    "a driver already past the A59 fork cannot teleport backwards to it");
  const allowed=new Set(sim.publicReturnIds());
  assert.ok(allowed.size>0);
  assert.equal(rows.filter(r=>allowed.has(r[0])&&/\b(?:AK|AD|Autobahnkreuz|Autobahndreieck)\b/i.test(r[5].split(" · ")[0])).length,0);
  assert.ok(Math.abs(sim.totals().conservationResidual)<1e-6);
});
