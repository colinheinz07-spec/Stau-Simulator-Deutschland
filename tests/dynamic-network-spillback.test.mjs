import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

function scenario(roads){
  const window={};
  for(const file of ['traffic-reference',...(roads?[]:['legacy-geometry']),'offline-traffic'])
    new Function('window',readFileSync(`web/${file}.js`,'utf8'))(window);
  const s=window.createLegacyTrafficScenario(roads?{roads}:window.STAU_LEGACY_GEOMETRY);
  s.setSimulationStart(Date.parse('2026-11-13T13:00:00Z'));
  return s;
}
const incident=(id,edgeId,closedLanes,speedKmh=0,kind='accident')=>({id,edgeId,kind,
  offsetM:100,lengthM:200,closedLanes,speedKmh,hasShoulder:false,shoulder:'normal'});
const rampNetwork=()=>[
  ['up','mainline','A3',3,[[50,7],[50,7.025]],'',1],
  ['merge','mainline','A3',3,[[50,7.025],[50,7.065]],'',2],
  ['bad','mainline','A3',3,[[50,7.065],[50,7.08]],'',3],
  ['after','mainline','A3',3,[[50,7.08],[50,7.10]],'',4],
  ['feeder','ramp','A3',1,[[50.015,7.025],[50.007,7.025]],'AS 1 · Auffahrt',5],
  ['in','ramp','A3',1,[[50.007,7.025],[50,7.025]],'AS 1 · Auffahrt',6]
];

test('physical accident fills a real merge, then its ramp and upstream feeder; all vehicles remain accounted for',()=>{
  const s=scenario(rampNetwork());s.setDemandPercent(160);s.warmStart();
  s.setEvent(incident('blocked','bad',[0,1,2]));
  for(let i=0;i<10;i++)s.advance(12);
  assert.ok(s.edgeActivity('in').enteredVph>500);
  assert.equal(s.visualBands('feeder').length,0,'the upstream ramp is still moving');
  for(let i=0;i<10;i++)s.advance(12);
  assert.ok(s.edgeActivity('in').vehicles>s.edgeActivity('in').storageVehicles*.8);
  assert.ok(s.visualBands('in').some(b=>b.color==='standstill'));
  assert.ok(s.edgeActivity('merge').receivingCapacityVph<100,'actual receiving service collapses despite 6600 nominal capacity');
  for(let i=0;i<15;i++)s.advance(12);
  assert.ok(s.edgeActivity('feeder').vehicles>s.edgeActivity('feeder').storageVehicles*.8);
  assert.ok(s.visualBands('feeder').some(b=>b.color==='standstill'));
  assert.ok(s.totals().waitingOutsideSources>0);
  assert.ok(Math.abs(s.totals().conservationResidual)<1e-6);
  s.removeEvent('blocked');s.setDemandPercent(40);
  for(let i=0;i<140&&s.visualBands('feeder').length;i++)s.advance(12);
  assert.equal(s.visualBands('feeder').length,0);
  assert.ok(s.edgeActivity('feeder').sectionSpeedKmh>40);
  assert.ok(Math.abs(s.totals().conservationResidual)<1e-6);
});

test('separate queues on one A3–A48 route add, while the reverse unreachable route does not',()=>{
  const s=scenario([
    ['a','mainline','A3',3,[[50,7],[50,7.1]],'',1],
    ['b','mainline','A3',3,[[50,7.1],[50,7.12]],'',2],
    ['c','mainline','A3',3,[[50,7.12],[50,7.25]],'',3],
    ['transfer','ramp','A3',2,[[50,7.25],[50.01,7.26]],'AD Test · A3 → A48',4],
    ['d','mainline','A48',2,[[50.01,7.26],[50.01,7.47]],'',5],
    ['e','mainline','A48',2,[[50.01,7.47],[50.01,7.5]],'',6],
    ['f','mainline','A48',2,[[50.01,7.5],[50.01,7.53]],'',7]
  ]);s.setDemandPercent(175);s.warmStart();
  s.setEvent(incident('one','b',[0,1],60,'roadworks'));
  s.setEvent(incident('two','e',[0],30,'roadworks'));
  let checked=false;
  for(let i=0;i<25;i++){
    s.advance(12);
    const a=s.jamSummaries().find(g=>g.endEdgeId==='a');
    const b=s.jamSummaries().find(g=>g.endEdgeId==='e');
    if(!a||!b||a.routingDelayMin>=45||b.routingDelayMin>=45||a.routingDelayMin+b.routingDelayMin<65)continue;
    const delay=s.routingDelayToDestination('a',0,'e');
    assert.ok(delay>=60);
    assert.ok(Math.abs(delay-a.routingDelayMin-b.routingDelayMin)<6);
    assert.ok(a.routeDelayMin>=60,'the unambiguous continuing route reports its cumulative delay');
    assert.equal(s.routingDelayToDestination('f',0,'a'),Infinity);
    assert.ok(s.diversionShare(delay)>0);
    assert.equal(s.diversionShare(a.routingDelayMin),0);
    assert.equal(s.diversionShare(b.routingDelayMin),0);
    checked=true;break;
  }
  assert.ok(checked,'two individually sub-threshold queues together exceed one hour');
  assert.ok(Math.abs(s.totals().conservationResidual)<1e-6);
});

test('real Montabaur B255 ramp branches queue in a full-width accident downstream of the Frankfurt merge',()=>{
  const s=scenario();s.setSimulationStart(Date.parse('2026-11-18T06:00:00+01:00'));
  s.setDemandPercent(130);s.warmStart();
  s.setEvent(incident('blocked','A3-310863190',[0,1,2]));
  for(let i=0;i<12;i++)s.advance(12);
  const ramp='extra-heumar-243834109';
  assert.ok(s.edgeActivity(ramp).vehicles>s.edgeActivity(ramp).storageVehicles*.8);
  for(const id of [ramp,'extra-heumar-38446037','extra-heumar-1214314273'])
    assert.ok(s.visualBands(id).some(b=>b.color==='standstill'||b.color==='jam'),id);
  assert.ok(Math.abs(s.totals().conservationResidual)<1e-6);
});
