/* Synchronous editor metadata + asynchronous worker-owned vehicle state.
 * No silent reset or fallback once the worker has accepted simulation work. */
(function(global){
"use strict";
function createWorkerTrafficScenario(local,onUpdate,onFailure,onProgress){
  if(typeof global.Worker!=="function")return null;
  let worker;
  try{worker=new global.Worker("./traffic-worker.js");}catch(error){return null;}
  let ready=false,failed=false,revision=0,snapshot=null,detail=null,selected=null,queue=[];
  let unsubscribeSigned;
  let running=false,progress=null;
  const send=m=>{if(failed)return;if(ready)worker.postMessage(m);else queue.push(m);};
  const empty={stats:local.totals(),clock:local.clockMs(),groups:[],infos:[],traffic:[],closures:[],active:[],statuses:{},detours:{},gates:[],access:[],signed:[]};
  let state=empty,traffic=new Map(),closures=new Map(),infos=new Map();
  function receive(s){
    if(s.revision!==revision)return;
    snapshot=s;state=s;
    if(!progress||progress.stats.simSeconds<=s.stats.simSeconds)progress={stats:s.stats,clock:s.clock};
    traffic=new Map(s.traffic);closures=new Map(s.closures);
    infos=new Map(s.groups.map((g,i)=>[g,s.infos[i]]));
    if(s.detail&&selected&&s.detail.id===selected.id&&s.detail.offset===selected.offset)detail=s.detail;
    onUpdate();
  }
  function fail(message){
    if(failed)return;failed=true;running=false;unsubscribeSigned?.();worker.terminate();clearTimeout(startup);
    if(!ready)Object.assign(api,local,{workerMode:false});
    onFailure(message,ready);
  }
  const startup=setTimeout(()=>fail("Web Worker konnte nicht gestartet werden"),15000);
  worker.onmessage=({data:m})=>{
    if(failed)return;
    if(m.type==="ready"){
      ready=true;api.workerReady=true;clearTimeout(startup);
      // Restore all stored incidents before the first expensive route graph
      // publication. Non-mutation commands retain their original order.
      let items=[];
      const flush=()=>{if(items.length){worker.postMessage({type:"batch",items});items=[];}};
      for(const item of queue){
        if(item.type==="mutate")items.push(item);
        else{flush();worker.postMessage(item);}
      }
      flush();queue=[];return;
    }
    if(m.type==="failure"){fail(m.message);return;}
    if(m.type==="snapshot")receive(m);
    if(m.type==="progress"&&running&&m.revision===revision){
      progress={stats:m.stats,clock:m.clock};onProgress?.(m.stats,m.clock);
    }
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
      snapshot=null;progress=null;traffic.clear();closures.clear();infos.clear();
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
    workerMode:true,workerReady:false,
    startWorker(){if(!running&&!failed){running=true;send({type:"start"});}},
    pauseWorker(){if(running){running=false;send({type:"pause"});}},
    disposeWorker(){failed=true;unsubscribeSigned?.();clearTimeout(startup);worker.terminate();},
    selectRoad(id,offset=0){
      selected=id?{id,offset}:null;detail=null;send({type:"select",selection:selected});
    },
    totals:()=>state.stats,clockMs:()=>state.clock,displayProgress:()=>progress,
    jamSummaries:()=>state.groups,queueRoadInfo:g=>infos.get(g)||{},
    visualBands:id=>traffic.get(id)||[],closureBands:id=>closures.get(id)||[],
    closureGatePoints:()=>state.gates,closureAccessPoints:()=>state.access,
    signedDetourTraffic:()=>state.signed,
    activeEvents:()=>state.active,
    eventStatus,
    eventsOnRoad:id=>detail?.id===id?detail.events:local.eventsOnRoad(id),
    detourDestinations:id=>snapshot?.revision===revision?state.detours[id]?.destinations||[]:[],
    designatedDetourRoutes:id=>snapshot?.revision===revision?state.detours[id]?.designated||[]:[],
    wideDetourRoutes:id=>snapshot?.revision===revision?state.detours[id]?.wide||[]:[],
    validatedMotorwayBypasses:id=>snapshot?.revision===revision?state.detours[id]?.motorway||[]:[],
    get workerSnapshotRevision(){return snapshot?.revision??-1;},
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
  const signed=global.StauBedarfsumleitungen;
  let signedRevision=-1;
  const syncSigned=()=>{if(signed?.dataset&&signed.revision!==signedRevision){signedRevision=signed.revision;send({type:"signed-dataset",dataset:signed.dataset});}};
  unsubscribeSigned=signed?.subscribe(syncSigned);syncSigned();
  return api;
}
global.createWorkerTrafficScenario=createWorkerTrafficScenario;
})(window);
