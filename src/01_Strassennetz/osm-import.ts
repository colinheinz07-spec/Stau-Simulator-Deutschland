/** Generischer OSM-Netzimport für Deutschland. Keine Autobahn- oder AS-Sonderfalllisten.
 * Quell-Daten: Overpass/OSM-Snapshot mit nodes, ways und restriction-Relations.
 * Jeder Way-Vertex bleibt erhalten; an wirklichen geteilten OSM-Nodes wird gesplittet.
 */
import {distanceM,polylineLengthM} from './geometry.js';
import {validateNetwork} from '../01_Strassennetz.js';
import type {Point,RoadClass,RoadEdge,RoadNetwork,RoadNode,TurnMovement} from '../model.js';

type OsmTags = Readonly<Record<string,string>>;
export interface OsmNode {type:'node';id:number;lat:number;lon:number;tags?:OsmTags}
export interface OsmWay {
  type:'way';id:number;nodes:readonly number[];tags?:OsmTags;
  geometry?:readonly {lat:number;lon:number}[];
}
export interface OsmRelation {
  type:'relation';id:number;tags?:OsmTags;
  members:readonly {type:'node'|'way'|'relation';ref:number;role:string}[];
}
export type OsmElement = OsmNode|OsmWay|OsmRelation;
export interface OsmImportOptions {
  /** Bei false nur Autobahnen/Rampen; öffentliche Straßengraphen separat nachladen. */
  includePublicRoads?: boolean;
  /** Bei true fehlschlagen statt unklaren Abbiegeregeln nachzuraten (Standard). */
  strict?: boolean;
}
export interface OsmImportAudit {
  importedWays:number;
  importedMotorwayWays:number;
  importedRampWays:number;
  importedPublicWays:number;
  importedDirectedEdges:number;
  importedMovements:number;
  /** Sichere Referenzableitungen aus exakt gemeinsamen motorway-OSM-Nodes. */
  inferredMotorwayRefs:{wayId:number;refs:string[];evidenceWayIds:number[]}[];
  /** Alle direkt aus dem OSM-Snapshot erwarteten Kanten müssen enthalten sein. */
  expectedDirectedSourceSegments:number;
  representedDirectedSourceSegments:number;
  unrepresentedSourceSegments:string[];
  /** Unbekannte Rampenenden werden gemeldet statt mit gezeichneten Geraden verbunden. */
  unconnectedRampEnds:{edgeId:string;nodeId:string;terminal:'start'|'end'}[];
  excludedWays:readonly {id:number;reason:string}[];
  issues:readonly string[];
}
const PUBLIC = new Set<RoadClass>([
  'trunk','trunk_link','primary','primary_link',
  'secondary','secondary_link','tertiary','tertiary_link',
  'residential','unclassified','living_street'
]);
const REF = /(?:^|[;\s])A\s*(\d{1,3})(?=$|[;\s])/gi;
const REST = /\b(?:rastst[aä]tte|rastplatz|rastanlage|autohof|service\s*area|pwc)\b/i;
const BLOCKED = new Set(['no','private']);
const asPoint = (p:{lat:number;lon:number}):Point => [p.lat,p.lon];
const key = (wayId:number, direction:string, from:number,to:number) =>
  'osm:'+wayId+':'+direction+':'+from+'-'+to;
