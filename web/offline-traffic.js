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
      // A tagged subflow of real cell occupancy: vehicles committed to an
      // actual open off-ramp and its verified downstream model on-ramp.
      divertStock:new Float64Array(count),
      // User-defined unrestricted motorway service, not a speed threshold.
       capacityPerLane:row[1]==="ramp"?1500:2200,
      freeKmh:row[1]==="ramp"?75:120,
      // CTM cell storage must cover at least one five-second free-flow
      // distance. Many original OSM Ways are only 3-25m long. Treating such
      // micro-Ways as independent physical storage limited unrestricted
      // 3-lane throughput to <1500 Kfz/h and made phantom congestion.
      // This is a virtual numerical connector: rendered/geographic lengths
      // and kilometre-based jam measurements stay at the real OSM metres.
      jamPerCell:130*lanes*Math.max(meters/count,
        (row[1]==="ramp"?75:120)*5/3.6)/1000,
      next:[],incoming:0,incomingAtStart:0,mainlineIncomingAtStart:0,source:false,backlog:0,
      mode:"none",speed:row[1]==="ramp"?75:120,visualBands:[],
      cellFlowSpeeds:new Float64Array(count).fill(row[1]==="ramp"?75:120),
      // Two-minute actual throughput per cell, including internal merges.
      cellThroughVph:new Float64Array(count),
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
    // A single long OSM way is a legitimate continuous motorway corridor.
    const result=metres>=1500;
    provenMainline.set(edge.id,result);return result;
  }
  // Group physically connected same-direction OSM motorway Ways. The old
  // globally unique motorway key starved separately imported carriageways
  // and map-cropped components after the initial traffic inventory drained.
  // No spatial snapping: only already permitted directed OSM links count.
  const motorwayNeighbors=new Map();
  for(const edge of edges)if(edge.kind==="mainline")motorwayNeighbors.set(edge.index,new Set());
  for(const edge of edges){
    if(edge.kind!=="mainline")continue;
    for(const turn of edge.links){
      const next=edges[turn.to];
      if(next.kind!=="mainline"||next.ref!==edge.ref)continue;
      motorwayNeighbors.get(edge.index).add(next.index);
      motorwayNeighbors.get(next.index).add(edge.index);
    }
  }
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
    return key.endsWith("-sued")?-lat:key.endsWith("-nord")?lat:-lon;
  }
  const sources=[],componentSeen=new Set();
  let sourceComponents=0,unservedComponents=0;
  for(const first of edges){
    if(first.kind!=="mainline"||componentSeen.has(first.index))continue;
    const component=[],stack=[first.index];
    while(stack.length){
      const id=stack.pop();
      if(componentSeen.has(id))continue;
      componentSeen.add(id);component.push(edges[id]);
      for(const neighbor of motorwayNeighbors.get(id)||[])
        if(!componentSeen.has(neighbor))stack.push(neighbor);
    }
    const totalLength=component.reduce((sum,edge)=>sum+edge.lengthM,0);
    // A short disconnected ramp/Way fragment must NOT get a full motorway
    // source. But a real map-cut motorway >= 1.5 km must receive arrivals.
    if(totalLength<1500)continue;
    const possible=component.filter(edge=>!edge.mainlineIncomingAtStart)
      .map(edge=>({edge,profile:traffic.referenceForRoad(rowById.get(edge.id))}))
      .filter(x=>x.profile.peakVph>0);
    if(!possible.length){unservedComponents++;continue;}
    possible.sort((a,b)=>upstreamRank(b.edge,b.profile.key)-upstreamRank(a.edge,a.profile.key)
      ||b.edge.lengthM-a.edge.lengthM);
    const {edge,profile}=possible[0];
    edge.source=true;edge.referencePeakVph=profile.peakVph;
    edge.directionKey=profile.key;sources.push(edge);sourceComponents++;
  }
  const distinctOnramps=new Map();
  for(const edge of edges){
    if(edge.kind!=="ramp"||edge.incomingAtStart||!edge.links.length)continue;
    if(!/\b(?:auffahrt|zufahrt)\b/i.test(edge.name)||/rampenzweig/i.test(edge.name))
      continue;
    const row=rowById.get(edge.id);
    const realDestinations=edge.links.map(link=>edges[link.to]).filter(target=>
      target.kind==="mainline"&&target.ref&&hasContinuousMainline(target));
    if(!realDestinations.length)continue;
    // OSM motorway_link may lack a ref even when its real directed merge
    // unambiguously joins an A3/A4/... carriageway. Infer the DESTINATION's
    // motorway from that real mapped movement, never from geographic proximity.
    const refs=new Set(realDestinations.map(target=>target.ref));
    const inferredRef=edge.ref||(refs.size===1?[...refs][0]:null);
    if(!inferredRef)continue;
    const rowWithRef=[row[0],row[1],inferredRef,row[3],row[4],row[5]];
    const profile=traffic.referenceForRoad(rowWithRef);
    const peak=traffic.junctionEntryPeak(rowWithRef);
    if(peak<=0)continue;
    // Repeated copies/fragments for the same signed AS→direction must never
    // create repeated independent 500 Kfz/h traffic generators.
    const label=edge.name.replace(/\s+/g," ").trim().toLowerCase();
    const old=distinctOnramps.get(label);
    if(!old||edge.lengthM>old.edge.lengthM)
      distinctOnramps.set(label,{edge,profile,peak});
  }
  for(const {edge,profile,peak} of distinctOnramps.values()){
    edge.source=true;edge.referencePeakVph=peak;
    edge.directionKey=profile.key;
    // The link has one confirmed receiving motorway even if its Way omitted
    // a ref tag, allowing the correct time-of-day demand profile.
    if(!edge.ref)edge.ref=profile.ref;
    sources.push(edge);
  }
  // A motorway does not terminate merely because our displayed OSM extract
  // stops. Keep genuine modelled interchanges internal, but allow an external
  // sink when no mainline can be reached through its final ramps.
  function leadsToMainline(index,seen=new Set(),depth=0){
    if(depth>8||seen.has(index))return false;
    const edge=edges[index];
    if(edge.kind==="mainline")return true;
    seen.add(index);
    return edge.links.some(turn=>leadsToMainline(turn.to,seen,depth+1));
  }
  // Stable graph index: prevent O(edges²) pin scans on every mobile draw.
  const incomingTurnEdges=edges.map(()=>[]);
  for(const from of edges)for(const turn of from.links)
    incomingTurnEdges[turn.to].push(from);
  const boundaryExit=edges.map(edge=>{
    const outgoing=edge.links.filter(link=>link.fromM>=edge.lengthM-.1);
    if(!outgoing.length)return true;
    if(edge.kind!=="mainline")return false;
    return !outgoing.some(link=>leadsToMainline(link.to));
  });
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
  const divertDelta=edges.map(edge=>new Float64Array(edge.n));
  const enteredStep=new Float64Array(edges.length);
  const departedStep=new Float64Array(edges.length);
  const eventRecords=new Map();
  let activeEffects=new Map(),effectsStamp=null,simStart=Date.now();
  let exposureEpoch=0,closureFingerprint="";
  let elapsed=0,generated=0,exited=0,demandPercent=100,initialVehicles=0;
  // Trips that have left the *displayed* motorway network, but have not yet
  // reentered at a real OSM on-ramp, are conserved as external-road inventory.
  let outsideVehicles=0,detouredVehicles=0,returnedVehicles=0;
  const detourTrips=[];
  // Combine same-minute arrivals to keep the simulator responsive on phones.
  const detourBatchIndex=new Map();
  const terminalDetours=new Map(),exitDetours=new Map();
  let detourPlansKey=null;
  let warmedUp=false;
  let jamGroups=[];
  function totals(){
    let inside=0,backlog=0;
    for(const edge of edges){
      for(const n of edge.stock)inside+=n;
      backlog+=edge.backlog;
    }
    const residual=initialVehicles+generated-exited-inside-backlog-outsideVehicles;
    return {simSeconds:elapsed,initialVehicles,
      generatedVehicles:generated,exitedVehicles:exited,
      vehiclesOnNetwork:inside,waitingOutsideSources:backlog,
      vehiclesOnDetours:outsideVehicles,detouredVehicles,returnedVehicles,
      conservationResidual:Math.abs(residual)<1e-7?0:residual,
      sources:sources.length,edges:edges.length,excludedRest,
      motorwaySourceComponents:sourceComponents,unservedMotorwayComponents:unservedComponents};
  }
  function clockMs(){return simStart+elapsed*1000;}
  function migrateLegacyEvent(raw){
    if(!raw||!reversedWays.includes(raw.edgeId)||!finite(Number(raw.offsetM)))
      return raw;
    const edge=byId.get(raw.edgeId);
    if(!edge)return raw;
    const old=Number(raw.offsetM);
    // Earlier SPCK versions displayed the same vertices in the reverse
    // order on 48 A3/A48 ways. Preserve the physical event interval.
    const eventLength=raw.kind==="closure"?.1:
      Math.min(Math.max(0,Number(raw.lengthM)||0),edge.lengthM-old);
    const newOffset=Math.max(0,Math.min(edge.lengthM-.001,
      edge.lengthM-old-eventLength));
    return {...raw,offsetM:newOffset};
  }
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
      // A junction center can be a few hundred metres before/after the
      // first imported Way (e.g. AK Koblenz A48/A61). Project it onto
      // that real motorway end rather than leaving the corridor unbookable.
      // Deduplication below still picks the closest projection per AS.
      const exterior=offset<.1||offset>edge.lengthM-.1;
      if(best<=(exterior?700:260))found.push({offset,junction,best});
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
      if(chain.length>2500)break;
    }
    for(let i=0;i<500;i++){
      const last=chain.at(-1),forward=(mainlineNext.get(last.id)||[])
        .filter(x=>!seen.has(x.id));
      if(forward.length!==1)break;
      const candidate=forward[0];
      chain.push(candidate);seen.add(candidate.id);
      if(chain.length>2500)break;
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
    // A junction coordinate can project onto several short adjacent OSM
    // Ways. These are NOT distinct exits! Deduplicate by motorway+AS number,
    // choosing the best geometrical projection (lowest perpendicular error).
    const unique=new Map();
    for(const mark of marks){
      const key=mark.junction[0]+":"+mark.junction[1];
      const old=unique.get(key);
      if(!old||mark.best<old.best-.01||
        (Math.abs(mark.best-old.best)<.01&&
          Math.abs(mark.position-point)<Math.abs(old.position-point)))
        unique.set(key,mark);
    }
    const ordered=[...unique.values()].sort((a,b)=>a.position-b.position);
    if(ordered.length<2)return null;
    // A finger tap belongs to the TWO junction anchors actually
    // surrounding that point. Do not silently jump to the FOLLOWING
    // corridor merely because the tap is within 450 m of its next AS.
    // At the outside of an incomplete graph, reject instead of guessing.
    const ix=ordered.findIndex(mark=>mark.position>=point);
    if(ix<=0)return null;
    const left=ordered[ix-1],right=ordered[ix];
    if(!right||left.junction[1]===right.junction[1]||
      right.position-left.position<100)return null;
    // An AS centre is only a map LABEL, never the true legal closure gate.
    // Move upstream boundary to the last usable off-ramp split, and the
    // downstream boundary to the first actual on-ramp merge. This also
    // ensures the downstream exit is INSIDE the closure, while the on-ramp
    // directly behind it remains OPEN to returning traffic.
    const offSplits=[],onMerges=[];
    for(const main of chain){
      const base=starts.get(main.id);
      for(const turn of main.links)
        if(edges[turn.to].kind==="ramp")
          offSplits.push(base+turn.fromM);
    }
    for(const ramp of edges){
      if(ramp.kind!=="ramp")continue;
      for(const turn of ramp.links){
        const target=edges[turn.to],base=starts.get(target.id);
        if(target.kind==="mainline"&&base!==undefined)
          onMerges.push(base+turn.toM);
      }
    }
    const nearestGate=(candidates,mark,lower,upper)=>{
      const viable=candidates.filter(at=>
        at>=Math.max(0,mark-1500)&&at<=mark+1500&&
        at>lower&&at<upper);
      viable.sort((a,b)=>Math.abs(a-mark)-Math.abs(b-mark)||a-b);
      return viable[0];
    };
    const startGate=nearestGate(offSplits,left.position,-1,point);
    const endGate=nearestGate(onMerges,right.position,point,advance+1);
    // Never let a guessed ramp gate reverse the tapped carriageway.
    const fromPosition=startGate??left.position;
    const toPosition=endGate??right.position;
    if(fromPosition>=point||toPosition<=point||
      toPosition-fromPosition<100)return null;
    const spans=[];
    for(const road of chain){
      const begin=starts.get(road.id),end=begin+road.lengthM;
      const fromM=Math.max(0,fromPosition-begin);
      const toM=Math.min(road.lengthM,toPosition-begin);
      if(toM>fromM+.05&&end>=fromPosition&&begin<=toPosition)
        spans.push({edgeId:road.id,fromM,toM,gate:spans.length===0});
    }
    if(!spans.length)return null;
    return {spans,coveredLengthM:spans.reduce((n,s)=>n+s.toM-s.fromM,0),
      truncated:false,from:left.junction,to:right.junction,
      fromLabel:left.junction[0]+" "+left.junction[1]+" "+left.junction[2],
      toLabel:right.junction[0]+" "+right.junction[1]+" "+right.junction[2]};
  }
  // A tap on an exit or entrance ramp closes only that directed ramp.
  // Extend through physically joined ramp fragments, but never across a
  // mainline, a public road or an ambiguous branch shared by another route.
  const rampParents=new Map();
  function rampSuccessors(edge){
    if(edge.kind!=="ramp")return [];
    return [...new Set(edge.links.filter(link=>
      link.fromM>=edge.lengthM-.1&&link.toM<.1&&
      edges[link.to].kind==="ramp").map(link=>edges[link.to]))];
  }
  for(const road of edges)if(road.kind==="ramp")
    for(const next of rampSuccessors(road)){
      const parents=rampParents.get(next.id)||[];
      if(!parents.includes(road))parents.push(road);
      rampParents.set(next.id,parents);
    }
  function rampCorridor(road){
    if(road.kind!=="ramp")return null;
    const chain=[road],visited=new Set([road.id]);
    for(let i=0;i<100;i++){
      const parents=(rampParents.get(chain[0].id)||[])
        .filter(x=>!visited.has(x.id));
      if(parents.length!==1||rampSuccessors(parents[0]).length!==1)break;
      chain.unshift(parents[0]);visited.add(parents[0].id);
    }
    for(let i=0;i<100;i++){
      const successors=rampSuccessors(chain.at(-1))
        .filter(x=>!visited.has(x.id));
      if(successors.length!==1||
        (rampParents.get(successors[0].id)||[]).length!==1)break;
      chain.push(successors[0]);visited.add(successors[0].id);
    }
    const spans=chain.map((edge,i)=>({
      edgeId:edge.id,fromM:0,toM:edge.lengthM,gate:i===0
    }));
    return {spans,coveredLengthM:chain.reduce((n,e)=>n+e.lengthM,0),
      truncated:false};
  }
  function recommendedClosureLength(id,offsetM=0){
    const road=byId.get(id);
    if(!road)return null;
    if(road.kind==="ramp"){
      const ramp=rampCorridor(road);
      return ramp?{lengthM:Math.round(ramp.coveredLengthM),
        label:"ausgewählte Auf-/Abfahrt",rampOnly:true}:null;
    }
    const corridor=motorwayCorridor(road,offsetM);
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
    const physical=kind==="closure"?
      edge.kind==="mainline"?motorwayCorridor(edge,offset):
      edge.kind==="ramp"?rampCorridor(edge):null:null;
    if(kind==="closure"&&edge.kind==="mainline"&&
      (data.junctions||[]).some(j=>j[0]===edge.ref)&&!physical)
      throw Error("Vollsperrung nicht gesetzt: Zwei verbundene Anschlussstellen "+
        "in dieser Fahrtrichtung konnten nicht sicher ermittelt werden.");
    const traceResult=physical||trace(edge,offset,length);
    if(physical){
      // Preserve the finger-selected event marker even though the physical
      // closure starts earlier. Rendering and physics read the SAME spans.
      spec.lengthM=Math.max(1,Math.round(physical.coveredLengthM));
      if(edge.kind==="mainline"){
        spec.closureFrom=physical.fromLabel;spec.closureTo=physical.toLabel;
      }
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
    eventRecords.set(valid.spec.id,valid);effectsStamp=null;detourPlansKey=null;
    exposureEpoch++;
    updateEffects();
    recomputeSpeeds();
    return {...valid.spec,coveredLengthM:valid.coveredLengthM,
      truncated:valid.truncated};
  }
  function removeEvent(id){
    const removed=eventRecords.delete(id);effectsStamp=null;detourPlansKey=null;
    if(removed)exposureEpoch++;
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
      record.spans.some(span=>byId.get(span.edgeId)?.kind==="mainline")&&
      (!record.spec.schedule||
        global.StauEventSchedule.active(record.spec.schedule,time)));
    const fingerprint=roadClosures.map(x=>x.spec.id).sort().join("|");
    if(fingerprint!==closureFingerprint){
      closureFingerprint=fingerprint;exposureEpoch++;
    }
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
        return (spansById.get(target.id)||[]).some(span=>{
          if(link.toM>=span.fromM-.05&&link.toM<span.toM-.05)
            return true;
          if(target.kind!=="mainline"||link.toM>=span.fromM)return false;
          // A feeder may merge just BEFORE the closure on the same OSM
          // Way. It is forbidden only if there is no legal exit between
          // its real merge and the physical closure start.
          const escape=target.links.some(turn=>{
            const other=edges[turn.to];
            return turn.fromM>=link.toM-.05&&turn.fromM<span.fromM-.05&&
              !closed.has(other.id)&&
              (other.kind==="ramp"||
                other.kind==="mainline"&&other.ref!==target.ref);
          });
          return !escape;
        });
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
      // Off-ramps whose physical diverge occurs INSIDE the already closed
      // mainline interval are closed to new entering traffic too. In contrast,
      // the last off-ramp immediately BEFORE the gate stays OPEN and the
      // first reentry on-ramp just AFTER the gate stays OPEN.
      const downstreamExits=new Set();
      for(const mainSpan of record.spans){
        const main=byId.get(mainSpan.edgeId);
        if(main?.kind!=="mainline")continue;
        for(const turn of main.links){
          const next=edges[turn.to];
          // An OSM mainline consists of many short Ways. A downstream
          // exit can diverge at metre ZERO of a later Way and is still
          // INSIDE the closure. Only the very FIRST gate's off-ramp
          // remains open so all approaching vehicles can leave.
          const beyondInitialGate=!mainSpan.gate||
            turn.fromM>mainSpan.fromM+.3;
          if(next.kind==="ramp"&&beyondInitialGate&&
            turn.fromM>=mainSpan.fromM-.05&&
            turn.fromM<=mainSpan.toM+.05)
            downstreamExits.add(next.id);
        }
      }
      for(const id of [...ramps,...downstreamExits]){
        const edge=byId.get(id);
        const list=byEdge.get(id)||[];
        // Cars already inside the administrative closure may still flow
        // out; the receiving gate blocks only NEW arrivals.
        if(!list.some(span=>span.event.id===record.spec.id))
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
        const measured=Math.min(densitySpeed,edge.cellFlowSpeeds[k]);
        let speed=measured;
        for(const effect of effectList){
          if(effect.fromM>=b-.001||effect.toM<=a+.001)continue;
          if(effect.event.speedKmh>0)
            speed=Math.min(speed,effect.event.speedKmh);
        }
        // No vehicle = no measured travel speed. Capacity restrictions and
        // closures remain separately visible as event/closure overlays.
        if(edge.stock[k]>=1)minSpeed=Math.min(minSpeed,speed);
        const congested=edge.stock[k]>=Math.max(2,edge.lanes*1.2)&&fraction>.23;
        const color=congested?colourForSpeed(measured):"free";
        if(color!=="free"){
          const previous=bands.at(-1);
          if(previous&&previous.color===color&&Math.abs(previous.toM-a)<.001){
            previous.toM=b;
            previous.speedKmh=Math.min(previous.speedKmh,measured);
          }else bands.push({fromM:a,toM:b,color,speedKmh:measured});
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
          longestM:0,segments:[]};
        groups.set(key,g);
      }
      const len=piece.toM-piece.fromM;
      g.segments.push(piece);
      g.lengthM+=len;g.delayMin+=piece.delayMin;
      g.worstKmh=Math.min(g.worstKmh,piece.worstKmh);
      if(len>g.longestM){
        g.longestM=len;g.edgeId=piece.edgeId;
        g.offsetM=(piece.fromM+piece.toM)/2;
      }
    }
    return [...groups.values()].filter(g=>g.lengthM>=350&&g.delayMin>=.5)
      .sort((a,b)=>b.delayMin-a.delayMin)
      .map(g=>{
        // The queue label sits at its longest cell; the downstream HEAD of
        // the queue is a different point. A detour must reenter AFTER that
        // actual head, even when a jam crosses 40 short OSM Ways.
        const memberIds=new Set(g.segments.map(x=>x.edgeId));
        const terminal=g.segments.filter(piece=>{
          const road=byId.get(piece.edgeId);
          if(piece.toM<road.lengthM-.02)return true;
          return !road.next.some(turn=>{
            const target=edges[turn.to];
            return target.kind===road.kind&&target.ref===road.ref&&
              memberIds.has(target.id);
          });
        });
        const head=terminal.length===1?terminal[0]:null;
        const {longestM,segments,...publicGroup}=g;
        if(head){
          publicGroup.endEdgeId=head.edgeId;
          publicGroup.endOffsetM=head.toM;
        }
        return publicGroup;
      });
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
    outsideVehicles=0;detouredVehicles=0;returnedVehicles=0;
    detourTrips.length=0;detourBatchIndex.clear();
    terminalDetours.clear();exitDetours.clear();detourPlansKey=null;
    for(const edge of edges){
      edge.stock.fill(0);edge.divertStock.fill(0);
      edge.backlog=0;edge.speed=edge.freeKmh;
      edge.cellFlowSpeeds.fill(edge.freeKmh);
      edge.cellThroughVph.fill(0);
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
  function closureDistanceAhead(edge,offsetM,maxDistance=16000){
    let current=edge,from=Math.max(0,offsetM),travelled=0;
    const visited=new Set();
    for(let hops=0;hops<1200&&travelled<=maxDistance;hops++){
      if(visited.has(current.id))return Infinity;
      visited.add(current.id);
      const effects=activeEffects.get(current.id)||NO_EFFECTS;
      for(const item of effects){
        if(item.event.kind!=="closure"||item.fromM<from-.01)continue;
        const distance=travelled+item.fromM-from;
        if(distance<=maxDistance)return distance;
      }
      // Keep the same motorway where it continues. But when a route ends
      // directly into exactly one OTHER motorway (e.g. A59→A3 at Heumar),
      // look ahead across that true directed OSM connection as well. Without
      // this, A59 cars would stop at the A3 barrier instead of exiting early.
      const through=current.next.filter(link=>
        edges[link.to].kind==="mainline"&&!visited.has(edges[link.to].id));
      const same=through.filter(link=>edges[link.to].ref===current.ref);
      const next=same.length===1?same:!same.length&&through.length===1?through:[];
      if(next.length!==1)return Infinity;
      travelled+=current.lengthM-from;
      current=edges[next[0].to];from=0;
    }
    return Infinity;
  }
  // A motorway may end at a genuine interchange fork instead of continuing
  // as another same-ref mainline. Follow the REAL directed ramp successors to
  // find the share of onward destinations that would enter a closed corridor.
  // E.g. A48→A3 Frankfurt is closed while A48→A3 Köln remains open. Returning
  // risk 0.5 lets AS traffic divert BEFORE the final A48 fork, not pile up on
  // the 1-lane Köln connector. This computes no fictional OSM movements.
  const exposureCache=new Map();let exposureStamp=null;
  function closureExposureAhead(edge,offsetM=0,maxDistance=25000){
    // Traffic exposure only changes when the closure catalog or active
    // schedule changes, NOT on every 5-second CTM tick. Keep this graph
    // analysis cached across timesteps for iPhone/SPCK performance.
    const stamp=exposureEpoch;
    if(exposureStamp!==stamp){exposureCache.clear();exposureStamp=stamp;}
    const cacheKey=edge.id+":"+Math.floor(offsetM/100)+":"+maxDistance;
    if(exposureCache.has(cacheKey))return exposureCache.get(cacheKey);
    const examine=(current,from,remaining,seen,depth)=>{
      if(depth>=160||remaining<=0||seen.has(current.id))return 0;
      for(const effect of activeEffects.get(current.id)||NO_EFFECTS){
        if(effect.event.kind!=="closure"||effect.toM<from+.01)continue;
        if(effect.fromM-from<=remaining)return 1;
      }
      const distance=Math.max(0,current.lengthM-from);
      if(distance>=remaining)return 0;
      const candidates=current.next.filter(link=>{
        const next=edges[link.to];
        return !seen.has(next.id);
      });
      // Along a motorway ignore incidental service/exit ramps while its real
      // same-direction continuation exists. At a genuine motorway END, inspect
      // all physical continuation ramps into other motorways. This is the
      // relevant branch distribution for closure advance notification.
      const through=current.kind==="mainline"?candidates.filter(link=>
        edges[link.to].kind==="mainline"&&edges[link.to].ref===current.ref):[];
      const choices=through.length?through:
        current.kind==="mainline"?candidates.filter(link=>
          edges[link.to].kind==="mainline"||edges[link.to].kind==="ramp"):
        candidates;
      if(!choices.length)return 0;
      const visited=new Set(seen);visited.add(current.id);
      let blocked=0,total=0;
      for(const link of choices){
        const next=edges[link.to];
        const weight=1; // currently unknown destination mix, NOT BASt share
        blocked+=weight*examine(next,0,remaining-distance,visited,depth+1);
        total+=weight;
      }
      return total?blocked/total:0;
    };
    const share=Math.max(0,Math.min(1,examine(edge,Math.max(0,offsetM),
      maxDistance,new Set(),0)));
    exposureCache.set(cacheKey,share);
    return share;
  }
  function blockedMovement(from,link){
    updateEffects();
    const target=edges[link.to];
    if(!target)return false;
    const toEffects=activeEffects.get(target.id)||NO_EFFECTS;
    if(!toEffects.length)return false;
    const upstream=activeEffects.get(from.id)||NO_EFFECTS;
    return toEffects.some(item=>{
      if(link.toM>=item.toM-.05)return false;
      if(link.toM<item.fromM-.05){
        if(item.event.kind!=="closure"||target.kind!=="mainline"||
          // On the same carriageway, cars may approach and queue at the
          // real gate. A feeder from another motorway may NOT turn in.
          (from.kind==="mainline"&&from.ref===target.ref))
          return false;
        // An early incoming motorway/feeder turn is blocked only if there
        // is no legal open exit before the actual closure start. Geometry
        // determines this, NOT an arbitrary 140-metre distance buffer.
        const safeExit=target.links.some(turn=>{
          if(turn.fromM<link.toM-.05||turn.fromM>=item.fromM-.05)
            return false;
          const other=edges[turn.to];
          if(other.kind!=="ramp"&&
            !(other.kind==="mainline"&&other.ref!==target.ref))return false;
          return !(activeEffects.get(other.id)||NO_EFFECTS)
            .some(closure=>closure.event.kind==="closure"&&
              closure.event.id===item.event.id);
        });
        if(safeExit)return false;
      }
      if(item.event.kind!=="closure"&&
        (item.event.closedLanes.length!==target.lanes||
        item.event.shoulder==="open"))return false;
      return !upstream.some(inside=>inside.event.id===item.event.id);
    });
  }
  // User scenario rule: below 45 minutes do not divert because of delay;
  // at four hours the traffic willing to leave a jam reaches 100%.
  // This is a willingness model, NOT a guarantee a usable exit has capacity.
  function diversionShare(delayMin){
    if(!Number.isFinite(delayMin)||delayMin<=45)return 0;
    if(delayMin>=240)return 1;
    const t=(delayMin-45)/195;
    return t*t*(3-2*t);
  }
  const delayCache=new Map();
  let delayCacheMinute=-1;
  // Project excess travel time over physically consecutive same-direction OSM
  // cells only. No guessing a detour over unimported public roads.
  function measuredDelayAhead(edge,offsetM,maxDistance=50000){
    const minute=Math.floor(elapsed/60);
    if(minute!==delayCacheMinute){delayCache.clear();delayCacheMinute=minute;}
    const key=edge.id+":"+Math.floor(offsetM/100);
    if(delayCache.has(key))return delayCache.get(key);
    let current=edge,from=Math.max(0,offsetM),distance=0,delay=0;
    const seen=new Set();
    for(let hops=0;hops<1200&&distance<maxDistance;hops++){
      if(seen.has(current.id))break;
      seen.add(current.id);
      const start=Math.max(0,Math.floor(from/current.cellLength));
      for(let i=start;i<current.n&&distance<maxDistance;i++){
        const metres=Math.min(maxDistance-distance,
          (i+1)*current.cellLength-Math.max(from,i*current.cellLength));
        if(metres<=0)continue;
        const occupied=current.stock[i]>=1;
        const density=Math.min(1,current.stock[i]/Math.max(.001,current.jamPerCell));
        const densitySpeed=current.freeKmh*(density<=.23?1:
          Math.max(.04,1-Math.pow((density-.23)/.77,1.45)));
        const v=occupied?Math.max(4,Math.min(densitySpeed,current.cellFlowSpeeds[i])):
          current.freeKmh;
        delay+=Math.max(0,metres/1000*60*(1/v-1/current.freeKmh));
        distance+=metres;
      }
      const next=current.next.map(x=>edges[x.to]).filter(x=>
        x.kind==="mainline"&&x.ref===edge.ref&&!seen.has(x.id));
      if(next.length!==1)break;
      current=next[0];from=0;
    }
    const result=Math.min(360,delay);
    delayCache.set(key,result);
    return result;
  }
  // A ramp is a usable diversion only if its genuine OSM turns do not lead
  // exclusively into the closed sector. Existing open motorway branches or an
  // actual external ramp end are acceptable; no artificial re-entry points.
  function isUsableEscape(from,turn,visited=new Set(),depth=0){
    if(depth>16||blockedMovement(from,turn))return false;
    const target=edges[turn.to];
    if(!target||visited.has(target.id))return false;
    if(target.kind==="mainline")
      return closureDistanceAhead(target,turn.toM,16000)===Infinity;
    visited.add(target.id);
    if(!target.links.length)return true;
    for(const move of target.links){
      if(isUsableEscape(target,move,new Set(visited),depth+1))return true;
    }
    return false;
  }
  // Macro detours: the SPCK file contains true OSM motorway exits/entrances
  // but NOT all intervening city and country roads. We therefore do not draw
  // fictitious streets. Eligible traffic uses its REAL OSM off-ramp, travels
  // in a conserved off-map inventory, and returns only at a REAL directed
  // OSM on-ramp downstream of the closed section. The off-map duration is a
  // documented estimate, not an audited street-by-street shortest path.
  function estimatedOutsideSeconds(exit,entrance){
    // Unmapped local/urban road travel is an explicit travel-time estimate.
    const firstPoint=rowById.get(exit.id)[4].at(-1);
    const lastPoint=rowById.get(entrance.id)[4][0];
    const lat1=firstPoint[0]*rad,lat2=lastPoint[0]*rad;
    const dlat=lat2-lat1,dlon=(lastPoint[1]-firstPoint[1])*rad;
    const straight=2*R*Math.asin(Math.min(1,Math.sqrt(
      Math.sin(dlat/2)**2+Math.cos(lat1)*Math.cos(lat2)*
      Math.sin(dlon/2)**2)));
    return Math.max(300,Math.min(7200,
      180+straight*1.55/(40/3.6)));
  }
  // The aggregate cell-flow engine does not yet know individual OD pairs.
  // Without that information, ALL vehicles continuing on this motorway must
  // return at the FIRST lawful on-ramp after the obstruction. Later ramps are
  // retained as physical candidates for future real OD-route assignments,
  // but do not receive arbitrary invented 82/14/4 destination shares.
  function destinationWeights(count){
    return Array.from({length:count},(_,i)=>i===0?1:0);
  }
  function buildDetourPlans(){
    const events=[...eventRecords.values()].filter(record=>
      record.spans.some(span=>byId.get(span.edgeId)?.kind==="mainline")&&
      (!record.spec.schedule||
        global.StauEventSchedule.active(record.spec.schedule,clockMs()))&&
      ["closure","accident","roadworks","breakdown"].includes(record.spec.kind));
    // Unplanned recurrent congestion can also induce diversions. Use the
    // actual downstream queue head (not the display-label midpoint). Do not
    // make a second phantom obstruction on a route already carrying an event.
    const eventRefs=new Set(events.flatMap(event=>event.spans.map(span=>
      byId.get(span.edgeId)?.ref).filter(Boolean)));
    const queues=jamGroups.filter(group=>group.delayMin>=45&&group.lengthM>=500&&
      group.endEdgeId&&!eventRefs.has(byId.get(group.endEdgeId)?.ref)&&
      byId.get(group.endEdgeId)?.kind==="mainline").slice(0,3)
      .map(group=>({spec:{id:"queue:"+group.endEdgeId+":"+
        Math.round(group.endOffsetM/100),kind:"congestion"},spans:[{
          edgeId:group.endEdgeId,fromM:group.endOffsetM,
          toM:group.endOffsetM}]}));
    const obstacles=[...events,...queues];
    const key=obstacles.map(x=>x.spec.id+":"+x.spans.map(s=>
      s.edgeId+":"+Math.round(s.fromM)+":"+Math.round(s.toM)).join(",")).join("|");
    if(key===detourPlansKey)return;
    detourPlansKey=key;exitDetours.clear();
    for(const obstacle of obstacles){
      const last=obstacle.spans.at(-1),endEdge=byId.get(last.edgeId);
      if(!endEdge||endEdge.kind!=="mainline")continue;
      // Walk forward on the physically connected directed motorway only.
      // The road after this event is traversable on the same carriageway;
      // never switch to its opposite direction because it's nearby on a map.
      const downstream=new Map([[endEdge.id,0]]);
      const queue=[endEdge];
      for(let i=0;i<queue.length&&i<2000;i++){
        const edge=queue[i],base=downstream.get(edge.id);
        const remaining=edge===endEdge?edge.lengthM-last.toM:edge.lengthM;
        for(const link of edge.next){
          const next=edges[link.to];
          if(next.kind!=="mainline"||next.ref!==endEdge.ref||
            downstream.has(next.id))continue;
          const metres=base+Math.max(0,remaining);
          if(metres>60000)continue;
          downstream.set(next.id,metres);queue.push(next);
        }
      }
      const optionsByJunction=new Map();
      for(const ramp of edges){
        if(ramp.kind!=="ramp"||!/(?:auffahrt|zufahrt)/i.test(ramp.name)||
          (activeEffects.get(ramp.id)||NO_EFFECTS).some(e=>
            e.event.kind==="closure"))continue;
        for(const turn of ramp.links){
          const road=edges[turn.to],base=downstream.get(road.id);
          if(road.kind!=="mainline"||road.ref!==endEdge.ref||base===undefined)continue;
          const distance=road===endEdge?turn.toM-last.toM:base+turn.toM;
          // The first legal reentry is often the ramp that MERGES at the
          // exact end of the blocked mainline (distance 0). Requiring
          // 80 metres beyond the closure silently discarded that ramp and
          // stranded diverted drivers despite a lawful open reentry.
          if(!(distance>=-.05&&distance<60000))continue;
          // A long OSM interchange can have several ramp pieces. Treat an
          // Anschlussstelle as ONE candidate, not three phantom destinations.
          const junction=(ramp.name.split(" · ")[0]||ramp.id)
            .replace(/\s+/g," ").trim().toLowerCase();
          const key=endEdge.ref+":"+junction;
          const previous=optionsByJunction.get(key);
          if(!previous||distance<previous.distance)
            optionsByJunction.set(key,{ramp,distance,junction});
        }
      }
      const candidates=[...optionsByJunction.values()]
        .sort((a,b)=>a.distance-b.distance||a.ramp.id.localeCompare(b.ramp.id))
        .slice(0,3);
      if(!candidates.length)continue;
      // Identify actual upstream off-ramps that terminate outside the limited
      // motorway-only extract. Never invent a ramp or local street connection.
      for(const main of edges){
        if(main.kind!=="mainline")continue;
        for(const turn of main.links){
          const first=edges[turn.to];
          const fullClosure=obstacle.spec.kind==="closure";
          const affected=fullClosure?
            closureDistanceAhead(main,turn.fromM,16000)!==Infinity||
              closureExposureAhead(main,turn.fromM)>0:
            measuredDelayAhead(main,turn.fromM)>=45;
          if(first.kind!=="ramp"||!affected)continue;
          const pending=[first],seen=new Set();
          for(let q=0;q<pending.length&&q<25;q++){
            const ramp=pending[q];
            if(seen.has(ramp.id))continue;
            seen.add(ramp.id);
            const successors=ramp.links.map(link=>edges[link.to]);
            if(!successors.length&&boundaryExit[ramp.index]){
              const weights=destinationWeights(candidates.length);
              const entries=candidates.map((candidate,i)=>({
                reentry:candidate.ramp.index,
                distanceM:candidate.distance,
                weight:weights[i],
                durationS:estimatedOutsideSeconds(ramp,candidate.ramp),
                junction:candidate.junction
              }));
              const plan={terminal:ramp.index,reentry:entries[0].reentry,
                durationS:entries[0].durationS,entries,
                closureId:obstacle.spec.id,kind:obstacle.spec.kind};
              exitDetours.set(first.index,plan);
              // Keep an existing exit's intended downstream destination if
              // its source closure finishes while the vehicle is on the ramp.
              terminalDetours.set(ramp.index,plan);
            }else if(successors.length&&successors.every(x=>x.kind==="ramp")){
              for(const next of successors)pending.push(next);
            }
          }
        }
      }
    }
  }
  function step(dt=5,refreshSpeeds=true){
    if(!finite(dt)||dt<=0||dt>15)throw Error("Ungültiger Simulationstakt");
    updateEffects();
    buildDetourPlans();
    const anyClosureActive=[...activeEffects.values()].some(items=>
      items.some(item=>item.event.kind==="closure"));
    enteredStep.fill(0);departedStep.fill(0);
    for(let j=0;j<edges.length;j++){
      const edge=edges[j],n=edge.n,stock=edge.stock;
      const s=send[j],r=receive[j],d=delta[j];
      d.fill(0);divertDelta[j].fill(0);
      // w=32 km/h keeps the receiving branch consistent with 2200 Kfz/h/lane:
      // 22 km/h would cap free-flow receiving below the user-defined capacity.
      const wave=Math.min(1,(22/3.6)*dt/edge.cellLength);
      const effects=activeEffects.get(edge.id)||NO_EFFECTS;
      for(let k=0;k<n;k++){
        const a=k*edge.cellLength,b=(k+1)*edge.cellLength;
        const local=effects.length?
          effects.filter(e=>e.fromM<b-.001&&e.toM>a+.001):NO_EFFECTS;
        const closed=new Set(),incidentClosed=new Set();
        let shoulderOpen=false,shoulderBlocked=false,blockedAtGate=false;
        let permitted=edge.freeKmh;
        for(const item of local){
          const ev=item.event;
          for(const lane of ev.closedLanes){
            closed.add(lane);
            // A road closure bans new arrivals. A distinct crash/worksite
            // may physically block cars already within that road section.
            if(ev.kind!=="closure")incidentClosed.add(lane);
          }
          if(ev.shoulder==="open"&&ev.hasShoulder)shoulderOpen=true;
          if(ev.shoulder==="blocked")shoulderBlocked=true;
          if(ev.speedKmh>0)permitted=Math.min(permitted,ev.speedKmh);
          // Administrative closures block new arrivals across the precise
          // boundary. They must NOT block the receiving room for vehicles
          // already inside that same closure (including closed feeder ramps).
          // Real full-width incidents still block the physical cell gate.
          if(ev.kind!=="closure"&&ev.closedLanes.length===edge.lanes&&
            ev.shoulder!=="open"&&item.gate&&
            item.fromM>=a-.001&&item.fromM<b+.001)
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
        // Discharge hysteresis: closely spaced queued vehicles require
        // reaction/headway time after braking. Avoid a one-tick jump from a
        // standstill queue to full free-flow service after event removal.
        // 5–10% loss is a model assumption, not a measured regional factor.
        const density=stock[k]/Math.max(.001,edge.jamPerCell);
        const restartFactor=density>.60?.90:density>.42?.95:1;
        const cap=open*edge.capacityPerLane*restriction*restartFactor*dt/3600;
        const moving=Math.min(1,(permitted/3.6)*dt/edge.cellLength);
        // Block receiving at the first closure cell, but let already-present
        // vehicles discharge through the closed section's downstream cells.
        const evacuating=local.some(x=>x.event.kind==="closure");
        // Cars within a road closure may leave on surviving physical lanes.
        // BUT a separate full-width accident remains a real obstacle even
        // if a road closure covers the same OSM cell. Never turn an accident
        // into a harmless "evacuation" gate and silently pass cars through.
        const openIncident=Math.max(0,edge.lanes-incidentClosed.size+
          Number(shoulderOpen));
        const accident=local.some(x=>x.event.kind==="accident");
        const worksite=local.some(x=>x.event.kind==="roadworks");
        const incidentFactor=incidentClosed.size>0?
          (accident?(openIncident===1?.69:.79):
            worksite?(openIncident===1?.80:.90):.87):1;
        const transferCapacity=evacuating?
          openIncident*edge.capacityPerLane*incidentFactor*restartFactor*dt/3600:cap;
        s[k]=Math.min(stock[k],transferCapacity,stock[k]*moving);
        const room=Math.max(0,edge.jamPerCell-stock[k]);
        r[k]=blockedAtGate?0:Math.min(room,transferCapacity,room*wave);
      }
    }
    // One simultaneous allocation for every motorway cell face and OSM
    // connector. Ramp merges compete with the mainline for REAL receiving
    // space, while exit splits share the originating cell's sending capacity.
    // This fixes mid-Way motorway junctions without creating new road geometry.
    const proposed=new Map(),splitSources=[],boundaryUsed=new Map();
    const push=(to,toCell,from,fromCell,want,mark=false)=>{
      const key=to+":"+toCell,arr=proposed.get(key)||[];
      arr.push({to,toCell,from,fromCell,want,mark});
      proposed.set(key,arr);
    };
    for(let j=0;j<edges.length;j++){
      const edge=edges[j],out=send[j];
      for(let k=0;k<edge.n;k++){
        const available=out[k];
        if(available<=0)continue;
        let options=[];
        // Never cross from an unclosed cell into a newly closed physical
        // interval of this same long OSM Way. Receiving inside the closure
        // remains available exclusively for pre-existing interior vehicles.
        const crossesClosureGate=(activeEffects.get(edge.id)||NO_EFFECTS)
          .some(x=>x.event.kind==="closure"&&x.gate&&
            x.fromM>k*edge.cellLength+.001&&
            x.fromM<=(k+1)*edge.cellLength+.001);
        if(k<edge.n-1&&receive[j][k+1]>0&&!crossesClosureGate)
          options.push({to:j,toCell:k+1,weight:20});
        const legalTurns=edge.linksFrom[k].filter(link=>
          !blockedMovement(edge,link));
        for(const link of legalTurns){
          if(receive[link.to][link.toCell]>0)options.push({...link});
        }
        // External map continuation is open only when a real motorway
        // is not modelled beyond this location. Never turn it into a jam.
        const outsideWeight=k===edge.n-1&&boundaryExit[j]?
          (edge.kind==="mainline"?20:1):0;
        // A full motorway closure is a HARD route exclusion: on an upstream
        // junction, all demand must take one of the legal escape turns. The
        // previous 7-90% ramp split sent residual traffic into the barrier.
        // A saturated exit is still a valid destination: motorists must queue
        // for its receiving capacity, not skip past it into the closure.
        let hasLegalClosureDetour=false,diversionIntent=0;
        if(edge.kind==="mainline"&&legalTurns.some(link=>
          edges[link.to].kind==="ramp"||
          edges[link.to].kind==="mainline"&&edges[link.to].ref!==edge.ref)){
          const distance=anyClosureActive?
            closureDistanceAhead(edge,k*edge.cellLength,16000):Infinity;
          // Avoid expensive downstream route searches when there is no
          // closure nearby and less than 45 min measured delay.
          // At a last Autobahn-to-Autobahn split, keep the OPEN direction
          // active and reroute only the proportion whose real continuation
          // enters the closed one. Earlier same-ref mainline exits can absorb
          // that diversion before vehicles reach the terminal interchange.
          const closureShare=Number.isFinite(distance)?1:
            anyClosureActive?closureExposureAhead(edge,k*edge.cellLength):0;
          const share=Math.max(closureShare,
            diversionShare(measuredDelayAhead(edge,k*edge.cellLength)));
          if(share>0){
            const alternatives=legalTurns.filter(link=>{
              const target=edges[link.to];
              return (target.kind==="ramp"||
                target.kind==="mainline"&&target.ref!==edge.ref)&&
                isUsableEscape(edge,link);
            });
          if(alternatives.length){
            hasLegalClosureDetour=Number.isFinite(distance);
            diversionIntent=share;
            const alternateKey=new Set(alternatives.map(link=>
              link.to+":"+link.toCell));
            const rawExitWeight=alternatives.reduce((n,link)=>n+link.weight,0);
            const oldExitShare=rawExitWeight/(20+rawExitWeight);
            const targetShare=oldExitShare+(1-oldExitShare)*share;
            // In a full closure every open exit/other motorway is eligible,
            // including a currently saturated turn. For merely long delays,
            // normal receiving-limited choices remain in play.
            options=share===1?alternatives.map(link=>({...link})):
              options.concat(alternatives.filter(link=>
                receive[link.to][link.toCell]<=0).map(link=>({...link})));
            if(share===1){
              // No through movement is legal beyond this last usable exit.
              for(const turn of options)turn.weight=Math.max(.001,turn.weight);
            }else{
              for(const opt of options){
                const isExit=alternateKey.has(opt.to+":"+opt.toCell);
                opt.weight=isExit?(targetShare*20)*opt.weight/Math.max(.001,rawExitWeight):
                  opt.to===j?(1-targetShare)*20:opt.weight*(1-share);
              }
            }
          }
          }
        }
        // Only tag newly diverted exit traffic when its real OSM ramp is
        // connected to a verified downstream on-ramp return. Ordinary exits
        // are counted as trips ending outside this motorway extract.
        for(const opt of options)
          if(opt.to!==j&&diversionIntent>0&&exitDetours.has(opt.to))
            opt.mark=true;
        if(!options.length&&!outsideWeight)continue;
        if(options.length>1&&hasLegalClosureDetour)
          splitSources.push({from:j,cell:k,available,options});
        const sum=options.reduce((n,x)=>n+x.weight,0)+outsideWeight;
        for(const opt of options)
          push(opt.to,opt.toCell,j,k,available*opt.weight/sum,opt.mark===true);
        if(outsideWeight){
          const leaving=available*outsideWeight/sum;
          delta[j][k]-=leaving;
          departedStep[j]+=leaving;
          // Tag accounting follows exactly the exiting subflow. No vehicle
          // is re-created at an on-ramp: the same fraction stays conserved
          // in the off-network travel inventory until reaching it.
          const tagged=edge.stock[k]>1e-9?
            Math.min(leaving,leaving*edge.divertStock[k]/edge.stock[k]):0;
          divertDelta[j][k]-=tagged;
          const plan=terminalDetours.get(j);
          const rerouted=plan?tagged:0;
          exited+=leaving-rerouted;
          if(rerouted>0){
            outsideVehicles+=rerouted;detouredVehicles+=rerouted;
            for(const entry of plan.entries){
              const amount=rerouted*entry.weight;
              if(amount<=0)continue;
              const readyAt=Math.ceil((elapsed+dt+entry.durationS)/30)*30;
              const key=entry.reentry+":"+readyAt;
              const existing=detourBatchIndex.get(key);
              if(existing)existing.vehicles+=amount;
              else{
                const trip={reentry:entry.reentry,readyAt,vehicles:amount,key};
                detourTrips.push(trip);detourBatchIndex.set(key,trip);
              }
            }
          }
          const key=j+":"+k;
          boundaryUsed.set(key,(boundaryUsed.get(key)||0)+leaving);
        }
      }
    }
    const used=new Map(boundaryUsed),accepted=new Map();
    for(const requests of proposed.values()){
      const {to,toCell}=requests[0];
      const accepting=receive[to][toCell];
      const required=requests.reduce((sum,x)=>sum+x.want,0);
      const ratio=required>accepting?accepting/required:1;
      for(const req of requests){
        const amount=req.want*ratio;
        const fromEdge=edges[req.from],stock=fromEdge.stock[req.fromCell];
        const originallyTagged=stock>1e-9?
          amount*Math.min(1,fromEdge.divertStock[req.fromCell]/stock):0;
        divertDelta[req.from][req.fromCell]-=originallyTagged;
        divertDelta[to][toCell]+=req.mark?amount:originallyTagged;
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
    // Never route cars onto an exit merely because an accident/roadworks
    // reduces throughflow! That previously dumped up to 1500 Kfz/h down a
    // nearby ramp and ERASED the physical accident queue. Extra diversion
    // is allowed only when there is an active announced corridor closure.
    for(const split of (anyClosureActive?splitSources:[])){
      const fromKey=split.from+":"+split.cell;
      let remaining=split.available-(used.get(fromKey)||0);
      if(remaining<1e-6)continue;
      for(const opt of [...split.options].sort((a,b)=>b.weight-a.weight)){
        const toKey=opt.to+":"+opt.toCell;
        const spare=receive[opt.to][opt.toCell]-(accepted.get(toKey)||0);
        if(spare<=1e-6)continue;
        const moved=Math.min(remaining,spare);
        const sourceEdge=edges[split.from],old=sourceEdge.stock[split.cell];
        const originallyTagged=old>1e-9?
          moved*Math.min(1,sourceEdge.divertStock[split.cell]/old):0;
        divertDelta[split.from][split.cell]-=originallyTagged;
        divertDelta[opt.to][opt.toCell]+=opt.mark?moved:originallyTagged;
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
    // An off-network journey takes time. Only after that trip reaches its
    // due time may it rejoin through an existing directed OSM on-ramp,
    // subject to exactly the same physical receiving capacity as local cars.
    // An overloaded re-entry queues OFF the motorway, rather than teleporting
    // vehicles into full cells or multiplying the model inventory.
    for(let i=detourTrips.length-1;i>=0;i--){
      const trip=detourTrips[i];
      if(trip.readyAt>elapsed+dt)continue;
      const road=edges[trip.reentry];
      const closed=(activeEffects.get(road.id)||NO_EFFECTS).some(x=>
        x.event.kind==="closure"&&x.gate&&x.fromM<road.cellLength);
      if(closed)continue;
      const current=Math.max(0,delta[road.index][0]);
      const room=Math.max(0,receive[road.index][0]-current);
      const admitted=Math.min(trip.vehicles,room);
      if(admitted<=0)continue;
      delta[road.index][0]+=admitted;
      enteredStep[road.index]+=admitted;
      outsideVehicles-=admitted;returnedVehicles+=admitted;
      trip.vehicles-=admitted;
      if(trip.vehicles<1e-7){
        detourTrips.splice(i,1);detourBatchIndex.delete(trip.key);
      }
    }
    // Network boundaries were discharged as explicit movements above.
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
      const admitted=Math.min(available,
        Math.max(0,receive[j][0]-Math.max(0,delta[j][0])));
      delta[j][0]+=admitted;
      enteredStep[j]+=admitted;
      edge.backlog=Math.max(0,available-admitted);
    }
    const alpha=1-Math.exp(-dt/120);
    for(let j=0;j<edges.length;j++){
      const edge=edges[j],change=delta[j];
      for(let k=0;k<edge.n;k++){
        const before=edge.stock[k],sent=used.get(j+":"+k)||0;
        edge.cellThroughVph[k]+=alpha*(sent*3600/dt-edge.cellThroughVph[k]);
        if(before>=.8){
          const effectiveLength=Math.max(edge.cellLength,edge.freeKmh*dt/3.6);
          const observed=Math.min(edge.freeKmh,Math.max(0,
            sent*effectiveLength*3.6/(dt*before)));
          edge.cellFlowSpeeds[k]=.45*observed+.55*edge.cellFlowSpeeds[k];
        }else if(before<.3)edge.cellFlowSpeeds[k]=edge.freeKmh;
        const after=edge.stock[k]+change[k];
        if(after < -1e-7||after>edge.jamPerCell+1e-6)
          throw Error("Ungültiger Fahrzeugbestand auf "+edge.id);
        edge.stock[k]=Math.max(0,after);
        const diverted=edge.divertStock[k]+divertDelta[j][k];
        edge.divertStock[k]=Math.min(edge.stock[k],Math.max(0,diverted));
      }
      // 2-minute exponential flow meter for inspectable scenario plausibility.
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
  // Exact blocked access points for closure symbols. A closure can occupy
  // only an interval of a long motorway Way; do NOT mark every ramp feeding
  // the same Way outside that interval.
  function closureAccessPoints(){
    updateEffects();
    const points=[],seen=new Set();
    function add(edge,metre,id){
      const key=edge.id+":"+Math.round(metre/20);
      if(seen.has(key))return;
      seen.add(key);
      points.push({edgeId:edge.id,offsetM:Math.max(0,
        Math.min(edge.lengthM-.001,metre)),eventId:id});
    }
    for(const edge of edges){
      // Also mark an otherwise OPEN motorway that has one forbidden turn
      // into a closed corridor (e.g. A59 → A3 at Köln-Heumar). Never paint
      // the entire A59 red-white just because its A3 turn is closed.
      if(edge.kind!=="ramp"&&edge.kind!=="mainline")continue;
      if(edge.kind==="ramp"){
        const own=(activeEffects.get(edge.id)||NO_EFFECTS)
          .find(x=>x.derivedRampClosure||
            (x.event.kind==="closure"&&x.gate));
        if(own){
          // A ramp starts at its true physical fork. Only pin the gate at
          // the first blocked access from an OPEN approach, not at 70% of
          // every small ramp fragment (which looked like a mid-ramp barrier).
          const entering=incomingTurnEdges[edge.index];
          const openApproach=entering.some(from=>
            !(activeEffects.get(from.id)||NO_EFFECTS)
              .some(effect=>effect.event.id===own.event.id));
          if(openApproach||!entering.length)
            add(edge,Math.min(12,edge.lengthM*.015),own.event.id);
        }
      }
      for(const turn of edge.links){
        if(!blockedMovement(edge,turn))continue;
        const target=edges[turn.to];
        if(edge.kind==="mainline"&&target.ref===edge.ref)continue;
        // The blocked ramp already has a pin at its own physical entrance.
        // Do not put a second prohibition sign on the OPEN parent road.
        if(target.kind==="ramp"&&(activeEffects.get(target.id)||NO_EFFECTS)
          .some(x=>x.event.kind==="closure"&&x.fromM<.1))continue;
        const match=(activeEffects.get(target.id)||NO_EFFECTS)
          .find(x=>x.event.kind==="closure");
        if(match)add(edge,turn.fromM,match.event.id);
      }
    }
    return points;
  }
  function edgeActivity(id,offsetM=0){
    const edge=byId.get(id);
    if(!edge)return null;
    const count=edge.stock.reduce((sum,x)=>sum+x,0);
    const at=Math.max(0,Math.min(edge.n-1,Math.floor((Number(offsetM)||0)/edge.cellLength)));
    return {reachable:reachable.has(id),vehicles:count,
      sectionVph:edge.cellThroughVph[at],boundaryExit:boundaryExit[edge.index],
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
    recommendedClosureLength,closureAccessPoints,
    movementBlocked:(fromId,toId)=>{
      const from=byId.get(fromId);
      return !!from&&from.links.some(link=>edges[link.to].id===toId&&
        blockedMovement(from,link));
    },
    incomingCount:id=>byId.get(id)?.incoming??0,
    entryIncomingCount:id=>byId.get(id)?.incomingAtStart??0,
    sourceIds:()=>sources.map(x=>x.id),
    normalizedReversedWays:()=>[...reversedWays],
    migrateLegacyEvent,
    diversionShare,
    detourPlans:()=>[...exitDetours.values()].map(plan=>({
      terminalEdgeId:edges[plan.terminal].id,
      reentryEdgeId:edges[plan.reentry].id,
      delaySeconds:plan.durationS,closureId:plan.closureId,
      kind:plan.kind,
      reentries:plan.entries.map(entry=>({
        edgeId:edges[entry.reentry].id,weight:entry.weight,
        distanceM:entry.distanceM,delaySeconds:entry.durationS
      }))})),
    closureExposureAhead:(id,offsetM=0,maxDistance=25000)=>{
      const edge=byId.get(id);
      return edge?closureExposureAhead(edge,offsetM,maxDistance):0;
    },
    closureDistanceAhead:(id,offsetM=0,maxDistance=16000)=>{
      const edge=byId.get(id);
      return edge?closureDistanceAhead(edge,offsetM,maxDistance):Infinity;
    },
    sourceProfiles:()=>sources.map(edge=>({id:edge.id,ref:edge.ref,
      direction:edge.directionKey,peakVph:edge.referencePeakVph,
      kind:edge.kind,name:edge.name})),
    junctionCount:()=>linkKeys.size};
}
global.createLegacyTrafficScenario=createLegacyTrafficScenario;
})(window);
