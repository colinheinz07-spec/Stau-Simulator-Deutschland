import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
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
  assert.match(page,/leaflet@1\.9\.4/);
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

test('SPCK source preview renders original OSM motorway geometry without generated dist or tiles',async()=>{
  const page=await readFile('web/index.html','utf8');
  const bootstrap=await readFile('web/bootstrap.js','utf8');
  const preview=await readFile('web/local-preview.js','utf8');
  const full=await readFile('web/app.js','utf8');
  assert.match(page,/src="\.\/bootstrap\.js"/);
  assert.match(page,/src="\.\/local-preview\.js"/);
  assert.match(bootstrap,/location\.protocol==="file:"/);
  assert.match(bootstrap,/\.\/data\/tiles\/manifest\.json/);
  assert.match(bootstrap,/\.\/dist\/06_Karte\.js/);
  assert.match(bootstrap,/startLocalPreview/);
  assert.match(preview,/highway.*motorway_link/);
  assert.match(preview,/out geom/);
  assert.match(preview,/window\.startLocalPreview/);
  assert.ok(!preview.includes('Math.random('),'preview must never invent roads');
  assert.match(full,/startLocalPreview\(map\)/);
  for(const workflowPath of [
    '.github/workflows/publish-map.yml',
    '.github/workflows/quick-map-preview.yml'
  ]){
    const workflow=await readFile(workflowPath,'utf8');
    assert.match(workflow,/web\/bootstrap\.js web\/local-preview\.js/);
  }
});
