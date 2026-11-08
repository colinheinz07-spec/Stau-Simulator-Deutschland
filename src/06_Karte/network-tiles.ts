/** Lazy-loadable Germany map tiles: no second copy of network geometry.
 * Source: scripts/shard-network.mjs; all tiles use original RoadEdge IDs.
 * This is viewport assembly ONLY, not a replacement for national routing.
 */
import type {RoadNetwork,RoadEdge,RoadNode,TurnMovement} from '../model.js';

export type Bounds = readonly [south:number,west:number,north:number,east:number];
export interface TileManifestEntry {
  key:string;file:string;bbox:Bounds;edges:number;movements:number;bytes:number;sha256:string;
}
export interface TileManifest {
  schemaVersion:1;
  tileDegrees:number;
  attribution:string;
  attributionUrl:string;
  counts:{uniqueEdges:number;nodes:number;movements:number;tiles:number};
  tiles:readonly TileManifestEntry[];
}
export interface NetworkTile {
  schemaVersion:1;key:string;bbox:Bounds;
  nodes:readonly RoadNode[];
  edges:readonly RoadEdge[];
  movements:readonly TurnMovement[];
  externalEdgeIds:readonly string[];
}
function overlaps(a:Bounds,b:Bounds):boolean {
  return a[0]<=b[2] && a[2]>=b[0] && a[1]<=b[3] && a[3]>=b[1];
}
export function tilesForViewport(manifest:TileManifest,viewport:Bounds):TileManifestEntry[] {
  if(viewport.some(n=>!Number.isFinite(n)) || viewport[0]>viewport[2] || viewport[1]>viewport[3])
    throw Error('Invalid viewport bounds');
  return manifest.tiles.filter(t=>overlaps(t.bbox,viewport));
}
export interface VisibleNetwork {
  /** Complete physical road shapes in view. Duplicate IDs merged. */
  network:RoadNetwork;
  /** Cross-tile routing references are NOT discarded or guessed. */
  pendingMovements:readonly TurnMovement[];
  pendingEdgeIds:readonly string[];
}
/** Idempotent across overlapping tiles. Conflicting shared ID/geometries
 * are a hard error, never drawn as two different green lines.
 */
export function assembleVisibleTiles(tiles:readonly NetworkTile[]):VisibleNetwork {
  const nodes=new Map<string,RoadNode>(),edges=new Map<string,RoadEdge>();
  const movements=new Map<string,TurnMovement>();
  for(const tile of tiles){
    if(tile.schemaVersion!==1)throw Error('Unexpected tile schema version');
    for(const n of tile.nodes){
      const prior=nodes.get(n.id);
      if(prior && JSON.stringify(prior)!==JSON.stringify(n))
        throw Error('Conflicting physical OSM node across tiles: '+n.id);
      nodes.set(n.id,n);
    }
    for(const edge of tile.edges){
      const prior=edges.get(edge.id);
      if(prior && JSON.stringify(prior)!==JSON.stringify(edge))
        throw Error('Conflicting OSM motorway geometry on edge '+edge.id);
      edges.set(edge.id,edge);
    }
    for(const movement of tile.movements){
      const key=movement.incomingEdgeId+'=>'+movement.outgoingEdgeId;
      const prior=movements.get(key);
      if(prior && JSON.stringify(prior)!==JSON.stringify(movement))
        throw Error('Conflicting cross-tile movement '+key);
      movements.set(key,movement);
    }
  }
  const available:TurnMovement[]=[],pending:TurnMovement[]=[],missing=new Set<string>();
  for(const movement of movements.values()){
    if(edges.has(movement.incomingEdgeId)&&edges.has(movement.outgoingEdgeId))
      available.push(movement);
    else{
      pending.push(movement);
      if(!edges.has(movement.incomingEdgeId))missing.add(movement.incomingEdgeId);
      if(!edges.has(movement.outgoingEdgeId))missing.add(movement.outgoingEdgeId);
    }
  }
  const byId=(a:{id:string},b:{id:string})=>a.id.localeCompare(b.id);
  return {
    network:{
      schemaVersion:1,
      nodes:[...nodes.values()].sort(byId),
      edges:[...edges.values()].sort(byId),
      movements:available.sort((a,b)=>
        a.incomingEdgeId.localeCompare(b.incomingEdgeId)||
        a.outgoingEdgeId.localeCompare(b.outgoingEdgeId))
    },
    pendingMovements:pending,
    pendingEdgeIds:[...missing].sort()
  };
}
