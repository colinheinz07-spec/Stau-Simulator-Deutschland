/** 01 STRASSENNETZ: Topologie und OSM-Qualitätsprüfung, keine Verkehrsberechnung. */
import type {Point, RoadEdge, RoadNetwork, TurnMovement} from './model.js';
export type {RoadNode, RoadEdge, RoadNetwork, TurnMovement, RoadKind, RoadClass, Point} from './model.js';

export function distanceM(a: Point, b: Point): number {
  const lat = (a[0] + b[0]) * Math.PI / 360;
  return 111195 * Math.hypot(a[0] - b[0], (a[1] - b[1]) * Math.cos(lat));
}
export function polylineLengthM(points: readonly Point[]): number {
  let metres = 0;
  for (let i = 1; i < points.length; i++) metres += distanceM(points[i - 1]!, points[i]!);
  return metres;
}
function validPoint(p: Point): boolean {
  return Number.isFinite(p[0]) && Math.abs(p[0]) <= 90 &&
    Number.isFinite(p[1]) && Math.abs(p[1]) <= 180;
}
/** Keine automatische Verbindung nur wegen geografischer Nähe. */
export function validateNetwork(network: RoadNetwork): string[] {
  const errors: string[] = [];
  if (network.schemaVersion !== 1) errors.push('Unbekannte Netzschema-Version');
  const nodes = new Map<string, Point>();
  for (const n of network.nodes) {
    if (!n.id || nodes.has(n.id)) errors.push('Doppelte/fehlende Knoten-ID ' + n.id);
    if (!validPoint(n.point)) errors.push('Ungültige Knotenkoordinate ' + n.id);
    nodes.set(n.id, n.point);
  }
  const edges = new Map<string, RoadEdge>();
  for (const e of network.edges) {
    if (!e.id || edges.has(e.id)) errors.push('Doppelte/fehlende Segment-ID ' + e.id);
    edges.set(e.id, e);
    if (!nodes.has(e.fromNodeId) || !nodes.has(e.toNodeId))
      errors.push('Nicht existierender Start-/Zielknoten ' + e.id);
    if (e.fromNodeId === e.toNodeId) errors.push('Schleifen-Segment ' + e.id);
    if (e.geometry.length < 2 || e.geometry.some(p => !validPoint(p)))
      errors.push('Ungültige OSM-Geometrie ' + e.id);
    if (!e.osmWayIds.length || e.osmWayIds.some(id => !Number.isSafeInteger(id) || id <= 0))
      errors.push('Fehlender OSM-Way-Beleg ' + e.id);
    if (e.kind === 'mainline' && e.osmClass !== 'motorway')
      errors.push('Hauptfahrbahn ist kein motorway ' + e.id);
    if (e.kind === 'ramp' && e.osmClass !== 'motorway_link')
      errors.push('Rampe ist kein motorway_link ' + e.id);
    if (e.kind === 'public' && (e.osmClass === 'motorway' || e.osmClass === 'motorway_link'))
      errors.push('Autobahn versehentlich als öffentliche Straße klassifiziert ' + e.id);
    if (e.kind !== 'public' && !/^A\d{1,3}$/.test(e.motorwayRef ?? ''))
      errors.push('Autobahnreferenz fehlt ' + e.id);
    if (!Number.isInteger(e.lanes) || e.lanes < 1 || e.lanes > 8)
      errors.push('Ungültige Fahrstreifenanzahl ' + e.id);
    if (![e.lengthM, e.freeSpeedKmh, e.capacityPerLaneVph].every(Number.isFinite) ||
        e.lengthM <= 0 || e.freeSpeedKmh <= 0 || e.capacityPerLaneVph <= 0)
      errors.push('Ungültige Abschnittsphysik ' + e.id);
    if (e.geometry.length >= 2) {
      const start = nodes.get(e.fromNodeId), end = nodes.get(e.toNodeId);
      if (start && distanceM(start, e.geometry[0]!) > 0.05)
        errors.push('OSM-Startpunkt stimmt nicht mit Knoten überein ' + e.id);
      if (end && distanceM(end, e.geometry[e.geometry.length - 1]!) > 0.05)
        errors.push('OSM-Endpunkt stimmt nicht mit Knoten überein ' + e.id);
      const calculated = polylineLengthM(e.geometry);
      if (Math.abs(calculated - e.lengthM) > Math.max(5, calculated * .1))
        errors.push('Gemeldete Länge weicht von OSM-Geometrie ab ' + e.id);
    }
  }
  const turns = new Set<string>();
  for (const m of network.movements) {
    const key = m.incomingEdgeId + '=>' + m.outgoingEdgeId;
    if (turns.has(key)) errors.push('Doppelte Fahrbeziehung ' + key);
    turns.add(key);
    const entering = edges.get(m.incomingEdgeId), leaving = edges.get(m.outgoingEdgeId);
    if (!entering || !leaving || entering.toNodeId !== leaving.fromNodeId)
      errors.push('Fahrbeziehung ohne identischen OSM-Knoten ' + key);
    if (m.capacityVph !== undefined && (!Number.isFinite(m.capacityVph) || m.capacityVph <= 0))
      errors.push('Ungültige Knoten-Kapazität ' + key);
  }
  return errors;
}
export function outgoingMovements(network: RoadNetwork, edgeId: string): TurnMovement[] {
  return network.movements.filter(m => m.allowed && m.incomingEdgeId === edgeId);
}
