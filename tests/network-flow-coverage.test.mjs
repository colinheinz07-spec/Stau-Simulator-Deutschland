import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('Rheinland network: normal weekend traffic reaches local entrance branches and legal motorway transfers',()=>{
  const w={};
  for(const file of ['traffic-reference','legacy-geometry','offline-traffic'])
    new Function('window',readFileSync(`web/${file}.js`,'utf8'))(w);
  const data=w.STAU_LEGACY_GEOMETRY,s=w.createLegacyTrafficScenario(data);
  s.setSimulationStart(Date.parse('2026-11-22T18:00:00+01:00'));
  s.warmStart();
  for(let i=0;i<20;i++)s.advance(12);
  const activity=id=>s.edgeActivity(id,s.edgeActivity(id).lengthM/2);
  for(const id of ['extra-heumar-535229027','extra-heumar-4927296','extra-heumar-32212089']){
    const a=activity(id);
    assert.ok(a.sectionInflowVph>50&&a.sectionVph>50,id);
    assert.equal(a.flowClosed,false,id);
  }
  const reachable=data.roads.filter(r=>s.edgeActivity(r[0])?.reachable);
  const empty=reachable.filter(r=>activity(r[0]).sectionVph<.5);
  assert.ok(reachable.length>=2987);
  assert.ok(empty.length<=8,`${empty.length} empty reachable segments`);
  assert.ok(empty.every(r=>r[1]==='ramp'),'all open mainlines have traffic');
  assert.ok(Math.abs(s.totals().conservationResidual)<1e-6);
});
