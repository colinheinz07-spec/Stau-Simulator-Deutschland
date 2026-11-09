/** 06 KARTE: übernommenes Prinzip aus altem Stau-Simulator:
 * Map callout collision avoidance + prioritised AS labels.
 *
 * This function works with ANY region's physical OSM motorway_junction nodes;
 * it never moves the source coordinate or fabricates a road/AS location.
 */
import type {Point,RoadNode} from '../model.js';

export interface ScreenPoint {x:number;y:number}
export interface ScreenBox {x:number;y:number;width:number;height:number}
export interface LabelPlacement {
  nodeId:string;
  label:string;
  position:Point;
  box:ScreenBox;
}
/** Project a real OSM geo point to screen without changing its geography. */
export type GeoProjector=(point:Point)=>ScreenPoint;
export interface JunctionLayoutOptions {
  width:number;
  height:number;
  reserved?:readonly ScreenBox[];
  maxLabels?:number;
  minSameNameDistancePx?:number;
}
export function overlapsLabel(a:ScreenBox,b:ScreenBox,padding=4):boolean {
  return a.x<b.x+b.width+padding&&a.x+a.width+padding>b.x&&
    a.y<b.y+b.height+padding&&a.y+a.height+padding>b.y;
}
function rank(name:string):number {
  return /\b(kreuz|dreieck)\b/i.test(name)?0:
    /\b(autobahn|anschlussstelle)\b/i.test(name)?1:2;
}
/** Exact motorway_junction nodes only. Duplicate carriageway anchors bearing
 * the same name are clustered on screen (not snapped physically).
 * Invisible labels stay in details; important ramps remain uncovered.
 */
export function layoutJunctionLabels(
  nodes:readonly RoadNode[],project:GeoProjector,
  options:JunctionLayoutOptions
):LabelPlacement[]{
  const {width,height}=options;
  if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)
    throw Error('Ungültiger Kartenausschnitt');
  const maxLabels=Math.min(Math.max(0,options.maxLabels??100),1000);
  const reserved:ScreenBox[]=[...(options.reserved??[])];
  const nameAnchors=new Map<string,ScreenPoint[]>();
  const labels=nodes.filter(n=>n.junctionRef||n.junctionName)
    .map(n=>({node:n,label:[n.junctionRef,n.junctionName].filter(Boolean).join(' · ') }))
    .sort((a,b)=>rank(a.label)-rank(b.label)||a.label.localeCompare(b.label,'de'));
  const placements:LabelPlacement[]=[];
  for(const {node,label} of labels){
    if(placements.length>=maxLabels)break;
    const point=project(node.point);
    if(!Number.isFinite(point.x)||!Number.isFinite(point.y))continue;
    if(point.x<-40||point.x>width+40||point.y<-35||point.y>height+35)continue;
    const duplicateKey=(node.junctionName??node.junctionRef??label).trim().toLocaleLowerCase('de');
    const nearby=nameAnchors.get(duplicateKey)??[];
    if(nearby.some(p=>Math.hypot(p.x-point.x,p.y-point.y)<(options.minSameNameDistancePx??130)))
      continue;
    const textWidth=Math.max(42,Math.min(250,label.length*6.8+16)),h=21;
    const offsets:[[number,number],[number,number],[number,number],[number,number]]=[
      [12,-27],[-textWidth-12,-27],[12,9],[-textWidth-12,9]
    ];
    let chosen:ScreenBox|undefined;
    for(const [dx,dy] of offsets){
      const box={x:point.x+dx,y:point.y+dy,width:textWidth,height:h};
      if(box.x<3||box.y<3||box.x+box.width>width-3||box.y+h>height-3)continue;
      if(reserved.some(existing=>overlapsLabel(existing,box,5)))continue;
      chosen=box;break;
    }
    if(!chosen)continue;
    reserved.push(chosen);
    nameAnchors.set(duplicateKey,[...nearby,point]);
    placements.push({nodeId:node.id,label,position:node.point,box:chosen});
  }
  return placements;
}
