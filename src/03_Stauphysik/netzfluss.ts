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

type CellEdge={edge:RoadEdge;lengthM:number;vehicles:Float64Array;jamCellVehicles:number};
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

export class NetworkFlowEngine {
  readonly network:RoadNetwork;
  readonly stepSeconds:number;
  private readonly waveKmh:number;
  private readonly cells=new Map<string,CellEdge>();
  private readonly moves=new Map<string,Move[]>();
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
        const speed=state.edge.freeSpeedKmh*
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
        const speedKmh=state.edge.freeSpeedKmh*
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
    const send=new Map<string,Float64Array>();
    const receive=new Map<string,Float64Array>();
    const delta=new Map<string,Float64Array>();
    for(const [id,state] of this.cells){
      const {edge,vehicles,lengthM,jamCellVehicles}=state;
      const outs=new Float64Array(vehicles.length),ins=new Float64Array(vehicles.length);
      const changes=new Float64Array(vehicles.length);
      const freeTravelFraction=Math.min(1,(edge.freeSpeedKmh/3.6)*dt/lengthM);
      const waveFraction=Math.min(1,(this.waveKmh/3.6)*dt/lengthM);
      const affecting=activeById.get(id)??[];
      for(let i=0;i<vehicles.length;i++){
        const a=i*lengthM,b=(i+1)*lengthM;
        let capacity=edge.capacityPerLaneVph*edge.lanes;
        let forbiddenEntry=false;
        const closed=new Set<number>();
        for(const event of affecting)if(event.fromM<b&&event.toM>a){
          if(event.kind==='closure'){
            // A planned road closure is an ENTRY ban, not a roadblock:
            // cars already inside can evacuate at their normal discharge.
            if(event.fromM>=a-.001&&event.fromM<b+.001)
              forbiddenEntry=true;
            continue;
          }
          for(const lane of event.closedLanes)closed.add(lane);
        }
        if(closed.size)
          capacity=Math.max(0,edge.lanes-closed.size)*edge.capacityPerLaneVph;
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
    const proposals=new Map<string,{fromId:string;toId:string;amount:number}[]>();
    for(const [id,state] of this.cells){
      const out=send.get(id)!;
      const available=out[out.length-1]!;
      if(available<=0)continue;
      const choices=(this.moves.get(id)??[]).filter(m=>
        (!corridor.blockedEdgeIds.has(m.toId)||
          corridor.blockedEdgeIds.has(id))&&
        !corridor.blockedMovementKeys.has(id+'=>'+m.toId)&&
        (receive.get(m.toId)?.[0]??0)>0
      );
      // An edge with graph successors is never treated as a sink, even when
      // every successor is closed or jammed; vehicles remain at its end.
      if(choices.length===0)continue;
      const weightSum=choices.reduce((a,m)=>a+m.weight,0);
      for(const choice of choices){
        const proposed=available*choice.weight/weightSum;
        const limited=Math.min(proposed,
          choice.capacityVph===undefined?Infinity:choice.capacityVph*dt/3600);
        const list=proposals.get(choice.toId)??[];
        list.push({fromId:id,toId:choice.toId,amount:limited});
        proposals.set(choice.toId,list);
      }
    }
    for(const [toId,list] of proposals){
      const accepting=receive.get(toId)![0]!;
      const demand=list.reduce((a,p)=>a+p.amount,0);
      const scale=demand>accepting?accepting/demand:1;
      let total=0;
      for(const p of list){
        const amount=p.amount*scale;
        const fromChanges=delta.get(p.fromId)!;
        fromChanges[fromChanges.length-1]=fromChanges[fromChanges.length-1]!-amount;
        total+=amount;
      }
      const receivedChanges=delta.get(toId)!;
      receivedChanges[0]=receivedChanges[0]!+total;
    }
    // Leave the simulated network only at an actual directed graph sink.
    // If an outgoing ramp is blocked, this is NOT an exit.
    for(const [id,state] of this.cells){
      if((this.moves.get(id)?.length??0)>0)continue;
      const outgoing=send.get(id)!;
      const discharged=outgoing[outgoing.length-1]!;
      const dischargeChanges=delta.get(id)!;
      const last=state.vehicles.length-1;
      dischargeChanges[last]=dischargeChanges[last]!-discharged;
      this.exited+=discharged;
    }
    // Enter demand at external nodes only; space/capacity may keep arrivals
    // in a tracked source backlog. No vehicles appear in ramp middle sections.
    for(const id of this.sourceIds){
      // Do not generate new travel into a planned full corridor closure.
      // Existing in-network vehicles and previously recorded queues remain.
      const demand=corridor.blockedEdgeIds.has(id)?0:(demandVph[id]??0);
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
    }
    this.elapsed+=dt;
    const check=this.snapshot();
    if(Math.abs(check.conservationResidual)>1e-5*Math.max(1,check.generatedVehicles))
      throw Error('Fahrzeugbilanz verletzt: '+check.conservationResidual);
    return check;
  }
}
