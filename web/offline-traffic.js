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
// Legacy coordinate-only import assigned nearby AS names to service-road
// stubs. They are not motorway junctions, even if labelled "Abfahrt".
// Keep the through carriageways; omit these legacy OSM ways from graph AND map.
const LEGACY_SERVICE_WAYS=new Set([
  407503235,407503237,546687699,546687703, // Siegburg
  407502471,407502472,407502474,407502475, // Königsforst
  407505963,407505964,407505965,407505966, // Logebachtal
  407512342,407512344,407517109, // Epgert / rest facilities north of Neustadt
  30039941,31056168,384057209,384059762,1512535542,1512535543,
  1343420595,1343420596,1343420600,1343420601,92793838,381079143,
  288145297,118225174,303423552,647918374,
  150282076,718456776,168502894,535463201,535465039,535469311,
  407515692,407515693,5200961,8205921,23328071,27005343,
  384052261,384052268,384052273,384055828,
  38028821,38050873,372478868,372478869,536172766
]);
// Permanent regular mainline widths, independently confirmed against the
// Autobahn GmbH/DEGES project descriptions rather than current worksite lanes.
// A3 Siebengebirge–Bonn/Siegburg: three; shared A3/A4 Heumar–Köln-Ost
// and A3 north of Köln-Ost in this extract: four per direction.
// Exact existing directed OSM Way IDs only; ramps and other roads unchanged.
// Re-audit these IDs when the network is re-imported after permanent rebuilding.
const BASELINE_THREE_WAYS=new Set([
  88004925,37264385,992482669,992482670,25404897,620672136,840177199,
  840177198,992482934,992482935,140575546,840177202,840177203,423654340,
  992483386,223297045,
  // A3 Leverkusen-Zentrum–AK Leverkusen: existing three through lanes.
  992501211,500374477,133846788,29696292,29233698,206721974,34565957,
  34565958,832594830,4008345,302370861,34565943,206716762,206716772,
  992501341,992501342,35554439,126500245,206721982,499192038,29696291,
  29696290,499192039,133850006,206721976,1074482670,34565955,832672648,
  22609448,22609434,34565946,34565945,126500248,227223960,206719014,
  569020230,332121766,
]);
const BASELINE_FOUR_WAYS=new Set([
  132614469,886737506,886737507,753473363,753473366,312198258,132624375,
  258491549,258491543,318531282,281774000,258495162,258491542,258491546,
  132624368,315647742,992498412,992498413,258503935,258503936,193706950,
  208913376,132624378,132624384,992498533,206716755,206716768,258495161,
  258495159,281773996,26164974,281774006,208913378,132624381,132624387,
  132624371,132624372,315647743,315647744,
  // Completed eight-lane A3 expansion south of Leverkusen-Zentrum.
  133860389,495004583,495004582,53051821,202731875,59398939,281773974,
  26493583,560386360,560386359,26493553,59398945,439070856,439070854,
  281773979,992499532,37264395,254185383,992499592,29233696,281773984,
  992499787,992499788,832600847,494773279,558843792,558843791,335801527,
  133846420,133846790,992500089,992500090,328957437,133846419,992501210,
  1021881383,992498579,992498822,992498821,132624386,133849585,133749201,
  281773982,26493584,26493574,560386357,560386358,26493445,281773977,
  439070855,126500247,992499195,992499194,133749600,281773993,281773987,
  499192035,335801530,335801529,558843797,558843793,29550391,133749601,
  499192037,992500497,298236763,133849780,992501240,992501239,
]);
const verifiedBaselineLanes=way=>BASELINE_FOUR_WAYS.has(way)?4:BASELINE_THREE_WAYS.has(way)?3:null;
const isLegacyService=row=>row[1]==="ramp"&&(REST.test(row[5]||"")||
  LEGACY_SERVICE_WAYS.has(Number(row[6])));
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
const clamp01=x=>Math.max(0,Math.min(1,x));
// Aggregate heterogeneity: mean desired speed falls as gaps shrink and
// overtaking becomes harder. The nominal lane service is only an upper bound.
// Calibrate these coefficients against counts/speeds, not against a jam label.
function trafficOperatingState(density,merge=0,mainline=true){
  const interactions=clamp01((density-.055)/.19);
  const pressure=clamp01((density-.10)/.23);
  return {speedFactor:1-(mainline?.24:.14)*interactions,
    // Limit duplicated headway losses. Density, restart and braking memory
    // together must not multiply a moving queue into an artificial roadblock.
    capacityFactor:1-.065*interactions-.045*pressure-.17*merge*interactions};
}
// Empirical backward jam-front velocities on German freeways are around
// 15–20 km/h. Retain the free-flow receiving capacity; only dense traffic
// approaches the calibrated 18 km/h congested branch.
const receivingWave=(density,mainline)=>mainline?22-4*clamp01((density-.25)/.30):22;
// Delayed recovery of discharge headway after real braking. Driven by the
// measured traffic state, not a clock/random pattern painted on the map.
function brakingMemory(previous,density,speed,free,dt){
  const pressure=clamp01((density-.28)/.35)*clamp01((.70-speed/free)/.55);
  const tau=pressure>previous?12:45;
  return previous+(pressure-previous)*(1-Math.exp(-dt/tau));
}
// Verified OSM tags and local-road entrance nodes (2026-11-15).
// The coordinate-only legacy snapshot discarded oneway=no and entry labels.
// These are data corrections, not junction-specific closure rules.
const LEGACY_RAMP_METADATA={
  twoWay:[455315441,455315447],
  entries:[
    {way:142169746,node:160086,ref:"A4",label:"A4 AS 11b Köln-Eifeltor · Auffahrt auf A4 → Aachen"},
    {way:71505392,node:850614817,ref:"A4",label:"A4 AS 11a Köln-Klettenberg · Auffahrt auf A4 → Aachen"}
  ]
};
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
  // The old geometry snapshot stored one coordinate sequence per OSM Way,
  // including two-way motorway_links. Recover only directions and local
  // entrance provenance explicitly verified against OSM tags/nodes.
  const metadata=data.rampMetadata||(data===global.STAU_LEGACY_GEOMETRY?
    LEGACY_RAMP_METADATA:null);
  const verifiedEntries=new Map((metadata?.entries||[]).map(e=>[e.way,e]));
  if(metadata&&!data._rampDirectionsExpanded){
    const twoWay=new Set(metadata.twoWay||[]),reverse=[];
    for(const row of data.roads){
      if(row[1]!=="ramp")continue;
      const entry=verifiedEntries.get(row[6]);
      if(entry){row[2]=entry.ref;row[5]=entry.label;}
      if(!twoWay.has(row[6]))continue;
      const lanes=Math.max(1,Math.floor((Number(row[3])||2)/2));
      row[3]=lanes;row[8]="two-way";
      reverse.push([row[0]+":reverse",row[1],row[2],lanes,[...row[4]].reverse(),
        row[5]+" · Gegenrichtung",row[6],row[7],"two-way"]);
    }
    data.roads.push(...reverse);
    Object.defineProperty(data,"_rampDirectionsExpanded",{value:true,configurable:true});
  }
  // Four imported motorway carriageways carry a readable motorway ID in
  // their road NAME but a blank OSM 'ref' (e.g. A560, A559). Do not strand
  // them outside the same generic AS-to-AS closure algorithm. Only infer a
  // missing mainline ref when the signed ID is also corroborated by the
  // imported junction catalog; never invent a ref from geographic proximity.
  const knownRefs=new Set((data.junctions||[]).map(j=>j[0]));
  for(const row of data.roads){
    if(row[1]!=="mainline"||row[2])continue;
    const match=/^A\d{1,3}\b/.exec(String(row[5]||""));
    if(match&&knownRefs.has(match[0]))row[2]=match[0];
  }
  const reversedWays=orientExistingMotorwayChains(data);
  // Permanent lane corrections are applied before building cells, capacities,
  // demand and the event editor. The imported snapshot itself stays intact on disk.
  for(const row of data.roads){
    if(row[1]!=="mainline"||row[2]!=="A3")continue;
    const baseline=verifiedBaselineLanes(Number(row[6]));
    if(baseline!==null)row[3]=baseline;
  }
  // The compact snapshot includes auxiliary merge/diverge lanes in OSM
  // lanes. A short N+1 island bounded by N through lanes on the same
  // directed carriageway is treated as auxiliary, not extra freeway capacity.
  // Keep longer genuine widenings and ambiguous branches unchanged.
  if(!data._throughLanesNormalized){
    const starts=new Map(),ends=new Map(),roads=data.roads.filter(r=>r[1]==="mainline"&&r[2]&&r[4]?.length>1);
    const index=(map,key,row)=>{const list=map.get(key)||[];list.push(row);map.set(key,list);};
    const key=(row,point)=>row[2]+":"+coord(point);
    for(const r of roads){index(starts,key(r,r[4][0]),r);index(ends,key(r,r[4].at(-1)),r);}
    const corrections=new Map();
    for(const r of roads){
      const before=ends.get(key(r,r[4][0]))||[];
      if(before.length!==1||Number(before[0][3])!==Number(r[3])-1)continue;
      const island=[];let now=r,total=0;
      while(now&&now[3]===r[3]&&!island.includes(now)&&total<=900){
        island.push(now);total+=lengthM(now[4]);
        const next=starts.get(key(now,now[4].at(-1)))||[];
        now=next.length===1?next[0]:null;
      }
      if(now&&Number(now[3])===Number(r[3])-1&&total<=900)
        for(const part of island)corrections.set(part,Number(r[3])-1);
    }
    for(const [row,lanes] of corrections){
      if(row[2]==="A3"&&verifiedBaselineLanes(Number(row[6]))!==null)continue;
      row[3]=lanes;
    }
    Object.defineProperty(data,"_throughLanesNormalized",{value:true,configurable:true});
  }
  const edges=[],outByNode=new Map(),inByNode=new Map(),byId=new Map();
  const rowById=new Map(data.roads.map(row=>[String(row[0]),row]));
  const NO_EFFECTS=Object.freeze([]);
  const NO_LANES=new Set(); // read-only shared empty set for unrestricted cells
  const traffic=global.StauTrafficReference;
  if(!traffic)throw Error("traffic-reference.js fehlt vor offline-traffic.js");
  let excludedRest=0;
  for(const row of data.roads){
    if(!Array.isArray(row[4])||row[4].length<2)continue;
    if(isLegacyService(row)){excludedRest++;continue;}
    // The old import also synthesized an A3 U-turn at Rösrath by cutting
    // the real exit Way 5217076 in half. The original exit is retained;
    // the duplicate ends in the middle of it and cannot serve any traffic.
    if(row[0]==="extra-turn-A3-frankfurt-to-A3-koeln-5217076"&&
      rowById.has("extra-heumar-5217076"))continue;
    const id=String(row[0]),lanes=Math.max(1,Math.min(6,Math.floor(Number(row[3])||1)));
    const meters=lengthM(row[4]);
    if(meters<0.2||byId.has(id))continue;
    const count=Math.max(1,Math.ceil(meters/230));
    const edge={
      id,kind:row[1],ref:row[2],name:row[5]||"",lanes,
      twoWay:row[8]==="two-way",osm:row[6],
       shoulderTag:row[7]||null,
      from:coord(row[4][0]),to:coord(row[4].at(-1)),
      first:row[4][0],lengthM:meters,
      n:count,cellLength:meters/count,
      stock:new Float64Array(count),
      entryStock:new Float64Array(count), // local road -> motorway, not a diverted exit trip
      // A tagged subflow of real cell occupancy: vehicles committed to an
      // actual open off-ramp and its verified downstream model on-ramp.
      divertStock:new Float64Array(count),
      // Sparse destination cohorts: a diverted motorway-transfer vehicle
      // must keep its actual exit even at later motorway/ramp forks.
      routeStock:Array(count).fill(null),
      // Ordinary destination commitments at a physical fork. Cars waiting
      // for a full exit do not get a new random destination every tick.
      turnStock:Array(count).fill(null),
      voluntaryWaiting:Array(count).fill(null),
      bypassStock:new Float64Array(count),
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
      // Rolling vehicle-distance / vehicle-time speed. A momentary stopped
      // pulse is not the traversal speed of an entire stop-and-go queue.
      cellSpeedMovement:new Float64Array(count),cellSpeedExposure:new Float64Array(count),
      branchSpeed:new Float64Array(count).fill(row[1]==="ramp"?75:120),
      branchMovement:new Float64Array(count),branchExposure:new Float64Array(count),
      brakeMemory:new Float64Array(count),
      platoonProgress:new Float64Array(count),
      // Two-minute actual throughput per cell, including internal merges.
      cellThroughVph:new Float64Array(count),
      cellIncomingVph:new Float64Array(count),
      cellMotion:new Float64Array(count),
      cellCapacityVph:new Float64Array(count).fill(lanes*(row[1]==="ramp"?1500:2200)),
      cellReceivingVph:new Float64Array(count).fill(lanes*(row[1]==="ramp"?1500:2200)),
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
  const mappedLocalBoundaries=new Set((data.localRampBoundaryNodes||[]).map(coord));
  function connect(from,to,fromM,toM){
    if(from.index===to.index)return;
    // Exact motorway_link endpoints on an actual public street are the
    // interface to the local network. Do not circulate vehicles around a
    // cropped ramp roundabout or silently join the opposite carriageway.
    if(from.kind==="ramp"&&to.kind==="ramp"&&
      fromM>=from.lengthM-.01&&toM<.01&&mappedLocalBoundaries.has(from.to)&&
      /\bAS\b/.test(from.name)&&/\bAS\b/.test(to.name)&&
      // A signed entrance can include a slip lane touching the public
      // road before the common on-ramp (e.g. Dellbrück B506). Preserve the
      // real directed entrance chain, but not a local exit-to-entry loop.
      !(/· Auffahrt\b/.test(from.name)&&/· Auffahrt\b/.test(to.name)&&
        from.name.split(" · ")[0]===to.name.split(" · ")[0]))return;
    // Compact OSM data often omits the public road between the two ramps.
    // A same-AS exit ending exactly at an entrance is a local-road boundary,
    // not an automatic U-shaped path that rejoins the congested motorway.
    if(from.kind==="ramp"&&to.kind==="ramp"&&
      /\bAS\b.*· Abfahrt/i.test(from.name)&&/\bAS\b.*· Auffahrt/i.test(to.name)&&
      from.name.split(" · ")[0]===to.name.split(" · ")[0]&&
      fromM>=from.lengthM-.01&&toM<.01)return;
    // A bidirectional connector is not a U-turn at either of its ends.
    if(from.twoWay&&to.twoWay&&from.osm===to.osm)return;
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
      // A real direct connection from another motorway is not an external
      // source simply because the route number changes at the junction.
      if(from.kind==="mainline"&&to.kind==="mainline")
        to.mainlineIncomingAtStart++;
    }
    // Preserve end-to-start successors for long-event tracing and old API.
    if(fromCell===from.n-1&&toCell===0&&fromM>=from.lengthM-.01&&toM<.01)
      from.next.push({...link});
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
      if(dest.first||downstream.kind==="mainline"||
        edge.kind==="ramp"&&downstream.kind==="ramp"&&
        /· Auffahrt\b/.test(edge.name)&&(
          /· Auffahrt\b/.test(downstream.name)&&edge.name.split(" · ")[0]===downstream.name.split(" · ")[0]||
          /\bAS\b/.test(edge.name)&&/^AK\b/.test(downstream.name)))
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
  // A motorway-only extract may retain a local roundabout as motorway_link
  // fragments but omit the public road leaving it. Such a closed ramp cycle
  // is a public-road boundary, not a motorway destination. Cut the incoming
  // approach at the actual roundabout entry, without inventing any geometry.
  // Detect this structurally for all named AS, never at motorway AK/AD loops.
  const localRoundaboutBoundaries=new Set();
  const rampJunction=e=>e.name.split(" · ")[0].trim();
  const localRoundaboutRamp=e=>e.kind==="ramp"&&/\bAS\b/i.test(rampJunction(e))&&
    !/\b(?:AK|AD|Autobahnkreuz|Autobahndreieck)\b/i.test(rampJunction(e));
  const closedRampCycles=new Set(),cycleIndex=new Map(),cycleLow=new Map();
  const cycleStack=[],cycleOnStack=new Set();let cycleSerial=0;
  function findLocalCycle(e){
    const index=cycleSerial++;cycleIndex.set(e.index,index);cycleLow.set(e.index,index);
    cycleStack.push(e);cycleOnStack.add(e.index);
    for(const t of e.links){
      const next=edges[t.to];
      if(!localRoundaboutRamp(next)||rampJunction(e)!==rampJunction(next))continue;
      if(!cycleIndex.has(next.index)){
        findLocalCycle(next);cycleLow.set(e.index,Math.min(cycleLow.get(e.index),cycleLow.get(next.index)));
      }else if(cycleOnStack.has(next.index))
        cycleLow.set(e.index,Math.min(cycleLow.get(e.index),cycleIndex.get(next.index)));
    }
    if(cycleLow.get(e.index)!==index)return;
    const component=[];let member;
    do{member=cycleStack.pop();cycleOnStack.delete(member.index);component.push(member);}while(member!==e);
    const members=new Set(component.map(x=>x.index));
    if(component.length>=2&&component.every(x=>x.links.length&&x.links.every(t=>members.has(t.to))))
      for(const x of component)closedRampCycles.add(x.index);
  }
  for(const e of edges)if(localRoundaboutRamp(e)&&!cycleIndex.has(e.index))findLocalCycle(e);
  // Only sever an exclusive ingress reachable from a genuine motorway exit.
  // The roundabout and approach remain visible on the original OSM map.
  const exitReachable=new Set(),exitWork=edges.filter(e=>localRoundaboutRamp(e)&&/· Abfahrt\b/i.test(e.name));
  for(let i=0;i<exitWork.length;i++){
    const e=exitWork[i];if(exitReachable.has(e.index))continue;
    exitReachable.add(e.index);
    for(const t of e.links){const target=edges[t.to];
      if(localRoundaboutRamp(target)&&rampJunction(target)===rampJunction(e)&&
        !/· Auffahrt\b/i.test(target.name))exitWork.push(target);
    }
  }
  function terminateLocalApproach(e){
    for(const t of e.links){const target=edges[t.to];target.incoming--;
      if(t.toM<.01)target.incomingAtStart--;
    }
    e.links.length=0;e.next.length=0;for(const links of e.linksFrom)links.length=0;
  }
  for(const e of edges){
    if(!exitReachable.has(e.index)||closedRampCycles.has(e.index)||!e.links.length||
      !e.links.every(t=>closedRampCycles.has(t.to)&&t.fromM>=e.lengthM-.1&&
        rampJunction(edges[t.to])===rampJunction(e)))continue;
    localRoundaboutBoundaries.add(e.index);terminateLocalApproach(e);
  }
  // Another incomplete local extract can join the exit to its own on-ramp
  // through unnamed ramp fragments, omitting the public-road intersection.
  // Apply the same existing exit/entrance boundary rule across those
  // fragments, ONLY when the signed off-ramp has no other real local sink
  // and every remaining path leads to a named entrance at the same AS.
  for(const exit of exitWork){
    if(!/· Abfahrt\b/i.test(exit.name))continue;
    const pending=[exit],seen=new Set(),boundaries=new Set();let invalid=false;
    for(let i=0;i<pending.length&&!invalid;i++){
      const e=pending[i];if(seen.has(e.index))continue;seen.add(e.index);
      if(!e.links.length){invalid=true;break;} // existing real local exit
      const allEntrance=e.links.every(t=>{
        const target=edges[t.to];return localRoundaboutRamp(target)&&rampJunction(target)===rampJunction(exit)&&
          /· Auffahrt\b/i.test(target.name)&&t.fromM>=e.lengthM-.1&&t.toM<.01;
      });
      if(allEntrance){boundaries.add(e);continue;}
      for(const t of e.links){const target=edges[t.to];
        if(!localRoundaboutRamp(target)||rampJunction(target)!==rampJunction(exit)||/· Auffahrt\b/i.test(target.name)){
          invalid=true;break;
        }
        pending.push(target);
      }
    }
    if(!invalid&&boundaries.size)for(const e of boundaries)terminateLocalApproach(e);
  }
  // Some imported motorway_link fragments form closed, non-motorway
  // components (e.g. two-way connector stubs at a motorway cross). They
  // are neither public-road exits nor viable motorway destinations.
  // Find every ramp with a directed path to an actual downstream motorway
  // or open map boundary. A positive turn weight into a sealed component
  // would eventually fill it, then block otherwise unobstructed motorways.
  // Preserve the geometry and legitimate AS roundabout boundaries above.
  const rampPredecessors=edges.map(()=>[]),viableRampPath=new Set(),rampWork=[];
  for(const e of edges){
    if(e.kind==="mainline"||!e.links.some(t=>t.fromM>=e.lengthM-.1)){
      viableRampPath.add(e.index);rampWork.push(e);
    }
    for(const t of e.links)if(e.kind==="ramp")rampPredecessors[t.to].push(e);
  }
  for(let i=0;i<rampWork.length;i++)for(const e of rampPredecessors[rampWork[i].index]){
    if(viableRampPath.has(e.index))continue;
    viableRampPath.add(e.index);rampWork.push(e);
  }
  let excludedTrapMovements=0;
  for(const e of edges){
    if(!viableRampPath.has(e.index))continue;
    const rejected=e.links.filter(t=>!viableRampPath.has(t.to));
    if(!rejected.length)continue;
    excludedTrapMovements+=rejected.length;
    for(const t of rejected){
      const target=edges[t.to];target.incoming--;
      if(t.toM<.01)target.incomingAtStart--;
    }
    const allowed=t=>viableRampPath.has(t.to);
    e.links=e.links.filter(allowed);e.next=e.next.filter(allowed);
    for(let k=0;k<e.n;k++)e.linksFrom[k]=e.linksFrom[k].filter(allowed);
  }
  // The current extract cuts the A61 at AK Koblenz: these are existing
  // directed OSM ramp ends at the network boundary, NOT local AS ramps.
  const externalA61Inputs=new Set([28527065,28527071,4854594]);
  const externalA61Outputs=new Set([312834616,210611616,210612014]);
  const isA61Boundary=edge=>edge?.ref==="A61"&&/AK Koblenz/.test(edge.name);
  for(const edge of edges)if(isA61Boundary(edge)&&externalA61Outputs.has(edge.osm)&&!edge.links.length)
    edge.externalDetourDestination=true;
  // Uniform baseline for motorway transfers: distinguish actual directed
  // motorway connections from local exits, using their narrowest lane count.
  // These are fallback destination estimates, not prescribed diversion shares
  // or measured OD flows. Never assign a turn percentage by interchange ID.
  function transferWidth(first,originRef){
    const queue=[{edge:first,width:first.lanes}],seen=new Map();
    let width=0;
    for(let i=0;i<queue.length;i++){
      const {edge,width:available}=queue[i];
      if((seen.get(edge.index)||0)>=available)continue;
      seen.set(edge.index,available);
      if(edge.externalDetourDestination&&edge.ref!==originRef)
        width=Math.max(width,available);
      for(const turn of edge.links){
        const next=edges[turn.to],lanes=Math.min(available,next.lanes);
        if(next.kind==="mainline"){
          if(next.ref!==originRef)width=Math.max(width,lanes);
        }else if(next.kind==="ramp")queue.push({edge:next,width:lanes});
      }
    }
    return width;
  }
  for(const road of edges)if(road.kind==="mainline")for(const link of road.links){
    const target=edges[link.to];
    if(target.kind!=="ramp")continue;
    const width=transferWidth(target,road.ref);
    if(!width)continue;
    link.weight=(isA61Boundary(target)&&road.ref==="A48"?8:3.5)*width;
    const successor=road.next.find(x=>x.to===link.to);
    if(successor)successor.weight=link.weight;
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
  const sources=[],componentSeen=new Set(),directedCorridorIds=new Map(),corridorLengths=new Map();
  let sourceComponents=0,unservedComponents=0;
  // An interchange-fed motorway start is not an external demand boundary.
  // Trace real motorway traffic through ramp chains (not local AS origins).
  // Otherwise a full reference peak is added on top of every feeder flow.
  const motorwayFedRamps=new Set(),transferWork=edges.filter(e=>e.kind==="mainline");
  for(let i=0;i<transferWork.length;i++)for(const t of transferWork[i].links){
    const target=edges[t.to];
    if(target.kind!=="ramp"||motorwayFedRamps.has(target.index)||
      /\bAS\b.*· (?:Abfahrt|Auffahrt)/i.test(target.name))continue;
    motorwayFedRamps.add(target.index);transferWork.push(target);
  }
  const transferFedStarts=new Set();
  for(const i of motorwayFedRamps)for(const t of edges[i].links)
    if(edges[t.to].kind==="mainline"&&t.toM<.01)transferFedStarts.add(t.to);
  for(const first of edges){
    if(first.kind!=="mainline"||componentSeen.has(first.index))continue;
    const component=[],stack=[first.index];
    while(stack.length){
      const id=stack.pop();
      if(componentSeen.has(id))continue;
      componentSeen.add(id);component.push(edges[id]);directedCorridorIds.set(id,first.index);
      for(const neighbor of motorwayNeighbors.get(id)||[])
        if(!componentSeen.has(neighbor))stack.push(neighbor);
    }
    const totalLength=component.reduce((sum,edge)=>sum+edge.lengthM,0);
    corridorLengths.set(first.index,totalLength);
    // A short disconnected ramp/Way fragment must NOT get a full motorway
    // source. But a real map-cut motorway >= 1.5 km must receive arrivals.
    if(totalLength<1500)continue;
    const possible=component.filter(edge=>!edge.mainlineIncomingAtStart&&!transferFedStarts.has(edge.index))
      .map(edge=>({edge,profile:traffic.referenceForRoad(rowById.get(edge.id))}))
      .filter(x=>x.profile.peakVph>0);
    if(!possible.length){
      if(!component.some(edge=>transferFedStarts.has(edge.index)))unservedComponents++;
      continue;
    }
    possible.sort((a,b)=>upstreamRank(b.edge,b.profile.key)-upstreamRank(a.edge,a.profile.key)
      ||b.edge.lengthM-a.edge.lengthM);
    const {edge,profile}=possible[0];
    edge.source=true;edge.referencePeakVph=profile.peakVph;
    // Real map boundaries at the Gelsdorf/B257 and west A48 cuts carry
    // only their own traffic, not the full downstream motorway peak.
    if(edge.id==="A565-16799872")edge.referencePeakVph=650;
    if(edge.id==="A48-824372860")edge.referencePeakVph=1900;
    edge.directionKey=profile.key;sources.push(edge);sourceComponents++;
  }
  const distinctOnramps=new Map();
  function rampMainlineArrivals(start,allow=()=>true){
    const pending=[start],seen=new Set(),arrivals=[];
    for(let i=0;i<pending.length;i++){
      const ramp=pending[i];if(seen.has(ramp.id))continue;seen.add(ramp.id);
      for(const turn of ramp.links){
        if(!allow(ramp,turn))continue;
        const target=edges[turn.to];
        if(target.kind==="mainline")arrivals.push({road:target,metre:turn.toM});
        else if(target.kind==="ramp"&&!seen.has(target.id))pending.push(target);
      }
    }
    return arrivals;
  }
  const junctionLabel=edge=>edge.name.split(" · ")[0].trim();
  // A transfer at AK/AD is not a public-road entrance, even if the
  // truncated OSM extract calls it "Auffahrt" or has no incoming Way.
  const isLocalEntrance=edge=>/\b(?:auffahrt|zufahrt)\b/i.test(edge.name)&&
    !/\b(?:AK|AD|Autobahnkreuz|Autobahndreieck)\b/i.test(junctionLabel(edge));
  const isLocalOrigin=edge=>isLocalEntrance(edge)||edge.localOrigin===true;
  // A coordinate-only extract frequently starts an on-ramp at a small
  // unnamed branch of the public road, not at the signed motorway merge.
  // Recognize roots by exact directed connectivity to that AS's motorway;
  // never seed a disconnected exit, service stub or motorway interchange.
  const originLabel=edge=>{
    if(/\b(?:AK|AD|Autobahnkreuz|Autobahndreieck)\b/i.test(edge.name))return null;
    if(/· Abfahrt\b/i.test(edge.name))return null;
    if(/\bAS\b/i.test(junctionLabel(edge)))return junctionLabel(edge);
    const m=/\bnahe (A\d+) (\d+[a-z]?) (.+)$/i.exec(edge.name);
    return m?m[1]+" AS "+m[2]+" "+m[3]:null;
  };
  const corridorRepresentative=new Map();
  for(const road of edges)if(road.kind==="mainline"){
    const id=directedCorridorIds.get(road.index),old=corridorRepresentative.get(id);
    if(!old||road.source||!old.source&&road.lengthM>old.lengthM)corridorRepresentative.set(id,road);
  }
  // A cropped roundabout can form a rootless cycle. Inject local demand
  // on its outbound entrance branch, never into the circulating loop.
  const originParents=edges.map(()=>[]),cycleOriginRoots=new Set();
  for(const from of edges)for(const turn of from.links)originParents[turn.to].push(from);
  for(const entrance of edges){
    if(entrance.kind!=="ramp"||!isLocalEntrance(entrance))continue;
    const label=originLabel(entrance),chain=[],seen=new Map();
    let current=entrance;
    while(current&&current.kind==="ramp"&&originLabel(current)===label){
      if(seen.has(current.index)){
        const start=seen.get(current.index);
        if(start>0)cycleOriginRoots.add(chain[start-1].index);
        break;
      }
      seen.set(current.index,chain.length);chain.push(current);
      const parents=originParents[current.index];
      current=parents.length===1?parents[0]:null;
    }
  }
  // Local access slips sometimes share an exact node with an off-ramp,
  // although the actual public road is outside the extract. That apparent
  // incoming exit is not a source of entrance traffic. Recover the existing
  // entrance branches at that interface, using the SAME AS demand budget.
  const exitReachMemo=new Map();
  const localInterfaceLabel=e=>originLabel(e)||(/\bAS\b/.test(junctionLabel(e))&&
    !/\b(?:AK|AD|Autobahnkreuz|Autobahndreieck)\b/.test(junctionLabel(e))?junctionLabel(e):null);
  function reachesPublicExit(edge){
    if(exitReachMemo.has(edge.index))return exitReachMemo.get(edge.index);
    const work=[edge],seen=new Set();let result=false;
    for(let i=0;i<work.length&&i<100;i++){
      const e=work[i];if(e.kind!=="ramp"||seen.has(e.index))continue;seen.add(e.index);
      if(!e.links.length&&localInterfaceLabel(e)){result=true;break;}
      for(const t of e.links)if(edges[t.to].kind==="ramp")work.push(edges[t.to]);
    }
    exitReachMemo.set(edge.index,result);return result;
  }
  const recoveredOriginRoots=new Set();
  for(const edge of edges){
    if(edge.kind!=="ramp"||!edge.incomingAtStart||!originLabel(edge)||reachesPublicExit(edge)||!edge.links.length)continue;
    const parents=originParents[edge.index];
    if(parents.length&&parents.every(p=>p.kind==="ramp"&&localInterfaceLabel(p)===originLabel(edge)&&reachesPublicExit(p)))
      recoveredOriginRoots.add(edge.index);
  }
  for(const edge of edges){
    if(edge.kind!=="ramp"||edge.incomingAtStart&&!cycleOriginRoots.has(edge.index)&&!recoveredOriginRoots.has(edge.index)||!edge.links.length)continue;
    const label=originLabel(edge);
    if(!label&&!isLocalEntrance(edge))continue;
    const row=rowById.get(edge.id);
    let realDestinations=rampMainlineArrivals(edge).map(x=>x.road).filter(target=>
      target.kind==="mainline"&&target.ref&&(hasContinuousMainline(target)||
        /^(A1|A57|A565|A61|A571|A573)$/.test(target.ref)&&
        (corridorLengths.get(directedCorridorIds.get(target.index))||0)>=1500));
    if(!realDestinations.length)continue;
    // OSM motorway_link may lack a ref even when its real directed merge
    // unambiguously joins an A3/A4/... carriageway. Infer the DESTINATION's
    // motorway from that real mapped movement, never from geographic proximity.
    // A signed local entrance at a combined AS/AK may reach multiple
    // motorways. Charge its demand once to the explicitly signed local ref.
    if(edge.ref&&/\bAS\b/.test(edge.name)&&realDestinations.some(target=>target.ref===edge.ref))
      realDestinations=realDestinations.filter(target=>target.ref===edge.ref);
    const refs=new Set(realDestinations.map(target=>target.ref));
    const inferredRef=edge.ref||(refs.size===1?[...refs][0]:null);
    const corridors=new Set(realDestinations.map(target=>directedCorridorIds.get(target.index)));
    if(!inferredRef||refs.size!==1||!refs.has(inferredRef))continue;
    for(const corridor of corridors){
      const representative=corridorRepresentative.get(corridor);
      const representativeRow=rowById.get(representative.id);
      const rowWithRef=[row[0],row[1],inferredRef,row[3],representativeRow[4],label||row[5]];
      const profile=traffic.referenceForRoad(representativeRow);
      // The junction name (e.g. Bonn-Vilich) is not a travel direction.
      // Use the motorway representative's direction for the demand profile;
      // only the local entrance percentage comes from the junction label.
      const labelPeak=traffic.referenceForRoad(rowWithRef).peakVph;
      const peak=labelPeak>0?traffic.junctionEntryPeak(rowWithRef)*profile.peakVph/labelPeak:0;
      if(peak<=0)continue;
      // Repeated copies/fragments for the same signed AS→direction must never
      // create repeated independent 500 Kfz/h traffic generators.
      const key=(label||junctionLabel(edge)).replace(/\s+/g," ").trim().toLowerCase()+":"+corridor;
      const group=distinctOnramps.get(key)||{origins:[],profile,peak,corridor};
      if(!group.origins.some(old=>old.from===edge.from&&old.to===edge.to))group.origins.push(edge);
      distinctOnramps.set(key,group);
    }
  }
  // A shared branch already fed by a proper local origin does not need
  // another source. Remove redundant recovered roots, not the physical link.
  for(const group of distinctOnramps.values()){
    const seen=new Set(),work=group.origins.filter(e=>!recoveredOriginRoots.has(e.index));
    for(let i=0;i<work.length;i++){
      const e=work[i];if(seen.has(e.index))continue;seen.add(e.index);
      for(const t of e.links)if(edges[t.to].kind==="ramp")work.push(edges[t.to]);
    }
    group.origins=group.origins.filter(e=>!recoveredOriginRoots.has(e.index)||!seen.has(e.index));
  }
  // Urban reference peaks were calibrated on the previous, incomplete
  // extract. Newly connected local origins replace part of aggregate
  // boundary demand rather than adding that traffic a second time. Keep
  // the long-distance A3/A48 boundary profiles and every local AS origin.
  const recoveredDemand=new Map();
  for(const {origins,profile,peak,corridor} of distinctOnramps.values()){
    if(!/^(A59|A559|A560|A562|A565)$/.test(profile.ref))continue;
    const previouslyServed=origins.some(e=>isLocalEntrance(e)&&!e.incomingAtStart&&
      (verifiedEntries.has(rowById.get(e.id)[6])||e.links.some(t=>edges[t.to].kind==="mainline")));
    if(!previouslyServed)recoveredDemand.set(corridor,(recoveredDemand.get(corridor)||0)+peak);
  }
  for(const [corridor,peak] of recoveredDemand){
    const boundary=corridorRepresentative.get(corridor);
    // A59 B42 is an urban boundary whose recovered upstream origins all
    // feed the same Köln/Heumar direction. Reserve their demand fully,
    // including a modest share of the already modelled city transfers.
    const urbanFeeder=boundary.ref==="A59";
    if(boundary.source&&boundary.id!=="A565-16799872")boundary.referencePeakVph=Math.max(boundary.referencePeakVph*(urbanFeeder?.35:.5),
      boundary.referencePeakVph-peak*(urbanFeeder?1.25:.8));
  }
  for(const {origins,profile,peak} of distinctOnramps.values())for(const edge of origins){
    if(!edge.source){sources.push(edge);edge.referencePeakVph=0;edge.localProfiles=[];}
    edge.source=true;edge.localOrigin=true;edge.referencePeakVph+=peak/origins.length;
    edge.localProfiles.push({key:profile.key,peak:peak/origins.length});
    edge.directionKey=profile.key;
    // The link has one confirmed receiving motorway even if its Way omitted
    // a ref tag, allowing the correct time-of-day demand profile.
    if(!edge.ref)edge.ref=profile.ref;
  }
  // Disaggregate the existing A48 western boundary demand into physically
  // mapped A61 feeder ramps. Do not count the same through vehicles twice.
  const westernBoundary=sources.find(e=>e.kind==="mainline"&&e.directionKey==="A48-dernbach");
  if(westernBoundary){
    const feeders=edges.filter(e=>isA61Boundary(e)&&externalA61Inputs.has(e.osm)&&
      !e.incomingAtStart&&rampMainlineArrivals(e).some(a=>a.road.ref==="A48"&&
        directedCorridorIds.get(a.road.index)===directedCorridorIds.get(westernBoundary.index)));
    for(const edge of feeders){
      // The three mapped feeders converge into the same one-lane 1,500
      // veh/h ramp. Reserve headroom for the Friday peak multiplier.
      const peak=Math.min(1300,westernBoundary.referencePeakVph*.55)/Math.max(1,feeders.length);
      edge.source=true;edge.externalTransferOrigin=true;edge.referencePeakVph=peak;
      edge.directionKey="A48-dernbach";sources.push(edge);
    }
    westernBoundary.referencePeakVph-=feeders.reduce((n,e)=>n+e.referencePeakVph,0);
    if(feeders.length)westernBoundary.externalTransferOrigin=true;
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
  const incomingTurns=edges.map(()=>[]);
  for(const from of edges)for(const turn of from.links){
    incomingTurns[turn.to].push({from,turn});
  }
  const boundaryExit=edges.map(edge=>{
    const outgoing=edge.links.filter(link=>link.fromM>=edge.lengthM-.1);
    if(!outgoing.length)return true;
    if(edge.kind!=="mainline")return false;
    return !outgoing.some(link=>leadsToMainline(link.to));
  });
  // The documented B8 connection reaches the next A3 AS beyond our
  // Leverkusen map boundary. Represent it only as an off-map destination,
  // not a fictitious on-ramp or a return on the opposite carriageway.
  // https://www.autobahn.de/planen-bauen/projekt/a-bei-lev-ausbau-der-a1-und-a3-in-leverkusen
  // https://www.vfb.de/?proxy=redaktion%2Fdownloads%2FFans%2FAnfahrthinweise-Leverkusen.pdf
  const externalReturns=new Map();
  if(data===global.STAU_LEGACY_GEOMETRY){
    const road=byId.get("A3-126500245");
    if(road&&boundaryExit[road.index]){
      road.externalDetourDestination=true;
      road.externalDetourLabel="A3 AS 22 Leverkusen-Opladen (B8 · außerhalb Kartennetz)";
      externalReturns.set(road.id,road);
    }
  }
  // Lane-aware approach chains end at the next physical mainline fork.
  // This is a graph relation, not a named interchange or a distance cap.
  const approachForks=edges.map(e=>Array(e.n).fill(null)),forks=[];
  const ordinaryMoves=(e,k)=>[
    ...(k<e.n-1?[{to:e.index,toCell:k+1,weight:20}]:[]),...e.linksFrom[k]];
  // The next physical through cell, not a nearby but unrelated carriageway.
  // A mainline retains its own continuation at an exit; a ramp must have
  // an unambiguous continuation before downstream braking can be inferred.
  const brakeSuccessors=edges.map(e=>Array.from({length:e.n},(_,k)=>{
    const moves=ordinaryMoves(e,k);
    const through=e.kind==="mainline"?moves.filter(t=>edges[t.to].kind==="mainline"&&edges[t.to].ref===e.ref):moves;
    return through.length===1?through[0]:null;
  }));
  for(const e of edges)if(e.kind==="mainline"&&e.lanes>1)for(let k=0;k<e.n;k++){
    const moves=ordinaryMoves(e,k),through=moves.filter(t=>edges[t.to].kind==="mainline"&&edges[t.to].ref===e.ref);
    const branches=moves.filter(t=>!through.includes(t));
    if(through.length!==1||!branches.length)continue;
    const widths=branches.map(t=>Math.max(1,edges[t.to].lanes));
    const branchLanes=Math.min(e.lanes-1,widths.reduce((a,b)=>a+b,0));
    const shares=new Map([[cellKey(through[0].to,through[0].toCell),1-branchLanes/e.lanes]]);
    branches.forEach((t,i)=>shares.set(cellKey(t.to,t.toCell),branchLanes/e.lanes*widths[i]/widths.reduce((a,b)=>a+b,0)));
    const fork={edge:e,k,moves,branches,shares,throughKey:cellKey(through[0].to,through[0].toCell),cells:[],active:false};
    forks.push(fork);approachForks[e.index][k]=fork;
  }
  for(const fork of forks){
    const work=[{edge:fork.edge,k:fork.k,next:null}];
    for(let i=0;i<work.length;i++){
      const item=work[i],e=item.edge,k=item.k;
      if(item.next&&approachForks[e.index][k])continue;
      approachForks[e.index][k]=fork;fork.cells.push(item);
      const join=(from,cell)=>{
        if(from.kind!=="mainline"||from.ref!==fork.edge.ref||approachForks[from.index][cell])return;
        const moves=ordinaryMoves(from,cell);
        if(moves.length===1&&moves[0].to===e.index&&moves[0].toCell===k)
          work.push({edge:from,k:cell,next:moves[0]});
      };
      if(k>0)join(e,k-1);
      for(const {from,turn} of incomingTurns[e.index])if(turn.toCell===k)join(from,turn.fromCell);
    }
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
  const mergeInputs=edges.map(edge=>Array.from({length:edge.n},()=>[]));
  for(const edge of edges)for(const {from,turn} of incomingTurns[edge.index])
    mergeInputs[edge.index][turn.toCell].push({from,cell:turn.fromCell});
  const delta=edges.map(edge=>new Float64Array(edge.n));
  const divertDelta=edges.map(edge=>new Float64Array(edge.n));
  const bypassDelta=edges.map(edge=>new Float64Array(edge.n));
  const entryDelta=edges.map(edge=>new Float64Array(edge.n));
  // These transfer requests are transient cell faces, not vehicle objects.
  // Reuse buckets and records every tick to avoid GC spikes on mobile.
  const requestBuckets=edges.map(edge=>Array.from({length:edge.n},()=>[]));
  const requestPool=[],activeBuckets=[];
  const used=edges.map(edge=>new Float64Array(edge.n));
  const accepted=edges.map(edge=>new Float64Array(edge.n));
  const routeChanges=new Map(),routeAccounting=new Map(),routePaths=new Map();
  const routePathCosts=new Map(),motorwayAlternatives=new Map();
  const enteredStep=new Float64Array(edges.length);
  const departedStep=new Float64Array(edges.length);
  const eventRecords=new Map();
  let activeEffects=new Map(),blockedFeederTurns=new Map(),effectsStamp=null,simStart=Date.now();
  let exposureEpoch=0,closureFingerprint="",derivedEpoch=-1;
  const derivedClosureCache=new Map();
  let jointClosureEpoch=-1,jointClosureSpans=[];
  let elapsed=0,generated=0,exited=0,demandPercent=100,initialVehicles=0;
  // Trips that have left the *displayed* motorway network, but have not yet
  // reentered at a real OSM on-ramp, are conserved as external-road inventory.
  let outsideVehicles=0,detouredVehicles=0,returnedVehicles=0;
  const detourTrips=[];
  // Combine same-minute arrivals to keep the simulator responsive on phones.
  const detourBatchIndex=new Map();
  const terminalDetours=new Map(),exitDetours=new Map(),fallbackExits=new Map(),fallbackTransfers=new Map();
  // An open motorway arm may provide a real exit and public-road bypass to
  // the affected arm's downstream continuation. Never redirect the drivers
  // whose actual destination remains on that open arm.
  const dynamicTransferChoices=new Map();
  const designatedApproach=new Set(),designatedTransfers=new Map();
  const transferFallbackByApproach=new Map();
  const localSourceDetours=new Map();
  const localSourceCandidates=new Map(),localSourceChoiceCache=new Map();
  const wideSourceOptions=new Map(),wideRoutesByEvent=new Map(),wideBookings=new Map();
  const wideAccounting=new Map(),wideDecisionCache=new Map();
  let wideDecisionStamp="";
  let localSourceChoiceMinute=-1;
  let detourPlansKey=null;
  let warmedUp=false;
  let jamGroups=[];
  // Only segments belonging to a genuine mapped motorway queue, not
  // arbitrary slow cells, are used for selecting the last exit before it.
  const routingQueueBands=new Map();
  const severeQueueSegments=new Map();
  const navigationQueueBands=new Map();
  // Remember the actual forks serving a closure. A separate recurrent jam
  // near a distant AS must not be mistaken for the tail of this closure.
  const closureDiversionForks=new Set();let closureForkEpoch=-1;
  const diversionDecisions=new Map();
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
  function restoreEvent(raw){
    let edge=raw&&byId.get(raw.edgeId);
    // The old snapshot sometimes combined several consecutive ramp Ways
    // of different widths under one ID. Restore old offsets on their actual
    // successor fragment without moving a saved event to a different ramp.
    if(edge?.kind==="ramp"&&finite(Number(raw.offsetM))&&raw.offsetM>=edge.lengthM){
      let offset=Number(raw.offsetM),part=edge;
      const prefix=edge.id+"-",seen=new Set();
      while(offset>=part.lengthM&&!seen.has(part.id)){
        seen.add(part.id);
        const next=part.links.filter(t=>edges[t.to].id.startsWith(prefix)&&
          t.fromM>=part.lengthM-.05&&t.toM<.05);
        if(next.length!==1)break;
        offset-=part.lengthM;part=edges[next[0].to];
      }
      if(part!==edge&&offset<part.lengthM){edge=part;raw={...raw,edgeId:edge.id,offsetM:offset};}
    }
    // A saved complete closure from a pre-normalization four-lane Way
    // must remain a complete closure when only three through lanes remain.
    // Do not relax validation of newly created partial-lane events.
    if(edge&&raw.kind==="closure"&&Array.isArray(raw.closedLanes)&&
      raw.closedLanes.length>0&&raw.closedLanes.every((_,i)=>raw.closedLanes.includes(i)))
      raw={...raw,closedLanes:Array.from({length:edge.lanes},(_,i)=>i)};
    if(edge?.kind==="ramp"&&raw.kind!=="closure"&&raw.speedKmh===0&&
      raw.closedLanes?.length===1&&raw.closedLanes[0]===0&&edge.lanes>1)
      raw={...raw,closedLanes:Array.from({length:edge.lanes},(_,i)=>i)};
    // Old saved full-width physical incidents also need to stay blocked
    // when a verified permanent lane count increases. Partial events retain
    // exactly their original selected lanes.
    if(edge?.kind==="mainline"&&edge.ref==="A3"&&raw.kind!=="closure"&&
      raw.speedKmh===0&&raw.shoulder!=="open"&&
      verifiedBaselineLanes(Number(edge.osm))===edge.lanes&&
      raw.closedLanes?.length===edge.lanes-1&&
      raw.closedLanes.every((_,i)=>raw.closedLanes.includes(i)))
      raw={...raw,closedLanes:Array.from({length:edge.lanes},(_,i)=>i)};
    return setEvent(raw);
  }
  function listEvents(){
    return [...eventRecords.values()].map(record=>({...record.spec,
      coveredLengthM:record.coveredLengthM,truncated:record.truncated}));
  }
  // A roadworks interval may span dozens of OSM Ways. Selection must return
  // every individual record covering the tapped Way, not just its anchor.
  function eventsOnRoad(id){
    updateEffects();
    const derived=new Set((activeEffects.get(id)||NO_EFFECTS).flatMap(e=>[e.event.id,...(e.contributingClosureIds||[])]));
    return [...eventRecords.values()].filter(r=>r.spans.some(s=>s.edgeId===id)||derived.has(r.spec.id))
      .map(r=>({...r.spec}));
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
  const exitServiceCache=new Map();
  function servesLocalExit(start,junction){
    // A collector-distributor road may serve TWO closely spaced AS.
    // A split at the earlier AS is then also the last lawful exit at the
    // later AS, even if the mainline has no second physical diverge.
    const label=junction[2].toLowerCase().trim();
    const key=start.id+":"+label;
    if(exitServiceCache.has(key))return exitServiceCache.get(key);
    const pending=[start],seen=new Set();let found=false;
    for(let i=0;i<pending.length&&!found;i++){
      const ramp=pending[i];if(ramp.kind!=="ramp"||seen.has(ramp.id))continue;
      seen.add(ramp.id);
      if(!ramp.links.length&&ramp.name.toLowerCase().includes(label)){found=true;break;}
      for(const turn of ramp.links)if(edges[turn.to].kind==="ramp")pending.push(edges[turn.to]);
    }
    exitServiceCache.set(key,found);return found;
  }
  function outgoingMotorwayTransfer(start,ref){
    // At the reopening interchange, independent motorway exits remain
    // available for discharge. Preserve the exact ramp paths that reach
    // another motorway; ordinary local off-ramps inside closure stay closed.
    const pending=[start],seen=new Set(),parents=new Map(),seeds=[];
    for(let i=0;i<pending.length;i++){
      const ramp=pending[i];if(ramp.kind!=="ramp"||seen.has(ramp.id))continue;
      seen.add(ramp.id);
      for(const turn of ramp.links){
        const next=edges[turn.to];
        if(next.kind==="mainline"&&next.ref&&next.ref!==ref)seeds.push(ramp.id);
        if(next.kind!=="ramp")continue;
        const list=parents.get(next.id)||[];list.push(ramp.id);parents.set(next.id,list);
        if(!seen.has(next.id))pending.push(next);
      }
    }
    const result=new Set();
    for(let i=0;i<seeds.length;i++){
      const id=seeds[i];if(result.has(id))continue;result.add(id);
      for(const parent of parents.get(id)||[])seeds.push(parent);
    }
    return result;
  }
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
      let best=Infinity,offset=0;
      // Some interchanges have directional signposts almost a kilometre
      // apart. Use the original signed OSM nodes for each carriageway;
      // the single map label remains unchanged.
      for(const p of junction[4]||[junction[3]])for(let i=1;i<points.length;i++){
        const cos=Math.cos(p[0]*rad)*R*rad,lat=R*rad;
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
      const key=mark.junction[0]+":"+(mark.junction[1]||mark.junction[2]);
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
    // An AS centre is only a map LABEL, never the true legal closure gate.
    // Move upstream boundary to the last usable off-ramp split, and the
    // downstream boundary to the first actual on-ramp merge. This also
    // ensures the downstream exit is INSIDE the closure, while the on-ramp
    // directly behind it remains OPEN to returning traffic.
    const offSplits=[],onMerges=[];
    for(const main of chain){
      const base=starts.get(main.id);
      for(const turn of main.links)
        if(edges[turn.to].kind==="ramp"||
          edges[turn.to].kind==="mainline"&&edges[turn.to].ref!==main.ref)
          offSplits.push({position:base+turn.fromM,target:edges[turn.to]});
    }
    for(const ramp of edges){
      for(const turn of ramp.links){
        const target=edges[turn.to],base=starts.get(target.id);
        if(target.kind==="mainline"&&base!==undefined&&
          (ramp.kind==="ramp"||ramp.kind==="mainline"&&ramp.ref!==target.ref))
          onMerges.push(base+turn.toM);
      }
    }
    // Assign *real* fork/merge graph nodes to their respective adjoining
    // Anschlussstelle. The junction labels are approximate anchors, not gates.
    // No fixed 140m / 450m / 1500m buffer is allowed to cut a long AD/AK
    // in half or to leak the closure to the previous/next junction.
    const nearestJunctionIndex=position=>{
      let best=0,distance=Infinity;
      for(let i=0;i<ordered.length;i++){
        const delta=Math.abs(position-ordered[i].position);
        if(delta<distance){distance=delta;best=i;}
      }
      return best;
    };
    // Once past a named local exit fork, the tap is already inside the
    // following AS-to-AS corridor, even before the map's AS centre label.
    // Do not use an interchange's more complex forks as local AS anchors.
    const selectionPositions=ordered.map((mark,i)=>{
      if(/\b(?:AK|AD|Autobahnkreuz|Autobahndreieck)\b/i.test(mark.junction[2]))return mark.position;
      const forks=offSplits.filter(({position,target})=>
        nearestJunctionIndex(position)===i&&servesLocalExit(target,mark.junction));
      return forks.length?Math.min(mark.position,Math.max(...forks.map(f=>f.position))):mark.position;
    });
    const ix=selectionPositions.findIndex(position=>position>=point);
    if(ix<=0)return null;
    const left=ordered[ix-1],right=ordered[ix];
    if(!right||(left.junction[1]||left.junction[2])===(right.junction[1]||right.junction[2])||
      right.position<=left.position+.001)return null;
    const startExits=offSplits.filter(({position,target})=>
      position<point+.05&&(nearestJunctionIndex(position)===ix-1||
        nearestJunctionIndex(position)===ix-2&&servesLocalExit(target,left.junction)))
      .map(x=>x.position);
    // Last legal exit at the upstream junction is the START of closure.
    const startGate=startExits.sort((a,b)=>b-a)[0];
    // The downstream AS exit must lie INSIDE the closed interval. Only its
    // subsequent on-ramp is the reentry gate. A merge from an earlier
    // crossing interchange does not prematurely finish this section.
    const downstreamExit=offSplits.map(x=>x.position).filter(at=>
      nearestJunctionIndex(at)===ix&&at>=point-.05)
      .sort((a,b)=>a-b)[0];
    const endMerges=onMerges.filter(at=>
      nearestJunctionIndex(at)===ix&&
      at>point+.05&&
      (downstreamExit===undefined||at>downstreamExit+.05));
    const endGate=endMerges.sort((a,b)=>a-b)[0];
    // Never let a guessed ramp gate reverse the tapped carriageway.
    const fromPosition=startGate??left.position;
    const toPosition=endGate??right.position;
    if(fromPosition>=point||toPosition<=point||
      toPosition<=fromPosition+.001)return null;
    const spans=[];
    for(const road of chain){
      const begin=starts.get(road.id),end=begin+road.lengthM;
      const fromM=Math.max(0,fromPosition-begin);
      const toM=Math.min(road.lengthM,toPosition-begin);
      if(toM>fromM+.05&&end>=fromPosition&&begin<=toPosition)
        spans.push({edgeId:road.id,fromM,toM,gate:spans.length===0});
    }
    if(!spans.length)return null;
    const releaseTransfers=new Set();
    for(const {position,target} of offSplits){
      if(position<fromPosition||position>toPosition+.05||
        nearestJunctionIndex(position)!==ix||target.kind!=="ramp")continue;
      for(const id of outgoingMotorwayTransfer(target,edge.ref))releaseTransfers.add(id);
    }
    return {spans,coveredLengthM:spans.reduce((n,s)=>n+s.toM-s.fromM,0),
      truncated:false,from:left.junction,to:right.junction,releaseTransfers:[...releaseTransfers],
      fromLabel:left.junction.filter((_,i)=>i<3).filter(Boolean).join(" "),
      toLabel:right.junction.filter((_,i)=>i<3).filter(Boolean).join(" ")};
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
    return corridor?{lengthM:Math.max(1,Math.round(corridor.coveredLengthM)),
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
    // For closures the physical AS-to-AS graph defines the length, NOT an
    // editor-supplied metre cap. This also supports very short or long AS
    // intervals without any distance-dependent closure behavior.
    const max=kind==="accident"||kind==="breakdown"?200:
      kind==="roadworks"?20000:Number.MAX_SAFE_INTEGER;
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
      (data.junctions||[]).length>0&&!physical)
      throw Error("Vollsperrung nicht gesetzt: Zwei verbundene Anschlussstellen "+
        "in dieser Fahrtrichtung konnten nicht sicher ermittelt werden. "+
        "Fehlende OSM-Knoten werden nicht durch eine willkürliche Teilsperrung ersetzt.");
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
    const byEdge=new Map(),byTurn=new Map();
    function addBlockedTurns(turns,eventId){
      for(const link of turns){
        const list=byTurn.get(link)||[];list.push(eventId);byTurn.set(link,list);
      }
    }
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
    const closures=[...eventRecords.values()].filter(record=>
      record.spec.kind==="closure"&&
      (!record.spec.schedule||
        global.StauEventSchedule.active(record.spec.schedule,time)));
    const roadClosures=closures.filter(record=>
      record.spans.some(span=>byId.get(span.edgeId)?.kind==="mainline"));
    const fingerprint=closures.map(x=>x.spec.id).sort().join("|");
    if(fingerprint!==closureFingerprint){
      closureFingerprint=fingerprint;exposureEpoch++;
    }
    if(derivedEpoch!==exposureEpoch){
      derivedClosureCache.clear();derivedEpoch=exposureEpoch;
    }
    for(const record of roadClosures){
      const cached=derivedClosureCache.get(record.spec.id);
      if(cached){
        for(const [id,spans] of cached.derived){
          const list=byEdge.get(id)||[];list.push(...spans);byEdge.set(id,list);
        }
        addBlockedTurns(cached.turns,record.spec.id);
        continue;
      }
      const spansById=new Map(),derived=new Map();
      const releaseTransfers=new Set(record.releaseTransfers||[]);
      const primaryRefs=new Set(record.spans.map(s=>byId.get(s.edgeId)?.ref));
      for(const span of record.spans){
        const arr=spansById.get(span.edgeId)||[];
        arr.push(span);spansById.set(span.edgeId,arr);
      }
      // Follow the exact directed through-carriageway across arbitrarily
      // many OSM Way boundaries. A 10-km-upstream on-ramp must remain OPEN
      // when a later real exit exists before the gate; conversely, a ramp
      // with NO legal exit until the barrier must be closed. Neither rule
      // depends on a search radius, road fragment length or junction name.
      const mainlineReachMemo=new Map();
      function leadsIntoClosed(link){
        const target=edges[link.to];
        if((spansById.get(target.id)||[]).some(s=>
          link.toM>=s.fromM-.05&&link.toM<s.toM-.05))return true;
        if(target.kind!=="mainline")return false;
        let current=target,position=link.toM;
        const visited=new Set(),history=[];
        const result=value=>{
          for(const key of history)mainlineReachMemo.set(key,value);
          return value;
        };
        for(let hops=0;hops<=edges.length;hops++){
          const key=current.id+":"+Math.round(position*100);
          if(mainlineReachMemo.has(key))
            return result(mainlineReachMemo.get(key));
          if(visited.has(key))return result(false);
          visited.add(key);history.push(key);
          const span=(spansById.get(current.id)||[])
            .filter(s=>s.toM>position+.05).sort((a,b)=>a.fromM-b.fromM)[0];
          if(span&&position>=span.fromM-.05)
            return result(true);
          const gate=span?span.fromM:current.lengthM;
          const escape=current.links.some(turn=>{
            if(turn.fromM<position-.05||turn.fromM>gate+.05)return false;
            const other=edges[turn.to];
            return !(spansById.get(other.id)||[]).some(s=>
              turn.toM>=s.fromM-.05&&turn.toM<s.toM-.05)&&
              (other.kind==="ramp"||
                other.kind==="mainline"&&other.ref!==current.ref);
          });
          if(escape)return result(false);
          if(span)return result(true);
          const next=mainlineNext.get(current.id)||[];
          if(next.length!==1)return result(false);
          current=next[0];position=0;
        }
        return result(false);
      }
      // Extend the closure to the trapped suffix of a feeder, including a
      // motorway that ends in another motorway (A59 at Heumar). A common
      // trunk remains open up to its LAST usable directed exit, even when
      // that fork is inside a single 26-km OSM Way.
      function addDerived(edge,fromM,toM){
        if(toM<=fromM+.05)return false;
        const old=derived.get(edge.id)||[];
        if(old.some(s=>s.fromM<=fromM+.05&&s.toM>=toM-.05))return false;
        const merged={edgeId:edge.id,fromM,toM,gate:true,
          derivedRampClosure:edge.kind==="ramp",derivedFeederClosure:true,
          event:record.spec};
        const keep=old.filter(s=>{
          if(s.toM<merged.fromM-.05||s.fromM>merged.toM+.05)return true;
          merged.fromM=Math.min(merged.fromM,s.fromM);
          merged.toM=Math.max(merged.toM,s.toM);return false;
        });
        keep.push(merged);derived.set(edge.id,keep);
        spansById.set(edge.id,keep);return true;
      }
      const closedDeparture=(from,turn)=>(spansById.get(from.id)||[]).some(s=>
        turn.fromM>=s.fromM-.05&&turn.fromM<=s.toM+.05&&
        (!s.gate||turn.fromM>s.fromM+.05));
      let changed=true,iterations=0;
      while(changed&&iterations++<edges.length){
        changed=false;
        // Newly closed exclusive ramp branches can invalidate an earlier
        // apparent "escape"; recompute reachability to fixed point.
        mainlineReachMemo.clear();
        for(const edge of edges){
          if(edge.kind!=="ramp"&&
            (edge.kind!=="mainline"||primaryRefs.has(edge.ref)))continue;
          const terminal=edge.links.filter(t=>t.fromM>=edge.lengthM-.05);
          if(!terminal.length||!terminal.every(leadsIntoClosed))continue;
          const lastEscape=Math.max(0,...edge.links.filter(t=>
            !leadsIntoClosed(t)).map(t=>t.fromM));
          if(addDerived(edge,lastEscape,edge.lengthM))changed=true;
        }
        // Also follow every outgoing ramp fragment INSIDE the closed area.
        // Stop at a shared open entrance: a different motorway's lawful
        // transfer is not part of the closure merely because it merges
        // into the same downstream ramp. Do not extend to open mainlines.
        for(const edge of edges){
          if(edge.kind!=="ramp"||edge.source||releaseTransfers.has(edge.id))continue;
          const arrivals=incomingTurns[edge.index];
          const initial=arrivals.filter(x=>x.turn.toM<.05);
          if(!initial.length||!initial.every(x=>closedDeparture(x.from,x.turn)))continue;
          const firstOpen=Math.min(edge.lengthM,...arrivals.filter(x=>
            !closedDeparture(x.from,x.turn)).map(x=>x.turn.toM));
          if(addDerived(edge,0,firstOpen))changed=true;
        }
      }
      for(const [id,spans] of derived){
        const list=byEdge.get(id)||[];
        list.push(...spans);byEdge.set(id,list);
      }
      // A shared motorway may have a DIRECT turn onto a trapped approach
      // before its first red-white interval. Block just that movement, not
      // its independent open motorway continuation. Cars already inside
      // the closure still evacuate across the same connection.
      mainlineReachMemo.clear();
      const turns=[];
      for(const from of edges)for(const turn of from.links){
        const target=edges[turn.to];
        if(target.kind==="mainline"&&
          (from.kind!=="mainline"||from.ref!==target.ref)&&leadsIntoClosed(turn))
          turns.push(turn);
      }
      addBlockedTurns(turns,record.spec.id);
      derivedClosureCache.set(record.spec.id,{derived,turns});
    }
    // The union of active closures can eliminate the LAST remaining escape
    // at an interchange. Propagate this newly trapped approach backwards to
    // its actual last open diverge, not the label of the closed interchange.
    // Also cover explicitly closed ramps (which have no primary mainline).
    if(jointClosureEpoch!==exposureEpoch){
      jointClosureEpoch=exposureEpoch;jointClosureSpans=[];
      if(closures.length>1||closures.length!==roadClosures.length){
        const bands=id=>(byEdge.get(id)||[]).filter(x=>x.event.kind==="closure");
        const blocked=turn=>bands(edges[turn.to].id).find(s=>
          turn.toM>=s.fromM-.05&&turn.toM<s.toM-.05)?.event||
          closures.find(c=>(byTurn.get(turn)||[]).includes(c.spec.id))?.spec;
        const blockedIds=turn=>[
          ...bands(edges[turn.to].id).filter(s=>turn.toM>=s.fromM-.05&&turn.toM<s.toM-.05)
            .flatMap(s=>s.contributingClosureIds||[s.event.id]),
          ...(byTurn.get(turn)||[])
        ];
        let changed=true;
        while(changed){
          changed=false;
          for(const edge of edges){
            const existing=bands(edge.id).sort((a,b)=>a.fromM-b.fromM)[0];
            const terminal=edge.links.filter(t=>t.fromM>=edge.lengthM-.05);
            const event=existing?.event||(!boundaryExit[edge.index]&&terminal.length&&
              terminal.every(blocked)?blocked(terminal[0]):null);
            if(!event)continue;
            const gate=existing?.fromM??edge.lengthM;
            if(gate<=.05)continue;
            const lastEscape=Math.max(0,...edge.links.filter(t=>
              t.fromM<=gate+.05&&!blocked(t)).map(t=>t.fromM));
            if(lastEscape>=gate-.05)continue;
            const span={edgeId:edge.id,fromM:lastEscape,toM:gate,gate:true,
              derivedRampClosure:edge.kind==="ramp",derivedFeederClosure:true,event,
              contributingClosureIds:[...new Set(existing?
                existing.contributingClosureIds||[existing.event.id]:terminal.flatMap(blockedIds))]};
            const list=byEdge.get(edge.id)||[];
            list.push(span);byEdge.set(edge.id,list);jointClosureSpans.push(span);
            changed=true;
          }
        }
      }
    }else for(const span of jointClosureSpans){
      const list=byEdge.get(span.edgeId)||[];list.push(span);byEdge.set(span.edgeId,list);
    }
    // Consecutive intervals in the same combined closure have one upstream
    // gate. An old internal gate would stop evacuation inside the red band.
    if(jointClosureSpans.length)for(const [id,list] of byEdge){
      const closed=list.filter(s=>s.event.kind==="closure");
      byEdge.set(id,list.map(s=>s.event.kind==="closure"&&s.gate&&
        closed.some(p=>p.fromM<s.fromM-.05&&p.toM>=s.fromM-.05)?
        {...s,gate:false}:s));
    }
    activeEffects=byEdge;blockedFeederTurns=byTurn;
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
  function throughOccupancy(edge,k){
    const fork=approachForks[edge.index][k],pending=edge.turnStock[k];
    if(!fork?.active||!pending)return {count:edge.stock[k],storage:edge.jamPerCell};
    const fresh=Math.max(0,edge.stock[k]-[...pending.values()].reduce((n,x)=>n+x,0));
    const share=fork.shares.get(fork.throughKey);
    return {count:(pending.get(fork.throughKey)||0)+fresh*share,storage:edge.jamPerCell*share};
  }
  function measuredCellSpeed(edge,k,count,storage){
    // An OSM ramp fragment may physically hold less than one vehicle.
    // A universal .8-vehicle cutoff would call even slow 200 Kfz/h traffic
    // free flowing on such links. Keep a proportional evidence minimum.
    const minimum=edge.kind==="ramp"?
      Math.min(.8,Math.max(.15,130*edge.lanes*edge.cellLength/1000*.05)):.8;
    if(count<minimum)return edge.freeKmh;
    const density=clamp01(count/Math.max(.001,storage));
    // Before receiving a meaningful flow sample (e.g. initial inventory),
    // use the density-based estimate. Once measured, do not apply a second
    // independent density slowdown to already observed vehicle movements.
    if(edge.cellSpeedExposure[k]<.8)return edge.freeKmh*
      trafficOperatingState(density,0,edge.kind==="mainline").speedFactor*
      (density<=.23?1:Math.max(.04,1-Math.pow((density-.23)/.77,1.45)));
    const sampled=Math.max(0,Math.min(edge.freeKmh,edge.cellFlowSpeeds[k]));
    // Micro-OSM edges have longer VIRTUAL CTM buffers for numerical
    // stability. At genuinely slow, occupied ramps measure speed using
    // actual geometry, observed flow and density. Otherwise leave
    // uncongested tiny connectors on the previous numerical speed.
    if(edge.kind==="ramp"&&edge.cellLength>=12&&edge.cellLength<=120&&
      count>=.25&&count>=130*edge.lanes*edge.cellLength/1000*.12&&
      edge.cellThroughVph[k]>75){
      const limited=(activeEffects.get(edge.id)||NO_EFFECTS).some(x=>
        x.fromM<(k+1)*edge.cellLength-.001&&x.toM>k*edge.cellLength+.001&&
        x.event.speedKmh>0&&x.event.speedKmh<=45);
      if(limited||sampled<edge.freeKmh*.65||
        edge.cellReceivingVph[k]<edge.lanes*edge.capacityPerLane*.65)
        return Math.min(sampled,edge.cellThroughVph[k]*edge.cellLength/(1000*count));
    }
    return sampled;
  }
  // A lane-resolved fork has two different measured streams. Keep its
  // through speed for navigation, but paint a physically occupied exit
  // lane as congested even while the remaining lanes can still move.
  function visualCellState(edge,k){
    const {count,storage}=throughOccupancy(edge,k);
    let speed=measuredCellSpeed(edge,k,count,storage);
    let fraction=count/Math.max(.001,storage),vehicles=count;
    const branchCount=Math.max(0,edge.stock[k]-count);
    const branchStorage=Math.max(0,edge.jamPerCell-storage);
    if(branchStorage>0&&branchCount>=Math.min(1,branchStorage*.3)&&
      branchCount/branchStorage>.30&&edge.branchExposure[k]>.1&&edge.branchSpeed[k]<speed){
      speed=edge.branchSpeed[k];fraction=branchCount/branchStorage;vehicles=branchCount;
    }
    return {speed,fraction,vehicles};
  }
  // A full-width accident can have exactly the same zero discharge as a
  // planned closure. Do not publish a fictitious multihour ETA based on
  // the numerical 1 km/h lower bound while there is no physical opening.
  function fullBlockAhead(road,offset,maxDistance=2000){
    const visited=new Set();let distance=0;
    while(road&&!visited.has(road.id)&&distance<maxDistance){
      visited.add(road.id);
      if((activeEffects.get(road.id)||NO_EFFECTS).some(x=>x.toM>=offset-.05&&
        distance+Math.max(0,x.fromM-offset)<=maxDistance&&
        (x.event.kind==="closure"||x.event.closedLanes.length>=road.lanes&&x.event.shoulder!=="open")))return true;
      distance+=road.lengthM-offset;
      const next=road.next.filter(t=>edges[t.to].kind==="mainline"&&edges[t.to].ref===road.ref);
      if(next.length!==1)break;
      road=edges[next[0].to];offset=next[0].toM;
    }
    return false;
  }
  function recomputeSpeeds(){
    updateEffects();
    for(const edge of edges){
      const effectList=activeEffects.get(edge.id)||NO_EFFECTS;
      const closed=effectList.filter(x=>x.event.kind==="closure"||
        x.event.closedLanes.length===edge.lanes&&x.event.shoulder!=="open");
      let minSpeed=edge.freeKmh;
      const bands=[];
      for(let k=0;k<edge.n;k++){
        const a=k*edge.cellLength,b=(k+1)*edge.cellLength;
        const {speed:measured,fraction,vehicles:count}=visualCellState(edge,k);
        let speed=measured;
        for(const effect of effectList){
          if(effect.fromM>=b-.001||effect.toM<=a+.001)continue;
          if(effect.event.speedKmh>0)
            speed=Math.min(speed,effect.event.speedKmh);
        }
        // No vehicle = no measured travel speed. Capacity restrictions and
        // closures remain separately visible as event/closure overlays.
        if(count>=1)minSpeed=Math.min(minSpeed,speed);
        // All mapped ramp types use the same occupation/velocity rule.
        // Tiny OSM connectors have finite numerical storage too; two cars
        // is already a queue there. A slow but almost empty road is not.
        // Display congestion using ACTUAL road metres, not enlarged
        // numerical CTM storage. A short occupied crawling ramp is not green.
        const physicalStorage=130*edge.lanes*edge.cellLength/1000;
        const physicalOccupancy=count/Math.max(.001,physicalStorage);
        const observedFloor=Math.min(2,Math.max(.18,physicalStorage*.16));
        // Low-volume 3–10 km/h movement can be genuinely congested too.
        // Require measured slow travel PLUS real physical occupancy;
        // a single unrestricted car does not become a phantom red queue.
        const congested=count>=Math.min(observedFloor,Math.max(.15,physicalStorage*.07))&&
          (fraction>.30||physicalOccupancy>.22&&measured<=45||
            physicalOccupancy>.12&&measured<=15);
        const color=congested?colourForSpeed(measured):"free";
        if(color!=="free"){
          // Evacuating/trapped stock still exists physically, but the
          // closed part has no publicly traversable queue or travel ETA.
          let open=[[a,b]];
          for(const x of closed)if(x.fromM<b&&x.toM>a)open=open.flatMap(([lo,hi])=>{
            if(x.fromM>=hi||x.toM<=lo)return [[lo,hi]];
            return [[lo,Math.min(hi,x.fromM)],[Math.max(lo,x.toM),hi]].filter(([s,e])=>e-s>.05);
          });
          for(const [lo,hi] of open){
          const length=hi-lo,travel=length*.06/Math.max(1,measured);
          const previous=bands.at(-1);
          if(previous&&previous.color===color&&Math.abs(previous.toM-lo)<.001){
            const oldLength=previous.toM-previous.fromM;
            previous.travelMin+=travel;
            previous.toM=hi;
            previous.speedKmh=(oldLength+length)*60/1000/previous.travelMin;
            previous.worstKmh=Math.min(previous.worstKmh,measured);
            previous.delayLowerBound ||= measured<1;
          }else bands.push({fromM:lo,toM:hi,color,speedKmh:Math.max(1,measured),
            worstKmh:measured,travelMin:travel,delayLowerBound:measured<1});
          }
        }
      }
      edge.speed=minSpeed;
      edge.visualBands=bands;
    }
    jamGroups=calculateJamGroups();
    annotateRouteTotals();
  }
  // A report may show the cumulative loss only for an unambiguous onward
  // route. At a genuine choice of motorway arms stop rather than adding
  // delays from mutually exclusive destinations.
  function annotateRouteTotals(){
    for(const group of jamGroups){
      if(!group.startEdgeId||group.routingDelayMin<5||!navigationQueueBands.has(group.startEdgeId))continue;
      let road=byId.get(group.startEdgeId),from=group.startOffsetM,metres=0,total=0,lowerBound=false;
      const seen=new Set(),queues=new Set(),refs=new Set();
      while(road&&!seen.has(road.id)&&metres<100000){
        seen.add(road.id);if(road.ref)refs.add(road.ref);
        for(const band of navigationQueueBands.get(road.id)||[]){
          const lo=Math.max(from,band.fromM),hi=band.toM;
          if(hi<=lo)continue;
          queues.add(band.group);lowerBound ||= band.group.delayLowerBound;
          for(let k=Math.floor(lo/road.cellLength);k<road.n&&k*road.cellLength<hi;k++){
            const length=Math.max(0,Math.min(hi,(k+1)*road.cellLength)-Math.max(lo,k*road.cellLength));
            total+=Math.max(0,length*.06*(1/routingCellSpeed(road,k)-1/road.freeKmh));
          }
        }
        metres+=road.lengthM-from;
        const legal=road.next.filter(t=>!blockedMovement(road,t)&&!localTerminal(edges[t.to]));
        const same=legal.filter(t=>edges[t.to].kind==="mainline"&&edges[t.to].ref===road.ref);
        const next=same.length?same:legal;
        if(next.length!==1)break;
        road=edges[next[0].to];from=next[0].toM;
      }
      if(queues.size>1&&total>group.routingDelayMin+5){
        group.routeDelayMin=total;group.routeDelayLowerBound=lowerBound;
        group.routeRefs=[...refs];
      }
    }
  }
  // Adjacent congestion cells are one queue, even when OSM splits them into
  // dozens of Ways. Never join across a branch or a disconnected geometry.
  function calculateJamGroups(){
    routingQueueBands.clear();
    severeQueueSegments.clear();
    navigationQueueBands.clear();
    const pieces=[],perEdge=new Map();
    for(const edge of edges){
      const local=[];
      for(const band of edge.visualBands){
        const m=band.toM-band.fromM;
        const travelMin=band.travelMin??m/1000*60/Math.max(1,band.speedKmh);
        const freeMin=m/1000*60/edge.freeKmh;
        const delay=Math.max(0,travelMin-freeMin);
        const last=local.at(-1);
        if(last&&Math.abs(last.toM-band.fromM)<.02){
          last.toM=band.toM;last.delayMin+=delay;last.travelMin+=travelMin;last.freeMin+=freeMin;
          last.worstKmh=Math.min(last.worstKmh,band.worstKmh??band.speedKmh);
          last.delayLowerBound ||= band.delayLowerBound;
        }else{
          const item={index:pieces.length,edgeId:edge.id,fromM:band.fromM,
            toM:band.toM,delayMin:delay,travelMin,freeMin,worstKmh:band.worstKmh??band.speedKmh,delayLowerBound:band.delayLowerBound};
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
        g={lengthM:0,delayMin:0,travelMin:0,freeMin:0,worstKmh:Infinity,
          edgeId:piece.edgeId,offsetM:(piece.fromM+piece.toM)/2,
          longestM:0,segments:[]};
        groups.set(key,g);
      }
      const len=piece.toM-piece.fromM;
      g.segments.push(piece);
      g.lengthM+=len;g.delayMin+=piece.delayMin;g.travelMin+=piece.travelMin;g.freeMin+=piece.freeMin;
      g.worstKmh=Math.min(g.worstKmh,piece.worstKmh);
      g.delayLowerBound ||= piece.delayLowerBound;
      if(len>g.longestM){
        g.longestM=len;g.edgeId=piece.edgeId;
        g.offsetM=(piece.fromM+piece.toM)/2;
      }
    }
    return [...groups.values()].filter(g=>g.delayMin>=.5&&(g.lengthM>=350||
      // Very short queues deserve a label only if the ramp is actually
      // handling substantial traffic. Tiny isolated OSM ramp fragments
      // with negligible flow must not become phantom congestion alerts.
      g.lengthM>=100&&byId.get(g.edgeId)?.kind==="ramp"&&g.segments.some(p=>{
        const edge=byId.get(p.edgeId);
        return Math.max(edge.enteredVph,edge.departedVph)>=300;
      })))
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
        const headRoad=head&&byId.get(head.edgeId);
        const headCell=headRoad?Math.max(0,Math.min(headRoad.n-1,
          Math.ceil(head.toM/headRoad.cellLength)-1)):0;
        const closureQueue=!!headRoad&&headRoad.kind==="mainline"&&!!closureFingerprint&&(
          Number.isFinite(closureDistanceAhead(headRoad,head.toM,headRoad.cellLength))||
          closureForkEpoch===exposureEpoch&&[-1,0,1].some(d=>closureDiversionForks.has(cellKey(headRoad.index,headCell+d))));
        if(closureQueue&&g.delayMin>=5&&g.worstKmh<=30)for(const segment of g.segments){
          const bands=routingQueueBands.get(segment.edgeId)||[];
          bands.push(segment);routingQueueBands.set(segment.edgeId,bands);
        }
        const origins=g.segments.filter(piece=>{
          if(piece.fromM>.02)return true;
          const road=byId.get(piece.edgeId);
          return !incomingTurns[road.index].some(({from,turn})=>
            turn.fromM>=from.lengthM-.02&&turn.toM<.02&&
            from.kind===road.kind&&from.ref===road.ref&&
            g.segments.some(p=>p.edgeId===from.id&&p.toM>=from.lengthM-.02));
        });
        const tail=origins.length===1?origins[0]:null;
        const {longestM,segments,travelMin,freeMin,...publicGroup}=g;
        publicGroup.meanKmh=Number.isFinite(travelMin)&&travelMin>0?g.lengthM/1000*60/travelMin:0;
        publicGroup.routingDelayMin=g.delayMin;
        const travelDelay=travelMin-freeMin;
        // The queue itself has a measured snapshot travel time independent
        // of a downstream closure. Below 1 km/h report a lower bound, not
        // an invented opening time or unlimited numerical extrapolation.
        // A multihour projection from virtually stationary traffic has no
        // reliable arrival time if the closure offers no observed discharge.
        // Keep its severity for routing, even when the public ETA is unknown.
        const noDischarge=travelDelay>=240&&headRoad&&
          headRoad.cellThroughVph[headCell]<30&&
          (Number.isFinite(closureDistanceAhead(headRoad,head.toM,Infinity))||fullBlockAhead(headRoad,head.toM));
        publicGroup.delayMin=Number.isFinite(travelDelay)&&!noDischarge?Math.max(0,travelDelay):null;
        if(head){
          publicGroup.endEdgeId=head.edgeId;
          publicGroup.endOffsetM=head.toM;
        }
        if(tail){publicGroup.startEdgeId=tail.edgeId;publicGroup.startOffsetM=tail.fromM;}
        // Exit-only queues are visible, but must not be charged to drivers
        // continuing on the motorway. Independent through/transfer queues
        // along one route are all eligible, including across motorway refs.
        if(headRoad&&!localTerminal(headRoad)&&!exitBacklogAtHead(headRoad,head.toM))
          for(const segment of segments){
            const bands=navigationQueueBands.get(segment.edgeId)||[];
            bands.push({...segment,group:publicGroup});navigationQueueBands.set(segment.edgeId,bands);
          }
        if(headRoad?.kind==="mainline"&&g.delayMin>=45&&!exitBacklogAtHead(headRoad,head.toM))
          for(const segment of segments){
            const items=severeQueueSegments.get(segment.edgeId)||[];
            items.push({segment,group:publicGroup});severeQueueSegments.set(segment.edgeId,items);
          }
        return publicGroup;
      });
  }
  const queueLocationCache=new Map();
  // The display direction is taken from a connected motorway sample, not
  // the heading of a tiny Way or the peak-demand profile's corridor name.
  const navigationSampleCache=new Map();
  function destinationAt(edge,offset,route=false){
    const points=rowById.get(edge.id)[4],cumulative=pointMetres.get(edge.id);
    const at=Math.max(0,Math.min(edge.lengthM,Number(offset)||0));
    const index=cumulative.findIndex(m=>m>=at),i=index===-1?points.length-1:Math.max(1,index);
    const a=points[i-1],b=points[i],t=(at-cumulative[i-1])/Math.max(.001,cumulative[i]-cumulative[i-1]);
    const point=[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];
    if(!navigationSampleCache.has(edge.id))navigationSampleCache.set(edge.id,
      traffic.navigationTravelPoints(edge,e=>mainlineBack.get(e.id)||[],e=>mainlineNext.get(e.id)||[],
        e=>rowById.get(e.id)[4],e=>e.lengthM));
    return (route?traffic.navigationRoute:traffic.navigationDestination)(edge.ref,point,navigationSampleCache.get(edge.id));
  }
  function rampDestination(edge,role,route=false){
    let arrivals=[];
    if(role==="Abfahrt"){
      const work=[edge],seen=new Set();
      for(let i=0;i<work.length&&i<100;i++){
        const ramp=work[i];if(seen.has(ramp.id))continue;seen.add(ramp.id);
        for(const {from,turn} of incomingTurns[ramp.index]){
          if(from.kind==="mainline"&&(!edge.ref||from.ref===edge.ref))arrivals.push({road:from,metre:turn.fromM});
          else if(from.kind==="ramp"&&!seen.has(from.id))work.push(from);
        }
      }
    }else arrivals=rampMainlineArrivals(edge);
    const destinations=new Set(arrivals.filter(a=>!route||!edge.ref||a.road.ref===edge.ref)
      .map(a=>destinationAt(a.road,a.metre,route)).filter(Boolean).map(v=>route?JSON.stringify(v):v));
    // At a shared collector with several true destinations retain its
    // original signed name instead of inventing a single direction.
    return destinations.size===1?(route?JSON.parse([...destinations][0]):[...destinations][0]):undefined;
  }
  const entranceOnlyCache=new Map();
  function entranceOnly(edge){
    if(entranceOnlyCache.has(edge.index))return entranceOnlyCache.get(edge.index);
    const work=[edge],seen=new Set();let local=false,transfer=false;
    for(let i=0;i<work.length&&i<200;i++){
      const ramp=work[i];if(seen.has(ramp.index))continue;seen.add(ramp.index);
      if(ramp.source&&isLocalOrigin(ramp))local=true;
      for(const {from} of incomingTurns[ramp.index]){
        if(from.kind==="mainline")transfer=true;
        else if(!seen.has(from.index))work.push(from);
      }
    }
    const result=local&&!transfer;entranceOnlyCache.set(edge.index,result);return result;
  }
  function queueRoadInfo(group){
    const anchor=byId.get(group.edgeId);
    if(!anchor)return {};
    const start=byId.get(group.startEdgeId)||anchor,end=byId.get(group.endEdgeId)||anchor;
    const startM=group.startOffsetM??group.offsetM,endM=group.endOffsetM??group.offsetM;
    const key=[start.id,Math.round(startM/50),end.id,Math.round(endM/50),anchor.id,Math.round((group.offsetM||0)/10)].join(":");
    const annotate=info=>{
      // Attribute only events at the actual queue head, or immediately
      // ahead on the same directed carriageway, never nearby parallel roads.
      let road=end,metre=endM,remaining=600,cause;
      const seen=new Set();
      while(road&&!seen.has(road.id)&&remaining>=0){
        seen.add(road.id);
        const effect=eventsOn(road.id).filter(x=>x.toM>=metre-road.cellLength&&x.fromM<=metre+remaining)
          .sort((a,b)=>a.fromM-b.fromM)[0];
        if(effect){
          const e=effect.event,lanes=[...e.closedLanes].sort((a,b)=>a-b),n=lanes.length;
          const kind={accident:"Nach einem Unfall",roadworks:"Baustelle",breakdown:"Pannenfahrzeug",closure:"Vollsperrung"}[e.kind];
          let restriction="";
          if(n===road.lanes&&e.shoulder!=="open"||e.kind==="closure")restriction="Alle Fahrstreifen gesperrt";
          else if(n){
            const side=lanes.every((v,i)=>v===road.lanes-n+i)?"linke":lanes.every((v,i)=>v===i)?"rechte":"";
            restriction=n===1?(side?"Der "+side+" Fahrstreifen gesperrt":"Ein Fahrstreifen gesperrt"):
              n+" "+(side?side+" ":"")+"Fahrstreifen gesperrt";
          }
          cause=[kind,restriction].filter(Boolean).join(" · ");break;
        }
        remaining-=Math.max(0,road.lengthM-metre);
        const next=mainlineNext.get(road.id)||[];
        road=next.length===1?next[0]:null;metre=0;
      }
      if(cause)info={...info,cause};
      // The road name is static, but the ramp load can change while the
      // queue endpoints stay in the same cache bucket.
      if(anchor.kind!=="mainline"||!group.endEdgeId)return info;
      const exit=end.links.find(t=>Math.abs(t.fromM-endM)<Math.max(8,end.cellLength)&&
        localTerminal(edges[t.to])&&/\bAS\b/.test(localTerminal(edges[t.to]).name));
      if(!exit)return info;
      const terminal=localTerminal(edges[exit.to]);
      return terminal.enteredVph>=.8*(localDischargeVph(terminal)||700)?
        {...info,bottleneck:"Rückstau an "+junctionLabel(terminal)}:info;
    };
    if(queueLocationCache.has(key))return annotate(queueLocationCache.get(key));
    const info={ref:anchor.ref,kind:anchor.kind,name:anchor.name,
      direction:traffic.referenceForRoad(rowById.get(anchor.id)).key};
    if(anchor.kind==="mainline"){
      const from=motorwayCorridor(start,Math.min(start.lengthM-.01,Math.max(.01,startM+.01)));
      const to=motorwayCorridor(end,Math.min(end.lengthM-.01,Math.max(.01,endM-.01)));
      const first=from?.from,last=to?.to;
      if(first&&last&&first[1]!==last[1]){
        info.location="zwischen "+first[2]+" und "+last[2];
        info.direction=traffic.motorwayDirection(anchor.ref,[first[3],last[3]],"");
      }else if(from||to){
        const section=from||to;
        info.location="zwischen "+section.from[2]+" und "+section.to[2];
        info.direction=traffic.motorwayDirection(anchor.ref,[section.from[3],section.to[3]],"");
      }
      info.destination=destinationAt(anchor,group.offsetM);
      const route=destinationAt(anchor,group.offsetM,true);
      if(route){info.routeOrigin=route.origin;info.routeDestination=route.destination;}
    }else{
      const adjacent=[...incomingTurns[anchor.index].map(t=>t.from),...anchor.links.map(t=>edges[t.to])];
      const named=adjacent.find(r=>r.kind==="ramp"&&r.name)||adjacent.find(r=>r.ref);
      if(!info.ref&&named?.ref)info.ref=named.ref;
      if(!info.name&&named?.name)info.name=named.name;
      if(named&&!anchor.ref)info.direction=traffic.referenceForRoad(rowById.get(named.id)).key;
      info.location=info.name||"Autobahnrampe";
      info.rampRole=entranceOnly(anchor)?"Auffahrt":localTerminal(anchor)?"Abfahrt":/\bAuffahrt\b/.test(info.name)?"Auffahrt":
        /\b(?:AK|AD|Überleitung)\b|→/.test(info.name)?"Überleitung":"Rampe";
      info.destination=rampDestination(anchor,info.rampRole);
      const route=rampDestination(anchor,info.rampRole,true);
      if(route){info.routeOrigin=route.origin;info.routeDestination=route.destination;}
    }
    // Limit memory for an advancing queue; coordinates remain true to the
    // queue's actual endpoint rather than the midpoint of an arbitrary Way.
    if(queueLocationCache.size>128)queueLocationCache.clear();
    queueLocationCache.set(key,info);return annotate(info);
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
    terminalDetours.clear();exitDetours.clear();fallbackExits.clear();fallbackTransfers.clear();dynamicTransferChoices.clear();
    designatedApproach.clear();designatedTransfers.clear();detourPlansKey=null;
    localSourceDetours.clear();transferFallbackByApproach.clear();localSourceCandidates.clear();localSourceChoiceCache.clear();localSourceChoiceMinute=-1;
    wideSourceOptions.clear();wideRoutesByEvent.clear();wideBookings.clear();wideAccounting.clear();
    wideDecisionCache.clear();wideDecisionStamp="";
    routeChanges.clear();routeAccounting.clear();routePaths.clear();routePathCosts.clear();motorwayAlternatives.clear();
    delayCache.clear();delayCacheMinute=-1;directedDelayCache.clear();directedDelayStamp="";
    causeDelayCache.clear();causeDelayStamp="";
    exitChoiceCache.clear();exitChoiceStamp="";
    entranceDelayCache.clear();entranceDelayStamp="";
    clearExitMemo.clear();clearExitStamp="";
    nextDecisionMemo.clear();nextDecisionStamp="";
    closureDiversionForks.clear();closureForkEpoch=-1;
    diversionDecisions.clear();
    enteredStep.fill(0);departedStep.fill(0);
    returnWaitCache.clear();returnWaitMinute=-1;
    entryReachEpoch=-1;
    for(const edge of edges){
      edge.stock.fill(0);edge.entryStock.fill(0);edge.divertStock.fill(0);edge.bypassStock.fill(0);edge.routeStock.fill(null);edge.turnStock.fill(null);edge.voluntaryWaiting.fill(null);
      edge.backlog=0;edge.speed=edge.freeKmh;
      edge.cellFlowSpeeds.fill(edge.freeKmh);edge.brakeMemory.fill(0);edge.platoonProgress.fill(0);
      edge.cellSpeedMovement.fill(0);edge.cellSpeedExposure.fill(0);
      edge.branchSpeed.fill(edge.freeKmh);edge.branchMovement.fill(0);edge.branchExposure.fill(0);
      edge.cellThroughVph.fill(0);edge.cellIncomingVph.fill(0);
      edge.cellCapacityVph.fill(edge.capacityPerLane*edge.lanes);
      edge.cellReceivingVph.fill(edge.capacityPerLane*edge.lanes);
      edge.lastProfileMinute=-1;edge.profileFactor=0;
      edge.enteredVph=0;edge.departedVph=0;
    }
    for(const fork of forks)fork.active=false;
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
    updateEffects();
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
        // A closure already active at simulation start is empty. Only
        // vehicles actually present when a later closure begins evacuate.
        if((activeEffects.get(edge.id)||NO_EFFECTS).some(s=>s.event.kind==="closure"&&
          s.fromM<(k+1)*edge.cellLength-.001&&s.toM>k*edge.cellLength+.001))continue;
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
  // Weekday/friday/weekend profiles with motorway-specific through demand,
  // shared with the full-map adapter. Local ramp demand remains separate.
  function sourceFactor(edge,time){
    const minute=Math.floor(time/60000);
    if(edge.lastProfileMinute!==minute){
      const factor=key=>traffic.profileFactor(key,edge.externalTransferOrigin?"A48":edge.ref,
        time,rowById.get(edge.id)[4],edge.externalTransferOrigin?"mainline":edge.kind);
      edge.profileFactor=edge.localProfiles?.length>1?edge.localProfiles.reduce((sum,p)=>
        sum+p.peak*factor(p.key),0)/edge.referencePeakVph:factor(edge.directionKey);
      edge.lastProfileMinute=minute;
    }
    return edge.profileFactor;
  }
  const localTurnScaleCache=new Map();
  let localTurnScaleMinute=-1;
  // When long-distance demand grows, the regular local destinations cannot
  // consume the same fraction as at rush hour. Scale only the ordinary
  // local off-ramp weights, never motorway-to-motorway transfer weights or
  // forced diversions. The vehicles remaining on the mainline are conserved.
  function localTurnScale(edge){
    const now=clockMs(),minute=Math.floor(now/60000);
    if(minute!==localTurnScaleMinute){localTurnScaleCache.clear();localTurnScaleMinute=minute;}
    if(localTurnScaleCache.has(edge.id))return localTurnScaleCache.get(edge.id);
    const row=rowById.get(edge.id),profile=traffic.referenceForRoad(row);
    const through=traffic.profileFactor(profile.key,edge.ref,now,row[4],"mainline");
    const local=traffic.profileFactor(profile.key,edge.ref,now,row[4],"ramp");
    const scale=through>0?Math.max(.15,Math.min(1,local/through)):1;
    localTurnScaleCache.set(edge.id,scale);return scale;
  }
  function closureMatches(effect,eventId){
    return !eventId||effect.event.id===eventId||effect.contributingClosureIds?.includes(eventId);
  }
  function closureDistanceAhead(edge,offsetM,maxDistance=16000,eventId=null,stayOnRef=false){
    let current=edge,from=Math.max(0,offsetM),travelled=0;
    const visited=new Set();
    for(let hops=0;hops<1200&&travelled<=maxDistance;hops++){
      if(visited.has(current.id))return Infinity;
      visited.add(current.id);
      const effects=activeEffects.get(current.id)||NO_EFFECTS;
      let nearest=Infinity,matched=false;
      for(const item of effects){
        if(item.event.kind!=="closure"||item.fromM<from-.01)continue;
        const distance=travelled+item.fromM-from;
        if(distance<=maxDistance&&distance<nearest-.001){nearest=distance;matched=closureMatches(item,eventId);}
        else if(Math.abs(distance-nearest)<.001)matched ||= closureMatches(item,eventId);
      }
      if(Number.isFinite(nearest))return matched?nearest:Infinity;
      // Keep the same motorway where it continues. But when a route ends
      // directly into exactly one OTHER motorway (e.g. A59→A3 at Heumar),
      // look ahead across that true directed OSM connection as well. Without
      // this, A59 cars would stop at the A3 barrier instead of exiting early.
      const through=current.next.filter(link=>
        edges[link.to].kind==="mainline"&&!visited.has(edges[link.to].id));
      const same=through.filter(link=>edges[link.to].ref===current.ref);
      // A remote barrier reached only after CHANGING motorway number is not
      // a mandatory local off-ramp departure on the original carriageway.
      // Closure propagation elsewhere still uses the ordinary graph walk.
      const next=same.length===1?same:!stayOnRef&&!same.length&&through.length===1?through:[];
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
  function closureExposureAhead(edge,offsetM=0,maxDistance=25000,eventId=null){
    // Traffic exposure only changes when the closure catalog or active
    // schedule changes, NOT on every 5-second CTM tick. Keep this graph
    // analysis cached across timesteps for iPhone/SPCK performance.
    const stamp=exposureEpoch;
    if(exposureStamp!==stamp){exposureCache.clear();exposureStamp=stamp;}
    const cacheKey=edge.id+":"+Math.floor(offsetM/100)+":"+maxDistance+":"+(eventId||"*");
    if(exposureCache.has(cacheKey))return exposureCache.get(cacheKey);
    const examine=(current,from,remaining,seen,depth)=>{
      if(depth>=160||remaining<=0||seen.has(current.id))return 0;
      let gate=null,matched=false;
      for(const effect of activeEffects.get(current.id)||NO_EFFECTS){
        if(effect.event.kind!=="closure"||effect.toM<from+.01)continue;
        if(effect.fromM-from<=remaining&&(!gate||effect.fromM<gate.fromM-.001)){
          gate=effect;matched=closureMatches(effect,eventId);
        }else if(gate&&Math.abs(effect.fromM-gate.fromM)<.001)matched ||= closureMatches(effect,eventId);
      }
      if(gate)return matched?1:0;
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
  // Trace the destination share through actual motorway forks, including
  // transfers after the source motorway ends (A48 -> A3 is not special).
  const bottleneckExposureCache=new Map();let bottleneckExposureEpoch=-1;
  function bottleneckExposureAhead(edge,offsetM,targetId){
    if(bottleneckExposureEpoch!==exposureEpoch){
      bottleneckExposureCache.clear();bottleneckExposureEpoch=exposureEpoch;
    }
    if(!byId.has(targetId))return 0;
    // The former forward DFS stopped after 160 tiny OSM Ways. A driver at
    // an earlier AS then appeared entirely unaffected by a multi-hour jam.
    // Work backwards from the real target once, using actual directed OSM
    // links. Cache the result for every approaching motorway and ramp.
    if(!bottleneckExposureCache.has(targetId)){
      const target=byId.get(targetId),prob=new Map([[target.index,1]]);
      const distance=new Map([[target.index,0]]);
      const pending=[{index:target.index,p:1,metres:0}];
      const maxDistanceM=250000;
      for(let i=0;i<pending.length&&i<20000;i++){
        const {index,p,metres}=pending[i];
        if(p+1e-8<(prob.get(index)||0)||metres>(distance.get(index)??Infinity)+.01)continue;
        for(const {from,turn} of incomingTurns[index]){
          const next=edges[turn.to];
          if(!next||next.index!==index)continue;
          const travelled=metres+Math.max(1,turn.fromM);
          if(travelled>maxDistanceM)continue;
          const links=from.next.filter(t=>edges[t.to].kind==="mainline"||
            edges[t.to].kind==="ramp");
          if(!links.length)continue;
          const same=from.kind==="mainline"?links.filter(t=>
            edges[t.to].kind==="mainline"&&edges[t.to].ref===from.ref):[];
          const isThrough=same.some(t=>t.to===index);
          // Keep through-bound long-distance drivers on their motorway.
          // Local turnoffs are not assumed to steal a fixed percentage at
          // each AS. At a genuine AD/AK split with no same-ref continuation,
          // divide unknown destinations across open motorway arms.
          const ratio=same.length?(isThrough?1/same.length:
            .25/Math.max(1,links.length-same.length)):1/links.length;
          const score=p*ratio,old=prob.get(from.index)||0;
          const oldDist=distance.get(from.index)??Infinity;
          if(score>old+1e-8||Math.abs(score-old)<=1e-8&&travelled<oldDist-.01){
            prob.set(from.index,score);distance.set(from.index,travelled);
            pending.push({index:from.index,p:score,metres:travelled});
          }
        }
      }
      bottleneckExposureCache.set(targetId,prob);
    }
    return bottleneckExposureCache.get(targetId).get(edge.index)||0;
  }
  function blockedMovement(from,link){
    updateEffects();
    const target=edges[link.to];
    if(!target)return false;
    const upstream=activeEffects.get(from.id)||NO_EFFECTS;
    // A gate can lie inside a numerical cell which also contains a later
    // motorway turn. Cars in that approach cell are NOT already inside.
    // Allow the exit at the actual gate, but forbid jumping across it via
    // a downstream in-cell link (even when its target is open).
    if(upstream.some(s=>s.event.kind==="closure"&&s.gate&&
      s.fromM>link.fromCell*from.cellLength+.001&&
      s.fromM<= (link.fromCell+1)*from.cellLength+.001&&link.fromM>s.fromM+.05))return true;
    const toEffects=activeEffects.get(target.id)||NO_EFFECTS;
    const feederBlocks=blockedFeederTurns.get(link)||NO_EFFECTS;
    if(!toEffects.length&&!feederBlocks.length)return false;
    const alreadyInside=(id,allowJoint=false)=>upstream.some(inside=>(inside.event.id===id||
      allowJoint&&jointClosureSpans.length&&inside.derivedFeederClosure&&inside.event.kind==="closure")&&
      link.fromM>=inside.fromM-.05&&link.fromM<=inside.toM+.05&&
      (!inside.gate||link.fromM>inside.fromM+.05));
    if(feederBlocks.some(id=>!alreadyInside(id,true)))return true;
    return toEffects.some(item=>{
      if(link.toM>=item.toM-.05)return false;
      if(link.toM<item.fromM-.05)return false;
      if(item.event.kind!=="closure"&&
        (item.event.closedLanes.length!==target.lanes||
        item.event.shoulder==="open"))return false;
      // Only cars physically inside THIS closure may evacuate along it.
      // A different open section of the same long Way grants no exemption.
      return !alreadyInside(item.event.id,item.event.kind==="closure");
    });
  }
  // Willingness depends on observed delay, not ramp receiving capacity.
  // Ordinary destinations and mandatory road closures are handled separately.
  const VOLUNTARY_START_MIN=45;
  function diversionShare(delayMin){
    if(delayMin>=480)return .90;
    if(!Number.isFinite(delayMin)||delayMin<VOLUNTARY_START_MIN)return 0;
    const anchors=[[45,.01],[60,.02],[90,.15],[120,.32],[150,.44],[180,.55],[240,.70],[360,.82],[480,.90]];
    for(let i=1;i<anchors.length;i++){
      const [end,upper]=anchors[i], [start,lower]=anchors[i-1];
      if(delayMin<=end){
        const t=(delayMin-start)/(end-start);
        return lower+(upper-lower)*t;
      }
    }
    return .90;
  }
  // Distance can strengthen an already eligible decision, never initiate it.
  function lengthDiversionShare(metres){
    if(!Number.isFinite(metres)||metres<3000)return 0;
    const points=[[3000,.02],[5000,.07],[10000,.22],[20000,.45],[30000,.65]];
    for(let i=1;i<points.length;i++){
      const [a,lo]=points[i-1],[b,hi]=points[i];
      if(metres<=b)return lo+(hi-lo)*(metres-a)/(b-a);
    }
    return .65;
  }
  // Long-distance navigation is a separate decision from a local AS exit.
  // Four hours do NOT force every car off; with 10 hours of delay most
  // through traffic prefers a genuinely available regional alternative.
  function wideDiversionShare(delay){
    if(!(delay>=VOLUNTARY_START_MIN))return 0;
    const anchors=[[45,.005],[60,.02],[120,.05],[180,.08],[240,.25],[360,.55],[480,.78],[600,.90]];
    for(let i=1;i<anchors.length;i++){
      const [lo,a]=anchors[i-1],[hi,b]=anchors[i];
      if(delay<=hi)return a+(b-a)*(delay-lo)/(hi-lo);
    }
    return .90;
  }
  const delayCache=new Map();
  let delayCacheMinute=-1;
  // Project excess travel time over physically consecutive same-direction OSM
  // cells only. No guessing a detour over unimported public roads.
  function measuredDelayAhead(edge,offsetM,maxDistance=50000){
    const minute=Math.floor(elapsed/60);
    if(minute!==delayCacheMinute){delayCache.clear();delayCacheMinute=minute;}
    const key=edge.id+":"+Math.round(offsetM*100)+":"+maxDistance;
    if(delayCache.has(key))return delayCache.get(key);
    let current=edge,from=Math.max(0,offsetM),distance=0,delay=0;
    const seen=new Set();
    while(distance<maxDistance){
      if(seen.has(current.id))break;
      seen.add(current.id);
      const start=Math.max(0,Math.floor(from/current.cellLength));
      for(let i=start;i<current.n&&distance<maxDistance;i++){
        const metres=Math.min(maxDistance-distance,
          (i+1)*current.cellLength-Math.max(from,i*current.cellLength));
        if(metres<=0)continue;
        const {count,storage}=throughOccupancy(current,i);
        const v=Math.max(1,measuredCellSpeed(current,i,count,storage));
        delay+=Math.max(0,metres/1000*60*(1/v-1/current.freeKmh));
        distance+=metres;
      }
      const next=current.next.filter(x=>{
        const target=edges[x.to];
        return target.kind==="mainline"&&target.ref===edge.ref&&!seen.has(target.id);
      });
      if(next.length!==1)break;
      current=edges[next[0].to];from=next[0].toM;
    }
    const result=Math.min(1440,delay);
    delayCache.set(key,result);
    return result;
  }
  // A queue downstream of an exit can have the diversion itself as its
  // apparent head. Do not promote that secondary queue to a new incident
  // whose "return" would be BEFORE the actual original accident.
  function mainlineEventAhead(road,offset){
    let current=road,from=offset;
    const seen=new Set();
    while(current&&!seen.has(current.id)){
      seen.add(current.id);
      if((activeEffects.get(current.id)||NO_EFFECTS).some(x=>
        ["closure","accident","roadworks","breakdown"].includes(x.event.kind)&&
        x.toM>from+.05))return true;
      const next=current.next.filter(t=>edges[t.to].kind==="mainline"&&
        edges[t.to].ref===road.ref);
      if(next.length!==1)break;
      current=edges[next[0].to];from=next[0].toM;
    }
    return false;
  }
  const entranceDelayCache=new Map();let entranceDelayStamp="";
  function entranceDiversionShare(entrance){
    const stamp=exposureEpoch+":"+Math.floor(elapsed/60);
    if(entranceDelayStamp!==stamp){entranceDelayCache.clear();entranceDelayStamp=stamp;}
    if(entranceDelayCache.has(entrance.index))return entranceDelayCache.get(entrance.index);
    const arrivals=rampMainlineArrivals(entrance,(a,b)=>!blockedMovement(a,b));
    const result=arrivals.length?Math.min(...arrivals.map(a=>
      localDiversionShare(a.road,a.metre,measuredDelayAhead(a.road,a.metre,Infinity),null))):0;
    entranceDelayCache.set(entrance.index,result);return result;
  }
  // Sum the delays over the actual directed journey toward a bottleneck.
  // This follows A48 -> transfer ramp -> A3 (or any other sequence), rather
  // than stopping at a motorway-number boundary as measuredDelayAhead does.
  // An unrelated destination branch is NEVER charged this delay.
  const directedDelayCache=new Map();let directedDelayStamp="";
  const directedReachCache=new Map();let directedReachEpoch=-1;
  function directedDelayToCause(road,offset,causeId,targetOffset=null,untilNextExit=false,queuedOnly=false,freeOnly=false){
    const stamp=exposureEpoch+":"+Math.floor(elapsed/60);
    if(directedDelayStamp!==stamp){directedDelayCache.clear();directedDelayStamp=stamp;}
    const key=road.id+":"+Math.round(offset*100)+":"+causeId+":"+(targetOffset??"end");
    if(directedDelayCache.has(key)){
      const cached=directedDelayCache.get(key);
      return freeOnly?cached.free:untilNextExit?cached.nextExitDelay:queuedOnly?cached.queueDelay:cached.delay;
    }
    // Exclude dead-end branches before doing the direction-sensitive route
    // search. The reachability graph changes only when gates change, not
    // every second that the traffic moves.
    if(directedReachEpoch!==exposureEpoch){directedReachCache.clear();directedReachEpoch=exposureEpoch;}
    if(!directedReachCache.has(causeId)){
      if(directedReachCache.size>128)directedReachCache.clear();
      const target=byId.get(causeId),seen=new Set(),work=target?[target]:[];
      for(let i=0;i<work.length;i++){
        const next=work[i];if(seen.has(next.id))continue;seen.add(next.id);
        for(const {from,turn} of incomingTurns[next.index]){
          if(seen.has(from.id)||next.kind==="ramp"&&localTerminal(next)||
            blockedMovement(from,turn)&&next.id!==causeId)continue;
          work.push(from);
        }
      }
      directedReachCache.set(causeId,seen);
    }
    const reachableCause=directedReachCache.get(causeId);
    const maxDistance=180000,memo=new Map();
    const loss=(edge,start,end)=>{
      let total=0,queueDelay=0;
      const begin=Math.max(0,Math.min(edge.lengthM,start));
      const bands=navigationQueueBands.get(edge.id)||NO_EFFECTS;
      for(let k=Math.floor(begin/edge.cellLength);k<edge.n&&k*edge.cellLength<end;k++){
        const lo=Math.max(begin,k*edge.cellLength),hi=Math.min(end,(k+1)*edge.cellLength);
        const metres=Math.max(0,hi-lo);
        if(metres<=0)continue;
        const speed=routingCellSpeed(edge,k);
        const perMetre=Math.max(0,.06*(1/speed-1/edge.freeKmh));
        total+=metres*perMetre;
        for(const b of bands)queueDelay+=Math.max(0,Math.min(hi,b.toM)-Math.max(lo,b.fromM))*perMetre;
      }
      return {delay:total,queueDelay};
    };
    const nextExitOnSegment=(edge,start,end,initial)=>{
      if(edge.kind!=="mainline")return Infinity;
      let at=Infinity;
      for(const turn of edge.links)if(turn.fromM>start+(initial ? .05 : -.05)&&turn.fromM<=end+.05&&
        localTerminal(edges[turn.to])&&!blockedMovement(edge,turn))at=Math.min(at,turn.fromM);
      return Number.isFinite(at)?loss(edge,start,at).delay:Infinity;
    };
    const visit=(current,start,distance,seen,depth,usedRefs,lastCorridor)=>{
      if(depth>300||distance>maxDistance||seen.has(current.id)||!reachableCause.has(current.id))return null;
      // An original destination is not reached by driving down a motorway,
      // turning around at another AK and coming back on its opposite side.
      // Track the directed carriageway, not a local compass bearing of a Way.
      if(current.kind==="mainline"){
        const corridor=directedCorridorIds.get(current.index);
        if(corridor!==lastCorridor){
          if(usedRefs.has(current.ref))return null;
          usedRefs=new Set(usedRefs);usedRefs.add(current.ref);lastCorridor=corridor;
        }
      }
      if(current.id===causeId){
        const end=targetOffset===null?current.lengthM:Math.min(current.lengthM,targetOffset);
        if(end<start-.05)return null;
        const metres=Math.max(0,end-start);
        return {free:metres*.06/current.freeKmh,
          ...loss(current,start,end),nextExitDelay:nextExitOnSegment(current,start,end,depth===0)};
      }
      const memoKey=current.id+":"+Math.round(start/10)+":"+[...usedRefs].sort().join(",")+":"+lastCorridor;
      if(memo.has(memoKey))return memo.get(memoKey);
      const visited=new Set(seen);visited.add(current.id);
      let result=null;
      for(const turn of current.links){
        if(turn.fromM<start-.05||blockedMovement(current,turn)&&
          edges[turn.to].id!==causeId)continue;
        const next=edges[turn.to];
        if(!next||next.kind==="ramp"&&localTerminal(next))continue;
        const approach=Math.max(0,turn.fromM-start);
        if(distance+approach>maxDistance)continue;
        const downstream=visit(next,turn.toM,distance+approach,visited,depth+1,usedRefs,lastCorridor);
        if(!downstream)continue;
        const segmentLoss=loss(current,start,turn.fromM);
        const localExit=nextExitOnSegment(current,start,turn.fromM,depth===0);
        const candidate={free:approach*.06/current.freeKmh+downstream.free,
          delay:segmentLoss.delay+downstream.delay,queueDelay:segmentLoss.queueDelay+downstream.queueDelay,
          nextExitDelay:Number.isFinite(localExit)?localExit:segmentLoss.delay+downstream.nextExitDelay};
        // First identify the normal shortest FREE-FLOW route to the
        // obstruction. The old minimum-delay search silently chose huge
        // loops that avoided the queue and therefore reported zero loss.
        if(!result||candidate.free<result.free-1e-6||
          Math.abs(candidate.free-result.free)<=1e-6&&
          candidate.delay<result.delay)result=candidate;
      }
      memo.set(memoKey,result);return result;
    };
    const path=visit(road,Math.max(0,offset),0,new Set(),0,new Set(),null);
    const result=path||{free:Infinity,delay:Infinity,queueDelay:Infinity,nextExitDelay:Infinity};
    directedDelayCache.set(key,result);return freeOnly?result.free:untilNextExit?result.nextExitDelay:queuedOnly?result.queueDelay:result.delay;
  }
  // Actual travel to a downstream fork on the same directed motorway.
  // For a complete closure compare EXIT routes, never a fictitious drive
  // through the barrier. The later exit may be clear even when the road
  // beyond it is closed for hours.
  function corridorMinutes(road,offset,target,targetOffset){
    let current=road,from=offset,minutes=0;
    const seen=new Set();
    while(current&&!seen.has(current.id)){
      seen.add(current.id);
      const end=current===target?targetOffset:current.lengthM;
      if(end<from-.01)return Infinity;
      for(let k=Math.floor(from/current.cellLength);k<current.n&&k*current.cellLength<end;k++){
        const metres=Math.max(0,Math.min(end,(k+1)*current.cellLength)-Math.max(from,k*current.cellLength));
        minutes+=metres*.06/routingCellSpeed(current,k);
      }
      if(current===target)return minutes;
      const next=current.next.filter(link=>edges[link.to].kind==="mainline"&&edges[link.to].ref===road.ref);
      if(next.length!==1)return Infinity;
      current=edges[next[0].to];from=0;
    }
    return Infinity;
  }
  // A missing graph path is not infinite travel time. Only a physically
  // reached, blocked section can justify treating the original route as
  // impassable. This also excludes congestion behind the current fork.
  const directCostCache=new Map();let directCostStamp="";
  function directCorridorCost(road,offset,target,targetOffset){
    const stamp=exposureEpoch+":"+Math.floor(elapsed/60);
    if(stamp!==directCostStamp){directCostCache.clear();directCostStamp=stamp;}
    const key=road.id+":"+offset+":"+target.id+":"+targetOffset;
    if(directCostCache.has(key))return directCostCache.get(key);
    const result=computeDirectCorridorCost(road,offset,target,targetOffset);
    directCostCache.set(key,result);return result;
  }
  function computeDirectCorridorCost(road,offset,target,targetOffset){
    let current=road,from=offset,minutes=0,blocked=false;
    const seen=new Set();
    while(current&&!seen.has(current.id)){
      seen.add(current.id);
      const end=current===target?targetOffset:current.lengthM;
      if(end<from-.01)return NaN;
      const effects=activeEffects.get(current.id)||NO_EFFECTS;
      for(const item of effects)if(item.fromM<end-.001&&item.toM>from+.001&&
        (item.event.kind==="closure"||item.event.closedLanes.length>=current.lanes&&item.event.shoulder!=="open"))blocked=true;
      for(let k=Math.floor(from/current.cellLength);k<current.n&&k*current.cellLength<end;k++){
        const metres=Math.max(0,Math.min(end,(k+1)*current.cellLength)-Math.max(from,k*current.cellLength));
        minutes+=metres*.06/routingCellSpeed(current,k);
      }
      if(current===target)return blocked?Infinity:minutes;
      const next=current.links.filter(t=>t.fromM>=current.lengthM-.05&&
        edges[t.to].kind==="mainline"&&edges[t.to].ref===road.ref&&!seen.has(edges[t.to].id));
      if(next.length!==1)return NaN;
      current=edges[next[0].to];from=next[0].toM;
    }
    return NaN;
  }
  function routingCellSpeed(edge,k){
    const {count,storage}=throughOccupancy(edge,k);
    return Math.max(1,measuredCellSpeed(edge,k,count,storage));
  }
  // Measure the queue attached to the actual bottleneck, not every slow
  // cell between an origin and the incident. In particular, a stranded
  // off-ramp queue beyond a freely flowing gap is not the incident's delay.
  const causeDelayCache=new Map();let causeDelayStamp="";
  function connectedQueueDelay(road,offset){
    const stamp=exposureEpoch+":"+Math.floor(elapsed/60);
    if(causeDelayStamp!==stamp){causeDelayCache.clear();causeDelayStamp=stamp;}
    const key=road.id+":"+Math.round(offset);
    if(causeDelayCache.has(key))return causeDelayCache.get(key);
    let current=road,end=Math.min(road.lengthM,offset+road.cellLength),gap=0,delay=0;
    const seen=new Set();
    outer:while(current&&!seen.has(current.id)){
      seen.add(current.id);
      for(let k=Math.min(current.n-1,Math.ceil(end/current.cellLength)-1);k>=0;k--){
        const metres=Math.min(end,(k+1)*current.cellLength)-k*current.cellLength;
        const {count,storage}=throughOccupancy(current,k);
        const speed=routingCellSpeed(current,k);
        if(count>=Math.max(2,current.lanes*1.2)&&count/Math.max(.001,storage)>.23&&speed<=65){
          if(gap>0&&delay>0&&exitBacklogAtHead(current,(k+1)*current.cellLength))break outer;
          delay+=Math.max(0,metres*.06*(1/speed-1/current.freeKmh));gap=0;
        }else if((gap+=metres)>600)break outer;
      }
      let predecessors=incomingTurns[current.index].filter(({from,turn})=>
        from.kind===current.kind&&from.ref===current.ref&&turn.toM<.05&&
        turn.fromM>=from.lengthM-.05&&!seen.has(from.id));
      // An actual obstructed motorway-to-motorway connector can back up
      // onto its feeder. Unlike a public-road exit, it belongs to the same
      // through journey. Follow its unique mapped approach, including a
      // real interior fork, rather than truncating its delay at the ramp.
      if(!predecessors.length&&current.kind==="ramp"&&!localTerminal(current))
        predecessors=incomingTurns[current.index].filter(({from,turn})=>turn.toM<.05&&
          !seen.has(from.id)&&(from.kind==="mainline"||!localTerminal(from)));
      if(predecessors.length!==1)break;
      current=predecessors[0].from;end=predecessors[0].turn.fromM;
    }
    causeDelayCache.set(key,delay);return delay;
  }
  function exitBacklogAtHead(road,offset){
    const backed=(edge,at)=>edge.links.some(t=>Math.abs(t.fromM-at)<=road.cellLength*1.5&&
      localTerminal(edges[t.to])&&edges[t.to].stock[0]>.25*edges[t.to].jamPerCell);
    return backed(road,offset)||road.lengthM-offset<road.cellLength&&road.next.some(t=>
      edges[t.to].kind==="mainline"&&edges[t.to].ref===road.ref&&backed(edges[t.to],t.toM));
  }
  function primaryPlanDelay(plan){
    const cause=byId.get(plan?.causeEdgeId);
    if(!cause)return 0;
    if(plan.kind==="congestion"){
      return Math.max(0,...jamGroups.filter(g=>g.endEdgeId===cause.id&&
        !exitBacklogAtHead(cause,g.endOffsetM)).map(g=>connectedQueueDelay(cause,g.endOffsetM)));
    }
    const effects=(activeEffects.get(cause.id)||NO_EFFECTS).filter(x=>x.event.kind===plan.kind&&
      (plan.closureId===x.event.id||plan.closureId?.startsWith(x.event.id+":")));
    return Math.max(0,...effects.map(x=>connectedQueueDelay(cause,x.fromM)));
  }
  function exitTravelMinutes(link,plan){
    const first=edges[link.to],terminal=edges[plan.terminal];
    const nominal=localDischargeRate(terminal);
    const service=terminal.stock[terminal.n-1]>terminal.jamPerCell*.35?
      Math.min(nominal,Math.max(30,terminal.departedVph)):nominal;
    const waiting=[...terminal.stock].reduce((a,b)=>a+b,0)*60/service;
    const approach=first===terminal?0:[...first.stock].reduce((a,b)=>a+b,0)*60/service;
    return plan.durationS/60+waiting+approach+returnWaitMinutes(plan.reentry)+
      (first.lengthM+(first===terminal?0:terminal.lengthM))*.06/first.freeKmh;
  }
  const returnWaitCache=new Map();let returnWaitMinute=-1;
  function returnWaitMinutes(reentry){
    const minute=Math.floor(elapsed/60);
    if(returnWaitMinute!==minute){
      returnWaitCache.clear();returnWaitMinute=minute;
      for(const trip of detourTrips){
        // Include demand already booked to this return over the next
        // fifteen minutes, not distant trips on the other side of the map.
        if(trip.readyAt>elapsed+900)continue;
        returnWaitCache.set(trip.reentry,(returnWaitCache.get(trip.reentry)||0)+trip.vehicles);
      }
    }
    const ramp=edges[reentry];
    if(ramp.externalDetourDestination)return 0;
    const stock=ramp.stock.reduce((a,b)=>a+b,0);
    const nominal=Math.min(localAdmissionRate(ramp),ramp.capacityPerLane*ramp.lanes);
    const congested=stock>ramp.n*ramp.jamPerCell*.30;
    const service=congested?Math.min(nominal,Math.max(30,ramp.departedVph)):nominal;
    return ((returnWaitCache.get(reentry)||0)+ramp.backlog+(congested?stock:0))*60/service;
  }
  // The threshold uses actual motorway delay, not net savings after
  // subtracting the local journey time or waiting at the return ramp.
  function observedPlanDelay(road,offset,plan){
    if(!plan?.causeEdgeId)return 0;
    const delay=directedDelayToCause(road,offset,plan.causeEdgeId);
    if(Number.isFinite(delay)){
      if(plan.kind==="closure")return delay;
      const cumulative=directedDelayToCause(road,offset,plan.causeEdgeId,null,false,true);
      return Math.max(Math.min(delay,primaryPlanDelay(plan)),Number.isFinite(cumulative)?cumulative:0);
    }
    // A missing path is not a measured queue. A real closure can however
    // interrupt that path; measure its still-reachable approach.
    if(plan.kind==="closure"&&Number.isFinite(
      closureDistanceAhead(road,offset,Infinity,plan.closureId)))
      return measuredDelayAhead(road,offset,Infinity);
    return 0;
  }
  const exitChoiceCache=new Map();let exitChoiceStamp="";
  function exitChoiceShare(road,link,plan){
    if(!plan)return closureFingerprint&&Number.isFinite(closureDistanceAhead(road,link.fromM,Infinity))?
      localDiversionShare(road,link.fromM,measuredDelayAhead(road,link.fromM,Infinity),null):
      unplannedExitShare(road,link.fromM);
    const stamp=exposureEpoch+":"+Math.floor(elapsed/60);
    if(exitChoiceStamp!==stamp){exitChoiceCache.clear();exitChoiceStamp=stamp;}
    const key=road.id+":"+link.fromM+":"+link.to+":"+plan.closureId;
    if(exitChoiceCache.has(key))return exitChoiceCache.get(key);
    const delay=observedPlanDelay(road,link.fromM,plan);
    let share=localDiversionShare(road,link.fromM,delay,plan);
    if(share>0&&plan.kind!=="closure"){
      const directFree=Math.min(...rampMainlineArrivals(edges[plan.reentry]).map(a=>
        directedDelayToCause(road,link.fromM,a.road.id,a.metre,false,false,true)));
      if(exitTravelMinutes(link,plan)+5>=delay+(Number.isFinite(directFree)?directFree:0))share=0;
    }
    exitChoiceCache.set(key,share);
    return share;
  }
  // A ramp is a usable diversion only if its genuine OSM turns do not lead
  // exclusively into the closed sector. Existing open motorway branches or an
  // actual external ramp end are acceptable; no artificial re-entry points.
  function isUsableEscape(from,turn,visited=new Set(),depth=0){
    if(depth>16||blockedMovement(from,turn))return false;
    const target=edges[turn.to];
    if(!target||visited.has(target.id))return false;
    if(target.kind==="mainline")
      return closureDistanceAhead(target,turn.toM,Infinity)===Infinity;
    visited.add(target.id);
    if(!target.links.length)return true;
    for(const move of target.links){
      if(isUsableEscape(target,move,new Set(visited),depth+1))return true;
    }
    return false;
  }
  // Do not force diverted vehicles off at every AS on the approach.
  // Find whether a LATER usable exit/alternative fork exists BEFORE the
  // first physical closure gate, following only real directed through-links.
  // No kilometre or radius threshold decides which AS is the last exit.
  const laterExitMemo=new Map();
  let laterExitEpoch=-1;
  function laterUsableExitBeforeClosure(road,offset){
    if(laterExitEpoch!==exposureEpoch){
      laterExitMemo.clear();laterExitEpoch=exposureEpoch;
    }
    const key=road.id+":"+Math.round(offset*100);
    if(laterExitMemo.has(key))return laterExitMemo.get(key);
    const pending=[{edge:road,offset}],visited=new Set();
    let result=false;
    for(let i=0;i<pending.length&&i<2000&&!result;i++){
      const {edge,offset:from}=pending[i];
      const visit=edge.id+":"+Math.round(from*10);
      if(visited.has(visit))continue;
      visited.add(visit);
      let gate=edge.lengthM+.1;
      for(const item of activeEffects.get(edge.id)||NO_EFFECTS){
        if(item.event.kind!=="closure")continue;
        if(item.fromM<=from+.01&&item.toM>from+.01){
          gate=from;break;
        }
        if(item.fromM>from+.01)gate=Math.min(gate,item.fromM);
      }
      if(gate<=from+.05)continue;
      for(const link of edge.links){
        const next=edges[link.to];
        if(link.fromM>from+.05&&link.fromM<=gate+.05&&
          (next.kind==="ramp"||
            next.kind==="mainline"&&next.ref!==road.ref)&&
          isUsableEscape(edge,link)){
          result=true;break;
        }
        if(next.kind==="mainline"&&next.ref===road.ref&&
          link.fromM>=edge.lengthM-.1&&
          link.fromM<=gate+.05&&!blockedMovement(edge,link))
          pending.push({edge:next,offset:link.toM});
      }
    }
    laterExitMemo.set(key,result);
    return result;
  }
  // Macro detours: the SPCK file contains true OSM motorway exits/entrances
  // but NOT all intervening city and country roads. We therefore do not draw
  // fictitious streets. Eligible traffic uses its REAL OSM off-ramp, travels
  // in a conserved off-map inventory, and returns only at a REAL directed
  // OSM on-ramp downstream of the closed section. The off-map duration is a
  // documented estimate, not an audited street-by-street shortest path.
  function estimatedOutsideSeconds(exit,entrance,atOrigin=false){
    // Unmapped local/urban road travel is an explicit travel-time estimate.
    const firstPoint=rowById.get(exit.id)[4].at(atOrigin?0:-1);
    const lastPoint=entrance.externalDetourLabel?rowById.get(entrance.id)[4].at(-1):rowById.get(entrance.id)[4][0];
    const lat1=firstPoint[0]*rad,lat2=lastPoint[0]*rad;
    const dlat=lat2-lat1,dlon=(lastPoint[1]-firstPoint[1])*rad;
    const straight=2*R*Math.asin(Math.min(1,Math.sqrt(
      Math.sin(dlat/2)**2+Math.cos(lat1)*Math.cos(lat2)*
      Math.sin(dlon/2)**2)));
    return Math.max(300,180+straight*1.55/(40/3.6)+(entrance.externalDetourLabel?180:0));
  }
  function wideTravelSeconds(origin,route,atOrigin=false){
    const start=rowById.get(origin.id)[4].at(atOrigin?0:-1);
    const end=rowById.get(route.reentry.id)[4][0];
    // Coarse motorway corridor estimate: not a drawn or audited local road
    // itinerary. The real mapped destination is independently validated.
    return Math.max(1800,600+lengthM([start,...route.via,end])*1.25/(85/3.6));
  }
  function wideRouteOpen(route){
    if((activeEffects.get(route.reentry.id)||NO_EFFECTS).some(x=>x.event.kind==="closure"))return false;
    if((activeEffects.get(route.target.id)||NO_EFFECTS).some(x=>x.event.kind==="closure"))return false;
    const path=cohortPath(route.target.index);
    const stamp=routePathEpoch+":"+routePathMinute;
    if(route.validStamp===stamp)return route.valid;
    const seen=new Set(),used=new Map();let edge=route.reentry.index,k=0,valid=false,rejoined=false;
    while(true){
      const segment=edges[edge],key=cellKey(edge,k);
      if(seen.has(key))break;seen.add(key);
      if(segment.kind==="mainline"){
        const corridor=directedCorridorIds.get(edge);
        if(used.has(segment.ref)&&used.get(segment.ref)!==corridor||rejoined&&segment.ref!==route.ref)break;
        used.set(segment.ref,corridor);
        if(segment.ref===route.ref){
          if(corridor!==directedCorridorIds.get(route.target.index)||!route.downstream.has(segment.id)||
            segment.id===route.endEdgeId&&k*segment.cellLength<route.endOffset-.05)break;
          rejoined=true;
        }
      }
      const next=path.get(key);
      if(!next){valid=rejoined&&edge===route.target.index&&k===route.target.n-1;break;}
      edge=next.to;k=next.toCell;
    }
    route.validStamp=stamp;route.valid=valid;return valid;
  }
  function wideSourceChoice(source){
    const options=wideSourceOptions.get(source.index);
    if(!options?.length)return null;
    const stamp=exposureEpoch+":"+Math.floor(elapsed/60);
    if(wideDecisionStamp!==stamp){wideDecisionCache.clear();wideDecisionStamp=stamp;}
    if(wideDecisionCache.has(source.index))return wideDecisionCache.get(source.index);
    let best=null;
    for(const {route,road,metre} of options){
      const delay=observedPlanDelay(road,metre,route),willing=wideDiversionShare(delay);
      if(!willing||!wideRouteOpen(route))continue;
      const durationS=wideTravelSeconds(source,route,true);
      const waiting=Math.max(0,(wideBookings.get(route.id)||0)-elapsed)/60;
      const cost=durationS/60+waiting+returnWaitMinutes(route.reentry.index);
      if(cost+30>=delay)continue;
      // Not every arrival is a long-distance trip. Existing local trips
      // and drivers preferring the original road remain represented.
      const fraction=willing*(source.kind==="mainline"?.70:.45);
      if(best&&best.saving>=delay-cost)continue;
      best={fraction,saving:delay-cost,plan:{terminal:source.index,
        reentry:route.reentry.index,durationS,kind:"wide",closureId:route.closureId,
        entries:[{reentry:route.reentry.index,distanceM:0,weight:1,durationS,
          closureId:route.closureId,wideRoute:route}]}};
    }
    wideDecisionCache.set(source.index,best);return best;
  }
  // The aggregate cell-flow engine does not yet know individual OD pairs.
  // Without that information, ALL vehicles continuing on this motorway must
  // return at the FIRST lawful on-ramp after the obstruction. Later ramps are
  // retained as physical candidates for future real OD-route assignments,
  // but do not receive arbitrary invented 82/14/4 destination shares.
  function destinationWeights(count){
    return Array.from({length:count},(_,i)=>i===0?1:0);
  }
  // Only a real off-ramp ending at a public road is a local diversion.
  // Motorway-to-motorway connectors are not local exits.
  const localTerminalMemo=new Map();
  function localTerminal(first){
    if(localTerminalMemo.has(first.index))return localTerminalMemo.get(first.index);
    const work=[first],seen=new Set();let end=null;
    for(let i=0;i<work.length&&i<40;i++){
      const ramp=work[i];
      if(ramp.kind!=="ramp"||seen.has(ramp.id))continue;
      seen.add(ramp.id);
      if(!ramp.links.length&&boundaryExit[ramp.index]&&
        !/\b(?:AK|AD|Autobahnkreuz|Autobahndreieck)\b/i.test(ramp.name)){
        end=ramp;break;
      }
      for(const turn of ramp.links)
        if(edges[turn.to].kind==="ramp")work.push(edges[turn.to]);
    }
    localTerminalMemo.set(first.index,end);return end;
  }
  function localDischargeVph(edge){
    return edge?.kind==="ramp"&&localTerminal(edge)===edge?
      junctionCapacity(edge,false,localRoundaboutBoundaries.has(edge.index)?1:Math.min(2,edge.lanes)):null;
  }
  function junctionCapacity(edge,entry,lanes){
    const profile=traffic.junctionProfile(edge.ref,edge.name);
    return ((entry?profile?.entryCapacity:profile?.exitCapacity)??700)*lanes;
  }
  let capacityMinute=-1,exitRelief=1,entryRelief=1;
  function capacityRelief(entry){
    const minute=Math.floor(clockMs()/60000);
    if(capacityMinute!==minute){
      capacityMinute=minute;
      const {hour}=traffic.localClock(clockMs());
      exitRelief=traffic.junctionCapacityFactor(hour);
      entryRelief=traffic.junctionCapacityFactor(hour,true);
    }
    return entry?entryRelief:exitRelief;
  }
  function effectiveJunctionCapacity(edge,nominal,entry=false){
    return Math.min(edge.capacityPerLane*edge.lanes,nominal*capacityRelief(entry));
  }
  // Nominal capacity is an upper bound, not a constant discharge. At an
  // overloaded local junction, conflicting traffic produces alternating
  // gaps and short blocked periods. This is a deterministic model estimate,
  // not measured signal timing or a surveyed priority-control plan.
  function localDischargeRate(edge){
    const dayCapacity=localDischargeVph(edge);
    if(dayCapacity===null)return Infinity;
    const nominal=effectiveJunctionCapacity(edge,dayCapacity);
    // Exactly the same junction physics with or without an event. A past
    // detour must not permanently change a ramp's discharge.
    if(edge.stock[edge.n-1]<edge.jamPerCell*.32)return nominal;
    const phase=(Math.floor(clockMs()/15000)+edge.index)%8;
    return nominal*[1,.96,.84,.96,1,.88,.92,1][phase];
  }
  // Several exit branches at one physical public-road junction share its
  // finite service. Counting a separate 700 vph for each tiny OSM link
  // would let a single-lane exit drain unrealistically into the B-road.
  const localExitGroups=[],localExitGroupKeys=new Set();
  for(const main of edges)if(main.kind==="mainline")for(const turn of main.links){
    const first=edges[turn.to],terminal=localTerminal(first);
    if(!terminal)continue;
    const pending=[first],seen=new Set(),members=[];
    for(let i=0;i<pending.length;i++){
      const e=pending[i];if(seen.has(e.index))continue;seen.add(e.index);
      if(localDischargeVph(e)!==null&&junctionLabel(e)===junctionLabel(terminal))members.push(e);
      else for(const t of e.links)if(edges[t.to].kind==="ramp")pending.push(edges[t.to]);
    }
    if(members.length<2)continue;
    const key=members.map(e=>e.index).sort((a,b)=>a-b).join(":");
    if(localExitGroupKeys.has(key))continue;
    localExitGroupKeys.add(key);localExitGroups.push({members,first,capacity:junctionCapacity(terminal,false,Math.min(2,first.lanes))});
  }
  // The public-road junction meters demand into an actual entrance. A
  // queue for that junction belongs outside the motorway model, not on a
  // freely draining on-ramp. Detoured and ordinary traffic share this limit.
  function localAdmissionVph(edge){
    return edge?.kind==="ramp"&&isLocalOrigin(edge)?junctionCapacity(edge,true,Math.min(2,edge.lanes)):Infinity;
  }
  function localAdmissionRate(edge){
    const nominal=localAdmissionVph(edge);
    return Number.isFinite(nominal)?effectiveJunctionCapacity(edge,nominal,true):Infinity;
  }
  // Each calibrated local exit percentage applies to the complete physical
  // exit movement, not to every parallel OSM branch of that exit.
  for(const main of edges)if(main.kind==="mainline")for(const links of main.linksFrom){
    const groups=new Map();
    for(const turn of links){
      const terminal=localTerminal(edges[turn.to]);
      if(!terminal)continue;
      const profile=traffic.junctionProfile(terminal.ref,terminal.name);
      if(!profile?.exitPercent)continue;
      const key=profile.road+":"+profile.ref;
      const group=groups.get(key)||{profile,turns:[]};
      group.turns.push(turn);groups.set(key,group);
    }
    for(const {profile,turns} of groups.values())for(const turn of turns){
      turn.weight=20*profile.exitPercent/(100-profile.exitPercent)/turns.length;
      const next=main.next.find(t=>t.to===turn.to&&t.fromCell===turn.fromCell);
      if(next)next.weight=turn.weight;
    }
  }
  // An AK/AD motorway transfer is not a small local AS exit. Reallocate
  // existing vehicles to genuine direction-connected motorway arms;
  // never create an extra junction source or bypass physical receiving.
  for(const main of edges)if(main.kind==="mainline")for(const turn of main.links){
    const ramp=edges[turn.to];
    if(ramp.kind!=="ramp"||localTerminal(ramp))continue;
    if(!rampMainlineArrivals(ramp).some(a=>a.road.ref!==main.ref))continue;
    turn.weight=Math.max(turn.weight,ramp.lanes>=2?8:5);
    const next=main.next.find(t=>t.to===turn.to&&t.fromCell===turn.fromCell);
    if(next)next.weight=turn.weight;
  }
  // Actual exit-ramp storage, not a nominal motorway-sized cell for every
  // tiny OSM Way. Retain a two-tick numerical minimum on micro-connectors;
  // long ramps store more vehicles in direct proportion to physical length.
  for(const edge of edges){
    if(edge.kind!=="ramp")continue;
    const terminal=localTerminal(edge);
    if(!terminal||!/\bAS\b|Abfahrt/i.test(terminal.name))continue;
    edge.jamPerCell=Math.max(130*edge.lanes*edge.cellLength/1000,
      2*(localDischargeVph(terminal)||700)*5/3600);
  }
  // Walk the directed route, not an arbitrary geographic radius. The first
  // local exit on an alternative motorway handles drivers already past the
  // last exit of their original route.
  function routeForks(road,offset,visit){
    let current=road,from=offset;const seen=new Set();
    while(current&&!seen.has(current.id)&&seen.size<1200){
      seen.add(current.id);
      const gate=(activeEffects.get(current.id)||NO_EFFECTS)
        .filter(s=>s.event.kind==="closure"&&s.toM>from+.05)
        .reduce((m,s)=>Math.min(m,Math.max(from,s.fromM)),current.lengthM+.1);
      for(const turn of [...current.links].sort((a,b)=>a.fromM-b.fromM)){
        if(turn.fromM<from-.01||turn.fromM>gate+.05)continue;
        if(visit(current,turn,gate)===false)return;
      }
      if(gate<current.lengthM-.05)return;
      const next=current.next.filter(t=>edges[t.to].kind==="mainline"&&
        edges[t.to].ref===road.ref&&!blockedMovement(current,t));
      if(next.length!==1)return;
      current=edges[next[0].to];from=next[0].toM;
    }
  }
  function firstLocalExit(road,offset){
    let found=null;
    routeForks(road,offset,(from,turn)=>{
      const end=localTerminal(edges[turn.to]);
      if(end&&isUsableEscape(from,turn)){found={first:turn.to,terminal:end,road:from,metre:turn.fromM};return false;}
    });
    return found;
  }
  const clearExitMemo=new Map();let clearExitStamp="";
  // The delay beyond a later, still freely approachable AS is no reason
  // to leave at the current AS. Follow the directed motorway up to the
  // NEXT lawful local exit and check the actual mapped queue's tail.
  // A saturated off-ramp alone does not close its motorway continuation.
  function hasClearLaterExit(road,offset,includeThroughQueue=false){
    const stamp=exposureEpoch+":"+Math.floor(elapsed/60);
    if(clearExitStamp!==stamp){clearExitMemo.clear();clearExitStamp=stamp;}
    const key=road.id+":"+Math.round(offset*100)+":"+includeThroughQueue;
    if(clearExitMemo.has(key))return clearExitMemo.get(key);
    const later=firstLocalExit(road,offset+.06);
    let result=false;
    if(later){
      let current=road,start=offset;const seen=new Set();
      while(current&&!seen.has(current.id)){
        seen.add(current.id);
        const end=current===later.road?later.metre:current.lengthM;
        if([...(routingQueueBands.get(current.id)||[]),...(includeThroughQueue?(navigationQueueBands.get(current.id)||[]):[])]
          .some(b=>b.toM>start+.05&&b.fromM<end-.05))break;
        if(current===later.road){result=true;break;}
        const next=current.next.filter(t=>edges[t.to].kind==="mainline"&&edges[t.to].ref===road.ref&&!blockedMovement(current,t));
        if(next.length!==1)break;
        current=edges[next[0].to];start=next[0].toM;
      }
    }
    clearExitMemo.set(key,result);return result;
  }
  function closureExitEligible(road,offset,plan){
    const affected=plan?.kind==="closure"||!!closureFingerprint&&Number.isFinite(closureDistanceAhead(road,offset,Infinity));
    return !affected||queueAtExit(road,offset)||!hasClearLaterExit(road,offset);
  }
  // The physical queue must have reached the actual fork, not merely
  // exist many kilometres downstream. Once reached, an open exit remains
  // a valid decision even if the NEXT exit is only a short drive away.
  function queueAtExit(road,offset){
    const tolerance=Math.min(road.cellLength,230);
    // A queue that ENDS at the off-ramp can consist exclusively of cars
    // already turning off. It is not evidence that the remaining through
    // journey is congested. Inspect the continuation beyond the exit.
    const exitBackedUp=exitBacklogAtHead(road,offset);
    if(exitBackedUp){
      const ahead=road.visualBands.some(b=>b.fromM<=offset+tolerance&&b.toM>offset+.05)||
        road.links.some(t=>Math.abs(t.fromM-offset)<.1&&edges[t.to].kind==="mainline"&&edges[t.to].ref===road.ref&&
          edges[t.to].visualBands.some(b=>b.fromM<=t.toM+.05&&b.toM>t.toM));
      if(!ahead)return false;
    }
    if(road.visualBands.some(b=>
      b.fromM<=offset+.05&&b.toM>=offset-tolerance))return true;
    // A fork exactly at a Way boundary can be at the head of the next
    // numerical cell. Check that real continuation, not a distant AS.
    return road.links.some(t=>Math.abs(t.fromM-offset)<.1&&
      edges[t.to].kind==="mainline"&&edges[t.to].ref===road.ref&&
      edges[t.to].visualBands.some(b=>b.fromM<=t.toM+.05&&b.toM>t.toM));
  }
  const nextDecisionMemo=new Map();let nextDecisionStamp="";
  function corridorDelayBetween(road,offset,target,targetOffset){
    let current=road,start=offset,total=0;const seen=new Set();
    while(current&&!seen.has(current.id)){
      seen.add(current.id);
      const end=current===target?targetOffset:current.lengthM;
      if(end<start-.05)return Infinity;
      for(let k=Math.floor(start/current.cellLength);k<current.n&&k*current.cellLength<end;k++){
        const m=Math.max(0,Math.min(end,(k+1)*current.cellLength)-Math.max(start,k*current.cellLength));
        total+=Math.max(0,m*.06*(1/routingCellSpeed(current,k)-1/current.freeKmh));
      }
      if(current===target)return total;
      const next=current.next.filter(t=>edges[t.to].kind==="mainline"&&edges[t.to].ref===road.ref&&!blockedMovement(current,t));
      if(next.length!==1)break;
      current=edges[next[0].to];start=next[0].toM;
    }
    return Infinity;
  }
  // Never copy the distant incident's entire delay to every upstream exit.
  // The next local exit on THIS directed approach is the competing decision.
  // A different motorway arm remains an additional escape at the interchange
  // for vehicles still continuing; it is not a later AS on the original road.
  // Only excess time TO the next local exit can justify shifting upstream.
  // Between two AS only: the nearest next interchange may have an off-ramp
  // OR just an on-ramp in a clipped OSM extract. Never carry the downstream
  // incident's entire loss backward across four or five free junctions.
  // This is geometric directed motorway continuity; NO invented local road.
  function nextDecisionDelay(road,offset){
    const stamp=exposureEpoch+":"+Math.floor(elapsed/60);
    if(nextDecisionStamp!==stamp){nextDecisionMemo.clear();nextDecisionStamp=stamp;}
    const key=road.id+":"+Math.round(offset*100);
    if(nextDecisionMemo.has(key))return nextDecisionMemo.get(key);
    const here=new Set(road.links.filter(t=>Math.abs(t.fromM-offset)<.2&&localTerminal(edges[t.to]))
      .map(t=>junctionLabel(edges[t.to]).toLowerCase()));
    let current=road,start=offset,total=0;const seen=new Set();
    const loss=(edge,a,b)=>{
      let delay=0;
      for(let k=Math.floor(a/edge.cellLength);k<edge.n&&k*edge.cellLength<b;k++){
        const metres=Math.max(0,Math.min(b,(k+1)*edge.cellLength)-Math.max(a,k*edge.cellLength));
        if(metres>0)delay+=metres*.06*(1/routingCellSpeed(edge,k)-1/edge.freeKmh);
      }
      return Math.max(0,delay);
    };
    let found=false;
    while(current&&!seen.has(current.id)&&seen.size<1200){
      seen.add(current.id);
      let nextAt=Infinity;
      for(const t of current.links){
        // At the start of a subsequent OSM Way, a distinct AS is ahead,
        // not the current fork. Only exclude the original decision offset.
        if((current===road?t.fromM<=start+.06:t.fromM<start-.05)||t.fromM>current.lengthM+.05)continue;
        const target=edges[t.to];
        if(localTerminal(target)&&!here.has(junctionLabel(target).toLowerCase()))
          nextAt=Math.min(nextAt,t.fromM);
      }
      for(const {from,turn} of incomingTurns[current.index]){
        if(from.kind!=="ramp"||!isLocalEntrance(from)||(current===road?turn.toM<=start+.06:turn.toM<start-.05))continue;
        if(!here.has(junctionLabel(from).toLowerCase()))nextAt=Math.min(nextAt,turn.toM);
      }
      if(Number.isFinite(nextAt)){
        total+=loss(current,start,nextAt);found=true;break;
      }
      total+=loss(current,start,current.lengthM);
      // Find the NEXT signed AS along this physical directed carriageway.
      // A temporarily blocked incident must not erase that geometry.
      const links=current.next.filter(t=>edges[t.to].kind==="mainline"&&
        edges[t.to].ref===road.ref&&directedCorridorIds.get(t.to)===directedCorridorIds.get(road.index));
      if(links.length!==1)break;
      current=edges[links[0].to];start=links[0].toM;
    }
    const result=found?total:Infinity; // no later AS: evaluate the observed bottleneck, not a fictional next-AS delay
    nextDecisionMemo.set(key,result);return result;
  }
  const unplannedExitMemo=new Map();let unplannedExitStamp="";
  // At a map boundary an actual exit may exist without a mapped return
  // beyond the queue. Still allow a voluntary departure onto that real
  // public-road exit. Do not fabricate a reentry or another motorway path.
  // Use ONLY the directly encountered severe mainline queue, never a remote
  // event, exit-ramp delay, or a queue behind the current fork.
  function unplannedExitShare(road,offset){
    if(!severeQueueSegments.size||road.kind!=="mainline")return 0;
    const stamp=exposureEpoch+":"+Math.floor(elapsed/60);
    if(unplannedExitStamp!==stamp){unplannedExitMemo.clear();unplannedExitStamp=stamp;}
    const key=road.id+":"+Math.round(offset*100);
    if(unplannedExitMemo.has(key))return unplannedExitMemo.get(key);
    const later=firstLocalExit(road,offset+.06),groups=new Set(),seen=new Set();
    let current=road,from=offset,share=0;
    while(current&&!seen.has(current.id)){
      seen.add(current.id);
      const end=current===later?.road?later.metre:current.lengthM;
      for(const {segment,group} of severeQueueSegments.get(current.id)||[])
        if(segment.toM>from+.05&&segment.fromM<end-.05)groups.add(group);
      if(current===later?.road)break;
      const next=current.next.filter(t=>edges[t.to].kind==="mainline"&&edges[t.to].ref===road.ref&&!blockedMovement(current,t));
      if(next.length!==1)break;
      current=edges[next[0].to];from=next[0].toM;
    }
    // Recurrent congestion obeys the SAME local AS-to-AS threshold.
    const legDelay=nextDecisionDelay(road,offset);
    if(Number.isFinite(legDelay)&&legDelay>=VOLUNTARY_START_MIN)for(const group of groups){
      const head=byId.get(group.endEdgeId);
      const remaining=corridorDelayBetween(road,offset,head,group.endOffsetM);
      if(Number.isFinite(remaining))share=Math.max(share,
        diversionShare(Math.min(remaining,group.routingDelayMin,legDelay)));
    }
    unplannedExitMemo.set(key,share);return share;
  }
  function nextClosureDecisionDelay(road,offset){
    // A later open motorway branch is a valid alternative just like an AS.
    // Compare only the delay required to reach it, not the full closure
    // queue or the queue already waiting on a different exit.
    if(!derivedFeederGateAhead(road,offset))return nextDecisionDelay(road,offset);
    let next=null;
    routeForks(road,offset+.06,(from,turn)=>{
      const target=edges[turn.to];
      if((target.kind==="ramp"||target.kind==="mainline"&&target.ref!==road.ref)&&isUsableEscape(from,turn)){
        next={road:from,metre:turn.fromM};return false;
      }
    });
    return next?corridorDelayBetween(road,offset,next.road,next.metre):Infinity;
  }
  const lengthMemo=new Map();let lengthStamp="";
  // Observe the relevant congestion complexes on the actual carriageway. Small
  // moving gaps in a stop-and-go wave do not reset the navigation signal.
  // If there is a still freely reachable later AS before the first queue,
  // let drivers keep going to that AS, rather than divert at every exit.
  function routingQueueLength(road,offset){
    if(road.kind!=="mainline"||!jamGroups.length)return 0;
    const stamp=exposureEpoch+":"+Math.floor(elapsed/60);
    if(stamp!==lengthStamp){lengthMemo.clear();lengthStamp=stamp;}
    const key=road.id+":"+Math.round(offset*100);
    if(lengthMemo.has(key))return lengthMemo.get(key);
    const later=firstLocalExit(road,offset+.06);
    let current=road,start=offset,distance=0,lastEnd=-1,length=0,best=0,passedExit=false;
    const seen=new Set();
    outer:while(current&&!seen.has(current.id)&&distance<100000){
      seen.add(current.id);
      const gate=(activeEffects.get(current.id)||NO_EFFECTS).filter(x=>
        (x.event.kind==="closure"||x.event.closedLanes.length===current.lanes&&x.event.shoulder!=="open")&&x.toM>start+.05)
        .reduce((m,x)=>Math.min(m,Math.max(start,x.fromM)),current.lengthM);
      for(const band of current.visualBands){
        const lo=Math.max(start,band.fromM),hi=Math.min(gate,band.toM);
        if(hi<=lo+.05)continue;
        const at=distance+lo-start;
        if(lastEnd>=0&&at-lastEnd>500){lastEnd=-1;length=0;}
        if(lastEnd<0&&(passedExit||later?.road===current&&lo>later.metre+.05))break outer;
        length+=hi-lo;best=Math.max(best,length);lastEnd=distance+hi-start;
        if(length>=30000)break outer;
      }
      if(gate<current.lengthM-.05)break;
      if(lastEnd<0&&later?.road===current)break;
      if(later?.road===current)passedExit=true;
      distance+=current.lengthM-start;
      if(lastEnd>=0&&distance-lastEnd>500){
        if(passedExit)break;
        lastEnd=-1;length=0;
      }
      const next=current.next.filter(t=>edges[t.to].kind==="mainline"&&edges[t.to].ref===road.ref&&!blockedMovement(current,t));
      if(next.length!==1)break;
      current=edges[next[0].to];start=next[0].toM;
    }
    lengthMemo.set(key,best);return best;
  }
  // Local AS decisions use ONLY delay from THIS exit to the next AS.
  // Long total queues are handled independently by real motorway alternatives.
  // Voluntary local choice begins at 45 minutes; the next-AS delay is independent of the main queue.
  function localDiversionShare(road,offset,observed,plan){
    if(!plan&&(!closureFingerprint||!Number.isFinite(closureDistanceAhead(road,offset,Infinity))))return 0;
    if(!Number.isFinite(observed)||observed<VOLUNTARY_START_MIN)return 0;
    const legDelay=nextDecisionDelay(road,offset);
    // A real downstream AS with a short approach remains preferable, even if
    // the incident farther ahead causes hours of loss. If there is NO later
    // AS, require a proven detour plan before treating it as the last local opportunity.
    if((!Number.isFinite(legDelay)&&!plan)||legDelay<VOLUNTARY_START_MIN)return 0;
    if(!closureExitEligible(road,offset,plan))return 0;
    const preferred=preferredTransferDelay(road,offset,plan);
    const eligible=Math.min(observed,legDelay,preferred??Infinity);
    if(eligible<VOLUNTARY_START_MIN)return 0;
    const base=diversionShare(eligible);
    // Queue length can strengthen a valid local decision, never initiate one.
    return Math.max(base,Math.min(base*1.15,lengthDiversionShare(routingQueueLength(road,offset))));
  }
  // An open signed motorway arm is the primary route to the last useful
  // exit (e.g. A48 -> A3 north -> Ransbach). Only the excess travel time TO
  // that exit can justify leaving the feeder earlier. An unrelated closure
  // downstream, or a missing comparison through the closed arm, cannot.
  function preferredTransfer(road,offset,plan){
    const fallback=transferFallbackByApproach.get(road.index);
    if(!fallback||plan&&fallback.plan.closureId!==plan.closureId)return null;
    if(road===fallback.from&&offset>fallback.turn.fromM+.05)return null;
    return fallback;
  }
  function preferredTransferDelay(road,offset,plan){
    const fallback=preferredTransfer(road,offset,plan);
    if(!fallback)return null;
    const delay=directedDelayToCause(road,offset,fallback.exit.road.id,fallback.exit.metre);
    // No proven path is not evidence for a massive delay. The selected
    // transfer has already been checked against the legal closure graph.
    return Number.isFinite(delay)?delay:0;
  }
  const downstreamExitMemo=new Map();
  let downstreamExitEpoch=-1;
  // An open transfer leading to a usable exit on the affected motorway is
  // not a reason to leave the feeder motorway prematurely.
  function hasOpenTransferToExit(road,offset){
    if(downstreamExitEpoch!==exposureEpoch){downstreamExitMemo.clear();downstreamExitEpoch=exposureEpoch;}
    const key=road.id+":"+Math.round(offset*100);
    if(downstreamExitMemo.has(key))return downstreamExitMemo.get(key);
    let found=false;
    routeForks(road,offset,(from,turn)=>{
      if(blockedMovement(from,turn))return;
      const target=edges[turn.to];
      const arrivals=target.kind==="mainline"?[{road:target,metre:turn.toM}]:
        localTerminal(target)?[]:rampMainlineArrivals(target,(a,b)=>!blockedMovement(a,b));
      for(const a of arrivals){
        if(a.road.ref===road.ref||!Number.isFinite(closureDistanceAhead(a.road,a.metre,Infinity)))continue;
        if(firstLocalExit(a.road,a.metre)){found=true;return false;}
      }
    });
    downstreamExitMemo.set(key,found);return found;
  }
  const feederGateMemo=new Map();let feederGateEpoch=-1;
  function derivedFeederGateAhead(road,offset){
    if(feederGateEpoch!==exposureEpoch){feederGateMemo.clear();feederGateEpoch=exposureEpoch;}
    const key=road.id+":"+Math.round(offset*100);
    if(feederGateMemo.has(key))return feederGateMemo.get(key);
    let current=road,from=offset,result=false;const seen=new Set();
    while(current&&!seen.has(current.id)){
      seen.add(current.id);
      const gate=(activeEffects.get(current.id)||NO_EFFECTS).filter(s=>s.event.kind==="closure"&&s.toM>from+.05)
        .sort((a,b)=>a.fromM-b.fromM)[0];
      if(gate){
        const origin=byId.get(gate.event.edgeId);
        result=!!gate.derivedFeederClosure&&(origin?.ref!==road.ref||origin?.kind!=="mainline");break;
      }
      const next=current.next.filter(t=>edges[t.to].kind==="mainline"&&edges[t.to].ref===road.ref&&!blockedMovement(current,t));
      if(next.length!==1)break;
      current=edges[next[0].to];from=next[0].toM;
    }
    feederGateMemo.set(key,result);return result;
  }
  // A feeder closed by propagation must use its real final motorway escape
  // (e.g. the open fork before a blocked suffix). On the originally closed
  // carriageway retain the last local exit/reentry relationship; an unrelated
  // motorway arm is not automatically an equivalent destination.
  function hasLaterPreferredEscape(road,offset){
    return derivedFeederGateAhead(road,offset)?laterUsableExitBeforeClosure(road,offset):!!firstLocalExit(road,offset+.06);
  }
  const mandatoryMemo=new Map();
  let mandatoryEpoch=-1;
  function mandatoryLocalShare(road,offset){
    if(mandatoryEpoch!==exposureEpoch){mandatoryMemo.clear();mandatoryEpoch=exposureEpoch;}
    const key=road.id+":"+Math.round(offset*100);
    if(mandatoryMemo.has(key))return mandatoryMemo.get(key);
    // A later OPEN motorway arm is also a lawful escape. Treating only
    // local AS as exits forced the traffic out at the preceding junction.
    if(hasLaterPreferredEscape(road,offset)){mandatoryMemo.set(key,0);return 0;}
    let later=false,throughShare=1;
    routeForks(road,offset+.06,(from,turn)=>{
      const target=edges[turn.to];
      if(blockedMovement(from,turn))return;
      if(exitDetours.get(turn.to)?.kind==="closure"){later=true;return false;}
      // Preserve the normal share for open motorway destinations. Nominal
      // turn weights are model estimates, not measured OD data.
      const transfer=target.kind==="mainline"?target.ref!==road.ref:
        !localTerminal(target)&&rampMainlineArrivals(target,(a,b)=>!blockedMovement(a,b))
          .some(x=>x.road.ref!==road.ref&&closureDistanceAhead(x.road,x.metre,Infinity)===Infinity);
      if(transfer&&isUsableEscape(from,turn))throughShare*=20/(20+turn.weight);
    });
    const share=later?0:throughShare;
    mandatoryMemo.set(key,share);return share;
  }
  // A closure itinerary is only a possibility. Its existence must not
  // turn off the normal through/turn lane separation at unrelated exits.
  // Use the same concrete fork decision for physics and route selection.
  function closureForkDecision(edge,k,legalTurns,anyClosureActive){
    const offset=k*edge.cellLength;
    const distance=anyClosureActive?closureDistanceAhead(edge,offset,Infinity,null,true):Infinity;
    const signedRoute=preferredTransfer(edge,offset,null);
    const signedApproach=!!signedRoute&&!legalTurns.some(t=>designatedTransfers.has(edge.index+":"+t.to));
    // A closure on ONE downstream motorway arm is not a mandate to
    // leave an upstream, still OPEN motorway at an arbitrary local AS.
    // The affected flow takes the open motorway option at its real fork.
    // Mandatory LOCAL departure is only for a closure physically reachable
    // on the current directed throughway, or a specifically assigned feeder
    // route. Do not infer compulsion from an unrelated distant closure.
    const closureShare=signedApproach?
      closureExposureAhead(edge,offset,Infinity,signedRoute.plan.closureId):
      Number.isFinite(distance)?1:0;
    const currentAlternatives=legalTurns.filter(link=>{
      const next=edges[link.to];
      return (next.kind==="ramp"||next.kind==="mainline"&&next.ref!==edge.ref)&&isUsableEscape(edge,link);
    });
    const localTurns=currentAlternatives.filter(link=>exitDetours.get(link.to)?.kind==="closure");
    const hasLaterExit=closureShare>0&&currentAlternatives.some(link=>hasLaterPreferredEscape(edge,link.fromM));
    const localShare=localTurns.length&&closureShare>0&&(signedApproach||!hasLaterExit)?
      Math.max(...localTurns.map(link=>signedApproach?
        localDiversionShare(edge,link.fromM,observedPlanDelay(edge,link.fromM,exitDetours.get(link.to)),exitDetours.get(link.to)):
        mandatoryLocalShare(edge,link.fromM)))*closureShare:0;
    const earlyTurns=hasLaterExit?localTurns.filter(link=>closureExitEligible(edge,link.fromM,exitDetours.get(link.to))):[];
    const earlyShare=earlyTurns.length?Math.max(...earlyTurns.map(link=>exitChoiceShare(edge,link,exitDetours.get(link.to))))*closureShare:0;
    const closureDecision=signedApproach?Math.max(localShare,earlyShare):localShare>0?localShare:hasLaterExit?earlyShare:closureShare;
    return {distance,currentAlternatives,localTurns,earlyTurns,localShare,earlyShare,closureShare,closureDecision};
  }
  function directBoundaryChoice(edge,link,plan=exitDetours.get(link.to)){
    // A return on another motorway must not displace an actual severe
    // through queue on the original road just because that road is cropped.
    // The real public-road exit remains usable even if no return is mapped.
    // A verified cross-motorway return with a positive route choice must
    // retain its destination cohort instead of disappearing at the boundary.
    if(plan?.kind==="closure"||plan?.sameCorridor||plan&&exitChoiceShare(edge,link,plan)>0||closureFingerprint&&
      Number.isFinite(closureDistanceAhead(edge,link.fromM,Infinity)))return 0;
    return unplannedExitShare(edge,link.fromM);
  }
  function localChoiceAtExit(edge,link){
    const plan=exitDetours.get(link.to),preferred=preferredTransfer(edge,link.fromM,plan);
    const direct=directBoundaryChoice(edge,link,plan);
    if(direct>0)return direct;
    const fraction=exitChoiceShare(edge,link,plan);
    if(!fraction)return 0;
    // Only the drivers whose original directed destination is affected
    // may change routes. A queue on an A3 transfer is not a reason for all
    // A4 through drivers to leave their motorway as well.
    if(preferred)return fraction*closureExposureAhead(edge,link.fromM,Infinity,preferred.plan.closureId);
    if(plan?.kind==="closure")return fraction*(Number.isFinite(closureDistanceAhead(edge,link.fromM,Infinity,plan.closureId))?1:
      closureExposureAhead(edge,link.fromM,Infinity,plan.closureId));
    return fraction*(plan?.causeEdgeId?bottleneckExposureAhead(edge,link.fromM,plan.causeEdgeId):1);
  }
  function clearTurnWaiting(edge,k){edge.turnStock[k]=null;edge.voluntaryWaiting[k]=null;}
  // Only the extra voluntary turn demand still physically ON the mainline
  // can reconsider. Normal local destinations and vehicles already ON the
  // exit ramp are not removed, respawned or sent through a closure.
  function releaseVoluntaryWaiting(edge,k,legalKeys){
    const waiting=edge.voluntaryWaiting[k],pending=edge.turnStock[k];
    if(!waiting||!pending)return;
    for(const [exit,choice] of waiting){
      if(!legalKeys.has(choice.through))continue;
      const amount=Math.min(choice.amount,pending.get(exit)||0);
      pending.set(exit,Math.max(0,(pending.get(exit)||0)-amount));
      pending.set(choice.through,(pending.get(choice.through)||0)+amount);
      waiting.delete(exit);
    }
    if(!waiting.size)edge.voluntaryWaiting[k]=null;
  }
  function rememberVoluntaryWaiting(edge,k,key,through,amount){
    if(!(amount>0)||through===undefined)return;
    const waiting=edge.voluntaryWaiting[k]||new Map();
    const choice=waiting.get(key)||{through,amount:0};
    choice.amount+=amount;waiting.set(key,choice);edge.voluntaryWaiting[k]=waiting;
  }
  let queueHeadSnapshot=null,eligibleHeads=new Set();
  function eligibleQueueHeads(){
    if(queueHeadSnapshot===jamGroups)return eligibleHeads;
    queueHeadSnapshot=jamGroups;eligibleHeads=new Set();
    const candidates=jamGroups.filter(g=>g.lengthM>=500&&g.routingDelayMin>=5&&g.startEdgeId&&g.endEdgeId&&
      navigationQueueBands.has(g.endEdgeId)&&
      !exitBacklogAtHead(byId.get(g.endEdgeId),g.endOffsetM));
    if(candidates.reduce((sum,g)=>sum+g.routingDelayMin,0)<VOLUNTARY_START_MIN)return eligibleHeads;
    for(const head of candidates){
      if(head.routingDelayMin>=VOLUNTARY_START_MIN){eligibleHeads.add(head);continue;}
      // Search actual directed approaches, not a sum of different arms of
      // a junction. A chain of smaller queues can justify one bypass.
      for(const upstream of candidates){
        if(upstream===head)continue;
        const start=byId.get(upstream.startEdgeId);
        if(!bottleneckExposureAhead(start,upstream.startOffsetM,head.endEdgeId))continue;
        const delay=directedDelayToCause(start,upstream.startOffsetM,head.endEdgeId,head.endOffsetM,false,true);
        if(Number.isFinite(delay)&&delay>=VOLUNTARY_START_MIN){eligibleHeads.add(head);break;}
      }
    }
    return eligibleHeads;
  }
  function buildDetourPlans(){
    const events=[...eventRecords.values()].filter(record=>
      (!record.spec.schedule||
        global.StauEventSchedule.active(record.spec.schedule,clockMs()))&&
      ["closure","accident","roadworks","breakdown"].includes(record.spec.kind))
      .flatMap(record=>{
        if(record.spans.some(span=>byId.get(span.edgeId)?.kind==="mainline"))return [record];
        const ramp=byId.get(record.spans.at(-1)?.edgeId);
        // An incident on a real motorway-transfer ramp is itself the cause,
        // not a transient secondary queue on the feeder or receiving road.
        // Preserve its actual onward carriageway and lawful return target.
        if(!ramp||record.spec.kind!=="closure"&&localTerminal(ramp))return [];
        return ramp?rampMainlineArrivals(ramp).map(({road,metre})=>({
          spec:{...record.spec,causeEdgeId:ramp.id},routeSpans:record.spans,
          spans:[{edgeId:road.id,fromM:metre,toM:metre}]})):[];
      });
    // Unplanned recurrent congestion can also induce diversions. Use the
    // actual downstream queue head (not the display-label midpoint). Do not
    // make a second phantom obstruction on a route already carrying an event.
    const eventEdges=new Set(events.flatMap(event=>[...event.spans,...(event.routeSpans||[])].map(span=>span.edgeId)));
    const queues=jamGroups.filter(group=>eligibleQueueHeads().has(group)&&group.lengthM>=500&&
      group.endEdgeId&&!eventEdges.has(group.endEdgeId))
      .flatMap(group=>{
        const head=byId.get(group.endEdgeId),at=group.endOffsetM;
        const spec={id:"queue:"+head.id+":"+Math.round(at/100),
          kind:"congestion",causeEdgeId:head.id};
        if(head.kind==="mainline"){
          if(exitBacklogAtHead(head,at))return [];
          // Do not supersede a corridor's formal closure bypass.
          if(Number.isFinite(closureDistanceAhead(head,at,Infinity))||
            closureExposureAhead(head,at,Infinity)>0||mainlineEventAhead(head,at))return [];
          return [{spec,spans:[{edgeId:head.id,fromM:at,toM:at}]}];
        }
        if(head.kind!=="ramp"||localTerminal(head))return [];
        // A transfer queue may feed a different motorway. Keep its physical
        // approach on the ramp, but plan the return on the ACTUAL motorway
        // reached after the interchange, not on the terminating feeder road.
        return rampMainlineArrivals(head,(from,turn)=>!blockedMovement(from,turn))
          .map(({road,metre})=>({
            spec:{...spec,id:spec.id+":"+road.id},
            routeSpans:[{edgeId:head.id,fromM:at,toM:at}],
            spans:[{edgeId:road.id,fromM:metre,toM:metre}]
          }));
      });
    const obstacles=[...events,...queues].sort((a,b)=>Number(b.spec.kind==="closure")-Number(a.spec.kind==="closure"));
    // An A48-style feeder can end at an AD with no on-ramp onto the SAME
    // motorway beyond its queue. In that case extend the bypass destination
    // through physically connected transfer ramps into the onward motorways.
    // Never invent a public road or treat the other motorway direction as
    // the driver's intended destination.
    function receiversBeyondMotorwayEnd(road,offsetM){
      const found=new Map(),maxM=30000;
      const metresAlong=(end,at)=>{
        let current=road,offset=offsetM,total=0;
        const seen=new Set();
        while(!seen.has(current.id)&&total<=maxM){
          seen.add(current.id);
          if(current===end)return total+Math.max(0,at-offset);
          total+=Math.max(0,current.lengthM-offset);
          const same=current.next.filter(t=>
            edges[t.to].kind==="mainline"&&edges[t.to].ref===road.ref);
          if(same.length!==1)break;
          current=edges[same[0].to];offset=same[0].toM;
        }
        return Infinity;
      };
      routeForks(road,offsetM,(from,turn)=>{
        const distance=metresAlong(from,turn.fromM);
        if(distance>maxM||!Number.isFinite(distance))return;
        const branch=edges[turn.to];
        if(localTerminal(branch))return;
        const destinations=branch.kind==="mainline"?[{road:branch,metre:turn.toM}]:
          branch.kind==="ramp"?rampMainlineArrivals(branch,(a,b)=>!blockedMovement(a,b)):[];
        for(const destination of destinations){
          if(destination.road.ref===road.ref)continue;
          const id=destination.road.id+":"+Math.floor(destination.metre/10);
          const prev=found.get(id);
          if(!prev||distance<prev.distance)found.set(id,{...destination,distance});
        }
      });
      return [...found.values()].sort((a,b)=>a.distance-b.distance).slice(0,6);
    }
    const key=exposureEpoch+":"+obstacles.map(x=>x.spec.id+":"+x.spans.map(s=>
      s.edgeId+":"+Math.round(s.fromM)+":"+Math.round(s.toM)).join(",")).join("|");
    if(key===detourPlansKey)return;
    detourPlansKey=key;exitDetours.clear();fallbackExits.clear();fallbackTransfers.clear();dynamicTransferChoices.clear();motorwayAlternatives.clear();
    designatedApproach.clear();designatedTransfers.clear();localSourceDetours.clear();transferFallbackByApproach.clear();
    localSourceCandidates.clear();localSourceChoiceCache.clear();
    wideSourceOptions.clear();wideRoutesByEvent.clear();wideDecisionCache.clear();wideDecisionStamp="";
    const routePlans=new Map();mandatoryMemo.clear();
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
          downstream.set(next.id,metres);queue.push(next);
        }
      }
      const optionsByJunction=new Map();
      for(const ramp of edges){
        if(ramp.kind!=="ramp"||!(isLocalEntrance(ramp)||ramp.source&&isLocalOrigin(ramp))||
          (activeEffects.get(ramp.id)||NO_EFFECTS).some(e=>
            e.event.kind==="closure"))continue;
        // If the apparent entrance is itself fed by motorway mainlines,
        // it is a transfer or a shared merge, not a fresh local entry.
        const upstream=[ramp],seenUpstream=new Set();let motorwayFed=false;
        for(let i=0;i<upstream.length&&!motorwayFed;i++){
          const current=upstream[i];if(seenUpstream.has(current.id))continue;
          seenUpstream.add(current.id);
          for(const {from} of incomingTurns[current.index]){
            if(from.kind==="mainline"){motorwayFed=true;break;}
            if(from.kind==="ramp")upstream.push(from);
          }
        }
        // A labelled AS entrance may share an at-grade ramp network with
        // its exit. It is still a genuine local entrance, unlike AK/AD.
        if(motorwayFed&&!/\bAS\b/i.test(junctionLabel(ramp)))continue;
        const arrivals=rampMainlineArrivals(ramp,(from,turn)=>
          !blockedMovement(from,turn)&&!(activeEffects.get(from.id)||NO_EFFECTS)
            .some(s=>s.event.kind==="closure"&&s.fromM<turn.fromM-.05));
        // A direction-specific physical source allows returning traffic to
        // share admission with normal traffic instead of joining halfway
        // down a ramp chain. Mixed-direction collectors stay on the signed
        // direction-specific entrance.
        const rooted=ramp.source&&isLocalOrigin(ramp)&&arrivals.length>0&&
          arrivals.every(a=>downstream.has(a.road.id));
        if(!isLocalEntrance(ramp)&&!rooted)continue;
        for(const {road,metre} of arrivals){
          const base=downstream.get(road.id);
          if(road.kind!=="mainline"||road.ref!==endEdge.ref||base===undefined)continue;
          if((activeEffects.get(road.id)||NO_EFFECTS).some(s=>
            s.event.kind==="closure"&&metre>=s.fromM-.05&&metre<s.toM-.05))continue;
          const distance=road===endEdge?metre-last.toM:base+metre;
          // The first legal reentry is often the ramp that MERGES at the
          // exact end of the blocked mainline (distance 0). Requiring
          // 80 metres beyond the closure silently discarded that ramp and
          // stranded diverted drivers despite a lawful open reentry.
          if(!(distance>=-.05&&
            (obstacle.spec.kind==="closure"||distance<60000)))continue;
          // A long OSM interchange can have several ramp pieces. Treat an
          // Anschlussstelle as ONE candidate, not three phantom destinations.
          const junction=(ramp.name.split(" · ")[0]||ramp.id)
            .replace(/\s+/g," ").trim().toLowerCase();
          const key=endEdge.ref+":"+junction;
          const previous=optionsByJunction.get(key);
          if(!previous||distance<previous.distance-.05||
            Math.abs(distance-previous.distance)<=.05&&rooted&&!previous.rooted)
            optionsByJunction.set(key,{ramp,distance,junction,rooted});
        }
      }
      const candidates=[...optionsByJunction.values()]
        .sort((a,b)=>a.distance-b.distance||a.ramp.id.localeCompare(b.ramp.id))
        .slice(0,3);
      if(!candidates.length)for(const [id,road] of externalReturns){
        if(!downstream.has(id)||road.ref!==endEdge.ref||
          directedCorridorIds.get(road.index)!==directedCorridorIds.get(endEdge.index))continue;
        candidates.push({ramp:road,distance:Math.max(0,(road===endEdge?road.lengthM-last.toM:downstream.get(id)+road.lengthM)),
          junction:road.externalDetourLabel,rooted:true});
      }
      // At a network-ending interchange the reachable return may be on a
      // DIFFERENT mapped motorway (e.g. A61 Plaidt → AK Koblenz → A48 west).
      // Trace only open, directed transfers back from the actual downstream
      // carriageway. Never recreate the former fictitious A61 boundary sink.
      if(!candidates.length&&obstacle.spec.kind==="closure"&&
        edges.some(e=>e.kind==="mainline"&&e.ref==="A61")){
        const returns=new Map(),work=[];
        const closedEdge=e=>(activeEffects.get(e.id)||NO_EFFECTS).some(s=>s.event.kind==="closure");
        for(const [id,distance] of downstream){
          const road=byId.get(id);
          if(!road||closedEdge(road))continue;
          returns.set(road.index,distance);work.push(road);
        }
        for(let i=0;i<work.length;i++){
          const road=work[i],base=returns.get(road.index);
          for(const {from,turn} of incomingTurns[road.index]){
            if(closedEdge(from)||blockedMovement(from,turn))continue;
            const metres=base+Math.max(1,from.lengthM);
            if(metres>35000||metres>=(returns.get(from.index)??Infinity))continue;
            returns.set(from.index,metres);work.push(from);
          }
        }
        const alternate=new Map();
        for(const ramp of edges){
          if(ramp.kind!=="ramp"||ramp.ref===endEdge.ref||!isLocalEntrance(ramp)||
            !returns.has(ramp.index)||closedEdge(ramp))continue;
          const junction=junctionLabel(ramp),distance=returns.get(ramp.index);
          if(!alternate.has(junction)||distance<alternate.get(junction).distance)
            alternate.set(junction,{ramp,distance,junction});
        }
        candidates.push(...[...alternate.values()].sort((a,b)=>a.distance-b.distance).slice(0,3));
      }
      // When the A48 ends at the cropped A61, a local bypass can still
      // reach that external motorway destination. Verify it on the actual
      // directed graph beyond the event; never invent an A61 on-ramp.
      if(!candidates.length&&endEdge.ref==="A48"){
        const outbound=[],seen=new Set();
        for(const [id,base] of downstream){
          const road=byId.get(id);
          for(const turn of road.links)if(edges[turn.to].kind==="ramp"&&
            (road!==endEdge||turn.fromM>=last.toM-.05))
            outbound.push({edge:edges[turn.to],distance:base+turn.fromM});
        }
        // The westbound A61 fork lies just BEFORE the final cropped
        // A48 Way. The closure includes that fork; the missing outside
        // road can still reach A61 without crossing the closed junction.
        for(const span of obstacle.spans){
          const road=byId.get(span.edgeId);
          for(const turn of road?.links||[])if(isA61Boundary(edges[turn.to])&&
            turn.fromM>=span.fromM-.05&&turn.fromM<=span.toM+.05)
            outbound.push({edge:edges[turn.to],distance:0});
        }
        for(let i=0;i<outbound.length;i++){
          const item=outbound[i],edge=item.edge;
          if(seen.has(edge.index))continue;seen.add(edge.index);
          if(edge.externalDetourDestination){
            candidates.push({ramp:edge,distance:item.distance,junction:"A61 · Netzgrenze AK Koblenz"});
            continue;
          }
          if(!isA61Boundary(edge))continue;
          for(const t of edge.links)if(edges[t.to].kind==="ramp")
            outbound.push({edge:edges[t.to],distance:item.distance+edge.lengthM});
        }
        candidates.sort((a,b)=>a.distance-b.distance);
      }
      // Reverse the actual directed network from this particular obstacle.
      // An exit must be able to approach THIS event, not merely any closure
      // anywhere on another motorway. Offsets matter at interior forks.
      const approach=new Map(),work=[];
      function approachAt(edgeId,metre){
        // A motorway looping back through an interchange must not make
        // already downstream traffic on the same carriageway a candidate
        // for this event. Those cars have passed the obstruction.
        if(edgeId===last.edgeId?metre>last.fromM+.05:downstream.has(edgeId))return;
        if((approach.get(edgeId)??-1)>=metre-.01)return;
        approach.set(edgeId,metre);work.push(edgeId);
      }
      {
        for(const span of obstacle.routeSpans||obstacle.spans)
          approachAt(span.edgeId,span.fromM);
        for(let i=0;i<work.length;i++){
          const edge=byId.get(work[i]),until=approach.get(edge.id);
          for(const {from,turn} of incomingTurns[edge.index])
            // Reachability to a bottleneck is independent of motorway
            // reference. A3 accidents also affect A48 vehicles approaching
            // through the Frankfurt transfer, not only A3 mainline cars.
            // Traverse existing directed OSM turns; never join by proximity.
            if(turn.toM<=until+.05&&(obstacle.spec.kind==="closure"||
              !blockedMovement(from,turn)||edge.id===(obstacle.spec.causeEdgeId||obstacle.spans[0]?.edgeId)&&
                (activeEffects.get(edge.id)||NO_EFFECTS).some(x=>x.event.id===obstacle.spec.id&&x.fromM<=turn.toM+.05&&x.toM>turn.toM)))
              approachAt(from.id,turn.fromM);
        }
      }
      // Configured off-map corridors work for ANY event on their covered
      // directed motorway, not a hard-coded AS-to-AS closure. Both endpoints
      // must exist and the return must be after this event on the same
      // carriageway. The mapped portion is checked again at booking/arrival.
      const configured=data.wideCorridors||
        (data===global.STAU_LEGACY_GEOMETRY?traffic.WIDE_CORRIDORS:[]);
      if(obstacle.spec.kind!=="congestion")for(const config of configured||[]){
        const reentry=byId.get(config.reentryId),target=byId.get(config.targetId);
        if(config.ref!==endEdge.ref||!reentry||!target||!downstream.has(target.id)||
          directedCorridorIds.get(target.index)!==directedCorridorIds.get(endEdge.index)||
          target===endEdge&&last.toM>=target.lengthM-.05)continue;
        const route={...config,reentry,target,downstream,endEdgeId:endEdge.id,endOffset:last.toM,closureId:obstacle.spec.id,
          kind:obstacle.spec.kind,causeEdgeId:obstacle.spec.causeEdgeId||obstacle.routeSpans?.[0]?.edgeId||obstacle.spans[0]?.edgeId};
        const affectedSources=[];
        for(const source of sources){
          const arrivals=source.kind==="mainline"?[{road:source,metre:0}]:rampMainlineArrivals(source);
          if(!arrivals.length||!arrivals.every(a=>a.road.ref===config.ref&&
            directedCorridorIds.get(a.road.index)===directedCorridorIds.get(target.index)&&
            (approach.get(a.road.id)??-1)>=a.metre-.05))continue;
          if(source.kind==="mainline"&&config.direction&&source.directionKey!==config.direction)continue;
          const a=arrivals[0],list=wideSourceOptions.get(source.index)||[];
          list.push({route,...a});wideSourceOptions.set(source.index,list);
          affectedSources.push(source.index);
        }
        if(affectedSources.length)wideRoutesByEvent.set(obstacle.spec.id,
          [...(wideRoutesByEvent.get(obstacle.spec.id)||[]),route]);
      }
      // Also consider purely motorway alternatives. A transfer is a real
      // candidate only if it can reach the SAME downstream destination on
      // the directed graph; never invent a connection or a return ramp.
      // A long alternative can return many junctions later. Use a common
      // downstream corridor anchor, not just the next motorway fragment.
      const target=[...downstream].map(([id,distance])=>({road:byId.get(id),distance}))
        .filter(({road})=>road!==endEdge||last.toM<endEdge.lengthM-endEdge.cellLength)
        .filter(({road})=>!(activeEffects.get(road.id)||NO_EFFECTS).some(x=>x.event.kind==="closure"&&x.toM>=road.lengthM-.01))
        .sort((a,b)=>b.distance+b.road.lengthM-a.distance-a.road.lengthM)[0]?.road;
    // The same destination-aware policy applies to recurrent congestion and
    // incidents: a mapped alternative must really bypass the affected road.
      if(target)for(const main of edges){
        if(main.kind!=="mainline"||main.ref!==endEdge.ref||!approach.has(main.id)||
          directedCorridorIds.get(main.index)!==directedCorridorIds.get(endEdge.index))continue;
        for(const turn of main.links){
          if(turn.fromM>(approach.get(main.id)??-1)+.05||blockedMovement(main,turn))continue;
          const branch=edges[turn.to];
          const transfers=branch.kind==="mainline"?branch.ref!==main.ref:
            !localTerminal(branch)&&rampMainlineArrivals(branch).some(x=>x.road.ref!==main.ref);
          if(!transfers)continue;
          const fork=cellKey(main.index,turn.fromCell);
          const list=motorwayAlternatives.get(fork)||[];
          list.push({turn,target:target.index,kind:obstacle.spec.kind,closureId:obstacle.spec.id,
            downstream,endEdgeId:endEdge.id,endOffset:last.toM,
            causeEdgeId:obstacle.spec.causeEdgeId||obstacle.routeSpans?.[0]?.edgeId||obstacle.spans[0]?.edgeId});
          motorwayAlternatives.set(fork,list);
        }
      }
      if(!candidates.length){
        // If there is no actual legal post-queue return on this terminating
        // motorway, retry on each physically reached NEXT motorway. This is
        // the generic AD/AK equivalent of the old app's targetPath routing.
        if(!obstacle.extendedAcrossInterchange){
          const routeSpans=obstacle.routeSpans||obstacle.spans;
          for(const arrival of receiversBeyondMotorwayEnd(endEdge,last.toM)){
            const nextObstacle={
              ...obstacle,
              extendedAcrossInterchange:true,
              routeSpans,
              spans:[{edgeId:arrival.road.id,fromM:arrival.metre,toM:arrival.metre}],
              spec:{...obstacle.spec,id:obstacle.spec.kind==="closure"?
                obstacle.spec.id:obstacle.spec.id+":via:"+arrival.road.id,
                causeEdgeId:obstacle.spec.causeEdgeId||last.edgeId}
            };
            obstacles.push(nextObstacle);
          }
        }
        continue;
      }
      // The last tiny OSM Way can curve opposite to the actual motorway
      // direction. A real, named return ramp gives the intended direction.
      const routeKey=endEdge.ref+":"+traffic.motorwayDirection(endEdge.ref,
        rowById.get(endEdge.id)[4],candidates[0].ramp.name);
      // A feeder whose intended motorway transfer is closed may still
      // have an open transfer toward a public-road exit. Discover this
      // from directed turns for ANY interchange; no named-road exceptions.
      // Voluntary motorway-arm bypasses also work for accidents, roadworks
      // and queues WITHOUT a full closure. Trace the affected branch and its
      // genuinely open sibling through mapped directed OSM turns. Drivers can
      // take the open arm, leave it at its first public-road AS, and enter the
      // original motorway behind the bottleneck. This is network-wide, not
      // an A48/Dernbach special case.
      for(const from of edges){
        if(from.kind!=="mainline"||from.ref===endEdge.ref||!approach.has(from.id))continue;
        const causeEdgeId=obstacle.spec.causeEdgeId||
          obstacle.routeSpans?.[0]?.edgeId||obstacle.spans[0]?.edgeId;
        if(!causeEdgeId)continue;
        const junctions=new Map();
        for(const link of from.links){
          if(blockedMovement(from,link))continue;
          const list=junctions.get(link.fromCell)||[];
          list.push(link);junctions.set(link.fromCell,list);
        }
        for(const [cell,links] of junctions){
          if(links.length<2)continue;
          const affected=links.filter(link=>
            bottleneckExposureAhead(edges[link.to],link.toM,causeEdgeId)>.30);
          const open=links.filter(link=>{
            const branch=edges[link.to];
            return !localTerminal(branch)&&
              bottleneckExposureAhead(branch,link.toM,causeEdgeId)<.01;
          });
          if(!affected.length||!open.length)continue;
          for(const bad of affected)for(const good of open){
            const branch=edges[good.to];
            const arrivals=branch.kind==="mainline"?[{road:branch,metre:good.toM}]:
              branch.kind==="ramp"?rampMainlineArrivals(branch,(a,b)=>!blockedMovement(a,b)):[];
            for(const arrival of arrivals){
              // Two different directions of the same numbered motorway
              // are distinct routes. An open A3 Köln arm can legitimately
              // serve as an escape from the A3 Frankfurt arm.
              if(bottleneckExposureAhead(arrival.road,arrival.metre,causeEdgeId)>.01)continue;
              const exit=firstLocalExit(arrival.road,arrival.metre);
              if(!exit||fallbackExits.has(exit.first))continue;
              const reentry=candidates[0];
              const durationS=estimatedOutsideSeconds(exit.terminal,reentry.ramp);
              const plan={terminal:exit.terminal.index,reentry:reentry.ramp.index,
                durationS,closureId:obstacle.spec.id,kind:obstacle.spec.kind,
                causeEdgeId,transferRef:arrival.road.ref,feederRef:from.ref,
                entries:[{reentry:reentry.ramp.index,distanceM:reentry.distance,
                  weight:1,durationS,junction:reentry.junction,closureId:obstacle.spec.id}]};
              fallbackExits.set(exit.first,plan);
              terminalDetours.set(plan.terminal,plan);
              const key=from.index+":"+cell;
              const choices=dynamicTransferChoices.get(key)||[];
              choices.push({from,bad,good,plan,causeEdgeId});
              dynamicTransferChoices.set(key,choices);
            }
          }
        }
      }
      if(obstacle.spec.kind==="closure")for(const from of edges){
        if(from.kind!=="mainline"||from.ref===endEdge.ref||!approach.has(from.id))continue;
        const affected=from.links.filter(t=>blockedMovement(from,t)&&(
          (blockedFeederTurns.get(t)||NO_EFFECTS).includes(obstacle.spec.id)||
          (activeEffects.get(edges[t.to].id)||NO_EFFECTS).some(e=>e.event.kind==="closure"&&closureMatches(e,obstacle.spec.id))));
        for(const closedTurn of affected){
          const alternatives=from.links.filter(t=>!blockedMovement(from,t)&&t.fromCell===closedTurn.fromCell);
          const choices=[];
          for(const turn of alternatives){
            const branch=edges[turn.to];
            if(localTerminal(branch))continue;
            const arrivals=branch.kind==="mainline"?[{road:branch,metre:turn.toM}]:
              rampMainlineArrivals(branch,(a,b)=>!blockedMovement(a,b));
            for(const arrival of arrivals){
              const exit=firstLocalExit(arrival.road,arrival.metre);
              if(!exit)continue;
              const reentry=candidates[0],durationS=estimatedOutsideSeconds(exit.terminal,reentry.ramp);
              choices.push({exit,turn,reentry,durationS,arrival});
            }
          }
          choices.sort((a,b)=>a.durationS-b.durationS);
          const choice=choices[0];if(!choice)continue;
          const {exit,turn,reentry,durationS,arrival}=choice;
          const entry={reentry:reentry.ramp.index,distanceM:reentry.distance,weight:1,durationS,
            junction:reentry.junction,closureId:obstacle.spec.id};
          const plan={terminal:exit.terminal.index,reentry:entry.reentry,durationS,entries:[entry],
            closureId:obstacle.spec.id,kind:"closure",designated:true,feederRef:from.ref,transferRef:arrival.road.ref};
          const existing=fallbackExits.get(exit.first);
          if(existing?.designated&&existing.closureId!==plan.closureId)continue;
          fallbackExits.set(exit.first,plan);terminalDetours.set(plan.terminal,plan);
          designatedTransfers.set(from.index+":"+turn.to,{fraction:closedTurn.weight/(closedTurn.weight+turn.weight),terminal:plan.terminal});
          const upstream=[from],seen=new Set();
          for(let i=0;i<upstream.length;i++){
            const road=upstream[i];if(seen.has(road.id))continue;seen.add(road.id);
            designatedApproach.add(road.index);
            if(!transferFallbackByApproach.has(road.index))transferFallbackByApproach.set(road.index,{from,turn,plan,exit});
            for(const {from:parent,turn:link} of incomingTurns[road.index])
              if(parent.kind==="mainline"&&parent.ref===from.ref&&!blockedMovement(parent,link)&&
                !(activeEffects.get(parent.id)||NO_EFFECTS).some(s=>s.event.kind==="closure"&&s.fromM<link.fromM-.05)&&
                !(activeEffects.get(road.id)||NO_EFFECTS).some(s=>s.event.kind==="closure"&&s.fromM<(road===from?turn.fromM:road.lengthM)-.05&&s.toM>link.toM+.05))upstream.push(parent);
          }
        }
      }
      if(obstacle.spec.kind==="closure"){
        for(const from of edges){
          if(from.kind!=="mainline"||from.ref!==endEdge.ref||!approach.has(from.id))continue;
          for(const turn of from.links){
            if((approach.get(from.id)??-1)<turn.fromM-.05||
              !Number.isFinite(closureDistanceAhead(from,turn.fromM,500,obstacle.spec.id))||
              blockedMovement(from,turn))continue;
            const target=edges[turn.to];
            const arrivals=target.kind==="mainline"?[{road:target,metre:turn.toM}]:
              localTerminal(target)?[]:rampMainlineArrivals(target,(a,b)=>!blockedMovement(a,b));
            for(const arrival of arrivals){
              if(arrival.road.ref===from.ref||
                Number.isFinite(closureDistanceAhead(arrival.road,arrival.metre,Infinity)))continue;
              const exit=firstLocalExit(arrival.road,arrival.metre);
              if(!exit)continue;
              const entries=candidates.map((candidate,i)=>({
                reentry:candidate.ramp.index,distanceM:candidate.distance,
                weight:i===0?1:0,durationS:estimatedOutsideSeconds(exit.terminal,candidate.ramp),
                junction:candidate.junction,closureId:obstacle.spec.id
              }));
              const plan={terminal:exit.terminal.index,reentry:entries[0].reentry,
                durationS:entries[0].durationS,entries,closureId:obstacle.spec.id,kind:"closure"};
              // Avoid ambiguous tagging when multiple closed routes compete
              // for the same fallback exit; the general normal plans remain.
              if(!fallbackExits.has(exit.first)){
                fallbackExits.set(exit.first,plan);terminalDetours.set(plan.terminal,plan);
              }
              if(fallbackExits.get(exit.first).closureId===plan.closureId)
                fallbackTransfers.set(from.index+":"+turn.to,exit.first);
            }
          }
        }
      }
      // Identify actual upstream off-ramps that terminate outside the limited
      // motorway-only extract. Never invent a ramp or local street connection.
      for(const main of edges){
        if(main.kind!=="mainline")continue;
        for(const turn of main.links){
          const first=edges[turn.to];
          const fullClosure=obstacle.spec.kind==="closure";
          // An exit on the opposite A3 carriageway is not a bypass of an
          // A3 incident, even if the full graph contains a long loop via
          // an interchange. Do not let a short unrelated queue steal the
          // plan for the actual direction of travel.
          if(!fullClosure&&main.ref===endEdge.ref&&
            directedCorridorIds.get(main.index)!==directedCorridorIds.get(endEdge.index))continue;
          const affected=fullClosure?
            (approach.get(main.id)??-1)>=turn.fromM-.05&&
              (closureDistanceAhead(main,turn.fromM,Infinity,obstacle.spec.id)!==Infinity||
              closureExposureAhead(main,turn.fromM,Infinity,obstacle.spec.id)>0):
            (approach.get(main.id)??-1)>=turn.fromM-.05;
          if(first.kind!=="ramp"||!affected)continue;
          const pending=[first],seen=new Set();
          for(let q=0;q<pending.length&&q<25;q++){
            const ramp=pending[q];
            if(seen.has(ramp.id))continue;
            seen.add(ramp.id);
            const successors=ramp.links.map(link=>edges[link.to]);
            if(!successors.length&&boundaryExit[ramp.index]&&
              !/\b(?:AK|AD|Autobahnkreuz|Autobahndreieck)\b/i.test(ramp.name)){
              const weights=destinationWeights(candidates.length);
              const entries=candidates.map((candidate,i)=>({
                reentry:candidate.ramp.index,
                distanceM:candidate.distance,
                weight:weights[i],
                durationS:estimatedOutsideSeconds(ramp,candidate.ramp),
                junction:candidate.junction,closureId:obstacle.spec.id
              }));
              const plan={terminal:ramp.index,reentry:entries[0].reentry,
                durationS:entries[0].durationS,entries,
                closureId:obstacle.spec.id,kind:obstacle.spec.kind,
                causeEdgeId:obstacle.spec.causeEdgeId||obstacle.spans[0]?.edgeId||null,
                endEdgeId:endEdge.id,endOffset:last.toM,
                sameCorridor:main.ref===endEdge.ref&&directedCorridorIds.get(main.index)===directedCorridorIds.get(endEdge.index)};
              const routes=routePlans.get(first.index)||new Map();
              // A signed exit may fan out to several real public-road
              // terminals. Do not silently discard all but the shortest.
              const terminalKey=routeKey+":"+ramp.index;
              const previous=routes.get(terminalKey);
              const downstreamOfPrevious=previous&&plan.kind!=="closure"&&previous.kind!=="closure"&&
                plan.kind!=="congestion"&&previous.kind!=="congestion"&&
                (approach.get(previous.endEdgeId)??-1)>=previous.endOffset-.05;
              if(!previous||plan.kind==="closure"&&previous.kind!=="closure"||downstreamOfPrevious||
                plan.kind===previous.kind&&(plan.kind==="closure"||plan.kind==="congestion")&&plan.durationS<previous.durationS)
                routes.set(terminalKey,plan);
              routePlans.set(first.index,routes);
            }else if(successors.length&&successors.every(x=>x.kind==="ramp")){
              for(const next of successors)pending.push(next);
            }
          }
        }
      }
      // A61 feeder drivers cannot enter a fully closed A48. Their trips
      // start outside the map and bypass directly to the first open AS.
      if(obstacle.spec.kind==="closure"&&!candidates[0].ramp.externalDetourDestination)
        for(const source of sources){
          if(!source.externalTransferOrigin)continue;
          const arrivals=source.kind==="mainline"?[{road:source,metre:0}]:rampMainlineArrivals(source);
          const affected=arrivals.some(a=>a.road.ref===endEdge.ref&&
            (approach.get(a.road.id)??-1)>=a.metre-.05);
          const open=source.kind==="mainline"?arrivals:rampMainlineArrivals(source,(a,b)=>!blockedMovement(a,b));
          const closedAtEntry=a=>(activeEffects.get(a.road.id)||NO_EFFECTS).some(s=>
            s.event.kind==="closure"&&closureMatches(s,obstacle.spec.id)&&
            a.metre>=s.fromM-.05&&a.metre<s.toM-.05);
          if(!affected||open.some(a=>!closedAtEntry(a)))continue;
          const candidate=candidates[0],durationS=estimatedOutsideSeconds(source,candidate.ramp,true);
          localSourceDetours.set(source.index,{fraction:1,plan:{terminal:source.index,
            reentry:candidate.ramp.index,durationS,closureId:obstacle.spec.id,kind:"closure",
            entries:[{reentry:candidate.ramp.index,distanceM:candidate.distance,weight:1,
              durationS,junction:candidate.junction,closureId:obstacle.spec.id}]}});
        }
    }
    for(const [first,routes] of routePlans){
      // The explicitly signed destination must not be overwritten by a
      // congestion plan on the open connector during a long closure.
      if(fallbackExits.get(first)?.designated||[...fallbackExits.values()].some(p=>
        p.designated&&[...routes.values()].some(r=>r.terminal===p.terminal)))continue;
      const plans=[...routes.values()].sort((a,b)=>Number(b.kind==="closure")-Number(a.kind==="closure")||
        (a.kind!=="closure"&&b.kind!=="closure"?Number(b.sameCorridor)-Number(a.sameCorridor):0)||a.durationS-b.durationS);
      const plan=plans[0];
      // No individual destination matrix yet: keep separate legal target
      // directions with equal model shares, not last-event-wins routing.
      const primaryPlans=plan.kind==="closure"?[...new Map(plans.filter(p=>p.terminal===plan.terminal&&p.kind==="closure").map(p=>[p.closureId,p])).values()]:[plan];
      const entries=primaryPlans.flatMap(p=>p.entries.map(e=>({...e,weight:e.weight/primaryPlans.length})));
      const terminals=[...new Map(plans.filter(p=>p.closureId===plan.closureId&&
        junctionLabel(edges[p.terminal])===junctionLabel(edges[plan.terminal])).map(p=>[p.terminal,p])).values()];
      const combined={...plan,entries,terminalChoices:terminals.map(p=>p.terminal)};
      exitDetours.set(first,combined);
      // Preserve plans for cars already on an off-ramp after reopening.
      for(const p of terminals)terminalDetours.set(p.terminal,p.terminal===plan.terminal?combined:p);
    }
    // A local entry at the very junction serving as the mandatory exit
    // must not launch drivers toward the closed destination just to send
    // them around the next motorway junction. Keep open destinations on
    // the motorway; start the affected trips on the same local bypass.
    for(const source of sources){
      if(source.kind!=="ramp")continue;
      const label=junctionLabel(source);
      for(const [first,plan] of exitDetours){
        if(plan.kind!=="closure"||junctionLabel(edges[plan.terminal])!==label)continue;
        const arrival=rampMainlineArrivals(source,(a,b)=>!blockedMovement(a,b)).find(a=>
          a.road.ref===source.ref&&Number.isFinite(closureDistanceAhead(a.road,a.metre,Infinity,plan.closureId)));
        if(!arrival)continue;
        const fraction=mandatoryLocalShare(arrival.road,arrival.metre);
        if(fraction>0)localSourceDetours.set(source.index,{plan,fraction});
      }
      if(!isLocalOrigin(source)||localSourceDetours.has(source.index))continue;
      // Actual local origins may decide before joining the motorway. Find
      // downstream exit candidates reachable via this real entrance.
      const choices=[];
      for(const arrival of rampMainlineArrivals(source,(a,b)=>!blockedMovement(a,b))){
        if(arrival.road.ref!==source.ref)continue;
        routeForks(arrival.road,arrival.metre,(from,turn)=>{
          const plan=exitDetours.get(turn.to);
          if(!plan||blockedMovement(from,turn))return;
          choices.push({arrival,from,turn,plan});
        });
      }
      if(choices.length)localSourceCandidates.set(source.index,choices);
    }
  }
  function localSourceChoice(source){
    if(localSourceDetours.has(source.index))return localSourceDetours.get(source.index);
    const wide=wideSourceChoice(source);
    if(wide)return wide;
    if(source.kind!=="ramp"||!isLocalOrigin(source))return null;
    const minute=Math.floor(elapsed/60);
    if(localSourceChoiceMinute!==minute){localSourceChoiceCache.clear();localSourceChoiceMinute=minute;}
    if(localSourceChoiceCache.has(source.index))return localSourceChoiceCache.get(source.index);
    const candidatesByDestination=new Map();
    for(const {arrival,from,turn,plan} of localSourceCandidates.get(source.index)||[]){
      const travel=corridorMinutes(arrival.road,arrival.metre,from,turn.fromM);
      if(!Number.isFinite(travel))continue;
      // Local origins need a valid real downstream motorway RETURN, not a
      // same-numbered road all the way to it. An A48 origin can legitimately
      // use an A48 exit and later enter A3 Frankfurt. Reject no destinations
      // merely because the original motorway number ends at an AD.
      const returnRoads=rampMainlineArrivals(edges[plan.reentry],(a,b)=>!blockedMovement(a,b));
      if(!returnRoads.length&&!edges[plan.reentry].externalDetourDestination)continue;
      const candidate=candidatesByDestination.get(plan.closureId)||{best:null,share:0};
      const observed=observedPlanDelay(arrival.road,arrival.metre,plan);
      const willingness=localDiversionShare(arrival.road,arrival.metre,observed,plan);
      const entries=plan.entries.map(e=>({...e,durationS:estimatedOutsideSeconds(source,edges[e.reentry],true)}));
      const durationS=entries.reduce((n,e)=>n+e.weight*e.durationS,0);
      if(willingness>0&&(plan.kind==="closure"||durationS/60+returnWaitMinutes(plan.reentry)+5<observed)){
        const affected=plan.kind==="closure"?
          closureExposureAhead(arrival.road,arrival.metre,Infinity,plan.closureId):
          bottleneckExposureAhead(arrival.road,arrival.metre,plan.causeEdgeId);
        candidate.share=Math.max(candidate.share,affected*willingness);
      }
      if(!candidate.best||durationS<candidate.best.durationS)candidate.best={...plan,entries,durationS};
      candidatesByDestination.set(plan.closureId,candidate);
    }
    let result=null;
    for(const {best,share:fraction} of candidatesByDestination.values()){
      if(fraction>0&&(!result||fraction>result.fraction))result={plan:best,fraction};
    }
    // Local origins make the same gradual choice before entering the motorway.
    const arrivals=rampMainlineArrivals(source,(a,b)=>!blockedMovement(a,b));
    const entryShare=entranceDiversionShare(source);
    if(entryShare>(result?.fraction??0)){
      // Prefer a real bypass from this junction whose obstacle is still
      // ahead of the entry. Never select an opposite-direction return.
      let best=result?.plan&&arrivals.every(a=>diversionShare(observedPlanDelay(a.road,a.metre,result.plan))>0)?
        result.plan:null;
      for(const plan of exitDetours.values()){
        if(junctionLabel(edges[plan.terminal])!==junctionLabel(source))continue;
        if(!arrivals.every(a=>diversionShare(observedPlanDelay(a.road,a.metre,plan))>0))continue;
        const entries=plan.entries.map(e=>({...e,durationS:estimatedOutsideSeconds(source,edges[e.reentry],true)}));
        const durationS=entries.reduce((n,e)=>n+e.weight*e.durationS,0);
        if(!best||durationS<best.durationS)best={...plan,entries,durationS};
      }
      if(best)result={plan:best,fraction:entryShare};
    }
    localSourceChoiceCache.set(source.index,result);return result;
  }
  // Numeric keys avoid millions of short-lived strings in the cell solver.
  // A 230 m cell and the OSM Way length limit make 65536 cells per Way ample.
  function cellKey(j,k){return j*65536+k;}
  function internalGate(edge,k){
    return (activeEffects.get(edge.id)||NO_EFFECTS).some(x=>x.event.kind==="closure"&&x.gate&&
      x.fromM>k*edge.cellLength+.001&&x.fromM<=(k+1)*edge.cellLength+.001);
  }
  // Reachability of public-road entrants to a real motorway, excluding
  // any closed branch. These cars must not be routed out of another
  // terminal of the same collector merely because exit traffic uses it.
  let entryReachEpoch=-1,entryReach=new Set(),entryDistance=new Map();
  const structuralEntryReach=new Set(),structuralEntryDistance=new Map(),entryWork=edges.filter(e=>e.kind==="mainline");
  for(const road of entryWork)structuralEntryDistance.set(road.index,0);
  for(let i=0;i<entryWork.length;i++)for(const {from} of incomingTurns[entryWork[i].index]){
    if(from.kind!=="ramp"||structuralEntryReach.has(from.index))continue;
    structuralEntryReach.add(from.index);structuralEntryDistance.set(from.index,structuralEntryDistance.get(entryWork[i].index)+1);entryWork.push(from);
  }
  const cyclicEntryMoves=new Set();
  for(const road of edges)if(road.kind==="ramp"&&structuralEntryReach.has(road.index))for(const turn of road.links){
    if(edges[turn.to].kind!=="ramp"||!structuralEntryReach.has(turn.to))continue;
    const work=[turn.to],seen=new Set();
    for(let i=0;i<work.length;i++){
      const id=work[i];if(seen.has(id))continue;seen.add(id);
      if(id===road.index){cyclicEntryMoves.add(road.index+":"+turn.to);break;}
      for(const next of edges[id].links)if(edges[next.to].kind==="ramp")work.push(next.to);
    }
  }
  function legalEntryLinks(edge,k){
    if(entryReachEpoch!==exposureEpoch){
      entryReachEpoch=exposureEpoch;entryReach=new Set();entryDistance=new Map();
      const work=edges.filter(e=>e.kind==="mainline");
      for(const road of work)entryDistance.set(road.index,0);
      for(let i=0;i<work.length;i++)for(const {from,turn} of incomingTurns[work[i].index]){
        if(from.kind!=="ramp"||entryReach.has(from.index)||blockedMovement(from,turn))continue;
        if((activeEffects.get(from.id)||NO_EFFECTS).some(s=>s.event.kind==="closure"&&s.gate&&s.fromM<=turn.fromM+.05))continue;
        entryReach.add(from.index);entryDistance.set(from.index,entryDistance.get(work[i].index)+1);work.push(from);
      }
    }
    const evacuating=(activeEffects.get(edge.id)||NO_EFFECTS).some(s=>s.event.kind==="closure"&&
      s.fromM<=k*edge.cellLength+.001&&s.toM>k*edge.cellLength+.001);
    const distance=evacuating&&!entryReach.has(edge.index)?structuralEntryDistance:entryDistance;
    return edge.linksFrom[k].filter(t=>!blockedMovement(edge,t)&&
      (edges[t.to].kind==="mainline"||entryReach.has(t.to)||evacuating&&structuralEntryReach.has(t.to))&&
      (!cyclicEntryMoves.has(edge.index+":"+t.to)||distance.get(t.to)<distance.get(edge.index)));
  }
  // Reverse directed reachability from a specific physical exit. Each
  // cohort follows only a real cell-to-cell movement toward that exit;
  // a full ramp means waiting, not another random turn. Recompute only
  // when the legal closure graph changes.
  let routePathEpoch=-1,routePathMinute=-1;
  function cohortPath(terminal){
    const minute=Math.floor(elapsed/120);
    if(routePathEpoch!==exposureEpoch||routePathMinute!==minute){
      routePaths.clear();routePathCosts.clear();routePathEpoch=exposureEpoch;routePathMinute=minute;
    }
    if(routePaths.has(terminal))return routePaths.get(terminal);
    const target=edges[terminal],paths=new Map(),distances=new Map(),travelTimes=new Map(),heap=[];
    // A committed destination follows its shortest lawful free-flow path.
    // A queue must not cause a cohort to drive back and forth on different
    // carriageways just to approach the SAME exit from another side.
    // Keep actual travel time separately for comparing distinct routes.
    const cost=(edge,k)=>{
      const a=k*edge.cellLength,b=a+edge.cellLength;
      if((activeEffects.get(edge.id)||NO_EFFECTS).some(s=>s.fromM<b-.001&&s.toM>a+.001&&
        s.event.kind!=="closure"&&s.event.closedLanes.length===edge.lanes&&s.event.shoulder!=="open"))return Infinity;
      return Math.max(.1,edge.cellLength)*.06/routingCellSpeed(edge,k);
    };
    function offer(item){
      let i=heap.length;heap.push(item);
      while(i>0){const p=(i-1)>>1;if(heap[p].d<=item.d)break;heap[i]=heap[p];i=p;}
      heap[i]=item;
    }
    function poll(){
      const top=heap[0],tail=heap.pop();if(!heap.length)return top;
      let i=0;
      while(i*2+1<heap.length){let c=i*2+1;if(c+1<heap.length&&heap[c+1].d<heap[c].d)c++;
        if(heap[c].d>=tail.d)break;heap[i]=heap[c];i=c;}
      heap[i]=tail;return top;
    }
    const targetKey=cellKey(terminal,target.n-1);
    paths.set(targetKey,null);distances.set(targetKey,0);travelTimes.set(targetKey,0);offer({j:terminal,k:target.n-1,d:0});
    const add=(j,k,to,toCell,d)=>{
      const edge=edges[j];
      d+=Math.max(.1,edge.cellLength)*.06/edge.freeKmh;
      const key=cellKey(j,k);if(d>=(distances.get(key)??Infinity))return;
      const actual=cost(edge,k);if(!Number.isFinite(actual))return;
      distances.set(key,d);travelTimes.set(key,actual+travelTimes.get(cellKey(to,toCell)));
      paths.set(key,{to,toCell});offer({j,k,d});
    };
    while(heap.length){
      const {j,k,d}=poll(),edge=edges[j];
      if(d!==distances.get(cellKey(j,k)))continue;
      if(k>0&&!internalGate(edge,k-1))add(j,k-1,j,k,d);
      for(const {from,turn} of incomingTurns[j]){
        if(turn.toCell!==k||blockedMovement(from,turn))continue;
        const local=from.kind==="ramp"?localTerminal(from):null;
        if(local&&local!==from&&/\bAS\b|Abfahrt/i.test(local.name)&&!localTerminal(edge))continue;
        add(from.index,turn.fromCell,j,k,d);
      }
    }
    routePaths.set(terminal,paths);routePathCosts.set(terminal,travelTimes);return paths;
  }
  function interchangeTransferChoice(edge,k,options){
    const choices=dynamicTransferChoices.get(edge.index+":"+k);
    if(!choices?.length)return null;
    let best=null;
    for(const option of choices){
      const {bad,good,plan,causeEdgeId}=option;
      if(blockedMovement(edge,good))continue;
      const affected=options.find(o=>o.to===bad.to&&o.toCell===bad.toCell);
      const alternative=options.find(o=>o.to===good.to&&o.toCell===good.toCell);
      // A closed arm is not among legal movement options. Its ordinary
      // destination share must nevertheless be transferred to the OPEN
      // branch without sending a single vehicle into the physical barrier.
      if(!alternative||!affected&&!blockedMovement(edge,bad))continue;
      if(plan.kind==="closure"){
        // A closed arm can still lead to an OPEN local AS *before* the
        // blocked mainline section. If so, preserve the normal Frankfurt
        // transfer and allow its drivers to leave at the nearer AS. Forcing
        // them onto the Köln arm at every upstream AD would be incorrect.
        const branch=edges[bad.to];
        const arrivals=branch.kind==="mainline"?[{road:branch,metre:bad.toM}]:
          branch.kind==="ramp"?rampMainlineArrivals(branch,(a,b)=>!blockedMovement(a,b)):[];
        const laterExit=arrivals.some(a=>!!firstLocalExit(a.road,a.metre));
        if(!laterExit){
          best={...option,fraction:1,saving:Infinity};continue;
        }
        // Only the real time loss up to the nearest legal exit on the
        // affected arm justifies using the open alternate motorway arm.
        const delays=arrivals.map(a=>firstLocalExit(a.road,a.metre)).filter(Boolean).map(exit=>
          directedDelayToCause(branch,bad.toM,exit.road.id,exit.metre)).filter(Number.isFinite);
        const fraction=diversionShare(delays.length?Math.min(...delays):0);
        if(fraction>0&&(!best||fraction>best.fraction))best={...option,fraction,saving:Math.min(...delays)};
        continue;
      }
      if(!affected||affected.weight<=0)continue;
      // Cost of the SAME destination via the disrupted motorway and via
      // the other arm's real exit, with shared downstream reentry.
      let saving=-Infinity;
      for(const {road:target} of rampMainlineArrivals(edges[plan.reentry])){
        cohortPath(target.index);
        const costs=routePathCosts.get(target.index);
        const direct=costs.get(cellKey(bad.to,bad.toCell));
        const downstream=costs.get(cellKey(plan.reentry,0));
        if(Number.isFinite(direct)&&Number.isFinite(downstream)){
          cohortPath(plan.terminal);
          const local=routePathCosts.get(plan.terminal)
            .get(cellKey(good.to,good.toCell));
          if(Number.isFinite(local))
            saving=Math.max(saving,direct-(local+plan.durationS/60+
              returnWaitMinutes(plan.reentry)+downstream));
        }
      }
      if(!Number.isFinite(saving)){
        // Fully blocked accident: time is represented by the queue on all
        // successive affected roads (feeder, transfer and downstream), never
        // by a missing graph path or a fictional infinite time loss.
        const observed=observedPlanDelay(edge,bad.fromM,plan);
        if(Number.isFinite(observed)&&observed>30)
          saving=observed-plan.durationS/60-returnWaitMinutes(plan.reentry);
      }
      // A physically closed destination has no voluntary through option.
      // Divert its affected turning cohort even before a visible queue forms,
      // but leave the other motorway's original destinations untouched.
      const observed=observedPlanDelay(edge,bad.fromM,plan);
      const fraction=plan.kind==="closure"?1:
        .75*diversionShare(Number.isFinite(observed)?observed:0);
      if(saving>0&&fraction>0&&(!best||fraction>best.fraction))
        best={...option,fraction,saving};
    }
    return best;
  }
  function motorwayChoice(edge,k,options){
    const candidates=motorwayAlternatives.get(cellKey(edge.index,k));
    if(!candidates?.length)return null;
    const through=options.filter(o=>o.to===edge.index||edges[o.to].kind==="mainline"&&edges[o.to].ref===edge.ref);
    let best=null;
    for(const c of candidates){
      if(blockedMovement(edge,c.turn))continue;
      // Don't build a costly alternate-route tree before drivers have a
      // measurable reason to leave this corridor in the first place.
      const voluntary=c.kind==="closure"?0:.65*diversionShare(observedPlanDelay(edge,c.turn.fromM,c));
      if(c.kind!=="closure"&&voluntary<=0)continue;
      const target=edges[c.target];
      if((activeEffects.get(target.id)||NO_EFFECTS).some(x=>x.event.kind==="closure"&&x.toM>=target.lengthM-.01))continue;
      const path=cohortPath(c.target);
      const costs=routePathCosts.get(c.target);
      const alternative=costs.get(cellKey(c.turn.to,c.turn.toCell));
      if(!Number.isFinite(alternative))continue;
      // A genuine motorway bypass must first rejoin the ORIGINAL directed
      // corridor AFTER the incident. Merely reaching the same destination
      // via a U-turn or another pass through the bottleneck is not a bypass.
      const stamp=routePathEpoch+":"+routePathMinute;
      if(c.validationStamp!==stamp){
        let at=c.turn.to,cell=c.turn.toCell,rejoined=false,valid=true;
        const used=new Map(),visited=new Set();
        while(true){
          const segment=edges[at],key=cellKey(at,cell);
          if(visited.has(key)){valid=false;break;}visited.add(key);
          if(segment.kind==="mainline"){
            const corridor=directedCorridorIds.get(at);
            if(used.has(segment.ref)&&used.get(segment.ref)!==corridor||rejoined&&segment.ref!==edge.ref){valid=false;break;}
            used.set(segment.ref,corridor);
            if(segment.ref===edge.ref&&!rejoined){
              rejoined=c.downstream.has(segment.id)&&
                (segment.id!==c.endEdgeId||cell*segment.cellLength>=c.endOffset-.05);
              if(!rejoined){valid=false;break;}
            }
          }
          const next=path.get(key);
          if(!next){valid=at===c.target&&cell===target.n-1;break;}
          at=next.to;cell=next.toCell;
        }
        c.validBypass=valid&&rejoined;c.validationStamp=stamp;
      }
      if(!c.validBypass)continue;
      // A real motorway route is not automatically preferable to a local
      // bypass. Compare both to the same downstream anchor when available.
      const localCost=Math.min(...options.map(o=>{
        const plan=exitDetours.get(o.to);
        if(!plan||plan.closureId!==c.closureId)return Infinity;
        const rest=costs.get(cellKey(plan.reentry,0));
        return Number.isFinite(rest)?exitTravelMinutes(o,plan)+rest:Infinity;
      }));
      if(localCost+5<alternative)continue;
      // Compare the same destination on the original directed carriageway,
      // not an arbitrary alternative graph path or a missing path (Infinity).
      // The last legal fork of an actual closure can have no open through turn;
      // only in that case absence is evidence of a mandatory diversion.
      const originalCosts=through.map(t=>directCorridorCost(edges[t.to],
        t.toM??t.toCell*edges[t.to].cellLength,target,(target.n-1)*target.cellLength)).filter(x=>!Number.isNaN(x));
      const original=originalCosts.length?Math.min(...originalCosts):
        c.kind==="closure"&&Number.isFinite(closureDistanceAhead(edge,k*edge.cellLength,Infinity,c.closureId))?Infinity:NaN;
      if(Number.isNaN(original))continue;
      // On a full closure no new through demand enters an inaccessible
      // route. When traffic can still move, drivers retain different tastes.
      const mandatory=c.kind==="closure"&&original===Infinity&&!laterUsableExitBeforeClosure(edge,c.turn.fromM);
      const share=mandatory?1:
        c.kind==="closure"?.65*diversionShare(observedPlanDelay(edge,c.turn.fromM,c)):voluntary;
      if(share<=0||original<=alternative||best&&best.saving>=original-alternative)continue;
      best={...c,share,saving:original-alternative,through};
    }
    return best;
  }
  function changeRoute(j,k,terminal,amount){
    if(!amount)return;
    const key=cellKey(j,k),record=routeChanges.get(key)||{j,k,amounts:new Map()};
    record.amounts.set(terminal,(record.amounts.get(terminal)||0)+amount);
    routeChanges.set(key,record);
  }
  function accountRoute(terminal){
    if(!routeAccounting.has(terminal))routeAccounting.set(terminal,{assigned:0,arrived:0,released:0});
    return routeAccounting.get(terminal);
  }
  function enqueueDetour(plan,amount,dt){
    if(!plan||!(amount>0))return;
    outsideVehicles+=amount;detouredVehicles+=amount;
    for(const primary of plan.entries){
      if(primary.weight<=0)continue;
      // Preserve the destination direction, but allow the next lawful AS
      // after it when the normal return junction is itself congested.
      // Zero-weight entries are genuine later on-ramps for this event.
      const choices=plan.entries.filter(e=>e.closureId===primary.closureId&&
        (e===primary||e.weight===0));
      const commonDistance=Math.max(...choices.map(e=>e.distanceM));
      const cost=e=>e.durationS/60+returnWaitMinutes(e.reentry)+
        // Compare at the same downstream point on the original motorway.
        Math.max(0,commonDistance-e.distanceM)*.06/100;
      const isOpen=e=>edges[e.reentry].externalDetourDestination||!(activeEffects.get(edges[e.reentry].id)||NO_EFFECTS)
        .some(x=>x.event.kind==="closure");
      let entry=isOpen(primary)?primary:choices.find(isOpen)||primary;
      for(const option of choices){
        if(!isOpen(option))continue;
        if(cost(option)+10<cost(entry))entry=option;
      }
      const vehicles=amount*primary.weight;
      if(vehicles<=0)continue;
      let departure=elapsed+dt;
      const wide=entry.wideRoute;
      if(wide){
        // Shared finite residual service for the regional route. If several
        // boundary sources choose it, they queue outside the mapped network
        // instead of all appearing on the A4/A3 at the same instant.
        const service=wide.capacityVph*capacityRelief(false);
        departure=Math.max(departure,wideBookings.get(wide.id)||0)+vehicles/service*3600;
        wideBookings.set(wide.id,departure);
        const stats=wideAccounting.get(wide.id)||{label:wide.label,assigned:0,returned:0};
        stats.assigned+=vehicles;wideAccounting.set(wide.id,stats);
      }
      const readyAt=Math.ceil((departure+entry.durationS)/30)*30;
      const key=entry.reentry+":"+readyAt+":"+primary.closureId+(wide?":"+wide.id:"");
      const existing=detourBatchIndex.get(key);
      if(existing)existing.vehicles+=vehicles;
      else{
        const trip={reentry:entry.reentry,readyAt,vehicles,key,closureId:primary.closureId,
          durationS:entry.durationS,alternatives:choices,wide};
        detourTrips.push(trip);detourBatchIndex.set(key,trip);
      }
    }
  }
  function step(dt=5,refreshSpeeds=true){
    if(!finite(dt)||dt<=0||dt>15)throw Error("Ungültiger Simulationstakt");
    updateEffects();
    buildDetourPlans();
    const anyClosureActive=[...activeEffects.values()].some(items=>
      items.some(item=>item.event.kind==="closure"));
    if(closureForkEpoch!==exposureEpoch){closureDiversionForks.clear();closureForkEpoch=exposureEpoch;}
    diversionDecisions.clear();
    enteredStep.fill(0);departedStep.fill(0);routeChanges.clear();
    for(let j=0;j<edges.length;j++){
      const edge=edges[j],n=edge.n,stock=edge.stock;
      const s=send[j],r=receive[j],d=delta[j];
      d.fill(0);divertDelta[j].fill(0);bypassDelta[j].fill(0);entryDelta[j].fill(0);
      used[j].fill(0);accepted[j].fill(0);
      // Backward-moving queue front; receiving depends on downstream room.
      const effects=activeEffects.get(edge.id)||NO_EFFECTS;
      for(let k=0;k<n;k++){
        const a=k*edge.cellLength,b=(k+1)*edge.cellLength;
        const local=effects.length?
          effects.filter(e=>e.fromM<b-.001&&e.toM>a+.001):NO_EFFECTS;
        const closed=local.length?new Set():NO_LANES,incidentClosed=local.length?new Set():NO_LANES;
        let shoulderOpen=false,shoulderBlocked=false,blockedAtGate=false;
        let permitted=edge.freeKmh;
        for(const item of local){
          const ev=item.event;
          const closedHere=ev.kind==="closure"?Array.from({length:edge.lanes},(_,i)=>i):ev.closedLanes.filter(lane=>lane<edge.lanes);
          for(const lane of closedHere){
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
        const restartFactor=density>.60?.96:density>.42?.98:1;
        // Actual speed/occupancy trigger a transient headway penalty. Low
        // density clears it; no periodic arbitrary speed oscillations.
        edge.brakeMemory[k]=brakingMemory(edge.brakeMemory[k],density,
          edge.cellFlowSpeeds[k],edge.freeKmh,dt);
        const inputs=mergeInputs[j][k];
        let entering=k>0?edge.cellThroughVph[k-1]:0,largest=entering;
        for(const input of inputs){
          const flow=input.from.cellThroughVph[input.cell];
          entering+=flow;largest=Math.max(largest,flow);
        }
        // Interaction strength is generated by competing traffic streams,
        // not by the name of an interchange or a fixed peak-hour switch.
        const merge=entering>0?2*(entering-largest)/entering:0;
        const state=trafficOperatingState(density,clamp01(merge),edge.kind==="mainline");
        // At very low legal speeds vehicle length consumes more of the
        // available headway. 80 km/h does not halve capacity versus 160.
        const lowSpeed=permitted<60?(permitted/(7+1.45*permitted/3.6))/(60/(7+1.45*60/3.6)):1;
        // Alternating headways of discharged vehicle groups (mixed fast and
        // slow drivers). The phase advances only with real vehicle movement;
        // it freezes in a blocked cell and disappears in free traffic.
        const platoon=clamp01((density-.23)/.30)*
          clamp01((.80-edge.cellFlowSpeeds[k]/edge.freeKmh)/.55);
        const groupPhase=platoon>0?Math.sin(edge.platoonProgress[k]*Math.PI*2):0;
        const headway=1-.14*platoon*(.5+.5*groupPhase);
        const operatingFactor=state.capacityFactor*restartFactor*lowSpeed*headway*(1-.05*edge.brakeMemory[k]);
        const cap=open*edge.capacityPerLane*restriction*operatingFactor*dt/3600;
        const moving=Math.min(1,(permitted*state.speedFactor/3.6)*dt/edge.cellLength);
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
          openIncident*edge.capacityPerLane*incidentFactor*operatingFactor*dt/3600:cap;
        edge.cellCapacityVph[k]=cap*3600/dt;
        edge.cellMotion[k]=moving;
        s[k]=Math.min(stock[k],transferCapacity,stock[k]*moving);
        const room=Math.max(0,edge.jamPerCell-stock[k]);
        // A delayed start/release changes the room actually accepted by
        // downstream traffic, even when the dense receiving branch (rather
        // than lane service) limits the flow. This propagates upstream via
        // the conserved cell movements; its average wave speed is unchanged.
        const wave=Math.min(1,(receivingWave(density,edge.kind==="mainline")*(1+.24*platoon*groupPhase)/3.6)*dt/edge.cellLength);
        r[k]=blockedAtGate?0:Math.min(room,transferCapacity,room*wave);
        edge.cellReceivingVph[k]=r[k]*3600/dt;
      }
    }
    // Brake before reaching the next slow cell or lane drop. This changes
    // real sending speeds, not just the colour of the road. The squared
    // speed relation is a comfortable deceleration envelope; vehicles
    // never lose their stock and the receiving limit still applies.
    for(const edge of edges)for(let k=0;k<edge.n;k++){
      const move=brakeSuccessors[edge.index][k];
      if(!move||edge.stock[k]<.1)continue;
      const next=edges[move.to],n=move.toCell;
      const density=next.stock[n]/Math.max(.001,next.jamPerCell);
      const restriction=next.cellCapacityVph[n]/(next.lanes*next.capacityPerLane);
      let target=next.freeKmh;
      if(density>.23)target=Math.min(target,next.cellFlowSpeeds[n]);
      if(restriction<.75)target=Math.min(target,next.freeKmh*Math.max(.20,restriction));
      const distance=Math.max(15,edge.cellLength*.50);
      const approach=Math.sqrt((target/3.6)**2+2*.8*distance)*3.6;
      const motion=Math.min(edge.cellMotion[k],approach/3.6*dt/edge.cellLength);
      edge.cellMotion[k]=motion;send[edge.index][k]=Math.min(send[edge.index][k],edge.stock[k]*motion);
    }
    // One simultaneous allocation for every motorway cell face and OSM
    // connector. Ramp merges compete with the mainline for REAL receiving
    // space, while exit splits share the originating cell's sending capacity.
    // This fixes mid-Way motorway junctions without creating new road geometry.
    const laneReceive=new Map(),throughStart=new Map(),throughSent=new Map();
    const terminalBudgets=new Map();
    for(const {members,capacity,first} of localExitGroups){
      const demands=members.map(e=>Math.min(send[e.index][e.n-1],localDischargeRate(e)*dt/3600));
      const total=demands.reduce((a,b)=>a+b,0),limit=effectiveJunctionCapacity(first,capacity)*dt/3600;
      if(total<=limit)continue;
      members.forEach((e,i)=>terminalBudgets.set(e.index,Math.min(terminalBudgets.get(e.index)??Infinity,demands[i]*limit/total)));
    }
    const terminalBudget=edge=>Math.min(localDischargeRate(edge)*dt/3600,terminalBudgets.get(edge.index)??Infinity);
    for(const fork of forks){
      const {edge,k,moves,branches,cells,shares}=fork;
      const weightSum=moves.reduce((n,t)=>n+t.weight,0);
      const congested=branches.some(t=>receive[t.to][t.toCell]+1e-6<send[edge.index][k]*t.weight/weightSum&&
        (receive[t.to][t.toCell]<1e-6||edges[t.to].stock[t.toCell]>.25*edges[t.to].jamPerCell));
      if(!fork.active&&!congested)continue;
      // Event routing has its own destination cohorts; do not superimpose
      // ordinary lane commitments where the actual route must be replanned.
      const legalTurns=edge.linksFrom[k].filter(t=>!blockedMovement(edge,t));
      const rerouting=!!motorwayChoice(edge,k,moves)||!!interchangeTransferChoice(edge,k,moves)||branches.some(t=>
        blockedMovement(edge,t)||designatedTransfers.has(edge.index+":"+t.to)||
        localTerminal(edges[t.to])&&localChoiceAtExit(edge,t)>0)||
        anyClosureActive&&closureForkDecision(edge,k,legalTurns,true).closureDecision>0||
        cells.some(c=>c.edge.divertStock[c.k]>1e-9||c.edge.routeStock[c.k]);
      if(rerouting){if(fork.active)for(const c of cells)clearTurnWaiting(c.edge,c.k);fork.active=false;continue;}
      releaseVoluntaryWaiting(edge,k,new Set(shares.keys()));
      fork.active=true;
      const weights=moves.map(t=>({key:cellKey(t.to,t.toCell),weight:t.weight*(edges[t.to].kind==="ramp"&&localTerminal(edges[t.to])?localTurnScale(edge):1)}));
      const sum=weights.reduce((n,t)=>n+t.weight,0);
      for(const {edge:road,k:cell} of cells){
        const pending=road.turnStock[cell]||new Map();
        for(const key of pending.keys())if(!shares.has(key))pending.delete(key);
        const fresh=Math.max(0,road.stock[cell]-[...pending.values()].reduce((n,x)=>n+x,0));
        for(const t of weights)pending.set(t.key,(pending.get(t.key)||0)+fresh*t.weight/sum);
        road.turnStock[cell]=pending;
        throughStart.set(cellKey(road.index,cell),pending.get(fork.throughKey)||0);
        const limits=new Map(),wave=Math.min(1,(receivingWave(road.stock[cell]/Math.max(.001,road.jamPerCell),true)/3.6)*dt/road.cellLength);
        for(const [key,share] of shares){
          const room=Math.max(0,road.jamPerCell*share-(pending.get(key)||0));
          limits.set(key,Math.min(receive[road.index][cell],room,room*wave,road.cellCapacityVph[cell]*dt/3600*share));
        }
        laneReceive.set(cellKey(road.index,cell),limits);
      }
    }
    for(const bucket of activeBuckets)bucket.length=0;
    activeBuckets.length=0;
    let requestCount=0;
    const splitSources=[];
    const push=(to,toCell,from,fromCell,want,mark=false,tagShare,markFraction,protect=false,routeTerminal=null,newRouteTerminal=null,ignoreBypass=false,turnKey=null,carryTurnKey=null,entry=false)=>{
      const arr=requestBuckets[to][toCell];
      if(!arr.length)activeBuckets.push(arr);
      const req=requestPool[requestCount]||(requestPool[requestCount]={});requestCount++;
      req.to=to;req.toCell=toCell;req.from=from;req.fromCell=fromCell;req.want=want;
      req.mark=mark;req.tagShare=tagShare;req.markFraction=markFraction;req.protect=protect;
      req.routeTerminal=routeTerminal;req.newRouteTerminal=newRouteTerminal;req.ignoreBypass=ignoreBypass;
      req.turnKey=turnKey;req.carryTurnKey=carryTurnKey;req.entry=entry;
      arr.push(req);
    };
    for(let j=0;j<edges.length;j++){
      const edge=edges[j],out=send[j];
      for(let k=0;k<edge.n;k++){
        let available=out[k];
        if(available<=0)continue;
        // Most motorway cells have exactly one ordinary continuation. They
        // need the same simultaneous receiving allocation, but no OD/turn
        // choice, copied link objects, temporary arrays or route searches.
        // Use the full path whenever a closure, lane fork or cohort exists.
        if(!anyClosureActive&&edge.kind==="mainline"&&!edge.entryStock[k]&&
          !edge.divertStock[k]&&!edge.routeStock[k]&&!edge.turnStock[k]&&!approachForks[j][k]?.active){
          const turns=edge.linksFrom[k];
          if(k<edge.n-1&&!turns.length){
            if(receive[j][k+1]>0)push(j,k+1,j,k,available,false,0);
            continue;
          }
          if(k===edge.n-1&&!boundaryExit[j]&&turns.length===1){
            const t=turns[0],target=edges[t.to];
            if(target.kind==="mainline"&&target.ref===edge.ref&&!blockedMovement(edge,t)){
              if(receive[t.to][t.toCell]>0)push(t.to,t.toCell,j,k,available,false,0);
              continue;
            }
          }
        }
        const entryAmount=edge.entryStock[k];
        if(entryAmount>1e-9&&edge.kind==="ramp"){
          clearTurnWaiting(edge,k);
          const moves=legalEntryLinks(edge,k);
          if(k<edge.n-1&&!internalGate(edge,k))moves.push({to:j,toCell:k+1,weight:20});
          const sum=moves.reduce((a,b)=>a+b.weight,0);
          const wanting=available*entryAmount/edge.stock[k];
          for(const m of moves)if(sum>0)push(m.to,m.toCell,j,k,wanting*m.weight/sum,false,0,undefined,false,null,null,false,null,null,true);
          available-=wanting;
          if(available<=1e-10)continue;
        }
        let cohorts=edge.routeStock[k];
        if(cohorts||edge.divertStock[k]>1e-9)clearTurnWaiting(edge,k);
        // A cohort returning to its original motorway is no longer a
        // bypass cohort. If a new closure invalidates a committed route,
        // release it for fresh legal routing rather than freezing forever.
        if(cohorts)for(const [terminal,amount] of cohorts){
          const arrived=edges[terminal].kind==="mainline"&&terminal===j&&k===edge.n-1;
          const unreachable=!(terminal===j&&k===edge.n-1)&&!cohortPath(terminal).has(cellKey(j,k));
          if(!arrived&&!unreachable)continue;
          cohorts.delete(terminal);
          edge.divertStock[k]=Math.max(0,edge.divertStock[k]-amount);
          const account=accountRoute(terminal);
          if(arrived)account.arrived+=amount;else account.released+=amount;
        }
        if(cohorts&&!cohorts.size)edge.routeStock[k]=cohorts=null;
        let routeTotal=0;
        if(cohorts)for(const [terminal,amount] of cohorts){
          if(terminal===j&&k===edge.n-1)continue;
          routeTotal+=amount;
          const next=cohortPath(terminal).get(cellKey(j,k));
          if(next)push(next.to,next.toCell,j,k,out[k]*amount/edge.stock[k],false,1,
            undefined,false,terminal);
        }
        available=Math.max(0,available-out[k]*routeTotal/edge.stock[k]);
        if(available<=1e-10)continue;
        const ordinaryStock=Math.max(0,edge.stock[k]-routeTotal-entryAmount);
        const ordinaryTagShare=ordinaryStock>1e-9?
          Math.max(0,Math.min(1,(edge.divertStock[k]-routeTotal)/ordinaryStock)):0;
        const fork=approachForks[j][k];
        if(fork?.active&&!(fork.edge===edge&&fork.k===k)&&!routeTotal&&ordinaryTagShare<1e-9){
          const next=ordinaryMoves(edge,k)[0],pending=edge.turnStock[k];
          if(next&&pending&&!internalGate(edge,k)&&(next.to===j||!blockedMovement(edge,next))){
            const limits=laneReceive.get(cellKey(next.to,next.toCell));
            if(limits){
              const demands=[...pending].map(([key,n])=>[key,Math.min(n*edge.cellMotion[k],limits.get(key)||0)]);
              const total=demands.reduce((n,t)=>n+t[1],0),scale=total>available?available/total:1;
              for(const [key,want] of demands)if(want>0)push(next.to,next.toCell,j,k,want*scale,false,0,undefined,false,null,null,false,key,key);
              continue;
            }
          }
        }
        let options=[];
        // Never cross from an unclosed cell into a newly closed physical
        // interval of this same long OSM Way. Receiving inside the closure
        // remains available exclusively for pre-existing interior vehicles.
        const crossesClosureGate=internalGate(edge,k);
        if(k<edge.n-1&&receive[j][k+1]>0&&!crossesClosureGate)
          options.push({to:j,toCell:k+1,weight:20});
        // A local off-ramp can have both a public-road terminal and a
        // return-to-motorway branch at the same junction. Drivers leaving
        // here must keep the terminal route even when the on-ramp is full.
        const terminal=edge.kind==="ramp"?localTerminal(edge):null;
        const localFork=terminal&&terminal!==edge&&/\bAS\b/.test(junctionLabel(edge))&&
          /\bAS\b|Abfahrt/i.test(terminal.name);
        const legalTurns=edge.linksFrom[k].filter(link=>
          !blockedMovement(edge,link)&&(!localFork||localTerminal(edges[link.to])));
        for(const link of legalTurns){
          if(receive[link.to][link.toCell]>0)options.push({...link});
        }
        // Keep the nominal destination split even when a genuine local exit
        // is full. A stopped off-ramp cannot make its assigned vehicles
        // disappear into another open route, nor vice versa.
        if(legalTurns.length+Number(k<edge.n-1&&!crossesClosureGate)+Number(k===edge.n-1&&boundaryExit[j])>1){
          if(k<edge.n-1&&!crossesClosureGate&&!options.some(x=>x.to===j))
            options.push({to:j,toCell:k+1,weight:20});
          for(const link of legalTurns)
            if(!options.some(x=>x.to===link.to&&x.toCell===link.toCell))options.push({...link});
        }
        // External map continuation is open only when a real motorway
        // is not modelled beyond this location. Never turn it into a jam.
        let outsideWeight=k===edge.n-1&&boundaryExit[j]?
          (edge.kind==="mainline"?20:1):0;
        // A full motorway closure is a HARD route exclusion: on an upstream
        // junction, all demand must take one of the legal escape turns. The
        // previous 7-90% ramp split sent residual traffic into the barrier.
        // A saturated exit is still a valid destination: motorists must queue
        // for its receiving capacity, not skip past it into the closure.
        let hasLegalClosureDetour=false,diversionIntent=0,strictSplit=false,voluntaryLocalDecision=false;
        // A real local exit at this very fork is an option as delay grows.
        // The local exit remains eligible even when its receiving room is 0.
        const localDelayChoice=link=>localChoiceAtExit(edge,link);
        const localDelayTurns=edge.kind==="mainline"?legalTurns.filter(link=>
          localTerminal(edges[link.to])&&isUsableEscape(edge,link)&&
          localDelayChoice(link)>0):[];
        const localDelayShare=localDelayTurns.length?Math.max(...localDelayTurns.map(link=>
          localDelayChoice(link))):0;
        const dynamic=!localDelayShare&&edge.kind==="mainline"?interchangeTransferChoice(edge,k,options):null;
        const motorway=!localDelayShare&&!dynamic&&edge.kind==="mainline"?motorwayChoice(edge,k,options):null;
        if(dynamic){
          const {bad,good,plan,fraction}=dynamic;
          const blocked=options.find(o=>o.to===bad.to&&o.toCell===bad.toCell);
          const alternate=options.find(o=>o.to===good.to&&o.toCell===good.toCell);
          if(alternate&&(blocked||blockedMovement(edge,bad))){
            diversionDecisions.set(plan.terminal,Math.max(diversionDecisions.get(plan.terminal)||0,fraction));
            const shifted=(blocked?.weight??bad.weight)*fraction;
            if(blocked)blocked.weight-=shifted;
            alternate.weight+=shifted;
            alternate.markFraction=shifted/alternate.weight;
            alternate.newRouteTerminal=plan.terminal;
            alternate.ignoreBypass=true;
            strictSplit=true;
          }
        }
        if(motorway){
          const throughWeight=motorway.through.reduce((n,turn)=>n+turn.weight,0)||20;
          const moved=throughWeight*motorway.share;
          let alternate=options.find(o=>o.to===motorway.turn.to&&o.toCell===motorway.turn.toCell);
          if(!alternate){alternate={...motorway.turn};options.push(alternate);}
          for(const turn of motorway.through)turn.weight*=1-motorway.share;
          alternate.weight+=moved;
          alternate.markFraction=moved/alternate.weight;
          alternate.newRouteTerminal=motorway.target;
          alternate.ignoreBypass=true;
          strictSplit=true;
        }else if(!dynamic&&edge.kind==="mainline"&&legalTurns.some(link=>
          edges[link.to].kind==="ramp"||
          edges[link.to].kind==="mainline"&&edges[link.to].ref!==edge.ref)){
          const {distance,currentAlternatives,localTurns,earlyTurns,localShare,earlyShare,closureShare,closureDecision}=
            closureForkDecision(edge,k,legalTurns,anyClosureActive);
          const jamTurns=currentAlternatives.filter(link=>{
            const plan=exitDetours.get(link.to);
            return plan&&plan.kind!=="closure"&&!directBoundaryChoice(edge,link,plan)&&closureExitEligible(edge,link.fromM,plan);
          });
          const jamShare=jamTurns.length?Math.max(...jamTurns.map(link=>{
            const plan=exitDetours.get(link.to);
            const affected=plan.causeEdgeId?
              bottleneckExposureAhead(edge,link.fromM,plan.causeEdgeId):1;
            return affected*exitChoiceShare(edge,link,plan);
          })):0;
          const share=Math.max(localDelayShare,closureDecision,jamShare);
          const preferLocal=localDelayShare>0&&localDelayShare>=Math.max(closureDecision,jamShare);
          const preferJam=jamShare>closureDecision&&jamShare>0;
          if(share>0){
            const alternatives=preferLocal?localDelayTurns:preferJam?jamTurns:
              localShare>0?localTurns:earlyShare>0?earlyTurns:closureShare<=0?jamTurns:legalTurns.filter(link=>{
              const target=edges[link.to];
              return (target.kind==="ramp"||
                target.kind==="mainline"&&target.ref!==edge.ref)&&
                isUsableEscape(edge,link);
            });
          if(alternatives.length){
            hasLegalClosureDetour=Number.isFinite(distance);
            diversionIntent=share;
            voluntaryLocalDecision=share<1&&(preferLocal||preferJam||earlyShare>0&&localShare===0);
            for(const turn of alternatives){
              const terminal=localTerminal(edges[turn.to]);
              if(terminal)diversionDecisions.set(terminal.index,Math.max(diversionDecisions.get(terminal.index)||0,share));
            }
            if(anyClosureActive&&(closureShare>0||alternatives.some(t=>exitDetours.get(t.to)?.kind==="closure")))
              closureDiversionForks.add(cellKey(j,k));
            // A mandatory exit retains its assigned traffic when saturated.
            // Do not redistribute its cars onto the open mainline.
            strictSplit=preferLocal||preferJam||localShare>0||earlyShare>0||closureShare<=0;
            const alternateKey=new Set(alternatives.map(link=>
              link.to+":"+link.toCell));
            const rawExitWeight=alternatives.reduce((n,link)=>n+link.weight,0);
            // In a full closure every open exit/other motorway is eligible,
            // including a currently saturated turn. For merely long delays,
            // normal receiving-limited choices remain in play.
            options=share===1?alternatives.map(link=>({...link})):
              options.concat(alternatives.filter(link=>
                !options.some(o=>o.to===link.to&&o.toCell===link.toCell)).map(link=>({...link})));
            if(strictSplit&&share<1){
              // Normal destination flow can advance only on the original
              // carriageway, even when the current off-ramp has no space.
              if(k<edge.n-1&&!crossesClosureGate&&!options.some(x=>x.to===j))
                options.push({to:j,toCell:k+1,weight:20});
              for(const link of legalTurns)
                if(!options.some(x=>x.to===link.to&&x.toCell===link.toCell))
                  options.push({...link});
            }
            if(share===1){
              // No through movement is legal beyond this last usable exit.
              outsideWeight=0;
              for(const turn of options){turn.weight=Math.max(.001,turn.weight);turn.diversionEligible=true;}
            }else{
              // Shift the requested proportion of the actual non-exit
              // destination weights; never assume each fork has weight 20.
              const nonExitWeight=options.reduce((n,o)=>n+
                (alternateKey.has(o.to+":"+o.toCell)?0:o.weight),outsideWeight);
              const multiplier=(rawExitWeight+nonExitWeight*share)/Math.max(.001,rawExitWeight);
              outsideWeight*=1-share;
              for(const opt of options){
                const isExit=alternateKey.has(opt.to+":"+opt.toCell);
                if(strictSplit&&!isExit)opt.protect=true;
                opt.weight*=isExit?multiplier:1-share;
                if(isExit){
                  opt.diversionEligible=true;
                  opt.diversionFraction=1-1/multiplier;
                }
              }
            }
          }
          }
        }
        // Drivers who were already beyond the primary exit take the first
        // real local exit of the open alternate motorway. The tagged share
        // alone is forced off there; normal traffic stays on its own route.
        if(anyClosureActive&&edge.kind==="mainline"&&!motorway&&!localDelayShare){
          const fallback=legalTurns.find(t=>fallbackExits.has(t.to));
          const tagged=ordinaryTagShare;
          if(fallback&&tagged>1e-8&&(!exitDetours.has(fallback.to)||fallbackExits.get(fallback.to).designated)){
            strictSplit=true;
            const through=options.filter(x=>x.to!==fallback.to);
            if(k<edge.n-1&&!crossesClosureGate&&!through.some(x=>x.to===j))
              through.push({to:j,toCell:k+1,weight:20});
            for(const link of legalTurns)
              if(link.to!==fallback.to&&!through.some(x=>x.to===link.to&&x.toCell===link.toCell))
                through.push({...link});
            const weight=through.reduce((a,x)=>a+x.weight,0);
            const normalExit=fallback.weight/(fallback.weight+Math.max(.001,weight));
            const exitShare=tagged+(1-tagged)*normalExit;
            options=[{...fallback,weight:exitShare,tagShare:tagged/exitShare}];
            for(const opt of through)options.push({...opt,weight:opt.weight/Math.max(.001,weight)*(1-exitShare),tagShare:0});
          }
          for(const opt of options){
            const signedShare=designatedTransfers.get(j+":"+opt.to);
            if(signedShare!==undefined){opt.markFraction=signedShare.fraction;opt.newRouteTerminal=signedShare.terminal;opt.ignoreBypass=true;strictSplit=true;}
            else if(diversionIntent>0&&fallbackTransfers.has(j+":"+opt.to)){
              // The model uses nominal motorway turn shares to estimate
              // the stranded through-destination fraction at the fork.
              opt.markFraction=20/(20+Math.max(.001,opt.weight));
              opt.newRouteTerminal=fallbackExits.get(fallbackTransfers.get(j+":"+opt.to))?.terminal??null;
              strictSplit=true;
            }
          }
        }
        // Only tag newly diverted exit traffic when its real OSM ramp is
        // connected to a verified downstream on-ramp return. Ordinary exits
        // are counted as trips ending outside this motorway extract.
        for(const opt of options)
          if(opt.to!==j&&opt.diversionEligible&&exitDetours.has(opt.to)&&!directBoundaryChoice(edge,opt)){
            opt.mark=opt.diversionFraction===undefined;
            if(!opt.mark){opt.markFraction=opt.diversionFraction;opt.ignoreBypass=true;}
            // Multiple ramp fragments or branches at one AS must not split
            // the assigned traffic away from its actual public-road exit.
            opt.newRouteTerminal=exitDetours.get(opt.to).terminal;
            opt.terminalChoices=exitDetours.get(opt.to).terminalChoices;
            strictSplit=true;
          }
        if(edge.kind==="mainline"&&!strictSplit&&diversionIntent===0&&
          options.some(opt=>opt.to!==j&&edges[opt.to].kind==="ramp")){
          const scale=localTurnScale(edge);
          if(scale<.999)for(const opt of options){
            const target=edges[opt.to];
            if(target.kind!=="ramp")continue;
            const terminal=localTerminal(target);
            if(terminal&&/\bAS\b|Abfahrt/i.test(terminal.name))opt.weight*=scale;
          }
        }
        if(!options.length&&!outsideWeight)continue;
        if(options.length>1&&hasLegalClosureDetour&&!strictSplit&&!routeTotal&&diversionIntent>=1-1e-9)
          splitSources.push({from:j,cell:k,available,options});
        const sum=options.reduce((n,x)=>n+x.weight,0)+outsideWeight;
        // Assign ordinary traffic to its intended outgoing movement once.
        // Receiving capacity limits that movement, never its destination.
        // Separate movement demands compete for the total physical sending
        // capacity; a full branch does not consume unused service of an open
        // through lane. Its waiting inventory remains in the approach cell
        // and can propagate backpressure if the available storage fills.
        let ordinaryTurns=null,ordinaryOutside=0;
        if((!strictSplit||diversionIntent>0||dynamic||motorway)&&!routeTotal&&ordinaryTagShare<1e-9&&
          options.length+Number(outsideWeight>0)>1&&sum>0){
          const choices=options.map(o=>({key:cellKey(o.to,o.toCell),weight:o.weight,receiving:receive[o.to][o.toCell]}));
          if(outsideWeight)choices.push({key:"outside",weight:outsideWeight,receiving:terminalBudget(edge)});
          const pending=edge.turnStock[k]||new Map();
          const legalKeys=new Set(choices.map(o=>o.key));
          if(!voluntaryLocalDecision&&diversionIntent===0&&!dynamic&&!motorway)releaseVoluntaryWaiting(edge,k,legalKeys);
          for(const key of pending.keys())if(!legalKeys.has(key))pending.delete(key);
          if(edge.voluntaryWaiting[k])for(const key of edge.voluntaryWaiting[k].keys())
            if(!legalKeys.has(key))edge.voluntaryWaiting[k].delete(key);
          const through=options.find(o=>edges[o.to].kind==="mainline"&&edges[o.to].ref===edge.ref&&!o.diversionEligible);
          const throughKey=through?cellKey(through.to,through.toCell):undefined;
          const committed=[...pending.values()].reduce((n,x)=>n+x,0);
          const fresh=Math.max(0,ordinaryStock-committed);
          for(const choice of choices)pending.set(choice.key,(pending.get(choice.key)||0)+fresh*choice.weight/sum);
          if(voluntaryLocalDecision)for(const opt of options)if(opt.diversionEligible&&localTerminal(edges[opt.to]))
            rememberVoluntaryWaiting(edge,k,cellKey(opt.to,opt.toCell),throughKey,fresh*opt.weight/sum*(opt.diversionFraction||0));
          // Drivers waiting on the through lanes at THIS fork can still
          // decide to leave when the queue reaches the junction. The old
          // permanent ordinary turn commitment trapped every waiting car
          // in the through queue and starved the open exit of new arrivals.
          // Reconsider gradually, only when the through movement is actually
          // constrained and the chosen exit has real receiving capacity.
          const willingness=motorway?.share??dynamic?.fraction??diversionIntent;
          if(willingness>0&&edge.kind==="mainline"){
            const donors=options.filter(o=>dynamic?
              o.to===dynamic.bad.to&&o.toCell===dynamic.bad.toCell:
              edges[o.to].kind==="mainline"&&edges[o.to].ref===edge.ref&&!o.diversionEligible);
            for(const opt of options){
              if(!(opt.diversionEligible||opt.newRouteTerminal!==undefined)||donors.includes(opt))continue;
              const key=cellKey(opt.to,opt.toCell),motion=Math.max(.001,edge.cellMotion[k]);
              let room=Math.max(0,receive[opt.to][opt.toCell]/motion-(pending.get(key)||0));
              for(const donor of donors){
                const from=cellKey(donor.to,donor.toCell),queued=pending.get(from)||0;
                const waiting=Math.max(0,queued-receive[donor.to][donor.toCell]/motion);
                const shifted=Math.min(room,waiting*Math.min(1,willingness*dt/60));
                if(shifted<=0)continue;
                pending.set(from,queued-shifted);pending.set(key,(pending.get(key)||0)+shifted);room-=shifted;
                if(voluntaryLocalDecision&&opt.diversionEligible&&localTerminal(edges[opt.to]))
                  rememberVoluntaryWaiting(edge,k,key,from,shifted);
              }
            }
          }
          edge.turnStock[k]=pending;
          ordinaryTurns=new Map(choices.map(o=>[o.key,Math.min((pending.get(o.key)||0)*edge.cellMotion[k],o.receiving)]));
          const demand=[...ordinaryTurns.values()].reduce((n,x)=>n+x,0);
          const scale=demand>available?available/demand:1;
          for(const [key,want] of ordinaryTurns)ordinaryTurns.set(key,want*scale);
          ordinaryOutside=ordinaryTurns.get("outside")||0;
        }else clearTurnWaiting(edge,k); // a changed route or legal gate permits replanning
        for(const opt of options){
          const key=cellKey(opt.to,opt.toCell);
          const want=ordinaryTurns?ordinaryTurns.get(key)||0:available*opt.weight/sum;
          if(want>0){
            const targets=opt.terminalChoices?.length?opt.terminalChoices:[opt.newRouteTerminal??null];
            const waiting=ordinaryTurns?edge.voluntaryWaiting[k]?.get(key):null;
            const fraction=waiting&&voluntaryLocalDecision?clamp01(waiting.amount/Math.max(.001,edge.turnStock[k].get(key)||0)):opt.markFraction;
            for(const target of targets)push(opt.to,opt.toCell,j,k,want/targets.length,opt.mark===true,opt.tagShare??ordinaryTagShare,fraction,opt.protect,null,target,opt.ignoreBypass,ordinaryTurns?key:null);
          }
        }
        if(outsideWeight){
          // A local public-road junction has a finite discharge rate. A
          // public-road service varies with the site and time of day.
          const localCapacity=terminalBudget(edge);
          const leaving=Math.min(ordinaryTurns?ordinaryOutside:available*outsideWeight/sum,localCapacity);
          if(ordinaryTurns)edge.turnStock[k].set("outside",Math.max(0,(edge.turnStock[k].get("outside")||0)-leaving));
          delta[j][k]-=leaving;
          departedStep[j]+=leaving;
          // Tag accounting follows exactly the exiting subflow. No vehicle
          // is re-created at an on-ramp: the same fraction stays conserved
          // in the off-network travel inventory until reaching it.
          const tagged=Math.min(leaving,leaving*ordinaryTagShare);
          if(cohorts&&cohorts.has(j)&&k===edge.n-1){
            const cohortLeaving=Math.min(tagged,leaving*cohorts.get(j)/Math.max(1e-9,ordinaryStock));
            changeRoute(j,k,j,-cohortLeaving);accountRoute(j).arrived+=cohortLeaving;
          }
          divertDelta[j][k]-=tagged;
          bypassDelta[j][k]-=edge.stock[k]>1e-9?leaving*edge.bypassStock[k]/edge.stock[k]:0;
          const plan=terminalDetours.get(j);
          const rerouted=plan?tagged:0;
          exited+=leaving-rerouted;
          enqueueDetour(plan,rerouted,dt);
          used[j][k]+=leaving;
        }
      }
    }
    for(const requests of activeBuckets){
      const {to,toCell}=requests[0];
      const accepting=receive[to][toCell];
      const groupLimits=laneReceive.get(cellKey(to,toCell));
      if(groupLimits){
        const byGroup=new Map();
        for(const req of requests)if(req.carryTurnKey!==null)byGroup.set(req.carryTurnKey,(byGroup.get(req.carryTurnKey)||0)+req.want);
        for(const req of requests)if(req.carryTurnKey!==null){
          const total=byGroup.get(req.carryTurnKey)||0,limit=groupLimits.get(req.carryTurnKey)||0;
          if(total>limit)req.want*=limit/total;
        }
      }
      const required=requests.reduce((sum,x)=>sum+x.want,0);
      let rampRatio=1,mainRatio=1;
      const target=edges[to],density=target.stock[toCell]/Math.max(.001,target.jamPerCell);
      if(required>accepting&&target.kind==="mainline"&&density>.27){
        // A ramp merges into available gaps, not its nominal 1500 veh/h.
        // Preserve lane-weighted mainline priority and let either stream use
        // the other's unused room. Both streams retain unserved vehicles.
        let rampDemand=0,mainDemand=0,rampLanes=0;
        const approaches=new Set();
        for(const req of requests){
          const from=edges[req.from];
          if(from.kind==="ramp"){
            rampDemand+=req.want;
            if(!approaches.has(from.index)){approaches.add(from.index);rampLanes+=from.lanes;}
          }else mainDemand+=req.want;
        }
        if(rampDemand>0&&mainDemand>0){
          const priority=Math.min(.5,rampLanes/(target.lanes+rampLanes));
          const rampRoom=Math.min(rampDemand,Math.max(accepting*priority,accepting-mainDemand));
          rampRatio=rampRoom/rampDemand;
          mainRatio=Math.min(1,(accepting-rampRoom)/mainDemand);
        }else rampRatio=mainRatio=accepting/required;
      }else if(required>accepting)rampRatio=mainRatio=accepting/required;
      for(const req of requests){
        const amount=req.want*(edges[req.from].kind==="ramp"?rampRatio:mainRatio);
        const fromEdge=edges[req.from],stock=fromEdge.stock[req.fromCell];
        if(req.turnKey!==null){
          const pending=fromEdge.turnStock[req.fromCell];
          const choice=fromEdge.voluntaryWaiting[req.fromCell]?.get(req.turnKey);
          if(choice){
            choice.amount=Math.max(0,choice.amount-amount*clamp01(choice.amount/Math.max(.001,pending.get(req.turnKey)||0)));
            if(choice.amount<1e-9)fromEdge.voluntaryWaiting[req.fromCell].delete(req.turnKey);
          }
          pending.set(req.turnKey,Math.max(0,(pending.get(req.turnKey)||0)-amount));
          const fork=approachForks[req.from][req.fromCell];
          if(fork?.active&&req.turnKey===fork.throughKey){
            const key=cellKey(req.from,req.fromCell);
            throughSent.set(key,(throughSent.get(key)||0)+amount);
          }
        }
        if(req.carryTurnKey!==null){
          const pending=edges[to].turnStock[toCell];
          pending.set(req.carryTurnKey,(pending.get(req.carryTurnKey)||0)+amount);
        }
        const originallyTagged=stock>1e-9?
          amount*(req.tagShare??Math.min(1,fromEdge.divertStock[req.fromCell]/stock)):0;
        divertDelta[req.from][req.fromCell]-=originallyTagged;
        const bypassed=stock>1e-9?Math.min(amount-originallyTagged,amount*fromEdge.bypassStock[req.fromCell]/stock):0;
        bypassDelta[req.from][req.fromCell]-=bypassed;
        if(req.markFraction===undefined&&!req.mark)
          bypassDelta[to][toCell]+=req.protect?amount-originallyTagged:bypassed;
        const newlyTagged=req.mark?amount-originallyTagged:
          (amount-originallyTagged-(req.ignoreBypass?0:bypassed))*(req.markFraction??0);
        divertDelta[to][toCell]+=originallyTagged+newlyTagged;
        if(req.entry){
          entryDelta[req.from][req.fromCell]-=amount;
          if(edges[to].kind==="ramp")entryDelta[to][toCell]+=amount;
        }
        if(req.routeTerminal!==null){
          changeRoute(req.from,req.fromCell,req.routeTerminal,-amount);
          changeRoute(to,toCell,req.routeTerminal,amount);
        }
        const assigned=req.mark?amount:newlyTagged;
        if(req.newRouteTerminal!==null&&assigned>0){
          changeRoute(to,toCell,req.newRouteTerminal,assigned);
          accountRoute(req.newRouteTerminal).assigned+=assigned;
        }
        delta[req.from][req.fromCell]-=amount;
        delta[to][toCell]+=amount;
        used[req.from][req.fromCell]+=amount;
        accepted[to][toCell]+=amount;
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
      let remaining=split.available-used[split.from][split.cell];
      if(remaining<1e-6)continue;
      for(const opt of [...split.options].sort((a,b)=>b.weight-a.weight)){
        const spare=receive[opt.to][opt.toCell]-accepted[opt.to][opt.toCell];
        if(spare<=1e-6)continue;
        const moved=Math.min(remaining,spare);
        const sourceEdge=edges[split.from],old=sourceEdge.stock[split.cell];
        const originallyTagged=old>1e-9?
          moved*Math.min(1,sourceEdge.divertStock[split.cell]/old):0;
        divertDelta[split.from][split.cell]-=originallyTagged;
        divertDelta[opt.to][opt.toCell]+=opt.mark?moved:originallyTagged;
        const bypassed=old>1e-9?moved*sourceEdge.bypassStock[split.cell]/old:0;
        bypassDelta[split.from][split.cell]-=bypassed;
        if(!opt.mark)bypassDelta[opt.to][opt.toCell]+=bypassed;
        delta[split.from][split.cell]-=moved;
        delta[opt.to][opt.toCell]+=moved;
        if(opt.to!==split.from){
          enteredStep[opt.to]+=moved;
          departedStep[split.from]+=moved;
        }
        accepted[opt.to][opt.toCell]+=moved;
        remaining-=moved;
        if(remaining<=1e-6)break;
      }
    }
    // An off-network journey takes time. Only after that trip reaches its
    // due time may it rejoin through an existing directed OSM on-ramp,
    // subject to exactly the same physical receiving capacity as local cars.
    // An overloaded re-entry queues OFF the motorway, rather than teleporting
    // vehicles into full cells or multiplying the model inventory.
    // Serve the oldest ready trip at each return ramp first. Iterating in
    // reverse previously let new batches jump a long off-network queue.
    const localAdmissionUsed=new Map();
    for(let i=0;i<detourTrips.length;i++){
      const trip=detourTrips[i];
      if(trip.readyAt>elapsed+dt)continue;
      const road=edges[trip.reentry];
      if(trip.wide&&!wideRouteOpen(trip.wide))continue;
      if(road.externalDetourDestination){
        // Arrival beyond the mapped network: finish the same conserved
        // trip outside it, without spawning a car on a nonexistent road.
        outsideVehicles-=trip.vehicles;exited+=trip.vehicles;
        detourTrips.splice(i--,1);detourBatchIndex.delete(trip.key);
        continue;
      }
      const closed=(activeEffects.get(road.id)||NO_EFFECTS).some(x=>
        x.event.kind==="closure"&&x.gate&&x.fromM<road.cellLength)||
        entranceDiversionShare(road)>=1;
      if(closed){
        // A second closure can invalidate a return while cars are already
        // travelling outside the displayed network. Keep their inventory
        // and select another known same-direction entry, if one exists.
        const next=trip.alternatives.filter(e=>e.reentry!==trip.reentry&&
          !(activeEffects.get(edges[e.reentry].id)||NO_EFFECTS).some(x=>x.event.kind==="closure")&&
          entranceDiversionShare(edges[e.reentry])<1)
          .sort((a,b)=>a.durationS/60+returnWaitMinutes(a.reentry)-b.durationS/60-returnWaitMinutes(b.reentry))[0];
        if(next){
          detourBatchIndex.delete(trip.key);
          trip.readyAt=Math.ceil((elapsed+Math.max(300,next.durationS-trip.durationS))/30)*30;
          trip.reentry=next.reentry;trip.durationS=next.durationS;
          trip.key=trip.reentry+":"+trip.readyAt+":"+trip.closureId;
          const existing=detourBatchIndex.get(trip.key);
          if(existing){existing.vehicles+=trip.vehicles;detourTrips.splice(i--,1);}
          else detourBatchIndex.set(trip.key,trip);
        }
        continue;
      }
      const current=accepted[road.index][0]+(localAdmissionUsed.get(road.index)||0);
      const room=Math.max(0,receive[road.index][0]-current);
      const remaining=Math.max(0,localAdmissionRate(road)*dt/3600-(localAdmissionUsed.get(road.index)||0));
      const admitted=Math.min(trip.vehicles,room,remaining);
      if(admitted<=0)continue;
      delta[road.index][0]+=admitted;
      if(trip.wide){
        // The return can be on another motorway (A4). Keep its intended
        // downstream A3 carriageway, not the A4's normal destination split.
        const target=trip.wide.target.index;
        divertDelta[road.index][0]+=admitted;
        changeRoute(road.index,0,target,admitted);accountRoute(target).assigned+=admitted;
        wideAccounting.get(trip.wide.id).returned+=admitted;
      }else if(road.kind==="ramp")entryDelta[road.index][0]+=admitted;
      localAdmissionUsed.set(road.index,(localAdmissionUsed.get(road.index)||0)+admitted);
      enteredStep[road.index]+=admitted;
      outsideVehicles-=admitted;returnedVehicles+=admitted;
      trip.vehicles-=admitted;
      if(trip.vehicles<1e-7){
        detourTrips.splice(i--,1);detourBatchIndex.delete(trip.key);
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
      if(edge.kind==="ramp")legalEntryLinks(edge,0);
      const entryClosed=(activeEffects.get(edge.id)||NO_EFFECTS)
        .some(x=>x.event.kind==="closure"&&x.gate&&x.fromM<edge.cellLength)||
        (edge.kind==="ramp"&&anyClosureActive&&!entryReach.has(edge.index));
      const sourceDetour=localSourceChoice(edge);
      const wide=sourceDetour?.plan?.kind==="wide";
      const offered=entryClosed&&!(edge.externalTransferOrigin&&sourceDetour?.plan)&&!wide?0:edge.referencePeakVph*(demandPercent/100)*
        sourceFactor(edge,clockMs())*dt/3600;
      generated+=offered;
      // A source backlog is made of real waiting cars, too. Once every
      // driver chooses the bypass, don't quietly inject that old backlog
      // into the disturbed motorway behind the closed route choice.
      const diverted=sourceDetour?
        offered*sourceDetour.fraction+(sourceDetour.fraction===1?edge.backlog:
          wide?edge.backlog*sourceDetour.fraction*Math.min(1,dt/60):0):0;
      if(diverted>0){
        if(sourceDetour.plan)enqueueDetour(sourceDetour.plan,diverted,dt);
        else exited+=diverted; // outside the mapped motorway, no invented return
      }
      const available=edge.backlog+offered-diverted;
      const admitted=entryClosed?0:Math.min(available,
        Math.max(0,receive[j][0]-accepted[j][0]-(localAdmissionUsed.get(j)||0)),
        Math.max(0,localAdmissionRate(edge)*dt/3600-(localAdmissionUsed.get(j)||0)));
      delta[j][0]+=admitted;
      if(edge.kind==="ramp")entryDelta[j][0]+=admitted;
      enteredStep[j]+=admitted;
      // The closed-destination share was already sent to the local bypass.
      // Remaining local entrants are explicitly bound to an open route;
      // do not classify them as Frankfurt-bound a second time at the AD.
      if(sourceDetour&&!wide)bypassDelta[j][0]+=admitted;
      edge.backlog=Math.max(0,available-admitted);
    }
    const alpha=1-Math.exp(-dt/120),speedAlpha=1-Math.exp(-dt/30);
    for(const {j,k,amounts} of routeChanges.values()){
      const stock=edges[j].routeStock[k]||new Map();
      for(const [terminal,change] of amounts){
        const amount=(stock.get(terminal)||0)+change;
        if(amount< -1e-6)throw Error("Negative Umleitungskohorte: "+edges[j].id);
        if(amount>1e-9)stock.set(terminal,amount);else stock.delete(terminal);
      }
      edges[j].routeStock[k]=stock.size?stock:null;
    }
    for(let j=0;j<edges.length;j++){
      const edge=edges[j],change=delta[j];
      for(let k=0;k<edge.n;k++){
        const before=edge.stock[k],sent=used[j][k];
        edge.platoonProgress[k]=(edge.platoonProgress[k]+sent/Math.max(12,edge.lanes*18))%1;
        edge.cellThroughVph[k]+=alpha*(sent*3600/dt-edge.cellThroughVph[k]);
        edge.cellIncomingVph[k]+=alpha*(Math.max(0,sent+change[k])*3600/dt-edge.cellIncomingVph[k]);
        const throughBefore=throughStart.get(cellKey(j,k))??before;
        const throughFlow=throughStart.has(cellKey(j,k))?throughSent.get(cellKey(j,k))||0:sent;
        const branchBefore=Math.max(0,before-throughBefore),branchFlow=Math.max(0,sent-throughFlow);
        if(branchBefore>.1){
          const movement=Math.min(branchBefore*edge.freeKmh,branchFlow*Math.max(edge.cellLength,edge.freeKmh*dt/3.6)*3.6/dt);
          edge.branchMovement[k]+=speedAlpha*(movement-edge.branchMovement[k]);
          edge.branchExposure[k]+=speedAlpha*(branchBefore-edge.branchExposure[k]);
          edge.branchSpeed[k]=edge.branchMovement[k]/Math.max(.001,edge.branchExposure[k]);
        }else{
          edge.branchMovement[k]=edge.branchExposure[k]=0;edge.branchSpeed[k]=edge.freeKmh;
        }
        if(throughBefore>=.3){
          const effectiveLength=Math.max(edge.cellLength,edge.freeKmh*dt/3.6);
          // Vehicle-weighted space mean. 30 s time constant retains real
          // waves but avoids extrapolating one 5 s stop across kilometres.
          const movement=Math.min(throughBefore*edge.freeKmh,
            Math.max(0,throughFlow*effectiveLength*3.6/dt));
          if(edge.cellSpeedExposure[k]<.01){
            edge.cellSpeedMovement[k]=movement;edge.cellSpeedExposure[k]=throughBefore;
          }else{
            edge.cellSpeedMovement[k]+=speedAlpha*(movement-edge.cellSpeedMovement[k]);
            edge.cellSpeedExposure[k]+=speedAlpha*(throughBefore-edge.cellSpeedExposure[k]);
          }
          edge.cellFlowSpeeds[k]=edge.cellSpeedMovement[k]/Math.max(.001,edge.cellSpeedExposure[k]);
        }else{
          edge.cellSpeedMovement[k]=0;edge.cellSpeedExposure[k]=0;edge.cellFlowSpeeds[k]=edge.freeKmh;
        }
        const after=edge.stock[k]+change[k];
        if(after < -1e-7||after>edge.jamPerCell+1e-6)
          throw Error("Ungültiger Fahrzeugbestand auf "+edge.id);
        edge.stock[k]=Math.max(0,after);
        const entry=edge.entryStock[k]+entryDelta[j][k];
        if(entry< -1e-6||entry>edge.stock[k]+1e-6)throw Error("Auffahrtsbestand verletzt: "+edge.id);
        edge.entryStock[k]=Math.max(0,Math.min(edge.stock[k],entry));
        if(edge.turnStock[k]&&[...edge.turnStock[k].values()].reduce((a,b)=>a+b,0)>edge.stock[k]+1e-6)
          throw Error("Abbiegebestand verletzt: "+edge.id);
        const diverted=edge.divertStock[k]+divertDelta[j][k];
        edge.divertStock[k]=Math.min(Math.max(0,edge.stock[k]-edge.entryStock[k]),Math.max(0,diverted));
        if(edge.routeStock[k]){
          const committed=[...edge.routeStock[k].values()].reduce((a,b)=>a+b,0);
          if(committed>edge.divertStock[k]+1e-6)throw Error("Umleitungszielbestand verletzt: "+edge.id);
        }
        const bypass=edge.bypassStock[k]+bypassDelta[j][k];
        edge.bypassStock[k]=anyClosureActive?Math.min(edge.stock[k]-edge.divertStock[k],Math.max(0,bypass)):0;
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
  // Physical gate endpoints for the map. One START and one REOPEN per
  // directed motorway closure; they come from the exact same OSM spans
  // that the physics and red/white overlay use. No invented map points.
  function closureGatePoints(){
    const result=[],at=clockMs();
    for(const record of eventRecords.values()){
      if(record.spec.kind!=="closure"||
        record.spec.schedule&&
          !global.StauEventSchedule.active(record.spec.schedule,at))continue;
      const mainSpans=record.spans.filter(span=>
        byId.get(span.edgeId)?.kind==="mainline");
      if(!mainSpans.length)continue;
      const first=mainSpans[0],last=mainSpans.at(-1);
      const endRoad=byId.get(last.edgeId);
      result.push({eventId:record.spec.id,type:"start",
        edgeId:first.edgeId,offsetM:first.fromM});
      result.push({eventId:record.spec.id,type:"reopen",
        edgeId:last.edgeId,
        offsetM:Math.max(0,Math.min(endRoad.lengthM-.001,last.toM))});
    }
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
      if(edge.kind!=="ramp"&&edge.kind!=="mainline")continue;
      if(edge.kind==="mainline")for(const own of activeEffects.get(edge.id)||NO_EFFECTS){
        if(!own.derivedFeederClosure||!own.gate)continue;
        if(own.fromM>.05||!incomingTurns[edge.index].length||
          incomingTurns[edge.index].some(({from,turn})=>blockedMovement(from,turn)))
          add(edge,own.fromM,own.event.id);
      }
      if(edge.kind==="ramp"){
        const own=(activeEffects.get(edge.id)||NO_EFFECTS)
          .find(x=>x.derivedRampClosure||
            (x.event.kind==="closure"&&x.gate));
        if(own){
          // A ramp starts at its true physical fork. Only pin the gate at
          // the first blocked access from an OPEN approach, not at 70% of
          // every small ramp fragment (which looked like a mid-ramp barrier).
          const entering=incomingTurns[edge.index];
          const openApproach=entering.some(({from,turn})=>blockedMovement(from,turn));
          if(own.fromM>.05||openApproach||!entering.length)
            add(edge,own.fromM,own.event.id);
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
        const eventId=match?.event.id||(blockedFeederTurns.get(turn)||NO_EFFECTS)[0];
        if(eventId)add(edge,turn.fromM,eventId);
      }
    }
    return points;
  }
  function edgeActivity(id,offsetM=0){
    const edge=byId.get(id);
    if(!edge)return null;
    const count=edge.stock.reduce((sum,x)=>sum+x,0);
    const turnCommitments=new Map();
    for(const cell of edge.turnStock)if(cell)for(const [target,vehicles] of cell){
      const targetId=target==="outside"?"outside":edges[Math.floor(target/65536)].id;
      turnCommitments.set(targetId,(turnCommitments.get(targetId)||0)+vehicles);
    }
    const at=Math.max(0,Math.min(edge.n-1,Math.floor((Number(offsetM)||0)/edge.cellLength)));
    let sectionSpeedKmh=visualCellState(edge,at).speed;
    for(const effect of activeEffects.get(id)||NO_EFFECTS)
      if(effect.fromM<(at+1)*edge.cellLength&&effect.toM>at*edge.cellLength&&effect.event.speedKmh>0)
        sectionSpeedKmh=Math.min(sectionSpeedKmh,effect.event.speedKmh);
    return {reachable:reachable.has(id),vehicles:count,
      turnCommitments:[...turnCommitments].map(([targetEdgeId,vehicles])=>({targetEdgeId,vehicles})),
      voluntaryWaitingVehicles:edge.voluntaryWaiting.reduce((n,waiting)=>n+(waiting?[...waiting.values()].reduce((sum,c)=>sum+c.amount,0):0),0),
      localEntryVehiclesOnEdge:edge.entryStock.reduce((sum,x)=>sum+x,0),
      divertedVehiclesOnEdge:edge.divertStock.reduce((sum,x)=>sum+x,0),
      sectionVph:edge.cellThroughVph[at],sectionInflowVph:edge.cellIncomingVph[at],
      flowClosed:closureBands(id).some(b=>offsetM>=b.fromM-.05&&offsetM<=b.toM+.05),flowSampled:elapsed>0,
      sectionSpeedKmh,boundaryExit:boundaryExit[edge.index],
      enteredVph:edge.enteredVph,departedVph:edge.departedVph,
      enteredLastStep:enteredStep[edge.index],departedLastStep:departedStep[edge.index],
      capacityVph:edge.lanes*edge.capacityPerLane,
      operatingCapacityVph:edge.cellCapacityVph[at],
      receivingCapacityVph:edge.cellReceivingVph[at],
      availableCapacityVph:Math.min(edge.cellReceivingVph[at],edge.cellCapacityVph[at],
        localDischargeRate(edge),localAdmissionRate(edge)),
      localDischargeVph:localDischargeVph(edge),
      localExitTerminalId:localTerminal(edge)?.id??null,
      localDischargeRateVph:finite(localDischargeRate(edge))?localDischargeRate(edge):null,
      localDischargeLimitVph:localDischargeVph(edge)===null?null:effectiveJunctionCapacity(edge,localDischargeVph(edge)),
      localAdmissionVph:finite(localAdmissionVph(edge))?localAdmissionVph(edge):null,
      localAdmissionRateVph:finite(localAdmissionRate(edge))?localAdmissionRate(edge):null,
      localSourceDetourFraction:localSourceChoice(edge)?.fraction??0,
      diversionDemandFraction:diversionDecisions.get(localTerminal(edge)?.index??edge.index)??0,
      lengthM:edge.lengthM,storageVehicles:edge.n*edge.jamPerCell,
      source:edge.source,sourcePeakVph:edge.referencePeakVph,
      sourceDirection:edge.directionKey,connections:edge.links.length};
  }
  function speed(id){return byId.get(id)?.speed??null;}
  function color(id){const edge=byId.get(id);return edge?colourForSpeed(edge.speed):"free";}
  return {advance,step,refresh:()=>{recomputeSpeeds();return totals();},reset,warmStart,setMode,setEvent,removeEvent,listEvents,eventsOnRoad,visualBands,closureBands,
    setSimulationStart,clockMs,eventStatus,setDemandPercent,totals,speed,color,mode,
    activeEvents,jamSummaries:()=>jamGroups,queueRoadInfo,sourceCount:()=>sources.length,edgeCount:()=>edges.length,
    edgeActivity,hasEdge:id=>byId.has(id),reachable:id=>reachable.has(id),reachableCount:()=>reachable.size,
    excludedTrapMovements:()=>excludedTrapMovements,
    recommendedClosureLength,closureAccessPoints,closureGatePoints,
    movementBlocked:(fromId,toId)=>{
      const from=byId.get(fromId);
      return !!from&&from.links.some(link=>edges[link.to].id===toId&&
        blockedMovement(from,link));
    },
    incomingCount:id=>byId.get(id)?.incoming??0,
    entryIncomingCount:id=>byId.get(id)?.incomingAtStart??0,
    sourceIds:()=>sources.map(x=>x.id),
    normalizedReversedWays:()=>[...reversedWays],
    migrateLegacyEvent,restoreEvent,
    diversionShare,wideDiversionShare,lengthDiversionShare,
    routingQueueLength:(id,offsetM=0)=>byId.has(id)?routingQueueLength(byId.get(id),offsetM):0,
    queueAtExit:(id,offsetM=0)=>byId.has(id)&&queueAtExit(byId.get(id),offsetM),
    routingDelayAhead:(id,offsetM=0,maxDistance=50000)=>byId.has(id)?measuredDelayAhead(byId.get(id),offsetM,maxDistance):null,
    routingDelayToDestination:(id,offsetM,targetId,targetOffset=null)=>byId.has(id)&&byId.has(targetId)?
      directedDelayToCause(byId.get(id),offsetM,targetId,targetOffset,false,true):null,
    routingDelayToNextExit:(id,offsetM=0)=>byId.has(id)?nextDecisionDelay(byId.get(id),offsetM):null,
    routingDelayToPreferredTransferExit:(id,offsetM=0)=>byId.has(id)?preferredTransferDelay(byId.get(id),offsetM,null):null,
    detourPlans:()=>[...exitDetours.values(),...fallbackExits.values()].map(plan=>({
      terminalEdgeId:edges[plan.terminal].id,
      reentryEdgeId:edges[plan.reentry].id,
      delaySeconds:plan.durationS,closureId:plan.closureId,
      kind:plan.kind,
      reentries:plan.entries.map(entry=>({
        edgeId:edges[entry.reentry].id,weight:entry.weight,
        distanceM:entry.distanceM,delaySeconds:entry.durationS
      }))})),
    detourDestinations:eventId=>{
      updateEffects();buildDetourPlans();
      return [...new Set([...exitDetours.values(),...fallbackExits.values()].flatMap(plan=>
        plan.entries.filter(e=>e.closureId===eventId&&e.weight>0)
          .map(e=>edges[e.reentry].externalDetourLabel||(edges[e.reentry].externalDetourDestination?"A61 · Netzgrenze AK Koblenz":edges[e.reentry].name))))];
    },
    designatedDetourRoutes:eventId=>{
      updateEffects();buildDetourPlans();
      return [...fallbackExits.values()].filter(p=>p.designated&&p.closureId===eventId)
        .map(p=>p.feederRef+" → "+p.transferRef+" → "+junctionLabel(edges[p.terminal])+" → "+junctionLabel(edges[p.reentry]));
    },
    wideDetourRoutes:eventId=>{
      updateEffects();buildDetourPlans();
      return (wideRoutesByEvent.get(eventId)||[]).filter(wideRouteOpen).map(route=>({
        id:route.id,label:route.label,reentryEdgeId:route.reentry.id,targetEdgeId:route.target.id,
        assigned:wideAccounting.get(route.id)?.assigned||0,returned:wideAccounting.get(route.id)?.returned||0,
        waitingMin:Math.max(0,(wideBookings.get(route.id)||0)-elapsed)/60
      }));
    },
    wideDetourAccounting:()=>[...wideAccounting].map(([id,x])=>({id,...x,
      outside:detourTrips.filter(t=>t.wide?.id===id).reduce((n,t)=>n+t.vehicles,0)})),
    detourRouteAccounting:()=>[...routeAccounting].map(([terminal,stats])=>{
      const remaining=edges.reduce((n,edge)=>n+edge.routeStock.reduce((v,cell)=>v+(cell?.get(terminal)||0),0),0);
      return {terminalEdgeId:edges[terminal].id,assigned:stats.assigned,arrived:stats.arrived,
        released:stats.released,remaining,residual:stats.assigned-stats.arrived-stats.released-remaining};
    }),
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
