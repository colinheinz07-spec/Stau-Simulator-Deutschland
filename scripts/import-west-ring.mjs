/* Exact OSM western ring extension. Import only real directed nodes/ways.
 * No synthetic road links. Original source: OSM contributors, ODbL 1.0.
 * Node 20+: node scripts/import-west-ring.mjs [--snapshot=FILE]
 */
import {readFile,writeFile,rename} from "node:fs/promises";
import {pathToFileURL} from "node:url";

const FILE="web/legacy-geometry.js";
const ANCHORS=[
 {from:"extra-a1-koblenz",fromEnd:true,to:"A61-30169400",toEnd:false,direction:"south"},
 {from:"A61-55751508",fromEnd:true,to:"extra-a1-dortmund",toEnd:false,direction:"north"}
];
const JUNCTIONS={
 A1:{"104":"AK Köln-West","105":"Frechen","106":"Gleuel","107":"AD Erfttal","108":"Erftstadt","109":"AK Bliesheim"},
 A61:{"23":"AD Erfttal","24":"AK Bliesheim","25":"Weilerswist","26":"Swisttal-Heimerzheim","27":"Swisttal-Miel","28":"Rheinbach","29":"AK Meckenheim"}
};
// AS 105/106 are checked against their actual OSM names rather than the
// fallback table; the public catalogue numbers are 104a/105/106.
const key=p=>p.map(x=>Number(x).toFixed(7)).join(",");
const metres=(a,b)=>Math.hypot((a[0]-b[0])*111195,(a[1]-b[1])*111195*Math.cos((a[0]+b[0])*Math.PI/360));
const refs=t=>[...new Set((String(t?.ref||"").match(/A\s*\d+/g)||[]).map(x=>x.replace(/\s/g,"")))];
const pair=(a,b)=>a+">"+b;
const push=(m,k,v)=>{if(!m.has(k))m.set(k,[]);m.get(k).push(v);};
const service=t=>/rastplatz|raststätte|parkplatz|autobahnmeisterei|betriebszufahrt/i.test([t.name,t.destination,t.description].join(" "));
function fail(msg){throw Error(msg);}
function decode(text){const marker="window.STAU_LEGACY_GEOMETRY=";return JSON.parse(text.slice(text.indexOf(marker)+marker.length).trim().replace(/;$/,""));}
function network(elements){
 const nodes=new Map(),ways=new Map(),pointIndex=new Map();
 for(const e of elements)if(e.type==="node"&&Number.isFinite(e.lat)&&Number.isFinite(e.lon)){nodes.set(e.id,{p:[e.lat,e.lon],tags:e.tags||{}});}
 for(const e of elements)if(e.type==="way"&&e.nodes?.length>=2&&e.geometry?.length===e.nodes.length){
   if(!["motorway","motorway_link"].includes(e.tags?.highway)||e.geometry.some(p=>!p||!Number.isFinite(p.lat)))continue;
   if(service(e.tags)||["private","no"].includes(e.tags.access)||["private","no"].includes(e.tags.motor_vehicle))continue;
   const p=e.geometry.map(g=>[g.lat,g.lon]);
   for(let i=0;i<e.nodes.length;i++){const id=e.nodes[i],old=nodes.get(id);if(old&&key(old.p)!==key(p[i]))fail("OSM node geometry conflict "+id);if(!old)nodes.set(id,{p:p[i],tags:{}});}
   ways.set(e.id,e);
 }
 for(const [id,n] of nodes)push(pointIndex,key(n.p),id);
 const adjacency=new Map(),incoming=new Map(),all=[];
 for(const w of ways.values()){
   const t=w.tags,one=t.oneway??"yes";
   if(!["yes","true","1","-1","no","false","0"].includes(one))continue;
   for(let i=0;i<w.nodes.length-1;i++){
     const a=w.nodes[i],b=w.nodes[i+1];if(a===b)continue;
     const add=(from,to,sign)=>{const e={from,to,w,i,sign,d:metres(nodes.get(from).p,nodes.get(to).p),refs:refs(t),kind:t.highway};if(e.d<.01)return;all.push(e);push(adjacency,from,e);push(incoming,to,e);};
     if(one!=="-1")add(a,b,1);
     if(["-1","no","false","0"].includes(one))add(b,a,-1);
   }
 }
 return {nodes,ways,pointIndex,adjacency,incoming,all};
}
function shortest(g,from,to,allow){
 const dist=new Map([[from,0]]),parent=new Map(),queue=[[0,from]];
 while(queue.length){
   queue.sort((a,b)=>b[0]-a[0]);const [d,n]=queue.pop();if(d!==dist.get(n))continue;
   if(n===to){const path=[];let at=n;while(at!==from){const e=parent.get(at);if(!e)fail("Broken path");path.push(e);at=e.from;}return path.reverse();}
   for(const e of g.adjacency.get(n)||[])if(allow(e)&&d+e.d<(dist.get(e.to)??Infinity)){dist.set(e.to,d+e.d);parent.set(e.to,e);queue.push([d+e.d,e.to]);}
 }
 return null;
}
function anchor(g,data,road,end){
 const r=data.roads.find(x=>x[0]===road);if(!r)fail("Legacy anchor missing: "+road);
 const p=r[4][end?r[4].length-1:0],ids=g.pointIndex.get(key(p))||[];
 const exact=ids.filter(n=>[...(g.adjacency.get(n)||[]),...(g.incoming.get(n)||[])].some(e=>e.kind==="motorway"&&e.refs.includes(r[2])));
 if(exact.length!==1)fail("No unique exact OSM anchor "+road+" @ "+key(p)+"; refusing to snap");
 return exact[0];
}
function lanes(w,sign,kind){
 const tag=w.tags,raw=tag[sign===1?"lanes:forward":"lanes:backward"]??tag.lanes;
 let n=Number(raw);
 if(!Number.isInteger(n)||n<1||n>8)return {n:kind==="mainline"?2:1,estimated:true};
 if(["no","false","0"].includes(tag.oneway)&&!tag[sign===1?"lanes:forward":"lanes:backward"])return {n:Math.max(1,Math.floor(n/2)),estimated:true};
 return {n,estimated:false};
}
function runs(path){
 const result=[];for(const e of path){const last=result.at(-1);
   if(last&&last.w.id===e.w.id&&last.sign===e.sign&&last.segments.at(-1).to===e.from)last.segments.push(e);
   else result.push({w:e.w,sign:e.sign,segments:[e]});
 }return result;
}
function primary(e){return e.refs.includes("A1")?"A1":e.refs.includes("A61")?"A61":e.refs[0];}
function classifyJunction(name){
 if(/bliesheim|meckenheim|köln[- ]west/i.test(name)&&/kreuz|^AK\b/i.test(name))return "AK";
 if(/erfttal/i.test(name))return "AD";
 if(/autobahnkreuz|^AK\b|\bkreuz\b/i.test(name))return "AK";
 if(/autobahndreieck|^AD\b|\bdreieck\b/i.test(name))return "AD";
 return "AS";
}
function jname(name){return String(name||"").replace(/^(?:Autobahnkreuz|Autobahndreieck|AK|AD|AS)\s+/i,"").trim();}
export function extendWesternRing(data,elements,options={}){
 const g=network(elements),selected=new Map(),routes=[],newJunctions=[],laneEstimates=[];
 const existingPairs=new Set(),existingIds=new Set(data.roads.map(r=>r[0]));
 const existingRefs=new Map();
 for(const r of data.roads)for(let i=1;i<r[4].length;i++){existingPairs.add(pair(key(r[4][i-1]),key(r[4][i])));if(r[1]==="mainline"){for(const p of [r[4][i-1],r[4][i]])push(existingRefs,key(p),r[2]);}}
 const usedNodes=new Set(),sharedWays=new Set();
 const isRing=e=>e.kind==="motorway"&&e.refs.some(r=>r==="A1"||r==="A61");
 const add=e=>{const k=pair(e.from,e.to);if(selected.has(k)&&selected.get(k).w.id!==e.w.id)fail("Duplicate physical direction "+k);selected.set(k,e);usedNodes.add(e.from);usedNodes.add(e.to);};
 for(const a of options.anchors||ANCHORS){
   const start=anchor(g,data,a.from,a.fromEnd),end=anchor(g,data,a.to,a.toEnd);
   const path=shortest(g,start,end,isRing);if(!path?.length)fail("Missing directed ring "+a.direction);
   const length=path.reduce((n,e)=>n+e.d,0);
   if(!options.synthetic&&(length<20000||length>55000))fail("Unexpected western ring length "+length);
   if(!path.some(e=>e.refs.includes("A1"))||!path.some(e=>e.refs.includes("A61")))fail("Missing A1/A61 transition");
   for(const e of path){
     if(existingPairs.has(pair(key(g.nodes.get(e.from).p),key(g.nodes.get(e.to).p))))fail("New corridor overlaps already mapped carriageway");
     if(e.refs.includes("A1")&&e.refs.includes("A61"))sharedWays.add(e.w.id);
     add(e);
   }
   routes.push({direction:a.direction,start:a.from,end:a.to,lengthM:Math.round(length),segments:path.length,refs:[...new Set(path.flatMap(e=>e.refs))]});
 }
 if(!options.synthetic&&!sharedWays.size)fail("Shared A1/A61 carriageway not identified");
 // Keep only junctions/ramp components actually touching a selected or
 // existing motorway node. This is a topological test, not distance snapping.
 const pathNodes=new Set(usedNodes),junctionAt=new Map();
 for(const n of pathNodes){
   const item=g.nodes.get(n),t=item.tags;if(t.highway!=="motorway_junction")continue;
   const roadRefs=[...new Set([...(g.adjacency.get(n)||[]),...(g.incoming.get(n)||[])].filter(isRing).flatMap(e=>e.refs))];
   const raw=String(t.ref||"").trim(),nums=raw.split(/[;/]/).map(x=>x.trim());
   if(!raw||!roadRefs.length)continue;
   for(const ref of roadRefs){
     if(!["A1","A61"].includes(ref))continue;
     let number=nums.find(x=>ref==="A1"?/^\d{3}[a-z]?$/.test(x):/^\d{2}[a-z]?$/.test(x))||nums[0];
     let name=t.name||t["junction:name"]||JUNCTIONS[ref]?.[number];
     if(!name)continue;
     // The OSM node's signed number/name is authoritative. Never attach a
     // guessed coordinate to an interchange.
     const kind=classifyJunction(name);
     if(kind!=="AS"&&!/^(AK|AD|Autobahnkreuz|Autobahndreieck)\b/i.test(name))name=kind+" "+name;
     const entry={ref,number,name,kind,node:n};
     push(junctionAt,n,entry);newJunctions.push(entry);
   }
 }
 // Link components touching the corridor. Stop at public-road interfaces
 // (non-motorway OSM ways sharing exact nodes), or an actual motorway merge.
 const publicNodes=new Set(elements.filter(e=>e.type==="node"&&e.tags?.highway&&["traffic_signals","give_way","stop","mini_roundabout"].includes(e.tags.highway)).map(e=>e.id));
 for(const w of elements)if(w.type==="way"&&w.tags?.highway&&!["motorway","motorway_link","service","construction","proposed","footway","cycleway","path","track"].includes(w.tags.highway)&&!["private","no"].includes(w.tags.access)&&!["private","no"].includes(w.tags.motor_vehicle))for(const n of w.nodes||[])publicNodes.add(n);
 const rampWays=new Set(),rampLabels=new Map(),visited=new Set(),rampByNode=new Map();
 for(const w of g.ways.values())if(w.tags.highway==="motorway_link")for(const n of w.nodes)push(rampByNode,n,w);
 for(const n of pathNodes)for(const seed of rampByNode.get(n)||[]){
   if(visited.has(seed.id))continue;
   const component=[],queue=[seed],touch=new Set(),local=new Set();
   for(let i=0;i<queue.length;i++){
     const w=queue[i];if(visited.has(w.id))continue;visited.add(w.id);component.push(w);
     for(const node of w.nodes){
       if(pathNodes.has(node))touch.add(node);
       if(publicNodes.has(node)){local.add(node);continue;}
       for(const next of rampByNode.get(node)||[])if(!visited.has(next.id))queue.push(next);
     }
   }
   const labels=[...touch].flatMap(n=>junctionAt.get(n)||[]);
   if(!labels.length)continue; // no verified signed junction, no fake access
   for(const w of component){
     if(service(w.tags))continue;
     rampWays.add(w.id);
     const nearest=labels.map(j=>({j,d:Math.min(...w.nodes.map(n=>metres(g.nodes.get(n).p,g.nodes.get(j.node).p)))})).sort((a,b)=>a.d-b.d)[0].j;
     rampLabels.set(w.id,{...nearest,local:local.size>0});
   }
 }
 const roads=[],sourceAudit={};
 const uniqueId=base=>{let id=base,n=1;while(existingIds.has(id))id=base+":"+n++;existingIds.add(id);return id;};
 function append(run,ref,kind,label,extra={}){
   const es=run.segments,points=[g.nodes.get(es[0].from).p,...es.map(e=>g.nodes.get(e.to).p)];
   const lane=lanes(run.w,run.sign,kind),id=uniqueId("west-"+run.w.id+(run.sign<0?"-reverse":"")+"-"+es[0].from);
   roads.push([id,kind,ref,lane.n,points,label,run.w.id,run.w.tags.shoulder||null]);
   sourceAudit[id]={osmWayId:run.w.id,osmNodes:[es[0].from,...es.map(e=>e.to)],refs:refs(run.w.tags),...extra,lanesEstimated:lane.estimated};
   if(lane.estimated)laneEstimates.push(id);
 }
 // Maintain original way order, and preserve single physical capacity
 // for shared A1/A61 carriageways. The A1 is the canonical legacy ref;
 // the complete signed ref list is retained as source metadata.
 for(const route of routes){
   const a=(options.anchors||ANCHORS).find(x=>x.direction===route.direction);
   const path=shortest(g,anchor(g,data,a.from,a.fromEnd),anchor(g,data,a.to,a.toEnd),isRing);
   for(const run of runs(path)){
     const ref=primary(run.segments[0]),sign=route.direction==="north";
     const label=ref==="A1"?(sign?"A1 → Dortmund / Köln":"A1 → Koblenz / Bliesheim"):(sign?"A61 → Nord / Venlo":"A61 → Süd / Koblenz");
     append(run,ref,"mainline",label,{direction:route.direction,shared:refs(run.w.tags).includes("A1")&&refs(run.w.tags).includes("A61")});
   }
 }
 const oldRampWays=new Set(data.roads.filter(r=>r[1]==="ramp").map(r=>Number(r[6])));
 for(const id of rampWays){
   if(oldRampWays.has(id))continue;
   const w=g.ways.get(id),j=rampLabels.get(id);
   for(const sign of [1,-1]){
     const path=g.all.filter(e=>e.w.id===id&&e.sign===sign).sort((a,b)=>sign*(a.i-b.i));if(!path.length)continue;
     const start=path[0].from,end=path.at(-1).to;
     const tag=j.kind==="AS"&&j.local?(publicNodes.has(start)?"Auffahrt":publicNodes.has(end)?"Abfahrt":"Rampenzweig"):"Überleitung";
     const label=j.kind==="AS"?j.ref+" AS "+j.number+" "+jname(j.name)+" · "+tag:j.kind+" "+jname(j.name)+" · Überleitung";
     append({w,sign,segments:path},j.ref,"ramp",label,{publicInterface:j.kind==="AS"&&j.local&&(publicNodes.has(start)||publicNodes.has(end))});
   }
 }
 const catalog=new Map(data.junctions.map(j=>[j[0]+":"+j[1],j]));
 // Group direction-specific exact OSM nodes under the same signed AS.
 for(const j of newJunctions){
   const k=j.ref+":"+j.number,p=g.nodes.get(j.node).p,old=catalog.get(k);
   if(old&&metres(old[3],p)>4000)fail("Conflicting junction "+k+" "+j.name);
   if(!old)catalog.set(k,[j.ref,j.number,j.name,p,[p]]);
   else if(!old[4]?.some(x=>key(x)===key(p)))catalog.set(k,[...old.slice(0,4),[...(old[4]||[old[3]]),p]]);
 }
 // Preserve verified public endpoints for the engine's local access gates.
 const boundary=new Map((data.localRampBoundaryNodes||[]).map(p=>[key(p),p]));
 for(const id of rampWays)for(const n of g.ways.get(id).nodes)if(publicNodes.has(n)){const p=g.nodes.get(n).p;boundary.set(key(p),p);}
 if(!options.synthetic){
   for(const name of ["Frechen","Gleuel","Hürth","Erfttal","Erftstadt","Bliesheim","Weilerswist","Heimerzheim","Miel","Rheinbach","Meckenheim"]){
     if(![...catalog.values()].some(j=>j[2].toLowerCase().includes(name.toLowerCase())))fail("Missing junction "+name);
   }
 }
 const result={...data,roads:[...data.roads,...roads],junctions:[...catalog.values()],localRampBoundaryNodes:[...boundary.values()],
   westRingAudit:{source:"OpenStreetMap contributors ODbL",routes,sharedWays:[...sharedWays],addedMainlines:roads.filter(r=>r[1]==="mainline").length,addedRamps:roads.filter(r=>r[1]==="ramp").length,lanesEstimated:laneEstimates,sourceWays:sourceAudit}};
 return result;
}
async function getOSM(){
 const boxes=[[50.88,6.75,50.95,6.90],[50.80,6.70,50.89,6.90],[50.70,6.74,50.82,6.99],[50.58,6.83,50.72,7.08]];
 const endpoints=["https://overpass-api.de/api/interpreter","https://overpass.kumi.systems/api/interpreter","https://overpass.private.coffee/api/interpreter"];
 const merged=new Map();
 for(const box of boxes){
   const bbox=box.join(",");
   const query='[out:json][timeout:90];(way["highway"="motorway"]('+bbox+');way["highway"="motorway_link"]('+bbox+');)->.m;.m out geom;node(w.m)["highway"]->.jn;.jn out body;node(w.m)->.rn;way(bn.rn)["highway"~"^(trunk|primary|secondary|tertiary|unclassified|residential|living_street|trunk_link|primary_link|secondary_link|tertiary_link)$"];out body;';
   let data=null;
   for(let i=0;i<endpoints.length*2;i++){
     try{
       const r=await fetch(endpoints[i%endpoints.length],{method:"POST",body:new URLSearchParams({data:query}),headers:{"User-Agent":"Stau-Simulator-Deutschland/1.0 (public OSM map data)"},signal:AbortSignal.timeout(120000)});
       if(!r.ok)throw Error("HTTP "+r.status);
       const j=await r.json();if(j.remark||!Array.isArray(j.elements)||!j.elements.length)throw Error(j.remark||"Empty response");data=j.elements;break;
     }catch(e){console.error("OSM retry",bbox,e.message);await new Promise(r=>setTimeout(r,2500));}
   }
   if(!data)fail("OSM fetch failed for "+bbox);
   for(const e of data){const k=e.type+":"+e.id;const old=merged.get(k);if(!old||e.geometry||!old.geometry)merged.set(k,e);}
   console.log("OSM tile",bbox,data.length);
 }
 return [...merged.values()];
}
async function main(){
 const input=process.argv.find(x=>x.startsWith("--snapshot="))?.slice(11);
 const legacy=decode(await readFile(FILE,"utf8"));
 if(legacy.westRingAudit){console.log("Western ring already present; refusing duplicate import");return;}
 const elements=input?JSON.parse(await readFile(input,"utf8")).elements:await getOSM();
 const result=extendWesternRing(legacy,elements);
 const tmp=FILE+".tmp";
 await writeFile(tmp,"/* OSM contributors, ODbL. Directed western ring appended by import-west-ring.mjs. */\nwindow.STAU_LEGACY_GEOMETRY="+JSON.stringify(result)+";\n");
 await rename(tmp,FILE);
 await writeFile("web/data/west-ring-audit.json",JSON.stringify(result.westRingAudit,null,2)+"\n");
 console.log("WESTERN RING VERIFIED",JSON.stringify({...result.westRingAudit,sourceWays:undefined}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{console.error(e);process.exitCode=1;});
