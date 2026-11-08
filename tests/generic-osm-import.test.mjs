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
    // Kartenlinien berühren sich beinahe, aber OSM-Node 10 ist NICHT Node 3.
    {type:'way',id:108,nodes:[10,9],tags:{highway:'motorway_link',oneway:'yes'}}
  ];
  return [...nodes,...ways];
}
const byWay=(net,id)=>net.edges.filter(e=>e.osmWayIds.includes(id));
test('Importer ist bundesweit und erfasst alle motorway_link-Wege mit originaler Geometrie',()=>{
  for(const ref of ['A3','A7','A61','A100']){
    const {network:n,audit}=Strassennetz.importOsmNetwork(example(ref),{includePublicRoads:true});
    assert.deepEqual(Strassennetz.validateNetwork(n),[]);
    assert.equal(audit.importedMotorwayWays,1);
    assert.equal(audit.importedRampWays,4);
    assert.equal(audit.importedPublicWays,2);
    assert.ok(audit.excludedWays.some(x=>x.id===106));
    assert.equal(audit.unrepresentedSourceSegments.length,0);
    assert.equal(audit.representedDirectedSourceSegments,audit.expectedDirectedSourceSegments);
    assert.equal(byWay(n,101).length,3,'OSM-Motorway muss exakt an allen Rampen-Knoten gesplittet sein');
    assert.equal(byWay(n,102).length,1);
    assert.equal(byWay(n,103).length,1);
    assert.equal(byWay(n,107).length,1);
    assert.equal(byWay(n,108).length,1,'auch nicht ans Netz angeschlossene Quellrampen werden erfasst');
    assert.equal(byWay(n,102)[0].motorwayRef,undefined,'keine Autobahn-Nummer auf OSM-Link erfinden');
    assert.equal(byWay(n,107)[0].fromNodeId,'osm-node:4','oneway=-1 muss umkehren');
    assert.deepEqual(new Set(Karte.motorwayMapEdges(n).map(x=>x.edgeId)),
      new Set(n.edges.filter(e=>e.kind!=='public').map(e=>e.id)));
  }
});
test('OSM Node ist Anschluss, nicht allein die geografische Nähe oder pinke Kartenfarbe',()=>{
  const {network:n}=Strassennetz.importOsmNetwork(example(),{includePublicRoads:true});
  const from=byWay(n,101).find(e=>e.toNodeId==='osm-node:3');
  const near=byWay(n,108)[0];
  assert.ok(from && near);
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
  assert.throws(()=>Strassennetz.importOsmNetwork([...example(),rel]),/Ungeprüfte OSM-Abbiegerelation/);
  const a=Strassennetz.importOsmNetwork([...example(),rel],{strict:false}).audit;
  assert.ok(a.issues.some(x=>x.includes('Ungeprüfte OSM-Abbiegerelation')));
});
test('Ein Neubau mit anderer Autobahnnummer braucht keine Änderung an der Importlogik',()=>{
  const first=Strassennetz.importOsmNetwork(example('A7'),{includePublicRoads:true});
  const second=Strassennetz.importOsmNetwork(example('A61'),{includePublicRoads:true});
  assert.deepEqual(first.network.edges.map(x=>x.id),second.network.edges.map(x=>x.id));
  assert.ok(second.network.edges.filter(x=>x.kind==='mainline').every(x=>x.motorwayRef==='A61'));
});
