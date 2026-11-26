import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';

async function engine(){
  const window={};
  for(const f of ['traffic-reference','legacy-geometry','offline-traffic'])
    runInNewContext(await readFile(`web/${f}.js`,'utf8'),{window});
  const data=window.STAU_LEGACY_GEOMETRY;
  return {data,scenario:window.createLegacyTrafficScenario(data)};
}
test('Cologne ring: A1 continuously linked from Cologne-West to Leverkusen; A57/A59 transfers reachable',async()=>{
  const {data,scenario:s}=await engine();
  for(const ref of ['A1','A57','A59']){
    const roads=data.roads.filter(r=>r[1]==='mainline'&&r[2]===ref&&(ref!=='A59'||r[4][0][0]>51));
    assert.ok(roads.length>=15,ref);
    for(const r of roads){assert.ok(s.reachable(r[0]),r[0]);assert.equal(s.edgeActivity(r[0]).capacityVph,r[3]*1800);}
    const sources=s.sourceProfiles().filter(p=>p.ref===ref&&p.kind==='mainline'&&(ref!=='A59'||/Düsseldorf|Leverkusen/.test(p.name)));
    assert.equal(sources.length,2,ref);
    assert.ok(sources.every(p=>p.peakVph>0));
  }
  for(const name of ['Köln-Lövenich','Köln-Bocklemünd','AK Köln-Nord','Köln-Longerich','Köln-Niehl','AK Leverkusen-West','Köln-Chorweiler','Köln-Bickendorf']){
    const ramps=data.roads.filter(r=>r[1]==='ramp'&&r[5].includes(name));
    assert.ok(ramps.length>=3,name);
    for(const r of ramps)assert.ok(s.reachable(r[0]),r[0]);
  }
  const row=id=>data.roads.find(r=>r[0]===id);
  assert.equal(row('A1-7854060')[3],3);
  assert.equal(row('A1-389508665')[3],2,'existing two-lane throat, not planned widening');
  assert.equal(row('A57-4436755')[3],2,'A57 north of Köln-Nord existing four lanes');
  assert.equal(row('A57-155444202')[3],3,'existing south-side three lanes');
  const e=s.setEvent({id:'close',edgeId:'A1-134149637',offsetM:150,lengthM:5,kind:'closure',closedLanes:[0,1,2],speedKmh:0,hasShoulder:false,shoulder:'normal'});
  assert.match(e.closureFrom,/Köln-Nord/);assert.match(e.closureTo,/Köln-Niehl/);
  assert.ok(s.closureBands('OSM-link-31415387').length,'real A57 feeder to A1 blocked');
  assert.ok(s.detourDestinations('close').some(x=>x.includes('Köln-Niehl')));
  // The other A57 direction remains an actual available alternative.
  assert.equal(s.closureBands('A57-4436755').length,0);
  s.setSimulationStart(Date.parse('2026-11-20T13:30:00Z'));s.warmStart();s.advance(36);
  assert.ok(s.totals().vehiclesOnNetwork>1000);
  assert.ok(Math.abs(s.totals().conservationResidual)<1e-6);
});
