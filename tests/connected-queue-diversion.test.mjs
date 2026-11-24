import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
test("connected motorway queue triggers diversion even when next AS delay is below 45 minutes",()=>{
  const window={};
  for(const path of ["web/traffic-reference.js","web/offline-traffic.js"])
    runInNewContext(readFileSync(path,"utf8"),{window});
  const s=window.createLegacyTrafficScenario({roads:[
    ["a","mainline","A3",3,[[50,7],[50,7.02]],"",1],
    ["b","mainline","A3",3,[[50,7.02],[50,7.04]],"",2],
    ["c","mainline","A3",3,[[50,7.04],[50,7.10]],"",3],
    ["out","ramp","A3",1,[[50,7.02],[50.005,7.02]],"AS 1 · Abfahrt",4],
    ["out2","ramp","A3",1,[[50,7.04],[50.005,7.04]],"AS 2 · Abfahrt",5]
  ]});
  s.setDemandPercent(150);s.warmStart();
  s.setEvent({id:"x",kind:"accident",edgeId:"c",offsetM:3000,lengthM:100,closedLanes:[0,1,2],speedKmh:0,shoulder:"normal",hasShoulder:false});
  for(let i=0;i<30;i++)s.advance(12);
  assert.ok(s.jamSummaries().some(g=>g.startEdgeId==="a"&&g.endEdgeId==="c"&&g.routingDelayMin>45));
  assert.ok(s.routingDelayToNextExit("a",s.edgeActivity("a").lengthM-.1)<45);
  assert.ok(s.edgeActivity("out").diversionDemandFraction>.1);
  assert.ok(Math.abs(s.totals().conservationResidual)<1e-6);
});
