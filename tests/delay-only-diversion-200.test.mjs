import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
function scenario(ref){
  const w={};
  for(const file of ["traffic-reference","offline-traffic"])
    new Function("window",readFileSync("web/"+file+".js","utf8"))(w);
  const s=w.createLegacyTrafficScenario({roads:[
    ["a","mainline",ref,3,[[50,7],[50,7.02]],"",1],
    ["b","mainline",ref,3,[[50,7.02],[50,7.04]],"",2],
    ["c","mainline",ref,3,[[50,7.04],[50,7.10]],"",3],
    ["out","ramp",ref,1,[[50,7.02],[50.005,7.02]],"AS 1 · Abfahrt",4],
    ["out2","ramp",ref,1,[[50,7.04],[50.005,7.04]],"AS 2 · Abfahrt",5]
  ]});
  s.setSimulationStart(Date.parse("2026-11-13T14:00:00Z"));
  s.setDemandPercent(200);s.warmStart();
  return s;
}
test("one delay-only willingness curve for local and motorway alternatives",()=>{
  const s=scenario("A3");
  for(const [delay,share] of [[0,0],[44.99,0],[45,.2],[60,.25],[105,.4],[180,.65],[240,.85],[285,1],[1260,1]]){
    assert.ok(Math.abs(s.diversionShare(delay)-share)<1e-9);
    assert.equal(s.wideDiversionShare(delay),s.diversionShare(delay));
  }
});
test("200 percent demand: downstream exit starts first and spillback activates the preceding exit",()=>{
  const s=scenario("A3");
  s.setEvent({id:"x",kind:"accident",edgeId:"c",offsetM:3000,lengthM:100,
    closedLanes:[0,1,2],speedKmh:0,shoulder:"normal",hasShoulder:false});
  let firstLast=-1,firstEarly=-1;
  for(let i=0;i<30;i++){
    s.advance(12);
    const early=s.edgeActivity("out"),last=s.edgeActivity("out2");
    if(firstLast<0&&last.diversionDemandFraction>0)firstLast=i;
    if(firstEarly<0&&early.diversionDemandFraction>0)firstEarly=i;
    assert.ok(Math.abs(s.totals().conservationResidual)<1e-6);
  }
  assert.ok(firstLast>=0&&firstEarly>firstLast,"later exit must activate first");
  assert.ok(s.edgeActivity("out").diversionDemandFraction>0);
  assert.ok(s.edgeActivity("out2").diversionDemandFraction>0);
  assert.ok(s.edgeActivity("out").departedVph>0);
  assert.ok(s.edgeActivity("out2").departedVph>0);
});
