/* Standalone, read-only OSM map for SPCK/source previews.
 * Never invent geometry or activate a traffic simulation without verified data.
 * Production map modules and tiles remain the primary implementation.
 */
const CORRIDOR=[[50.155,6.86],[50.855,8.17]];
const COUNTRY=[[47.1,5.65],[55.15,15.35]];
const $=id=>document.getElementById(id);

export async function startLocalPreview(existingMap=null){
  const status=$("map-status"), message=$("map-message");
  const setStatus=text=>{if(status)status.textContent=text;};
  const setError=text=>{
    if(message){message.hidden=false;message.textContent=text;}
    setStatus("OSM-Vorschau: Streckendaten nicht verfügbar");
  };
  if(!window.L){
    setError("Die Kartenbibliothek konnte nicht geladen werden. Für die Kartenansicht wird eine Internetverbindung benötigt.");
    return;
  }

  const L=window.L;
  const map=existingMap||L.map("map",{zoomControl:false,preferCanvas:true,
    attributionControl:true,minZoom:5,maxZoom:19}).fitBounds(CORRIDOR,{padding:[16,16]});
  if(!existingMap){
    L.control.zoom({position:"bottomright"}).addTo(map);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png",{
      maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap-Mitwirkende</a>'
    }).addTo(map);
  }
  document.body.classList.add("preview-only");
  const coverage=$("coverage");
  if(coverage){
    coverage.querySelector("b").textContent="A3 / A48 · echte OpenStreetMap-Straßen";
    const note=coverage.querySelector("small");
    if(note)note.textContent="Quellcode-Vorschau · keine berechneten Verkehrsdaten";
  }
  $("map-bottom-info").querySelector("strong").textContent="Tippe auf einen grünen Autobahnabschnitt";
  $("map-bottom-info").querySelector("span").textContent=
    "OSM-Vorschau. Für Ereignisse und Simulation wird das gebaute Kartenpaket benötigt.";
  const overlay=L.layerGroup().addTo(map);
  let showRoads=true,showJunctions=true,roadLines=[],loaded=false;
  const setCounts=(roads,ramps)=>{
    $("chip-roads").textContent=roads.toLocaleString("de-DE")+" Fahrwege";
    $("chip-ramps").textContent=ramps.toLocaleString("de-DE")+" Rampen";
  };
  const draw=()=>{
    overlay.clearLayers();
    if(!showRoads)return;
    for(const {line,kind,tags,id} of roadLines){
      const ramp=kind==="motorway_link";
      const path=L.polyline(line,{color:"#102638",weight:ramp?6:9,opacity:.92}).addTo(overlay);
      L.polyline(line,{color:"#22bd80",weight:ramp?3.2:5.7,opacity:.95})
        .bindPopup(
          `<strong>${escapeHtml(tags.ref|| (ramp?"Autobahnrampe":"Autobahn"))}</strong><br>`+
          `Original OSM-Way ${id}<br>`+
          `Fahrstreifen: ${escapeHtml(tags.lanes||"nicht angegeben")}<br>`+
          "<small>Nur Kartenansicht – keine simulierten Geschwindigkeiten</small>"
        ).addTo(overlay);
      path.bringToBack();
    }
  };
  $("btn-germany").addEventListener("click",()=>map.fitBounds(COUNTRY,{padding:[18,18]}));
  $("btn-test-region").addEventListener("click",()=>map.fitBounds(CORRIDOR,{padding:[16,16]}));
  $("toggle-network").addEventListener("change",e=>{showRoads=e.target.checked;draw();});
  $("toggle-junctions").addEventListener("change",e=>{showJunctions=e.target.checked;});
  for(const id of ["sim-toggle","sim-reset","reset-events","sim-demand"]){
    const element=$(id);
    if(element)element.disabled=true;
  }
  map.on("zoomend",()=>{
    $("btn-germany").classList.toggle("selected",map.getZoom()<7);
    $("btn-test-region").classList.toggle("selected",map.getZoom()>=7);
  });
  setCounts(0,0);
  setStatus("OpenStreetMap wird angezeigt · echte Autobahnlinien werden geladen …");
  requestAnimationFrame(()=>map.invalidateSize());

  // Overpass returns original OSM coordinates; failed requests do not fabricate roads.
  const query='[out:json][timeout:40];way["highway"~"^(motorway|motorway_link)$"](50.10,6.82,50.88,8.25);out geom;';
  const services=[
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter"
  ];
  for(const url of services){
    try{
      const controller=new AbortController();
      const timer=setTimeout(()=>controller.abort(),48000);
      let response;
      try{
        response=await fetch(url,{method:"POST",body:new URLSearchParams({data:query}),
          signal:controller.signal});
      }finally{clearTimeout(timer);}
      if(!response.ok)throw Error("HTTP "+response.status);
      const raw=await response.json();
      if(!Array.isArray(raw.elements))throw Error("ungültige OSM-Antwort");
      roadLines=raw.elements.filter(item=>item.type==="way"&&
        Array.isArray(item.geometry)&&item.geometry.length>=2).map(item=>({
          id:item.id,tags:item.tags||{},kind:item.tags?.highway,
          line:item.geometry.map(p=>[p.lat,p.lon])
        }));
      if(!roadLines.length)throw Error("keine Autobahnabschnitte empfangen");
      loaded=true;
      const ramps=roadLines.filter(x=>x.kind==="motorway_link").length;
      setCounts(roadLines.length,ramps);
      draw();
      if(message)message.hidden=true;
      setStatus(roadLines.length.toLocaleString("de-DE")+
        " echte OSM-Fahrwege geladen · reine Kartenvorschau");
      return;
    }catch(error){console.warn("OSM-Vorschau",url,error);}
  }
  if(!loaded){
    setError("Die Hintergrundkarte ist verfügbar, aber die echten grünen Autobahnlinien konnten nicht von OpenStreetMap/Overpass geladen werden. Internetverbindung prüfen oder die veröffentlichte Karten-Version verwenden.");
  }
}

function escapeHtml(value){
  return String(value).replace(/[&<>"']/g,char=>({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  })[char]);
}
