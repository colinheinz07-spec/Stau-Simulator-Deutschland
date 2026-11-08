import {Strassennetz} from '../dist/index.js';
export function sampleNetwork() {
  const nodes = [
    {id:'a',point:[50.400,7.800]},{id:'b',point:[50.400,7.810]},
    {id:'c',point:[50.400,7.820]},{id:'d',point:[50.405,7.815]},
    {id:'e',point:[50.410,7.820]}
  ];
  const lookup = new Map(nodes.map(n => [n.id,n.point]));
  const make = (id,fromNodeId,toNodeId,kind,osmClass,osmId,lanes,kmh,perLane) => {
    const geometry = [lookup.get(fromNodeId),lookup.get(toNodeId)];
    return {id,fromNodeId,toNodeId,kind,osmClass,osmWayIds:[osmId],
      ...(kind==='public'?{}:{motorwayRef:'A3'}),
      geometry,lanes,lengthM:Strassennetz.polylineLengthM(geometry),
      freeSpeedKmh:kmh,capacityPerLaneVph:perLane};
  };
  const edges = [
    make('a3-west','a','b','mainline','motorway',101,3,130,2100),
    make('a3-east','b','c','mainline','motorway',102,3,130,2100),
    make('ramp','b','d','ramp','motorway_link',103,1,80,1500),
    make('town','d','e','public','secondary',104,1,50,900)
  ];
  const movements = [
    {incomingEdgeId:'a3-west',outgoingEdgeId:'a3-east',allowed:true},
    {incomingEdgeId:'a3-west',outgoingEdgeId:'ramp',allowed:true},
    {incomingEdgeId:'ramp',outgoingEdgeId:'town',allowed:true}
  ];
  return {schemaVersion:1,nodes,edges,movements};
}
