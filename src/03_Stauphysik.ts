/** 03 STAUPHYSIK: konservative Basisregeln; flächige Netz-Zellphysik folgt separat. */
import type {RoadEdge} from './model.js';
export const DEFAULT_MAINLINE_CAPACITY_PER_LANE_VPH = 2100;
export const DEFAULT_RAMP_CAPACITY_PER_LANE_VPH = 1500;
export const JAM_DENSITY_VEH_PER_KM_PER_LANE = 130;

export interface QueueState {
  /** Fahrzeugbestand vor EINEM Engpass. Nicht mit räumlicher CTM verwechseln. */
  waitingVehicles: number;
  totalArrived: number;
  totalReleased: number;
}
export interface QueueStep {
  next: QueueState;
  arrived: number;
  released: number;
}
export const emptyQueue = (): QueueState =>
  ({waitingVehicles: 0, totalArrived: 0, totalReleased: 0});
export function physicalCapacityVph(edge: RoadEdge, openLanes: number = edge.lanes): number {
  if (!Number.isInteger(openLanes) || openLanes < 0 || openLanes > edge.lanes)
    throw Error('Ungültige Anzahl freier Fahrstreifen');
  return openLanes * edge.capacityPerLaneVph;
}
/** Erhält Fahrzeugbestand exakt. Ein Wechsel zwischen zwei Abschnitten braucht
 * später Zellen, Aufnahmekapazität und gerichtete Fahrbeziehungen. */
export function advanceBottleneck(
  state: QueueState, inflowVph: number, serviceVph: number, seconds: number
): QueueStep {
  if ([state.waitingVehicles,state.totalArrived,state.totalReleased,inflowVph,serviceVph,seconds]
    .some(value => !Number.isFinite(value) || value < 0) || seconds > 3600)
    throw Error('Ungültiger physikalischer Zustand');
  const arrived = inflowVph * seconds / 3600;
  const available = state.waitingVehicles + arrived;
  const released = Math.min(available, serviceVph * seconds / 3600);
  const waitingVehicles = Math.max(0, available - released);
  return {arrived,released,next:{
    waitingVehicles, totalArrived:state.totalArrived+arrived,
    totalReleased:state.totalReleased+released
  }};
}
export function approximateQueueLengthM(waitingVehicles: number, openLanes: number): number {
  if (!Number.isFinite(waitingVehicles) || waitingVehicles < 0 ||
      !Number.isInteger(openLanes) || openLanes < 1) throw Error('Ungültiger Rückstau');
  return waitingVehicles / (JAM_DENSITY_VEH_PER_KM_PER_LANE * openLanes) * 1000;
}
