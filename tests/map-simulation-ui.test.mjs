import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createTrafficScenario} from '../web/simulation-controller.js';
import {sampleNetwork} from './fixture.mjs';

test('Bedienbare A3/A48-Karte hat echte Verkehrssteuerung und nicht nur vorgegebene rote Farben',async()=>{
  const page=await readFile('web/index.html','utf8');
  const script=await readFile('web/app.js','utf8');
  assert.match(page,/id="sim-toggle"/);
  assert.match(page,/id="sim-demand"/);
  assert.match(page,/data-event="roadworks"/);
  assert.match(page,/data-event="accident"/);
  assert.match(page,/data-event="closure"/);
  assert.match(script,/createTrafficScenario/);
  assert.match(script,/motorwayMapEdges\(state\.network,samples,events,minute,\[\],cells\)/);
  assert.match(script,/sliceEdgeGeometry/);
  assert.match(script,/for\(const band of item\.trafficBands\)/);
  assert.ok(!script.includes('speedKmh:15,atMinute:0'),
    'roter Stau darf nicht einfach aus einem Button erzeugt werden');
});
test('Unfall reduziert reale Fahrstreifen, Stau entsteht physikalisch und bleibt bilanzierbar',()=>{
  const graph=sampleNetwork();
  const s=createTrafficScenario(graph);
  assert.equal(s.events().length,0);
  s.setDemandPercent(170);
  s.setMode('a3-east','accident');
  const e=s.events()[0];
  assert.equal(e.kind,'accident');
  assert.deepEqual(e.closedLanes,[0,1]);
  let p;
  for(let i=0;i<10;i++)p=s.advance(30);
  assert.equal(s.stats().simSeconds,600);
  assert.ok(p.generatedVehicles>0);
  assert.ok(p.exitedVehicles>0);
  assert.ok(Math.abs(p.conservationResidual)<1e-6);
  const speeds=s.speeds();
  assert.ok(speeds.some(x=>x.speedKmh<130));
  assert.ok(speeds.every(x=>Number.isFinite(x.speedKmh)));
});
test('Vollsperrung sperrt nur betroffene gerichtete Kante und nicht offenen Alternativast',()=>{
  const s=createTrafficScenario(sampleNetwork());
  s.setMode('a3-east','closure');
  const closed=new Set(s.events().filter(x=>x.kind==='closure').map(x=>x.edgeId));
  assert.ok(closed.has('a3-east'));
  assert.ok(!closed.has('ramp'),'offene Ausfahrt am Abzweig bleibt offen');
  s.advance(30);
  const before=s.stats().simSeconds;
  s.setMode('a3-east','none');
  assert.equal(s.events().length,0);
  assert.equal(s.stats().simSeconds,before,'Ereignisänderung teleportiert keine Autos');
  s.reset();
  assert.equal(s.stats().simSeconds,0);
  assert.equal(s.stats().generatedVehicles,0);
});
