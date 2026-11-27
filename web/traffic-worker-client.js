/* Synchronous editor metadata + asynchronous worker-owned vehicle state.
 * No silent reset or fallback once the worker has accepted simulation work. */
(function(global){
"use strict";
function createWorkerTrafficScenario(local,onUpdate,onFailure){
  if(typeof global.Worker!=="function")return null;
  let worker;
  try{worker=new global.Worker("./traffic-worker.js");}catch(error){return null;}
  let ready=false,failed=false,revision=0,snapshot=null,detail=null,selected=null,queue=[];
  let running=false;
  const send=m=>{if(failed)return;if(ready)worker.postMessage(m);else queue.push(m);};
  const empty={stats:local.totals(),clock:local.clockMs(),groups:[],infos:[],traffic:[],closures:[],active:[],statuses:{},detours:{},gates:[],access:[],signed:[]};
  let state=empty,traffic=new Map(),closures=new Map(),infos=new Map();
  function receive(s){
    if(s.revision!==revision)return;
    snapshot=s;state=s;traffic=new Map(s.traffic);closures=new Map(s.closures);
    infos=new Map(s.groups.map((g,i)=>[g,s.infos[i]]));
    if(s.detail&&selected&&s.detail.id===selected.id&&s.detail.offset===selected.offset)detail=s.detail;
    onUpdate();
  }
  function fail(message){
    if(failed)return;failed=true;running=false;worker.terminate();clearTimeout(startup);
    onFailure(message,ready);
  }
  const startup=setTimeout(()=>fail("Web Worker konnte nicht gestartet werden"),15000);
  worker.onmessage=({data:m})=>{
    if(failed)return;
    if(m.type==="ready"){
      ready=true;clearTimeout(startup);
      for(const item of queue)worker.postMessage(item);queue=[];return;
    }
    if(m.type==="failure"){fail(m.message);return;}
    if(m.type==="snapshot")receive(m);
    if(m.type==="detail"&&m.revision===revision&&selected&&m.detail?.id===selected.id&&m.detail.offset===selected.offset){
      detail=m.detail;onUpdate();
    }
  };
  worker.onerror=e=>{e.preventDefault?.();fail(e.message||"Web Worker ist fehlgeschlagen");};
  function mutate(method,args){
    const result=local[method](...args);
    revision++;detail=null;
    if(method==="reset"||method==="setSimulationStart"){
      state={...empty,stats:local.totals(),clock:local.clockMs()};
      snapshot=null;traffic.clear();closures.clear();infos.clear();
    }
    send({type:"mutate",revision,method,args});return result;
  }
  function eventStatus(id){
    if(snapshot?.revision===revision)return state.statuses[id]||"missing";
    const e=local.listEvents().find(x=>x.id===id);
    if(!e)return "missing";
    if(!e.schedule||global.StauEventSchedule.active(e.schedule,state.clock))return "active";
    if(e.schedule.mode==="once")return state.clock<e.schedule.startAt?"planned":"finished";
    return global.StauEventSchedule.localDate(state.clock)<e.schedule.firstDate?"planned":
      global.StauEventSchedule.localDate(state.clock)>e.schedule.lastDate?"finished":"between";
  }
  const api={...local,
    workerMode:true,
    startWorker(){if(!running&&!failed){running=true;send({type:"start"});}},
    pauseWorker(){if(running){running=false;send({type:"pause"});}},
    disposeWorker(){failed=true;clearTimeout(startup);worker.terminate();},
    selectRoad(id,offset=0){
      selected=id?{id,offset}:null;detail=null;send({type:"select",selection:selected});
    },
    totals:()=>state.stats,clockMs:()=>state.clock,
    jamSummaries:()=>state.groups,queueRoadInfo:g=>infos.get(g)||{},
    visualBands:id=>traffic.get(id)||[],closureBands:id=>closures.get(id)||[],
    closureGatePoints:()=>state.gates,closureAccessPoints:()=>state.access,
    signedDetourTraffic:()=>state.signed,
    activeEvents:()=>snapshot?.revision===revision?state.active:local.listEvents().filter(e=>eventStatus(e.id)==="active"),
    eventStatus,
    eventsOnRoad:id=>detail?.id===id?detail.events:local.eventsOnRoad(id),
    detourDestinations:id=>snapshot?.revision===revision?state.detours[id]?.destinations||[]:[],
    designatedDetourRoutes:id=>snapshot?.revision===revision?state.detours[id]?.designated||[]:[],
    wideDetourRoutes:id=>snapshot?.revision===revision?state.detours[id]?.wide||[]:[],
    edgeActivity(id,offset=0){
      if(detail?.id===id&&detail.offset===offset)return detail.activity;
      const a=local.edgeActivity(id,offset);
      return a?{...a,flowSampled:false,vehicles:NaN,sectionSpeedKmh:null}:null;
    },
    speed:()=>null,
    refresh:()=>state.stats
  };
  for(const method of ["setEvent","restoreEvent","removeEvent","setMode","reset","setSimulationStart","setDemandPercent"])
    api[method]=(...args)=>mutate(method,args);
  return api;
}
global.createWorkerTrafficScenario=createWorkerTrafficScenario;
})(window);
