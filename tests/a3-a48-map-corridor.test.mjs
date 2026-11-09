import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {spawnSync} from "node:child_process";
import {Strassennetz} from "../dist/index.js";
function network(){
  const pts={a:[50.42,7.3],b:[50.43,7.32],c:[50.44,7.34],d:[50.45,7.35],
    e:[50.46,7.36],f:[50.46,7.38],g:[50.48,7.4],h:[50.47,7.39]};
  const nodes=Object.entries(pts).map(([id,point])=>({id,point}));
  const raw=[
    ["a3-1","a","b","mainline","A3"],
    ["a3-2","b","c","mainline","A3"],
    ["a48","e","f","mainline","A48"],
    ["other","f","g","mainline","A1"],
    ["ramp-exit","b","d","ramp",null],
    ["ramp-branch","d","e","ramp",null],
    ["ramp-other","f","h","ramp",null],
    ["public","d","h","public",null],
    ["far-public","h","g","public",null]
  ];
  const edges=raw.map(([id,fromNodeId,toNodeId,kind,motorwayRef],i)=>{
    const geometry=[pts[fromNodeId],pts[toNodeId]];
    return {id,fromNodeId,toNodeId,geometry,osmWayIds:[100+i],kind,
      osmClass:kind==="ramp"?"motorway_link":kind==="mainline"?"motorway":"secondary",
      ...(motorwayRef?{motorwayRef,motorwayRefs:[motorwayRef]}:{}),lanes:kind==="mainline"?2:1,
      lengthM:Strassennetz.polylineLengthM(geometry),freeSpeedKmh:kind==="mainline"?130:60,
      capacityPerLaneVph:kind==="mainline"?2100:1500};
  });
  const movements=[
    ["a3-1","a3-2"],["a3-1","ramp-exit"],["ramp-exit","ramp-branch"],
    ["ramp-branch","a48"],["a48","ramp-other"],["ramp-exit","public"],
    ["ramp-other","far-public"],["a48","other"]
  ].filter(([a,b])=>{
    const x=edges.find(x=>x.id===a),y=edges.find(x=>x.id===b);
    return x.toNodeId===y.fromNodeId;
  }).map(([incomingEdgeId,outgoingEdgeId])=>({incomingEdgeId,outgoingEdgeId,allowed:true}));
  return {schemaVersion:1,nodes,edges,movements};
}
test("A3 and A48 are selected by source refs plus all real attached ramp chains",()=>{
  const dir=mkdtempSync(join(tmpdir(),"a3-a48-filter-"));
  try{
    const source=join(dir,"source.json"),output=join(dir,"selected.json");
    writeFileSync(source,JSON.stringify(network()));
    const result=spawnSync(process.execPath,["scripts/select-motorway-corridor.mjs",
      source,output,"--refs=A3,A48","--bbox=7.2,50.3,7.5,50.6"],{encoding:"utf8"});
    assert.equal(result.status,0,result.stderr);
    const net=JSON.parse(readFileSync(output,"utf8"));
    const ids=new Set(net.edges.map(e=>e.id));
    for(const id of ["a3-1","a3-2","a48","ramp-exit","ramp-branch","ramp-other"])
      assert.ok(ids.has(id),"missing existing OSM edge: "+id);
    assert.ok(!ids.has("other"),"Do not project unrequested A1 mainline green");
    assert.equal(Strassennetz.validateNetwork(net).length,0);
    const audit=JSON.parse(readFileSync(output+".audit.json","utf8"));
    assert.equal(audit.mainlineEdges,3);
    assert.equal(audit.rampEdges,3);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
