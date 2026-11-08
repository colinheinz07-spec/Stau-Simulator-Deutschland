/** Geofabrik/Osmosis .poly is the actual clipping boundary of an OSM PBF.
 * A motorway link ending EXACTLY at this border is an external port, not
 * a missing piece in the data slice. Never make up a connection beyond it.
 */
import type {Point} from '../model.js';

export function parseOsmosisPoly(text:string):Point[][] {
  const lines=text.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  if(lines.length<5)throw Error('Leere oder ungültige OSM .poly Datei');
  const polys:Point[][]=[];
  let ring:Point[]|null=null;
  for(const line of lines.slice(1)){
    if(line==='END'){
      if(ring){
        if(ring.length<3)throw Error('OSM .poly Ring ohne 3 Eckpunkte');
        polys.push(ring);
        ring=null;
      }else break;
      continue;
    }
    const m=line.match(/^([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s+([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)$/);
    if(m){
      if(!ring)throw Error('OSM .poly Koordinaten außerhalb Ring');
      const lon=Number(m[1]),lat=Number(m[2]);
      if(Math.abs(lat)>90||Math.abs(lon)>180)throw Error('OSM .poly Koordinate außerhalb Welt');
      ring.push([lat,lon]);
    }else{
      if(ring)throw Error('OSM .poly Ring nicht mit END geschlossen');
      ring=[];
    }
  }
  if(ring||!polys.length)throw Error('Ungültige oder nicht geschlossene OSM .poly-Datei');
  return polys;
}
export function distanceToExtractBoundaryM(p:Point,rings:readonly (readonly Point[])[]):number {
  const cos=Math.cos(p[0]*Math.PI/180),scale=111195;
  let minimum=Infinity;
  for(const ring of rings){
    for(let i=0;i<ring.length;i++){
      const a=ring[i]!,b=ring[(i+1)%ring.length]!;
      const ax=(a[1]-p[1])*cos*scale,ay=(a[0]-p[0])*scale;
      const bx=(b[1]-p[1])*cos*scale,by=(b[0]-p[0])*scale;
      const dx=bx-ax,dy=by-ay,den=dx*dx+dy*dy;
      const fraction=den>0?Math.max(0,Math.min(1,-(ax*dx+ay*dy)/den)):0;
      minimum=Math.min(minimum,Math.hypot(ax+fraction*dx,ay+fraction*dy));
    }
  }
  return minimum;
}
