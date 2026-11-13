import {motorwayMapEdges,assembleVisibleTiles,layoutJunctionLabels} from "./dist/06_Karte.js";
import {chooseMapTiles,createTileRepository,edgeSummary} from "./network-loader.js";
import {createTrafficScenario} from "./simulation-controller.js";
import {auditConnections} from "./dist/01_Strassennetz.js";

const $=id=>document.getElementById(id);
const status=$("map-status"),message=$("map-message");
const tileRepo=createTileRepository("./data/tiles/");
const state={
  manifest:null,network:null,selected:null,
  scenario:null,fullNetwork:null,simRunning:false,simTimer:null,
  visible:true,junctions:true,requestId:0
};
const COLOURS={free:"#24c688",slow:"#f2af4e",jam:"#df4a55",standstill:"#792341"};
const TEST_CENTER=[50.46,7.56], CORRIDOR_BOUNDS=[[50.155,6.86],[50.855,8.17]],
  GERMANY_BOUNDS=[[47.1,5.65],[55.15,15.35]];
const L=window.L;
if(!L){
  status.textContent="Kartendarstellung nicht geladen (Leaflet-Bibliothek fehlt).";
  message.hidden=false;
  message.textContent="Die Kartenbibliothek konnte nicht geladen werden. Verbindung prüfen.";
  throw Error("Leaflet is unavailable");
}

const map=L.map("map",{zoomControl:false,preferCanvas:true,attributionControl:true,
  wheelPxPerZoomLevel:70,minZoom:5,maxZoom:19}).fitBounds(CORRIDOR_BOUNDS,{padding:[16,16]});
L.control.zoom({position:"bottomright"}).addTo(map);
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png",{
  maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap-Mitwirkende</a>',
  crossOrigin:true,updateWhenIdle:true,keepBuffer:2
}).addTo(map);
window.__stauMap=map; // Share a constructed map with the OSM fallback on partial startup errors.
const roadsLayer=L.layerGroup().addTo(map);
const closedLayer=L.layerGroup().addTo(map);
const junctionLayer=L.layerGroup().addTo(map);
const incidentLayer=L.layerGroup().addTo(map);
const coverageLayer=L.layerGroup().addTo(map);
let viewportTimer=0;

const setStatus=(text)=>{status.textContent=text};
const setError=(text)=>{
  message.textContent=text;message.hidden=false;
  setStatus("Netz kann aktuell nicht angezeigt werden");
};
const hideError=()=>{message.hidden=true};

