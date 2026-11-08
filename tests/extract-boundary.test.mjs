import test from 'node:test';
import assert from 'node:assert/strict';
import {Strassennetz} from '../dist/index.js';

test('Osmosis .poly polygons are parsed in longitude-latitude order with exact borders',()=>{
 const poly='Region\n1\n 7.0000 50.0000\n 7.0100 50.0000\n'+
   ' 7.0100 50.0100\n 7.0000 50.0100\n 7.0000 50.0000\nEND\nEND\n';
 const shapes=Strassennetz.parseOsmosisPoly(poly);
 assert.equal(shapes.length,1);
 assert.ok(Strassennetz.distanceToExtractBoundaryM([50,7.005],shapes)<.1);
 assert.ok(Strassennetz.distanceToExtractBoundaryM([50.005,7.005],shapes)>300);
 assert.throws(()=>Strassennetz.parseOsmosisPoly('wrong\nEND'),/ungültig/i);
});
test('Only a genuinely proven PBF clipping-border ramp is allowed to terminate externally',()=>{
 const coords=[
  {type:'node',id:1,lat:50.005,lon:7.005},
  {type:'node',id:2,lat:50.005,lon:7.006},
  {type:'node',id:3,lat:50.00005,lon:7.005}
 ];
 const ways=[
  {type:'way',id:100,nodes:[1,2],tags:{highway:'motorway',ref:'A7',oneway:'yes'}},
  {type:'way',id:101,nodes:[3,1],tags:{highway:'motorway_link',oneway:'yes'}}
 ];
 const elements=[...coords,...ways];
 assert.throws(()=>Strassennetz.importOsmNetwork(elements),
   /Rampenenden ohne nachgewiesene/);
 const rings=Strassennetz.parseOsmosisPoly(
   'Small region\n1\n 7.00 50.00\n 7.01 50.00\n 7.01 50.01\n 7.00 50.01\nEND\nEND\n');
 const {network,audit}=Strassennetz.importOsmNetwork(elements,{extractBoundaryRings:rings});
 assert.equal(audit.unconnectedRampEnds.length,0);
 assert.equal(audit.extractBoundaryRampEnds.length,1);
 assert.equal(audit.extractBoundaryRampEnds[0].edgeId.startsWith('osm:101'),true);
 assert.equal(audit.unrepresentedSourceSegments.length,0);
 assert.equal(network.edges.length,2,'must not create imaginary road beyond original source');
 const tooTight=Strassennetz.importOsmNetwork(elements,{
   extractBoundaryRings:rings,boundaryToleranceM:2,strict:false
 });
 assert.equal(tooTight.audit.unconnectedRampEnds.length,1);
});
