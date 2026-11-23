import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';

test('Leverkusen A3/A1 combined closure leaves west-to-east A4 open through Gremberg toward Heumar',async()=>{
  const window={};
  for(const file of ['event-schedule','traffic-reference','legacy-geometry','offline-traffic'])
    runInNewContext(await readFile('web/'+file+'.js','utf8'),{window,Date,Intl,console});
  const s=window.createLegacyTrafficScenario(window.STAU_LEGACY_GEOMETRY);
  s.setSimulationStart(Date.parse('2026-11-23T16:00:00+01:00'));s.warmStart();
  const closureIDs=[
    'A3-29233698','A3-499192039',
    'A1-1305633075','A1-1458152965',
    'A1-909673377','A1-909673375'
  ];
  for(const [i,edgeId] of closureIDs.entries()){
    const r=s.setEvent({id:'lev-'+i,edgeId,kind:'closure',closedLanes:[0,1,2],
      speedKmh:0,shoulder:'normal',hasShoulder:false,offsetM:1,lengthM:500});
    assert.ok(/Leverkusen|Niehl/i.test(r.closureFrom+' '+r.closureTo));
  }
  assert.equal(s.closureBands('extra-a4-olpe').length,0,
    'A4 Gremberg–Heumar itself is not part of A3/A1 closures');
  for(let i=0;i<48;i++)s.step(5,i%12===11);
  const g=s.edgeActivity('extra-a4-olpe',15500);
  const h=s.edgeActivity('extra-a4-olpe',17500);
  assert.ok(g.sectionVph>1500,'normal A4 traffic must not disappear at Gremberg: '+g.sectionVph);
  assert.ok(h.sectionVph>1200,'normal A4 through traffic must continue toward Heumar: '+h.sectionVph);
  assert.ok(s.edgeActivity('extra-heumar-132614508').enteredVph>100);
  assert.ok(Math.abs(s.totals().conservationResidual)<1e-6);
});
