import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {runInNewContext} from "node:vm";

async function scenario(){
  const window={};
  for(const path of ["traffic-reference","legacy-geometry","offline-traffic"])
    runInNewContext(await readFile("web/"+path+".js","utf8"),{window});
  const data=window.STAU_LEGACY_GEOMETRY;
  return {s:window.createLegacyTrafficScenario(data),data,traffic:window.StauTrafficReference};
}

test("large real AS have individual finite capacities and increased overnight service",async()=>{
  const {s}=await scenario();
  const exits=[
    ["extra-heumar-30449934",1050],
    ["extra-heumar-23781932",1100],
    ["extra-heumar-4854602",1150],
    ["extra-heumar-25849103",1000],
    ["extra-heumar-26923440",700]
  ];
  const date=hour=>Date.parse("2026-11-18T"+hour+":00:00+01:00");
  s.setSimulationStart(date("16"));
  for(const [id,expected] of exits){
    assert.equal(s.edgeActivity(id).localDischargeVph,expected);
    assert.equal(s.edgeActivity(id).localDischargeLimitVph,expected);
  }
  const admission=s.edgeActivity("extra-heumar-25849101").localAdmissionRateVph;
  s.setSimulationStart(date("02"));
  for(const [id,expected] of exits){
    const a=s.edgeActivity(id);
    assert.ok(a.localDischargeRateVph>expected,id);
    assert.ok(a.localDischargeLimitVph<=a.capacityVph,id);
  }
  assert.ok(s.edgeActivity("extra-heumar-25849101").localAdmissionRateVph>admission);
  const sources=s.sourceProfiles();
  assert.ok(sources.filter(p=>/Montabaur/.test(p.name)).reduce((n,p)=>n+p.peakVph,0)>=1600);
  assert.ok(sources.filter(p=>/Koblenz-Nord/.test(p.name)).reduce((n,p)=>n+p.peakVph,0)>=1200);
  assert.ok(sources.filter(p=>p.ref==="A61").reduce((n,p)=>n+p.peakVph,0)>=1299);
  assert.ok(Math.abs(sources.filter(p=>p.ref==="A61"||p.id==="A48-24351899").reduce((n,p)=>n+p.peakVph,0)-3200)<1e-6);
});

function close(s,data,id){
  const road=data.roads.find(r=>r[0]===id);
  return s.setEvent({id,edgeId:id,kind:"closure",offsetM:150,lengthM:5,
    closedLanes:Array.from({length:road[3]},(_,i)=>i),speedKmh:0,hasShoulder:false,shoulder:"normal"});
}
test("A48 closure detours use Bendorf and Koblenz-Nord in both directions, and A61 as external destination",async()=>{
  const {s,data}=await scenario();
  for(const [id,destination] of [
    ["A48-3991660",/Bendorf/],
    ["A48-348130010",/Koblenz-Nord/],
    ["A48-224110328",/Bendorf/],
    ["A48-24351899",/Koblenz-Nord/],
    ["A48-489943812",/A61.*Netzgrenze/]
  ]){
    close(s,data,id);
    assert.ok(s.detourDestinations(id).some(name=>destination.test(name)),id);
    assert.ok(s.detourPlans().some(p=>p.closureId===id));
    s.removeEvent(id);
  }
});
test("A61 feeder traffic bypasses a closed A48 entry without disappearing or entering the closure",async()=>{
  const {s,data}=await scenario();
  s.setSimulationStart(Date.parse("2026-11-18T16:00:00+01:00"));
  s.warmStart();
  for(let i=0;i<8;i++)s.advance(12);
  const feeders=s.sourceProfiles().filter(p=>p.ref==="A61");
  assert.ok(feeders.every(p=>s.edgeActivity(p.id).enteredVph>350));
  assert.ok(s.edgeActivity("extra-heumar-4854593").enteredVph>400);
  s.setSimulationStart(Date.parse("2026-11-18T16:00:00+01:00"));
  s.warmStart();
  const id="A48-24351899";
  close(s,data,id);
  s.advance(12);
  for(const p of feeders){
    assert.equal(s.edgeActivity(p.id).localSourceDetourFraction,1,p.id);
    assert.equal(s.edgeActivity(p.id).enteredVph,0,p.id);
  }
  assert.ok(s.totals().vehiclesOnDetours>0);
  assert.ok(Math.abs(s.totals().conservationResidual)<1e-6);
});

test("a saturated bypass actually discharges more cars at night, not just a higher displayed limit",async()=>{
  const window={};
  for(const path of ["traffic-reference","offline-traffic"])
    runInNewContext(await readFile("web/"+path+".js","utf8"),{window});
  const roads=[
    ["approach","mainline","A3",3,[[50,7],[50.03,7]],"",1],
    ["blocked","mainline","A3",3,[[50.03,7],[50.06,7]],"",2],
    ["after","mainline","A3",3,[[50.06,7],[50.09,7]],"",3],
    ["exit","ramp","A3",1,[[50.03,7],[50.03,7.006]],"AS 40 Montabaur · Abfahrt",4],
    ["return","ramp","A3",1,[[50.06,7.006],[50.06,7]],"AS 41 Diez · Auffahrt",5]
  ];
  const results=[];
  for(const hour of ["16","02"]){
    const s=window.createLegacyTrafficScenario({roads:structuredClone(roads)});
    s.setSimulationStart(Date.parse("2026-11-18T"+hour+":00:00+01:00"));
    s.setDemandPercent(200);s.warmStart();
    s.setEvent({id:"closure",edgeId:"blocked",kind:"closure",offsetM:0,lengthM:100,
      closedLanes:[0,1,2],speedKmh:0,hasShoulder:false,shoulder:"normal"});
    for(let i=0;i<30;i++)s.advance(12);
    const a=s.edgeActivity("exit");
    assert.ok(a.departedVph>900&&a.departedVph<=a.localDischargeLimitVph+5);
    assert.ok(Math.abs(s.totals().conservationResidual)<1e-6);
    results.push({flow:a.departedVph,detoured:s.totals().detouredVehicles});
  }
  assert.ok(results[1].flow>results[0].flow*1.25);
  assert.ok(results[1].detoured>results[0].detoured*1.25);
});
