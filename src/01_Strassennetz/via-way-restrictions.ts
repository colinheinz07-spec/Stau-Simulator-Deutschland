/** Translate OSM via-way restriction relations into exact directed edge paths.
 * Only original shared OSM nodes and accepted turn movements can participate.
 * The target graph carries these sequences; the router matches the whole
 * traversed history instead of wrongly blocking individual arms.
 */
import type {RoadEdge,RouteRestriction,TurnMovement} from '../model.js';

export interface ViaWayRule {
  id:number;
  kind:'no'|'only';
  fromWayId:number;
  viaWayIds:readonly number[];
  toWayId:number;
}
export interface WayEnds {id:number;firstNodeId:number;lastNodeId:number}
export interface ViaWayCompileResult {
  restrictions:RouteRestriction[];
  errors:string[];
  deferredIds:number[];
}
const nodeId=(id:number)=>'osm-node:'+id;
export function compileViaWayRestrictions(
  rules:readonly ViaWayRule[], ways:readonly WayEnds[], edges:readonly RoadEdge[],
  movements:readonly TurnMovement[]
):ViaWayCompileResult {
  const restrictions:RouteRestriction[]=[],errors:string[]=[],deferredIds:number[]=[];
  const index=new Map<number,RoadEdge[]>(),endpoints=new Map<number,WayEnds>();
  for(const w of ways)endpoints.set(w.id,w);
  for(const edge of edges)for(const id of edge.osmWayIds) {
    const list=index.get(id)??[];
    list.push(edge);index.set(id,list);
  }
  const allowed=new Set(movements.filter(x=>x.allowed).map(x=>x.incomingEdgeId+'=>'+x.outgoingEdgeId));
  const connected=(a:RoadEdge,b:RoadEdge)=>a.toNodeId===b.fromNodeId &&
    allowed.has(a.id+'=>'+b.id);
  for(const rule of rules){
    if(!index.has(rule.fromWayId) || !index.has(rule.toWayId) ||
       rule.viaWayIds.some(id=>!index.has(id))){
      deferredIds.push(rule.id);
      continue; // no complete turn path exists in this graph subset
    }
    const targetWays=rule.viaWayIds.map(id=>endpoints.get(id));
    if(targetWays.some(x=>!x)){
      errors.push('OSM via-way Relation '+rule.id+': fehlende ursprüngliche Way-Endpunkte');
      continue;
    }
    const completed:string[][]=[],found=new Set<string>();
    const MAX_PATH_EDGES=96,MAX_COMBINATIONS=256;
    let exhausted=false;
    const add=(path:readonly RoadEdge[])=>{
      const ids=path.map(e=>e.id),key=ids.join('|');
      if(found.has(key))return;
      found.add(key);
      completed.push(ids);
      if(completed.length>=MAX_COMBINATIONS)exhausted=true;
    };
    /** Traverse every original split edge of ONE via-way in a directed
     * manner, from one of its ORIGINAL endpoints to the other. */
    const traverse=(stage:number,incoming:RoadEdge,path:RoadEdge[],visited:Set<string>)=>{
      if(exhausted||path.length>=MAX_PATH_EDGES)return;
      const way=targetWays[stage]!;
      if(incoming.toNodeId!==nodeId(way.firstNodeId) &&
         incoming.toNodeId!==nodeId(way.lastNodeId))return;
      const exit=incoming.toNodeId===nodeId(way.firstNodeId)?
        nodeId(way.lastNodeId):nodeId(way.firstNodeId);
      const dfs=(at:RoadEdge,chain:RoadEdge[],seen:Set<string>)=>{
        if(exhausted || path.length+chain.length>MAX_PATH_EDGES)return;
        if(at.toNodeId===exit){
          const endPath=[...path,...chain];
          if(stage+1<rule.viaWayIds.length){
            traverse(stage+1,at,endPath,new Set([...visited,...seen]));
          }else{
            for(const to of index.get(rule.toWayId)??[])
              if(connected(at,to))add([...endPath,to]);
          }
          return;
        }
        for(const next of index.get(way.id)??[]){
          if(seen.has(next.id)||!connected(at,next))continue;
          dfs(next,[...chain,next],new Set([...seen,next.id]));
        }
      };
      for(const first of index.get(way.id)??[]){
        if(first.fromNodeId!==incoming.toNodeId||!connected(incoming,first)||
           visited.has(first.id))continue;
        dfs(first,[first],new Set([first.id]));
      }
    };
    for(const from of index.get(rule.fromWayId)??[]){
      traverse(0,from,[from],new Set([from.id]));
      if(exhausted)break;
    }
    if(exhausted){
      errors.push('OSM via-way Relation '+rule.id+': mehr als '+MAX_COMBINATIONS+
        ' mögliche Fahrbeziehungen, nicht eindeutig aufgelöst');
      continue;
    }
    if(!completed.length){
      errors.push('OSM via-way Relation '+rule.id+
        ': keine durchgehende gerichtete Verbindung über alle via-Ways');
      continue;
    }
    for(const edgeIds of completed)restrictions.push({
      osmRelationId:rule.id,kind:rule.kind,edgeIds
    });
  }
  return {restrictions,errors,deferredIds};
}
