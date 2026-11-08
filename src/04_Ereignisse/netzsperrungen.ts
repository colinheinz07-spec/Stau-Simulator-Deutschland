/** Allgemeine Streckensperrung für JEDE Autobahn – ausschließlich aus dem gerichteten Netzgraphen.
 * Keine Listen von A3-/A4-/A59-Kreuznamen und keine Knoten-Entfernung per Luftlinie.
 */
import type {RoadNetwork, RoadEdge, TurnMovement} from '../model.js';

export interface CorridorClosure {
  id: string;
  motorwayRef: string;
  /** Richtungsabhängige reale Netz-Knoten, die den gesperrten Teil begrenzen. */
  fromNodeId: string;
  toNodeId: string;
  startMinute: number;
  endMinute?: number;
}
export interface NetworkClosurePlan {
  closureId: string;
  /** Vollständig gerichtete Hauptfahrbahnen zwischen A und B, parallele Arme inklusive. */
  mainlineEdgeIds: readonly string[];
  /** Rampen, deren sämtliche erlaubten Fortsetzungen in die Sperrung führen. */
  rampEdgeIds: readonly string[];
  /** Aus offenem Fahrweg nicht mehr in geschlossene Fahrwege einfahren. */
  blockedMovements: readonly {incomingEdgeId: string; outgoingEdgeId: string}[];
  /** Rot-weiß zu markierende Fahrwege, gleiche IDs wie in der Simulation. */
  closedEdgeIds: readonly string[];
}
const movementKey = (m: Pick<TurnMovement, 'incomingEdgeId' | 'outgoingEdgeId'>) =>
  m.incomingEdgeId + '=>' + m.outgoingEdgeId;

export function validateCorridorClosure(network: RoadNetwork, c: CorridorClosure): string[] {
  const errors: string[] = [];
  if (!c.id || !/^A\d{1,3}$/.test(c.motorwayRef)) errors.push('Ungültige Sperrung/Autobahn');
  if (!c.fromNodeId || !c.toNodeId || c.fromNodeId === c.toNodeId)
    errors.push('Sperrgrenzen A und B müssen verschieden sein');
  if (!network.nodes.some(n => n.id === c.fromNodeId) ||
      !network.nodes.some(n => n.id === c.toNodeId))
    errors.push('Sperrgrenze liegt nicht im importierten gerichteten Netz');
  if (!Number.isFinite(c.startMinute) ||
      (c.endMinute !== undefined && (!Number.isFinite(c.endMinute) || c.endMinute <= c.startMinute)))
    errors.push('Ungültiger Sperrzeitraum');
  return errors;
}
export function activeCorridorClosure(closure: CorridorClosure, minute: number): boolean {
  return Number.isFinite(minute) && minute >= closure.startMinute &&
    (closure.endMinute === undefined || minute < closure.endMinute);
}
function reverseIndex(moves: readonly TurnMovement[]): Map<string,string[]> {
  const back = new Map<string,string[]>();
  for (const m of moves) {
    if (!m.allowed) continue;
    const old = back.get(m.outgoingEdgeId) ?? [];
    old.push(m.incomingEdgeId);
    back.set(m.outgoingEdgeId, old);
  }
  return back;
}
/** Reachability through existing *directed* lane movements. Excludes all edges
 * that cannot be traversed in the requested motorway and direction. */
