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
export interface RoadNetwork {
  schemaVersion: 1;
  nodes: readonly RoadNode[];
  edges: readonly RoadEdge[];
  movements: readonly TurnMovement[];
}
export interface SpeedSample { edgeId: string; speedKmh: number; atMinute: number }
