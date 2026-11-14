import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {runInNewContext} from "node:vm";

test("all signed imported motorway mainlines use same AS-to-AS closure engine, including blank-OSM-ref A560 and A559",async()=>{
  const window={};
  for(const path of ["web/traffic-reference.js","web/legacy-geometry.js","web/offline-traffic.js"])
    runInNewContext(await readFile(path,"utf8"),{window,Date,Intl,console});
  const data=window.STAU_LEGACY_GEOMETRY;
  assert.equal(data.roads.find(r=>r[0]==="extra-a560-hennef")[2],"",
    "fixture: imported A560 has no explicit ref");
  assert.equal(data.roads.find(r=>r[0]==="extra-a559-porz")[2],"",
    "fixture: imported A559 has no explicit ref");
  const sim=window.createLegacyTrafficScenario(data);
  for(const [id,ref,opposite] of [
    ["extra-a560-hennef","A560","extra-a560-bonn"],
    ["extra-a559-porz","A559","extra-a559-gremberg"]
  ]){
    const row=data.roads.find(r=>r[0]===id);
    assert.equal(row[2],ref,
      "the signed real motorway identifier must be inferred generically");
    let chosen=null;
    for(const position of [.10,.22,.35,.50,.62,.78,.90]){
      const len=row[4].slice(1).reduce((sum,p,i)=>{
        const prior=row[4][i];
        return sum+Math.hypot((p[0]-prior[0])*111194.93,
          (p[1]-prior[1])*111194.93*Math.cos(p[0]*Math.PI/180));
      },0);
      const offset=Math.min(len-1,Math.max(0,len*position));
      const candidate=sim.recommendedClosureLength(id,offset);
      if(candidate){chosen={offset,candidate};break;}
    }
    assert.ok(chosen,ref+" mainline must resolve real AS-to-AS full closures");
    assert.match(chosen.candidate.label,new RegExp(ref));
    const event=sim.setEvent({id:"ref-"+ref,edgeId:id,
      offsetM:chosen.offset,lengthM:chosen.candidate.lengthM,
      kind:"closure",closedLanes:Array.from({length:row[3]},(_,i)=>i),
      speedKmh:0,shoulder:"normal",hasShoulder:false});
    assert.ok(sim.closureBands(id).length,ref+" selected directed road must be closed");
    assert.equal(sim.closureBands(opposite).length,0,
      ref+" reverse carriageway stays open");
    sim.removeEvent(event.id);
  }
});
