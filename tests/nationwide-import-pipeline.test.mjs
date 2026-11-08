import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,readFileSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {Strassennetz,Karte} from '../dist/index.js';

function smallXml() {
  return ['<?xml version="1.0" encoding="UTF-8"?>',
    '<osm version="0.6" generator="fixture">',
    '<node id="1" lat="50.0000" lon="7.0000"/>',
    '<node id="2" lat="50.0000" lon="7.0010"/>',
    '<node id="3" lat="50.0000" lon="7.0030"/>',
    '<node id="4" lat="50.0010" lon="7.0010"/>',
    '<node id="5" lat="50.0020" lon="7.0010"/>',
    '<way id="101"><nd ref="1"/><nd ref="2"/><nd ref="3"/>',
    '<tag k="highway" v="motorway"/><tag k="ref" v="A61"/>',
    '<tag k="oneway" v="yes"/><tag k="lanes" v="3"/></way>',
    '<way id="102"><nd ref="4"/><nd ref="2"/>',
    '<tag k="highway" v="motorway_link"/><tag k="oneway" v="yes"/></way>',
    '<way id="103"><nd ref="5"/><nd ref="4"/>',
    '<tag k="highway" v="secondary"/><tag k="oneway" v="yes"/></way>',
    '<relation id="104"><member type="way" ref="103" role="from"/>',
    '<member type="node" ref="4" role="via"/>',
    '<member type="way" ref="102" role="to"/>',
    '<tag k="type" v="restriction"/>',
    '<tag k="restriction" v="no_right_turn"/></relation>',
    '</osm>'].join('\n');
}
function invoke(command,args,opts={}) {
  const p=spawnSync(command,args,{encoding:'utf8',cwd:process.cwd(),...opts});
  assert.equal(p.status,0,(p.stderr||'')+(p.stdout||''));
  return p;
}
test('PBF preparation pipeline documents its requirements without starting any download',()=>{
  const p=invoke('bash',['scripts/build-germany-network.sh','--help']);
  assert.match(p.stdout,/germany-latest.osm.pbf/);
});
test('XML -> compressed JSON -> directed motorway/ramp graph -> lazy tiles',()=>{
  const dir=mkdtempSync(join(tmpdir(),'osm-germany-pipeline-'));
  try {
    const xml=join(dir,'source.osm');
    const json=join(dir,'source.json.gz');
    const networkPath=join(dir,'network.json');
    const tilesDir=join(dir,'tiles');
    writeFileSync(xml,smallXml());
    invoke('python3',['scripts/osm-xml-to-json.py',xml,json]);
    const decoded=JSON.parse(gunzipSync(readFileSync(json)).toString('utf8'));
    assert.equal(decoded.elements.length,9);
    assert.equal(decoded.elements.filter(e=>e.type==='relation').length,1);
    const build=invoke(process.execPath,['scripts/import-osm.mjs',json,
      '--include-public','--output='+networkPath]);
    assert.match(build.stdout,/OSM Import erfolgreich/);
    const network=JSON.parse(readFileSync(networkPath,'utf8'));
    const audit=JSON.parse(readFileSync(networkPath+'.audit.json','utf8'));
    assert.deepEqual(Strassennetz.validateNetwork(network),[]);
    assert.equal(audit.importedMotorwayWays,1);
    assert.equal(audit.importedRampWays,1);
    assert.equal(audit.importedPublicWays,1);
    assert.equal(audit.unconnectedRampEnds.length,0);
    assert.equal(audit.unrepresentedSourceSegments.length,0);
    const ramp=network.edges.find(e=>e.osmWayIds.includes(102));
    const main=network.edges.find(e=>e.osmWayIds.includes(101)&&
      e.fromNodeId==='osm-node:2');
    assert.ok(network.movements.some(m=>m.incomingEdgeId===ramp.id&&m.outgoingEdgeId===main.id));
    const fromPublic=network.edges.find(e=>e.osmWayIds.includes(103));
    assert.ok(!network.movements.some(m=>
      m.incomingEdgeId===fromPublic.id&&m.outgoingEdgeId===ramp.id),
      'OSM restriction must be honoured');
    invoke(process.execPath,['scripts/shard-network.mjs',networkPath,
      '--output-dir='+tilesDir,'--tile-degrees=.001']);
    const manifest=JSON.parse(readFileSync(join(tilesDir,'manifest.json'),'utf8'));
    assert.ok(manifest.tiles.length>=2);
    assert.equal(manifest.counts.uniqueEdges,network.edges.length);
    const unique=new Map();
    const ownedMoves=new Map();
    const tileObjects=[];
    for(const meta of manifest.tiles){
      const bytes=readFileSync(join(tilesDir,meta.file));
      assert.equal(meta.sha256,createHash('sha256').update(bytes).digest('hex'));
      const tile=JSON.parse(gunzipSync(bytes).toString('utf8'));
      tileObjects.push(tile);
      for(const e of tile.edges){
        if(unique.has(e.id))assert.deepEqual(unique.get(e.id),e,
          'same edge ID cannot hold two conflicting geometries');
        unique.set(e.id,e);
      }
      for(const m of tile.movements){
        const id=m.incomingEdgeId+'>'+m.outgoingEdgeId;
        assert.ok(!ownedMoves.has(id),'movement must have exactly one home tile');
        ownedMoves.set(id,m);
      }
    }
    assert.equal(unique.size,network.edges.length);
    assert.equal(ownedMoves.size,network.movements.length);
    const assembled=Karte.assembleVisibleTiles(tileObjects);
    assert.deepEqual(Strassennetz.validateNetwork(assembled.network),[]);
    assert.equal(assembled.pendingMovements.length,0);
    assert.equal(assembled.network.edges.length,network.edges.length);
    assert.equal(Karte.motorwayMapEdges(assembled.network).length,
      network.edges.filter(e=>e.kind!=='public').length);
    assert.ok(Karte.tilesForViewport(manifest,[49.999,6.999,50.003,7.004]).length>0);
    assert.deepEqual(Karte.tilesForViewport(manifest,[10,10,11,11]),[]);
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
test('Streaming OSM parser refuses untrusted malformed XML instead of producing incomplete graph',()=>{
 const dir=mkdtempSync(join(tmpdir(),'bad-osm-pipeline-'));
 try{
   const path=join(dir,'broken.osm');
   writeFileSync(path,'<osm><node id="1" lat="50" lon="7"></osm>');
   const p=spawnSync('python3',['scripts/osm-xml-to-json.py',path,join(dir,'out.json')],
      {encoding:'utf8',cwd:process.cwd()});
   assert.notEqual(p.status,0);
 } finally {rmSync(dir,{recursive:true,force:true});}
});