function updateButtons(){
  const germany=map.getZoom()<7;
  $("btn-germany").classList.toggle("selected",germany);
  $("btn-test-region").classList.toggle("selected",!germany);
}
function boundsToArray(bounds){
  return [bounds.getSouth(),bounds.getWest(),bounds.getNorth(),bounds.getEast()];
}
function abbreviateN(n){return new Intl.NumberFormat("de-DE").format(n)}
function showCounts(summary){
  $("chip-roads").textContent=abbreviateN(summary.roads)+" Fahrwege";
  $("chip-ramps").textContent=abbreviateN(summary.ramps)+" Rampen";
}
function coverageMark(){
  coverageLayer.clearLayers();
  if(!state.manifest)return;
  if(map.getZoom()>=10)return;
  const icon=L.divIcon({
    html:'<div class="coverage-marker"><b>● A3 / A48</b><small>OSM-Streckennetz</small></div>',
    className:"coverage-pin",iconSize:[0,0]
  });
  L.marker(TEST_CENTER,{icon,title:"OSM-Netz A3/A48 öffnen"})
    .on("click",()=>map.fitBounds(CORRIDOR_BOUNDS,{padding:[16,16]}))
    .addTo(coverageLayer);
}
function styling(edge){
  const zoom=map.getZoom(),ramp=edge.kind==="ramp";
  const base=Math.max(.85,Math.min(1.3,1+(zoom-12)*.06));
  return {
    casing:(ramp?5.6:8)*base,
    line:(ramp?3.5:5.3)*base,
    hit:(ramp?14:17)
  };
}
// Locate points by their original OSM geometry, never by arbitrary screen offsets.
function pointOnEdge(edge,offsetM){
  let left=Math.max(0,Math.min(edge.lengthM,offsetM));
  const line=edge.geometry;
  for(let i=1;i<line.length;i++){
    const a=line[i-1],b=line[i];
    const metres=map.distance(a,b);
    if(metres<=0)continue;
    if(left<=metres){
      const t=left/metres;
      return [a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];
    }
    left-=metres;
  }
  return line.at(-1);
}
// Clip congestion and closure overlays to the actual OSM metre interval.
const geometryCache=new WeakMap();
function measuresFor(edge){
  let lengths=geometryCache.get(edge);
  if(lengths)return lengths;
  const cumulative=[0],points=edge.geometry;
  for(let i=1;i<points.length;i++)
    cumulative.push(cumulative.at(-1)+map.distance(points[i-1],points[i]));
  lengths={cumulative,total:cumulative.at(-1)};
  geometryCache.set(edge,lengths);
  return lengths;
}
function sliceEdgeGeometry(edge,fromM,toM){
  const a=Math.max(0,Math.min(edge.lengthM,fromM));
  const b=Math.max(a,Math.min(edge.lengthM,toM));
  if(b-a<.1)return [];
  const points=edge.geometry,{cumulative,total}=measuresFor(edge);
  const k=edge.lengthM>0?total/edge.lengthM:0,lo=a*k,hi=b*k;
  function pointAt(m){
    for(let i=1;i<cumulative.length;i++){
      if(cumulative[i]<m)continue;
      const v=cumulative[i]-cumulative[i-1];
      const t=v>0?(m-cumulative[i-1])/v:0;
      const x=points[i-1],y=points[i];
      return [x[0]+(y[0]-x[0])*t,x[1]+(y[1]-x[1])*t];
    }
    return points.at(-1);
  }
  const result=[pointAt(lo)];
  for(let i=1;i<points.length-1;i++)
    if(cumulative[i]>lo+.01&&cumulative[i]<hi-.01)result.push(points[i]);
  result.push(pointAt(hi));
  return result;
}
function drawIncidentPins(rendered,byId){
  const drawn=new Map(rendered.map(item=>[item.edgeId,item]));
  const glyphs={closure:"⛔",roadworks:"🚧",accident:"💥",breakdown:"🚛"};
  const names={closure:"Vollsperrung",roadworks:"Baustelle",accident:"Unfall",breakdown:"Panne"};
  for(const {edgeId,kind} of state.scenario?.selectedEvents?.()??[]){
    const edge=byId.get(edgeId),item=drawn.get(edgeId);
    if(!edge||!item||map.getZoom()<8.1)continue;
    const glyph=glyphs[kind]??"⚠️";
    const icon=L.divIcon({className:"map-event-pin",
      html:'<span class="map-event-symbol">'+glyph+"</span>",
      iconSize:[28,28],iconAnchor:[14,14]});
    L.marker(pointOnEdge(edge,edge.lengthM/2),{icon,title:names[kind]??"Ereignis"})
      .on("click",()=>openDetails(edge,item)).addTo(incidentLayer);
  }
}
// An estimate from directed simulated edge speeds. No generic live-traffic
// claim: every queue has to contain actual simulated slowdown samples.
function drawJamCallouts(rendered,byId){
  if(map.getZoom()<8.5)return;
  const pieces=[],perEdge=new Map();
  for(const item of rendered){
    const edge=byId.get(item.edgeId);
    if(!edge)continue;
    const bands=[...(item.trafficBands??[])].filter(x=>x.colour!=="free")
      .sort((a,b)=>a.fromM-b.fromM);
    const row=[];
    for(const band of bands){
      const metres=band.toM-band.fromM;
      const delay=Math.max(0,(metres/1000)*60*
        (1/Math.max(5,band.speedKmh)-1/edge.freeSpeedKmh));
      const last=row.at(-1);
      if(last&&Math.abs(last.toM-band.fromM)<.1){
        last.toM=band.toM;last.lengthM+=metres;last.delayMin+=delay;
      }else{
        const part={index:pieces.length,edgeId:edge.id,
          fromM:band.fromM,toM:band.toM,lengthM:metres,delayMin:delay};
        pieces.push(part);row.push(part);
      }
    }
    if(row.length)perEdge.set(edge.id,row);
  }
  if(!pieces.length)return;
  const roots=pieces.map((_,i)=>i);
  const root=i=>{while(roots[i]!==i){roots[i]=roots[roots[i]];i=roots[i];}return i;};
  const out=new Map(),incoming=new Map();
  for(const move of state.network.movements){
    if(!move.allowed)continue;
    const from=out.get(move.incomingEdgeId)??new Set();
    from.add(move.outgoingEdgeId);out.set(move.incomingEdgeId,from);
    const to=incoming.get(move.outgoingEdgeId)??new Set();
    to.add(move.incomingEdgeId);incoming.set(move.outgoingEdgeId,to);
  }
  // Only a unique directed continuation can combine separate OSM Ways;
  // never join two queues through an ambiguous junction or lane fork.
  for(const [id,parts] of perEdge){
    const next=[...(out.get(id)??[])];
    if(next.length!==1||incoming.get(next[0])?.size!==1)continue;
    const target=perEdge.get(next[0]),edge=byId.get(id);
    if(!target||!edge)continue;
    const a=parts.at(-1),b=target[0];
    if(a.toM<edge.lengthM-.1||b.fromM>.1)continue;
    const ra=root(a.index),rb=root(b.index);
    if(ra!==rb)roots[rb]=ra;
  }
  const groups=new Map();
  for(const part of pieces){
    const id=root(part.index);
    const g=groups.get(id)??{lengthM:0,delayMin:0,longestM:0,anchor:null};
    g.lengthM+=part.lengthM;g.delayMin+=part.delayMin;
    if(part.lengthM>g.longestM){g.longestM=part.lengthM;g.anchor=part;}
    groups.set(id,g);
  }
  const boxes=[];
  for(const g of [...groups.values()].sort((a,b)=>b.delayMin-a.delayMin)){
    if(boxes.length>=7)break;
    if(g.lengthM<400||g.delayMin<.5||!g.anchor)continue;
    const edge=byId.get(g.anchor.edgeId);
    if(!edge)continue;
    const position=pointOnEdge(edge,(g.anchor.fromM+g.anchor.toM)/2);
    const pixel=map.latLngToContainerPoint(position);
    const rect={x:pixel.x-78,y:pixel.y-45,w:156,h:30};
    if(rect.x<6||rect.x+rect.w>map.getSize().x-6||rect.y<110||
       rect.y+rect.h>map.getSize().y-45)continue;
    if(boxes.some(b=>rect.x<b.x+b.w+6&&rect.x+rect.w>b.x-6&&
      rect.y<b.y+b.h+6&&rect.y+rect.h>b.y-6))continue;
    boxes.push(rect);
    const km=(g.lengthM/1000).toLocaleString("de-DE",{
      minimumFractionDigits:1,maximumFractionDigits:1});
    const extra=Math.max(1,Math.round(g.delayMin));
    const html='<span class="map-jam-label">≈ '+km+' km · +'+extra+' min</span>';
    L.marker(position,{
      icon:L.divIcon({className:"map-jam-pin",html,iconSize:[0,0]})
    }).addTo(incidentLayer);
  }
}
function drawNetwork(){
  roadsLayer.clearLayers();
  closedLayer.clearLayers();
  junctionLayer.clearLayers();
  incidentLayer.clearLayers();
  if(!state.visible||!state.network||map.getZoom()<7)return;
  // No fixed "red on incident" values: speeds are generated by cell occupancy.
  const samples=state.scenario?.speeds()??[];
  const events=state.scenario?.events()??[];
  const minute=(state.scenario?.stats().simSeconds??0)/60;
  const cells=state.scenario?.speedBands?.()??[];
  const rendered=motorwayMapEdges(state.network,samples,events,minute,[],cells);
  const byId=new Map(state.network.edges.map(e=>[e.id,e]));
  // Sort mainline below ramps: each OSM segment is rendered exactly once.
  rendered.sort((a,b)=>(a.kind==="ramp")-(b.kind==="ramp"));
  const slowOverlays=[],closureOverlays=[];
  for(const item of rendered){
    const edge=byId.get(item.edgeId);
    if(!edge||item.geometry.length<2)continue;
    const s=styling(item),latlngs=item.geometry;
    const lines={smoothFactor:0,noClip:false,lineCap:"round",lineJoin:"round",interactive:false};
    L.polyline(latlngs,{...lines,color:"#102338",weight:s.casing,opacity:.96})
      .addTo(roadsLayer);
    const base=L.polyline(latlngs,{...lines,color:COLOURS.free,
      weight:s.line,opacity:1,className:edge.kind==="ramp"?"map-network-ramp":"map-network-main"})
      .addTo(roadsLayer);
    const hit=L.polyline(latlngs,{...lines,color:"#000",opacity:0,weight:s.hit,
      interactive:true,bubblingMouseEvents:false}).addTo(roadsLayer);
    const click=()=>openDetails(edge,item);
    hit.on("click",click);base.on("click",click);
    for(const band of item.trafficBands){
      if(band.colour==="free")continue;
      const geometry=sliceEdgeGeometry(edge,band.fromM,band.toM);
      if(geometry.length>=2)slowOverlays.push({geometry,line:s.line,colour:COLOURS[band.colour]});
    }
    for(const band of item.closures){
      const geometry=sliceEdgeGeometry(edge,band.fromM,band.toM);
      if(geometry.length>=2)closureOverlays.push({geometry,line:s.line+1.7});
    }
  }
  // Never allow a later green ramp to cover a physically congested motorway.
  for(const band of slowOverlays)
    L.polyline(band.geometry,{color:band.colour,weight:band.line,
      lineCap:"round",lineJoin:"round",interactive:false,smoothFactor:0})
      .addTo(roadsLayer);
  for(const band of closureOverlays){
    const style={weight:band.line,dashArray:"12 10",lineCap:"butt",
      interactive:false,smoothFactor:0};
    L.polyline(band.geometry,{...style,color:"#d83c49"}).addTo(closedLayer);
    L.polyline(band.geometry,{...style,color:"#fff",dashOffset:"11"}).addTo(closedLayer);
  }
  // Explicit event icons remain distinct from congestion colors.
  drawIncidentPins(rendered,byId);
  drawJamCallouts(rendered,byId);
  if(state.junctions&&map.getZoom()>=12){
    const size=map.getSize();
    // Carry over old simulator's label-collision safeguards. The OSM
    // coordinate remains untouched; only overlapping TEXT is hidden.
    const labels=layoutJunctionLabels(state.network.nodes,point=>{
      const pixel=map.latLngToContainerPoint(point);
      return {x:pixel.x,y:pixel.y};
    },{
      width:size.x,height:size.y,maxLabels:120,
      reserved:[
        {x:0,y:0,width:Math.min(375,size.x*.78),height:100},
        {x:Math.max(0,size.x-95),y:0,width:95,height:160},
        {x:0,y:Math.max(0,size.y-(window.innerWidth<=850?64:82)),
          width:size.x,height:window.innerWidth<=850?64:82}
      ]
    });
    for(const placed of labels){
      const tooltipText=document.createElement("span");
      tooltipText.textContent=placed.label; // OSM label: safe text, not HTML.
      const anchor=map.latLngToContainerPoint(placed.position);
      const x=placed.box.x+placed.box.width/2-anchor.x;
      const y=placed.box.y+placed.box.height-anchor.y;
      L.circleMarker(placed.position,{radius:2.5,weight:1,color:"#fff",
        fillColor:"#16374a",fillOpacity:.95,interactive:false}).bindTooltip(tooltipText,{
          permanent:true,direction:"center",className:"junction-label",offset:[x,y]
        }).addTo(junctionLayer);
    }
  }
}
function openDetails(edge,item){
  state.selected=edge;
  $("detail-heading").textContent=edge.motorwayRef??edge.motorwayRefs?.join(" / ")??
    (edge.kind==="ramp"?"Autobahnrampe":"Autobahnabschnitt");
  $("detail-type").textContent=edge.kind==="ramp"?"Auf-/Abfahrt oder Überleitung":"Autobahn-Hauptfahrbahn";
  $("detail-lanes").textContent=edge.lanes+" Spur"+(edge.lanes===1?"":"en");
  $("detail-length").textContent=edge.lengthM<1000?Math.round(edge.lengthM)+" m":
    (edge.lengthM/1000).toLocaleString("de-DE",{maximumFractionDigits:2})+" km";
  $("detail-speed").textContent=Math.round(item.speedKmh)+" km/h · "+(item.source==="model"?"Testwert":"Modellannahme");
  $("detail-osm").textContent=edge.osmWayIds.map(String).join(", ");
  const selectedMode=state.scenario?.mode(edge.id)??"none";
  for(const button of document.querySelectorAll("[data-event]"))
    button.classList.toggle("selected",button.dataset.event===selectedMode);
  $("detail-drawer").classList.add("open");
  $("detail-drawer").setAttribute("aria-hidden","false");
  $("drawer-backdrop").hidden=false;
}
function closeDrawer(){
  $("detail-drawer").classList.remove("open");
  $("detail-drawer").setAttribute("aria-hidden","true");
  $("drawer-backdrop").hidden=true;
}
function updateMapDisplay(){
  drawNetwork();
  coverageMark();
}
async function updateViewport(){
  const request=++state.requestId;
  updateButtons();
  coverageMark();
  if(!state.manifest){return}
  if(map.getZoom()<7){
    state.network=null;
    roadsLayer.clearLayers();closedLayer.clearLayers();junctionLayer.clearLayers();
    showCounts({roads:0,ramps:0});
    setStatus("Deutschlandkarte · A3/A48 mit Schaltfläche auswählen");
    hideError();return;
  }
  try{
    const bounds=boundsToArray(map.getBounds().pad(.25));
    const chosen=chooseMapTiles(state.manifest,bounds,map.getZoom(),80);
    if(!chosen.length){
      state.network=null;roadsLayer.clearLayers();closedLayer.clearLayers();
      junctionLayer.clearLayers();showCounts({roads:0,ramps:0});
      setStatus("Noch keine importierten Simulationsstrecken in diesem Gebiet");
      hideError();return;
    }
    setStatus(chosen.length+" Netzkachel"+(chosen.length===1?"":"n")+" werden geladen …");
    const tiles=await Promise.all(chosen.map(tileRepo.getTile));
    if(request!==state.requestId)return;
    const assembled=assembleVisibleTiles(tiles);
    state.network=assembled.network;
    const counts=edgeSummary(tiles);
    showCounts(counts);
    const unresolved=assembled.pendingEdgeIds.length;
    setStatus(abbreviateN(counts.roads)+" OSM-Fahrwege · "+
      (unresolved?unresolved+" Anschlüsse außerhalb der geladenen Kacheln":"geladen"));
    hideError();
    drawNetwork();
  }catch(error){
    if(request!==state.requestId)return;
    state.network=null;
    roadsLayer.clearLayers();closedLayer.clearLayers();junctionLayer.clearLayers();
    showCounts({roads:0,ramps:0});
    setError("Netzdaten konnten nicht geladen werden: "+error.message);
  }
}
function queueViewport(){
  clearTimeout(viewportTimer);
  viewportTimer=setTimeout(updateViewport,150);
}
map.on("moveend zoomend",queueViewport);
$("btn-germany").addEventListener("click",()=>{closeDrawer();map.fitBounds(GERMANY_BOUNDS,{padding:[18,18]})});
$("btn-test-region").addEventListener("click",()=>{closeDrawer();map.fitBounds(CORRIDOR_BOUNDS,{padding:[16,16]})});
$("toggle-network").addEventListener("change",e=>{
  state.visible=e.target.checked;updateMapDisplay();
});
$("toggle-junctions").addEventListener("change",e=>{
  state.junctions=e.target.checked;updateMapDisplay();
});
function updateSimStats(){
  const p=state.scenario?.stats();
  if(!p)return;
  const sec=Math.floor(p.simSeconds);
  const mm=Math.floor(sec/60),ss=sec%60;
  $("sim-clock").textContent=mm+":"+String(ss).padStart(2,"0");
  $("sim-vehicles").textContent=Math.round(p.vehiclesOnNetwork).toLocaleString("de-DE");
  $("sim-outside").textContent=Math.round(p.waitingOutsideSources).toLocaleString("de-DE");
  const calendar=window.StauEventSchedule;
  const time=state.scenario?.clockMs?.();
  if(calendar&&Number.isFinite(time))
    $("sim-model-date").textContent="Modell-Datum: "+
      calendar.localDateTime(time).replace("T"," ")+" Uhr";
}
function stopSimulation(){
  if(state.simTimer!==null)clearInterval(state.simTimer);
  state.simTimer=null;
  state.simRunning=false;
  $("sim-toggle").textContent="▶ Simulation starten";
  $("sim-toggle").classList.remove("running");
}
function runStep(){
  if(!state.scenario)return;
  try{
    const p=state.scenario.advance(30); // 60 seconds simulated / real second
    updateSimStats();
    drawNetwork();
    const currentTime=Math.floor(p.simSeconds/60);
    setStatus("Modellszenario: "+currentTime+" Min. · "+
      Math.round(p.vehiclesOnNetwork).toLocaleString("de-DE")+
      " Fahrzeuge im Straßennetz");
  }catch(err){
    stopSimulation();
    setError("Simulation gestoppt: "+err.message);
  }
}
function startSimulation(){
  if(!state.scenario){
    setStatus("Zuerst echte A3/A48-Daten laden");
    return;
  }
  if(state.simRunning)return;
  state.simRunning=true;
  $("sim-toggle").textContent="Ⅱ Simulation anhalten";
  $("sim-toggle").classList.add("running");
  state.simTimer=setInterval(runStep,1000);
  runStep();
}
$("sim-toggle").addEventListener("click",()=>{
  if(state.simRunning)stopSimulation();else startSimulation();
});
$("sim-demand").addEventListener("input",e=>{
  const pct=Number(e.target.value);
  $("sim-demand-value").textContent=pct+" %";
  state.scenario?.setDemandPercent(pct);
});
function applySimulationStart(){
  const field=$("sim-start");
  if(!field?.value||!state.scenario?.setSimulationStart)return;
  const date=field.value;
  const calendar=window.StauEventSchedule;
  const time=calendar?.localInstant?
    calendar.localInstant(date.slice(0,10),date.slice(11,16)):
    new Date(date).getTime();
  if(!Number.isFinite(time))throw Error("Ungültiger Simulationsbeginn");
  stopSimulation();
  state.scenario.setSimulationStart(time);
  updateSimStats();drawNetwork();
}
$("sim-start").addEventListener("change",()=>{
  try{applySimulationStart()}catch(error){setError(error.message);}
});
$("sim-reset").addEventListener("click",()=>{
  stopSimulation();
  state.scenario?.reset();
  updateSimStats();drawNetwork();
  setStatus("Modell zurückgesetzt · noch keine Fahrzeuge erzeugt");
});
$("reset-events").addEventListener("click",()=>{
  stopSimulation();
  state.scenario?.reset();
  closeDrawer();updateSimStats();updateMapDisplay();
  setStatus("Ereignisse und Fahrzeuge zurückgesetzt");
});
for(const button of document.querySelectorAll("[data-event]")){
  button.addEventListener("click",()=>{
    if(!state.selected||!state.scenario)return;
    try{
      state.scenario.setMode(state.selected.id,button.dataset.event);
      const warning=state.scenario.warnings()[0];
      closeDrawer();
      updateMapDisplay();
      if(warning)setStatus(warning);
      else setStatus("Ereignis gesetzt: "+(button.dataset.event??"")+
        " · Kapazität statt Fantasie-Staufarbe verändert");
      if(button.dataset.event!=="none")startSimulation();
    }catch(err){setError("Ereignis konnte nicht gesetzt werden: "+err.message)}
  });
}
$("close-drawer").addEventListener("click",closeDrawer);
$("drawer-backdrop").addEventListener("click",closeDrawer);
document.addEventListener("keydown",e=>{if(e.key==="Escape")closeDrawer()});
async function init(){
  try{
    const response=await fetch("./data/tiles/manifest.json",{cache:"no-cache"});
    if(!response.ok)throw Error("Manifest nicht gefunden (HTTP "+response.status+")");
    const manifest=await response.json();
    if(manifest.schemaVersion!==1||!Array.isArray(manifest.tiles))throw Error("Ungültiges Netzmanifest");
    state.manifest=manifest;
    $("coverage").querySelector("b").textContent="A3 Limburg-Nord – Siegburg · A48 Vulkaneifel – Dernbach";
    setStatus("Gerichtetes A3/A48-Netz wird für die Simulation geladen …");
    // Use the COMPLETE corridor graph. Simulating only viewport tiles would
    // silently delete cars at map borders and prevent real cross-ramp queues.
    const tiles=await Promise.all(manifest.tiles.map(tileRepo.getTile));
    const assembled=assembleVisibleTiles(tiles);
    if(assembled.pendingEdgeIds.length||assembled.pendingRouteRestrictions.length)
      throw Error("Unvollständige OSM-Fahrbeziehungen beim Zusammenführen der Kartendaten");
    state.fullNetwork=assembled.network;
    const audit=auditConnections(state.fullNetwork);
    if(audit.invalidMovements.length)
      throw Error("Ungültige gerichtete OSM-Fahrbeziehungen: "+audit.invalidMovements.length);
    state.scenario=createTrafficScenario(state.fullNetwork);
    const calendar=window.StauEventSchedule;
    if(calendar) $("sim-start").value=calendar.localDateTime(Date.now());
    applySimulationStart();
    updateSimStats();
    await updateViewport();
    setStatus("A3/A48: "+audit.motorwayMainlineCount+
      " Hauptfahrbahnen, "+audit.motorwayRampCount+
      " Rampen · räumliches Verkehrsmodell startbereit");
  }catch(error){
    console.warn("Importiertes A3/A48-Netz nicht verfügbar; OSM-Vorschau statt leerer Karte:",error);
    try{
      if(typeof window.startLegacyFallback!=="function")throw Error("Lokale Canvas-Karte fehlt");
      await window.startLegacyFallback(map);
    }catch(previewError){
      setError("Die Autobahn-Kartendaten fehlen. Der Deutschland-Import muss zuerst veröffentlicht werden. "+
        error.message+"; OSM-Vorschau: "+previewError.message);
    }
  }
}
init();
