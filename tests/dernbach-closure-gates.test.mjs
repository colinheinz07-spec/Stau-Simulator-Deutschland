import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {runInNewContext} from "node:vm";

async function realNet(){
  const window={};
  for(const file of ["web/traffic-reference.js","web/legacy-geometry.js","web/offline-traffic.js"])
    runInNewContext(await readFile(file,"utf8"),{window,Date,Intl,console});
  return window.createLegacyTrafficScenario(window.STAU_LEGACY_GEOMETRY);
}
function full(sim,id,edgeId,offset=100){
  const laneCount=3;
  return sim.setEvent({id,edgeId,offsetM:offset,kind:"closure",lengthM:200,
    closedLanes:Array.from({length:laneCount},(_,i)=>i),speedKmh:0,
    shoulder:"normal",hasShoulder:false});
}
function closed(sim,id){return sim.closureBands(id).length>0;}

test("AD Dernbach to AS Ransbach Köln begins EXACTLY at A3/A48 diverge, Koblenz stays open",async()=>{
  const sim=await realNet();
  const event=full(sim,"ad-dernbach-ransbach","A3-25993915",300);
  assert.match(event.closureFrom,/A3 39 AD Dernbach/);
  assert.match(event.closureTo,/A3 38 Ransbach-Baumbach/);
  assert.equal(closed(sim,"A3-35484181"),false,
    "A3 motorway before the A48 Koblenz fork stays open and can still diverge");
  const closedFirst=sim.closureBands("A3-31352382");
  assert.ok(closedFirst.length&&closedFirst[0].fromM<3,
    "Cologne A3 MUST close at true A3/A48 fork, not 1.5 km after it; actual "+
      JSON.stringify(closedFirst)+"; further="+
      JSON.stringify(sim.closureBands("A3-224110315")));
  assert.equal(closed(sim,"ramp-a3-to-a48-from-frankfurt"),false,
    "physical A3->A48 Koblenz escape route MUST remain open");
  assert.equal(closed(sim,"ramp-a48-to-koeln"),true,
    "A48 inbound feeder into blocked A3 Cologne must close");
  assert.equal(closed(sim,"ramp-a48-to-frankfurt"),false,
    "A48 to Frankfurt transfer is unaffected");
  assert.equal(closed(sim,"A3-1322908523"),false,
    "opposite Frankfurt mainline remains open");
  assert.equal(closed(sim,"extra-heumar-4452557"),true,
    "Ransbach exit at downstream end is blocked");
  assert.equal(closed(sim,"extra-heumar-807709861"),false,
    "Ransbach entry reopens the A3 toward Cologne");
  assert.equal(closed(sim,"A3-35484185"),false,
    "A3 beyond Ransbach must stay open toward Dierdorf");
  assert.ok(event.coveredLengthM>1500&&event.coveredLengthM<7000);
});
test("Ransbach to Dierdorf Köln must not close remote A48/AD Dernbach access",async()=>{
  const sim=await realNet();
  const event=full(sim,"ransbach-dierdorf","A3-35484185",220);
  assert.match(event.closureFrom,/Ransbach-Baumbach/);
  assert.match(event.closureTo,/Dierdorf/);
  assert.equal(closed(sim,"ramp-a48-to-koeln"),false,
    "A48 approach two junctions upstream must not be closed by a remote event");
  assert.equal(closed(sim,"A3-31352382"),false,
    "A3 on AD Dernbach may not become a distant second closure");
  assert.equal(closed(sim,"extra-heumar-4452557"),false,
    "last available Ransbach exit before closure must stay open");
  assert.equal(closed(sim,"extra-heumar-807709861"),true,
    "Ransbach on-ramp feeding closed A3 must close");
  assert.equal(closed(sim,"extra-heumar-24492793"),true,
    "Dierdorf exit inside closed area must close");
  assert.equal(closed(sim,"extra-heumar-1352049124"),false,
    "Dierdorf on-ramp for return stays open");
});
