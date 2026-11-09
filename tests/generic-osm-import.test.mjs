import test from 'node:test';
import assert from 'node:assert/strict';
import {Strassennetz,Karte,Umleitungen} from '../dist/index.js';

function example(ref='A7'){
  const coords=[
    [1,50,7.000],[2,50,7.010],[3,50,7.020],[4,50,7.030],
    [5,50.005,7.010],[6,50.006,7.020],
    [7,50.010,7.008],[8,50.010,7.030],[9,50.010,7.011],
    [10,50.000001,7.020001],[11,50.011,7.028]
  ];
  const nodes=coords.map(([id,lat,lon])=>({type:'node',id,lat,lon}));
  const ways=[
    {type:'way',id:101,nodes:[1,2,3,4],tags:{highway:'motorway',ref,lanes:'3',oneway:'yes'}},
    {type:'way',id:102,nodes:[5,2],tags:{highway:'motorway_link',oneway:'yes'}},
    {type:'way',id:103,nodes:[3,6],tags:{highway:'motorway_link',oneway:'yes'}},
    {type:'way',id:104,nodes:[7,5],tags:{highway:'secondary',lanes:'2'}},
    {type:'way',id:105,nodes:[6,8],tags:{highway:'secondary',lanes:'2'}},
    {type:'way',id:106,nodes:[2,9],tags:{highway:'motorway_link',destination:'Raststätte Muster'}},
    {type:'way',id:107,nodes:[11,4],tags:{highway:'motorway_link',oneway:'-1'}},
    {type:'way',id:109,nodes:[11,8],tags:{highway:'secondary',lanes:'2'}}
  ];
  return [...nodes,...ways];
}
const byWay=(net,id)=>net.edges.filter(e=>e.osmWayIds.includes(id));
test('Importer ist bundesweit und erfasst alle motorway_link-Wege mit originaler Geometrie',()=>{
  for(const ref of ['A3','A7','A61','A100']){
    const {network:n,audit}=Strassennetz.importOsmNetwork(example(ref),{includePublicRoads:true});
    assert.deepEqual(Strassennetz.validateNetwork(n),[]);
    assert.equal(audit.importedMotorwayWays,1);
    assert.equal(audit.importedRampWays,3);
    assert.equal(audit.importedPublicWays,3);
    assert.ok(audit.excludedWays.some(x=>x.id===106));
    assert.equal(audit.unrepresentedSourceSegments.length,0);
    assert.equal(audit.representedDirectedSourceSegments,audit.expectedDirectedSourceSegments);
    assert.equal(byWay(n,101).length,3,'OSM-Motorway muss exakt an allen Rampen-Knoten gesplittet sein');
    assert.equal(byWay(n,102).length,1);
    assert.equal(byWay(n,103).length,1);
    assert.equal(byWay(n,107).length,1);
    assert.equal(audit.unconnectedRampEnds.length,0,'echte Zufahrten müssen bis zur Ortsstraße verbunden sein');
    assert.equal(byWay(n,102)[0].motorwayRef,undefined,'keine Autobahn-Nummer auf OSM-Link erfinden');
    assert.equal(byWay(n,107)[0].fromNodeId,'osm-node:4','oneway=-1 muss umkehren');
    assert.deepEqual(new Set(Karte.motorwayMapEdges(n).map(x=>x.edgeId)),
      new Set(n.edges.filter(e=>e.kind!=='public').map(e=>e.id)));
  }
});
test('OSM Node ist Anschluss, nicht allein die geografische Nähe oder pinke Kartenfarbe',()=>{
  const disconnected={type:'way',id:108,nodes:[10,9],tags:{highway:'motorway_link',oneway:'yes'}};
  const input=[...example(),disconnected];
  assert.throws(()=>Strassennetz.importOsmNetwork(input,{includePublicRoads:true}),
    /Rampenenden ohne nachgewiesene/,'ein fehlendes Rampenstück darf den Import nicht bestehen');
  const {network:n,audit}=Strassennetz.importOsmNetwork(input,{
    includePublicRoads:true,strict:false
  });
  const from=byWay(n,101).find(e=>e.toNodeId==='osm-node:3');
  const near=byWay(n,108)[0];
  assert.ok(from && near);
  assert.equal(audit.unconnectedRampEnds.length,2);
  assert.ok(!n.movements.some(m=>m.incomingEdgeId===from.id&&m.outgoingEdgeId===near.id));
  assert.equal(Umleitungen.findRoute(n,from.id,near.id),null);
});
test('Automatisch importierte Rampen führen legal in Hauptfahrbahnen und Abfahrten',()=>{
  const {network:n}=Strassennetz.importOsmNetwork(example(),{includePublicRoads:true});
  const rampOn=byWay(n,102)[0];
  const following=byWay(n,101).find(e=>e.fromNodeId==='osm-node:2');
  assert.ok(n.movements.some(m=>m.incomingEdgeId===rampOn.id&&m.outgoingEdgeId===following.id));
  const rampOff=byWay(n,103)[0];
  const publicOut=byWay(n,105).find(e=>e.fromNodeId==='osm-node:6');
  assert.ok(n.movements.some(m=>m.incomingEdgeId===rampOff.id&&m.outgoingEdgeId===publicOut.id));
});
test('OSM restriction=no_* blockiert betreffende Fahrbeziehung (via OSM-Knoten)',()=>{
  const relation={type:'relation',id:109,tags:{type:'restriction',restriction:'no_right_turn'},members:[
    {type:'way',ref:101,role:'from'},{type:'node',ref:3,role:'via'},
    {type:'way',ref:103,role:'to'}
  ]};
  const {network:n}=Strassennetz.importOsmNetwork([...example(),relation],{includePublicRoads:true});
  const incoming=byWay(n,101).find(e=>e.toNodeId==='osm-node:3');
  const off=byWay(n,103)[0];
  assert.ok(!n.movements.some(m=>m.incomingEdgeId===incoming.id&&m.outgoingEdgeId===off.id));
  const straight=byWay(n,101).find(e=>e.fromNodeId==='osm-node:3');
  assert.ok(n.movements.some(m=>m.incomingEdgeId===incoming.id&&m.outgoingEdgeId===straight.id));
});
test('OSM restriction=only_* blockiert alle anderen möglichen Abbieger',()=>{
  const rel={type:'relation',id:109,tags:{type:'restriction',restriction:'only_straight_on'},members:[
    {type:'way',ref:101,role:'from'},{type:'node',ref:3,role:'via'},
    {type:'way',ref:101,role:'to'}
  ]};
  const {network:n}=Strassennetz.importOsmNetwork([...example(),rel],{includePublicRoads:true});
  const incoming=byWay(n,101).find(e=>e.toNodeId==='osm-node:3');
  const exits=n.movements.filter(m=>m.incomingEdgeId===incoming.id);
  assert.equal(exits.length,1);
  assert.equal(exits[0].outgoingEdgeId,byWay(n,101).find(e=>e.fromNodeId==='osm-node:3').id);
});
test('Unvollständige OSM-Snapshots oder komplexe via-way-Restrictions werden nicht stillschweigend als fertig akzeptiert',()=>{
  const raw=example().filter(el=>!(el.type==='node'&&el.id===2));
  assert.throws(()=>Strassennetz.importOsmNetwork(raw),/fehlender Knotenkoordinate/);
  const rel={type:'relation',id:130,tags:{type:'restriction',restriction:'no_left_turn'},members:[
    {type:'way',ref:101,role:'from'},{type:'way',ref:102,role:'via'},
    {type:'way',ref:103,role:'to'}
  ]};
  assert.throws(()=>Strassennetz.importOsmNetwork([...example(),rel]),/OSM via-way Relation/);
  const a=Strassennetz.importOsmNetwork([...example(),rel],{strict:false}).audit;
  assert.ok(a.issues.some(x=>x.includes('OSM via-way Relation')));
});
test('Ein Neubau mit anderer Autobahnnummer braucht keine Änderung an der Importlogik',()=>{
  const first=Strassennetz.importOsmNetwork(example('A7'),{includePublicRoads:true});
  const second=Strassennetz.importOsmNetwork(example('A61'),{includePublicRoads:true});
  assert.deepEqual(first.network.edges.map(x=>x.id),second.network.edges.map(x=>x.id));
  assert.ok(second.network.edges.filter(x=>x.kind==='mainline').every(x=>x.motorwayRef==='A61'));
});

