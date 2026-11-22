import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';

async function make(){
  const window={};
  for(const file of ['traffic-reference','offline-traffic'])
    runInNewContext(await readFile(`web/${file}.js`,'utf8'),{window,Date,Intl,console});
  return window.createLegacyTrafficScenario;
}
const roads=()=>[
  ['up','mainline','A3',3,[[50,7],[50,7.01],[50,7.025]],'',1],
  ['long','mainline','A3',3,[[50,7.025],[50,7.23]],'',2],
  ['bad','mainline','A3',3,[[50,7.23],[50,7.245]],'',3],
  ['after','mainline','A3',3,[[50,7.245],[50,7.255],[50,7.28]],'',4],
  ['out','ramp','A3',1,[[50,7.01],[50.006,7.01]],'AS 1 · Abfahrt',5],
  ['in','ramp','A3',1,[[50.006,7.255],[50,7.255]],'AS 2 · Auffahrt',6]
];
const incident={id:'acc',edgeId:'bad',kind:'accident',offsetM:500,lengthM:200,closedLanes:[0],speedKmh:50,shoulder:'normal',hasShoulder:false};

test('a long moving queue triggers actual exits before 60 min and remains dynamic',async()=>{
  const s=(await make())({roads:roads()});
  s.setSimulationStart(Date.parse('2026-11-13T13:00:00Z'));s.setDemandPercent(160);s.warmStart();
  s.setEvent(incident);const offset=s.edgeActivity('up').lengthM*.4;
  assert.equal(s.lengthDiversionShare(2999),0);
  assert.equal(s.lengthDiversionShare(10000),.22);
  let peak=0,activeEarly=0,afterRampQueue=0,downstreamBrake=-1,upstreamBrake=-1;
  for(let i=0;i<70;i++){
    s.advance(12);
    const len=s.routingQueueLength('up',offset),delay=s.routingDelayAhead('up',offset),exit=s.edgeActivity('out');
    peak=Math.max(peak,len);
    if(len>=3000&&delay<60&&exit.diversionDemandFraction>0)activeEarly++;
    if(len>=6000&&delay<60&&exit.diversionDemandFraction>0&&i>=35)afterRampQueue++;
    if(downstreamBrake<0&&s.edgeActivity('long',12000).sectionSpeedKmh<45)downstreamBrake=i;
    if(upstreamBrake<0&&s.edgeActivity('long',8500).sectionSpeedKmh<45)upstreamBrake=i;
    assert.ok(Math.abs(s.totals().conservationResidual)<1e-6);
  }
  assert.ok(peak>7500&&activeEarly>20&&afterRampQueue>20,'a short queue at the exit may not hide the longer queue further ahead');
  assert.ok(downstreamBrake>=0&&upstreamBrake>downstreamBrake,'braking front moves physically upstream, not simultaneously on the entire motorway');
  assert.ok(s.totals().detouredVehicles>100);
  assert.ok(s.routingQueueLength('up',offset)<peak,'actual flow can already shorten the queue while the incident remains active');
  const downstream=s.edgeActivity('long',12000).sectionSpeedKmh;
  s.removeEvent('acc');s.setDemandPercent(65);
  // Empirically calibrated congested wave speed (18 rather than 22 km/h)
  // may take a little longer to release the last isolated cell.
  for(let i=0;i<90;i++)s.advance(12);
  assert.equal(s.routingQueueLength('up',offset),0);
  assert.ok(s.edgeActivity('long',12000).sectionSpeedKmh>downstream);
  assert.ok(Math.abs(s.totals().conservationResidual)<1e-6);
});

test('a free later exit stays preferred until the congestion reaches its approach',async()=>{
  const extra=roads();
  extra[1][4].splice(1,0,[50,7.045]);
  extra.push(['later','ramp','A3',1,[[50,7.045],[50.006,7.045]],'AS 2 · Abfahrt',7]);
  const s=(await make())({roads:extra});
  s.setSimulationStart(Date.parse('2026-11-13T13:00:00Z'));s.setDemandPercent(160);s.warmStart();s.setEvent(incident);
  for(let i=0;i<25;i++)s.advance(12);
  assert.ok(s.routingQueueLength('long',s.edgeActivity('long').lengthM*.02/.205)>3000);
  assert.equal(s.routingQueueLength('up',s.edgeActivity('up').lengthM*.4),0);
});

test('closure overlays and queue bands never overlap, even with vehicles trapped in the closed interval',async()=>{
  const s=(await make())({roads:roads()});
  s.setSimulationStart(Date.parse('2026-11-13T13:00:00Z'));s.setDemandPercent(160);s.warmStart();
  s.setEvent(incident);for(let i=0;i<30;i++)s.advance(12);
  assert.ok(s.visualBands('long').length>0);
  s.setEvent({id:'full',edgeId:'long',kind:'closure',offsetM:9000,lengthM:400,closedLanes:[0,1,2],speedKmh:0,shoulder:'normal',hasShoulder:false});
  for(let i=0;i<4;i++){
    for(const road of roads())for(const closed of s.closureBands(road[0]))for(const jam of s.visualBands(road[0]))
      assert.ok(jam.toM<=closed.fromM+.05||jam.fromM>=closed.toM-.05,road[0]);
    for(const g of s.jamSummaries())assert.ok(!s.closureBands(g.edgeId).some(c=>g.offsetM>c.fromM&&g.offsetM<c.toM));
    s.advance(12);
  }
  assert.ok(Math.abs(s.totals().conservationResidual)<1e-6);
});
