import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {runInNewContext} from "node:vm";

test("SPCK Canvas boots from old OSM geometry without internet or Leaflet",async()=>{
  const geometry=await readFile("web/legacy-geometry.js","utf8");
  const renderer=await readFile("web/legacy-canvas.js","utf8");
  const flow=await readFile("web/offline-traffic.js","utf8");
  const frames=[],listeners=new Map(),elements=new Map();
  const window={devicePixelRatio:2,addEventListener(){}};
  runInNewContext(geometry,{window});
  runInNewContext(flow,{window});
  const draw={strokes:0,lines:0};
  const ctx={
    setTransform(){},fillRect(){},beginPath(){},moveTo(){},
    lineTo(){draw.lines++;},stroke(){draw.strokes++;},
    fillText(){},measureText(){return {width:35}},drawImage(){}
  };
  function element(id){
    if(!elements.has(id)){
      const classes=new Set();
      elements.set(id,{
        id,checked:true,hidden:false,textContent:"",dataset:{},
        classList:{
          add(name){classes.add(name)},
          remove(name){classes.delete(name)},
          contains(name){return classes.has(name)},
          toggle(name,present){if(present===undefined)present=!classes.has(name);
            if(present)classes.add(name);else classes.delete(name)}
        },
        append(){},replaceChildren(){},setAttribute(){},setPointerCapture(){},
        addEventListener(name,callback){listeners.set(id+":"+name,callback)},
        querySelector(){return element("child-"+id)},
        getBoundingClientRect(){return {left:0,top:0,width:390,height:680}}
      });
    }
    return elements.get(id);
  }
  const document={
    body:element("body"),getElementById:element,
    querySelector:selector=>element("query-"+selector),
    querySelectorAll:selector=>selector==="[data-event]"?
      ["none","roadworks","accident","closure"].map(name=>{
        const e=element("event-"+name);e.dataset.event=name;return e;
      }):[],
    createElement(tag){
      const e=element("create-"+tag);
      if(tag==="canvas")e.getContext=()=>ctx;
      return e;
    },
    addEventListener(){}
  };
  class ImageWithoutNetwork{
    set src(value){this.requested=value;}
  }
  class ResizeObserverStub{observe(){}}
  const schedule=callback=>{frames.push(callback);return frames.length};
  runInNewContext(renderer,{
    window,document,Image:ImageWithoutNetwork,ResizeObserver:ResizeObserverStub,
    requestAnimationFrame:schedule,setTimeout(){},setInterval(){return 1},clearInterval(){},console,
  });
  await window.startLegacyCanvas();
  while(frames.length)frames.shift()();
  assert.equal(element("chip-roads").textContent,"1.929 Fahrwege");
  assert.equal(element("chip-ramps").textContent,"943 Rampen");
  assert.match(element("map-status").textContent,/Modell 0 min/);
  assert.deepEqual([element("create-canvas").width,element("create-canvas").height],[780,1360]);
  assert.ok(draw.lines>10000,"Real road geometry must draw even when map tiles fail");
  assert.equal(draw.strokes,4,"All 1929 OSM features must be drawn in batched strokes");
  assert.ok(listeners.has("create-canvas:pointerdown"));
  assert.ok(listeners.has("create-canvas:pointermove"));
  assert.ok(listeners.has("btn-test-region:click"));
  assert.ok(listeners.has("sim-toggle:click"));
  listeners.get("sim-toggle:click")();
  assert.equal(element("sim-clock").textContent,"1:00");
  assert.ok(Number(element("sim-vehicles").textContent.replaceAll(".",""))>0);
  assert.match(element("sim-toggle").textContent,/anhalten/);
});
