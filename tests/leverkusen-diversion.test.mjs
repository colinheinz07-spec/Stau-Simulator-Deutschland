import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('A3 Leverkusen: long total congestion never activates freely reachable early local exits',()=>{
  const w={};
  for(const file of ['traffic-reference','legacy-geometry','offline-traffic'])
    new Function('window',readFileSync(`web/${file}.js`,'utf8'))(w);
  const s=w.createLegacyTrafficScenario(w.STAU_LEGACY_GEOMETRY);
  s.setSimulationStart(Date.parse('2026-11-22T14:00:00Z'));
  s.warmStart();
  s.setEvent({id:'lev',edgeId:'A3-126500245',offsetM:250,kind:'accident',closedLanes:[0,1,2],lengthM:100,speedKmh:0});
  assert.ok(s.detourDestinations('lev').some(s=>s.includes('Leverkusen-Opladen')));
  for(let i=0;i<20;i++)s.advance(12);
  assert.ok(s.edgeActivity('OSM-link-215665874').diversionDemandFraction>0,'last mapped local exit has a proven bypass');
  assert.equal(s.edgeActivity('OSM-link-49142413').diversionDemandFraction,0,'still clear earlier exit');
  assert.equal(s.edgeActivity('extra-osm-ramp-gap-2a232fbd3c75').diversionDemandFraction,0);
  for(let i=20;i<40;i++)s.advance(12);
  const q=s.jamSummaries().find(g=>g.endEdgeId==='A3-126500245');
  assert.ok(q&&q.routingDelayMin>=120,'actual multihour queue');
  const exit=s.edgeActivity('OSM-link-215665874');
  assert.ok(exit.diversionDemandFraction>0&&exit.diversionDemandFraction<1,'last mapped local exit remains voluntary');
  assert.equal(s.edgeActivity('OSM-link-49142413').diversionDemandFraction,0,'earlier free approach is not activated by distant delay');
  assert.ok(exit.enteredVph>100&&exit.departedVph>100);
  assert.ok(s.jamSummaries().length>0,'congestion still grows in the actual network');
  assert.equal(s.edgeActivity('extra-osm-ramp-gap-2a232fbd3c75').diversionDemandFraction,0,'still clear earlier exit');
  assert.equal(s.diversionShare(44.99),0);assert.equal(s.diversionShare(45),.20);assert.equal(s.diversionShare(60),.25);
  assert.ok(Math.abs(s.diversionShare(240)-.85)<1e-9);assert.equal(s.diversionShare(480),1);
  assert.ok(Math.abs(s.totals().conservationResidual)<1e-6);
});
