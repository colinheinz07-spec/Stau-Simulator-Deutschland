import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

test("Mobiler Detail-Drawer bleibt geschlossen vollständig außerhalb des Bildes",async()=>{
  const css=await readFile("web/styles.css","utf8");
  const rules=[...css.matchAll(/\.detail-drawer\{([^}]*)\}/g)].map(match=>match[1]);
  const base=rules[0];
  // Later mobile padding overrides must not be mistaken for the drawer's
  // viewport geometry. Select the rule that establishes the mobile position.
  const mobile=rules.find(rule=>/top:7dvh/.test(rule));
  const open=css.match(/\.detail-drawer\.open\{([^}]*)\}/)?.[1];

  assert.match(base,/visibility:hidden/,"geschlossene Details müssen unsichtbar sein");
  assert.match(base,/pointer-events:none/,"geschlossene Details dürfen keine Karte blockieren");
  assert.match(open,/visibility:visible/,"geöffnete Details werden sichtbar");
  assert.match(open,/pointer-events:auto/,"geöffnete Details sind bedienbar");

  // The earlier mobile layout specified height:min(67dvh,520px).
  // Combined with top:7dvh, the closed panel only moved by its own height
  // and could leak into the visible viewport on tall phones.
  assert.match(mobile,/top:7dvh/);
  assert.match(mobile,/bottom:0/);
  assert.match(mobile,/height:auto/,"top+bottom müssen die Höhe bestimmen");
  assert.match(mobile,/max-height:none/);
  assert.match(mobile,/transform:translateY\(105%\)/);
});
