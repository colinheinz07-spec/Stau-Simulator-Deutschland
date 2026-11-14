/** Browser-only scenario glue. Real OSM edge IDs; no invented routes or
 * coloured "fake queues" – speed derives exclusively from simulated occupancy.
 */
import {NetworkFlowEngine} from './dist/03_Stauphysik.js';
import {demandFactor} from './dist/02_Verkehr.js';
import {planCorridorClosure} from './dist/04_Ereignisse.js';

const legalModes=new Set(['roadworks','accident','breakdown','closure']);
export function createTrafficScenario(network){
  let engine=new NetworkFlowEngine(network,{stepSeconds:2,targetCellLengthM:180});
  let demandPercent=100;
  const modes=new Map(),edgeById=new Map(network.edges.map(e=>[e.id,e]));
  let computedEvents=[],warnings=[];

  function buildEvents(){
    const events=[],closed=new Set(),warn=[];
    for(const [id,mode] of modes){
      const edge=edgeById.get(id);
      if(!edge)continue;
      if(mode==='closure'&&edge.kind==='mainline'&&edge.motorwayRef){
        try{
          const plan=planCorridorClosure(network,{
            id:'corridor-'+id,motorwayRef:edge.motorwayRef,
            fromNodeId:edge.fromNodeId,toNodeId:edge.toNodeId,startMinute:0
          });
          for(const affected of plan.closedEdgeIds)closed.add(affected);
          continue;
        }catch(err){
          warn.push('Sperrpfad unvollständig: '+id+' ('+err.message+'). Nur ausgewählter Abschnitt.');
        }
      }
      if(mode==='closure'){
        closed.add(id);continue;
      }
      const blockedCount=mode==='accident'?Math.min(2,edge.lanes):1;
      events.push({
        id:'scenario-'+id,edgeId:id,kind:mode,
        fromM:0,toM:edge.lengthM,
        closedLanes:Array.from({length:blockedCount},(_,i)=>i),
        startMinute:0
      });
    }
    for(const id of closed){
      const edge=edgeById.get(id);
      if(!edge)continue;
      events.push({
        id:'closure-'+id,edgeId:id,kind:'closure',
        fromM:0,toM:edge.lengthM,
        closedLanes:Array.from({length:edge.lanes},(_,i)=>i),
        startMinute:0
      });
    }
    computedEvents=events;warnings=warn;
  }

  // Reuse the old simulator's directional PEAK-HOUR references and
  // separate weekly curves. Do NOT create 3200 cars at every cut OSM Way.
  const traffic=globalThis.StauTrafficReference??null;
  const junctions=network.nodes.filter(n=>!!n.junctionRef);
  function closestJunction(point){
    let best=null,distance=Infinity;
    for(const node of junctions){
      const [lat,lon]=node.point;
      const metres=Math.hypot((lat-point[0])*111194,
        (lon-point[1])*111194*Math.cos(lat*Math.PI/180));
      if(metres<distance){distance=metres;best=node;}
    }
    return distance<=1100?best:null;
  }
  // A direction key (e.g. A3→Köln) can exist in several disconnected
  // mapped OSM components. Each authentic component gets its own upstream
  // boundary demand; short orphan fragments must not get a full motorway peak.
  const mainlineAdj=new Map(network.edges.filter(edge=>edge.kind==='mainline')
    .map(edge=>[edge.id,new Set()]));
  for(const turn of network.movements){
    if(!turn.allowed)continue;
    const from=edgeById.get(turn.incomingEdgeId),to=edgeById.get(turn.outgoingEdgeId);
    if(from?.kind!=='mainline'||to?.kind!=='mainline'||
      !from.motorwayRef||from.motorwayRef!==to.motorwayRef)continue;
    mainlineAdj.get(from.id).add(to.id);
    mainlineAdj.get(to.id).add(from.id);
  }
  const componentFor=new Map(),componentLength=new Map();
  let nextComponent=0;
  for(const edge of network.edges){
    if(edge.kind!=='mainline'||componentFor.has(edge.id))continue;
    const id=nextComponent++,stack=[edge.id];let totalLength=0;
    while(stack.length){
      const currentId=stack.pop();
      if(componentFor.has(currentId))continue;
      componentFor.set(currentId,id);
      totalLength+=edgeById.get(currentId).lengthM;
      for(const next of mainlineAdj.get(currentId)||[])
        if(!componentFor.has(next))stack.push(next);
    }
    componentLength.set(id,totalLength);
  }
  const candidates=new Map(),rampCandidates=new Map();
  for(const edge of engine.sourceEdges()){
    if(!traffic){
      // Node.js test fixtures do not load browser-side reference data.
      // On the actual map the imported catalog is always available.
      if(edge.kind==='mainline'&&componentLength.get(componentFor.get(edge.id))>=1000)
        candidates.set(componentFor.get(edge.id),{id:edge.id,
          base:Math.min(3200,edge.lanes*900),edge,key:"",ref:edge.motorwayRef});
      continue;
    }
    if(!edge.motorwayRef||!edge.geometry?.length)continue;
    const row=[edge.id,edge.kind,edge.motorwayRef,edge.lanes,edge.geometry,""];
    const reference=traffic.referenceForRoad(row);
    if(reference.peakVph<=0)continue;
    if(edge.kind==='mainline'){
      const componentId=componentFor.get(edge.id);
      if(componentId===undefined||componentLength.get(componentId)<1500)continue;
      const first=edge.geometry[0],last=edge.geometry.at(-1);
      const key=reference.key,lat=first[0],lon=first[1];
      // Select one actual source per physical directed component, not one
      // across the whole country and not one per Way fragment.
      const rank=key==="A3-koeln"?-lat:key==="A3-frankfurt"?lat:
        key==="A48-dernbach"?-lon:key==="A48-koblenz"?lon:
        Math.abs(last[0]-lat)>Math.abs(last[1]-lon)?
          (last[0]>lat?-lat:lat):(last[1]>lon?-lon:lon);
      const previous=candidates.get(componentId);
      if(!previous||rank>previous.rank)candidates.set(componentId,{
        id:edge.id,base:reference.peakVph,edge,key,ref:edge.motorwayRef,rank});
    }else if(edge.kind==='ramp'){
      const junction=closestJunction(edge.geometry[0]);
      if(!junction)continue;
      const label="AS "+junction.junctionRef+" "+(junction.junctionName??"")+
        " · Auffahrt";
      const rampRow=[edge.id,edge.kind,edge.motorwayRef,edge.lanes,
        edge.geometry,label];
      const base=traffic.junctionEntryPeak(rampRow);
      if(base<=0)continue;
      const unique=edge.motorwayRef+":"+junction.junctionRef+":"+reference.key;
      const existing=rampCandidates.get(unique);
      if(!existing||edge.lengthM>existing.edge.lengthM)
        rampCandidates.set(unique,{id:edge.id,base,edge,key:reference.key,
          ref:edge.motorwayRef});
    }
  }
  const sources=[...candidates.values(),...rampCandidates.values()];
  let simStart=Date.now();
  function setSimulationStart(ms){
    if(!Number.isFinite(Number(ms))||Number(ms)<0)throw Error("Ungültiges Startdatum");
    simStart=Number(ms);reset();
  }
  function reset(){
    engine=new NetworkFlowEngine(network,{stepSeconds:2,targetCellLengthM:180});
    modes.clear();buildEvents();
  }
  function setMode(edgeId,mode){
    if(!edgeById.has(edgeId))throw Error('Kein echter OSM-Fahrweg '+edgeId);
    if(mode==='none')modes.delete(edgeId);
    else if(legalModes.has(mode))modes.set(edgeId,mode);
    else throw Error('Unbekanntes Ereignis: '+mode);
    buildEvents();
  }
  function setDemandPercent(value){
    const n=Number(value);
    if(!Number.isFinite(n)||n<0||n>200)
      throw Error('Ungültige Szenario-Verkehrslast');
    demandPercent=n;
  }
  function advance(steps=1){
    if(!Number.isInteger(steps)||steps<1||steps>120)throw Error('Ungültiger Simulationstakt');
    const demand={};
    const clockMs=simStart+engine.snapshot().simSeconds*1000;
    const moment=new Date(clockMs);
    const common={dayOfWeek:moment.getUTCDay(),
      hour:moment.getUTCHours()+moment.getUTCMinutes()/60};
    for(const entry of sources){
      const factor=traffic?traffic.profileFactor(entry.key,entry.ref,clockMs,
        entry.edge.geometry):demandFactor(common,'transit');
      demand[entry.id]=entry.base*(demandPercent/100)*factor;
    }
    let info;
    for(let i=0;i<steps;i++)info=engine.advance(demand,computedEvents);
    return info;
  }
  return {
    reset,setMode,setDemandPercent,setSimulationStart,advance,
    events:()=>computedEvents,
    selectedEvents:()=>[...modes].map(([edgeId,kind])=>({edgeId,kind})),
    warnings:()=>warnings,
    mode:id=>modes.get(id)??'none',
    demandPercent:()=>demandPercent,
    stats:()=>engine.snapshot(),
    speeds:()=>engine.speedSamples(),
    speedBands:()=>engine.speedBands(),
    sourceCount:()=>sources.length,
    sourceProfiles:()=>sources.map(x=>({id:x.id,ref:x.ref,key:x.key,peakVph:x.base})),
    clockMs:()=>simStart+engine.snapshot().simSeconds*1000
  };
}
