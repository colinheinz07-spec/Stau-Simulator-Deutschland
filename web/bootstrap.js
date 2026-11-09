/* Classic-script entry point for SPCK / local source previews.
 * Load production modules only when the generated build AND net manifest exist.
 */
(async()=>{
  const status=document.getElementById("map-status");
  async function preview(reason){
    console.info("OSM-Vorschau statt Build:",reason);
    try{
      if(typeof window.startLocalPreview!=="function")throw Error("OSM-Vorschau fehlt");
      await window.startLocalPreview();
    }catch(error){
      console.error(error);
      status.textContent="Karte konnte nicht initialisiert werden";
      const message=document.getElementById("map-message");
      message.hidden=false;
      message.textContent="Kartenstart fehlgeschlagen: "+error.message;
    }
  }
  if(location.protocol==="file:"){
    await preview("Lokale Datei ohne HTTP-Server");
    return;
  }
  try{
    const [compiled,network]=await Promise.all([
      fetch("./dist/06_Karte.js",{method:"HEAD",cache:"no-cache"}),
      fetch("./data/tiles/manifest.json",{cache:"no-cache"})
    ]);
    if(!compiled.ok||!network.ok)
      throw Error("Quellcode ohne erstellte dist-Module oder Netzdateien");
    await import("./app.js");
  }catch(error){await preview(error.message);}
})();
