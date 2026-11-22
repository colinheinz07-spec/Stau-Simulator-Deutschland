import test from 'node:test';
import assert from 'node:assert/strict';
import {Strassennetz,Stauphysik,Ereignisse} from '../dist/index.js';
import {sampleNetwork} from './fixture.mjs';
import {diversionShare,lengthDiversionShare} from '../dist/03_Stauphysik/netzfluss.js';

test('Freiwillige Abfahrten beginnen nach 60 Minuten, selbst bei vier Stunden bleibt Durchgangsverkehr',()=>{
  for(const [delay,share] of [[59.99,0],[60,.02],[90,.15],[120,.32],[180,.55],[240,.70],[360,.82],[480,.90],[720,.90]])
    assert.ok(Math.abs(diversionShare(delay)-share)<1e-9);
});
test('Staulänge ist ein ergänzendes progressives Signal nach Erreichen der 60-Minuten-Schwelle',()=>{
  for(const [m,share] of [[2999,0],[3000,.02],[5000,.07],[10000,.22],[20000,.45],[30000,.65],[100000,.65]])
    assert.ok(Math.abs(lengthDiversionShare(m)-share)<1e-9);
});

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
test('Kartenende mit letzter Abfahrtsrampe bleibt offener Autobahnabfluss',()=>{
  const graph=sampleNetwork();
  graph.edges=graph.edges.filter(edge=>edge.id!=='a3-east');
  graph.movements=graph.movements.filter(m=>m.incomingEdgeId!=='a3-east'&&
    m.outgoingEdgeId!=='a3-east');
  const engine=new Stauphysik.NetworkFlowEngine(graph,{stepSeconds:2,targetCellLengthM:120});
  for(let i=0;i<800;i++)engine.advance({'a3-west':3800});
  const stats=engine.snapshot();
  assert.ok(stats.exitedVehicles>1000,
    'unmodellierte Fortsetzung darf nicht auf einspurige letzte Rampe begrenzt werden');
  assert.ok(engine.speedSamples().find(s=>s.edgeId==='a3-west').speedKmh>80);
  assert.ok(Math.abs(stats.conservationResidual)<1e-6);
});

test('Geschlossene Rampenschleife ohne Ausfahrt erhält keinen Verkehr aus dem offenen Netz',()=>{
  const graph=sampleNetwork();
  graph.nodes.push({id:'f',point:[50.405,7.81]},{id:'g',point:[50.406,7.813]});
  const lookup=new Map(graph.nodes.map(n=>[n.id,n.point]));
  const template=graph.edges.find(e=>e.id==='ramp');
  for(const [id,fromNodeId,toNodeId] of [['trap','b','f'],['loop-a','f','g'],['loop-b','g','f']]){
    const geometry=[lookup.get(fromNodeId),lookup.get(toNodeId)];
    graph.edges.push({...template,id,fromNodeId,toNodeId,geometry,lengthM:Strassennetz.polylineLengthM(geometry)});
  }
  for(const [incomingEdgeId,outgoingEdgeId] of [['a3-west','trap'],['trap','loop-a'],['loop-a','loop-b'],['loop-b','loop-a']])
    graph.movements.push({incomingEdgeId,outgoingEdgeId,allowed:true});
  const engine=new Stauphysik.NetworkFlowEngine(graph);
  for(let i=0;i<2000;i++)engine.advance({'a3-west':3800});
  for(const id of ['trap','loop-a','loop-b'])assert.equal(engine.vehiclesOnEdge(id),0);
  assert.ok(engine.movementVph('a3-west','a3-east')>1000);
  assert.ok(Math.abs(engine.snapshot().conservationResidual)<1e-6);
});

test('Importierte Deutschlandkarte: schrittweise Ausleitung an einer echten offenen Abfahrt',()=>{
  const graph=sampleNetwork();
  const edge=graph.edges.find(e=>e.id==='a3-east');
  const end=[50.4,7.98];
  graph.nodes.find(n=>n.id==='c').point=end;
  edge.geometry=[edge.geometry[0],end];
  edge.lengthM=Strassennetz.polylineLengthM(edge.geometry);
  const engine=new Stauphysik.NetworkFlowEngine(graph,{stepSeconds:5,targetCellLengthM:180});
  const accident={id:'all-lanes',edgeId:edge.id,kind:'accident',
    fromM:edge.lengthM-180,toM:edge.lengthM,closedLanes:[0,1,2],startMinute:0};
  let tested=0,exitFlow=0,throughFlow=0;
  for(let i=0;i<720;i++){
    const delay=engine.routingDelayAhead('a3-west');
    const stats=engine.advance({'a3-west':5800},[accident]);
    if(delay>=45&&delay<180){
      throughFlow+=engine.movementVph('a3-west','a3-east');
      exitFlow+=engine.movementVph('a3-west','ramp');
      tested++;
    }
    assert.ok(Math.abs(stats.conservationResidual)<1e-6);
  }
  assert.ok(tested>100,'mit tatsächlich vorhandenem langem Stau testen');
  assert.ok(exitFlow>1000,'Fahrzeuge fahren durch die existierende Abfahrt');
  assert.ok(throughFlow>0,'Ein Teil fährt trotz Verzögerung weiter, soweit Platz vorhanden');
});

