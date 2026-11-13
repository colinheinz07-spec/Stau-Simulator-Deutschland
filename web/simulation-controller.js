/** Browser-only scenario glue. Real OSM edge IDs; no invented routes or
 * coloured "fake queues" – speed derives exclusively from simulated occupancy.
 */
import {NetworkFlowEngine} from './dist/03_Stauphysik.js';
import {demandFactor} from './dist/02_Verkehr.js';
import {planCorridorClosure} from './dist/04_Ereignisse.js';

const legalModes=new Set(['roadworks','accident','closure']);
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
      const blockedCount=mode==='roadworks'?1:Math.min(2,edge.lanes);
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

  const sources=engine.sourceEdges().map(edge=>{
    const base=edge.kind==='mainline'?Math.min(3200,edge.lanes*1050):
      edge.kind==='ramp'?450:200;
    return {id:edge.id,base};
  });
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
    // Monday 08:00 scenario: explicitly NOT measured A3/A48 traffic.
    const scale=(demandPercent/100)*demandFactor({dayOfWeek:1,hour:8},'transit');
    for(const entry of sources)demand[entry.id]=entry.base*scale;
    let info;
    for(let i=0;i<steps;i++)info=engine.advance(demand,computedEvents);
    return info;
  }
  return {
    reset,setMode,setDemandPercent,advance,
    events:()=>computedEvents,
    selectedEvents:()=>[...modes].map(([edgeId,kind])=>({edgeId,kind})),
    warnings:()=>warnings,
    mode:id=>modes.get(id)??'none',
    demandPercent:()=>demandPercent,
    stats:()=>engine.snapshot(),
    speeds:()=>engine.speedSamples(),
    sourceCount:()=>sources.length
  };
}
