import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

test('Neue Autobahnregion wird per CLI ohne Autobahn-spezifischen Code importiert und auf Rampen geprüft',()=>{
  const dir=mkdtempSync(join(tmpdir(),'stau-osm-'));
  try{
    const points={1:[50,7],2:[50,7.01],3:[50.005,7.01],
      4:[50.01,7.01],5:[50,7.02]};
    const nodes=Object.entries(points).map(([id,p])=>({type:'node',id:Number(id),lat:p[0],lon:p[1]}));
    const ways=[
      {type:'way',id:1,nodes:[1,2],tags:{highway:'motorway',ref:'A61',oneway:'yes'}},
      {type:'way',id:2,nodes:[2,5],tags:{highway:'motorway',ref:'A61',oneway:'yes'}},
      {type:'way',id:3,nodes:[3,2],tags:{highway:'motorway_link',oneway:'yes'}},
      {type:'way',id:4,nodes:[4,3],tags:{highway:'secondary',oneway:'yes'}}
    ];
    const input=join(dir,'snapshot.json'),output=join(dir,'netz.json');
    writeFileSync(input,JSON.stringify({elements:[...nodes,...ways]}));
    const call=spawnSync(process.execPath,['scripts/import-osm.mjs',input,
      '--include-public','--output='+output],{cwd:process.cwd(),encoding:'utf8'});
    assert.equal(call.status,0,call.stderr);
    const network=JSON.parse(readFileSync(output,'utf8'));
    const audit=JSON.parse(readFileSync(output+'.audit.json','utf8'));
    assert.equal(audit.importedMotorwayWays,2);
    assert.equal(audit.importedRampWays,1);
    assert.equal(audit.unconnectedRampEnds.length,0);
    assert.equal(audit.unrepresentedSourceSegments.length,0);
    assert.ok(network.movements.some(m=>{
      const from=network.edges.find(e=>e.id===m.incomingEdgeId);
      const to=network.edges.find(e=>e.id===m.outgoingEdgeId);
      return from?.kind==='ramp'&&to?.kind==='mainline';
    }));
  }finally{rmSync(dir,{recursive:true,force:true});}
});
