import test from 'node:test';
import assert from 'node:assert/strict';
import {Strassennetz,Umleitungen,Karte} from '../dist/index.js';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {gunzipSync} from 'node:zlib';

function example(kind='no_straight_on'){
  const coords=[
    [1,50,8],[2,50,8.001],[3,50,8.002],
    [4,50,8.003],[5,50,8.004],[6,50.001,8.004],
    [7,50.001,8.001],[8,50.001,8.002]
  ];
  const nodes=coords.map(([id,lat,lon])=>({type:'node',id,lat,lon}));
  const ways=[
    {type:'way',id:101,nodes:[1,2],tags:{highway:'motorway',ref:'A7',oneway:'yes'}},
    {type:'way',id:102,nodes:[2,3,4],tags:{highway:'motorway_link',oneway:'yes'}},
    {type:'way',id:103,nodes:[4,5],tags:{highway:'motorway',ref:'A7',oneway:'yes'}},
    {type:'way',id:104,nodes:[4,6],tags:{highway:'secondary',oneway:'yes'}},
    {type:'way',id:105,nodes:[2,7],tags:{highway:'secondary',oneway:'yes'}},
    {type:'way',id:106,nodes:[3,8],tags:{highway:'secondary',oneway:'yes'}}
  ];
  const relation={
    type:'relation',id:2001,
    tags:{type:'restriction',restriction:kind},
    members:[
      {type:'way',ref:101,role:'from'},
      {type:'way',ref:102,role:'via'},
      {type:'way',ref:103,role:'to'}
    ]
  };
  return {elements:[...nodes,...ways,relation]};
}
function wayEdges(net,id){
 return net.edges.filter(e=>e.osmWayIds.includes(id));
}
test('via-way no_* restriction blocks only the exact directed from+via+to path',()=>{
 const {network:n,audit}=Strassennetz.importOsmNetwork(example().elements,{includePublicRoads:true});
 assert.deepEqual(audit.issues,[]);
 assert.equal(audit.compiledViaWayRestrictions,1);
 const pattern=n.routeRestrictions[0];
 assert.equal(pattern.kind,'no');
 assert.equal(pattern.edgeIds.length,4,'via-way split into two edges at genuine branching node');
 assert.deepEqual(pattern.edgeIds.map(id=>n.edges.find(e=>e.id===id).osmWayIds[0]),
   [101,102,102,103]);
 const from=wayEdges(n,101)[0].id;
 const to=wayEdges(n,103)[0].id;
 assert.equal(Umleitungen.findRoute(n,from,to),null,'disallowed full via-way turn must never route');
 const bypass=wayEdges(n,104)[0].id;
 assert.deepEqual(Umleitungen.findRoute(n,from,bypass)?.edgeIds.map(id=>
   n.edges.find(e=>e.id===id).osmWayIds[0]),[101,102,102,104]);
 const side=wayEdges(n,105)[0].id;
 assert.deepEqual(Umleitungen.findRoute(n,from,side)?.edgeIds,[from,side],
   'approach may take a different legal exit from start');
});
test('via-way only_* forces legal from-via-to continuation without blocking unrelated approaches',()=>{
 const {network:n,audit}=Strassennetz.importOsmNetwork(
   example('only_straight_on').elements,{includePublicRoads:true});
 assert.equal(audit.compiledViaWayRestrictions,1);
 const from=wayEdges(n,101)[0].id,to=wayEdges(n,103)[0].id;
 assert.deepEqual(Umleitungen.findRoute(n,from,to)?.edgeIds.map(id=>
   n.edges.find(e=>e.id===id).osmWayIds[0]),[101,102,102,103]);
 assert.equal(Umleitungen.findRoute(n,from,wayEdges(n,105)[0].id),null,
   'from-way may not take another exit at first via intersection');
 assert.equal(Umleitungen.findRoute(n,from,wayEdges(n,104)[0].id),null,
   'from-way may not exit via-way before required to-way');
});
test('invalid or wrong-way via-way relation fails audibly instead of allowing an illegal turn',()=>{
 const source=example();
 const via=source.elements.find(x=>x.type==='way'&&x.id===102);
 via.tags.oneway='-1';
 const result=Strassennetz.importOsmNetwork(source.elements,{includePublicRoads:true,strict:false});
 assert.ok(result.audit.issues.some(x=>x.includes('via-way Relation 2001')));
 assert.throws(()=>Strassennetz.importOsmNetwork(source.elements,{includePublicRoads:true}),
   /via-way Relation/);
});

test('OSM via-way rules survive the region-tile build and remain enforced',()=>{
  const dir=mkdtempSync(join(tmpdir(),'via-way-tiles-'));
  try{
    const original=Strassennetz.importOsmNetwork(example().elements,{includePublicRoads:true}).network;
    const input=join(dir,'network.json'),output=join(dir,'tiles');
    writeFileSync(input,JSON.stringify(original));
    const result=spawnSync(process.execPath,['scripts/shard-network.mjs',input,
      '--output-dir='+output,'--tile-degrees=.0006'],{cwd:process.cwd(),encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);
    const manifest=JSON.parse(readFileSync(join(output,'manifest.json'),'utf8'));
    assert.equal(manifest.counts.routeRestrictions,1);
    const tiles=manifest.tiles.map(t=>JSON.parse(gunzipSync(readFileSync(join(output,t.file))).toString('utf8')));
    const assembled=Karte.assembleVisibleTiles(tiles);
    assert.deepEqual(assembled.pendingRouteRestrictions,[]);
    assert.deepEqual(assembled.network.routeRestrictions,original.routeRestrictions);
    const from=wayEdges(original,101)[0].id,to=wayEdges(original,103)[0].id;
    assert.equal(Umleitungen.findRoute(assembled.network,from,to),null);
    assert.deepEqual(Strassennetz.validateNetwork(assembled.network),[]);
    const partial=Karte.assembleVisibleTiles(tiles.slice(0,1));
    assert.equal(partial.network.routeRestrictions?.length??0,0,
      'incomplete cross-region restriction must not masquerade as a fully loaded one');
  }finally{rmSync(dir,{recursive:true,force:true});}
});
