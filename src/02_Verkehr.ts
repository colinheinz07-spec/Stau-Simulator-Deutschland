/** 02 VERKEHR: Herkunft, Ziel, stündliche Nachfrage. Werte = Szenarien, keine Messdaten. */
export type TrafficRegion = 'transit' | 'urban' | 'rural';
export interface TrafficClock { /** Sonntag=0, Montag=1 ... Samstag=6 */ dayOfWeek: number; hour: number }
export interface Demand {originEdgeId: string; destinationNodeId: string; vehiclesPerHour: number}
/** Grobe Profil-Prototypen; später durch geprüfte regionale Zähldaten kalibrieren. */
const FACTORS: Record<'weekday' | 'friday' | 'saturday' | 'sunday', readonly (readonly [number,number])[]> = {
  weekday: [[0,.14],[5,.22],[6,.61],[8,1],[10,.7],[13,.75],[16,1.05],[18,.82],[21,.35],[24,.14]],
  friday:  [[0,.14],[5,.22],[6,.61],[8,.95],[10,.73],[12,.91],[14,1.19],[16,1.02],[18,.66],[21,.34],[24,.14]],
  saturday:[[0,.16],[6,.16],[10,.51],[13,.83],[16,.89],[19,.71],[23,.27],[24,.16]],
  sunday:  [[0,.16],[6,.12],[10,.40],[14,.76],[17,.91],[19,.78],[23,.29],[24,.16]]
};
export function demandFactor(clock: TrafficClock, region: TrafficRegion = 'transit'): number {
  if (!Number.isInteger(clock.dayOfWeek) || clock.dayOfWeek < 0 || clock.dayOfWeek > 6 ||
      !Number.isFinite(clock.hour) || clock.hour < 0 || clock.hour > 24)
    throw Error('Ungültiger Simulationskalender');
  const day = clock.dayOfWeek === 0 ? 'sunday' :
    clock.dayOfWeek === 6 ? 'saturday' : clock.dayOfWeek === 5 ? 'friday' : 'weekday';
  const curve = FACTORS[day], h = clock.hour;
  let factor = curve[curve.length - 1]![1];
  for (let i = 1; i < curve.length; i++) {
    const [until, value] = curve[i]!, [from, previous] = curve[i - 1]!;
    if (h <= until) {
      const t = (h - from) / (until - from);
      factor = previous + (value - previous) * t;
      break;
    }
  }
  const regional = region === 'urban' ? 1.14 : region === 'rural' ? .77 : 1;
  return factor * regional;
}
export function hourlyDemand(referenceVph: number, clock: TrafficClock, region: TrafficRegion): number {
  if (!Number.isFinite(referenceVph) || referenceVph < 0) throw Error('Ungültige Verkehrsnachfrage');
  return referenceVph * demandFactor(clock, region);
}
/** Nachfrage ist KEINE Kapazität: überzählige Fahrzeuge müssen in der Physik warten. */
export function validateDemands(demands: readonly Demand[]): string[] {
  return demands.flatMap(d => !d.originEdgeId || !d.destinationNodeId ||
    !Number.isFinite(d.vehiclesPerHour) || d.vehiclesPerHour < 0 ?
    ['Ungültige Ursprung-Ziel-Nachfrage'] : []);
}
