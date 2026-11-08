import test from 'node:test';
import assert from 'node:assert/strict';
import {Verkehr,Stauphysik,Ereignisse} from '../dist/index.js';
import {sampleNetwork} from './fixture.mjs';

test('Freitag-Nachmittag beginnt früher als normale Werktagsspitze',()=>{
  const regular=Verkehr.demandFactor({dayOfWeek:2,hour:14});
  const friday=Verkehr.demandFactor({dayOfWeek:5,hour:14});
  assert.ok(friday>regular);
  assert.ok(Verkehr.demandFactor({dayOfWeek:0,hour:6})<regular);
});
test('4300 Zufluss bei 2600 Kapazität erzeugt exakt bilanzierten Engpass',()=>{
  const a=Stauphysik.advanceBottleneck(Stauphysik.emptyQueue(),4300,2600,60);
  assert.ok(Math.abs(a.next.waitingVehicles-1700/60)<1e-9);
  assert.ok(Math.abs(a.next.totalArrived-a.next.totalReleased-a.next.waitingVehicles)<1e-9);
  const b=Stauphysik.advanceBottleneck(a.next,0,2600,60);
  assert.ok(Math.abs(b.next.waitingVehicles)<1e-9);
  assert.ok(Math.abs(b.next.totalArrived-b.next.totalReleased-b.next.waitingVehicles)<1e-9);
});
test('Zusätzliche Fahrspur erhöht Kapazität; die Rampe bleibt einspurig',()=>{
  const net=sampleNetwork();
  assert.equal(Stauphysik.physicalCapacityVph(net.edges[0]),6300);
  assert.equal(Stauphysik.physicalCapacityVph(net.edges[0],2),4200);
  assert.equal(Stauphysik.physicalCapacityVph(net.edges[2]),1500);
});
test('Ereignisse reduzieren die reale Kapazität nur im betroffenen Abschnitt',()=>{
  const net=sampleNetwork(),edge=net.edges[0];
  const a={id:'a',edgeId:edge.id,kind:'roadworks',fromM:100,toM:200,
    closedLanes:[0],startMinute:0};
  assert.equal(Ereignisse.capacityAtPosition(edge,150,1,[a]),4200);
  assert.equal(Ereignisse.capacityAtPosition(edge,300,1,[a]),6300);
  assert.equal(Ereignisse.capacityAtPosition(edge,150,3,[{...a,endMinute:3}]),6300);
});
