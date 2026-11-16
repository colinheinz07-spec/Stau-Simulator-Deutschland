import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {runInNewContext} from "node:vm";

test("Mobilansicht: eigenständige Karte, Uhr, Steuerung und Stauliste; die Seite scrollt vertikal",async()=>{
  const css=await readFile("web/styles.css","utf8");
  const html=await readFile("web/index.html","utf8");
  assert.match(css,/\.workspace\{display:flex;flex-direction:column/);
  assert.match(css,/\.map-pane\{height:clamp\(300px,57dvh,570px\);flex:none/);
  assert.match(css,/\.sidebar\{display:grid;grid-template-columns:1fr;overflow:visible/);
  assert.match(css,/\.sidebar\.is-collapsed > :not\(\.mobile-panel-header\)\{display:none!important\}/);
  assert.ok(html.indexOf('id="sim-toggle"')<html.indexOf('id="map"'));
  assert.ok(html.indexOf('id="map"')<html.indexOf('id="jam-list"'));
  assert.ok(html.indexOf('id="jam-list"')<html.indexOf('id="traffic-settings"'));
  for(const id of ["sim-toggle","sim-reset","sim-model-date","sim-local-time","jam-list","planned-events"])
    assert.equal((html.match(new RegExp('id="'+id+'"','g'))||[]).length,1);
  assert.match(html,/src="\.\/mobile-controls\.js"/);
});
test("Mobiles Bedienfeld lässt sich einklappen und öffnen",async()=>{
  const code=await readFile("web/mobile-controls.js","utf8");
  const events={};
  const classes=new Set();
  const attributes={};
  const sidebar={
    classList:{
      contains:x=>classes.has(x),
      toggle:(x,yes)=>yes?classes.add(x):classes.delete(x)
    },
    scrollTop:72
  };
  const button={
    addEventListener:(type,fn)=>{events[type]=fn},
    setAttribute:(k,v)=>{attributes[k]=v}
  };
  const hint={textContent:""},chevron={textContent:""};
  const ids={"mobile-panel-toggle":button,"mobile-panel-hint":hint,"mobile-panel-chevron":chevron};
  let resizes=0;
  const window={
    __stauMap:{invalidateSize:({pan})=>{assert.equal(pan,false);resizes++}},
    requestAnimationFrame:fn=>fn()
  };
  const document={
    querySelector:x=>x===".sidebar"?sidebar:null,
    getElementById:id=>ids[id]||null
  };
  runInNewContext(code,{window,document});
  assert.equal(typeof events.click,"function");
  events.click();
  assert.equal(classes.has("is-collapsed"),true);
  assert.equal(attributes["aria-expanded"],"false");
  assert.equal(sidebar.scrollTop,0);
  assert.match(hint.textContent,/öffnen/);
  events.click();
  assert.equal(classes.has("is-collapsed"),false);
  assert.equal(attributes["aria-expanded"],"true");
  assert.match(hint.textContent,/scrollen/);
  assert.equal(resizes,2);
});

test("Staukarten verwenden gemessene Modellwerte, Fahrtrichtung und verknüpfen die exakte Kartenposition",async()=>{
 const code=await readFile("web/mobile-controls.js","utf8");
 const elements=new Map(),window={};
 function element(id){
  if(!elements.has(id))elements.set(id,{id,children:[],dataset:{},style:{setProperty(k,v){this[k]=v;}},
   classList:{toggle(){}},setAttribute(k,v){this[k]=v;},textContent:"",
   append(...items){this.children.push(...items);},replaceChildren(){this.children=[];},
   addEventListener(k,v){this[k]=v;}});
  return elements.get(id);
 }
 let serial=0;
 const document={getElementById:element,querySelector:()=>null,createElement:tag=>element(tag+ ++serial)};
 runInNewContext(code,{window,document});
 const ui=window.StauDashboard;
 const group={edgeId:"a3",offsetM:135,lengthM:2400,delayMin:11.7,worstKmh:8};
 const road={ref:"A3",kind:"mainline",direction:"A3-koeln",location:"bei Montabaur"};
 const view=ui.describeJam(group,road);
 assert.equal(view.title,"A3 Richtung Köln");assert.equal(view.length,"2,4 km");
 assert.equal(view.delay,"+12 min");assert.equal(view.severity,"standstill");assert.equal(view.speed,"8 km/h");
 assert.equal(ui.describeJam({...group,meanKmh:18,delayMin:null},road).speed,"18 km/h");
 assert.equal(ui.describeJam({...group,meanKmh:18,delayMin:null},road).delay,"Nicht berechenbar");
 assert.equal(ui.describeJam({...group,worstKmh:45},road).severity,"slow");
 assert.equal(ui.describeJam({...group,worstKmh:22},road).severity,"jam");
 let focused=null;
 ui.renderJams([group],()=>road,(...args)=>focused=args);
 assert.equal(element("jam-count").textContent,"1");
 const card=element("jam-list").children[0];assert.equal(card.dataset.trafficState,"standstill");
 card.click();assert.deepEqual(focused,["a3",135]);
 ui.setClock("2026-11-16T08:05");assert.equal(element("sim-local-time").textContent,"08:05");
 assert.equal(element("sim-model-date").textContent,"16.11.2026");
 ui.setRunning(true);assert.equal(element("sim-run-state").textContent,"Läuft");
 ui.renderJams([],()=>road,()=>{});assert.equal(element("jam-count").textContent,"0");
 assert.match(element("jam-list").children[0].textContent,/Keine Rückstaus/);
});
