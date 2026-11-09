/** 01 STRASSENNETZ: Inspect explicit directional OSM moves for EVERY ramp.
 * This is topology QA, not a claim that source PBF contains all of Germany.
 * Snapshot/corridor boundaries remain documented instead of auto-bridged.
 */
import type {RoadNetwork} from '../model.js';

export interface RampConnectionFinding {
  edgeId:string;
  osmWayIds:readonly number[];
  incomingTurns:number;
  outgoingTurns:number;
  /** An unmodelled boundary or uncertain connection; no imaginary edge added. */
  kind:'source-end'|'sink-end'|'isolated'|'connected';
}
export interface NetworkConnectionAudit {
  edgeCount:number;
  motorwayMainlineCount:number;
  motorwayRampCount:number;
  motorwayMovements:number;
  sourceEdges:number;
  sinkEdges:number;
  rampSources:number;
  rampSinks:number;
  isolatedRamps:number;
  rampFindings:RampConnectionFinding[];
  invalidMovements:string[];
  /** Via-way history restrictions are loaded separately by the route engine. */
  routeRestrictionCount:number;
}
export function auditConnections(network:RoadNetwork):NetworkConnectionAudit{
  const byId=new Map(network.edges.map(e=>[e.id,e]));
  const incoming=new Map<string,number>(),outgoing=new Map<string,number>();
  const invalidMovements:string[]=[];
  let motorwayMovements=0;
  for(const m of network.movements){
    if(!m.allowed)continue;
    const from=byId.get(m.incomingEdgeId),to=byId.get(m.outgoingEdgeId);
    if(!from||!to||from.toNodeId!==to.fromNodeId){
      invalidMovements.push(m.incomingEdgeId+'=>'+m.outgoingEdgeId);
      continue;
    }
    incoming.set(to.id,(incoming.get(to.id)??0)+1);
    outgoing.set(from.id,(outgoing.get(from.id)??0)+1);
    if(from.kind!=='public'||to.kind!=='public')motorwayMovements++;
  }
  let sourceEdges=0,sinkEdges=0,rampSources=0,rampSinks=0,isolatedRamps=0;
  const rampFindings:RampConnectionFinding[]=[];
  for(const edge of network.edges){
    const inN=incoming.get(edge.id)??0,outN=outgoing.get(edge.id)??0;
    if(inN===0)sourceEdges++;
    if(outN===0)sinkEdges++;
    if(edge.kind!=='ramp')continue;
    if(inN===0)rampSources++;
    if(outN===0)rampSinks++;
    if(inN===0&&outN===0)isolatedRamps++;
    rampFindings.push({
      edgeId:edge.id,osmWayIds:edge.osmWayIds,
      incomingTurns:inN,outgoingTurns:outN,
      kind:inN===0&&outN===0?'isolated':inN===0?'source-end':
        outN===0?'sink-end':'connected'
    });
  }
  return {
    edgeCount:network.edges.length,
    motorwayMainlineCount:network.edges.filter(e=>e.kind==='mainline').length,
    motorwayRampCount:rampFindings.length,motorwayMovements,
    sourceEdges,sinkEdges,rampSources,rampSinks,isolatedRamps,
    rampFindings,
    invalidMovements,
    routeRestrictionCount:network.routeRestrictions?.length??0
  };
}
