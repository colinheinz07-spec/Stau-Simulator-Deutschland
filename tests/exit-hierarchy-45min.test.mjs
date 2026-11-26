import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

function scenario(){
  const window={};
  for(const name of ['traffic-reference','offline-traffic'])
    new Function('window',readFileSync('web/'+name+'.js','utf8'))(window);
  const sim=window.createLegacyTrafficScenario({roads:[
    ['approach','mainline','A3',3,[[50,7],[50,7.03],[50,7.08],[50,7.14],[50,7.145]],'',1],
    ['blocked','mainline','A3',3,[[50,7.145],[50,7.18]],'',2],
    ['after','mainline','A3',3,[[50,7.18],[50,7.19],[50,7.22]],'',3],
    ['early','ramp','A3',1,[[50,7.03],[50.006,7.03]],'AS 1 · Abfahrt',4],
    ['middle','ramp','A3',1,[[50,7.08],[50.006,7.08]],'AS 2 · Abfahrt',5],
    ['last','ramp','A3',1,[[50,7.14],[50.006,7.14]],'AS 3 · Abfahrt',6],
    ['return','ramp','A3',1,[[50.006,7.19],[50,7.19]],'AS 4 · Auffahrt',7]
  ]});
  sim.setSimulationStart(Date.parse('2026-11-13T15:00:00Z'));
  sim.setDemandPercent(160);
  sim.warmStart();
  sim.setEvent({id:'closure',edgeId:'blocked',kind:'closure',offsetM:0,lengthM:100,
    closedLanes:[0,1,2],speedKmh:0,shoulder:'normal',hasShoulder:false});
  return sim;
}

test('nationwide voluntary routing starts at 60 minutes and grows progressively',()=>{
  const s=scenario();
  for(const [delay,expected] of [[0,0],[45,0],[59.99,0],[60,.10],[90,.30],
    [120,.75],[180,.88],[240,.95],[300,1]])
    assert.ok(Math.abs(s.diversionShare(delay)-expected)<1e-9, String(delay));
  assert.equal(s.wideDiversionShare(59.99),0);
  assert.ok(s.wideDiversionShare(60)>0&&s.wideDiversionShare(60)<s.diversionShare(60));
});

test('closure queue grows and releases upstream exit choices in order',()=>{
  const s=scenario();
  let earlyActive=false,middleFirst=false,earlyReleased=false;
  for(let minute=0;minute<120;minute++){
    s.advance(12);
    const early=s.edgeActivity('early'),middle=s.edgeActivity('middle'),last=s.edgeActivity('last');
    assert.ok(Math.abs(s.totals().conservationResidual)<1e-6);
    for(const id of ['approach','blocked','after','early','middle','last','return'])
      assert.ok(Math.abs(s.edgeActivity(id).balanceResidualLastStep)<1e-6,id);
    assert.equal(last.diversionDemandFraction,1);
    if(middle.diversionDemandFraction>0&&early.diversionDemandFraction===0&&!earlyActive)middleFirst=true;
    if(early.diversionDemandFraction>0)earlyActive=true;
    if(earlyActive&&early.diversionDemandFraction===0&&middle.diversionDemandFraction>0)earlyReleased=true;
    assert.ok(last.departedVph<=710);
  }
  assert.ok(middleFirst&&earlyActive&&earlyReleased,
    'the earlier exit is activated only as its approach becomes congested and released again');
});

test('24-hour closure and recovery conserve global and section inventories',()=>{
  const s=scenario();
  for(let minute=0;minute<1440;minute++){
    if(minute===720){s.removeEvent('closure');s.setDemandPercent(25);}
    s.advance(12);
    assert.ok(Math.abs(s.totals().conservationResidual)<1e-6,String(minute));
    for(const id of ['approach','blocked','after','early','middle','last','return'])
      assert.ok(Math.abs(s.edgeActivity(id).balanceResidualLastStep)<1e-6,id);
  }
  assert.equal(s.totals().simSeconds,86400);
  assert.equal(s.jamSummaries().length,0);
  assert.ok(s.totals().returnedVehicles>0);
});

test('next signed AS at the start of a following OSM Way is a real local decision',()=>{
  const window={};
  for(const name of ['traffic-reference','offline-traffic'])
    new Function('window',readFileSync('web/'+name+'.js','utf8'))(window);
  const sim=window.createLegacyTrafficScenario({roads:[
    ['a','mainline','A3',3,[[50,7],[50,7.01],[50,7.02]],'',1],
    ['b','mainline','A3',3,[[50,7.02],[50,7.04]],'',2],
    ['c','mainline','A3',3,[[50,7.04],[50,7.06]],'',3],
    ['out','ramp','A3',1,[[50,7.01],[50.006,7.01]],'AS 1 · Abfahrt',4],
    ['in','ramp','A3',1,[[50.006,7.02],[50,7.02]],'AS 2 · Auffahrt',5]
  ]});
  assert.equal(sim.routingDelayToNextExit('a',sim.edgeActivity('a').lengthM/2),0,
    'a free downstream entrance at a Way boundary must not appear to be infinitely far away');
});
