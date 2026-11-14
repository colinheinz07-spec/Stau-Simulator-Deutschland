/* 03_Stauphysik / local SPCK adapter.
 * A conservative directed cell-transmission prototype for the local OSM snapshot.
 * Same principles as src/03_Stauphysik/netzfluss.ts: finite receiving space,
 * sending capacity, wave spillback, real node transfers, and vehicle balance.
 * This is NOT the fully routed Germany-wide vehicle model.
 */
(function(global){
"use strict";
const R=6371000,rad=Math.PI/180;
const REST=/\b(?:rastst[aä]tte|rastplatz|rastanlage|autohof|p\s*\+?\s*wc|pwc|service\s*area|rest\s*area)\b/i;
const colourForSpeed=s=>s>65?"free":s>30?"slow":s>10?"jam":"standstill";
const coord=p=>p.map(n=>Number(n).toFixed(7)).join(",");
const lengthM=pts=>{
  let length=0;
  for(let i=1;i<pts.length;i++){
    const a=pts[i-1],b=pts[i],lat1=a[0]*rad,lat2=b[0]*rad;
    const dLat=(b[0]-a[0])*rad,dLon=(b[1]-a[1])*rad;
    const s=Math.sin(dLat/2)**2+Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLon/2)**2;
    length+=2*R*Math.asin(Math.min(1,Math.sqrt(s)));
  }
  return length;
};
const finite=n=>Number.isFinite(n)&&n>=0;
// The legacy OSM snapshot contains 48 A3/A48 mainline Ways with their
// coordinate arrays opposite to the through-carriageway direction. The map
// geometry looks continuous but a directed engine stops at every such pair.
// Normalize ONLY simple end-to-end motorway chains, seeded by their existing
// authentic exterior entrance. Never stitch geographically nearby Ways.
function orientExistingMotorwayChains(data){
  if(data._orientedMainlines)return data._orientationFlips||[];
  const flipIds=[];
  const groups=new Map();
  for(const row of data.roads){
    if(row[1]!=="mainline"||!row[2]||!Array.isArray(row[4])||row[4].length<2)
      continue;
    const list=groups.get(row[2])||[];
    list.push(row);groups.set(row[2],list);
  }
  for(const rows of groups.values()){
    if(rows.length<3)continue;
    const vertices=new Map(),byRoad=new Map(rows.map(row=>[row[0],row]));
    const key=p=>coord(p);
    for(const row of rows){
      for(const entry of [{node:row[4][0],start:true},
        {node:row[4].at(-1),start:false}]){
        const node=key(entry.node),list=vertices.get(node)||[];
        list.push({id:row[0],start:entry.start});
        vertices.set(node,list);
      }
    }
    if([...vertices.values()].some(list=>list.length>2))continue;
    const done=new Set();
    // A proper motorway carriageway has one external OSM start. Walk from
    // that real boundary and reverse only misplaced internal Way geometries.
    for(const [node,items] of vertices){
      if(items.length!==1||!items[0].start||done.has(items[0].id))continue;
      let at=node;const planned=[],locallyDone=new Set();
      for(let hops=0;hops<=rows.length;hops++){
        const next=(vertices.get(at)||[]).filter(x=>!done.has(x.id)&&
          !locallyDone.has(x.id));
        if(!next.length)break;
        if(next.length!==1){planned.length=0;break;}
        const entry=next[0],row=byRoad.get(entry.id);
        locallyDone.add(row[0]);
        const flip=!entry.start;
        planned.push({row,flip});
        at=key(flip?row[4][0]:row[4].at(-1));
      }
      // Do not apply a partial or ambiguous walk.
      if((vertices.get(at)||[]).length!==1)continue;
      for(const {row,flip} of planned){
        done.add(row[0]);
        if(flip){row[4].reverse();flipIds.push(row[0]);}
      }
    }
  }
  Object.defineProperty(data,"_orientedMainlines",{value:true,configurable:true});
  Object.defineProperty(data,"_orientationFlips",{value:flipIds,configurable:true});
  return flipIds;
}
function createLegacyTrafficScenario(data){
  if(!data||!Array.isArray(data.roads))throw Error("Geprüfte lokale Kartendaten fehlen");
  const reversedWays=orientExistingMotorwayChains(data);
  const edges=[],outByNode=new Map(),inByNode=new Map(),byId=new Map();
  const rowById=new Map(data.roads.map(row=>[String(row[0]),row]));
  const NO_EFFECTS=Object.freeze([]);
  const traffic=global.StauTrafficReference;
  if(!traffic)throw Error("traffic-reference.js fehlt vor offline-traffic.js");
  let excludedRest=0;
  for(const row of data.roads){
    if(!Array.isArray(row[4])||row[4].length<2)continue;
    if(row[1]==="ramp"&&REST.test(row[5]||"")){excludedRest++;continue;}
    const id=String(row[0]),lanes=Math.max(1,Math.min(6,Math.floor(Number(row[3])||1)));
    const meters=lengthM(row[4]);
    if(meters<0.2||byId.has(id))continue;
    const count=Math.max(1,Math.ceil(meters/230));
    const edge={
      id,kind:row[1],ref:row[2],name:row[5]||"",lanes,
       shoulderTag:row[7]||null,
      from:coord(row[4][0]),to:coord(row[4].at(-1)),
      first:row[4][0],lengthM:meters,
      n:count,cellLength:meters/count,
      stock:new Float64Array(count),
      // User-defined unrestricted motorway service, not a speed threshold.
       capacityPerLane:row[1]==="ramp"?1500:2200,
      freeKmh:row[1]==="ramp"?75:120,
      jamPerCell:130*lanes*(meters/count)/1000,
      next:[],incoming:0,incomingAtStart:0,mainlineIncomingAtStart:0,source:false,backlog:0,
      mode:"none",speed:row[1]==="ramp"?75:120,visualBands:[],
      links:[],linksFrom:Array.from({length:count},()=>[]),
      enteredVph:0,departedVph:0,
      referencePeakVph:0,directionKey:"",lastProfileMinute:-1,profileFactor:0
    };
    const index=edges.length;edge.index=index;edges.push(edge);byId.set(id,edge);
    if(!outByNode.has(edge.from))outByNode.set(edge.from,[]);
    outByNode.get(edge.from).push(index);
    if(!inByNode.has(edge.to))inByNode.set(edge.to,[]);
    inByNode.get(edge.to).push(index);
  }
  // Reuse exact OSM geometry vertices for junctions. A motorway_link often
  // joins a motorway in the MIDDLE of an OSM Way, not at its endpoint.
  // Never join two roads merely because they pass close to each other.
  const vertexMap=new Map(),pointMetres=new Map();
  for(const edge of edges){
    const source=rowById.get(edge.id);
    const vertices=source[4],cumulative=[0];
    for(let p=1;p<vertices.length;p++){
      const a=vertices[p-1],b=vertices[p];
      const lat1=a[0]*rad,lat2=b[0]*rad;
      const h=Math.sin((b[0]-a[0])*rad/2)**2+
        Math.cos(lat1)*Math.cos(b[0]*rad)*Math.sin((b[1]-a[1])*rad/2)**2;
      cumulative.push(cumulative.at(-1)+2*R*Math.asin(Math.min(1,Math.sqrt(h))));
    }
    pointMetres.set(edge.id,cumulative);
    for(let p=0;p<vertices.length;p++){
      const at=coord(vertices[p]),arr=vertexMap.get(at)||[];
      arr.push({edge:edge.index,metre:cumulative[p],
        first:p===0,last:p===vertices.length-1});
      vertexMap.set(at,arr);
    }
  }
  const linkKeys=new Set();
  function connect(from,to,fromM,toM){
    if(from.index===to.index)return;
    const fromCell=Math.max(0,Math.min(from.n-1,
      Math.floor(Math.max(0,fromM-1e-4)/from.cellLength)));
    const toCell=Math.max(0,Math.min(to.n-1,Math.floor(toM/to.cellLength)));
    const key=from.index+":"+fromCell+">"+to.index+":"+toCell;
    if(linkKeys.has(key))return;
    linkKeys.add(key);
    // Legacy app used roughly 5–12 % exits at ordinary junctions,
    // not the previous 25 % per exit. Interchanges may branch more.
    const weight=to.kind==="mainline"?20:1.5;
    const link={to:to.index,fromCell,toCell,fromM,toM,weight};
    from.links.push(link);from.linksFrom[fromCell].push(link);
    to.incoming++;
    if(toM<.01){
      to.incomingAtStart++;
      if(from.kind==="mainline"&&to.kind==="mainline"&&from.ref===to.ref)
        to.mainlineIncomingAtStart++;
    }
    // Preserve end-to-start successors for long-event tracing and old API.
    if(fromCell===from.n-1&&toCell===0&&fromM>=from.lengthM-.01&&toM<.01)
      from.next.push({to:to.index,weight});
  }
  for(const edge of edges){
    const positions=pointMetres.get(edge.id);
    const from=vertexMap.get(edge.from)||[];
    const last=vertexMap.get(edge.to)||[];
    // End of a ramp or mainline can join either a start point or a shared
    // interior OSM node of the downstream mainline.
    for(const dest of last){
      if(dest.edge===edge.index||dest.last)continue;
      const downstream=edges[dest.edge];
      if(dest.first||downstream.kind==="mainline")
        connect(edge,downstream,edge.lengthM,dest.metre);
    }
    // Off-ramp starts can attach to an interior vertex of the upstream Way.
    const source=rowById.get(edge.id);
    for(let j=1;j<source[4].length-1;j++){
      const at=coord(source[4][j]),metre=positions[j];
      for(const dest of vertexMap.get(at)||[]){
        if(dest.edge===edge.index||!dest.first)continue;
        const downstream=edges[dest.edge];
        if(downstream.kind==="ramp"||edge.kind==="mainline")
          connect(edge,downstream,metre,0);
      }
    }
  }
  // Source provenance matters: an orphaned OSM ramp Way is NOT a
  // residential on-ramp. Select a single upstream boundary per directional
  // motorway corridor, and only distinctly named on-ramp heads for AS traffic.
  // Adapted from the old directional A3/A48/NRW demand reference catalog.
  // Boundary safety: a synthetic one-Way corridor ending at a truncated
  // interchange cannot receive an entire motorway's original peak demand.
  // Until real OSM continuation is present, leave its traffic unmodelled
  // instead of manufacturing a capacity bottleneck at the map edge.
  const provenMainline=new Map();
  function hasContinuousMainline(edge){
    if(provenMainline.has(edge.id))return provenMainline.get(edge.id);
    const seen=new Set(),stack=[edge],ref=edge.ref;let metres=0,n=0;
    while(stack.length&&seen.size<10000){
      const current=stack.pop();
      if(seen.has(current.id))continue;
      seen.add(current.id);metres+=current.lengthM;n++;
      for(const link of current.links){
        const down=edges[link.to];
        if(down.kind==="mainline"&&down.ref===ref&&!seen.has(down.id))
          stack.push(down);
      }
    }
    const result=n>=2&&metres>=1500;
    provenMainline.set(edge.id,result);return result;
  }
  const rankedMainline=new Map();
  function upstreamRank(edge,key){
    const [lat,lon]=edge.first;
    if(key==="A3-koeln")return -lat;
    if(key==="A3-frankfurt")return lat;
    if(key==="A48-dernbach")return -lon;
    if(key==="A48-koblenz")return lon;
    if(/a4-olpe|a560-hennef|a562-bonn-ost/.test(key))return -lon;
    if(/a4-aachen|a560-bonn|a562-bonn$/.test(key))return lon;
    if(/a59-koeln|a555-koeln|a1-dortmund|a559-gremberg/.test(key))return -lat;
    if(/a59-bonn|a555-bonn|a1-koblenz|a559-porz/.test(key))return lat;
    return Math.abs(lat)>=Math.abs(lon)?-lat:-lon;
  }
  for(const edge of edges){
    if(edge.kind!=="mainline"||!edge.ref||edge.mainlineIncomingAtStart)continue;
    const row=rowById.get(edge.id),profile=traffic.referenceForRoad(row);
    if(profile.peakVph<=0||!hasContinuousMainline(edge))continue;
    const rank=upstreamRank(edge,profile.key);
    const old=rankedMainline.get(profile.key);
    if(!old||rank>old.rank+1e-8||
      Math.abs(rank-old.rank)<=1e-8&&edge.lengthM>old.edge.lengthM)
      rankedMainline.set(profile.key,{edge,profile,rank});
  }
  const sources=[];
  for(const {edge,profile} of rankedMainline.values()){
    edge.source=true;edge.referencePeakVph=profile.peakVph;
    edge.directionKey=profile.key;sources.push(edge);
  }
  const distinctOnramps=new Map();
  for(const edge of edges){
    if(edge.kind!=="ramp"||edge.incomingAtStart||!edge.links.length)continue;
    if(!/\b(?:auffahrt|zufahrt)\b/i.test(edge.name)||/rampenzweig/i.test(edge.name))
      continue;
    const row=rowById.get(edge.id),profile=traffic.referenceForRoad(row);
    const peak=traffic.junctionEntryPeak(row);
    if(peak<=0||!edge.links.some(link=>
      edges[link.to].kind==="mainline"&&
      hasContinuousMainline(edges[link.to])))continue;
    // Repeated copies/fragments for the same signed AS→direction must never
    // create repeated independent 500 Kfz/h traffic generators.
    const label=edge.name.replace(/\s+/g," ").trim().toLowerCase();
    const old=distinctOnramps.get(label);
    if(!old||edge.lengthM>old.edge.lengthM)
      distinctOnramps.set(label,{edge,profile,peak});
  }
  for(const {edge,profile,peak} of distinctOnramps.values()){
    edge.source=true;edge.referencePeakVph=peak;
    edge.directionKey=profile.key;sources.push(edge);
  }
  const reachable=new Set(sources.map(edge=>edge.id));
  const frontier=[...sources];
  for(let k=0;k<frontier.length;k++){
    for(const link of frontier[k].links){
      const downstream=edges[link.to];
      if(reachable.has(downstream.id))continue;
      reachable.add(downstream.id);frontier.push(downstream);
    }
  }
  // Preallocate the physical cell working buffers to minimize iPhone GC pauses.
  const send=edges.map(edge=>new Float64Array(edge.n));
  const receive=edges.map(edge=>new Float64Array(edge.n));
  const delta=edges.map(edge=>new Float64Array(edge.n));
  const enteredStep=new Float64Array(edges.length);
  const departedStep=new Float64Array(edges.length);
  const eventRecords=new Map();
  let activeEffects=new Map(),effectsStamp=null,simStart=Date.now();
  let elapsed=0,generated=0,exited=0,demandPercent=100,initialVehicles=0;
  let warmedUp=false;
  let jamGroups=[];
  function totals(){
    let inside=0,backlog=0;
    for(const edge of edges){
      for(const n of edge.stock)inside+=n;
      backlog+=edge.backlog;
    }
    const residual=initialVehicles+generated-exited-inside-backlog;
    return {simSeconds:elapsed,initialVehicles,
      generatedVehicles:generated,exitedVehicles:exited,
      vehiclesOnNetwork:inside,waitingOutsideSources:backlog,
      conservationResidual:Math.abs(residual)<1e-7?0:residual,
      sources:sources.length,edges:edges.length,excludedRest};
  }
  function clockMs(){return simStart+elapsed*1000;}
  function listEvents(){
    return [...eventRecords.values()].map(record=>({...record.spec,
      coveredLengthM:record.coveredLengthM,truncated:record.truncated}));
  }
  function trace(edge,offset,requestedM){
    let current=edge,position=offset,remaining=requestedM,covered=0,spans=[];
    const visited=new Set();
    for(let hops=0;hops<2000&&remaining>.01;hops++){
      if(visited.has(current.id))break;
      visited.add(current.id);
      const take=Math.min(remaining,Math.max(0,current.lengthM-position));
      if(take>.001){
        spans.push({edgeId:current.id,fromM:position,toM:position+take,gate:spans.length===0});
        covered+=take;remaining-=take;
      }
      if(remaining<=.01)break;
      const candidates=current.next.map(x=>edges[x.to]).filter(x=>
        x.ref===edge.ref&&x.kind===edge.kind&&!visited.has(x.id));
      // Never guess which fork to follow or invent a missing ramp connection.
      if(candidates.length!==1)break;
      current=candidates[0];position=0;
    }
    return {spans,coveredLengthM:covered,truncated:remaining>.01};
  }
  // Two REAL junction boundaries on the same directed carriageway define
  // a motorway full closure, not the mouse position or a 200 m OSM Way.
  // The chain uses original vertex-connected mainline links only.
  const mainlineBack=new Map();
  const landmarkCache=new Map();
  for(const upstream of edges){
    if(upstream.kind!=="mainline")continue;
    for(const turn of upstream.links){
      const downstream=edges[turn.to];
      if(downstream.kind!=="mainline"||downstream.ref!==upstream.ref||
        turn.fromCell!==upstream.n-1||turn.toCell!==0)continue;
      const back=mainlineBack.get(downstream.id)||[];
      if(!back.includes(upstream))back.push(upstream);
      mainlineBack.set(downstream.id,back);
    }
  }
  const mainlineNext=new Map();
  for(const upstream of edges){
    if(upstream.kind!=="mainline")continue;
    mainlineNext.set(upstream.id,[...new Set(upstream.links
      .filter(turn=>turn.fromCell===upstream.n-1&&turn.toCell===0)
      .map(turn=>edges[turn.to])
      .filter(next=>next.kind==="mainline"&&next.ref===upstream.ref))]);
  }
  function junctionsOn(edge){
    if(landmarkCache.has(edge.id))return landmarkCache.get(edge.id);
    const points=rowById.get(edge.id)[4],metres=pointMetres.get(edge.id);
    const found=[];
    if(edge.ref&&edge.kind==="mainline")for(const junction of data.junctions||[]){
      if(junction[0]!==edge.ref||!Array.isArray(junction[3]))continue;
      const p=junction[3],cos=Math.cos(p[0]*rad)*R*rad,lat=R*rad;
      let best=Infinity,offset=0;
      for(let i=1;i<points.length;i++){
        const a=points[i-1],b=points[i];
        const x=(b[1]-a[1])*cos,y=(b[0]-a[0])*lat;
        const qx=(p[1]-a[1])*cos,qy=(p[0]-a[0])*lat;
        const alpha=Math.max(0,Math.min(1,
          (x*qx+y*qy)/Math.max(.001,x*x+y*y)));
        const error=Math.hypot(qx-alpha*x,qy-alpha*y);
        if(error<best){
          best=error;offset=metres[i-1]+alpha*(metres[i]-metres[i-1]);
        }
      }
      if(best<=250)found.push({offset,junction,best});
    }
    landmarkCache.set(edge.id,found);
    return found;
  }
  function motorwayCorridor(edge,clickedM){
    if(edge.kind!=="mainline"||!edge.ref||!(data.junctions||[]).length)
      return null;
    // Extend only through a uniquely connected directed motorway path.
    const chain=[edge],seen=new Set([edge.id]);
    for(let i=0;i<500;i++){
      const first=chain[0],previous=(mainlineBack.get(first.id)||[])
        .filter(x=>!seen.has(x.id));
      if(previous.length!==1)break;
      const candidate=previous[0];
      chain.unshift(candidate);seen.add(candidate.id);
      if(chain.reduce((s,e)=>s+e.lengthM,0)>75000)break;
    }
    for(let i=0;i<500;i++){
      const last=chain.at(-1),forward=(mainlineNext.get(last.id)||[])
        .filter(x=>!seen.has(x.id));
      if(forward.length!==1)break;
      const candidate=forward[0];
      chain.push(candidate);seen.add(candidate.id);
      if(chain.reduce((s,e)=>s+e.lengthM,0)>75000)break;
    }
    let advance=0,point=-1;
    const marks=[],starts=new Map();
    for(const road of chain){
      starts.set(road.id,advance);
      if(road.id===edge.id)point=advance+clickedM;
      for(const hit of junctionsOn(road))
        marks.push({...hit,position:advance+hit.offset});
      advance+=road.lengthM;
    }
    if(point<0||marks.length<2)return null;
    // The clicked road lies BETWEEN two successive AS/AK; preserve actual
    // kilometrage of the direction including all OSM Way splits.
    const before=marks.filter(m=>m.position<=point+.001)
      .sort((a,b)=>b.position-a.position)[0];
    // A tap just BEFORE a real junction node is still a tap on that
    // junction: snap to it instead of claiming the whole previous corridor.
    const nearStart=marks.filter(m=>m.position>point&&
      m.position-point<=140).sort((a,b)=>a.position-b.position)[0];
    const left=nearStart||before;
    const right=marks.filter(m=>m.position>left.position+1)
      .sort((a,b)=>a.position-b.position)[0];
    if(!left||!right||left.junction[1]===right.junction[1]||
      right.position-left.position<100)return null;
    const spans=[];
    for(const road of chain){
      const begin=starts.get(road.id),end=begin+road.lengthM;
      const fromM=Math.max(0,left.position-begin);
      const toM=Math.min(road.lengthM,right.position-begin);
      if(toM>fromM+.05&&end>=left.position&&begin<=right.position)
        spans.push({edgeId:road.id,fromM,toM,gate:spans.length===0});
    }
    if(!spans.length)return null;
    return {spans,coveredLengthM:spans.reduce((n,s)=>n+s.toM-s.fromM,0),
      truncated:false,from:left.junction,to:right.junction,
      fromLabel:left.junction[0]+" "+left.junction[1]+" "+left.junction[2],
      toLabel:right.junction[0]+" "+right.junction[1]+" "+right.junction[2]};
  }
  function recommendedClosureLength(id,offsetM=0){
    const road=byId.get(id),corridor=road&&motorwayCorridor(road,offsetM);
    return corridor?{lengthM:Math.round(corridor.coveredLengthM),
      label:corridor.fromLabel+" – "+corridor.toLabel,
      fromRealJunction:true}:null;
  }
  function checkedEvent(raw){
    if(!raw||typeof raw!=="object")throw Error("Ereignisdaten fehlen");
    const edge=byId.get(raw.edgeId),kind=raw.kind;
    if(!edge)throw Error("Unbekannter OSM-Fahrweg");
    if(!["roadworks","accident","breakdown","closure"].includes(kind))
      throw Error("Ungültiger Ereignistyp");
    const id=String(raw.id||"");
    if(!id||id.length>100||!/^[a-zA-Z0-9_-]+$/.test(id))
      throw Error("Ungültige Ereignis-ID");
    const closedLanes=raw.closedLanes;
    if(!Array.isArray(closedLanes)||new Set(closedLanes).size!==closedLanes.length||
      !closedLanes.every(n=>Number.isInteger(n)&&n>=0&&n<edge.lanes))
      throw Error("Ungültige Fahrstreifen-Auswahl");
    const shoulder=raw.shoulder||"normal",hasShoulder=raw.hasShoulder===true;
    if(!["normal","blocked","open"].includes(shoulder))
      throw Error("Ungültige Seitenstreifen-Einstellung");
    if(shoulder==="open"&&(!hasShoulder||edge.kind==="ramp"||edge.shoulderTag==="no"))
      throw Error("Standstreifen-Freigabe nur nach bestätigter Verfügbarkeit auf Hauptfahrbahn");
    if(kind==="closure"&&
      (closedLanes.length!==edge.lanes||shoulder==="open"))
      throw Error("Vollsperrung muss sämtliche vorhandenen Fahrstreifen schließen");
    const max=kind==="accident"||kind==="breakdown"?200:
      kind==="roadworks"?20000:100000;
    const length=Number(raw.lengthM),offset=Number(raw.offsetM??0);
    if(!Number.isInteger(length)||length<1||length>max)
      throw Error("Ereignislänge muss zwischen 1 und "+max+" Metern liegen");
    if(!Number.isFinite(offset)||offset<0||offset>=edge.lengthM)
      throw Error("Ereignisposition liegt außerhalb des OSM-Fahrwegs");
    const open=edge.lanes-closedLanes.length+Number(shoulder==="open");
    const speed=Number(raw.speedKmh);
    if(!Number.isInteger(speed)||speed<0||speed>130||speed%10!==0||
      (kind==="closure"&&speed!==0)||(!open&&speed!==0)||
      (kind!=="closure"&&open>0&&speed===0))
      throw Error("Geschwindigkeit passt nicht zur gewählten Verkehrsführung");
    const schedule=raw.schedule??null;
    if(schedule&&typeof global.StauEventSchedule?.validate!=="function")
      throw Error("Kalender-Modul fehlt");
    if(schedule&&!global.StauEventSchedule.validate(schedule))
      throw Error("Ungültiger Zeitplan oder Wiederholung");
    if(schedule?.mode==="repeat"&&!["roadworks","closure"].includes(kind))
      throw Error("Wiederkehrende Termine nur für Baustellen und Vollsperrungen");
    const spec={id,edgeId:edge.id,kind,closedLanes:[...closedLanes].sort((a,b)=>a-b),
      shoulder,hasShoulder,lengthM:length,offsetM:offset,speedKmh:speed,
      schedule: schedule?structuredCloneSchedule(schedule):null};
    // In the real road snapshot a motorway closure ALWAYS covers the exact
    // directed carriageway between the surrounding junctions. Ignore stale
    // 200 m saved events and hand-entered fragment lengths.
    const physical=kind==="closure"&&edge.kind==="mainline"?
      motorwayCorridor(edge,offset):null;
    if(kind==="closure"&&edge.kind==="mainline"&&
      (data.junctions||[]).some(j=>j[0]===edge.ref)&&!physical)
      throw Error("Vollsperrung nicht gesetzt: Zwei verbundene Anschlussstellen "+
        "in dieser Fahrtrichtung konnten nicht sicher ermittelt werden.");
    const traceResult=physical||trace(edge,offset,length);
    if(physical){
      const first=physical.spans[0],newStart=byId.get(first.edgeId);
      spec.edgeId=newStart.id;spec.offsetM=first.fromM;
      spec.lengthM=Math.max(1,Math.round(physical.coveredLengthM));
      spec.closureFrom=physical.fromLabel;spec.closureTo=physical.toLabel;
    }
    if(shoulder==="open"&&traceResult.spans.some(span=>
      byId.get(span.edgeId)?.shoulderTag==="no"))
      throw Error("Mindestens ein betroffener OSM-Abschnitt hat keinen Seitenstreifen");
    return {...spec,...traceResult,spec};
  }
  function structuredCloneSchedule(s){return JSON.parse(JSON.stringify(s));}
  function setEvent(spec){
    if(eventRecords.size>=150&&!eventRecords.has(spec?.id))
      throw Error("Maximal 150 Ereignisse im mobilen Prototyp");
    const valid=checkedEvent(spec);
    eventRecords.set(valid.spec.id,valid);effectsStamp=null;
    updateEffects();
    recomputeSpeeds();
    return {...valid.spec,coveredLengthM:valid.coveredLengthM,
      truncated:valid.truncated};
  }
  function removeEvent(id){
    const removed=eventRecords.delete(id);effectsStamp=null;
    updateEffects();recomputeSpeeds();return removed;
  }
  function updateEffects(){
    const time=clockMs();
    // One set per 5-second step. Changing the event catalog invalidates it.
    if(effectsStamp===time)return;
    effectsStamp=time;
    const byEdge=new Map();
    for(const record of eventRecords.values()){
      if(record.spec.schedule&&!global.StauEventSchedule.active(record.spec.schedule,time))
        continue;
      for(const span of record.spans){
        const list=byEdge.get(span.edgeId)||[];
        list.push({...span,event:record.spec});
        byEdge.set(span.edgeId,list);
      }
    }
    // A directed ramp that can ONLY feed a closed carriageway/closed ramp
    // must share the same closure. Do not close upstream exit ramps when their
    // destination remains legal, and do not flood a whole interchange.
    const roadClosures=[...eventRecords.values()].filter(record=>
      record.spec.kind==="closure"&&
      (!record.spec.schedule||
        global.StauEventSchedule.active(record.spec.schedule,time)));
    for(const record of roadClosures){
      const closed=new Set(),spansById=new Map();
      for(const span of record.spans){
        const arr=spansById.get(span.edgeId)||[];
        arr.push(span);spansById.set(span.edgeId,arr);
      }
      function leadsIntoClosed(link){
        const target=edges[link.to];
        if(closed.has(target.id))return true;
        // Only the actual physical closure interval counts. A closure
        // between A59 AS31 and AS32 must NEVER close AS35 at Wahn merely
        // because both touch the same 26 km OSM Way.
        return (spansById.get(target.id)||[]).some(span=>
          link.toM>=span.fromM-140&&link.toM<span.toM-.5);
      }
      // Repeated fixed-point resolution covers ramp->ramp->mainline chains,
      // independent of OSM Way fragments.
      const ramps=new Set();
      let changed=true,iterations=0;
      while(changed&&iterations++<edges.length){
        changed=false;
        for(const edge of edges){
          if(edge.kind!=="ramp"||closed.has(edge.id)||!edge.links.length)continue;
          if(edge.links.every(leadsIntoClosed)){
            closed.add(edge.id);ramps.add(edge.id);changed=true;
          }
        }
      }
      for(const id of ramps){
        const edge=byId.get(id);
        const list=byEdge.get(id)||[];
        // Closing the entrance does not delete vehicles already on a ramp.
        list.push({edgeId:id,fromM:0,toM:edge.lengthM,gate:true,
          derivedRampClosure:true,event:record.spec});
        byEdge.set(id,list);
      }
    }
    activeEffects=byEdge;
  }
  function eventsOn(id){updateEffects();return activeEffects.get(id)||[];}
  function mode(id){
    const effects=eventsOn(id);
    if(effects.some(x=>x.event.kind==="closure"))return "closure";
    return effects.at(-1)?.event.kind||"none";
  }
  function activeEvents(){
    updateEffects();
    return [...eventRecords.values()].filter(x=>
      !x.spec.schedule||global.StauEventSchedule.active(x.spec.schedule,clockMs()))
      .map(x=>({...x.spec,coveredLengthM:x.coveredLengthM,truncated:x.truncated}));
  }
  function eventStatus(id){
    const record=eventRecords.get(id);
    if(!record)return "missing";
    if(activeEvents().some(e=>e.id===id))return "active";
    const s=record.spec.schedule,now=clockMs();
    if(s?.mode==="once")return now<s.startAt?"planned":"finished";
    if(s?.mode==="repeat"){
      const end=global.StauEventSchedule.localInstant(s.lastDate,
        s.endTime<s.startTime?s.endTime:s.endTime,true);
      return global.StauEventSchedule.localDate(now)<s.firstDate?"planned":
        global.StauEventSchedule.localDate(now)>s.lastDate&&now>end?"finished":"between";
    }
    return "inactive";
  }
  function setSimulationStart(value){
    const ms=Number(value);
    if(!Number.isFinite(ms)||ms<0)throw Error("Ungültiger Simulationsbeginn");
    simStart=ms;
    return reset(false);
  }
  // Jam diagnostics use ONLY the density of actual model vehicles. A 20 km/h
  // roadworks limit alone must never turn an empty road red.
  function recomputeSpeeds(){
    updateEffects();
    for(const edge of edges){
      const effectList=activeEffects.get(edge.id)||NO_EFFECTS;
      let minSpeed=edge.freeKmh;
      const bands=[];
      for(let k=0;k<edge.n;k++){
        const a=k*edge.cellLength,b=(k+1)*edge.cellLength;
        const fraction=Math.min(1,edge.stock[k]/Math.max(.001,edge.jamPerCell));
        const densitySpeed=edge.freeKmh*
          (fraction<=.23?1:Math.max(.04,1-Math.pow((fraction-.23)/.77,1.45)));
        let speed=densitySpeed;
        for(const effect of effectList){
          if(effect.fromM>=b-.001||effect.toM<=a+.001)continue;
          if(effect.event.speedKmh>0)
            speed=Math.min(speed,effect.event.speedKmh);
        }
        // No vehicle = no measured travel speed. Capacity restrictions and
        // closures remain separately visible as event/closure overlays.
        if(edge.stock[k]>=1)minSpeed=Math.min(minSpeed,speed);
        const congested=edge.stock[k]>=Math.max(2,edge.lanes*1.2)&&fraction>.23;
        const color=congested?colourForSpeed(densitySpeed):"free";
        if(color!=="free"){
          const previous=bands.at(-1);
          if(previous&&previous.color===color&&Math.abs(previous.toM-a)<.001){
            previous.toM=b;
            previous.speedKmh=Math.min(previous.speedKmh,densitySpeed);
          }else bands.push({fromM:a,toM:b,color,speedKmh:densitySpeed});
        }
      }
      edge.speed=minSpeed;
      edge.visualBands=bands;
    }
    jamGroups=calculateJamGroups();
  }
  // Adjacent congestion cells are one queue, even when OSM splits them into
  // dozens of Ways. Never join across a branch or a disconnected geometry.
  function calculateJamGroups(){
    const pieces=[],perEdge=new Map();
    for(const edge of edges){
      const local=[];
      for(const band of edge.visualBands){
        const m=band.toM-band.fromM;
        const delay=Math.max(0,(m/1000)*60*
          (1/Math.max(5,band.speedKmh)-1/edge.freeKmh));
        const last=local.at(-1);
        if(last&&Math.abs(last.toM-band.fromM)<.02){
          last.toM=band.toM;last.delayMin+=delay;
          last.worstKmh=Math.min(last.worstKmh,band.speedKmh);
        }else{
          const item={index:pieces.length,edgeId:edge.id,fromM:band.fromM,
            toM:band.toM,delayMin:delay,worstKmh:band.speedKmh};
          pieces.push(item);local.push(item);
        }
      }
      if(local.length)perEdge.set(edge.id,local);
    }
    const roots=pieces.map((_,i)=>i);
    const root=i=>{while(roots[i]!==i){roots[i]=roots[roots[i]];i=roots[i];}return i;};
    for(const edge of edges){
      // Off-ramps are forks but do NOT split a continuous motorway jam.
      // Combine only the unique same-road/same-direction continuation.
      const candidates=edge.next.filter(link=>{
        const dest=edges[link.to];
        return dest.kind===edge.kind&&
          dest.ref===edge.ref;
      });
      if(candidates.length!==1)continue;
      const target=edges[candidates[0].to];
      const a=perEdge.get(edge.id)?.at(-1);
      const b=perEdge.get(target.id)?.[0];
      if(!a||!b||a.toM<edge.lengthM-.02||b.fromM>.02)continue;
      const ra=root(a.index),rb=root(b.index);
      if(ra!==rb)roots[rb]=ra;
    }
    const groups=new Map();
    for(const piece of pieces){
      const key=root(piece.index);
      let g=groups.get(key);
      if(!g){
        g={lengthM:0,delayMin:0,worstKmh:Infinity,
          edgeId:piece.edgeId,offsetM:(piece.fromM+piece.toM)/2,
          longestM:0};
        groups.set(key,g);
      }
      const len=piece.toM-piece.fromM;
      g.lengthM+=len;g.delayMin+=piece.delayMin;
      g.worstKmh=Math.min(g.worstKmh,piece.worstKmh);
      if(len>g.longestM){
        g.longestM=len;g.edgeId=piece.edgeId;
        g.offsetM=(piece.fromM+piece.toM)/2;
      }
    }
    return [...groups.values()].filter(g=>g.lengthM>=350&&g.delayMin>=.5)
      .sort((a,b)=>b.delayMin-a.delayMin)
      .map(({longestM,...g})=>g);
  }
  function visualBands(id){return byId.get(id)?.visualBands||[];}
  function closureBands(id){
    const effects=eventsOn(id);
    return effects.filter(x=>x.event.kind==="closure"||
      x.event.closedLanes.length===byId.get(id)?.lanes&&
      x.event.shoulder!=="open").map(x=>({fromM:x.fromM,toM:x.toM}));
  }
  function reset(clearEvents=false){
    elapsed=0;generated=0;exited=0;initialVehicles=0;warmedUp=false;
    for(const edge of edges){
      edge.stock.fill(0);edge.backlog=0;edge.speed=edge.freeKmh;
      edge.lastProfileMinute=-1;edge.profileFactor=0;
      edge.enteredVph=0;edge.departedVph=0;
    }
    if(clearEvents)eventRecords.clear();
    effectsStamp=null;updateEffects();recomputeSpeeds();
    return totals();
  }
  // Legacy traffic-cells.initialiseCells() began at a realistic
  // pre-existing motorway inventory. Starting every Way empty causes a crash
  // at Montabaur to have no arrivals until cars travel there from Cologne.
  // One-time initial conditions are counted in mass balance, never repeated
  // injections at arbitrary OSM fragments during simulation.
  function warmStart(){
    if(warmedUp||elapsed>0)return totals();
    warmedUp=true;
    if(!demandPercent)return totals();
    for(const edge of edges){
      if(edge.kind!=="mainline"||!edge.ref)continue;
      const row=rowById.get(edge.id),profile=traffic.referenceForRoad(row);
      if(profile.peakVph<=0)continue;
      const desired=profile.peakVph*(demandPercent/100)*
        traffic.profileFactor(profile.key,edge.ref,clockMs(),row[4]);
      // A normal free-flow density is vehicles/hour divided by km/hour.
      // CTM jam occupancy (130 vehicles/km per lane) is not a demand source.
      const service=edge.capacityPerLane*edge.lanes;
      const vehiclesPerKm=Math.min(desired,service*.92)/edge.freeKmh;
      const perCell=Math.min(edge.jamPerCell*.22,
        vehiclesPerKm*edge.cellLength/1000);
      for(let k=0;k<edge.n;k++){
        edge.stock[k]=perCell;
        initialVehicles+=perCell;
      }
    }
    recomputeSpeeds();
    return totals();
  }
  // Backward compatibility for the prior one-click prototype and its tests.
  function setMode(id,modeValue){
    const edge=byId.get(id);
    if(!edge)throw Error("Unbekannter OSM-Abschnitt: "+id);
    if(!["none","roadworks","accident","closure"].includes(modeValue))
      throw Error("Ungültiger Ereignistyp");
    const eventId="legacy-"+id.replace(/[^a-zA-Z0-9_-]/g,"_");
    if(modeValue==="none"){removeEvent(eventId);return;}
    const lanes=modeValue==="closure"?Array.from({length:edge.lanes},(_,i)=>i):
      Array.from({length:Math.min(edge.lanes,modeValue==="accident"?2:1)},(_,i)=>i);
    const open=edge.lanes-lanes.length;
    return setEvent({id:eventId,edgeId:id,kind:modeValue,closedLanes:lanes,
      shoulder:"normal",hasShoulder:false,offsetM:0,
      lengthM:Math.max(1,Math.round(edge.lengthM)),
      speedKmh:modeValue==="closure"||!open?0:open===1?40:60,schedule:null});
  }
  function setDemandPercent(pct){
    if(!finite(Number(pct))||Number(pct)>200)throw Error("Verkehrslast muss 0–200 % sein");
    demandPercent=Number(pct);
  }
  // Exact weekday/friday/weekend curves and directional 1-hour peak inputs
  // ported from the old Traffic-Sinulator, shared with the full-map adapter.
  function sourceFactor(edge,time){
    const minute=Math.floor(time/60000);
    if(edge.lastProfileMinute!==minute){
      edge.profileFactor=traffic.profileFactor(edge.directionKey,edge.ref,time,
        rowById.get(edge.id)[4]);
      edge.lastProfileMinute=minute;
    }
    return edge.profileFactor;
  }
  function closureDistanceAhead(edge,offsetM,maxDistance=12000){
    let current=edge,from=Math.max(0,offsetM),travelled=0;
    const visited=new Set();
    for(let hops=0;hops<80&&travelled<=maxDistance;hops++){
      if(visited.has(current.id))return Infinity;
      visited.add(current.id);
      const effects=activeEffects.get(current.id)||NO_EFFECTS;
      for(const item of effects){
        if(item.event.kind!=="closure"||item.fromM<from-.01)continue;
        const distance=travelled+item.fromM-from;
        if(distance<=maxDistance)return distance;
      }
      const next=current.next.filter(link=>{
        const target=edges[link.to];
        return target.kind==="mainline"&&target.ref===edge.ref;
      });
      if(next.length!==1)return Infinity;
      travelled+=current.lengthM-from;
      current=edges[next[0].to];from=0;
    }
    return Infinity;
  }
  function blockedMovement(from,link){
    updateEffects();
    const target=edges[link.to];
    if(!target)return false;
    const toEffects=activeEffects.get(target.id)||NO_EFFECTS;
    if(!toEffects.length)return false;
    const upstream=activeEffects.get(from.id)||NO_EFFECTS;
    return toEffects.some(item=>{
      const buffer=item.event.kind==="closure"?140:0;
      if(link.toM<item.fromM-buffer||link.toM>=item.toM-.05)return false;
      if(item.event.kind!=="closure"&&
        (item.event.closedLanes.length!==target.lanes||
        item.event.shoulder==="open"))return false;
      return !upstream.some(inside=>inside.event.id===item.event.id);
    });
  }
  function step(dt=5,refreshSpeeds=true){
    if(!finite(dt)||dt<=0||dt>15)throw Error("Ungültiger Simulationstakt");
    updateEffects();
    const anyClosureActive=[...activeEffects.values()].some(items=>
      items.some(item=>item.event.kind==="closure"));
    enteredStep.fill(0);departedStep.fill(0);
    for(let j=0;j<edges.length;j++){
      const edge=edges[j],n=edge.n,stock=edge.stock;
      const s=send[j],r=receive[j],d=delta[j];
      d.fill(0);
      // w=32 km/h keeps the receiving branch consistent with 2200 Kfz/h/lane:
      // 22 km/h would cap free-flow receiving below the user-defined capacity.
      const wave=Math.min(1,(22/3.6)*dt/edge.cellLength);
      const effects=activeEffects.get(edge.id)||NO_EFFECTS;
      for(let k=0;k<n;k++){
        const a=k*edge.cellLength,b=(k+1)*edge.cellLength;
        const local=effects.length?
          effects.filter(e=>e.fromM<b-.001&&e.toM>a+.001):NO_EFFECTS;
        const closed=new Set();
        let shoulderOpen=false,shoulderBlocked=false,blockedAtGate=false;
        let permitted=edge.freeKmh;
        for(const item of local){
          const ev=item.event;
          for(const lane of ev.closedLanes)closed.add(lane);
          if(ev.shoulder==="open"&&ev.hasShoulder)shoulderOpen=true;
          if(ev.shoulder==="blocked")shoulderBlocked=true;
          if(ev.speedKmh>0)permitted=Math.min(permitted,ev.speedKmh);
          if((ev.kind==="closure"||ev.closedLanes.length===edge.lanes&&
            ev.shoulder!=="open")&&item.gate&&item.fromM>=a-.001&&item.fromM<b+.001)
            blockedAtGate=true;
        }
        if(shoulderBlocked)shoulderOpen=false;
        const open=Math.max(0,edge.lanes-closed.size+Number(shoulderOpen));
        // Copy the legacy simulator's principle: a lane drop has a lower
        // discharge than an unrestricted lane. Merging/braking consumes service
        // headway; the signed speed limit alone is not the congestion color.
        // Conservative prototype coefficients, subject to later calibration.
        let restriction=1;
        if(closed.size>0&&open>0){
          const accident=local.some(item=>item.event.kind==="accident");
          const breakdown=local.some(item=>item.event.kind==="breakdown");
          const roadworks=local.some(item=>item.event.kind==="roadworks");
          restriction=accident?(open===1?.69:.79):
            breakdown?(open===1?.78:.87):
            roadworks?(open===1?.80:.90):1;
        }
        const cap=open*edge.capacityPerLane*restriction*dt/3600;
        const moving=Math.min(1,(permitted/3.6)*dt/edge.cellLength);
        // Block receiving at the first closure cell, but let already-present
        // vehicles discharge through the closed section's downstream cells.
        const evacuated=local.some(x=>x.event.kind==="closure"||
          x.event.closedLanes.length===edge.lanes&&x.event.shoulder!=="open");
        // Vehicles already behind a closure's entrance gate may exit the
        // restricted area. Gate receiving is zero; interior flow can drain.
        const transferCapacity=evacuated?
          edge.lanes*edge.capacityPerLane*dt/3600:cap;
        s[k]=Math.min(stock[k],transferCapacity,stock[k]*moving);
        const room=Math.max(0,edge.jamPerCell-stock[k]);
        r[k]=blockedAtGate?0:Math.min(room,transferCapacity,room*wave);
      }
    }
    // One simultaneous allocation for every motorway cell face and OSM
    // connector. Ramp merges compete with the mainline for REAL receiving
    // space, while exit splits share the originating cell's sending capacity.
    // This fixes mid-Way motorway junctions without creating new road geometry.
    const proposed=new Map(),splitSources=[];
    const push=(to,toCell,from,fromCell,want)=>{
      const key=to+":"+toCell,arr=proposed.get(key)||[];
      arr.push({to,toCell,from,fromCell,want});
      proposed.set(key,arr);
    };
    for(let j=0;j<edges.length;j++){
      const edge=edges[j],out=send[j];
      for(let k=0;k<edge.n;k++){
        const available=out[k];
        if(available<=0)continue;
        const options=[];
        if(k<edge.n-1&&receive[j][k+1]>0)
          options.push({to:j,toCell:k+1,weight:20});
        for(const link of edge.linksFrom[k]){
          if(receive[link.to][link.toCell]<=0)continue;
          const target=edges[link.to];
          if(blockedMovement(edge,link))continue;
          options.push(link);
        }
        if(!options.length)continue;
        // If a planned corridor closure lies downstream, approaching
        // motorists can progressively take the LAST available open exit.
        // Reweight ONLY real OSM turns; never teleport cars or create roads.
        if(anyClosureActive&&edge.kind==="mainline"&&options.some(o=>
          o.to!==j&&edges[o.to].kind==="ramp")){
          const distance=closureDistanceAhead(edge,k*edge.cellLength);
          if(distance<12000){
            const imminence=Math.max(0,1-distance/12000);
            for(const option of options){
              if(option.to===j)
                option.weight=Math.max(.8,option.weight*(1-.92*imminence));
              else if(edges[option.to].kind==="ramp")
                option.weight=Math.max(option.weight,20*imminence*imminence);
            }
          }
        }
        if(options.length>1)splitSources.push({from:j,cell:k,available,options});
        const sum=options.reduce((n,x)=>n+x.weight,0);
        for(const opt of options)
          push(opt.to,opt.toCell,j,k,available*opt.weight/sum);
      }
    }
    const used=new Map(),accepted=new Map();
    for(const requests of proposed.values()){
      const {to,toCell}=requests[0];
      const accepting=receive[to][toCell];
      const required=requests.reduce((sum,x)=>sum+x.want,0);
      const ratio=required>accepting?accepting/required:1;
      for(const req of requests){
        const amount=req.want*ratio;
        delta[req.from][req.fromCell]-=amount;
        delta[to][toCell]+=amount;
        const fromKey=req.from+":"+req.fromCell,toKey=to+":"+toCell;
        used.set(fromKey,(used.get(fromKey)||0)+amount);
        accepted.set(toKey,(accepted.get(toKey)||0)+amount);
        if(req.from!==to){
          enteredStep[to]+=amount;
          departedStep[req.from]+=amount;
        }
      }
    }
    // With no vehicle-specific OD assignments, don't let a saturated turn
    // with unused demand prevent flow along an available legal throughway.
    // Reallocate ONLY residual sending supply to remaining real receiving space.
    for(const split of splitSources){
      const fromKey=split.from+":"+split.cell;
      let remaining=split.available-(used.get(fromKey)||0);
      if(remaining<1e-6)continue;
      for(const opt of [...split.options].sort((a,b)=>b.weight-a.weight)){
        const toKey=opt.to+":"+opt.toCell;
        const spare=receive[opt.to][opt.toCell]-(accepted.get(toKey)||0);
        if(spare<=1e-6)continue;
        const moved=Math.min(remaining,spare);
        delta[split.from][split.cell]-=moved;
        delta[opt.to][opt.toCell]+=moved;
        if(opt.to!==split.from){
          enteredStep[opt.to]+=moved;
          departedStep[split.from]+=moved;
        }
        accepted.set(toKey,(accepted.get(toKey)||0)+moved);
        remaining-=moved;
        if(remaining<=1e-6)break;
      }
    }
    // Only a true graph sink can discharge vehicles.
    for(let j=0;j<edges.length;j++){
      const edge=edges[j];
      if(edge.links.length)continue;
      const moved=send[j][edge.n-1];
      delta[j][edge.n-1]-=moved;
      departedStep[j]+=moved;
      exited+=moved;
    }
    // No internal phantom demand: source edges must be actual directed
    // network boundaries. Unadmitted vehicles remain in external backlog.
    for(const edge of sources){
      const j=edge.index;
      // Real corridor boundaries and one source per explicitly named AS origin.
      // Peak reference is DIRECTIONAL, not 2600 x lanes or daily DTV.
      // A closed entry ramp does not launch new journeys into a dead end.
      // Existing traffic elsewhere remains in the physical model.
      const entryClosed=(activeEffects.get(edge.id)||NO_EFFECTS)
        .some(x=>x.event.kind==="closure"&&x.gate&&x.fromM<edge.cellLength);
      const offered=entryClosed?0:edge.referencePeakVph*(demandPercent/100)*
        sourceFactor(edge,clockMs())*dt/3600;
      generated+=offered;
      const available=edge.backlog+offered;
      const admitted=Math.min(available,receive[j][0]);
      delta[j][0]+=admitted;
      enteredStep[j]+=admitted;
      edge.backlog=Math.max(0,available-admitted);
    }
    for(let j=0;j<edges.length;j++){
      const edge=edges[j],change=delta[j];
      for(let k=0;k<edge.n;k++){
        const after=edge.stock[k]+change[k];
        if(after < -1e-7||after>edge.jamPerCell+1e-6)
          throw Error("Ungültiger Fahrzeugbestand auf "+edge.id);
        edge.stock[k]=Math.max(0,after);
      }
      // 2-minute exponential flow meter for inspectable scenario plausibility.
      const alpha=1-Math.exp(-dt/120);
      edge.enteredVph+=alpha*(enteredStep[j]*3600/dt-edge.enteredVph);
      edge.departedVph+=alpha*(departedStep[j]*3600/dt-edge.departedVph);
    }
    elapsed+=dt;
    if(refreshSpeeds)recomputeSpeeds();
    const stats=totals();
    if(Math.abs(stats.conservationResidual)>1e-5*Math.max(1,generated))
      throw Error("Fahrzeugbilanz verletzt: "+stats.conservationResidual);
    return stats;
  }
  function advance(steps=12){
    if(!Number.isInteger(steps)||steps<1||steps>120)throw Error("Ungültige Simulationsschritte");
    let result;
    for(let i=0;i<steps;i++)result=step(5,i===steps-1);
    return result;
  }
  function edgeActivity(id){
    const edge=byId.get(id);
    if(!edge)return null;
    const count=edge.stock.reduce((sum,x)=>sum+x,0);
    return {reachable:reachable.has(id),vehicles:count,
      enteredVph:edge.enteredVph,departedVph:edge.departedVph,
      capacityVph:edge.lanes*edge.capacityPerLane,
      source:edge.source,sourcePeakVph:edge.referencePeakVph,
      sourceDirection:edge.directionKey,connections:edge.links.length};
  }
  function speed(id){return byId.get(id)?.speed??null;}
  function color(id){const edge=byId.get(id);return edge?colourForSpeed(edge.speed):"free";}
  return {advance,step,reset,warmStart,setMode,setEvent,removeEvent,listEvents,visualBands,closureBands,
    setSimulationStart,clockMs,eventStatus,setDemandPercent,totals,speed,color,mode,
    activeEvents,jamSummaries:()=>jamGroups,sourceCount:()=>sources.length,edgeCount:()=>edges.length,
    edgeActivity,reachable:id=>reachable.has(id),reachableCount:()=>reachable.size,
    recommendedClosureLength,
    movementBlocked:(fromId,toId)=>{
      const from=byId.get(fromId);
      return !!from&&from.links.some(link=>edges[link.to].id===toId&&
        blockedMovement(from,link));
    },
    incomingCount:id=>byId.get(id)?.incoming??0,
    entryIncomingCount:id=>byId.get(id)?.incomingAtStart??0,
    sourceIds:()=>sources.map(x=>x.id),
    normalizedReversedWays:()=>[...reversedWays],
    sourceProfiles:()=>sources.map(edge=>({id:edge.id,ref:edge.ref,
      direction:edge.directionKey,peakVph:edge.referencePeakVph,
      kind:edge.kind,name:edge.name})),
    junctionCount:()=>linkKeys.size};
}
global.createLegacyTrafficScenario=createLegacyTrafficScenario;
})(window);