function laneCount(tags:OsmTags,kind:RoadEdge['kind'],direction:'f'|'b',twoWay:boolean):number {
  const byDir=tags[direction==='f'?'lanes:forward':'lanes:backward'];
  const n=Number(byDir??tags.lanes);
  if (byDir && Number.isInteger(n) && n > 0 && n <= 8) return n;
  if (twoWay && Number.isInteger(n) && n >= 2 && n <= 16)
    return direction==='f'?Math.ceil(n/2):Math.floor(n/2);
  if (Number.isInteger(n) && n > 0 && n <= 8 && !twoWay) return n;
  return kind==='mainline'?2:1; // Fehlende OSM lanes = Modellannahme, kein Vermessungswert.
}
function wayClass(way:OsmWay,publicRoads:boolean):RoadEdge['kind']|null {
  const k=way.tags?.highway;
  if (k==='motorway') return 'mainline';
  if (k==='motorway_link') return 'ramp';
  if (publicRoads && k && PUBLIC.has(k as RoadClass)) return 'public';
  return null;
}
function highwayRefs(tags:OsmTags):string[] {
  const refs=[...(tags.ref??'').matchAll(REF)].map(x=>'A'+x[1]);
  return [...new Set(refs)];
}
interface AcceptedWay {way:OsmWay;kind:RoadEdge['kind'];points:Point[];tags:OsmTags}
function parseRestriction(rel:OsmRelation) {
  const tags=rel.tags??{};
  if (tags.type!=='restriction') return null;
  const from=rel.members.filter(m=>m.role==='from'&&m.type==='way');
  const to=rel.members.filter(m=>m.role==='to'&&m.type==='way');
  const via=rel.members.filter(m=>m.role==='via');
  return {from,to,via,code:tags['restriction:motorcar']??tags.restriction??'',
    except:tags.except??'', conditional:Object.keys(tags).some(k=>k.includes(':conditional'))};
}

/** Importiert alle zulässigen motorway/motorway_link-Kanten, auch sehr kurze
 * Teilstücke zwischen zwei OSM-Nodes. Jedes reale Teilstück ist in genau
 * einer Richtung enthalten, außer OSM schreibt Gegenrichtung ausdrücklich vor.
 */
