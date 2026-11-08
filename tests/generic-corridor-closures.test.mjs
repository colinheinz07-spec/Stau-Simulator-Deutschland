import test from 'node:test';
import assert from 'node:assert/strict';
import {Strassennetz,Ereignisse,Umleitungen,Karte} from '../dist/index.js';

/** Absichtlich KEINE reale A3-Geometrie: beliebiges neutrales Autobahnkreuz.
 * Dieselben Tests müssen mit A7, A61, A100 etc. laufen.
 */
function network(ref='A7'){
  const coords={
    p0:[50,7],p1:[50,7.01],p2:[50,7.02],p3:[50,7.03],p4:[50,7.04],
    q0:[50.005,7.015],f:[50.005,7.020],x:[50.006,7.023],
    town:[50.01,7.03],outside:[50.015,7.03]
  };
  const nodes=Object.entries(coords).map(([id,point])=>({id,point}));
  let way=100;
  const create=(id,a,b,kind='mainline')=>({
    id,fromNodeId:a,toNodeId:b,geometry:[coords[a],coords[b]],osmWayIds:[way++],
    kind,osmClass:kind==='mainline'?'motorway':kind==='ramp'?'motorway_link':'secondary',
    ...(kind==='public'?{}:{motorwayRef:ref}),lanes:kind==='mainline'?3:1,
    lengthM:Strassennetz.distanceM(coords[a],coords[b]),
    freeSpeedKmh:kind==='mainline'?130:60,
    capacityPerLaneVph:kind==='mainline'?2100:1500
  });
  const edges=[
    create('up','p0','p1'),
    create('between-a','p1','p2'),
    create('between-b','p2','p3'),
    create('parallel','p2','p3'),
    create('after','p3','p4'),
    create('feeder','q0','f','ramp'),
    create('closed-branch','f','p2','ramp'),
    create('open-branch','f','p0','ramp'),
    create('direct-onramp','x','p2','ramp'),
    create('offramp','p2','town','ramp'),
    create('public-road','town','outside','public'),
    create('opposite-direction','p4','p3')
  ];
  const movementPairs=[
    ['up','between-a'],['between-a','between-b'],['between-a','parallel'],
    ['between-b','after'],['parallel','after'],
    ['feeder','closed-branch'],['feeder','open-branch'],
    ['closed-branch','between-b'],['closed-branch','parallel'],
    ['open-branch','up'],['direct-onramp','between-b'],
    ['between-a','offramp'],['offramp','public-road']
  ];
  const movements=movementPairs.map(([incomingEdgeId,outgoingEdgeId])=>
    ({incomingEdgeId,outgoingEdgeId,allowed:true}));
  return {schemaVersion:1,nodes,edges,movements};
}
const closure=(ref='A7')=>({
 id:'closure-one',motorwayRef:ref,fromNodeId:'p1',toNodeId:'p3',
 startMinute:5,endMinute:12
});
test('Eine bundesweite Sperrregel erfasst sämtliche gerichteten Hauptfahrbahnarme A→B',()=>{
  const n=network(),c=closure();
  assert.deepEqual(Strassennetz.validateNetwork(n),[]);
  const plan=Ereignisse.planCorridorClosure(n,c);
  assert.deepEqual(plan.mainlineEdgeIds,['between-a','between-b','parallel']);
  assert.ok(!plan.closedEdgeIds.includes('up'),'letzte Ausfahrt vor A bleibt offen');
  assert.ok(!plan.closedEdgeIds.includes('after'),'ab B offene Straße bleibt befahrbar');
  assert.ok(!plan.closedEdgeIds.includes('opposite-direction'),'Gegenrichtung bleibt offen');
});
test('Zufahrtsrampen bis zur Sperrung; gemeinsame Zufahrt vor freier Gabel bleibt offen',()=>{
  const n=network(),plan=Ereignisse.planCorridorClosure(n,closure());
  assert.deepEqual(plan.rampEdgeIds,['closed-branch','direct-onramp']);
  assert.ok(!plan.closedEdgeIds.includes('feeder'),'gemeinsame Zufahrt bleibt bis Gabel offen');
  assert.ok(!plan.closedEdgeIds.includes('open-branch'));
  assert.ok(!plan.closedEdgeIds.includes('offramp'),'offener Evakuierungsast bleibt offen');
  assert.ok(plan.blockedMovements.some(m=>
    m.incomingEdgeId==='up'&&m.outgoingEdgeId==='between-a'));
  assert.ok(plan.blockedMovements.some(m=>
    m.incomingEdgeId==='feeder'&&m.outgoingEdgeId==='closed-branch'));
  assert.ok(!plan.blockedMovements.some(m=>
    m.incomingEdgeId==='feeder'&&m.outgoingEdgeId==='open-branch'));
});
test('Fehlt eine offene Abzweigbeziehung, muss auch die komplette vorgelagerte Rampe geschlossen werden',()=>{
  const n=network();
  n.movements=n.movements.filter(m=>!(m.incomingEdgeId==='feeder'&&m.outgoingEdgeId==='open-branch'));
  const plan=Ereignisse.planCorridorClosure(n,closure());
  assert.ok(plan.rampEdgeIds.includes('feeder'));
});
test('Karte, Kapazität und Routing sehen dieselbe Sperrung; keine Phantomstaus',()=>{
  const n=network(),c=closure();
  const active=Ereignisse.activeNetworkClosures(n,[c],6);
  const edge=(id)=>n.edges.find(e=>e.id===id);
  assert.ok(active.blockedEdgeIds.has('closed-branch'));
  assert.equal(Ereignisse.capacityWithCorridorClosures(n,edge('between-a'),100,6,[],[c]),0);
  assert.equal(Ereignisse.capacityWithCorridorClosures(n,edge('direct-onramp'),10,6,[],[c]),0);
  assert.equal(Ereignisse.capacityWithCorridorClosures(n,edge('feeder'),10,6,[],[c]),1500);
  assert.deepEqual(Umleitungen.findRoute(n,'feeder','up',[],6,[c])?.edgeIds,
    ['feeder','open-branch','up']);
  assert.equal(Umleitungen.findRoute(n,'feeder','after',[],6,[c]),null);
  const map=Karte.motorwayMapEdges(n,[],[],6,[c]);
  for(const id of ['between-a','between-b','parallel','closed-branch','direct-onramp']){
    const r=map.find(x=>x.edgeId===id);
    assert.ok(r.closures.length,'fehlende rot-weiße Sperrmarkierung '+id);
    assert.equal(r.colour,'free','keine frei erfundenen stehenden Fahrzeuge');
  }
  for(const id of ['feeder','open-branch','up','after','offramp'])
    assert.deepEqual(map.find(x=>x.edgeId===id).closures,[],'fälschlich gesperrt: '+id);
  assert.deepEqual(Ereignisse.activeNetworkClosures(n,[c],12).spans,[]);
});
test('Dieselbe Logik funktioniert unverändert auf beliebigen anderen Autobahnen',()=>{
  for(const ref of ['A1','A3','A7','A61','A100']){
    const plan=Ereignisse.planCorridorClosure(network(ref),closure(ref));
    assert.deepEqual(plan.mainlineEdgeIds,['between-a','between-b','parallel']);
    assert.deepEqual(plan.rampEdgeIds,['closed-branch','direct-onramp']);
  }
});
test('Unverbundener Abschnitt oder falsche Richtung erzeugt niemals eine künstliche Sperrbrücke',()=>{
  const n=network();
  assert.throws(()=>Ereignisse.planCorridorClosure(n,{
    ...closure(),fromNodeId:'p3',toNodeId:'p1'
  }),/Keine gerichtete Autobahnverbindung/);
  n.movements=n.movements.filter(m=>!(m.incomingEdgeId==='between-a'&&m.outgoingEdgeId==='between-b')&&
    !(m.incomingEdgeId==='between-a'&&m.outgoingEdgeId==='parallel'));
  assert.throws(()=>Ereignisse.planCorridorClosure(n,closure()),/Keine gerichtete Autobahnverbindung/);
});
