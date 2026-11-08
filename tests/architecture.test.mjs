import test from 'node:test';
import assert from 'node:assert/strict';
import {Strassennetz,Karte,Umleitungen,Ereignisse} from '../dist/index.js';
import {sampleNetwork} from './fixture.mjs';

test('Echte gerichtete OSM-Geometrie und getrennte Straßenarten',()=>{
  const net=sampleNetwork();
  assert.deepEqual(Strassennetz.validateNetwork(net),[]);
  const visible=Karte.motorwayMapEdges(net);
  assert.deepEqual(visible.map(f=>f.edgeId),['a3-west','a3-east','ramp']);
  assert.ok(visible.every(f=>f.colour==='free' && f.source==='initial-free'));
  assert.equal(visible.find(f=>f.edgeId==='town'),undefined);
});
test('Falsche Rampenklasse und erfundene Anschlusskanten werden abgelehnt',()=>{
  const net=sampleNetwork();
  net.edges[2].osmClass='secondary';
  assert.ok(Strassennetz.validateNetwork(net).some(e=>e.includes('kein motorway_link')));
  net.edges[2].osmClass='motorway_link';
  net.movements.push({incomingEdgeId:'a3-west',outgoingEdgeId:'town',allowed:true});
  assert.ok(Strassennetz.validateNetwork(net).some(e=>e.includes('ohne identischen OSM-Knoten')));
});
test('Unverbundene Straßen werden nicht heimlich zu einer Route verbunden',()=>{
  const net=sampleNetwork();
  assert.deepEqual(Umleitungen.findRoute(net,'a3-west','town')?.edgeIds,
    ['a3-west','ramp','town']);
  net.movements=net.movements.filter(m=>m.outgoingEdgeId!=='ramp');
  assert.equal(Umleitungen.findRoute(net,'a3-west','town'),null);
});
test('Vollsperrung sperrt nur den betroffenen gerichteten Fahrweg, nicht jede benachbarte Rampe',()=>{
  const net=sampleNetwork(),edge=net.edges[1];
  const closure={id:'block',edgeId:edge.id,kind:'closure',fromM:0,toM:edge.lengthM,
    closedLanes:[0,1,2],startMinute:0};
  assert.deepEqual(Ereignisse.validateEvent(closure,edge),[]);
  assert.equal(Ereignisse.capacityAtPosition(edge,edge.lengthM/2,1,[closure]),0);
  assert.equal(Ereignisse.capacityAtPosition(net.edges[2],5,1,[closure]),1500);
  assert.deepEqual(Umleitungen.findRoute(net,'a3-west','town',[closure],1)?.edgeIds,
    ['a3-west','ramp','town']);
  assert.equal(Umleitungen.findRoute(net,'a3-west','a3-east',[closure],1),null);
});
test('Kartenfarbe folgt Geschwindigkeit, Sperrmarkierung folgt Ereignis',()=>{
  const net=sampleNetwork(),edge=net.edges[1];
  const e={id:'block',edgeId:edge.id,kind:'closure',fromM:50,toM:100,
    closedLanes:[0,1,2],startMinute:0};
  const map=Karte.motorwayMapEdges(net,[{edgeId:'a3-west',speedKmh:7,atMinute:1}],[e],1);
  assert.equal(map.find(x=>x.edgeId==='a3-west').colour,'standstill');
  assert.deepEqual(map.find(x=>x.edgeId==='a3-east').closures,[{fromM:50,toM:100}]);
  assert.equal(Karte.colourAtSpeed(65),'slow');
  assert.equal(Karte.colourAtSpeed(66),'free');
});
