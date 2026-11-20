/* Shared presentation only: uses the simulator's actual queue summaries in
 * the offline Canvas and online Leaflet views. No traffic calculation here. */
(function(){
  "use strict";
  const $=id=>document.getElementById(id);
  const directionNames={
    "A3-koeln":"Köln","A3-frankfurt":"Frankfurt",
    "A48-dernbach":"Dernbach","A48-koblenz":"Koblenz",
    "extra-a4-aachen":"Aachen","extra-a4-olpe":"Olpe",
    "extra-a59-koeln":"Köln","extra-a59-bonn":"Bonn",
    "extra-a559-gremberg":"Gremberg","extra-a559-porz":"Porz",
    "extra-a560-bonn":"Bonn","extra-a560-hennef":"Hennef",
    "extra-a562-bonn":"Bonn","extra-a562-bonn-ost":"Bonn-Ost",
    "extra-a555-koeln":"Köln","extra-a555-bonn":"Bonn",
    "extra-a1-dortmund":"Dortmund","extra-a1-koblenz":"Koblenz",
    "extra-a61-nord":"Norden","extra-a61-sued":"Süden",
    "extra-a565-nord":"Norden","extra-a565-sued":"Süden"
  };
  function describeJam(group,road={}){
    const speed=Number(group.meanKmh??group.worstKmh),known=Number.isFinite(speed);
    // A queue can contain one stopped cell and kilometres of moving traffic.
    // The overall label matches its displayed average, not its minimum.
    const severity=!known?"jam":speed<=10?"standstill":speed<=30?"jam":"slow";
    const states={slow:["Stockender Verkehr","#efae47"],jam:["Stau / Stop-and-Go","#e34f56"],standstill:["Stillstand / Kriechverkehr","#a85169"]};
    const [state,color]=states[severity];
    const signedDestination=road.kind==="ramp"&&road.name?.includes("→")?road.name.split("→").at(-1).trim():null;
    const destination=signedDestination||directionNames[road.direction];
    const title=(road.ref||"Autobahn")+(destination?" Richtung "+destination:"");
    const km=(Math.max(0,Number(group.lengthM)||0)/1000).toLocaleString("de-DE",{minimumFractionDigits:1,maximumFractionDigits:1});
    const delay=Number.isFinite(group.delayMin)?Math.max(1,Math.round(group.delayMin)):null;
    const delayText=delay===null?null:(group.delayLowerBound?"≥ ":"")+"+"+
      (delay>=120?Math.floor(delay/60)+" h"+(delay%60?" "+delay%60+" min":""):delay+" min");
    return {title,destination,bottleneck:road.bottleneck,location:road.location||road.name||(road.kind==="ramp"?"Auf-/Abfahrt oder Überleitung":"Autobahnabschnitt"),
      ref:road.ref||"Autobahn",severity,state,color,length:km+" km",
      delay:delayText??"Nicht berechenbar",
      shortDelay:delayText??"Zeit offen",
      speed:known?(group.delayLowerBound?"≤ ":"")+Math.round(speed)+" km/h":"–"};
  }
  function renderJams(groups,roadFor,focus){
    const list=$("jam-list"),count=$("jam-count");
    if(!list||!count)return;
    const sorted=[...groups].sort((a,b)=>b.delayMin-a.delayMin);
    count.textContent=String(sorted.length);
    const key=JSON.stringify(sorted.map(g=>[g.edgeId,Math.round(g.offsetM),g.startEdgeId,g.endEdgeId,g.startOffsetM,g.endOffsetM,Math.round(g.lengthM/100),g.delayMin===null?null:Math.round(g.delayMin),g.delayLowerBound,Math.round(g.meanKmh??g.worstKmh),Math.round(g.worstKmh),g.worstKmh<=10?0:g.worstKmh<=30?1:2]));
    if(list.dataset.signature===key)return;
    list.dataset.signature=key;
    list.replaceChildren();
    const el=(tag,cls,value)=>{const e=document.createElement(tag);e.className=cls;if(value!==undefined)e.textContent=value;return e;};
    if(!sorted.length){
      list.append(el("p","empty-state","Keine Rückstaus im Modell."));
      return;
    }
    for(const g of sorted){
      const view=describeJam(g,roadFor(g.edgeId,g.offsetM,g)||{});
      const card=el("button","jam-card");
      card.type="button";card.style.setProperty("--severity",view.color);
      card.dataset.trafficState=view.severity;
      card.setAttribute("aria-label",view.title+", "+view.location+", "+view.length+", "+view.delay+", auf Karte anzeigen");
      const header=el("div","jam-card-header"),heading=el("div","jam-card-heading");
      heading.append(el("strong","",view.title),el("span","",view.location));
      if(view.bottleneck)heading.append(el("span","jam-bottleneck",view.bottleneck));
      header.append(el("span","jam-card-icon","▰"),heading,el("strong","jam-card-delay"+(g.delayMin===null?" is-unknown":""),view.delay));
      const metrics=el("div","jam-card-metrics");
      metrics.append(el("span","jam-card-state",view.state),el("span","",view.length),el("span","","Ø Geschwindigkeit: "+view.speed));
      card.append(header,metrics);
      card.addEventListener("click",()=>focus(g.edgeId,g.offsetM));
      list.append(card);
    }
  }
  function setClock(value){
    const time=$("sim-local-time"),date=$("sim-model-date");
    if(!value||!time||!date)return;
    const parts=String(value).split("T");
    const ymd=parts[0].split("-");
    if(ymd.length!==3||!parts[1])return;
    date.textContent=ymd.reverse().join(".");
    time.textContent=parts[1].slice(0,5);time.dateTime=value;
  }
  function setRunning(running){
    const state=$("sim-run-state"),button=$("sim-toggle");
    if(state){
      state.textContent=running?"Läuft":$("sim-clock")?.textContent==="0:00"?"Bereit":"Pausiert";
      state.classList.toggle("running",running);
    }
    button?.setAttribute("aria-pressed",String(running));
  }
  window.StauDashboard=Object.freeze({describeJam,renderJams,setClock,setRunning});
  const sidebar=document.querySelector(".sidebar"),button=$("mobile-panel-toggle"),hint=$("mobile-panel-hint"),chevron=$("mobile-panel-chevron");
  if(!sidebar||!button||!hint||!chevron)return;
  function setExpanded(expanded){
    sidebar.classList.toggle("is-collapsed",!expanded);
    button.setAttribute("aria-expanded",String(expanded));
    button.setAttribute("aria-label",expanded?"Steuerung einklappen":"Steuerung öffnen");
    hint.textContent=expanded?"Nach unten scrollen für weitere Einstellungen":"Antippen, um die Einstellungen zu öffnen";
    chevron.textContent=expanded?"⌄":"⌃";
    if(!expanded)sidebar.scrollTop=0;
    const update=()=>window.__stauMap?.invalidateSize?.({pan:false});
    if(typeof window.requestAnimationFrame==="function")window.requestAnimationFrame(update);else update();
  }
  button.addEventListener("click",()=>setExpanded(sidebar.classList.contains("is-collapsed")));
})();
