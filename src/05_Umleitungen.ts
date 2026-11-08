/** 05 UMLEITUNGEN: Dijkstra ausschließlich über explizit erlaubte Fahrbeziehungen.
 * Noch keine dynamische Routenwahl / Fahrzeuggeneration: nur reines Routing.
 */
import type {RoadNetwork} from './model.js';
import {blockedForRouting, activeNetworkClosures, type SimEvent, type CorridorClosure} from './04_Ereignisse.js';
import {permittedAfterHistory} from './05_Umleitungen/route-restrictions.js';

export interface RouteResult {edgeIds: string[]; freeTravelMinutes: number}
export function findRoute(
  network: RoadNetwork, startEdgeId: string, targetEdgeId: string,
  events: readonly SimEvent[] = [], minute = 0,
  closures: readonly CorridorClosure[] = []
): RouteResult | null {
  const edges = new Map(network.edges.map(e => [e.id, e]));
  const administrative = activeNetworkClosures(network,closures,minute);
  const start = edges.get(startEdgeId), target = edges.get(targetEdgeId);
  if (!start || !target || blockedForRouting(start,events,minute) ||
      blockedForRouting(target,events,minute) ||
      administrative.blockedEdgeIds.has(startEdgeId) ||
      administrative.blockedEdgeIds.has(targetEdgeId)) return null;
  const travelMin = (id: string): number => {
    const e = edges.get(id)!;
    return e.lengthM / 1000 / e.freeSpeedKmh * 60;
  };
  // State includes the minimal edge history required by OSM via-way
  // restrictions. Without such relations it degenerates to regular Dijkstra
  // with one state per directed edge (Germany-wide routing remains generic).
  const rules=network.routeRestrictions??[];
  const maxHistory=Math.max(1,...rules.map(r=>r.edgeIds.length-1));
  type State={edgeId:string;history:string[];minutes:number;previous:string|null};
  const states=new Map<string,State>();
  const available=new Set<string>();
  const startHistory=[startEdgeId];
  const serial=(h:readonly string[])=>h.join('\u001f');
  const startKey=serial(startHistory);
  states.set(startKey,{edgeId:startEdgeId,history:startHistory,
    minutes:travelMin(startEdgeId),previous:null});
  available.add(startKey);
  const nextById=new Map<string,string[]>();
  for(const m of network.movements)if(m.allowed){
    const list=nextById.get(m.incomingEdgeId)??[];
    list.push(m.outgoingEdgeId);
    nextById.set(m.incomingEdgeId,list);
  }
  while(available.size){
    const current=[...available].reduce((a,b)=>
      states.get(a)!.minutes<=states.get(b)!.minutes?a:b);
    available.delete(current);
    const here=states.get(current)!;
    if(here.edgeId===targetEdgeId){
      const result:string[]=[];
      let cursor:string|null=current;
      while(cursor!==null){
        const state:State=states.get(cursor)!;
        result.unshift(state.edgeId);
        cursor=state.previous;
      }
      return {edgeIds:result,freeTravelMinutes:here.minutes};
    }
    for(const nextId of nextById.get(here.edgeId)??[]){
      const next=edges.get(nextId);
      if(!next || administrative.blockedEdgeIds.has(next.id) ||
          administrative.blockedMovementKeys.has(here.edgeId+'=>'+nextId) ||
          blockedForRouting(next,events,minute))continue;
      if(!permittedAfterHistory(here.history,nextId,rules))continue;
      const history=[...here.history,nextId].slice(-maxHistory);
      const key=serial(history);
      const minutes=here.minutes+travelMin(nextId);
      if(states.has(key)&&states.get(key)!.minutes<=minutes)continue;
      states.set(key,{edgeId:nextId,history,minutes,previous:current});
      available.add(key);
    }
  }
  return null;
}
