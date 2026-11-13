import test from 'node:test';
import assert from 'node:assert/strict';
import {Strassennetz,Stauphysik,Ereignisse} from '../dist/index.js';
import {sampleNetwork} from './fixture.mjs';

test('Jede echte Rampe erhält explizite gerichtete Ein- und Ausgänge, keine imaginären Fahrbeziehungen',()=>{
  const graph=sampleNetwork();
  const audit=Strassennetz.auditConnections(graph);
  assert.equal(audit.invalidMovements.length,0);
  assert.equal(audit.motorwayRampCount,1);
  assert.equal(audit.rampFindings[0].kind,'connected');
  assert.equal(audit.isolatedRamps,0);
  graph.movements=graph.movements.filter(m=>m.outgoingEdgeId!=='ramp');
  assert.equal(Strassennetz.auditConnections(graph).rampSources,1);
  assert.equal(Strassennetz.auditConnections(graph).rampFindings[0].kind,'source-end');
});
test('Räumliches Zellmodell erzeugt und vernichtet keinerlei Fahrzeuge – auch bei stockendem Abfluss',()=>{
  const graph=sampleNetwork();
  const engine=new Stauphysik.NetworkFlowEngine(graph,{stepSeconds:2,targetCellLengthM:120});
  assert.ok(engine.sourceEdges().some(e=>e.id==='a3-west'));
  const input={'a3-west':5800};
  for(let i=0;i<320;i++){
    const p=engine.advance(input);
    assert.ok(Math.abs(p.conservationResidual)<1e-6);
    assert.ok(p.generatedVehicles>=p.exitedVehicles);
    assert.ok(p.vehiclesOnNetwork>=0);
  }
  const s=engine.snapshot();
  assert.ok(s.generatedVehicles>1000);
  assert.ok(s.exitedVehicles>0);
  assert.ok(s.vehiclesOnNetwork>0);
  const colors=engine.speedSamples();
  assert.equal(colors.length,graph.edges.length);
  assert.ok(colors.every(x=>Number.isFinite(x.speedKmh)&&x.speedKmh>0));
});
test('Eine Vollsperrung hält Fahrzeuge stromaufwärts; die Rampe wird nicht allein durch die Sperr-Entfernung rot',()=>{
  const graph=sampleNetwork();
  const engine=new Stauphysik.NetworkFlowEngine(graph,{stepSeconds:2,targetCellLengthM:100});
  const laneClosure={
    id:'unfall-a3',edgeId:'a3-east',kind:'closure',
    fromM:0,toM:graph.edges[1].lengthM,closedLanes:[0,1,2],startMinute:0
  };
  const first=engine.speedSamples();
  assert.equal(first.find(x=>x.edgeId==='ramp').speedKmh,80);
  for(let i=0;i<350;i++){
    const p=engine.advance({'a3-west':6000},[laneClosure]);
    assert.ok(Math.abs(p.conservationResidual)<1e-6);
  }
  const current=engine.speedSamples();
  assert.equal(current.find(x=>x.edgeId==='a3-east').speedKmh,130,
    'leerer gesperrter Abschnitt wird rot-weiß, nicht künstlich als stehender Stau gefärbt');
  assert.ok(current.find(x=>x.edgeId==='a3-west').speedKmh<130,
    'am tatsächlichen Engpass müssen sich Fahrzeuge physikalisch aufstauen');
  const bands=engine.speedBands();
  assert.ok(bands.length>0,'Rückstau muss als konkrete belegte Zellen gemeldet werden');
  assert.ok(bands.every(x=>x.toM>x.fromM&&x.speedKmh<=65),
    'keine flächigen Phantomstaus außerhalb der wirklich verlangsamten Zellen');
  assert.ok(bands.some(x=>x.edgeId==='a3-west'));
});
test('Eine nur einspurige Unfallstelle wirkt auf den konkreten Fahrweg statt auf alle Kreuzungsarme',()=>{
  const graph=sampleNetwork();
  const event={id:'crash',edgeId:'a3-east',kind:'accident',
    fromM:0,toM:graph.edges[1].lengthM,closedLanes:[0,1],startMinute:0};
  const engine=new Stauphysik.NetworkFlowEngine(graph,{stepSeconds:2,targetCellLengthM:120});
  for(let i=0;i<160;i++)engine.advance({'a3-west':6200},[event]);
  const samples=engine.speedSamples();
  assert.ok(Math.abs(engine.snapshot().conservationResidual)<1e-6);
  assert.equal(Ereignisse.capacityAtPosition(graph.edges[2],5,0,[event]),1500);
  assert.ok(samples.find(x=>x.edgeId==='a3-west').speedKmh<130,
    'die reduzierte Kapazität erzeugt Rückstau VOR dem Engpass, nicht zwangsläufig in ihm');
});
test('Nur reale Netzgrenzen erzeugen neue Nachfrage, niemals innere Autobahnabschnitte',()=>{
  const graph=sampleNetwork();
  const engine=new Stauphysik.NetworkFlowEngine(graph);
  assert.ok(!engine.sourceEdges().some(e=>e.id==='a3-east'));
  assert.throws(()=>engine.advance({'a3-west':-1}),/Ungültige Zuflussmenge/);
  assert.equal(engine.snapshot().generatedVehicles,0);
});
