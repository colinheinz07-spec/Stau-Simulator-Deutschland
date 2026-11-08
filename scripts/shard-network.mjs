/** Partition one validated Germany graph into lazy-loadable spatial tiles.
 * Edge geometries may occur in multiple tiles, always with the SAME edge ID.
 * Each movement belongs ONLY to its incoming edge's home tile.
 */
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {Strassennetz} from '../dist/index.js';

const args=process.argv.slice(2);
const source=args.find(a=>!a.startsWith('--'));
const output=args.find(a=>a.startsWith('--output-dir='))?.slice('--output-dir='.length)??'data/tiles';
const size=Number(args.find(a=>a.startsWith('--tile-degrees='))?.slice('--tile-degrees='.length)??'.25');
if(!source||!Number.isFinite(size)||size<=0||size>1){
 console.error('Usage: node scripts/shard-network.mjs GRAPH.json [--output-dir=DIR] [--tile-degrees=.25]');
 process.exit(2);
}
const cache=new Map();
const tileIndex=n=>Math.floor(Number((n/size).toFixed(10)));
const tileKey=(lat,lon)=>tileIndex(lat)+'_'+tileIndex(lon);
function addEdgeToTile(key,edge,nodes){
 const bucket=cache.get(key)??{edges:new Map(),nodes:new Map(),movements:[],externalEdgeIds:new Set()};
 bucket.edges.set(edge.id,edge);
 for(const id of [edge.fromNodeId,edge.toNodeId]){
   const node=nodes.get(id);
   if(!node)throw Error('Unresolved node '+id+' on '+edge.id);
   bucket.nodes.set(id,node);
 }
 cache.set(key,bucket);
}
const graph=JSON.parse(await readFile(resolve(source),'utf8'));
const problems=Strassennetz.validateNetwork(graph);
if(problems.length)throw Error('Invalid source network: '+problems.slice(0,20).join('; '));
const nodes=new Map(graph.nodes.map(n=>[n.id,n]));
const owned=new Map();
for(const edge of graph.edges){
 const pts=edge.geometry;
 if(!pts.length)throw Error('Empty geometry: '+edge.id);
 const centre=pts[Math.floor(pts.length/2)];
 const owner=tileKey(centre[0],centre[1]);
 owned.set(edge.id,owner);
 let latMin=Infinity,latMax=-Infinity,lonMin=Infinity,lonMax=-Infinity;
 for(const p of pts){
   latMin=Math.min(latMin,p[0]);latMax=Math.max(latMax,p[0]);
   lonMin=Math.min(lonMin,p[1]);lonMax=Math.max(lonMax,p[1]);
 }
 const latTiles=tileIndex(latMax)-tileIndex(latMin)+1;
 const lonTiles=tileIndex(lonMax)-tileIndex(lonMin)+1;
 if(latTiles*lonTiles>32)throw Error('OSM edge crosses too many tiles without splitting: '+edge.id);
 for(let y=tileIndex(latMin);y<=tileIndex(latMax);y++)
  for(let x=tileIndex(lonMin);x<=tileIndex(lonMax);x++)
   addEdgeToTile(y+'_'+x,edge,nodes);
}
for(const movement of graph.movements){
 const home=owned.get(movement.incomingEdgeId);
 if(!home)throw Error('Missing movement owner '+movement.incomingEdgeId);
 const tile=cache.get(home);
 tile.movements.push(movement);
 if(!tile.edges.has(movement.outgoingEdgeId))tile.externalEdgeIds.add(movement.outgoingEdgeId);
}
const covered=new Set();
let seenMoves=0;
for(const tile of cache.values()){
 for(const edgeId of tile.edges.keys())covered.add(edgeId);
 seenMoves+=tile.movements.length;
}
if(covered.size!==graph.edges.length||seenMoves!==graph.movements.length)
 throw Error('Tiling lost edges or cross-tile movements');
const destination=resolve(output);
await mkdir(destination,{recursive:true});
const manifest={
 schemaVersion:1,tileDegrees:size,
 attribution:'© OpenStreetMap contributors, ODbL',
 attributionUrl:'https://www.openstreetmap.org/copyright',
 counts:{uniqueEdges:graph.edges.length,nodes:graph.nodes.length,
  movements:graph.movements.length,tiles:cache.size},
 tiles:[]
};
for(const [key,bucket] of [...cache].sort(([a],[b])=>a.localeCompare(b))){
 const [y,x]=key.split('_').map(Number);
 const tile={
   schemaVersion:1,key,
   bbox:[y*size,x*size,(y+1)*size,(x+1)*size],
   nodes:[...bucket.nodes.values()],
   edges:[...bucket.edges.values()],
   movements:bucket.movements,
   externalEdgeIds:[...bucket.externalEdgeIds].sort()
 };
 const bytes=gzipSync(JSON.stringify(tile),{level:6});
 const filename=key+'.json.gz';
 await writeFile(join(destination,filename),bytes);
 manifest.tiles.push({key,file:filename,bbox:tile.bbox,
  edges:tile.edges.length,movements:tile.movements.length,
  bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
}
await writeFile(join(destination,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({output:destination,...manifest.counts},null,2));
