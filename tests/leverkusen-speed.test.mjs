import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';

async function engine(real=false){
  const window={};
  for(const f of ['traffic-reference',...(real?['legacy-geometry']:[]),'offline-traffic'])
    runInNewContext(await readFile(`web/${f}.js`,'utf8'),{window});
  return window;
}

test('A3 extends continuously through Dellbrück, Mülheim and Leverkusen to A1',async()=>{
  const w=await engine(true),data=w.STAU_LEGACY_GEOMETRY,s=w.createLegacyTrafficScenario(data);
  const roads=data.roads.filter(r=>r[1]==='mainline'&&r[2]==='A3'&&r[4][0][0]>50.96);
  assert.ok(roads.length>100);
  for(const r of roads){
    assert.ok(s.reachable(r[0]),r[0]);
    assert.equal(s.edgeActivity(r[0]).capacityVph,r[3]*1800);
  }
  for(const [id,n] of [['A3-53051821',4],['A3-29550391',4],['A3-34565957',3],['A3-126500248',3]])
    assert.equal(data.roads.find(r=>r[0]===id)[3],n,id);
  for(const name of ['Köln-Dellbrück','Köln-Mülheim','Leverkusen-Zentrum','AK Leverkusen']){
    assert.ok(data.junctions.some(j=>j[0]==='A3'&&j[2]===name));
    const ramps=data.roads.filter(r=>r[1]==='ramp'&&r[5].includes(name));
    assert.ok(ramps.length>4);assert.ok(ramps.every(r=>s.reachable(r[0])),name);
  }
  assert.equal(s.sourceProfiles().filter(p=>p.ref==='A3'&&p.kind==='mainline').length,2);
  assert.equal(s.queueRoadInfo({edgeId:'A3-992501211',offsetM:10}).destination,'Düsseldorf');
  assert.equal(s.queueRoadInfo({edgeId:'A3-126500248',offsetM:10}).direction,'A3-frankfurt');
  assert.equal(s.queueRoadInfo({edgeId:'A3-25341152',offsetM:10}).destination,'Köln','Köln remains the destination south of the city');
  assert.equal(s.queueRoadInfo({edgeId:'A3-126500248',offsetM:10}).destination,'Köln','reverse traffic approaches Köln');
  const road=data.roads.find(r=>r[0]==='A3-26493553');
  const ev=s.setEvent({id:'close',edgeId:road[0],offsetM:150,lengthM:5,kind:'closure',closedLanes:[0,1,2,3],
    speedKmh:0,hasShoulder:false,shoulder:'normal'});
  assert.match(ev.closureFrom,/Dellbrück/);assert.match(ev.closureTo,/Mülheim/);
  assert.ok(s.detourDestinations('close').some(n=>n.includes('Mülheim')));
});

test('a moving queue is not treated as a full standstill; time follows measured mean speed',async()=>{
  const w=await engine();let groups=[];
  for(const count of [1,2,3]){
    const s=w.createLegacyTrafficScenario({roads:[
      ['up','mainline','A3',3,[[50,7],[50,7.14]],'',1],
      ['bad','mainline','A3',3,[[50,7.14],[50,7.15]],'',2],
      ['after','mainline','A3',3,[[50,7.15],[50,7.20]],'',3]
    ]});
    s.setSimulationStart(Date.parse('2026-11-13T13:00:00Z'));s.setDemandPercent(130);s.warmStart();
    s.setEvent({id:'acc',edgeId:'bad',kind:'accident',closedLanes:Array.from({length:count},(_,i)=>i),offsetM:0,lengthM:200,
      speedKmh:count===3?0:50,shoulder:'normal',hasShoulder:false});
    for(let i=0;i<120;i++)s.advance(12);
    const g=s.jamSummaries().sort((a,b)=>b.lengthM-a.lengthM)[0];assert.ok(g.lengthM>7000);
    if(count<3){
      assert.ok(g.meanKmh>1&&Number.isFinite(g.delayMin));
      assert.ok(Math.abs(g.delayMin-g.lengthM*.06*(1/g.meanKmh-1/120))<.001);
      assert.ok(s.edgeActivity('bad',100).departedVph>1000);
    }else{
      assert.ok(g.meanKmh<=1.1);assert.ok(s.edgeActivity('bad',100).departedVph<1e-8);
      assert.ok(g.delayLowerBound&&g.delayMin===null,'no trustworthy ETA without discharge');
    }
    assert.ok(Math.abs(s.totals().conservationResidual)<1e-6);groups.push(g);
  }
  assert.ok(groups[0].meanKmh>12&&groups[0].delayMin<45,'moving 10 km queue must not be calculated as a standstill');
  assert.ok(groups[1].delayMin>groups[0].delayMin&&groups[1].meanKmh<groups[0].meanKmh);
});
