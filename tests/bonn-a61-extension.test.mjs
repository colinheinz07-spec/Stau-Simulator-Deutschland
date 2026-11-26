import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';

async function scenario(){
  const window={};
  for(const f of ['traffic-reference','legacy-geometry','offline-traffic'])
    runInNewContext(await readFile(`web/${f}.js`,'utf8'),{window});
  return {data:window.STAU_LEGACY_GEOMETRY,s:window.createLegacyTrafficScenario(window.STAU_LEGACY_GEOMETRY)};
}

test('Bonn–Ahr–Koblenz: original carriageways and signed junctions are reachable',async()=>{
  const {s,data}=await scenario();
  for(const [ref,min,names] of [
    ['A565',150,['AD Bonn-Nordost','Bonn-Endenich','Bonn-Hardtberg','Merl','AK Meckenheim','Gelsdorf']],
    ['A61',200,['AK Meckenheim','AD Bad Neuenahr-Ahrweiler','AD Sinzig','Niederzissen','Wehr','Mendig','Kruft','Plaidt','AK Koblenz']],
    ['A571',20,['AD Sinzig','Löhndorf','Ehlingen']],
    ['A573',18,['AD Bad Neuenahr-Ahrweiler','Bad Neuenahr-West']]
  ]){
    const rows=data.roads.filter(r=>r[1]==='mainline'&&r[2]===ref);
    assert.ok(rows.length>=min,ref);
    for(const r of rows){
      assert.ok(s.reachable(r[0]),r[0]);
      assert.equal(s.edgeActivity(r[0]).capacityVph,r[3]*1800,r[0]);
    }
    for(const name of names)assert.ok(data.junctions.some(j=>j[0]===ref&&j[2]===name),name);
  }
  const ids=data.roads.map(r=>r[0]);assert.equal(new Set(ids).size,ids.length);
  assert.ok(s.sourceProfiles().some(p=>p.name.includes('Löhndorf')&&p.peakVph>0));
  assert.ok(s.sourceProfiles().some(p=>p.name.includes('Bad Neuenahr-West')&&p.peakVph>0));
  for(const ref of ['A571','A573'])assert.equal(s.sourceProfiles().filter(p=>p.ref===ref&&p.kind==='mainline').length,1,
    'the other end is physically fed by A61, not a second invented source');
});

test('full closures use the expanded real junctions and a mapped A61 return from A48',async()=>{
  const {s,data}=await scenario();
  for(const [id,from,to,dest] of [
    ['A565-211830618',/Lengsdorf/,/Hardtberg/,/Hardtberg/],
    ['A61-4412261',/Bad Neuenahr/,/Sinzig/,/Niederzissen/],
    ['A571-72490998',/Ehlingen/,/Löhndorf/,null],
    ['A573-28370970',/Bad Neuenahr-Ahrweiler/,/Bad Neuenahr-West/,/Bad Neuenahr-West/],
    ['A48-489943812',/Koblenz-Nord/,/AK Koblenz/,/A61.*Plaidt/]
  ]){
    const row=data.roads.find(r=>r[0]===id);
    const ev=s.setEvent({id,edgeId:id,offsetM:150,lengthM:5,kind:'closure',
      closedLanes:Array.from({length:row[3]},(_,i)=>i),speedKmh:0,hasShoulder:false,shoulder:'normal'});
    assert.match(ev.closureFrom,from);assert.match(ev.closureTo,to);
    assert.ok(ev.coveredLengthM>100);assert.equal(ev.truncated,false);
    if(dest)assert.ok(s.detourDestinations(id).some(s=>dest.test(s)),id);
    s.removeEvent(id);
  }
});
