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
function createLegacyTrafficScenario(data){
  if(!data||!Array.isArray(data.roads))throw Error("Geprüfte lokale Kartendaten fehlen");
  const edges=[],outByNode=new Map(),inByNode=new Map(),byId=new Map();
  let excludedRest=0;
  for(const row of data.roads){
    if(!Array.isArray(row[4])||row[4].length<2)continue;
    if(row[1]==="ramp"&&REST.test(row[5]||"")){excludedRest++;continue;}
    const id=String(row[0]),lanes=Math.max(1,Math.min(6,Math.floor(Number(row[3])||1)));
    const meters=lengthM(row[4]);
    if(meters<0.2||byId.has(id))continue;
    const count=Math.max(1,Math.ceil(meters/230));
    const edge={
      id,kind:row[1],ref:row[2],lanes,shoulderTag:row[7]||null,
      from:coord(row[4][0]),to:coord(row[4].at(-1)),
      first:row[4][0],lengthM:meters,
      n:count,cellLength:meters/count,
      stock:new Float64Array(count),
      capacityPerLane:row[1]==="ramp"?1550:2200,
      freeKmh:row[1]==="ramp"?75:120,
      jamPerCell:130*lanes*(meters/count)/1000,
      next:[],incoming:0,incomingAtStart:0,source:false,backlog:0,
      mode:"none",speed:row[1]==="ramp"?75:120,visualBands:[],
      links:[],linksFrom:Array.from({length:count},()=>[]),
      enteredVph:0,departedVph:0
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
    const source=data.roads.find(row=>String(row[0])===edge.id);
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
    const link={to:to.index,fromCell,toCell,weight};
    from.links.push(link);from.linksFrom[fromCell].push(link);
    to.incoming++;
    if(toM<.01)to.incomingAtStart++;
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
    const source=data.roads.find(row=>String(row[0])===edge.id);
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
  // Select external corridor boundaries from actual graph sources.
  // This avoids injecting imaginary cars at all the map's internal OSM gaps.
  const limits=new Map();
  for(const edge of edges){
    if(edge.kind!=="mainline"||!edge.ref)continue;
    const box=limits.get(edge.ref)??{minLat:90,maxLat:-90,minLon:180,maxLon:-180};
    for(const p of [edge.first]){
      box.minLat=Math.min(box.minLat,p[0]);box.maxLat=Math.max(box.maxLat,p[0]);
      box.minLon=Math.min(box.minLon,p[1]);box.maxLon=Math.max(box.maxLon,p[1]);
    }
    limits.set(edge.ref,box);
  }
  const sources=[];
  for(const edge of edges){
    if(edge.incomingAtStart||edge.kind!=="mainline"||!edge.ref)continue;
    const box=limits.get(edge.ref);
    if(!box)continue;
    const [lat,lon]=edge.first;
    const latSpan=box.maxLat-box.minLat,lonSpan=box.maxLon-box.minLon;
    const northSouthKm=latSpan*111,westEastKm=lonSpan*111*Math.cos(lat*rad);
    const useLat=latSpan>.002&&northSouthKm>=westEastKm*.8;
    const useLon=lonSpan>.002&&westEastKm>=northSouthKm*.8;
    const latMargin=latSpan*.035,lonMargin=lonSpan*.035;
    if((useLat&&(lat-box.minLat<=latMargin||box.maxLat-lat<=latMargin))||
       (useLon&&(lon-box.minLon<=lonMargin||box.maxLon-lon<=lonMargin))||
       (!useLat&&!useLon&&lat===box.minLat&&lon===box.minLon)){
      edge.source=true;sources.push(edge);
    }
  }
  // Only edge paths downstream of source boundaries can receive model traffic.
  // The rest remains visible OSM geometry but is not falsely presented as simulated.
  // A ramp beginning on a local (non-motorway) road is a legitimate local
  // source only when its OSM geometry actually connects into the motorway.
  // This is NOT phantom traffic injected on an inner motorway cell.
  const localSources=edges.filter(edge=>edge.kind==="ramp"&&
    edge.incomingAtStart===0&&edge.links.length>0);
  for(const edge of localSources){edge.source=true;sources.push(edge);}
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
  let elapsed=0,generated=0,exited=0,demandPercent=100;
  let jamGroups=[];
  function totals(){
    let inside=0,backlog=0;
    for(const edge of edges){
      for(const n of edge.stock)inside+=n;
      backlog+=edge.backlog;
    }
    const residual=generated-exited-inside-backlog;
    return {simSeconds:elapsed,generatedVehicles:generated,exitedVehicles:exited,
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
    const traceResult=trace(edge,offset,length);
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
      const effectList=activeEffects.get(edge.id)||[];
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
      if(edge.next.length!==1)continue;
      const target=edges[edge.next[0].to];
      if(target.incomingAtStart!==1)continue;
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
    elapsed=0;generated=0;exited=0;
    for(const edge of edges){
      edge.stock.fill(0);edge.backlog=0;edge.speed=edge.freeKmh;
      edge.enteredVph=0;edge.departedVph=0;
    }
    if(clearEvents)eventRecords.clear();
    effectsStamp=null;updateEffects();recomputeSpeeds();
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
  // Local clock affects traffic: winter Friday PM peaks differ from Sunday.
  // Baseline demand is a scenario assumption; no claims of observed traffic.
  const clockFormatter=new Intl.DateTimeFormat("en-GB",{
    timeZone:"Europe/Berlin",weekday:"short",hour:"2-digit",hourCycle:"h23"
  });
  let cachedTimeBucket=-1,cachedTimeFactor=1;
  function timeDemandFactor(time){
    const bucket=Math.floor(time/600000);
    if(bucket===cachedTimeBucket)return cachedTimeFactor;
    cachedTimeBucket=bucket;
    const parts=Object.fromEntries(clockFormatter.formatToParts(new Date(time))
      .map(p=>[p.type,p.value]));
    const hour=Number(parts.hour),day=parts.weekday;
    const weekday=day!=="Sat"&&day!=="Sun";
    const commuting=hour>=6&&hour<9?1.22:hour>=15&&hour<19?1.26:
      hour>=11&&hour<15?1.03:hour>=9&&hour<11?1.08:
      hour>=19&&hour<22?.74:hour>=5&&hour<6?.72:.38;
    const weekend=day==="Sun"?.62:day==="Sat"?.78:1;
    const friday=day==="Fri"&&hour>=12&&hour<19?1.15:1;
    cachedTimeFactor=commuting*weekend*friday*(weekday?1:.98);
    return cachedTimeFactor;
  }
  function step(dt=5,refreshSpeeds=true){
    if(!finite(dt)||dt<=0||dt>15)throw Error("Ungültiger Simulationstakt");
    updateEffects();
    enteredStep.fill(0);departedStep.fill(0);
    for(let j=0;j<edges.length;j++){
      const edge=edges[j],n=edge.n,stock=edge.stock;
      const s=send[j],r=receive[j],d=delta[j];
      d.fill(0);
      const wave=Math.min(1,(22/3.6)*dt/edge.cellLength);
      const effects=activeEffects.get(edge.id)||[];
      for(let k=0;k<n;k++){
        const a=k*edge.cellLength,b=(k+1)*edge.cellLength;
        const local=effects.filter(e=>e.fromM<b-.001&&e.toM>a+.001);
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
    const proposed=new Map();
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
          const firstM=link.toCell*target.cellLength;
          const toEffects=activeEffects.get(target.id)||[];
          const blocked=toEffects.filter(item=>item.gate&&
            item.fromM>=firstM-.01&&item.fromM<firstM+target.cellLength+.01&&
            (item.event.kind==="closure"||
              item.event.closedLanes.length===target.lanes&&
              item.event.shoulder!=="open"));
          if(blocked.length){
            const upstream=activeEffects.get(edge.id)||[];
            if(!blocked.some(item=>upstream.some(from=>
              from.event.id===item.event.id)))continue;
          }
          options.push(link);
        }
        if(!options.length)continue;
        const sum=options.reduce((n,x)=>n+x.weight,0);
        for(const opt of options)
          push(opt.to,opt.toCell,j,k,available*opt.weight/sum);
      }
    }
    for(const requests of proposed.values()){
      const {to,toCell}=requests[0];
      const accepting=receive[to][toCell];
      const required=requests.reduce((sum,x)=>sum+x.want,0);
      const ratio=required>accepting?accepting/required:1;
      for(const req of requests){
        const amount=req.want*ratio;
        delta[req.from][req.fromCell]-=amount;
        delta[to][toCell]+=amount;
        if(req.from!==to){
          enteredStep[to]+=amount;
          departedStep[req.from]+=amount;
        }
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
      // Real motorway boundary / geometric local-ramp origins only.
      const base=edge.kind==="ramp"?225:edge.lanes*1050;
      const offered=base*(demandPercent/100)*timeDemandFactor(clockMs())*dt/3600;
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
      source:edge.source,connections:edge.links.length};
  }
  function speed(id){return byId.get(id)?.speed??null;}
  function color(id){const edge=byId.get(id);return edge?colourForSpeed(edge.speed):"free";}
  return {advance,step,reset,setMode,setEvent,removeEvent,listEvents,visualBands,closureBands,
    setSimulationStart,clockMs,eventStatus,setDemandPercent,totals,speed,color,mode,
    activeEvents,jamSummaries:()=>jamGroups,sourceCount:()=>sources.length,edgeCount:()=>edges.length,
    edgeActivity,reachable:id=>reachable.has(id),reachableCount:()=>reachable.size,
    incomingCount:id=>byId.get(id)?.incoming??0,
    entryIncomingCount:id=>byId.get(id)?.incomingAtStart??0,
    sourceIds:()=>sources.map(x=>x.id),
    junctionCount:()=>linkKeys.size};
}
global.createLegacyTrafficScenario=createLegacyTrafficScenario;
})(window);
