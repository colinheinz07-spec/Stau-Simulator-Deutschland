import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';

async function create(){
  const window={};
  for(const f of ['traffic-reference','offline-traffic'])
    runInNewContext(await readFile('web/'+f+'.js','utf8'),{window,Date,Intl,console});
  return window.createLegacyTrafficScenario;
}
const at=Date.parse('2026-11-20T16:00:00+01:00');
const ak=()=>[
 ['feed','mainline','A3',3,[[50,7],[50,7.02]],'',1],
 ['through','mainline','A3',3,[[50,7.02],[50,7.05]],'',2],
 ['link','ramp','A3',1,[[50,7.02],[50.00015,7.02012]],'AK Test · Überleitung Richtung A4',3],
 ['dest','mainline','A4',3,[[50.00015,7.02012],[50.005,7.03]],'',4]
];
const as=()=>[
 ['feed','mainline','A59',3,[[50,7],[50,7.02]],'',1],
 ['through','mainline','A59',3,[[50,7.02],[50,7.05]],'',2],
 ['exit','ramp','A59',1,[[50,7.02],[50.00015,7.02012]],'A59 AS 38 Troisdorf · Abfahrt',3]
];
function run(s){
  s.setSimulationStart(at);s.warmStart();
  for(let i=0;i<40;i++)s.advance(12);
  assert.ok(Math.abs(s.totals().conservationResidual)<1e-6);
}
test('normal connected motorway transfers have substantial traffic, without a new AK source',async()=>{
  const s=(await create())({roads:ak()});run(s);
  assert.ok(s.edgeActivity('link').enteredVph>900&&s.edgeActivity('link').enteredVph<1500);
  assert.ok(s.edgeActivity('through').enteredVph>500);
  assert.ok(!s.sourceProfiles().some(p=>p.id==='link'));
  assert.equal(s.totals().detouredVehicles,0);
  assert.equal(s.visualBands('link').length,0,'free moving short link stays green');
});
test('NRW local AS exits use configured share even if no special capacity value exists',async()=>{
  const s=(await create())({roads:as()});run(s);
  assert.ok(s.edgeActivity('exit').enteredVph>210&&s.edgeActivity('exit').enteredVph<700);
  assert.equal(s.sourceCount(),1);
  assert.equal(s.totals().detouredVehicles,0);
});
test('700 Kfz/h at 10 km/h forms a physically displayed ramp queue, without losing vehicles',async()=>{
  const engine=await create(),free=engine({roads:ak()}),slow=engine({roads:ak()});
  run(free);
  slow.setSimulationStart(at);slow.warmStart();
  slow.setEvent({id:'slow',edgeId:'link',kind:'roadworks',offsetM:0,lengthM:20,
    closedLanes:[],speedKmh:10,hasShoulder:false,shoulder:'normal'});
  for(let i=0;i<40;i++)slow.advance(12);
  const link=slow.edgeActivity('link');
  assert.ok(link.enteredVph>600&&link.enteredVph<800);
  assert.ok(link.sectionSpeedKmh<=12);
  assert.ok(slow.visualBands('link').some(b=>b.color==='jam'||b.color==='standstill'));
  assert.ok(slow.edgeActivity('feed').vehicles>free.edgeActivity('feed').vehicles+100);
  assert.equal(free.visualBands('link').length,0);
  assert.ok(Math.abs(slow.totals().conservationResidual)<1e-6);
  assert.equal(slow.diversionShare(59.99),0);
  assert.equal(slow.diversionShare(60),.02);
  assert.equal(slow.diversionShare(240),.70);
});
