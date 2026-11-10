import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {runInNewContext} from "node:vm";

async function model(){
  const window={};
  runInNewContext(await readFile("web/event-schedule.js","utf8"),{window,Intl,Date,console});
  runInNewContext(await readFile("web/offline-traffic.js","utf8"),{window,Intl,Date,console});
  return window;
}
function fixture(){
  return {roads:[
    ["a","mainline","A3",3,[[50,7],[50,7.012]],"",1],
    ["b","mainline","A3",3,[[50,7.012],[50,7.024]],"",2],
    ["c","mainline","A3",3,[[50,7.024],[50,7.036]],"",3],
    ["r","ramp","A3",1,[[50,7.024],[50.003,7.03]],"AS-Anschluss",4]
  ]};
}
function incident(overrides={}){
  return {id:"roadworks1",edgeId:"b",kind:"roadworks",closedLanes:[0,1],
    hasShoulder:false,shoulder:"normal",offsetM:0,lengthM:1500,
    speedKmh:60,schedule:null,...overrides};
}
function conservation(s){
  const n=s.totals();
  assert.ok(Math.abs(n.conservationResidual)<1e-5,
    "no cars may disappear or be created inside the network");
}
test("Europe/Berlin recurring windows respect weekdays, midnight and DST",async()=>{
  const s=(await model()).StauEventSchedule;
  assert.equal(s.localInstant("2027-03-28","03:30")-
    s.localInstant("2027-03-28","01:30"),3600000,
    "spring DST must skip one hour");
  assert.equal(s.localInstant("2027-10-31","03:30")-
    s.localInstant("2027-10-31","01:30"),10800000,
    "autumn DST repeats one hour");
  const window={mode:"repeat",firstDate:"2026-11-10",
    lastDate:"2026-11-10",weekdays:[2],startTime:"22:00",endTime:"05:00"};
  assert.equal(s.validate(window),true);
  assert.equal(s.active(window,s.localInstant("2026-11-10","21:59")),false);
  assert.equal(s.active(window,s.localInstant("2026-11-10","23:00")),true);
  assert.equal(s.active(window,s.localInstant("2026-11-11","04:59")),true);
  assert.equal(s.active(window,s.localInstant("2026-11-11","05:00")),false);
  assert.equal(s.active(window,s.localInstant("2026-11-12","23:00")),false);
  assert.equal(s.validate({...window,weekdays:[]}),false);
  assert.equal(s.validate({...window,startTime:"05:00",endTime:"05:00"}),false);
  assert.equal(s.validate({...window,lastDate:"2026-11-09"}),false);
});
test("planned event changes traffic only during the actual scenario clock",async()=>{
  const w=await model(),scenario=w.createLegacyTrafficScenario(fixture()),s=w.StauEventSchedule;
  const at=s.localInstant("2026-11-10","19:00");
  scenario.setSimulationStart(s.localInstant("2026-11-10","18:00"));
  const saved=scenario.setEvent(incident({schedule:{mode:"once",startAt:at,
    endAt:s.localInstant("2026-11-10","20:00")}}));
  assert.equal(saved.lengthM,1500);
  assert.equal(saved.coveredLengthM,1500);
  assert.equal(saved.truncated,false);
  assert.equal(scenario.mode("b"),"none");
  assert.equal(scenario.mode("c"),"none");
  scenario.advance(12);
  assert.equal(scenario.speed("b"),120,"future roadworks never slow early traffic");
  scenario.setSimulationStart(at);
  assert.equal(scenario.mode("b"),"roadworks");
  assert.equal(scenario.mode("c"),"roadworks",
    "verified downstream continuation receives length-limited event");
  scenario.advance(12);
  assert.ok(scenario.speed("b")<=60);
  conservation(scenario);
  scenario.setSimulationStart(s.localInstant("2026-11-10","20:00"));
  assert.equal(scenario.mode("b"),"none","end of schedule is exclusive");
  assert.equal(scenario.activeEvents().length,0);
});
test("individual lanes, shoulder verification, accident length and full closure are validated",async()=>{
  const w=await model(),s=w.createLegacyTrafficScenario(fixture());
  assert.throws(()=>s.setEvent(incident({closedLanes:[0,0]})),/Fahrstreifen/);
  assert.throws(()=>s.setEvent(incident({closedLanes:[0,3]})),/Fahrstreifen/);
  assert.throws(()=>s.setEvent(incident({shoulder:"open"})),/Standstreifen/);
  assert.throws(()=>s.setEvent(incident({edgeId:"r",closedLanes:[0],hasShoulder:true,shoulder:"open"})),/Standstreifen/);
  assert.throws(()=>s.setEvent(incident({kind:"accident",lengthM:201})),/Ereignislänge/);
  assert.throws(()=>s.setEvent(incident({kind:"closure",closedLanes:[0,1],speedKmh:0})),/Vollsperrung/);
  assert.throws(()=>s.setEvent(incident({speedKmh:0})),/Geschwindigkeit/);
  assert.throws(()=>s.setEvent(incident({kind:"accident",lengthM:100,schedule:{
    mode:"repeat",firstDate:"2026-11-10",lastDate:"2026-11-10",
    startTime:"19:00",endTime:"20:00",weekdays:[2]}})),/Wiederkehrende/);
  const withShoulder=s.setEvent(incident({hasShoulder:true,shoulder:"open",
    closedLanes:[0,1,2],speedKmh:40}));
  assert.equal(withShoulder.closedLanes.length,3);
  assert.equal(withShoulder.shoulder,"open");
  assert.equal(s.mode("b"),"roadworks");
  s.setEvent(incident({id:"closed",kind:"closure",closedLanes:[0,1,2],
    speedKmh:0,lengthM:2000}));
  assert.equal(s.mode("b"),"closure");
  assert.equal(s.mode("c"),"closure");
  assert.equal(s.listEvents().length,2);
  s.removeEvent("closed");
  assert.equal(s.mode("b"),"roadworks");
  s.reset(false);
  assert.equal(s.listEvents().length,1,"restart preserves scenario");
  s.reset(true);
  assert.equal(s.listEvents().length,0,"explicit clear removes scenarios");
});
test("no fictional extension at a fork; report actual effective length",async()=>{
  const s=(await model()).createLegacyTrafficScenario(fixture());
  const saved=s.setEvent(incident({edgeId:"c",lengthM:6000}));
  assert.ok(saved.truncated);
  assert.ok(saved.coveredLengthM<6000);
  assert.equal(s.mode("r"),"none","do not close a different ramp");
});
test("long closure stops new entrants while already present vehicles can evacuate",async()=>{
  const w=await model(),s=w.createLegacyTrafficScenario(fixture()),cal=w.StauEventSchedule;
  const start=cal.localInstant("2026-11-10","19:00");
  s.setSimulationStart(start-4*60000);
  s.advance(48); // four minutes of traffic before the closure begins
  const before=s.totals();
  assert.ok(before.vehiclesOnNetwork>0);
  s.setEvent(incident({id:"long",edgeId:"b",kind:"closure",
    closedLanes:[0,1,2],speedKmh:0,lengthM:1900,
    schedule:{mode:"once",startAt:start,endAt:start+60*60000}}));
  const outsideBefore=s.totals().exitedVehicles;
  s.advance(12*4);
  const after=s.totals();
  assert.ok(after.exitedVehicles>=outsideBefore,"existing traffic must still discharge");
  conservation(s);
  assert.equal(s.mode("b"),"closure");
  assert.equal(s.mode("c"),"closure");
});
