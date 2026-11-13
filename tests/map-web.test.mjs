import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
import {runInNewContext} from 'node:vm';
import {chooseMapTiles,createTileRepository,edgeSummary} from '../web/network-loader.js';

const manifest={schemaVersion:1,tiles:[
  {key:'212_35',file:'212_35.json.gz',bbox:[53,8.75,53.25,9]},
  {key:'213_35',file:'213_35.json.gz',bbox:[53.25,8.75,53.5,9]},
  {key:'213_36',file:'213_36.json.gz',bbox:[53.25,9,53.5,9.25]}
]};
test('Map HTML and its production imports exist; UI remains a real touch-enabled map',async()=>{
  const page=await readFile('web/index.html','utf8');
  const app=await readFile('web/app.js','utf8');
  const style=await readFile('web/styles.css','utf8');
  assert.match(page,/<div id="map"/);
  assert.match(page,/viewport-fit=cover/);
  assert.match(page,/src="\.\/bootstrap\.js"/);
  assert.match(page,/src="\.\/legacy-geometry\.js"/);
  assert.match(page,/src="\.\/legacy-canvas\.js"/);
  assert.match(page,/src="\.\/traffic-reference\.js"/);
  assert.match(page,/src="\.\/offline-traffic\.js"/);
  assert.match(page,/Simulationsstrecken/);
  assert.match(page,/A3 \/ A48/);
  assert.match(app,/motorwayMapEdges/);
  assert.match(app,/assembleVisibleTiles/);
  assert.match(app,/map\.fitBounds/);
  assert.match(style,/@media\(max-width:850px\)/);
  assert.ok(!app.includes('Math.random('),'Karte darf keine Fake-Straßen erzeugen');
});
test('Only visible zoomed-in tiles are loaded and high area requests are rejected',()=>{
  assert.deepEqual(chooseMapTiles(manifest,[53.02,8.81,53.19,8.95],11).map(t=>t.key),['212_35']);
  assert.deepEqual(chooseMapTiles(manifest,[53.22,8.9,53.35,9.1],11).map(t=>t.key),
    ['212_35','213_35','213_36']);
  assert.deepEqual(chooseMapTiles(manifest,[47,6,55,15],6),[]);
  assert.ok(chooseMapTiles(manifest,[53.02,8.81,53.19,8.95],7).length>0,
    'Phone overview zoom must already draw the real motorway overlay');
  assert.throws(()=>chooseMapTiles(manifest,[47,6,55,15],11,1),/hineinzoomen/);
});
test('Network tile fetch uses gzip, validates the stable key and caches by physical tile',async()=>{
  const data={schemaVersion:1,key:'212_35',nodes:[],movements:[],edges:[
    {id:'osm:1',kind:'mainline',geometry:[[53,8.8],[53.1,8.9]]},
    {id:'osm:2',kind:'ramp',geometry:[[53.02,8.82],[53.05,8.83]]}
  ]};
  const original=globalThis.fetch;
  let calls=0;
  globalThis.fetch=async()=>{calls++;return new Response(gzipSync(JSON.stringify(data)),{status:200})};
  try{
    const repo=createTileRepository('https://example.test/tiles/');
    const meta={key:'212_35',file:'212_35.json.gz'};
    const tiles=await Promise.all([repo.getTile(meta),repo.getTile(meta)]);
    assert.equal(calls,1);
    assert.deepEqual(tiles[0],data);
    assert.deepEqual(edgeSummary([tiles[0],tiles[1]]),{roads:2,ramps:1});
    await assert.rejects(()=>repo.getTile({key:'212_35',file:'../other'}),/Kachel-Dateiname/);
  }finally{globalThis.fetch=original;}
});

test('SPCK source preview reuses local geometry and loads without Leaflet or Overpass',async()=>{
  const page=await readFile('web/index.html','utf8');
  const bootstrap=await readFile('web/bootstrap.js','utf8');
  const canvas=await readFile('web/legacy-canvas.js','utf8');
  const geometry=await readFile('web/legacy-geometry.js','utf8');
  const flow=await readFile('web/offline-traffic.js','utf8');
  const full=await readFile('web/app.js','utf8');
  assert.match(page,/src="\.\/bootstrap\.js"/);
  assert.ok(!page.includes('src="https://unpkg.com/leaflet'),
    'SPCK must not block on CDN Leaflet');
  assert.match(bootstrap,/location\.protocol==="file:"/);
  assert.match(bootstrap,/startLegacyFallback/);
  assert.match(bootstrap,/\.\/legacy-geometry\.js/);
  assert.match(bootstrap,/\.\/legacy-canvas\.js/);
  assert.match(bootstrap,/\.\/traffic-reference\.js/);
  assert.match(bootstrap,/\.\/offline-traffic\.js/);
  assert.match(flow,/conservationResidual/);
  assert.match(bootstrap,/\.\/data\/tiles\/manifest\.json/);
  assert.match(bootstrap,/\.\/dist\/06_Karte\.js/);
  assert.match(canvas,/window\.startLegacyCanvas/);
  assert.match(canvas,/pointerdown/);
  assert.match(canvas,/ResizeObserver/);
  assert.match(canvas,/requestAnimationFrame/);
  assert.match(canvas,/startLegacyCanvas\(existingMap/);
  assert.ok(!canvas.includes('Math.random('),'must never invent roads');
  assert.ok(!canvas.includes('overpass'),'Canvas geometry must work offline');
  assert.match(full,/startLegacyFallback\(map\)/);
  const sandbox={window:{}};
  runInNewContext(geometry,sandbox);
  const data=sandbox.window.STAU_LEGACY_GEOMETRY;
  assert.equal(data.roads.length,1929);
  assert.equal(data.roads.filter(x=>x[1]==='ramp').length,943);
  assert.equal(data.junctions.length,73);
  assert.ok(data.roads.some(x=>x[2]==='A3'));
  assert.ok(data.roads.some(x=>x[2]==='A48'));
  assert.ok(data.roads.every(x=>Array.isArray(x[4])&&x[4].length>=2));
  assert.ok(data.roads.every(x=>x[4].every(p=>Number.isFinite(p[0])&&Number.isFinite(p[1]))));
  for(const workflowPath of [
    '.github/workflows/publish-map.yml',
    '.github/workflows/quick-map-preview.yml'
  ]){
    const workflow=await readFile(workflowPath,'utf8');
    assert.match(workflow,/web\/bootstrap\.js web\/legacy-canvas\.js web\/legacy-geometry\.js web\/traffic-reference\.js web\/offline-traffic\.js/);
  }
});
