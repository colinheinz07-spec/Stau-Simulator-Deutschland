/* Signed motorway diversions: OSM geometry + regional wiki catalogue.
 * No synthetic road segments; incomplete relations are drawn separately.
 */
(function(global){
"use strict";
const grid=new Map(),wide=[],matching=new Map(),cache=new Map(),listeners=new Set();
const CELL=.25;
let routes=[],status="loading",revision=0;
const normalize=s=>String(s||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/ß/g,"ss").replace(/[^a-z0-9]/g,"");
const autobahn=s=>String(s||"").match(/\bA\s*(\d+)\b/i)?.[1];
function junction(s){
  return normalize(String(s||"").split(" · ")[0].replace(/^(?:AS|AK|AD|Anschlussstelle|Autobahnkreuz|Autobahndreieck)\s*(?:\d+[a-z]?\s*)?/i,""));
}
function nameMatches(a,b){
  a=junction(a);b=junction(b);
  return a.length>=4&&b.length>=4&&(a===b||a.includes(b)||b.includes(a));
}
function metres(a,b){
  const dx=(a[1]-b[1])*111320*Math.cos((a[0]+b[0])*Math.PI/360);
  return Math.hypot(dx,(a[0]-b[0])*111320);
}
function key(y,x){return y+","+x;}
function notify(){for(const fn of listeners)try{fn();}catch(e){console.warn(e);}}
function install(data){
  if(data?.schema!==1||!Array.isArray(data.routes)||!data.routes.length)throw Error("Invalid signed detour dataset");
  grid.clear();wide.length=0;matching.clear();cache.clear();
  routes=[];
  for(const r of data.routes){
    if(!Array.isArray(r.parts)||!r.parts.length)continue;
    let south=Infinity,west=Infinity,north=-Infinity,east=-Infinity;
    for(const p of r.parts)for(const [lat,lon] of p){
      south=Math.min(south,lat);north=Math.max(north,lat);west=Math.min(west,lon);east=Math.max(east,lon);
    }
    if(!Number.isFinite(south))continue;
    r.bounds=[south,west,north,east];routes.push(r);
    const y0=Math.floor(south/CELL),y1=Math.floor(north/CELL),x0=Math.floor(west/CELL),x1=Math.floor(east/CELL);
    if((y1-y0+1)*(x1-x0+1)>256)wide.push(r);
    else for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
      const k=key(y,x);if(!grid.has(k))grid.set(k,[]);grid.get(k).push(r);
    }
    if(r.eligible&&r.parts.length===1){
      const p=r.parts[0];if(p.length<2)continue;
      for(const ref of r.motorways||[]){
        const a=autobahn(ref);if(!a)continue;
        // Spatially index both possible geometry orientations; route metadata
        // determines the direction, never the U-number parity.
        for(const point of [p[0],p.at(-1)]){
          const k=a+":"+key(Math.floor(point[0]/CELL),Math.floor(point[1]/CELL));
          if(!matching.has(k))matching.set(k,new Set());matching.get(k).add(r);
        }
      }
    }
  }
  status="ready";revision++;notify();
}
function visible(bounds){
  const [s,w,n,e]=bounds,found=new Set(wide);
  const y0=Math.floor(s/CELL),y1=Math.floor(n/CELL),x0=Math.floor(w/CELL),x1=Math.floor(e/CELL);
  if((y1-y0+1)*(x1-x0+1)>4096)return routes.filter(r=>intersects(r.bounds,bounds));
  for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++)for(const r of grid.get(key(y,x))||[])found.add(r);
  return [...found].filter(r=>intersects(r.bounds,bounds));
}
function intersects(a,b){return a[0]<=b[2]&&a[2]>=b[0]&&a[1]<=b[3]&&a[3]>=b[1];}
function match(exit,entry,start,end){
  if(status!=="ready"||!start||!end||entry.externalDetourLabel)return null;
  const a=autobahn(exit.ref),b=autobahn(entry.ref);
  if(!a||a!==b)return null;
  const k=[exit.id,entry.id,start.join(","),end.join(",")].join("|");
  if(cache.has(k))return cache.get(k);
  const candidates=new Set(),y=Math.floor(start[0]/CELL),x=Math.floor(start[1]/CELL);
  for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)
    for(const route of matching.get(a+":"+key(y+dy,x+dx))||[])candidates.add(route);
  let best=null,score=Infinity;
  for(const route of candidates){
    if(!nameMatches(exit.name,route.from)||!nameMatches(entry.name,route.to))continue;
    const p=route.parts[0],first=p[0],last=p.at(-1);
    const f=[metres(start,first),metres(end,last)],r=[metres(start,last),metres(end,first)];
    const gaps=f[0]+f[1]<=r[0]+r[1]?f:r;
    // Route and actual directed ramps must meet at the same junctions.
    // Do not silently connect incomplete routes or distant endpoints.
    if(Math.max(...gaps)>700||!Number.isFinite(route.lengthM)||route.lengthM<100)continue;
    const cost=gaps[0]+gaps[1];
    if(cost<score){best={route,lengthM:route.lengthM+cost};score=cost;}
  }
  if(cache.size>10000)cache.clear();cache.set(k,best);return best;
}
global.StauBedarfsumleitungen={install,visible,match,get status(){return status;},get revision(){return revision;},
  get count(){return routes.length;},subscribe(fn){listeners.add(fn);return ()=>listeners.delete(fn);}};
const script=document.createElement("script");
script.async=true;
script.src="./data/bedarfsumleitungen-data.js";
script.onerror=()=>{status="unavailable";notify();};
document.head.append(script);
})(window);
