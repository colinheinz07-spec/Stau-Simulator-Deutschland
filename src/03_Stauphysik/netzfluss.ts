/** 03 STAUPHYSIK / NETZFLUSS
 * First conservative spatial cell-transmission prototype for any directed OSM graph.
 * All mainline and motorway_link edges are treated equally as real storage.
 * Never invent traffic speed, upstream queues, geometries or connections.
 *
 * IMPORTANT: Flow shares at junctions and demands are scenario assumptions,
 * not observed OD matrices. No individual routes / via-way histories yet.
 */
import type {RoadEdge,RoadNetwork,SpeedSample,TrafficCellBand} from '../model.js';
import {activeEvent,activeNetworkClosures,type SimEvent,type CorridorClosure}
  from '../04_Ereignisse.js';

type CellEdge={edge:RoadEdge;lengthM:number;vehicles:Float64Array;jamCellVehicles:number;operatingVph:Float64Array};
export interface FlowSettings {
  /** Spatial granularity; every original directed OSM edge remains separate. */
  targetCellLengthM?:number;
  stepSeconds?:number;
  shockwaveSpeedKmh?:number;
}
export interface FlowStatistics {
  simSeconds:number;
  generatedVehicles:number;
  exitedVehicles:number;
  vehiclesOnNetwork:number;
  waitingOutsideSources:number;
  /** Generated = exited + network + source waiting, within floating precision. */
  conservationResidual:number;
}
interface Move {toId:string;capacityVph?:number;weight:number}
const approximately=(x:number)=>Math.abs(x)<1e-9?0:x;
const safeNonnegative=(v:number)=>Number.isFinite(v)&&v>=0;
const clamp01=(x:number)=>Math.max(0,Math.min(1,x));
/** Same nationwide response curve as the offline engine. */
export function diversionShare(delay:number):number{
  if(delay>=240)return 1;
  if(!Number.isFinite(delay)||delay<45)return 0;
  const anchors=[[45,.02],[60,.15],[90,.45],[120,.75],[150,.90],[180,.98],[240,1]] as const;
  for(let i=1;i<anchors.length;i++){
    const [end,upper]=anchors[i]!,[start,lower]=anchors[i-1]!;
    if(delay<=end)return lower+(upper-lower)*(delay-start)/(end-start);
  }
  return 1;
}
// Same aggregate traffic-interaction coefficients as the offline SPCK
// solver. Nominal lane capacity is an upper bound, not a free-flow test.
function operatingState(density:number,merge:number,mainline:boolean){
  if(!mainline)return {speedFactor:1,capacityFactor:1};
  const interactions=clamp01((density-.055)/.19),pressure=clamp01((density-.10)/.23);
  return {speedFactor:1-.24*interactions,
    capacityFactor:1-.10*interactions-.08*pressure-.20*merge*interactions};
}

