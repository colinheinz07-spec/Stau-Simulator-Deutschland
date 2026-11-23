import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
async function make(){
 const window={};
 for(const f of ['traffic-reference','offline-traffic'])
  runInNewContext(await readFile('web/'+f+'.js','utf8'),{window,Date,Intl,console});
 return window.createLegacyTrafficScenario;
}
const roads=[
 ['feed','mainline','A565',2,[[50,7],[50,7.02]],'',1],
 ['through','mainline','A565',2,[[50,7.02],[50,7.05]],'',2],
 ['out','ramp','A565',1,[[50,7.02],[50.0003,7.02022]],'A565 AS 7 Bonn-Poppelsdorf · Abfahrt',3]
];
test('short occupied NRW ramp is coloured at low speed even with only ~250 Kfz/h',async()=>{
 const create=await make();
 for(const limited of [false,true]){
  const s=create({roads});
  s.setSimulationStart(Date.parse('2026-11-20T16:00:00+01:00'));s.warmStart();
  if(limited)s.setEvent({id:'slow',edgeId:'out',kind:'roadworks',
   offsetM:0,lengthM:20,closedLanes:[],speedKmh:10,
   shoulder:'normal',hasShoulder:false});
  for(let i=0;i<40;i++)s.advance(12);
  const a=s.edgeActivity('out');
  assert.ok(a.enteredVph>200&&a.enteredVph<300,'normal arriving demand is conserved');
  if(limited){
    assert.ok(a.sectionSpeedKmh<=10);
    assert.ok(s.visualBands('out').some(b=>b.color==='jam'||b.color==='standstill'),
      'real low-speed movement cannot remain green on the short OSM Way');
  }else assert.equal(s.visualBands('out').length,0);
  assert.ok(Math.abs(s.totals().conservationResidual)<1e-6);
 }
});
