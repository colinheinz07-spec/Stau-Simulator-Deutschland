/** 04 EREIGNISSE: Eingriffe in gerichtete Abschnitte, unabhängig von der Karte. */
import type {RoadEdge} from './model.js';
import {physicalCapacityVph} from './03_Stauphysik.js';
export type EventKind = 'accident' | 'roadworks' | 'breakdown' | 'closure';
export interface SimEvent {
  id: string;
  edgeId: string;
  kind: EventKind;
  fromM: number;
  toM: number;
  closedLanes: readonly number[];
  startMinute: number;
  endMinute?: number;
}
export function validateEvent(event: SimEvent, edge: RoadEdge): string[] {
  const errors: string[] = [];
  if (!event.id || event.edgeId !== edge.id) errors.push('Ereignis hat falschen Fahrweg');
  if (![event.fromM,event.toM,event.startMinute].every(Number.isFinite) ||
      event.fromM < 0 || event.toM <= event.fromM || event.toM > edge.lengthM + .01)
    errors.push('Ungültiger Ereignisbereich');
  if (event.endMinute !== undefined && (!Number.isFinite(event.endMinute) ||
      event.endMinute <= event.startMinute)) errors.push('Ungültiges Ereignisende');
  if (new Set(event.closedLanes).size !== event.closedLanes.length ||
      event.closedLanes.some(l => !Number.isInteger(l) || l < 0 || l >= edge.lanes))
    errors.push('Ungültige gesperrte Fahrstreifen');
  return errors;
}
export function activeEvent(event: SimEvent, minute: number): boolean {
  return Number.isFinite(minute) && minute >= event.startMinute &&
    (event.endMinute === undefined || minute < event.endMinute);
}
/** Abschnittskapazität an einer Position: Stau entsteht erst durch Fahrzeuge.
 * Eine Sperrmarkierung ist unabhängig von der tatsächlichen Staufarbe. */
export function capacityAtPosition(
  edge: RoadEdge, metre: number, minute: number, events: readonly SimEvent[]
): number {
  if (metre < 0 || metre > edge.lengthM || !Number.isFinite(metre)) throw Error('Ungültige Streckenposition');
  const affecting = events.filter(e => e.edgeId === edge.id && activeEvent(e, minute) &&
    metre >= e.fromM && metre < e.toM);
  if (affecting.some(e => e.kind === 'closure')) return 0;
  const blocked = new Set(affecting.flatMap(e => [...e.closedLanes]));
  return physicalCapacityVph(edge, edge.lanes - blocked.size);
}
export function blockedForRouting(edge: RoadEdge, events: readonly SimEvent[], minute: number): boolean {
  return events.some(e => e.edgeId === edge.id && activeEvent(e,minute) &&
    (e.kind === 'closure' || new Set(e.closedLanes).size === edge.lanes));
}
