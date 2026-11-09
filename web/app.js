import {motorwayMapEdges,assembleVisibleTiles} from "./dist/06_Karte.js";
import {chooseMapTiles,createTileRepository,edgeSummary} from "./network-loader.js";

const $=id=>document.getElementById(id);
const status=$("map-status"),message=$("map-message");
const tileRepo=createTileRepository("./data/tiles/");
const state={
  manifest:null,network:null,selected:null,
  demo:new Map(),visible:true,junctions:true,requestId:0
};
const COLOURS={free:"#24c688",slow:"#f2af4e",jam:"#df4a55",standstill:"#792341"};
const TEST_CENTER=[53.081,8.924], GERMANY_BOUNDS=[[47.1,5.65],[55.15,15.35]];
const L=window.L;
if(!L){
  status.textContent="Kartendarstellung nicht geladen (Leaflet-Bibliothek fehlt).";
  message.hidden=false;
  message.textContent="Die Kartenbibliothek konnte nicht geladen werden. Verbindung prüfen.";
  throw Error("Leaflet is unavailable");
}

const map=L.map("map",{zoomControl:false,preferCanvas:true,attributionControl:true,
  wheelPxPerZoomLevel:70,minZoom:5,maxZoom:19}).setView(TEST_CENTER,11);
L.control.zoom({position:"bottomright"}).addTo(map);
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png",{
  maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap-Mitwirkende</a>',
  crossOrigin:true,updateWhenIdle:true,keepBuffer:2
}).addTo(map);
const roadsLayer=L.layerGroup().addTo(map);
const closedLayer=L.layerGroup().addTo(map);
const junctionLayer=L.layerGroup().addTo(map);
const coverageLayer=L.layerGroup().addTo(map);
let viewportTimer=0;
let loading=false;

const setStatus=(text)=>{status.textContent=text};
const setError=(text)=>{
  message.textContent=text;message.hidden=false;
  setStatus("Netz kann aktuell nicht angezeigt werden");
};
const hideError=()=>{message.hidden=true};

function updateButtons(){
  const germany=map.getZoom()<9;
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
    html:'<div class="coverage-marker"><b>● Bremen</b><small>Geprüftes Testnetz</small></div>',
    className:"coverage-pin",iconSize:[0,0]
  });
  L.marker(TEST_CENTER,{icon,title:"OSM-Testnetz Bremen öffnen"})
    .on("click",()=>map.flyTo(TEST_CENTER,11,{duration:.7}))
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
function drawNetwork(){
  roadsLayer.clearLayers();
  closedLayer.clearLayers();
  junctionLayer.clearLayers();
  if(!state.visible||!state.network||map.getZoom()<9)return;
  const samples=[];
  const events=[];
  for(const edge of state.network.edges){
    const mode=state.demo.get(edge.id);
    if(mode==="slow")samples.push({edgeId:edge.id,speedKmh:43,atMinute:0});
    if(mode==="jam")samples.push({edgeId:edge.id,speedKmh:15,atMinute:0});
    if(mode==="closure")events.push({
      id:"demo-"+edge.id,edgeId:edge.id,kind:"closure",fromM:0,
      toM:edge.lengthM,closedLanes:Array.from({length:edge.lanes},(_,i)=>i),startMinute:0
    });
  }
  const rendered=motorwayMapEdges(state.network,samples,events,0);
  const byId=new Map(state.network.edges.map(e=>[e.id,e]));
  // Sort mainline below ramps: each OSM segment is rendered exactly once.
  rendered.sort((a,b)=>(a.kind==="ramp")-(b.kind==="ramp"));
  for(const item of rendered){
    const edge=byId.get(item.edgeId);
    if(!edge||item.geometry.length<2)continue;
    const s=styling(item),latlngs=item.geometry;
    const lines={smoothFactor:0,noClip:false,lineCap:"round",lineJoin:"round",interactive:false};
    L.polyline(latlngs,{...lines,color:"#102338",weight:s.casing,opacity:.96})
      .addTo(roadsLayer);
    const colour=L.polyline(latlngs,{...lines,color:COLOURS[item.colour],
      weight:s.line,opacity:1,className:edge.kind==="ramp"?"map-network-ramp":"map-network-main"})
      .addTo(roadsLayer);
    // The transparent, wider target is easier to select on phones.
    const hit=L.polyline(latlngs,{...lines,color:"#000",opacity:0,weight:s.hit,
      interactive:true,bubblingMouseEvents:false}).addTo(roadsLayer);
    const click=()=>openDetails(edge,item);
    hit.on("click",click);
    colour.on("click",click);
    if(item.closures.length){
      // The UI demo only closes a full RoadEdge. For real partial events,
      // we will split the exact geometry by metres in a later interface.
      L.polyline(latlngs,{...lines,color:"#d83c49",weight:s.line+1.7,
        dashArray:"12 10",lineCap:"butt"}).addTo(closedLayer);
      L.polyline(latlngs,{...lines,color:"#fff",weight:s.line+1.7,
        dashArray:"12 10",dashOffset:"11",lineCap:"butt"}).addTo(closedLayer);
    }
  }
  if(state.junctions&&map.getZoom()>=12){
    let shown=0;
    for(const node of state.network.nodes){
      if(!node.junctionName&&!node.junctionRef)continue;
      if(shown>=120)break;
      const name=[node.junctionRef,node.junctionName].filter(Boolean).join(" · ");
      L.circleMarker(node.point,{radius:3,weight:1,color:"#fff",fillColor:"#16374a",
        fillOpacity:.95,interactive:false}).bindTooltip(document.createTextNode(name).textContent,{
          permanent:true,direction:"top",className:"junction-label",offset:[0,-4]
        }).addTo(junctionLayer);
      shown++;
    }
  }
}
function renderDefaultDetails(){
  $("map-bottom-info").hidden=false;
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
  const selectedMode=state.demo.get(edge.id)??"none";
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
  if(map.getZoom()<9){
    state.network=null;
    roadsLayer.clearLayers();closedLayer.clearLayers();junctionLayer.clearLayers();
    showCounts({roads:0,ramps:0});
    setStatus("Deutschlandkarte · für Simulationsstrecken hineinzoomen");
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
    setStatus(abbreviateN(counts.roads)+" geprüfte Strecken · "+
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
$("btn-test-region").addEventListener("click",()=>{closeDrawer();map.flyTo(TEST_CENTER,11,{duration:.7})});
$("toggle-network").addEventListener("change",e=>{
  state.visible=e.target.checked;updateMapDisplay();
});
$("toggle-junctions").addEventListener("change",e=>{
  state.junctions=e.target.checked;updateMapDisplay();
});
$("reset-events").addEventListener("click",()=>{
  state.demo.clear();closeDrawer();updateMapDisplay();setStatus("Alle Demonstrationen zurückgesetzt");
});
for(const button of document.querySelectorAll("[data-event]")){
  button.addEventListener("click",()=>{
    if(!state.selected)return;
    if(button.dataset.event==="none")state.demo.delete(state.selected.id);
    else state.demo.set(state.selected.id,button.dataset.event);
    closeDrawer();updateMapDisplay();
    setStatus("Nur Testdarstellung – keine tatsächlichen Staudaten");
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
    $("coverage").querySelector("b").textContent="Echtes Testnetz: Bremen";
    await updateViewport();
  }catch(error){
    setError("Die Autobahn-Kartendaten fehlen. Der Deutschland-Import muss zuerst veröffentlicht werden. "+error.message);
  }
}
init();
