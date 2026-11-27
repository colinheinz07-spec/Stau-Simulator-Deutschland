import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';

async function create(roads){
  const window={};
  for(const file of ['traffic-reference','offline-traffic'])
    runInNewContext(await readFile('web/'+file+'.js','utf8'),{window,Date,Intl,console});
  const s=window.createLegacyTrafficScenario({roads});
  s.setSimulationStart(Date.parse('2026-11-23T16:00:00+01:00'));
  s.setDemandPercent(150);
  s.warmStart();
  return s;
}
const closure={kind:'closure',offsetM:100,lengthM:500,closedLanes:[0,1,2],
 speedKmh:0,shoulder:'normal',hasShoulder:false};

test('one closed motorway arm must never force a premature local AS departure',async()=>{
 const roads=[
  ['main','mainline','A48',2,[[50,7],[50,7.1],[50,7.2],[50,7.3]],'',1],
  ['early','ramp','A48',1,[[50,7.1],[50.006,7.1]],'AS 1 · Abfahrt',2],
  ['late','ramp','A48',1,[[50,7.2],[50.006,7.2]],'AS 2 · Abfahrt',3],
  ['badarm','ramp','A48',1,[[50,7.3],[50.005,7.32]],'AD Test · Überleitung A3 Frankfurt',4],
  ['goodarm','ramp','A48',1,[[50,7.3],[49.995,7.32]],'AD Test · Überleitung A3 Köln',5],
  ['bad','mainline','A3',3,[[50.005,7.32],[50.01,7.33],[50.015,7.34]],'',6],
  ['good','mainline','A3',3,[[49.995,7.32],[49.99,7.33],[49.98,7.34]],'',7],
  ['afterbad','mainline','A3',3,[[50.015,7.34],[50.03,7.35]],'',8]
 ];
 const s=await create(roads);
 s.setEvent({id:'full',edgeId:'bad',...closure});
 for(let i=0;i<25;i++){
  s.advance(12);
  assert.equal(s.edgeActivity('early').diversionDemandFraction,0);
  assert.equal(s.edgeActivity('late').diversionDemandFraction,0,
   'the old fallback incorrectly shifted 50% of A48 traffic onto this local AS even with <60 minutes');
  assert.ok(s.edgeActivity('bad').enteredVph<1,
   'the blocked downstream direction receives no vehicles');
  assert.ok(Math.abs(s.totals().conservationResidual)<1e-6);
 }
 assert.ok(s.edgeActivity('goodarm').enteredVph>300,
  'the genuinely connected open motorway arm is used instead');
});
test('unavoidable motorway closure still mandates the last lawful AS',async()=>{
 const roads=[
  ['up','mainline','A3',3,[[50,7],[50,7.01],[50,7.025],[50,7.048],[50,7.054]],'',1],
  ['closed','mainline','A3',3,[[50,7.054],[50,7.071]],'',2],
  ['after','mainline','A3',3,[[50,7.071],[50,7.086]],'',3],
  ['early','ramp','A3',1,[[50,7.01],[50.007,7.01]],'AS 1 Früh · Abfahrt von A3',4],
  ['last','ramp','A3',1,[[50,7.048],[50.008,7.048]],'AS 2 Letzte · Abfahrt von A3',5],
  ['return','ramp','A3',1,[[50.008,7.076],[50,7.076]],'AS 3 Hinter der Sperre · Auffahrt',6]
 ];
 const s=await create(roads);
 s.setEvent({id:'full',edgeId:'closed',...closure,offsetM:0,lengthM:1000});
 s.advance(12);
 assert.equal(s.edgeActivity('early').diversionDemandFraction,0,
  'upstream local AS remains normal with no accumulated AS-to-AS delay');
 assert.equal(s.edgeActivity('last').diversionDemandFraction,1,
  'the real last legal local AS is mandatory');
 for(let i=0;i<60;i++){
  s.advance(12);
  if(s.routingDelayToNextExit('up',715)<45)
    assert.equal(s.edgeActivity('early').diversionDemandFraction,0);
  assert.ok(Math.abs(s.totals().conservationResidual)<1e-6);
 }
 assert.ok(s.edgeActivity('closed').enteredVph<1);
});
test('ordinary voluntary thresholds start at 45 minutes',async()=>{
 const s=await create([
  ['main','mainline','A3',3,[[50,7],[50,7.02]],'',1],
  ['out','ramp','A3',1,[[50,7.02],[50.005,7.02]],'AS 1 · Abfahrt',2]
 ]);
 for(const [delay,share] of [[0,0],[10,0],[44.99,0],[45,.20],[60,.25],[90,.35],[120,.45],[240,.85],[285,1],[480,1]])
  assert.ok(Math.abs(s.diversionShare(delay)-share)<1e-9);
});
