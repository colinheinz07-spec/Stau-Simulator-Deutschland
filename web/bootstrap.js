/* SPCK boots from plain local files. Avoid module imports, Overpass, or Leaflet
 * until a compiled network build is actually present on an HTTP server.
 */
(function(){
"use strict";
const status=document.getElementById("map-status");
function loadScript(src){
  return new Promise((resolve,reject)=>{
    const element=document.createElement("script");
    element.src=src;
    element.onload=resolve;
    element.onerror=()=>reject(Error("Skript fehlt: "+src));
    document.head.append(element);
  });
}
function loadStyle(href){
  return new Promise((resolve,reject)=>{
    const element=document.createElement("link");
    element.rel="stylesheet";
    element.href=href;
    element.onload=resolve;
    element.onerror=()=>reject(Error("Kartenstil fehlt: "+href));
    document.head.append(element);
  });
}
window.startLegacyFallback=async function(existingMap=null){
  if(!window.STAU_LEGACY_GEOMETRY)
    await loadScript("./legacy-geometry.js");
  if(!window.StauEventSchedule)
    await loadScript("./event-schedule.js");
  if(!window.StauTrafficReference)
    await loadScript("./traffic-reference.js");
  if(typeof window.createLegacyTrafficScenario!=="function")
    await loadScript("./offline-traffic.js");
  if(typeof window.createOfflineEventEditor!=="function")
    await loadScript("./offline-event-editor.js");
  if(typeof window.startLegacyCanvas!=="function")
    await loadScript("./legacy-canvas.js");
  await window.startLegacyCanvas(existingMap);
};
async function run(){
  if(location.protocol==="file:"){
    try{await window.startLegacyFallback();}
    catch(error){fail(error);}
    return;
  }
  try{
    const [modules,manifest]=await Promise.all([
      fetch("./dist/06_Karte.js",{method:"HEAD",cache:"no-cache"}),
      fetch("./data/tiles/manifest.json",{cache:"no-cache"})
    ]);
    if(!modules.ok||!manifest.ok)
      throw Error("Gebautes Netzpaket fehlt – lokale Karte verwenden");
    const json=await manifest.json();
    if(!Array.isArray(json.tiles)||!json.tiles.length)
      throw Error("Netzmanifest ist leer");
    await Promise.all([
      loadStyle("https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"),
      loadScript("https://unpkg.com/leaflet@1.9.4/dist/leaflet.js")
    ]);
    await import("./app.js");
  }catch(error){
    console.warn("Starte lokale Canvas-Karte:",error);
    try{await window.startLegacyFallback(window.__stauMap||null);}
    catch(other){fail(other);}
  }
}
function fail(error){
  console.error(error);
  if(status)status.textContent="Kartendarstellung nicht verfügbar";
  const message=document.getElementById("map-message");
  if(message){
    message.hidden=false;
    message.textContent="Die lokale Karte konnte nicht geladen werden: "+error.message;
  }
}
run();
})();
