import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('AK Meckenheim: ramp-shaped A565 continuation is through traffic, not a small local exit',()=>{
  const window={};
  for(const file of ['traffic-reference','legacy-geometry','offline-traffic'])
    new Function('window',readFileSync('web/'+file+'.js','utf8'))(window);
  const s=window.createLegacyTrafficScenario(window.STAU_LEGACY_GEOMETRY);
  s.setSimulationStart(Date.parse('2026-11-20T12:00:00Z'));
  s.warmStart();
  for(let i=0;i<20;i++)s.advance(12);
  const through=s.edgeActivity('OSM-link-103652764');
  const transfer=s.edgeActivity('OSM-link-235746802');
  assert.ok(through.enteredVph>1000,'real A565 continuation must retain substantial traffic');
  assert.ok(through.enteredVph>transfer.enteredVph,'throughway is not assigned a small exit weight');
  assert.ok(transfer.enteredVph>100,'the A61 movement must remain active');
  assert.ok(Math.abs(s.totals().conservationResidual)<1e-6);
});
