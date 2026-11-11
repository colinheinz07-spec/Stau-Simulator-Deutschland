/* Mobile controls use vertical scrolling; the map gets its own space.
 * Also works in SPCK local file previews without bundlers or Leaflet. */
(function(){
  "use strict";
  const sidebar=document.querySelector(".sidebar");
  const button=document.getElementById("mobile-panel-toggle");
  const hint=document.getElementById("mobile-panel-hint");
  const chevron=document.getElementById("mobile-panel-chevron");
  if(!sidebar||!button||!hint||!chevron)return;

  function updateMapSize(){
    const map=window.__stauMap;
    if(map&&typeof map.invalidateSize==="function")
      map.invalidateSize({pan:false});
    // The offline Canvas map responds to the ResizeObserver of #map.
  }
  function setExpanded(expanded){
    sidebar.classList.toggle("is-collapsed",!expanded);
    button.setAttribute("aria-expanded",String(expanded));
    button.setAttribute("aria-label",expanded?"Steuerung einklappen":"Steuerung öffnen");
    hint.textContent=expanded?"Nach oben wischen für weitere Einstellungen":"Antippen, um die Steuerung zu öffnen";
    chevron.textContent=expanded?"⌄":"⌃";
    if(!expanded)sidebar.scrollTop=0;
    if(typeof window.requestAnimationFrame==="function")
      window.requestAnimationFrame(updateMapSize);
    else updateMapSize();
  }
  button.addEventListener("click",()=>setExpanded(sidebar.classList.contains("is-collapsed")));
})();