export class NetworkFlowEngine {
  readonly network:RoadNetwork;
  readonly stepSeconds:number;
  private readonly waveKmh:number;
  private readonly cells=new Map<string,CellEdge>();
  private readonly moves=new Map<string,Move[]>();
  private readonly incomingMoves=new Map<string,string[]>();
  private readonly movementFlow=new Map<string,number>();
  private readonly turnStock=new Map<string,Map<string,number>>();
  private readonly localExitMoves=new Map<string,Move[]>();
  private readonly delayCache=new Map<string,number>();
  private delayMinute=-1;
  private readonly openBoundarySinks=new Set<string>();
  private readonly sourceIds:string[]=[];
  private readonly sourceBacklog=new Map<string,number>();
  private generated=0;
  private exited=0;
  private elapsed=0;
  constructor(network:RoadNetwork,settings:FlowSettings={}){
    const length=settings.targetCellLengthM??180;
    this.stepSeconds=settings.stepSeconds??2;
    this.waveKmh=settings.shockwaveSpeedKmh??22;
    if(!safeNonnegative(length)||length<20||length>1000||
       !safeNonnegative(this.stepSeconds)||this.stepSeconds<.1||this.stepSeconds>15||
       !safeNonnegative(this.waveKmh)||this.waveKmh<1)
      throw Error('Ungültiger Parameter für räumliche Netzsimulation');
    this.network=network;
    const incoming=new Set<string>();
    for(const edge of network.edges){
      if(this.cells.has(edge.id)||edge.lengthM<=0||edge.lanes<=0)
        throw Error('Ungültige/mehrdeutige OSM-Kante: '+edge.id);
      // All pieces use the same exact original edge ID from map and routing.
      const count=Math.max(1,Math.ceil(edge.lengthM/length));
      const cellLength=edge.lengthM/count;
      this.cells.set(edge.id,{
        edge,lengthM:cellLength,vehicles:new Float64Array(count),
        operatingVph:new Float64Array(count).fill(edge.lanes*edge.capacityPerLaneVph),
        jamCellVehicles:130*edge.lanes*cellLength/1000
      });
    }
    for(const movement of network.movements){
      if(!movement.allowed)continue;
      const from=this.cells.get(movement.incomingEdgeId);
      const to=this.cells.get(movement.outgoingEdgeId);
      if(!from||!to||from.edge.toNodeId!==to.edge.fromNodeId)
        throw Error('Fahrbeziehung ohne wirklichen OSM-Knoten: '+movement.incomingEdgeId+
          ' → '+movement.outgoingEdgeId);
      incoming.add(to.edge.id);
      // Same ordinary AS split as the local solver: ~7%, not 25%.
      const weight=to.edge.kind==='mainline'?20:to.edge.kind==='ramp'?1.5:1;
      const arr=this.moves.get(from.edge.id)??[];
      arr.push({toId:to.edge.id,capacityVph:movement.capacityVph,weight});
      this.moves.set(from.edge.id,arr);
      const parents=this.incomingMoves.get(to.edge.id)??[];
      parents.push(from.edge.id);this.incomingMoves.set(to.edge.id,parents);
    }
    // The OSM extract is a WINDOW into the motorway network, not a
    // motorway termination. If only an off-ramp remains at its downstream
    // cut, unrestricted through traffic must still leave the simulated map.
    const leadsToMainline=(id:string,seen=new Set<string>(),depth=0):boolean=>{
      if(depth>8||seen.has(id))return false;
      const current=this.cells.get(id)?.edge;
      if(!current)return false;
      if(current.kind==='mainline')return true;
      seen.add(id);
      return (this.moves.get(id)??[]).some(move=>leadsToMainline(move.toId,seen,depth+1));
    };
    for(const [id,state] of this.cells){
      const downstream=this.moves.get(id)??[];
      if(!downstream.length || state.edge.kind==='mainline'&&
        !downstream.some(move=>leadsToMainline(move.toId)))
        this.openBoundarySinks.add(id);
    }
    // Identify genuine local exits using directed connectivity, not a ramp's
    // name or the distance to a junction. Motorway connectors are not local
    // off-ramps, even when they happen to lie near an AS.
    const isLocalExit=(id:string):boolean=>{
      const pending=[id],seen=new Set<string>();
      let local=false;
      while(pending.length){
        const next=pending.pop()!;
        if(seen.has(next))continue;
        seen.add(next);
        const edge=this.cells.get(next)!.edge;
        if(edge.kind==='mainline')return false;
        if(edge.kind==='public'){local=true;continue;}
        const successors=this.moves.get(next)??[];
        if(!successors.length)local=true;
        for(const m of successors)pending.push(m.toId);
      }
      return local;
    };
    for(const [id,state] of this.cells)if(state.edge.kind==='mainline'){
      const exits=(this.moves.get(id)??[]).filter(m=>isLocalExit(m.toId));
      if(exits.length)this.localExitMoves.set(id,exits);
    }
    for(const id of this.cells.keys()){
      if(!incoming.has(id)){
        this.sourceIds.push(id);
        this.sourceBacklog.set(id,0);
      }
    }
  }
  /** Only external graph boundaries can create demand, never arbitrary internal edges. */
  sourceEdges():RoadEdge[]{
    return this.sourceIds.map(id=>this.cells.get(id)!.edge);
  }
  /** Read-only per-Way inventory for conservation and evacuation audits. */
  vehiclesOnEdge(edgeId:string):number{
    const state=this.cells.get(edgeId);
    if(!state)throw Error('Unbekannter OSM-Fahrweg: '+edgeId);
    return [...state.vehicles].reduce((total,n)=>total+n,0);
  }
  /** Actual accepted movement, in vehicles/hour, during the last step. */
  movementVph(fromId:string,toId:string):number{
    return this.movementFlow.get(fromId+'=>'+toId)??0;
  }
  /** Excess travel time along the directed continuation AFTER this junction.
   * Do not count a queue behind the exit or on an unrelated motorway arm. */
  routingDelayAhead(edgeId:string):number{
    const minute=Math.floor(this.elapsed/60);
    if(this.delayMinute!==minute){this.delayMinute=minute;this.delayCache.clear();}
    const cached=this.delayCache.get(edgeId);
    if(cached!==undefined)return cached;
    let current=this.cells.get(edgeId),delay=0;
    const seen=new Set<string>([edgeId]);
    while(current){
      const ref=current.edge.motorwayRef;
      const next=(this.moves.get(current.edge.id)??[]).filter(m=>{
        const target=this.cells.get(m.toId)!.edge;
        return target.kind==='mainline'&&target.motorwayRef===ref;
      });
      if(next.length!==1||seen.has(next[0]!.toId))break;
      current=this.cells.get(next[0]!.toId)!;
      seen.add(current.edge.id);
      for(const count of current.vehicles){
        const density=clamp01(count/Math.max(.001,current.jamCellVehicles));
        const free=current.edge.freeSpeedKmh;
        const speed=count<.8?free:Math.max(1,free*operatingState(density,0,true).speedFactor*
          (density<=.23?1:Math.max(.04,1-Math.pow((density-.23)/.77,1.45))));
        delay+=Math.max(0,current.lengthM*.06*(1/speed-1/free));
      }
      if(delay>=240)break; // willingness is saturated; no distance/hop limit
    }
    this.delayCache.set(edgeId,delay);
    return delay;
  }
  /** Keep a driver on the motorway if a later real exit before the
   * closure can still be reached without entering the queue. */
  private clearLaterClosureExit(edgeId:string,closed:ReadonlySet<string>,blocked:ReadonlySet<string>):boolean{
    if(!closed.size)return false;
    let current=this.cells.get(edgeId),queued=false,clearLater=false;
    const seen=new Set<string>([edgeId]);
    while(current){
      const ref=current.edge.motorwayRef;
      const next=(this.moves.get(current.edge.id)??[]).filter(m=>{
        const target=this.cells.get(m.toId)!.edge;
        return target.kind==='mainline'&&target.motorwayRef===ref;
      });
      if(next.length!==1||seen.has(next[0]!.toId))break;
      const id=next[0]!.toId;
      if(closed.has(id)||blocked.has(current.edge.id+'=>'+id))return clearLater;
      current=this.cells.get(id)!;seen.add(id);
      if(!queued)for(const count of current.vehicles){
        const density=clamp01(count/Math.max(.001,current.jamCellVehicles));
        const speed=current.edge.freeSpeedKmh*operatingState(density,0,true).speedFactor*
          (density<=.23?1:Math.max(.04,1-Math.pow((density-.23)/.77,1.45)));
        if(count>=Math.max(2,current.edge.lanes*1.2)&&density>.23&&speed<=30){queued=true;break;}
      }
      if(!queued&&this.localExitMoves.get(id)?.some(m=>!closed.has(m.toId)&&!blocked.has(id+'=>'+m.toId)))clearLater=true;
    }
    return false; // no closure on this directed motorway
  }
  operatingCapacityVph(edgeId:string,metre=0):number{
    const state=this.cells.get(edgeId);
    if(!state)throw Error('Unbekannter OSM-Fahrweg: '+edgeId);
    return state.operatingVph[Math.max(0,Math.min(state.operatingVph.length-1,Math.floor(metre/state.lengthM)))]!;
  }
  snapshot():FlowStatistics{
    let vehicles=0,waiting=0;
    for(const x of this.cells.values())
      for(const n of x.vehicles)vehicles+=n;
    for(const n of this.sourceBacklog.values())waiting+=n;
    return {
      simSeconds:this.elapsed,generatedVehicles:this.generated,
      exitedVehicles:this.exited,vehiclesOnNetwork:vehicles,
      waitingOutsideSources:waiting,
      conservationResidual:approximately(this.generated-this.exited-vehicles-waiting)
    };
  }
  /** Returns estimated speed from actual simulated cell occupancy, not incident proximity.
   * Every empty segment remains at model free-flow speed; full closure has its own overlay. */
  speedSamples():SpeedSample[]{
    const samples:SpeedSample[]=[];
    for(const state of this.cells.values()){
      // Equal-length cells: harmonic mean reflects travel time over the
      // entire OSM edge. A single slow cell must not paint a long Way red.
      let inverseSpeedSum=0;
      for(const count of state.vehicles){
        const fraction=state.jamCellVehicles>0?
          Math.min(1,count/state.jamCellVehicles):0;
        const speed=state.edge.freeSpeedKmh*operatingState(fraction,0,state.edge.kind==='mainline').speedFactor*
          (fraction<=.23?1:Math.max(.04,1-Math.pow((fraction-.23)/.77,1.45)));
        inverseSpeedSum+=1/Math.max(1,speed);
      }
      const speedKmh=state.vehicles.length/inverseSpeedSum;
      samples.push({edgeId:state.edge.id,speedKmh,atMinute:this.elapsed/60});
    }
    return samples;
  }
  /** Physical slowdown subsegments, never a guessed speed for the whole Way.
   * Free or empty cells do not create orange/red traffic overlays. */
  speedBands():TrafficCellBand[]{
    const samples:TrafficCellBand[]=[];
    for(const state of this.cells.values()){
      for(let i=0;i<state.vehicles.length;i++){
        const count=state.vehicles[i]!;
        const fraction=state.jamCellVehicles>0?
          Math.min(1,count/state.jamCellVehicles):0;
        const speedKmh=state.edge.freeSpeedKmh*operatingState(fraction,0,state.edge.kind==='mainline').speedFactor*
          (fraction<=.23?1:Math.max(.04,1-Math.pow((fraction-.23)/.77,1.45)));
        if(count<Math.max(2,state.edge.lanes*1.2) ||
           fraction<=.23 || speedKmh>65)continue;
        samples.push({edgeId:state.edge.id,
          fromM:i*state.lengthM,toM:(i+1)*state.lengthM,
          speedKmh,atMinute:this.elapsed/60});
      }
    }
    return samples;
  }
  /** Tick all cells simultaneously (conservation + receiving/capacity constraints).
   * "demandVph" only applies at genuine source edges; excess remains outside
   * the imported graph in an explicit, mass-conserved entry queue. */
  advance(
    demandVph:Readonly<Record<string,number>>={},
    events:readonly SimEvent[]=[],
    corridors:readonly CorridorClosure[]=[]
  ):FlowStatistics{
    const dt=this.stepSeconds,minute=this.elapsed/60;
    const corridor=activeNetworkClosures(this.network,corridors,minute);
    const activeById=new Map<string,SimEvent[]>();
    for(const event of events)if(activeEvent(event,minute)){
      const entries=activeById.get(event.edgeId)??[];
      entries.push(event);
      activeById.set(event.edgeId,entries);
    }
    const closedByEvent=new Set<string>();
    const closureEdges=new Set(corridor.blockedEdgeIds);
    for(const [id,eventsOnEdge] of activeById){
      if(eventsOnEdge.some(e=>e.kind==='closure'))closureEdges.add(id);
      const edge=this.cells.get(id)?.edge;
      if(edge&&eventsOnEdge.some(e=>e.kind==='closure'&&
        e.fromM<=.001&&e.toM>=edge.lengthM-.001))
        closedByEvent.add(id);
    }
    const send=new Map<string,Float64Array>();
    const receive=new Map<string,Float64Array>();
    const delta=new Map<string,Float64Array>();
    const motion=new Map<string,number>();
    for(const [id,state] of this.cells){
      const {edge,vehicles,lengthM,jamCellVehicles}=state;
      const outs=new Float64Array(vehicles.length),ins=new Float64Array(vehicles.length);
      const changes=new Float64Array(vehicles.length);
      const waveFraction=Math.min(1,(this.waveKmh/3.6)*dt/lengthM);
      const affecting=activeById.get(id)??[];
      const approaches=(this.incomingMoves.get(id)??[]).map(parent=>this.movementFlow.get(parent+'=>'+id)??0);
      const total=approaches.reduce((a,b)=>a+b,0);
      const merge=total>0?clamp01(2*(total-Math.max(...approaches))/total):0;
      for(let i=0;i<vehicles.length;i++){
        const a=i*lengthM,b=(i+1)*lengthM;
        let capacity=edge.capacityPerLaneVph*edge.lanes;
        let forbiddenEntry=false;
        const closed=new Set<number>();
        for(const event of affecting)if(event.fromM<b&&event.toM>a){
          if(event.kind==='closure'){
            // A planned road closure is an ENTRY ban, not a roadblock:
            // cars already inside can evacuate at their normal discharge.
            // Whole-edge corridor entrance is blocked at a real boundary
            // below; leaving this receiving cell open lets cars already
            // inside another closed edge evacuate over the join.
            const wholeEdge=event.fromM<=.001&&event.toM>=edge.lengthM-.001;
            if(!wholeEdge&&event.fromM>=a-.001&&event.fromM<b+.001)
              forbiddenEntry=true;
            continue;
          }
          for(const lane of event.closedLanes)closed.add(lane);
        }
        if(closed.size)
          capacity=Math.max(0,edge.lanes-closed.size)*edge.capacityPerLaneVph;
        const density=vehicles[i]!/Math.max(.001,jamCellVehicles);
        const dynamic=operatingState(density,i===0?merge:0,edge.kind==='mainline');
        const restart=density>.60?.90:density>.42?.95:1;
        capacity*=dynamic.capacityFactor*restart;
        state.operatingVph[i]=forbiddenEntry||corridor.blockedEdgeIds.has(id)||closedByEvent.has(id)?0:capacity;
        const freeTravelFraction=Math.min(1,(edge.freeSpeedKmh*dynamic.speedFactor/3.6)*dt/lengthM);
        if(i===vehicles.length-1)motion.set(id,freeTravelFraction);
        const cap=capacity*dt/3600;
        outs[i]=Math.min(vehicles[i]!,cap,vehicles[i]!*freeTravelFraction);
        const room=Math.max(0,jamCellVehicles-vehicles[i]!);
        // Corridor closures are enforced at real directed boundaries below.
        // Do not prevent exiting a closed OSM Way into the next closed Way.
        ins[i]=forbiddenEntry?0:Math.min(room,cap,room*waveFraction);
      }
      send.set(id,outs);receive.set(id,ins);delta.set(id,changes);
    }
    // Transfers inside one physical OSM edge, exactly once each step.
    for(const [id,state] of this.cells){
      const out=send.get(id)!,ins=receive.get(id)!,changes=delta.get(id)!;
      for(let i=0;i<out.length-1;i++){
        const moved=Math.min(out[i]!,ins[i+1]!);
        if(moved<=0)continue;
        changes[i]=changes[i]!-moved;
        changes[i+1]=changes[i+1]!+moved;
        out[i]=out[i]!-moved; ins[i+1]=ins[i+1]!-moved;
      }
    }
    // Junction transfers respect actual OSM turns, receiving storage, and
    // movement capacity. Alternatives are considered only AT a real fork.
    const proposals=new Map<string,{fromId:string;toId:string;amount:number;committed:boolean}[]>();
    for(const [id,state] of this.cells){
      const out=send.get(id)!;
      const available=out[out.length-1]!;
      if(available<=0)continue;
      let choices=(this.moves.get(id)??[]).filter(m=>
        (!corridor.blockedEdgeIds.has(m.toId)||
          corridor.blockedEdgeIds.has(id))&&
        (!closedByEvent.has(m.toId)||closedByEvent.has(id))&&
        !corridor.blockedMovementKeys.has(id+'=>'+m.toId)
      );
      // A real motorway may continue outside the mapped network even when
      // the extract retains its last one-lane off-ramp. Give the external
      // continuation a through-lane turn weight, not the ramp's capacity.
      let outsideWeight=this.openBoundarySinks.has(id)?20:0;
      const localExits=this.localExitMoves.get(id);
      const divert=localExits?diversionShare(this.routingDelayAhead(id)):0;
      if(localExits&&divert>0&&!this.clearLaterClosureExit(id,closureEdges,corridor.blockedMovementKeys)){
        const openExits=choices.filter(m=>localExits.includes(m));
        if(openExits.length){
          const exitWeight=openExits.reduce((n,m)=>n+m.weight,0);
          const throughWeight=choices.reduce((n,m)=>n+(openExits.includes(m)?0:m.weight),outsideWeight);
          if(divert===1){choices=openExits;outsideWeight=0;this.turnStock.delete(id);}
          else{
            choices=choices.map(m=>({...m,weight:m.weight*(openExits.includes(m)?
              1+throughWeight*divert/Math.max(.001,exitWeight):1-divert)}));
            outsideWeight*=1-divert;
          }
        }
      }
      if(choices.length===0&&!outsideWeight)continue;
      const weightSum=choices.reduce((a,m)=>a+m.weight,0)+outsideWeight;
      let pending:Map<string,number>|undefined;
      let planned=new Map<string,number>();
      if(choices.length+Number(outsideWeight>0)>1){
        const turns=choices.map(c=>({id:c.toId,weight:c.weight,receiving:Math.min(receive.get(c.toId)![0]!,c.capacityVph===undefined?Infinity:c.capacityVph*dt/3600)}));
        if(outsideWeight)turns.push({id:'',weight:outsideWeight,receiving:Infinity});
        pending=this.turnStock.get(id)??new Map();
        const keys=new Set(turns.map(t=>t.id));
        for(const key of pending.keys())if(!keys.has(key))pending.delete(key);
        const old=[...pending.values()].reduce((a,b)=>a+b,0);
        const fresh=Math.max(0,state.vehicles[state.vehicles.length-1]!-old);
        for(const t of turns){
          const amount=(pending.get(t.id)??0)+fresh*t.weight/weightSum;
          pending.set(t.id,amount);
          planned.set(t.id,Math.min(amount*(motion.get(id)??0),t.receiving));
        }
        this.turnStock.set(id,pending);
        const demand=[...planned.values()].reduce((a,b)=>a+b,0);
        if(demand>available)for(const [key,value] of planned)planned.set(key,value*available/demand);
      }else this.turnStock.delete(id);
      if(outsideWeight){
        const leaving=pending?planned.get('')??0:available*outsideWeight/weightSum;
        if(pending)pending.set('',Math.max(0,(pending.get('')??0)-leaving));
        const change=delta.get(id)!;
        change[change.length-1]=change[change.length-1]!-leaving;
        this.exited+=leaving;
      }
      for(const choice of choices){
        const proposed=pending?planned.get(choice.toId)??0:available*choice.weight/weightSum;
        const limited=Math.min(proposed,
          choice.capacityVph===undefined?Infinity:choice.capacityVph*dt/3600);
        const list=proposals.get(choice.toId)??[];
        list.push({fromId:id,toId:choice.toId,amount:limited,committed:!!pending});
        proposals.set(choice.toId,list);
      }
    }
    this.movementFlow.clear();
    for(const [toId,list] of proposals){
      const accepting=receive.get(toId)![0]!;
      const demand=list.reduce((a,p)=>a+p.amount,0);
      const scale=demand>accepting?accepting/demand:1;
      let total=0;
      for(const p of list){
        const amount=p.amount*scale;
        if(p.committed){
          const pending=this.turnStock.get(p.fromId)!;
          pending.set(p.toId,Math.max(0,(pending.get(p.toId)??0)-amount));
        }
        this.movementFlow.set(p.fromId+'=>'+toId,amount*3600/dt);
        const fromChanges=delta.get(p.fromId)!;
        fromChanges[fromChanges.length-1]=fromChanges[fromChanges.length-1]!-amount;
        total+=amount;
      }
      const receivedChanges=delta.get(toId)!;
      receivedChanges[0]=receivedChanges[0]!+total;
    }
    // External motorway exits and real dead-end ramps were allocated above.
    // Enter demand at external nodes only; space/capacity may keep arrivals
    // in a tracked source backlog. No vehicles appear in ramp middle sections.
    for(const id of this.sourceIds){
      // Do not generate new travel into a planned full corridor closure.
      // Existing in-network vehicles and previously recorded queues remain.
      const demand=(corridor.blockedEdgeIds.has(id)||closedByEvent.has(id))?
        0:(demandVph[id]??0);
      if(!safeNonnegative(demand))throw Error('Ungültige Zuflussmenge: '+id);
      const created=demand*dt/3600;
      this.generated+=created;
      const waiting=(this.sourceBacklog.get(id)??0)+created;
      const admitted=Math.min(waiting,receive.get(id)![0]!);
      const admissionChanges=delta.get(id)!;
      admissionChanges[0]=admissionChanges[0]!+admitted;
      this.sourceBacklog.set(id,waiting-admitted);
    }
    // Atomically apply all previously allocated, storage-safe transfers.
    for(const [id,state] of this.cells){
      const changes=delta.get(id)!;
      for(let i=0;i<changes.length;i++){
        state.vehicles[i]=Math.max(0,state.vehicles[i]!+changes[i]!);
        if(state.vehicles[i]!>state.jamCellVehicles+1e-7)
          throw Error('Zellspeicher überschritten: '+id+' ['+i+']');
      }
      const pending=this.turnStock.get(id);
      if(pending&&[...pending.values()].reduce((a,b)=>a+b,0)>state.vehicles[state.vehicles.length-1]!+1e-6)
        throw Error('Abbiegebestand verletzt: '+id);
    }
    this.elapsed+=dt;
    const check=this.snapshot();
    if(Math.abs(check.conservationResidual)>1e-5*Math.max(1,check.generatedVehicles))
      throw Error('Fahrzeugbilanz verletzt: '+check.conservationResidual);
    return check;
  }
}