test('Nur reale Netzgrenzen erzeugen neue Nachfrage, niemals innere Autobahnabschnitte',()=>{
  const graph=sampleNetwork();
  const engine=new Stauphysik.NetworkFlowEngine(graph);
  assert.ok(!engine.sourceEdges().some(e=>e.id==='a3-east'));
  assert.throws(()=>engine.advance({'a3-west':-1}),/Ungültige Zuflussmenge/);
  assert.equal(engine.snapshot().generatedVehicles,0);
});

test('Vollsperrung: eine spätere noch freie Abfahrt verhindert verfrühte Umleitung',()=>{
  const graph=sampleNetwork();
  graph.nodes.push({id:'f',point:[50.4,8.02]},{id:'g',point:[50.4,8.03]},
    {id:'local',point:[50.41,7.82]});
  const template=graph.edges.find(e=>e.id==='a3-east');
  const edge=(id,from,to,kind='mainline')=>{
    const geometry=[graph.nodes.find(n=>n.id===from).point,graph.nodes.find(n=>n.id===to).point];
    return {...template,id,fromNodeId:from,toNodeId:to,kind,geometry,
      lengthM:Strassennetz.polylineLengthM(geometry),
      ...(kind==='ramp'?{lanes:1,freeSpeedKmh:80,capacityPerLaneVph:1500,osmClass:'motorway_link'}:{})};
  };
  graph.edges.push(edge('queue','c','f'),edge('closed','f','g'),edge('near-exit','c','local','ramp'));
  for(const [incomingEdgeId,outgoingEdgeId] of [['a3-east','queue'],['a3-east','near-exit'],['queue','closed']])
    graph.movements.push({incomingEdgeId,outgoingEdgeId,allowed:true});
  const engine=new Stauphysik.NetworkFlowEngine(graph,{stepSeconds:5,targetCellLengthM:180});
  const closure={id:'closure',edgeId:'closed',kind:'closure',fromM:0,
    toM:graph.edges.find(e=>e.id==='closed').lengthM,closedLanes:[0,1,2],startMinute:0};
  let checked=0,early=0,through=0;
  for(let i=0;i<1000;i++){
    const result=engine.advance({'a3-west':5800},[closure]);
    assert.ok(Math.abs(result.conservationResidual)<1e-6);
    if(engine.routingDelayAhead('a3-west')<60||engine.speedBands().some(b=>b.edgeId==='a3-east'))continue;
    const flow=engine.movementVph('a3-west','a3-east');
    if(flow<100)continue;
    early+=engine.movementVph('a3-west','ramp');through+=flow;checked++;
  }
  assert.ok(checked>10,'tatsächlich lange Verzögerung bei freier späterer Abfahrt');
  assert.ok(early/(early+through)<.15,'frühe Abfahrt behält nur ihren regulären Verkehr');
});

test('Auch unterhalb der Nennkapazität sinken bei hoher Nachfrage Geschwindigkeit und Betriebsleistung',()=>{
  const graph=sampleNetwork(),low=new Stauphysik.NetworkFlowEngine(graph),high=new Stauphysik.NetworkFlowEngine(graph);
  for(let i=0;i<600;i++){
    low.advance({'a3-west':600});high.advance({'a3-west':4300});
  }
  assert.ok(high.operatingCapacityVph('a3-west')<low.operatingCapacityVph('a3-west'));
  assert.ok(high.speedSamples().find(x=>x.edgeId==='a3-west').speedKmh<low.speedSamples().find(x=>x.edgeId==='a3-west').speedKmh);
  assert.ok(Math.abs(high.snapshot().conservationResidual)<1e-6);
});

test('Eine geplante Vollsperrung stoppt neue Einfahrten, lässt bereits eingeschlossene Fahrzeuge abfließen',()=>{
  const graph=sampleNetwork();
  const engine=new Stauphysik.NetworkFlowEngine(graph,{stepSeconds:2,targetCellLengthM:100});
  for(let i=0;i<210;i++)engine.advance({'a3-west':3300});
  const before=engine.vehiclesOnEdge('a3-east');
  const exited=engine.snapshot().exitedVehicles;
  assert.ok(before>0,'vor Sperrbeginn befinden sich Fahrzeuge im Korridor');
  const closure={id:'planned-closure',edgeId:'a3-east',kind:'closure',
    fromM:0,toM:graph.edges[1].lengthM,closedLanes:[0,1,2],startMinute:0};
  for(let i=0;i<240;i++)engine.advance({'a3-west':3300},[closure]);
  assert.ok(engine.vehiclesOnEdge('a3-east')<before*.02,
    'vorhandener Verkehr darf den gesperrten Korridor räumen');
  assert.ok(engine.snapshot().exitedVehicles>exited,
    'Fahrzeuge müssen im Modell regulär am realen Netzende abfließen');
  assert.ok(Math.abs(engine.snapshot().conservationResidual)<1e-6);
});
