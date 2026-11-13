/** Stabile, versionsfähige Datenverträge. Keine OSM-Koordinaten von Hand erfinden. */
export type Point = readonly [latitude: number, longitude: number];
export type RoadKind = 'mainline' | 'ramp' | 'public';
export type RoadClass =
  | 'motorway' | 'motorway_link' | 'trunk' | 'trunk_link'
  | 'primary' | 'primary_link' | 'secondary' | 'secondary_link'
  | 'tertiary' | 'tertiary_link' | 'residential' | 'unclassified' | 'living_street';

export interface RoadNode {
  /** Stabile ID aus dem OSM-Datensatz oder eigene, eindeutig markierte Grenz-ID. */
  id: string;
  point: Point;
  osmNodeId?: number;
  /** Original highway=motorway_junction, selbst wenn Knoten von Way geteilt ist. */
  junctionRef?: string;
  junctionName?: string;
}
export interface RoadEdge {
  /** Ein gerichteter physischer Abschnitt. Keine Gegenrichtung implizit ergänzen. */
  id: string;
  fromNodeId: string;
  toNodeId: string;
  geometry: readonly Point[];
  /** Positive OSM-Way-IDs; jede Geometrie muss auf echte Quelldaten zurückgehen. */
  osmWayIds: readonly number[];
  kind: RoadKind;
  osmClass: RoadClass;
  motorwayRef?: string;
  /** Physisch gemeinsam geführte Autobahnen (z. B. A3/A4) ohne doppelte Fahrbahnen. */
  motorwayRefs?: readonly string[];
  lanes: number;
  lengthM: number;
  freeSpeedKmh: number;
  /** Ausbaubare Modellannahme, nicht automatisch Messwert. */
  capacityPerLaneVph: number;
}
export interface TurnMovement {
  /** Nur explizit erlaubte gerichtete Fahrbeziehungen werden geroutet. */
  incomingEdgeId: string;
  outgoingEdgeId: string;
  allowed: boolean;
  capacityVph?: number;
}
/** Path-specific OSM via-way prohibition/mandatory turn. A pairwise turn is insufficient. */
export interface RouteRestriction {
  osmRelationId:number;
  kind:'no'|'only';
  /** Exact directed edge sequence from from-way through via-way(s) to to-way. */
  edgeIds:readonly string[];
}
export interface RoadNetwork {
  schemaVersion: 1;
  nodes: readonly RoadNode[];
  edges: readonly RoadEdge[];
  movements: readonly TurnMovement[];
  routeRestrictions?: readonly RouteRestriction[];
}
export interface SpeedSample { edgeId: string; speedKmh: number; atMinute: number }
/** Exact simulated cell interval. Only published for physically congested cells. */
export interface TrafficCellBand {
  edgeId: string;
  fromM: number;
  toM: number;
  speedKmh: number;
  atMinute: number;
}
