import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {runInNewContext} from "node:vm";

test("Mobilansicht: Karte oberhalb, Bedienung vertikal statt seitlich scrollbar",async()=>{
  const css=await readFile("web/styles.css","utf8");
  const html=await readFile("web/index.html","utf8");
  const newMobile=css.slice(css.lastIndexOf("/* Mobile, v0.4.1:"));
  assert.match(newMobile,/\.workspace\{display:flex;flex-direction:column/);
  assert.match(newMobile,/\.workspace \.map-pane\{\s*order:0;flex:1 1 auto;min-height:0/);
  assert.match(newMobile,/order:1;flex:0 0 auto;display:flex;flex-direction:column/);
  assert.match(newMobile,/overflow-x:hidden;overflow-y:auto/);
  assert.match(newMobile,/\.sidebar \.controls\{\s*order:0;flex:0 0 auto;width:100%/);
  assert.match(newMobile,/\.sidebar \.simulation-controls\{order:-1\}/);
  assert.match(newMobile,/\.sidebar\.is-collapsed > :not\(\.mobile-panel-header\)\{display:none!important\}/);
  assert.match(newMobile,/\.canvas-preview\.traffic-ready \.preview-zoom\{\s*bottom:12px/);
  assert.match(html,/id="mobile-panel-toggle"/);
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
  assert.match(hint.textContent,/wischen/);
  assert.equal(resizes,2);
});