export function planCorridorClosure(network: RoadNetwork, closure: CorridorClosure): NetworkClosurePlan {
  const errors = validateCorridorClosure(network, closure);
  if (errors.length) throw new Error(errors.join('; '));
  const edges = new Map(network.edges.map(e => [e.id, e]));
  const main = new Map(network.edges
    .filter(e => e.kind === 'mainline' &&
      (e.motorwayRefs?.includes(closure.motorwayRef) ?? e.motorwayRef === closure.motorwayRef))
    .map(e => [e.id, e]));
  const next = new Map<string,string[]>(), reverse = new Map<string,string[]>();
  for (const movement of network.movements) {
    if (!movement.allowed || !main.has(movement.incomingEdgeId) ||
        !main.has(movement.outgoingEdgeId)) continue;
    const from = main.get(movement.incomingEdgeId)!;
    const to = main.get(movement.outgoingEdgeId)!;
    if (from.toNodeId !== to.fromNodeId) continue;
    next.set(from.id, [...(next.get(from.id)??[]), to.id]);
    reverse.set(to.id, [...(reverse.get(to.id)??[]), from.id]);
  }
  const walk = (seeds: string[], adjacent: Map<string,string[]>, boundary: (edge: RoadEdge)=>boolean) => {
    const seen = new Set<string>(), pending = seeds.slice();
    while (pending.length) {
      const id = pending.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      const edge = main.get(id);
      if (edge && !boundary(edge)) for (const id2 of adjacent.get(id) ?? []) pending.push(id2);
    }
    return seen;
  };
  const downstream = walk(
    [...main.values()].filter(e => e.fromNodeId === closure.fromNodeId).map(e => e.id),
    next, e => e.toNodeId === closure.toNodeId
  );
  const upstream = walk(
    [...main.values()].filter(e => e.toNodeId === closure.toNodeId).map(e => e.id),
    reverse, e => e.fromNodeId === closure.fromNodeId
  );
  const closedMainline = new Set([...downstream].filter(id => upstream.has(id)));
  if (!closedMainline.size)
    throw new Error('Keine gerichtete Autobahnverbindung zwischen den gewählten Sperrgrenzen');

  // Rückwärts alle gerichteten Vorgänger bis zu den geschlossenen Haupt-
  // fahrbahnen ablaufen. Auch eine Rampe, die zunächst auf eine OFFENE
  // Autobahn führt, kann tatsächlich nur noch an A in die Sperrung führen.
  const back = reverseIndex(network.movements);
  const movementNext = new Map<string,string[]>();
  for (const m of network.movements) if (m.allowed) {
    const arr = movementNext.get(m.incomingEdgeId) ?? [];
    arr.push(m.outgoingEdgeId);
    movementNext.set(m.incomingEdgeId,arr);
  }
  const upstreamWithoutPublicRoads = (sources: Iterable<string>): Set<string> => {
    const seen = new Set<string>(), pending = [...sources];
    while (pending.length) {
      const current = pending.pop()!;
      if (seen.has(current)) continue;
      seen.add(current);
      for (const previous of back.get(current) ?? []) {
        const edge = edges.get(previous);
        if (edge && edge.kind !== 'public' && !closedMainline.has(previous))
          pending.push(previous);
      }
    }
    return seen;
  };
  const towardsClosure = upstreamWithoutPublicRoads(closedMainline);
  // Öffentliche Straßen sowie echte offene Netzgrenzen sind zulässige
  // Rettungs-/Alternativziele. Eine vor A liegende Hauptfahrbahn, die
  // ausschliesslich in die Sperrung führt, ist dagegen KEIN offener
  // Ausweichweg (dort darf sich nur vorhandener Verkehr stauen).
  const openTerminals = network.edges.filter(edge =>
    !closedMainline.has(edge.id) && (
      edge.kind === 'public' || (movementNext.get(edge.id)?.length??0)===0
    )).map(edge=>edge.id);
  const hasLegalEscape = upstreamWithoutPublicRoads(openTerminals);
  const closedRamps = new Set(network.edges.filter(edge =>
    edge.kind === 'ramp' && towardsClosure.has(edge.id) &&
    !hasLegalEscape.has(edge.id)
  ).map(edge=>edge.id));
  const closedEdges = new Set([...closedMainline, ...closedRamps]);
  const blocked = network.movements.filter(m => m.allowed &&
    closedEdges.has(m.outgoingEdgeId) && !closedEdges.has(m.incomingEdgeId));

  const order = (values: Iterable<string>) => [...values].sort();
  return {
    closureId: closure.id,
    mainlineEdgeIds: order(closedMainline),
    rampEdgeIds: order(closedRamps),
    closedEdgeIds: order(closedEdges),
    blockedMovements: blocked.map(m=>({
      incomingEdgeId:m.incomingEdgeId, outgoingEdgeId:m.outgoingEdgeId
    })).sort((a,b)=>movementKey(a).localeCompare(movementKey(b)))
  };
}

/** Liefert Sperrungen auf denselben Edge-IDs an Physik, Routing und Karte.
 * Keine Fahrzeuge werden dadurch erzeugt, verschoben oder gelöscht.
 */
export function activeNetworkClosures(
  network: RoadNetwork, closures: readonly CorridorClosure[], minute: number
): {blockedEdgeIds: Set<string>; blockedMovementKeys: Set<string>;
    spans: {edgeId:string;fromM:number;toM:number;closureId:string}[]} {
  const blockedEdgeIds = new Set<string>(), blockedMovementKeys = new Set<string>();
  const spans: {edgeId:string;fromM:number;toM:number;closureId:string}[] = [];
  const edges = new Map(network.edges.map(e=>[e.id,e]));
  for (const closure of closures) {
    if (!activeCorridorClosure(closure,minute)) continue;
    const plan = planCorridorClosure(network,closure);
    for (const id of plan.closedEdgeIds) {
      blockedEdgeIds.add(id);
      const edge = edges.get(id)!;
      spans.push({edgeId:id,fromM:0,toM:edge.lengthM,closureId:closure.id});
    }
    for (const m of plan.blockedMovements) blockedMovementKeys.add(movementKey(m));
  }
  return {blockedEdgeIds,blockedMovementKeys,spans};
}
