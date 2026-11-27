/* Dedicated traffic solver. The UI receives compact, immutable snapshots;
 * no cell solver work is performed by the animation-frame renderer. */
"use strict";
self.window=self;
importScripts("./legacy-geometry.js","./event-schedule.js","./traffic-reference.js");
// The same signed route catalogue is used in the worker and browser.
self.document={createElement:()=>({}),head:{append(script){
  try{importScripts(script.src);}catch(error){script.onerror?.();}
}}};
importScripts("./bedarfsumleitungen.js");
delete self.document;
importScripts("./offline-traffic.js");
const model=self.createLegacyTrafficScenario(self.STAU_LEGACY_GEOMETRY);
const ids=self.STAU_LEGACY_GEOMETRY.roads.map(r=>r[0]).filter(id=>model.hasEdge(id));
let revision=0,running=false,timer=null,steps=0,batchStart=0,selection=null;
const stamp=()=>performance.now();
function detail(){
  return selection?{id:selection.id,offset:selection.offset,activity:model.edgeActivity(selection.id,selection.offset),
    events:model.eventsOnRoad(selection.id)}:null;
}
function publish(){
  const groups=model.jamSummaries(),events=model.listEvents(),active=model.activeEvents();
  const statuses={},detours={};
  for(const e of events){
    statuses[e.id]=model.eventStatus(e.id);
    if(e.kind==="closure"&&statuses[e.id]==="active")detours[e.id]={
      destinations:model.detourDestinations(e.id),designated:model.designatedDetourRoutes(e.id),wide:model.wideDetourRoutes(e.id)
    };
  }
  const traffic=[],closures=[];
  for(const id of ids){
    const bands=model.visualBands(id).filter(b=>b.color!=="free");
    if(bands.length)traffic.push([id,bands]);
    if(active.length){const b=model.closureBands(id);if(b.length)closures.push([id,b]);}
  }
  postMessage({type:"snapshot",revision,stats:model.totals(),clock:model.clockMs(),groups,
    infos:groups.map(g=>model.queueRoadInfo(g)),events,active,statuses,detours,traffic,closures,
    gates:active.some(e=>e.kind==="closure")?model.closureGatePoints():[],
    access:active.length?model.closureAccessPoints():[],signed:model.signedDetourTraffic(),detail:detail()});
}
function fail(error){
  running=false;clearTimeout(timer);timer=null;
  postMessage({type:"failure",revision,message:error?.message||String(error)});
}
function schedule(ms=0){
  if(running&&timer===null)timer=setTimeout(run,ms);
}
function run(){
  timer=null;if(!running)return;
  try{
    if(steps===0)batchStart=stamp();
    model.step(5,steps===11);
    steps++;
    if(steps===12){steps=0;publish();schedule(Math.max(0,1000-(stamp()-batchStart)));}
    else schedule(0);
  }catch(error){fail(error);}
}
const mutations=new Set(["setEvent","restoreEvent","removeEvent","setMode","reset","setSimulationStart","setDemandPercent"]);
self.onmessage=({data:m})=>{
  try{
    if(m.type==="select"){
      selection=m.selection;postMessage({type:"detail",revision,detail:detail()});return;
    }
    if(m.type==="start"){if(!running){model.warmStart();running=true;schedule();}return;}
    if(m.type==="pause"){
      running=false;clearTimeout(timer);timer=null;
      if(steps){model.refresh();steps=0;}publish();return;
    }
    if(m.type==="mutate"&&mutations.has(m.method)){
      revision=m.revision;
      model[m.method](...m.args);
      if(m.method==="reset"||m.method==="setSimulationStart")steps=0;
      else if(steps){model.refresh();steps=0;}
      publish();
    }
  }catch(error){fail(error);}
};
postMessage({type:"ready"});
publish();
