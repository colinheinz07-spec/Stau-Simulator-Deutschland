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

test('nationwide local and long-distance choices start gradually at 45 minutes',()=>{
  const s=scenario();
  for(const [delay,expected] of [[0,0],[44.99,0],[45,.01],[60,.02],[90,.15],
    [120,.32],[180,.55],[240,.70],[360,.82],[480,.90]])
    assert.ok(Math.abs(s.diversionShare(delay)-expected)<1e-9,
      delay+' minutes should cause the calibrated voluntary share');
  assert.equal(s.wideDiversionShare(44.99),0);
  assert.ok(s.wideDiversionShare(45)>0&&s.wideDiversionShare(45)<s.diversionShare(45));
  assert.ok(s.wideDiversionShare(180)<s.diversionShare(180),
    'motorway-scale alternative is not automatically the default option');
});

test('queue to an earlier motorway exit triggers choice only after the local 45-minute delay, retaining the later exit',()=>{
  const s=scenario();
  const length=s.edgeActivity('approach').lengthM;
  const earlyOffset=length*.03/.145,middleOffset=length*.08/.145;
  let earlyActivated=false,middleActivatedBeforeEarly=false,sampledBelowThreshold=false;
  for(let minute=0;minute<76;minute++){
    s.advance(12);
    const delay=s.routingDelayToNextExit('approach',earlyOffset);
    const middleDelay=s.routingDelayToNextExit('approach',middleOffset);
    const early=s.edgeActivity('early').diversionDemandFraction;
    const middle=s.edgeActivity('middle').diversionDemandFraction;
    const last=s.edgeActivity('last');
    assert.ok(Math.abs(s.totals().conservationResidual)<1e-6,
      'every vehicle must remain in the vehicle balance at minute '+minute);
    assert.equal(last.diversionDemandFraction,1,
      'the last lawful exit remains mandatory at the full closure');
    if(delay<44.99){
      sampledBelowThreshold=true;
      assert.equal(early,0,
        'remote multi-hour queues must not redirect drivers at an upstream AS');
      if(middle>0&&middleDelay>=45)middleActivatedBeforeEarly=true;
    }
    if(delay>47&&delay<60&&early>0){
      assert.ok(early<.05,'early diversion starts with a small fraction');
      assert.ok(middle>early,'later exit remains preferred');
      earlyActivated=true;
    }
    assert.ok(last.departedVph<=710,
      'limited public-road discharge must cause physical waiting, not unlimited escape');
  }
  assert.ok(sampledBelowThreshold&&middleActivatedBeforeEarly&&earlyActivated,
    'the test actually traverses the upstream queue growth and 45-minute boundary');
  assert.ok(s.edgeActivity('last').vehicles>0,
    'excess vehicles cannot disappear at a congested exit');
});

test('a heavy closure queue shrinks after discharge recovers, releasing early departures without losing vehicles',()=>{
  const s=scenario();
  for(let i=0;i<76;i++)s.advance(12);
  const length=s.edgeActivity('approach').lengthM;
  const offset=length*.03/.145;
  const peak=s.totals().vehiclesOnNetwork;
  assert.ok(peak>3000,'test first builds a genuinely large stored queue');
  assert.ok(s.edgeActivity('early').diversionDemandFraction>0,
    'an earlier exit was chosen while its next leg exceeded 45 minutes');
  s.removeEvent('closure');
  s.setDemandPercent(25);
  let hasRecovered=false;
  for(let i=0;i<100;i++){
    s.advance(12);
    assert.ok(Math.abs(s.totals().conservationResidual)<1e-6,
      'removing the closure does not delete vehicles, even during recovery');
    const leg=s.routingDelayToNextExit('approach',offset);
    if(leg<45&&i>0){
      assert.equal(s.edgeActivity('early').diversionDemandFraction,0,
        'previously congested exit approach is no longer a reason to depart early');
      hasRecovered=true;
    }
  }
  assert.ok(hasRecovered,'upstream 45-minute approach delay must actually recede');
  assert.ok(s.totals().vehiclesOnNetwork<peak*.4,
    'greater discharge than intake shrinks the physically stored motorway queue');
  assert.equal(s.jamSummaries().length,0,'the former closure queue dissolves');
});
