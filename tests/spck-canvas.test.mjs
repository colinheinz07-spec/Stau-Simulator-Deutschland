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
  const draw={strokes:0,lines:0,colors:[]};
  const ctx={
    setTransform(){},fillRect(){},beginPath(){},moveTo(){},
    lineTo(){draw.lines++;},stroke(){draw.strokes++;draw.colors.push(this.strokeStyle);},
    setLineDash(){},
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

  // Tap a real A3 point and set a full closure through the actual mobile UI.
  // The closure has its own red-white overlay, not fake traffic-speed coloring.
  const refPoint=window.STAU_LEGACY_GEOMETRY.roads[0][4][0];
  const merc=p=>[(p[1]+180)*256/360,
    (1-Math.log(Math.tan(Math.PI/4+p[0]*Math.PI/360))/Math.PI)*128];
  const sw=merc([50.15,6.84]),ne=merc([50.88,8.21]);
  const z=Math.log2(Math.min(348/Math.abs(sw[0]-ne[0]),624/Math.abs(sw[1]-ne[1])));
  const mid=[(sw[0]+ne[0])/2,(sw[1]+ne[1])/2],p=merc(refPoint);
  const click={pointerId:1,clientX:195+(p[0]-mid[0])*2**z,
    clientY:340+(p[1]-mid[1])*2**z};
  listeners.get("create-canvas:pointerdown")(click);
  listeners.get("create-canvas:pointerup")(click);
  assert.equal(element("detail-drawer").classList.contains("open"),true,
    "tapping actual road geometry should open incident tools");
  listeners.get("event-closure:click")();
  while(frames.length)frames.shift()();
  assert.equal(element("detail-drawer").classList.contains("open"),false);
  assert.ok(draw.colors.includes("#d52b3e"),"closure draws red stripes");
  assert.ok(draw.colors.includes("#ffffff"),"closure draws white stripes");

});
