/** 06 KARTE: Darstellung allein – niemals Fahrzeugbestände oder Verbindungen erfinden. */
import type {Point, RoadNetwork, RoadKind, SpeedSample,TrafficCellBand} from './model.js';
import type {SimEvent,CorridorClosure} from './04_Ereignisse.js';
import {activeNetworkClosures} from './04_Ereignisse.js';
import {activeEvent} from './04_Ereignisse.js';
export type TrafficColour = 'free' | 'slow' | 'jam' | 'standstill';
export function colourAtSpeed(kmh: number): TrafficColour {
  if (!Number.isFinite(kmh) || kmh < 0) throw Error('Ungültige Geschwindigkeit');
  if (kmh <= 10) return 'standstill';
  if (kmh <= 30) return 'jam';
  if (kmh <= 65) return 'slow';
  return 'free';
}
export interface DrawableEdge {
  edgeId: string;
  kind: RoadKind;
  geometry: readonly Point[];
  colour: TrafficColour;
  speedKmh: number;
  /** Vorsimulations-Zustand = angenommene freie Geschwindigkeit, keine Messung. */
  source: 'model' | 'initial-free';
  /** Actual cell slowdown only; do not color entire OSM Ways red. */
  trafficBands: readonly {fromM:number;toM:number;colour:TrafficColour;speedKmh:number}[];
  /** Abschnitte zur gesonderten rot-weißen Sperrmarkierung. */
  closures: readonly {fromM:number;toM:number}[];
}
/** Jede importierte motorway/motorway_link-Geometrie erscheint GENAU einmal.
 * Normale Straßen sind keine grünen Autobahnrampen. */
export function motorwayMapEdges(
  network: RoadNetwork, speeds: readonly SpeedSample[] = [],
  events: readonly SimEvent[] = [], minute = 0,
  corridors: readonly CorridorClosure[] = [],
  cellSamples: readonly TrafficCellBand[] = []
): DrawableEdge[] {
  const known = new Map(speeds.map(s => [s.edgeId,s.speedKmh]));
  const slowByEdge = new Map<string,TrafficCellBand[]>();
  for(const sample of cellSamples){
    const list=slowByEdge.get(sample.edgeId)??[];
    list.push(sample);slowByEdge.set(sample.edgeId,list);
  }
  const networkClosures = activeNetworkClosures(network,corridors,minute);
  const closedByEdge = new Map<string,{fromM:number;toM:number}[]>();
  for (const span of networkClosures.spans) closedByEdge.set(span.edgeId,[
    ...(closedByEdge.get(span.edgeId)??[]), {fromM:span.fromM,toM:span.toM}
  ]);
  return network.edges.filter(e => e.kind !== 'public').map(edge => {
    const measured = known.get(edge.id);
    const speedKmh = measured ?? edge.freeSpeedKmh;
    return {edgeId:edge.id,kind:edge.kind,geometry:edge.geometry,
      colour:colourAtSpeed(speedKmh),speedKmh,
      source: measured === undefined ? 'initial-free' as const : 'model' as const,
      trafficBands:(slowByEdge.get(edge.id)??[])
        .filter(s=>Number.isFinite(s.fromM)&&Number.isFinite(s.toM)&&
          s.fromM>=0&&s.toM>s.fromM&&s.toM<=edge.lengthM+.01)
        .map(s=>({fromM:s.fromM,toM:Math.min(edge.lengthM,s.toM),
          colour:colourAtSpeed(s.speedKmh),speedKmh:s.speedKmh})),
      closures:events.filter(e => e.edgeId === edge.id && e.kind === 'closure' &&
        activeEvent(e,minute)).map(e => ({fromM:e.fromM,toM:e.toM}))
        .concat(closedByEdge.get(edge.id)??[])};
  });
}

export {tilesForViewport,assembleVisibleTiles} from './06_Karte/network-tiles.js';
export type {TileManifest,TileManifestEntry,NetworkTile,Bounds,VisibleNetwork} from './06_Karte/network-tiles.js';

export {layoutJunctionLabels,overlapsLabel} from './06_Karte/label-layout.js';
export type {JunctionLayoutOptions,LabelPlacement,ScreenBox,ScreenPoint} from './06_Karte/label-layout.js';
