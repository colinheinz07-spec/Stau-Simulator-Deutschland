/** 05 UMLEITUNGEN: Dijkstra ausschließlich über explizit erlaubte Fahrbeziehungen.
 * Noch keine dynamische Routenwahl / Fahrzeuggeneration: nur reines Routing.
 */
import type {RoadNetwork} from './model.js';
import {blockedForRouting, activeNetworkClosures, type SimEvent, type CorridorClosure} from './04_Ereignisse.js';

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
  const paths = new Map<string, {minutes:number; previous:string|null}>(
    [[startEdgeId,{minutes:travelMin(startEdgeId),previous:null}]]);
  const remaining = new Set<string>([startEdgeId]);
  while (remaining.size) {
    const current = [...remaining].reduce((a,b) =>
      paths.get(a)!.minutes <= paths.get(b)!.minutes ? a : b);
    remaining.delete(current);
    if (current === targetEdgeId) {
      const result: string[] = [];
      let at: string | null = current;
      while (at !== null) {
        result.unshift(at);
        at = paths.get(at)!.previous;
      }
      return {edgeIds:result,freeTravelMinutes:paths.get(current)!.minutes};
    }
    for (const movement of network.movements) {
      if (!movement.allowed || movement.incomingEdgeId !== current ||
          administrative.blockedMovementKeys.has(movement.incomingEdgeId+'=>'+movement.outgoingEdgeId)) continue;
      const next = edges.get(movement.outgoingEdgeId);
      if (!next || administrative.blockedEdgeIds.has(next.id) || blockedForRouting(next,events,minute)) continue;
      const minutes = paths.get(current)!.minutes + travelMin(next.id);
      const known = paths.get(next.id);
      if (!known || minutes < known.minutes) {
        paths.set(next.id, {minutes,previous:current});
        remaining.add(next.id);
      }
    }
  }
  return null;
}
