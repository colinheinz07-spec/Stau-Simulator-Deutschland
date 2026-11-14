import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {runInNewContext} from "node:vm";

test("iPhone incident editor saves exact lanes, shoulder, recurrence and edit/remove",async()=>{
  const window={};
  for(const p of ["web/event-schedule.js","web/traffic-reference.js","web/offline-traffic.js"])
    runInNewContext(await readFile(p,"utf8"),{window,Date,Intl,console});
  const network={roads:[
    ["a","mainline","A3",3,[[50,7],[50,7.013]],"",1],
    ["b","mainline","A3",3,[[50,7.013],[50,7.026]],"",2]
  ]};
  const scenario=window.createLegacyTrafficScenario(network);
  const elements=new Map(),handlers=new Map();
  function element(id){
    if(!elements.has(id)){
      const classes=new Set();
      const x={id,children:[],dataset:{},value:"",checked:false,hidden:false,
        disabled:false,textContent:"",className:"",type:"",name:"",
        classList:{add(k){classes.add(k)},remove(k){classes.delete(k)},
          contains(k){return classes.has(k)},toggle(k,on){if(on)classes.add(k);else classes.delete(k)}},
        addEventListener(n,fn){handlers.set(id+":"+n,fn)},
        append(...xs){this.children.push(...xs)},
        replaceChildren(...xs){this.children=[...xs]},
        scrollIntoView(){},
        querySelector(selector){
          if(selector.startsWith("option"))return {disabled:false};
          return null;
        },
        querySelectorAll(selector){
          if(selector.includes("ev-closed-lane"))
            return this.children.flatMap(x=>x.children.filter(y=>y.name==="ev-closed-lane"));
          return [];
        }
      };
      elements.set(id,x);
    }
    return elements.get(id);
  }
  const kinds=["none","roadworks","accident","breakdown","closure"];
  const eventButtons=kinds.map(type=>{
    const button=element("button-"+type);button.dataset.event=type;return button;
  });
  const days=[1,2,3,4,5,6,0].map(n=>{
    const input=element("day-"+n);input.value=String(n);input.name="ev-day";
    return input;
  });
  const document={
    getElementById:element,createElement:tag=>{
      const el=element("created-"+tag+"-"+elements.size);el.tagName=tag;return el;
    },
    querySelectorAll(selector){
      if(selector===".event-actions [data-event]")return eventButtons;
      if(selector==='input[name="ev-day"]')return days;
      if(selector==='input[name="ev-day"]:checked')return days.filter(x=>x.checked);
      return [];
    }
  };
  runInNewContext(await readFile("web/offline-event-editor.js","utf8"),
    {window,document,Date,Intl,console});
  const storage=new Map();
  window.localStorage={
    getItem(k){return storage.get(k)||null},
    setItem(k,v){storage.set(k,v)}
  };
  const f=window.createOfflineEventEditor;
  let editor;
  editor=f({scenario,redraw(){},pause(){},closeDrawer(){},notify(){},
    focusRoad(edgeId,offset){
      editor.onRoadSelected({id:edgeId,kind:"mainline",lanes:3,
        meters:1000,shoulderTag:null},offset);
    }});
  editor.onRoadSelected({id:"a",kind:"mainline",lanes:3,meters:1000,shoulderTag:null},150);
  handlers.get("button-roadworks:click")();
  assert.equal(element("event-form").hidden,false);
  let boxes=element("ev-lanes").querySelectorAll("input[name=ev-closed-lane]");
  assert.equal(boxes.length,3);
  boxes[1].checked=true;
  element("ev-has-shoulder").checked=true;
  handlers.get("ev-has-shoulder:change")();
  element("ev-shoulder").value="open";
  handlers.get("ev-shoulder:change")();
  element("ev-length").value="500";
  element("ev-speed").value="60";
  element("ev-schedule").value="repeat";
  handlers.get("ev-schedule:change")();
  element("ev-repeat-from").value="2026-11-10";
  element("ev-repeat-to").value="2026-11-30";
  element("ev-repeat-start").value="20:00";
  element("ev-repeat-end").value="05:00";
  for(const day of days)day.checked=[2,4].includes(Number(day.value));
  handlers.get("event-form:submit")({preventDefault(){}});
  const saved=scenario.listEvents();
  assert.equal(saved.length,1,element("ev-error").textContent);
  assert.deepEqual([...saved[0].closedLanes],[0,1]);
  assert.equal(saved[0].shoulder,"open");
  assert.equal(saved[0].hasShoulder,true);
  assert.equal(saved[0].lengthM,500);
  assert.equal(saved[0].offsetM,150);
  assert.equal(saved[0].schedule.mode,"repeat");
  assert.deepEqual([...saved[0].schedule.weekdays],[2,4]);
  assert.ok(storage.get("stau-simulator-local-events-v3").includes("roadworks"));
  assert.equal(element("event-form").hidden,true);

  // List uses real edit/delete actions; changing the existing record preserves ID.
  let row=element("planned-events").children.find(x=>x.className==="planned-event");
  assert.ok(row);
  let actions=row.children.find(x=>x.className==="event-list-actions");
  const edit=actions.children[0];
  handlers.get(edit.id+":click")();
  assert.equal(element("event-form").hidden,false);
  assert.equal(element("ev-length").value,"500");
  element("ev-length").value="650";
  handlers.get("event-form:submit")({preventDefault(){}});
  assert.equal(scenario.listEvents().length,1);
  assert.equal(scenario.listEvents()[0].lengthM,650);
  row=element("planned-events").children.find(x=>x.className==="planned-event");
  actions=row.children.find(x=>x.className==="event-list-actions");
  handlers.get(actions.children[1].id+":click")();
  assert.equal(scenario.listEvents().length,0);
  assert.equal(JSON.parse(storage.get("stau-simulator-local-events-v3")).length,0);
});
