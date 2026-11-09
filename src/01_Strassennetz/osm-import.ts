/** Generischer OSM-Netzimport für Deutschland. Keine Autobahn- oder AS-Sonderfalllisten.
 * Quell-Daten: Overpass/OSM-Snapshot mit nodes, ways und restriction-Relations.
 * Jeder Way-Vertex bleibt erhalten; an wirklichen geteilten OSM-Nodes wird gesplittet.
 */
import {distanceM,polylineLengthM} from './geometry.js';
import {validateNetwork} from '../01_Strassennetz.js';
import {compileViaWayRestrictions,type ViaWayRule} from './via-way-restrictions.js';
import {distanceToExtractBoundaryM} from './extract-boundary.js';
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
  /** Exact .poly clipping boundary of the provided Geofabrik PBF. */
  extractBoundaryRings?: readonly (readonly Point[])[];
  /** Maximum distance to exact PBF clipping boundary; default 150 metres. */
  boundaryToleranceM?: number;
}
export interface OsmImportAudit {
  importedWays:number;
  importedMotorwayWays:number;
  importedRampWays:number;
  importedPublicWays:number;
  importedDirectedEdges:number;
  importedMovements:number;
  compiledViaWayRestrictions:number;
  deferredViaWayRelations:number[];
  /** Sichere Referenzableitungen aus exakt gemeinsamen motorway-OSM-Nodes. */
  inferredMotorwayRefs:{wayId:number;refs:string[];evidenceWayIds:number[];evidenceRelationIds?:number[]}[];
  /** Real physical motorway Ways with no safe motorway number; not hidden. */
  unassignedMotorwayWays:number[];
  /** Alle direkt aus dem OSM-Snapshot erwarteten Kanten müssen enthalten sein. */
  expectedDirectedSourceSegments:number;
  representedDirectedSourceSegments:number;
  unrepresentedSourceSegments:string[];
  /** Unbekannte Rampenenden werden gemeldet statt mit gezeichneten Geraden verbunden. */
  unconnectedRampEnds:{edgeId:string;nodeId:string;terminal:'start'|'end';
    lat:number;lon:number;sourceNeighborWays:{
      wayId:number;highway:string;service?:string;access?:string;oneway?:string;ref?:string
    }[]}[];
  /** Source-proven extract border entry/exit, never a fabricated connection. */
  extractBoundaryRampEnds:{edgeId:string;nodeId:string;terminal:'start'|'end';distanceM:number}[];
  /** Shared OSM point from which both motorway and ramp start, with no modeled inbound leg. */
  sourceStartRampEnds:{edgeId:string;nodeId:string;sharedMainlineIds:string[]}[];
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
  const knownPublicOrMotorwayNodes=new Set<number>();
  const serviceNodes=new Map<number,Set<number>>();
  const motorwayAndRampNodes=new Map<number,Set<number>>();
  for(const item of elements)if(item.type==='way'){
    if(item.tags?.highway==='service')for(const id of item.nodes){
      const neighbors=serviceNodes.get(id)??new Set<number>();
      neighbors.add(item.id);
      serviceNodes.set(id,neighbors);
    }
    if(item.tags?.highway==='motorway'||item.tags?.highway==='motorway_link')
      for(const id of item.nodes){
        const neighbors=motorwayAndRampNodes.get(id)??new Set<number>();
        neighbors.add(item.id);
        motorwayAndRampNodes.set(id,neighbors);
      }
    if(item.tags?.highway==='motorway'||PUBLIC.has(item.tags?.highway as RoadClass))
      for(const id of item.nodes)knownPublicOrMotorwayNodes.add(id);
  }
  const serviceOnlyTerminal=(way:OsmWay,id:number):boolean =>
    serviceNodes.has(id) && !knownPublicOrMotorwayNodes.has(id) &&
    [...(motorwayAndRampNodes.get(id)??[])].every(other=>other===way.id);
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
    // Service-area motorway_links are not normal AS. If the exact OSM-way
    // endpoint touches ONLY highway=service and no public/mainline/ramp
    // continuation, this is a service-only access; do not color it green.
    // Never drop ramps that have an additional legal public/AS connection.
    if(kind==='ramp'&&(serviceOnlyTerminal(item,item.nodes[0]!) ||
                       serviceOnlyTerminal(item,item.nodes[item.nodes.length-1]!))){
      excludedWays.push({id:item.id,reason:'Betriebs-/Rastplatz-Zufahrt an highway=service'});continue;
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
  const inferredMotorwayRefs:{
    wayId:number;refs:string[];evidenceWayIds:number[];evidenceRelationIds?:number[]
  }[]=[];
  // German motorway refs may be attached to OSM type=route, route=road
  // relations rather than duplicated on every motorway Way. The actual
  // way membership is an authoritative source - not coordinate snapping.
  const relatedRefs=new Map<number,{refs:Set<string>;relationIds:Set<number>}>();
  for(const relation of elements)if(relation.type==='relation'&&
    relation.tags?.type==='route'&&relation.tags.route==='road'){
    const refs=highwayRefs(relation.tags);
    if(!refs.length)continue;
    for(const member of relation.members)if(member.type==='way'){
      const record=relatedRefs.get(member.ref)??{
        refs:new Set<string>(),relationIds:new Set<number>()
      };
      refs.forEach(r=>record.refs.add(r));
      record.relationIds.add(relation.id);
      relatedRefs.set(member.ref,record);
    }
  }
  for(const {way,tags} of mainWays) {
    const exact=highwayRefs(tags);
    if(exact.length){references.set(way.id,exact);continue;}
    const relation=relatedRefs.get(way.id);
    if(relation?.refs.size){
      const refs=[...relation.refs].sort();
      references.set(way.id,refs);
      inheritedRefs.set(way.id,refs);
      inferredMotorwayRefs.push({
        wayId:way.id,refs,evidenceWayIds:[],
        evidenceRelationIds:[...relation.relationIds].sort((a,b)=>a-b)
      });
    }
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
  // A missing A-number is metadata uncertainty, NOT a missing carriageway.
  // Preserve these motorway-Ways in route graph and render them; do not
  // silently treat them as a particular Autobahn during an A→B closure.
  const unassignedMotorwayWays=mainWays.filter(({way})=>!references.has(way.id))
    .map(({way})=>way.id).sort((a,b)=>a-b);

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
    // A closed OSM Way (roundabout, turning circle, service loop) has
    // identical start/end node IDs. Model it as TWO real directed arcs
    // split at an EXISTING internal OSM vertex, not a zero-length
    // self-loop and never an invented shortcut.
    if(way.nodes[0]===way.nodes[way.nodes.length-1] && cuts.length===2 &&
       way.nodes.length>=4){
      cuts.splice(1,0,Math.floor((way.nodes.length-1)/2));
    }
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
    .map(rel=>({id:rel.id,parsed:parseRestriction(rel)}))
    .filter((r):r is {id:number;parsed:NonNullable<ReturnType<typeof parseRestriction>>}=>r.parsed!==null);
  // All Germany restriction relations are present in the source even when
  // building motorway-only routing. Ignore ONLY restrictions whose from-way
  // is not part of the imported graph. Relevant conditional/via-way rules
  // must still stop the strict import instead of quietly being ignored.
  const acceptedWayIds=new Set(accepted.map(x=>x.way.id));
  const nodeRestrictions=new Map<number,NonNullable<ReturnType<typeof parseRestriction>>[]>();
  const viaWaySources:ViaWayRule[]=[];
  for(const {id,parsed:r} of restrictions){
    if(!r.from.some(m=>acceptedWayIds.has(m.ref)))continue;
    if(r.except.split(/[;, ]+/).some(v=>['motorcar','motor_vehicle','vehicle'].includes(v)))continue;
    const commonShape=r.from.length===1&&r.to.length===1&&
      (r.code.startsWith('no_')||r.code.startsWith('only_'));
    if(!r.conditional&&commonShape&&r.via.length>0&&r.via.every(v=>v.type==='way')){
      viaWaySources.push({
        id,kind:r.code.startsWith('no_')?'no':'only',
        fromWayId:r.from[0]!.ref,viaWayIds:r.via.map(v=>v.ref),
        toWayId:r.to[0]!.ref
      });
      continue;
    }
    if(r.conditional||!commonShape||r.via.length!==1||r.via[0]?.type!=='node'){
      issues.push('Ungeprüfte OSM-Abbiegerelation '+id+' ('+r.code+', via='+
        r.via.map(v=>v.type+':'+v.ref).join(',')+', from='+r.from.map(v=>v.ref).join(',')+
        ', to='+r.to.map(v=>v.ref).join(',')+')');
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
  const byOriginalNode=new Map<number,{wayId:number;highway:string;service?:string;access?:string}[]>();
  for(const way of elements)if(way.type==='way'){
    const detail={wayId:way.id,highway:way.tags?.highway??'',
      ...(way.tags?.service?{service:way.tags.service}:{}),
      ...(way.tags?.access?{access:way.tags.access}:{}),
      ...(way.tags?.oneway?{oneway:way.tags.oneway}:{}),
      ...(way.tags?.ref?{ref:way.tags.ref}:{})};
    for(const id of new Set(way.nodes)){
      const entries=byOriginalNode.get(id)??[];
      entries.push(detail);
      byOriginalNode.set(id,entries);
    }
  }
  const unconnectedRampEnds:OsmImportAudit['unconnectedRampEnds']=[];
  const extractBoundaryRampEnds:OsmImportAudit['extractBoundaryRampEnds']=[];
  const sourceStartRampEnds:OsmImportAudit['sourceStartRampEnds']=[];
  const reportEnd=(edge:RoadEdge, nodeId:string, terminal:'start'|'end')=>{
    const id=Number(nodeId.slice(9));
    const point=nodePositions.get(id);
    if(!point)throw Error('Unbekannter Originalknoten '+id);
    const neighbors=(byOriginalNode.get(id)??[])
      .filter(x=>!edge.osmWayIds.includes(x.wayId)).slice(0,20);
    const boundaryDistance=options.extractBoundaryRings?.length?
      distanceToExtractBoundaryM(point,options.extractBoundaryRings):Infinity;
    // If a motorway and a slip road SHARE their start OSM node and no
    // imported edge enters the node, it is a directed source of the selected
    // graph (or an OSM snapshot cut). Do not call it a missing ramp and do
    // not create a fictional inbound connection. Keep this as explicit audit
    // metadata so national/full-graph validation can review the source.
    const sharedMainlines=(byStart.get(nodeId)??[])
      .filter(e=>e.kind==='mainline'&&e.id!==edge.id).map(e=>e.id);
    if(terminal==='start'&&!byEnd.has(nodeId)&&sharedMainlines.length){
      sourceStartRampEnds.push({edgeId:edge.id,nodeId,sharedMainlineIds:sharedMainlines});
      return;
    }
    if(!neighbors.length && boundaryDistance<= (options.boundaryToleranceM??150)){
      extractBoundaryRampEnds.push({edgeId:edge.id,nodeId,terminal,
        distanceM:Math.round(boundaryDistance*10)/10});
      return;
    }
    unconnectedRampEnds.push({edgeId:edge.id,nodeId,terminal,
      lat:point[0],lon:point[1],sourceNeighborWays:neighbors});
  };
  for(const e of edges)if(e.kind==='ramp'){
    const startId=Number(e.fromNodeId.slice(9)),endId=Number(e.toNodeId.slice(9));
    if(!(byEnd.get(e.fromNodeId)?.length)&&!externalPublicNodes.has(startId))
      reportEnd(e,e.fromNodeId,'start');
    if(!(byStart.get(e.toNodeId)?.length)&&!externalPublicNodes.has(endId))
      reportEnd(e,e.toNodeId,'end');
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
  const viaWay=compileViaWayRestrictions(viaWaySources,
    accepted.map(({way})=>({
      id:way.id,firstNodeId:way.nodes[0]!,lastNodeId:way.nodes[way.nodes.length-1]!
    })),edges,movements);
  issues.push(...viaWay.errors);
  const network:RoadNetwork={schemaVersion:1,
    nodes:[...nodes.values()].sort((a,b)=>a.id.localeCompare(b.id)),
    edges:edges.sort((a,b)=>a.id.localeCompare(b.id)),
    movements:movements.sort((a,b)=>a.incomingEdgeId.localeCompare(b.incomingEdgeId)||
      a.outgoingEdgeId.localeCompare(b.outgoingEdgeId)),
    ...(viaWay.restrictions.length?{routeRestrictions:viaWay.restrictions}:{})
  };
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
    compiledViaWayRestrictions:viaWay.restrictions.length,
    deferredViaWayRelations:viaWay.deferredIds,
    inferredMotorwayRefs,unassignedMotorwayWays,
    expectedDirectedSourceSegments:expectedCoverage.size,
    representedDirectedSourceSegments:segmentCoverage.size,
    unrepresentedSourceSegments,unconnectedRampEnds,extractBoundaryRampEnds,sourceStartRampEnds,excludedWays,issues
  };
  if(strict&&issues.length)throw new Error('OSM-Netzimport unvollständig:\n'+issues.join('\n'));
  return {network,audit};
}
