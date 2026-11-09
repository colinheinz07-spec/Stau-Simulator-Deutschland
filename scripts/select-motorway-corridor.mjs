/** Only existing directed OSM motorway edges, their original ramp branches and
 * directly connected public access stubs. NO artificial bridges/coordinates.
 * Works with any road refs; defaults to the requested A3/A48 corridor.
 *
 * node scripts/select-motorway-corridor.mjs source.json output.json \
 *   --refs=A3,A48 --bbox=6.84,50.12,8.22,50.87
 */
import {readFile,writeFile,mkdir} from "node:fs/promises";
import {resolve,dirname} from "node:path";
import {Strassennetz} from "../dist/index.js";

const [source,output,...flags]=process.argv.slice(2);
if(!source||!output)throw Error("Usage: select-motorway-corridor.mjs GRAPH.json OUTPUT.json [--refs=A3,A48] [--bbox=WEST,SOUTH,EAST,NORTH]");
const refArg=flags.find(x=>x.startsWith("--refs="))?.slice(7)??"A3,A48";
const refs=new Set(refArg.split(",").map(x=>x.trim()).filter(Boolean));
const bounds=(flags.find(x=>x.startsWith("--bbox="))?.slice(7)??"6.84,50.12,8.22,50.87")
  .split(",").map(Number);
if(bounds.length!==4||bounds.some(x=>!Number.isFinite(x))||bounds[0]>=bounds[2]||bounds[1]>=bounds[3])
  throw Error("Invalid bounding box");
const [west,south,east,north]=bounds;
const intersects=edge=>edge.geometry.some(p=>p[0]>=south&&p[0]<=north&&p[1]>=west&&p[1]<=east);
const network=JSON.parse(await readFile(resolve(source),"utf8"));
const errors=Strassennetz.validateNetwork(network);
if(errors.length)throw Error("Source OSM graph is invalid: "+errors.slice(0,10).join("; "));
const edges=new Map(network.edges.map(e=>[e.id,e]));
const selected=new Set(network.edges.filter(e=>e.kind==="mainline"&&
  (e.motorwayRefs??(e.motorwayRef?[e.motorwayRef]:[])).some(ref=>refs.has(ref))&&intersects(e))
  .map(e=>e.id));
if(!selected.size)throw Error("No actual OSM motorway mainline for "+[...refs].join(","));
const mainCount=selected.size;
// Ramp expansion: physical OSM node connectivity, independently of direction.
// This includes split motorway_link chains all the way through AK/AD/AS
// but NEVER spreads recursively through different motorway mainlines.
const rampNodes=new Map();
for(const e of network.edges)if(e.kind==="ramp"){
  for(const id of [e.fromNodeId,e.toNodeId]){
    const arr=rampNodes.get(id)??[];
    arr.push(e.id);
    rampNodes.set(id,arr);
  }
}
const pending=[];
for(const id of selected){
  const e=edges.get(id);
  pending.push(e.fromNodeId,e.toNodeId);
}
const seenNodes=new Set();
while(pending.length){
  const node=pending.pop();
  if(seenNodes.has(node))continue;
  seenNodes.add(node);
  for(const id of rampNodes.get(node)??[]){
    if(selected.has(id))continue;
    const e=edges.get(id);
    // Source extraction sometimes includes way geometry just outside bbox.
    // An actual attached ramp is kept; do not trim at an arbitrary boundary.
    selected.add(id);
    pending.push(e.fromNodeId,e.toNodeId);
  }
}
const rampCount=selected.size-mainCount;
// Add only real public roads connected to one of the selected ramp endpoints.
// They are necessary endpoint evidence but are NOT rendered as motorway.
const publicLinks=network.edges.filter(e=>e.kind==="public"&&
  (seenNodes.has(e.fromNodeId)||seenNodes.has(e.toNodeId)));
for(const e of publicLinks)selected.add(e.id);
const keptEdges=network.edges.filter(e=>selected.has(e.id));
const nodeIds=new Set(keptEdges.flatMap(e=>[e.fromNodeId,e.toNodeId]));
const road={
  schemaVersion:1,
  nodes:network.nodes.filter(n=>nodeIds.has(n.id)),
  edges:keptEdges,
  movements:network.movements.filter(m=>selected.has(m.incomingEdgeId)&&selected.has(m.outgoingEdgeId))
};
const retainedRules=(network.routeRestrictions??[]).filter(r=>r.edgeIds.every(id=>selected.has(id)));
if(retainedRules.length)road.routeRestrictions=retainedRules;
const selectedErrors=Strassennetz.validateNetwork(road);
if(selectedErrors.length)throw Error("Output corridor graph invalid: "+selectedErrors.join("; "));
const sourceAuditPath=resolve(source+".audit.json");
let importAudit=null;
try{importAudit=JSON.parse(await readFile(sourceAuditPath,"utf8"))}catch{}
const audit={
  selectionRefs:[...refs],bbox:{west,south,east,north},
  mainlineEdges:mainCount,rampEdges:rampCount,publicEdges:publicLinks.length,
  totalEdges:keptEdges.length,movements:road.movements.length,
  importIssues:importAudit?.issues??[],
  unresolvedSourceRampEnds:importAudit?.unconnectedRampEnds??[],
  extractedAtBoundary:importAudit?.extractBoundaryRampEnds??[],
  source:"OSM directed source geometry; no added coordinates or snapped links"
};
await mkdir(dirname(resolve(output)),{recursive:true});
await writeFile(resolve(output),JSON.stringify(road)+"\n");
await writeFile(resolve(output+".audit.json"),JSON.stringify(audit,null,2)+"\n");
console.log(JSON.stringify({output,...audit,unresolvedSourceRampEnds:audit.unresolvedSourceRampEnds.length,importIssues:audit.importIssues.length},(k,v)=>{
  if(k==="unresolvedSourceRampEnds"&&Array.isArray(v))return v.length;
  if(k==="extractedAtBoundary"&&Array.isArray(v))return v.length;
  return v;
},2));
