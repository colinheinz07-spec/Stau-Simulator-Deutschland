/* 04_Ereignisse + 06_Karte: offline incident editor for SPCK.
 * Does not infer a shoulder from unspecified OSM data. All saved scenarios are
 * validated by the physical engine and stored only on this device.
 */
(function(global){
"use strict";
const $=id=>document.getElementById(id);
const NAMES={roadworks:"Baustelle",accident:"Unfall",breakdown:"Panne",closure:"Vollsperrung"};
const SYMBOLS={roadworks:"🚧",accident:"💥",breakdown:"🚛",closure:"⛔"};
const STORAGE="stau-simulator-local-events-v3";
const OLD_STORAGE="stau-simulator-local-events-v2";
function createOfflineEventEditor(options){
  const {scenario,redraw,pause,start,closeDrawer,notify,focusRoad}=options;
  const calendar=global.StauEventSchedule;
  if(!calendar)throw Error("Kalender für Ereignisse fehlt");
  const form=$("event-form"),kind=$("ev-kind"),lanes=$("ev-lanes");
  const exists=$("ev-has-shoulder"),shoulder=$("ev-shoulder");
  const length=$("ev-length"),speed=$("ev-speed"),schedule=$("ev-schedule");
  const error=$("ev-error"),startClock=$("sim-start");
  const list=$("planned-events");
  let current=null,currentOffset=0,editingId=null,sequence=0;
  let nextClosureJunction=null;
  const nowRounded=Date.now()-Date.now()%60000;
  startClock.value=calendar.localDateTime(nowRounded);
  scenario.setSimulationStart(calendar.localInstant(startClock.value.slice(0,10),
    startClock.value.slice(11,16)));
  function persist(){
    try{global.localStorage?.setItem(STORAGE,JSON.stringify(scenario.listEvents()));}
    catch(ex){console.warn("Ereignisse konnten nicht lokal gespeichert werden",ex);}
  }
  function load(){
    try{
      const current=global.localStorage?.getItem(STORAGE);
      const legacy=current===null||current===undefined;
      const source=legacy?global.localStorage?.getItem(OLD_STORAGE):current;
      const saved=JSON.parse(source||"[]");
      if(Array.isArray(saved))for(const original of saved.slice(0,150)){
        try{
          const item=legacy?scenario.migrateLegacyEvent?.(original)??original:original;
          scenario.setEvent(item);
        }catch(ex){console.warn("Ungültiges Alt-Ereignis",ex);}
      }
      // Upgrade once: v2 stays as a read-only recovery copy.
      if(legacy&&Array.isArray(saved)&&source)persist();
    }catch(ex){console.warn("Speicherung nicht lesbar",ex);}
  }
  function failure(message){error.textContent=message;error.hidden=false;}
  function clearFailure(){error.textContent="";error.hidden=true;}
  function closeForm(){form.hidden=true;editingId=null;clearFailure();}
  function labels(){
    if(!current)return;
    lanes.replaceChildren();
    for(let i=0;i<current.lanes;i++){
      const field=document.createElement("label");
      field.className="event-check";
      const input=document.createElement("input");
      input.type="checkbox";input.value=String(i);
      input.name="ev-closed-lane";
      const span=document.createElement("span");
      span.textContent="Fahrstreifen "+(i+1)+(i===0?" · rechts":
        i===current.lanes-1?" · links":"");
      field.append(input,span);lanes.append(field);
    }
  }
  const laneInputs=()=>[...lanes.querySelectorAll("input[name=ev-closed-lane]")];
  function selectedLanes(){
    return laneInputs().filter(x=>x.checked).map(x=>Number(x.value));
  }
  function refreshShoulder(){
    const possible=!!current&&current.kind!=="ramp"&&current.shoulderTag!=="no";
    exists.disabled=!possible;
    if(!possible){exists.checked=false;shoulder.value="normal";}
    shoulder.disabled=!possible||!exists.checked||kind.value==="closure";
    if(shoulder.disabled)shoulder.value=kind.value==="closure"?"blocked":"normal";
    const open=shoulder.querySelector('option[value="open"]');
    if(open)open.disabled=shoulder.disabled;
    $("ev-shoulder-help").textContent=current?.shoulderTag==="no"?
      "OpenStreetMap kennzeichnet diesen Abschnitt ausdrücklich ohne Seitenstreifen. Eine Freigabe ist ausgeschlossen.":
      current?.shoulderTag==="right"||current?.shoulderTag==="yes"?
      "OpenStreetMap weist einen Seitenstreifen aus. Bitte prüfen, ob er im gewünschten Zeitraum durchgehend nutzbar ist.":
      possible?"OpenStreetMap liefert hier keine sichere Angabe. Eine Freigabe gilt nur mit deiner Bestätigung für den gesamten betroffenen Abschnitt.":
      "Für diese Rampe ist kein Standstreifen als zusätzliche Fahrspur bestätigt.";
  }
  function refreshSpeed(reset=true){
    const full=kind.value==="closure";
    for(const checkbox of laneInputs()){
      checkbox.disabled=full;
      if(full)checkbox.checked=true;
    }
    refreshShoulder();
    const open=(current?.lanes||1)-selectedLanes().length+
      Number(shoulder.value==="open");
    if(reset){
      speed.value=full||open<=0?"0":
        kind.value==="accident"||kind.value==="breakdown"?open===1?"40":"60":
        open===1?"40":open===2?"60":open===3?"80":"100";
    }
    const zero=speed.querySelector('option[value="0"]');
    if(zero)zero.disabled=!full&&open>0;
  }
  function refreshSchedule(){
    const repeatAllowed=kind.value==="roadworks"||kind.value==="closure";
    const repeat=schedule.querySelector('option[value="repeat"]');
    if(repeat)repeat.disabled=!repeatAllowed;
    if(!repeatAllowed&&schedule.value==="repeat")schedule.value="once";
    $("ev-once-fields").hidden=schedule.value!=="once";
    $("ev-repeat-fields").hidden=schedule.value!=="repeat";
  }
  function refreshLength(){
    const isClosure=kind.value==="closure";
    const max=kind.value==="accident"||kind.value==="breakdown"?200:
      isClosure?100000:20000;
    length.max=String(max);
    const isRoad=isClosure&&current?.kind==="mainline";
    nextClosureJunction=isRoad?
      scenario.recommendedClosureLength?.(current.id,currentOffset):null;
    length.disabled=!!nextClosureJunction;
    if(nextClosureJunction){
      length.value=String(nextClosureJunction.lengthM);
    }else if(Number(length.value)>max){
      length.value=String(max);
    }
    const status=$("ev-coverage");
    if(isRoad&&nextClosureJunction){
      status.textContent="Gesamte Vollsperrung: "+nextClosureJunction.label+
        ". "+nextClosureJunction.lengthM.toLocaleString("de-DE")+
        " m · BEIDE AS-Grenzen automatisch verbindlich · "+
        "ausschließlich hineinführende Zufahrten werden mitgesperrt.";
    }else if(isRoad){
      status.textContent="Kein sicherer Abschnitt zwischen zwei Anschlussstellen "+
        "ermittelbar. Eine Teilstück-Sperrung wird hier NICHT stillschweigend gesetzt.";
    }else{
      status.textContent="Beginn am markierten OSM-Fahrweg ("+
        Math.round(currentOffset)+" m); Umfang nach eindeutig "+
        "verbundenen Segmenten. Auf- und Abfahrten werden gesondert berücksichtigt.";
    }
  }
  function prepare(kindValue,event=null){
    if(!current)return;
    editingId=event?.id||null;
    kind.value=kindValue;
    labels();
    const count=current.lanes;
    for(let i=0;i<count;i++)
      laneInputs()[i].checked=event?event.closedLanes.includes(i):
        kindValue==="closure"||i===0;
    exists.checked=event?.hasShoulder??(current.shoulderTag==="right"||current.shoulderTag==="yes");
    shoulder.value=event?.shoulder||"normal";
    currentOffset=event?.offsetM??currentOffset;
    nextClosureJunction=kindValue==="closure"?
      scenario.recommendedClosureLength?.(current.id,currentOffset):null;
    const suggested={roadworks:500,accident:100,breakdown:50,closure:5000};
    length.value=String(event?.lengthM??
      nextClosureJunction?.lengthM??suggested[kindValue]);
    schedule.value=event?.schedule?.mode||"now";
    const base=calendar.localDateTime(scenario.clockMs());
    $("ev-once-start").value=event?.schedule?.mode==="once"?
      calendar.localDateTime(event.schedule.startAt):base;
    $("ev-once-end").value=event?.schedule?.mode==="once"?
      calendar.localDateTime(event.schedule.endAt):
      calendar.localDateTime(scenario.clockMs()+2*3600000);
    const today=calendar.localDate(scenario.clockMs());
    $("ev-repeat-from").value=event?.schedule?.mode==="repeat"?
      event.schedule.firstDate:today;
    $("ev-repeat-to").value=event?.schedule?.mode==="repeat"?
      event.schedule.lastDate:calendar.plusDays(today,14);
    $("ev-repeat-start").value=event?.schedule?.mode==="repeat"?
      event.schedule.startTime:"19:00";
    $("ev-repeat-end").value=event?.schedule?.mode==="repeat"?
      event.schedule.endTime:"05:00";
    for(const cb of document.querySelectorAll('input[name="ev-day"]'))
      cb.checked=event?.schedule?.mode==="repeat"?
        event.schedule.weekdays.includes(Number(cb.value)):
        [1,2,3,4,5].includes(Number(cb.value));
    refreshSpeed(!event);
    if(event)speed.value=String(event.speedKmh);
    refreshLength();refreshSchedule();
    $("event-form-heading").textContent=(event?"Bearbeiten: ":"Neues Ereignis: ")+NAMES[kindValue];
    clearFailure();form.hidden=false;
    form.scrollIntoView?.({block:"nearest",behavior:"smooth"});
  }
  function fromDateTime(value){
    if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))
      throw Error("Bitte Datum und Uhrzeit vollständig angeben");
    return calendar.localInstant(value.slice(0,10),value.slice(11,16));
  }
  function readSchedule(){
    if(schedule.value==="now")return null;
    if(schedule.value==="once"){
      const startAt=fromDateTime($("ev-once-start").value);
      const endAt=fromDateTime($("ev-once-end").value);
      if(startAt>=endAt)throw Error("Das Ende muss nach dem Beginn liegen");
      return {mode:"once",startAt,endAt};
    }
    const result={mode:"repeat",firstDate:$("ev-repeat-from").value,
      lastDate:$("ev-repeat-to").value,startTime:$("ev-repeat-start").value,
      endTime:$("ev-repeat-end").value,
      weekdays:[...document.querySelectorAll('input[name="ev-day"]:checked')]
        .map(x=>Number(x.value))};
    if(!calendar.validate(result))
      throw Error("Bitte gültigen Datumsbereich, Wochentage und verschiedene Uhrzeiten wählen");
    return result;
  }
  function afterReset(){persist();renderList();}
  function renderList(){
    list.replaceChildren();
    const values=scenario.listEvents();
    if(!values.length){
      const note=document.createElement("p");
      note.className="event-help";
      note.textContent="Noch keine geplanten Ereignisse.";
      list.append(note);return;
    }
    const head=document.createElement("h3");
    head.textContent="Gespeicherte Ereignisse ("+values.length+")";
    list.append(head);
    for(const ev of values){
      const box=document.createElement("div");box.className="planned-event";
      const name=document.createElement("strong");
      name.textContent=SYMBOLS[ev.kind]+" "+NAMES[ev.kind]+" · "+
        (ev.edgeId.startsWith("A")?ev.edgeId.split("-")[0]:"OSM-Rampe");
      const info=document.createElement("small");
      const closure=ev.closedLanes.length?
        ev.closedLanes.map(x=>"F"+(x+1)).join(", "):"keine Fahrstreifen";
      const range=ev.kind==="closure"&&ev.closureFrom&&ev.closureTo?
        ev.closureFrom+" → "+ev.closureTo+" · ":"";
      info.textContent=range+"Sperrung: "+closure+" · "+
        ev.lengthM+" m · "+ev.speedKmh+" km/h · "+
        (ev.shoulder==="open"?"Standstreifen freigegeben · ":"")+
        calendar.label(ev.schedule)+(ev.truncated?
        " · Achtung: Netzübergang ungeklärt, nur "+Math.round(ev.coveredLengthM)+" m wirksam":"");
      const status=document.createElement("span");
      status.className="planned-state";
      status.textContent={active:"Aktiv",planned:"Geplant",between:"Derzeit außerhalb Zeitfenster",
        finished:"Abgeschlossen",inactive:"Inaktiv"}[scenario.eventStatus(ev.id)]||"Unbekannt";
      const buttons=document.createElement("div");buttons.className="event-list-actions";
      const edit=document.createElement("button"),del=document.createElement("button");
      edit.type=del.type="button";edit.textContent="Bearbeiten";del.textContent="Entfernen";
      edit.addEventListener("click",()=>{
        focusRoad(ev.edgeId,ev.offsetM);
        prepare(ev.kind,ev);
      });
      del.addEventListener("click",()=>{
        scenario.removeEvent(ev.id);persist();renderList();redraw();
      });
      buttons.append(edit,del);box.append(name,info,status,buttons);list.append(box);
    }
  }
  function save(ev){
    const result=scenario.setEvent(ev);
    persist();renderList();redraw();closeForm();closeDrawer();
    notify(result.truncated?
      "Ereignis gespeichert, aber nur "+Math.round(result.coveredLengthM)+
      " von "+result.lengthM+" m topologisch eindeutig nutzbar.":
      "Ereignis gespeichert: "+NAMES[result.kind]+
      " · "+result.lengthM+" m · "+calendar.label(result.schedule));
    if(!scenario.reachable(result.edgeId)){
      notify("Ereignis markiert, aber diese Strecke erhält aus dem lokalen Teilnetz "+
        "noch keinen Modellzufluss. Kein künstlicher Stau.");
    }else if(scenario.eventStatus(result.id)==="active"){
      // A newly set incident cannot develop a queue in a paused model.
      // Resume without clearing vehicles, clock, or other events.
      start?.();
    }
  }
  function onRoadSelected(road,offsetM=0){
    current=road;currentOffset=Math.max(0,Math.min(road.meters-.001,offsetM));
    closeForm();
  }
  // A map pin opens this exact saved event in the same editor as the list.
  function editEventById(id){
    const event=scenario.listEvents().find(item=>item.id===id);
    if(!event||!current||current.id!==event.edgeId)return false;
    prepare(event.kind,event);
    return true;
  }
  for(const button of document.querySelectorAll(".event-actions [data-event]")){
    button.addEventListener("click",()=>{
      if(!current)return;
      if(button.dataset.event==="none"){
        for(const event of scenario.listEvents().filter(x=>x.edgeId===current.id))
          scenario.removeEvent(event.id);
        persist();renderList();redraw();closeForm();
        return;
      }
      prepare(button.dataset.event);
    });
  }
  form.addEventListener("submit",event=>{
    event.preventDefault();
    if(!current)return;
    try{
      clearFailure();
      const kindValue=kind.value,selected=selectedLanes();
      const all=Array.from({length:current.lanes},(_,i)=>i);
      const blocked=kindValue==="closure"?all:selected;
      const record={
        id:editingId||("e"+Date.now().toString(36)+"_"+(++sequence)),
        edgeId:current.id,kind:kindValue,closedLanes:blocked,
        offsetM:currentOffset,lengthM:Number(length.value),
        speedKmh:Number(speed.value),hasShoulder:exists.checked,
        shoulder:shoulder.value,schedule:readSchedule()
      };
      save(record);
    }catch(ex){failure(ex.message||String(ex));}
  });
  $("ev-cancel").addEventListener("click",closeForm);
  kind.addEventListener("change",()=>{
    if(kind.value==="closure")for(const cb of laneInputs())cb.checked=true;
    refreshSpeed();refreshLength();refreshSchedule();
  });
  lanes.addEventListener("change",()=>refreshSpeed());
  exists.addEventListener("change",()=>refreshSpeed());
  shoulder.addEventListener("change",()=>refreshSpeed());
  schedule.addEventListener("change",refreshSchedule);
  startClock.addEventListener("change",()=>{
    try{
      pause();
      const at=fromDateTime(startClock.value);
      scenario.setSimulationStart(at);
      renderList();redraw();
      notify("Simulationsbeginn: "+startClock.value.replace("T"," ")+" Uhr (Deutschland)");
    }catch(ex){notify("Ungültige Simulationszeit: "+ex.message);}
  });
  load();renderList();
  let lastMinute=-1;
  function updateStatus(){
    const minute=Math.floor(scenario.totals().simSeconds/60);
    if(minute===lastMinute)return;
    lastMinute=minute;renderList();
  }
  return {onRoadSelected,editEventById,closeForm,renderList,updateStatus,afterReset};
}
global.createOfflineEventEditor=createOfflineEventEditor;
})(window);