test('Gemeinsame Autobahnfahrbahn (z.B. A3/A4) wird EINMAL importiert, beide Nummern bleiben erhalten',()=>{
  const elements=example('A3; A4');
  const {network:n,audit}=Strassennetz.importOsmNetwork(elements,{includePublicRoads:true});
  assert.equal(audit.importedMotorwayWays,1);
  const main=byWay(n,101);
  assert.ok(main.length>0);
  assert.ok(main.every(e=>e.motorwayRef==='A3'&&
    JSON.stringify(e.motorwayRefs)===JSON.stringify(['A3','A4'])));
  assert.deepEqual(Strassennetz.validateNetwork(n),[]);
});

test('Bundesweite fremde Abbiegerelationen dürfen den Autobahn-only-Import nicht blockieren',()=>{
  const irrelevant={type:'relation',id:9001,
    tags:{type:'restriction',restriction:'no_left_turn:conditional'},
    members:[
      {type:'way',ref:50000000,role:'from'},
      {type:'way',ref:50000001,role:'via'},
      {type:'way',ref:50000002,role:'to'}
    ]
  };
  const {audit}=Strassennetz.importOsmNetwork([...example(),irrelevant]);
  assert.deepEqual(audit.issues,[]);
});

test('Fehlende Autobahnnummer wird nur durch reale gemeinsame Hauptfahrbahn-OSM-Nodes bestimmt',()=>{
  const elements=example();
  const main=elements.find(e=>e.type==='way'&&e.id===101);
  main.nodes=[1,2];
  const extension={type:'way',id:9102,nodes:[2,3],
    tags:{highway:'motorway',oneway:'yes',lanes:'3'}};
  const next={type:'way',id:9105,nodes:[3,4],
    tags:{highway:'motorway',ref:'A7',oneway:'yes',lanes:'3'}};
  const {network,audit}=Strassennetz.importOsmNetwork([...elements,extension,next],{includePublicRoads:true});
  const inferred=byWay(network,9102)[0];
  assert.equal(inferred.motorwayRef,'A7');
  assert.deepEqual(inferred.motorwayRefs,['A7']);
  assert.ok(audit.inferredMotorwayRefs.some(x=>x.wayId===9102&&x.evidenceWayIds.includes(101)));
});
test('Zusammentreffen zweier Autobahnen ohne eindeutiges ref wird NIEMALS geraten',()=>{
 const elements=example();
 const main=elements.find(e=>e.type==='way'&&e.id===101);
 main.nodes=[1,2];
 const adjacent={type:'way',id:9103,nodes:[2,9],tags:{highway:'motorway',ref:'A4',oneway:'yes'}};
 const ambiguous={type:'way',id:9104,nodes:[2,3],tags:{highway:'motorway',oneway:'yes'}};
 const {network,audit}=Strassennetz.importOsmNetwork([...elements,adjacent,ambiguous],
   {includePublicRoads:true,strict:false});
 assert.ok(audit.unassignedMotorwayWays.includes(9104));
 assert.ok(byWay(network,9104).length>0,'physische Hauptfahrbahn darf nicht stillschweigend verschwinden');
 const same=Strassennetz.importOsmNetwork([...elements,adjacent,ambiguous],{
   includePublicRoads:true,strict:false
 });
 assert.equal(byWay(same.network,9104)[0].motorwayRef,undefined,
   'unbestimmte Nummer darf nicht aus benachbartem Autobahnkreuz geraten');
});

