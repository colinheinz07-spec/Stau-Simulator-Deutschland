import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

async function scenario(closures){
  const window={};
  for(const file of ['traffic-reference','legacy-geometry','offline-traffic'])
    new Function('window',await readFile(`web/${file}.js`,'utf8'))(window);
  const s=window.createLegacyTrafficScenario(window.STAU_LEGACY_GEOMETRY);
  s.setSimulationStart(Date.parse('2026-11-22T14:45:00Z'));
  for(const [id,edgeId,offsetM,lanes] of closures)
    s.setEvent({id,edgeId,offsetM,kind:'closure',lengthM:200,closedLanes:Array.from({length:lanes},(_,i)=>i),speedKmh:0,shoulder:'normal',hasShoulder:false});
  s.warmStart();
  return s;
}

test('Sunday near Cologne: four closures must not divert at earlier open motorway exits',async()=>{
  const s=await scenario([
    ['heumar','A3-132624375',3,4],['south','A3-232272183',100,3],
    ['north','A3-35484178',100,3],['diez','A3-326086102',10,3]
  ]);
  const exits=['extra-heumar-132622476','extra-heumar-132622449'];
  const sources=['extra-heumar-132622453','extra-heumar-132622452'];
  assert.equal(s.movementBlocked('extra-a59-koeln','extra-a559-gremberg'),false,'Porz escape remains legal');
  for(let i=0;i<15;i++){
    s.advance(12);
    for(const id of exits)assert.equal(s.edgeActivity(id).diversionDemandFraction,0,'no early forced departure at Flughafen');
    for(const id of sources)assert.equal(s.edgeActivity(id).localSourceDetourFraction,0,'ordinary local entry is still legal');
    assert.ok(s.jamSummaries().every(g=>!['A4','A59'].includes(s.queueRoadInfo(g).ref)||g.lengthM<350||g.delayMin<1),
      'open A4/A59 routes must not acquire a phantom queue from remote closure plans');
    assert.ok(Math.abs(s.totals().conservationResidual)<1e-6);
  }
  assert.ok(s.edgeActivity('extra-a559-gremberg',50).sectionVph>100,'actual traffic continues via the later open motorway arm');
  assert.ok(s.closureBands('extra-a59-koeln').length,'the genuine blocked suffix remains closed');
});

test('simultaneous Heumar north/south closures preserve normal Poll and Flughafen departures until the real alternative is reached',async()=>{
  const s=await scenario([
    ['heumar-north','A3-132614491',20,3],['heumar-south','A3-318531283',150,3],
    ['dernbach-south','A3-232272183',100,3],['dernbach-north','A3-35484178',100,3]
  ]);
  const poll='extra-koelnsued-link-132610092',airport='extra-heumar-132622476';
  const gate=Math.min(...s.closureBands('extra-a4-olpe').map(b=>b.fromM));
  assert.ok(Math.abs(gate-15626.576)<1,'real closure begins at Gremberg, not Poll');
  for(let i=0;i<15;i++){
    s.advance(12);
    assert.equal(s.edgeActivity(poll).diversionDemandFraction,0,'ordinary local Poll traffic only, never a compulsory early exit');
    assert.equal(s.edgeActivity(airport).diversionDemandFraction,0,'ordinary local Flughafen traffic only');
    assert.ok(Math.abs(s.totals().conservationResidual)<1e-6);
  }
  assert.ok(s.edgeActivity('extra-a4-olpe',gate-120).sectionVph>100,'actual vehicles reach the true last legal motorway fork');
  assert.equal(s.edgeActivity('extra-a4-olpe',gate+250).sectionVph,0,'no traffic crosses the closed mainline gate');
});