export function importOsmNetwork(elements:readonly OsmElement[],
 options:OsmImportOptions={}): {network:RoadNetwork;audit:OsmImportAudit} {
  const strict=options.strict!==false;
  const issues:string[]=[], excludedWays:{id:number;reason:string}[]=[];
  const nodePositions=new Map<number,Point>();
  const junctionNames=new Map<number,{ref?:string;name?:string}>();
  const wayIds=new Set<number>();
  for(const el of elements)if(el.type==='node'){
    const old=nodePositions.get(el.id),at=asPoint(el);
    if(old && distanceM(old,at)>.5) issues.push('Widersprüchliche OSM-Node-Koordinate '+el.id);
    nodePositions.set(el.id,at);
    if(el.tags?.highway==='motorway_junction')
      junctionNames.set(el.id,{ref:el.tags.ref,name:el.tags.name});
  }
  const accepted:AcceptedWay[]=[];
  for(const item of elements){
    if(item.type!=='way')continue;
    if(wayIds.has(item.id)){issues.push('Doppelte OSM-Way-ID '+item.id);continue;}
    wayIds.add(item.id);
    const kind=wayClass(item,options.includePublicRoads===true);
    if(!kind)continue;
    const tags=item.tags??{};
    if(['access','vehicle','motor_vehicle','motorcar'].some(t=>BLOCKED.has(tags[t]??''))){
      excludedWays.push({id:item.id,reason:'private / access=no'});continue;
    }
    if(kind==='ramp'&&REST.test([
      tags.name,tags.destination,tags['destination:street'],tags.service,tags['motorway:service']
    ].join(' '))){
      excludedWays.push({id:item.id,reason:'explizite Rastplatz-/Service-Zufahrt'});continue;
    }
    if(item.nodes.length<2){issues.push('OSM-Way ohne Fahrweg '+item.id);continue;}
    if(item.geometry && item.geometry.length!==item.nodes.length) {
      issues.push('Unvollständige OSM-Geometrie '+item.id);continue;
    }
    const points=item.nodes.map((id,i)=>item.geometry?.[i]?
      asPoint(item.geometry[i]!):nodePositions.get(id));
    if(points.some(p=>!p)){issues.push('OSM-Way mit fehlender Knotenkoordinate '+item.id);continue;}
    const concrete=points as Point[];
    for(let i=0;i<item.nodes.length;i++){
      const old=nodePositions.get(item.nodes[i]!),at=concrete[i]!;
      if(old&&distanceM(old,at)>.5)
        issues.push('Widersprüchliche OSM-Geometrie bei Node '+item.nodes[i]);
      nodePositions.set(item.nodes[i]!,at);
    }
    accepted.push({way:item,kind,points:concrete,tags});
  }
  // OSM motorway Ways sind mitunter ohne ref getaggt. Jede echte
  // Hauptfahrbahn bleibt im Netz. Wir erben ihre Ref(s) nur von eindeutig
  // gemeinsamen motorway-OSM-Knoten, niemals von nahen Linien/Landstraßen.
  const mainWays=accepted.filter(f=>f.kind==='mainline');
  const mainByNode=new Map<number,number[]>();
  for(const {way} of mainWays)for(const id of way.nodes) {
    mainByNode.set(id,[...(mainByNode.get(id)??[]),way.id]);
  }
  const inheritedRefs=new Map<number,string[]>();
  const references=new Map<number,string[]>();
  const inferredMotorwayRefs:{wayId:number;refs:string[];evidenceWayIds:number[]}[]=[];
  for(const {way,tags} of mainWays) {
    const exact=highwayRefs(tags);
    if(exact.length)references.set(way.id,exact);
  }
  for(let round=0;round<mainWays.length;round++){
    let changed=false;
    for(const {way} of mainWays) {
      if(references.has(way.id))continue;
      const evidence=new Set<number>();
      const candidates:string[][]=[];
      for(const nodeId of way.nodes)for(const neighbor of mainByNode.get(nodeId)??[]) {
        if(neighbor===way.id)continue;
        const neighborRefs=references.get(neighbor);
        if(!neighborRefs?.length)continue;
        evidence.add(neighbor);
        candidates.push(neighborRefs);
      }
      if(!candidates.length)continue;
      // All neighboring motorway tags must agree or have one common ref.
      // An ambiguous AK fork is never guessed into one Autobahn.
      const same=candidates.every(x=>x.length===candidates[0]!.length&&
        x.every(r=>candidates[0]!.includes(r)));
      const intersection=candidates[0]!.filter(r=>candidates.every(x=>x.includes(r)));
      const inferred=same?candidates[0]!:intersection.length===1?intersection:[];
      if(!inferred.length)continue;
      references.set(way.id,[...inferred]);
      inheritedRefs.set(way.id,[...inferred]);
      inferredMotorwayRefs.push({wayId:way.id,refs:[...inferred],evidenceWayIds:[...evidence].sort((a,b)=>a-b)});
      changed=true;
    }
    if(!changed)break;
  }
  for(const {way} of mainWays)if(!references.has(way.id))
    issues.push('Autobahn ohne eindeutiges OSM-ref (kein sicherer gemeinsamer motorway-Node): '+way.id);

  // Jeder shared node trennt die Straßen, sonst können Auffahrten mitten
  // in einem langen Way keine eigene Kante erhalten.
  const occurrence=new Map<number,Set<number>>();
  for(const {way} of accepted)for(const node of way.nodes) {
    const set=occurrence.get(node)??new Set<number>();
    set.add(way.id);occurrence.set(node,set);
  }
  const shared=new Set([...occurrence].filter(([,ways])=>ways.size>1).map(([id])=>id));
  const nodes=new Map<number,RoadNode>();
  const edges:RoadEdge[]=[];
  const segmentCoverage=new Set<string>();
  const expectedCoverage=new Set<string>();
  for(const {way,kind,points,tags} of accepted){
    const twoWay=tags.oneway==='no'||(
      kind==='public'&&tags.oneway!=='yes'&&tags.oneway!=='1'&&
      tags.oneway!=='-1'&&tags.junction!=='roundabout');
    const reversed=tags.oneway==='-1';
    const directions:(readonly ['f'|'b',boolean])[]=
      twoWay?[['f',false],['b',true]]:[reversed?['b',true]:['f',false]];
    const cuts=[0];
    for(let i=1;i<way.nodes.length-1;i++)
      if(shared.has(way.nodes[i]!) || junctionNames.has(way.nodes[i]!))cuts.push(i);
    cuts.push(way.nodes.length-1);
    for(const [label,reverse] of directions){
      for(let i=1;i<way.nodes.length;i++){
        const a=way.nodes[reverse?i:i-1]!,b=way.nodes[reverse?i-1:i]!;
        expectedCoverage.add(way.id+':'+label+':'+a+'>'+b);
      }
      for(let ci=1;ci<cuts.length;ci++){
        const left=cuts[ci-1]!,right=cuts[ci]!;
        const order=reverse?Array.from({length:right-left+1},(_,j)=>right-j):
          Array.from({length:right-left+1},(_,j)=>left+j);
        const first=order[0]!,last=order[order.length-1]!;
        const srcId=way.nodes[first]!,dstId=way.nodes[last]!;
        const geometry=order.map(n=>points[n]!);
        if(srcId===dstId||polylineLengthM(geometry)<.05){
          issues.push('Null-/Ringsegment prüfen '+way.id+':'+left+'-'+right);
          continue;
        }
        const sources=inheritedRefs.get(way.id)??highwayRefs(tags);
        const edge:RoadEdge={
          id:key(way.id,label,srcId,dstId),
          fromNodeId:'osm-node:'+srcId,toNodeId:'osm-node:'+dstId,
          geometry,osmWayIds:[way.id],kind,
          osmClass:tags.highway as RoadClass,
          ...(sources.length?{motorwayRef:sources[0],motorwayRefs:sources}:{}),
          lanes:laneCount(tags,kind,label,twoWay),
          lengthM:polylineLengthM(geometry),
          freeSpeedKmh:kind==='mainline'?130:kind==='ramp'?80:50,
          capacityPerLaneVph:kind==='mainline'?2100:kind==='ramp'?1500:900
        };
        edges.push(edge);
        const startJunction=junctionNames.get(srcId);
        const endJunction=junctionNames.get(dstId);
        nodes.set(srcId,{id:edge.fromNodeId,point:points[first]!,osmNodeId:srcId,
          ...(startJunction?.ref?{junctionRef:startJunction.ref}:{}),
          ...(startJunction?.name?{junctionName:startJunction.name}:{})});
        nodes.set(dstId,{id:edge.toNodeId,point:points[last]!,osmNodeId:dstId,
          ...(endJunction?.ref?{junctionRef:endJunction.ref}:{}),
          ...(endJunction?.name?{junctionName:endJunction.name}:{})});
        for(let j=1;j<order.length;j++){
          const a=way.nodes[order[j-1]!]!,b=way.nodes[order[j]!]!;
          segmentCoverage.add(way.id+':'+label+':'+a+'>'+b);
        }
      }
    }
  }
  const byEnd=new Map<string,RoadEdge[]>(),byStart=new Map<string,RoadEdge[]>();
  for(const e of edges){
    byEnd.set(e.toNodeId,[...(byEnd.get(e.toNodeId)??[]),e]);
    byStart.set(e.fromNodeId,[...(byStart.get(e.fromNodeId)??[]),e]);
  }
  // Abbiegebeschränkungen (from-way, via-node, to-way) beachten.
  // via-way/bedingt/unbekannte Relations müssen vorher überprüft werden.
  const restrictions=elements.filter((el):el is OsmRelation=>el.type==='relation')
    .map(parseRestriction).filter((r):r is NonNullable<typeof r>=>r!==null);
  // All Germany restriction relations are present in the source even when
  // building motorway-only routing. Ignore ONLY restrictions whose from-way
  // is not part of the imported graph. Relevant conditional/via-way rules
  // must still stop the strict import instead of quietly being ignored.
  const acceptedWayIds=new Set(accepted.map(x=>x.way.id));
  const nodeRestrictions=new Map<number,typeof restrictions>();
  for(const r of restrictions){
    if(!r.from.some(m=>acceptedWayIds.has(m.ref)))continue;
    if(r.except.split(/[;, ]+/).some(v=>['motorcar','motor_vehicle','vehicle'].includes(v)))continue;
    if(r.conditional||r.from.length!==1||r.to.length!==1||r.via.length!==1||
      r.via[0]?.type!=='node'||(!r.code.startsWith('no_')&&!r.code.startsWith('only_'))){
      issues.push('Ungeprüfte OSM-Abbiegerelation (Import muss geprüft werden)');
      continue;
    }
    const nodeId=r.via[0]!.ref;
    nodeRestrictions.set(nodeId,[...(nodeRestrictions.get(nodeId)??[]),r]);
  }
  // Prüfe echte Enden, nicht nur Way-IDs. Ein Rampenende darf auf der
  // normalen Ortsstraße liegen, auch wenn deren Graph noch nicht geladen ist.
  // Ohne solche belegten Kontakte ist der OSM-Snapshot unvollständig.
  const externalPublicNodes=new Set<number>();
  for(const item of elements)if(item.type==='way'&&
    PUBLIC.has(item.tags?.highway as RoadClass)&&
    !['access','vehicle','motor_vehicle','motorcar'].some(t=>BLOCKED.has(item.tags?.[t]??'')))
    for(const nodeId of item.nodes)externalPublicNodes.add(nodeId);
  const unconnectedRampEnds:{edgeId:string;nodeId:string;terminal:'start'|'end'}[]=[];
  for(const e of edges)if(e.kind==='ramp'){
    const startId=Number(e.fromNodeId.slice(9)),endId=Number(e.toNodeId.slice(9));
    if(!(byEnd.get(e.fromNodeId)?.length)&&!externalPublicNodes.has(startId))
      unconnectedRampEnds.push({edgeId:e.id,nodeId:e.fromNodeId,terminal:'start'});
    if(!(byStart.get(e.toNodeId)?.length)&&!externalPublicNodes.has(endId))
      unconnectedRampEnds.push({edgeId:e.id,nodeId:e.toNodeId,terminal:'end'});
  }
  if(unconnectedRampEnds.length)
    issues.push('Rampenenden ohne nachgewiesene Netz-/Ortsstraßenverbindung: '+unconnectedRampEnds.length);
  const movements:TurnMovement[]=[];
  for(const [nodeId,incoming] of byEnd){
    const next=byStart.get(nodeId)??[];
    const osmId=Number(nodeId.replace('osm-node:',''));
    const restrictionsHere=nodeRestrictions.get(osmId)??[];
    for(const from of incoming)for(const to of next){
      // Kein implizites U-Turn über Gegenfahrbahn auf demselben Edge.
      if(from.fromNodeId===to.toNodeId&&from.toNodeId===to.fromNodeId)continue;
      const disallowed=restrictionsHere.some(r=>{
        if(!from.osmWayIds.includes(r.from[0]!.ref))return false;
        if(r.code.startsWith('only_'))return !to.osmWayIds.includes(r.to[0]!.ref);
        return to.osmWayIds.includes(r.to[0]!.ref);
      });
      if(!disallowed)movements.push({
        incomingEdgeId:from.id,outgoingEdgeId:to.id,allowed:true
      });
    }
  }
  const network:RoadNetwork={schemaVersion:1,
    nodes:[...nodes.values()].sort((a,b)=>a.id.localeCompare(b.id)),
    edges:edges.sort((a,b)=>a.id.localeCompare(b.id)),
    movements:movements.sort((a,b)=>a.incomingEdgeId.localeCompare(b.incomingEdgeId)||
      a.outgoingEdgeId.localeCompare(b.outgoingEdgeId))};
  const unrepresentedSourceSegments=[...expectedCoverage].filter(k=>!segmentCoverage.has(k)).sort();
  if(unrepresentedSourceSegments.length)
    issues.push('Nicht gezeichnete motorway-/motorway_link-/Straßenstücke: '+unrepresentedSourceSegments.length);
  issues.push(...validateNetwork(network));
  const audit:OsmImportAudit={
    importedWays:accepted.length,
    importedMotorwayWays:accepted.filter(w=>w.kind==='mainline').length,
    importedRampWays:accepted.filter(w=>w.kind==='ramp').length,
    importedPublicWays:accepted.filter(w=>w.kind==='public').length,
    importedDirectedEdges:edges.length,
    importedMovements:movements.length,
    inferredMotorwayRefs,
    expectedDirectedSourceSegments:expectedCoverage.size,
    representedDirectedSourceSegments:segmentCoverage.size,
    unrepresentedSourceSegments,unconnectedRampEnds,excludedWays,issues
  };
  if(strict&&issues.length)throw new Error('OSM-Netzimport unvollständig:\n'+issues.join('\n'));
  return {network,audit};
}
