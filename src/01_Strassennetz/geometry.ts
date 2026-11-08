/** Geodesische Länge in Metern aus Original-OSM-Koordinaten.
 * Eigenständiger Kern ohne Abhängigkeit zum Netzwerkimport oder zur UI.
 */
import type {Point} from '../model.js';
export function distanceM(a:Point,b:Point):number {
 const lat=(a[0]+b[0])*Math.PI/360;
 return 111195*Math.hypot(a[0]-b[0],(a[1]-b[1])*Math.cos(lat));
}
export function polylineLengthM(points:readonly Point[]):number {
 let metres=0;
 for(let i=1;i<points.length;i++)metres+=distanceM(points[i-1]!,points[i]!);
 return metres;
}
