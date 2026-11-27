import test from "node:test";
import assert from "node:assert/strict";
import {Worker} from "node:worker_threads";
import {resolve} from "node:path";

test("dedicated traffic worker advances, pauses and edits without resetting stock", {timeout:60000}, async t=>{
  // Run the same classic worker source on a genuine separate Node thread,
  // adapting only Web Worker's script-loading and messaging APIs.
  const worker=new Worker(`
    const {parentPort,workerData}=require("node:worker_threads");
    const {readFileSync}=require("node:fs");
    const {resolve}=require("node:path");
    const {runInThisContext}=require("node:vm");
    globalThis.self=globalThis;
    globalThis.postMessage=m=>parentPort.postMessage(m);
    globalThis.importScripts=(...files)=>{
      for(const file of files){
        const path=resolve(workerData,file);
        runInThisContext(readFileSync(path,"utf8"),{filename:path});
      }
    };
    importScripts("./traffic-worker.js");
    parentPort.on("message",data=>globalThis.onmessage({data}));
  `,{eval:true,workerData:resolve("web")});
  t.after(()=>worker.terminate());
  const inbox=[],waiting=[];
  worker.on("message",message=>{
    if(message.type==="failure"){
      for(const w of waiting.splice(0))w.reject(Error(message.message));
      inbox.push(message);return;
    }
    const i=waiting.findIndex(w=>w.predicate(message));
    if(i>=0)waiting.splice(i,1)[0].resolve(message);else inbox.push(message);
  });
  worker.on("error",error=>{for(const w of waiting.splice(0))w.reject(error);});
  const next=predicate=>{
    const failure=inbox.find(m=>m.type==="failure");if(failure)return Promise.reject(Error(failure.message));
    const i=inbox.findIndex(predicate);
    if(i>=0)return Promise.resolve(inbox.splice(i,1)[0]);
    return new Promise((resolve,reject)=>waiting.push({predicate,resolve,reject}));
  };
  await next(m=>m.type==="ready");
  worker.postMessage({type:"batch",items:[
    {method:"setSimulationStart",revision:1,args:[Date.parse("2026-11-27T19:48:00Z")]},
    {method:"setEvent",revision:2,args:[{id:"test",edgeId:"A3-232272183",kind:"closure",
      offsetM:100,lengthM:100,closedLanes:[0,1,2],speedKmh:0,shoulder:"normal"}]}
  ]});
  const init=await next(m=>m.type==="snapshot"&&m.revision===2);
  assert.equal(init.stats.simSeconds,0);
  assert.equal(init.active.length,1);
  worker.postMessage({type:"select",selection:{id:"A3-232272183",offset:100}});
  const detail=await next(m=>m.type==="detail"&&m.revision===2);
  assert.ok(detail.detail.activity);
  worker.postMessage({type:"start"});
  const progress=await next(m=>m.type==="progress"&&m.revision===2);
  assert.equal(progress.stats.simSeconds,15);
  const minute=await next(m=>m.type==="snapshot"&&m.revision===2&&m.stats.simSeconds===60);
  assert.equal(minute.stats.conservationResidual,0);
  worker.postMessage({type:"pause"});
  const stopped=await next(m=>m.type==="snapshot"&&m.revision===2&&m.stats.simSeconds>=60);
  worker.postMessage({type:"mutate",revision:3,method:"removeEvent",args:["test"]});
  const edited=await next(m=>m.type==="snapshot"&&m.revision===3);
  assert.equal(edited.active.length,0);
  assert.equal(edited.stats.simSeconds,stopped.stats.simSeconds);
  assert.equal(edited.stats.conservationResidual,0);
});