test('Deutsche OSM-Autobahnrelation liefert ref ohne irgendeine Autobahn-Sonderliste',()=>{
 const elements=example();
 const motorway=elements.find(e=>e.type==='way'&&e.id===101);
 delete motorway.tags.ref;
 const routeRelation={
   type:'relation',id:991000,
   tags:{type:'route',route:'road',ref:'A 27',name:'Bundesautobahn 27'},
   members:[{type:'way',ref:101,role:''}]
 };
 const {network,audit}=Strassennetz.importOsmNetwork([...elements,routeRelation],{includePublicRoads:true});
 const way=byWay(network,101);
 assert.ok(way.every(x=>x.motorwayRef==='A27'));
 assert.ok(audit.inferredMotorwayRefs.some(x=>x.wayId===101&&
   x.refs.includes('A27')&&x.evidenceRelationIds.includes(991000)));
});

test('Rastplatz-/Betriebsrampen, die ausschließlich an highway=service enden, werden nicht als normale AS projiziert',()=>{
  const elements=example();
  const extra=[
    {type:'node',id:501,lat:50.015,lon:7.040},
    {type:'node',id:502,lat:50.017,lon:7.040},
    {type:'way',id:901,nodes:[501,4],tags:{highway:'motorway_link',oneway:'yes'}},
    {type:'way',id:902,nodes:[502,501],tags:{highway:'service',service:'parking_aisle'}}
  ];
  const {network,audit}=Strassennetz.importOsmNetwork([...elements,...extra],{includePublicRoads:true});
  assert.equal(byWay(network,901).length,0);
  assert.ok(audit.excludedWays.some(x=>x.id===901&&x.reason.includes('Betriebs')));
  assert.equal(audit.unconnectedRampEnds.length,0);
});

test('Closed OSM roundabouts and motorway loops preserve every source segment without any fake self-loop',()=>{
 const source=example();
 source.push(
  {type:'node',id:601,lat:50.020,lon:7.050},
  {type:'node',id:602,lat:50.021,lon:7.051},
  {type:'node',id:603,lat:50.020,lon:7.052},
  {type:'node',id:604,lat:50.019,lon:7.051},
  {type:'way',id:605,nodes:[601,602,603,604,601],
    tags:{highway:'secondary',junction:'roundabout',oneway:'yes'}}
 );
 const {network,audit}=Strassennetz.importOsmNetwork(source,{
   includePublicRoads:true,strict:false
 });
 assert.equal(audit.unrepresentedSourceSegments.length,0);
 assert.ok(!audit.issues.some(i=>i.includes('Null-/Ringsegment prüfen 605')));
 const arcs=network.edges.filter(e=>e.osmWayIds.includes(605));
 assert.equal(arcs.length,2);
 assert.ok(arcs.every(e=>e.fromNodeId!==e.toNodeId));
 assert.deepEqual(Strassennetz.validateNetwork(network),[]);
});
