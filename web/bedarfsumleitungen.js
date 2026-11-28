/* Signed motorway diversions: OSM geometry + regional wiki catalogue.
 * No synthetic road segments; incomplete relations are drawn separately.
 */
(function(global){
"use strict";
const grid=new Map(),wide=[],matching=new Map(),cache=new Map(),listeners=new Set();
const CELL=.25;
let routes=[],status="loading",revision=0,dataset=null;
const normalize=s=>String(s||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/ß/g,"ss").replace(/[^a-z0-9]/g,"");
const autobahn=s=>String(s||"").match(/\bA\s*(\d+)\b/i)?.[1];
function endpointMotorways(r){
  const from=autobahn(r.fromMotorway||r.from),to=autobahn(r.toMotorway||r.to);
  const refs=[...new Set((r.motorways||[]).map(autobahn).filter(Boolean))];
  // A single catalogue motorway may describe the destination motorway of
  // a cross route; explicit endpoint refs take precedence.
  const fallback=refs.length===1?refs[0]:null;
  return [from||fallback,to||fallback];
}
function junction(s){
  const label=String(s||"").split(" · ")[0].replace(/^A\s*\d+\s*/i,"").trim();
  const number=label.match(/^(?:AS|AK|AD|Anschlussstelle|Autobahnkreuz|Autobahndreieck)\s*(\d+[a-z]?)\b/i)?.[1]?.toLowerCase();
  const name=normalize(label.replace(/^(?:AS|AK|AD|Anschlussstelle|Autobahnkreuz|Autobahndreieck)\s*(?:\d+[a-z]?\s*)?/i,""));
  return {number,name};
}
function nameMatches(a,b){
  a=junction(a);b=junction(b);
  if(a.number&&b.number&&a.number!==b.number)return false;
  // Lohmar and Lohmar-Nord, Köln-West and Frechen etc. are not aliases.
  return a.name.length>=3&&a.name===b.name;
}
function metres(a,b){
  const dx=(a[1]-b[1])*111320*Math.cos((a[0]+b[0])*Math.PI/360);
  return Math.hypot(dx,(a[0]-b[0])*111320);
}
function key(y,x){return y+","+x;}
function notify(){for(const fn of listeners)try{fn();}catch(e){console.warn(e);}}
function install(data){
  if(data?.schema!==1||!Array.isArray(data.routes)||!data.routes.length)throw Error("Invalid signed detour dataset");
  dataset=data;grid.clear();wide.length=0;matching.clear();cache.clear();
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
      const [source]=endpointMotorways(r);
      for(const a of source?[source]:[]){
        // Spatially index both possible geometry orientations; route metadata
        // determines the direction, never the U-number parity.
        for(const point of r.directedGeometry?[p[0]]:[p[0],p.at(-1)]){
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
  if(!a||!b)return null;
  const k=[a,b,exit.id,entry.id,exit.name,entry.name,start.join(","),end.join(",")].join("|");
  if(cache.has(k))return cache.get(k);
  const candidates=new Set(),y=Math.floor(start[0]/CELL),x=Math.floor(start[1]/CELL);
  for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)
    for(const route of matching.get(a+":"+key(y+dy,x+dx))||[])candidates.add(route);
  let best=null,score=Infinity;
  for(const route of candidates){
    const [source,target]=endpointMotorways(route);
    if(source!==a||target!==b||!nameMatches(exit.name,route.from)||!nameMatches(entry.name,route.to))continue;
    const p=route.parts[0],first=p[0],last=p.at(-1);
    const f=[metres(start,first),metres(end,last)],r=[metres(start,last),metres(end,first)];
    const gaps=route.directedGeometry||f[0]+f[1]<=r[0]+r[1]?f:r;
    // Route and actual directed ramps must meet at the same junctions.
    // Do not silently connect incomplete routes or distant endpoints.
    if(Math.max(...gaps)>700||!Number.isFinite(route.lengthM)||route.lengthM<100)continue;
    const cost=gaps[0]+gaps[1];
    if(cost<score){best={route,lengthM:route.lengthM+cost};score=cost;}
  }
  // Multi-junction closures: link only same-motorway routes whose named
  // junction and actual endpoints agree; never infer direction from U parity.
  if(!best){
    const pending=[],visited=new Map();
    const enqueue=(route,at,length,chain)=>{
      const state=route.id+":"+at.join(",");
      if(length>250000||length>=(visited.get(state)??Infinity)||chain.length>12)return;
      visited.set(state,length);pending.push({route,at,length,chain});
    };
    for(const route of candidates){
      if(endpointMotorways(route)[0]!==a||!nameMatches(exit.name,route.from))continue;
      const p=route.parts[0],ends=[p[0],p.at(-1)];
      for(let i=0;i<(route.directedGeometry?1:2);i++){
        const gap=metres(start,ends[i]);if(gap>700)continue;
        enqueue(route,ends[1-i],route.lengthM+gap,[route]);
      }
    }
    const compass=v=>String(v||"").match(/\b(nord|süd|ost|west)(?:wärts|en)?\b/i)?.[1]?.toLowerCase();
    for(let work=0;pending.length&&work<400;work++){
      pending.sort((a,b)=>a.length-b.length);
      const item=pending.shift();
      if(item.length>=score)break;
      const gap=metres(item.at,end);
      if(endpointMotorways(item.route)[1]===b&&nameMatches(entry.name,item.route.to)&&gap<=700){
        best={route:item.chain[0],routes:item.chain,lengthM:item.length+gap};
        score=item.length+gap;continue;
      }
      const yy=Math.floor(item.at[0]/CELL),xx=Math.floor(item.at[1]/CELL);
      const nearby=new Set(),nextRef=endpointMotorways(item.route)[1];
      if(!nextRef)continue;
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)
        for(const r of matching.get(nextRef+":"+key(yy+dy,xx+dx))||[])nearby.add(r);
      for(const r of nearby){
        if(item.chain.includes(r)||!nameMatches(item.route.to,r.from))continue;
        const d1=compass(item.route.direction),d2=compass(r.direction);
        if(endpointMotorways(r)[0]!==nextRef)continue;
        if(d1&&d2&&d1!==d2&&endpointMotorways(item.route)[0]===nextRef&&endpointMotorways(r)[1]===nextRef)continue;
        const p=r.parts[0],ends=[p[0],p.at(-1)];
        for(let i=0;i<(r.directedGeometry?1:2);i++){
          const d=metres(item.at,ends[i]);if(d>50)continue;
          enqueue(r,ends[1-i],item.length+r.lengthM+d,[...item.chain,r]);
        }
      }
    }
  }
  if(cache.size>10000)cache.clear();cache.set(k,best);return best;
}

/* A capacity-constrained, directed route-level traffic model. Every relation
 * shares its service calendar across incidents and itinerary chains. No
 * synthetic street-level speeds or traffic-light positions are inferred. */
function createFlow(){
  const bookings=new Map();
  const capacity=route=>Math.max(100,Math.min(1200,Number(route.capacityVph)||600));
  function estimate(match,now){
    if(!match)return 0;
    let time=now;
    for(const route of match.routes||[match.route]){
      time=Math.max(time,bookings.get(route.id)||0)+route.lengthM/(40/3.6);
    }
    return Math.max(0,time-now-(match.routes||[match.route]).reduce((n,r)=>n+r.lengthM/(40/3.6),0));
  }
  function book(match,amount,now,freeSeconds){
    if(!match||!Number.isFinite(amount)||amount<=0)return null;
    const routes=match.routes||[match.route],stages=[];
    const free=routes.reduce((n,r)=>n+r.lengthM/(40/3.6),0);
    let at=now+Math.max(0,freeSeconds-free);
    for(const route of routes){
      const start=Math.max(at,bookings.get(route.id)||0);
      const depart=start+amount/capacity(route)*3600;
      const arrive=depart+route.lengthM/(40/3.6);
      bookings.set(route.id,depart);
      stages.push({id:route.id,enterAt:at,start,depart,arrive,capacityVph:capacity(route)});
      at=arrive;
    }
    return {stages,readyAt:at,signature:stages.map(s=>s.id+"@"+s.enterAt+"@"+s.depart+"@"+s.arrive).join("/")};
  }
  function snapshot(trips,now){
    const result=new Map();
    for(const trip of trips){
      const stages=trip.signed?.stages;
      if(!stages?.length||trip.vehicles<=0)continue;
      const stage=stages.find(s=>now<s.arrive)||stages.at(-1);
      const stats=result.get(stage.id)||{id:stage.id,waiting:0,moving:0,returnWaiting:0,vehicles:0,capacityVph:stage.capacityVph};
      stats.vehicles+=trip.vehicles;
      if(now<stage.depart){
        // Treat the unsent fraction of a fluid batch as waiting and the
        // released fraction as moving. At a later stage, only its own flow
        // is counted; one vehicle can never occupy two routes at once.
        const fraction=now<=stage.start?1:Math.max(0,(stage.depart-now)/Math.max(.000001,stage.depart-stage.start));
        stats.waiting+=trip.vehicles*fraction;
        stats.moving+=trip.vehicles*(1-fraction);
      }else if(now<stage.arrive)stats.moving+=trip.vehicles;
      else stats.returnWaiting+=trip.vehicles;
      result.set(stage.id,stats);
    }
    return [...result.values()].map(s=>({...s,delayMin:s.waiting*60/s.capacityVph}));
  }
  return {book,estimate,snapshot,reset:()=>bookings.clear()};
}
global.StauBedarfsumleitungen={install,visible,match,createFlow,get status(){return status;},get revision(){return revision;},
  get count(){return routes.length;},get dataset(){return dataset;},get coverage(){return dataset?.complete?"national-complete":dataset?.scope||"national-partial";},subscribe(fn){listeners.add(fn);return ()=>listeners.delete(fn);}};
const script=document.createElement("script");
script.async=true;
script.src="./data/bedarfsumleitungen-data.js";
script.onerror=()=>{status="unavailable";notify();};
document.head.append(script);
})(window);
