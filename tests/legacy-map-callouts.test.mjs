import test from 'node:test';
import assert from 'node:assert/strict';
import {Karte} from '../dist/index.js';

const node=(id,name,x,y)=>({
  id,point:[y/100+50,x/100+7],
  junctionName:name
});
const project=p=>({x:(p[1]-7)*10000,y:(p[0]-50)*10000});
test('Aus altem Simulator: Doppelbenennung von AD/AK beider Fahrtrichtungen unterdrücken',()=>{
  const nodes=[node('a','Dreieck Dernbach',1,1),
    node('b','Dreieck Dernbach',1.02,1.02),
    node('c','Kreuz Koblenz',3,3)];
  const laid=Karte.layoutJunctionLabels(nodes,project,{width:550,height:550});
  assert.equal(laid.filter(x=>x.label.includes('Dernbach')).length,1);
  assert.equal(laid.filter(x=>x.label.includes('Koblenz')).length,1);
});
test('AS-Bezeichnungen überlagern weder Kartenschaltflächen noch bereits gesetzte Labels',()=>{
  const nodes=[node('p1','Montabaur',3,3),node('p2','AS Montabaur',3.02,3.01)];
  const labels=Karte.layoutJunctionLabels(nodes,project,{
    width:550,height:550,reserved:[{x:0,y:0,width:130,height:140}]
  });
  assert.equal(labels.length,2);
  assert.ok(labels.every(x=>x.box.x>=0&&x.box.y>=0&&x.box.y>140));
  assert.ok(!Karte.overlapsLabel(labels[0].box,labels[1].box));
});
test('Kein Label bei abgeschnittenem Ausschnitt statt erfundener/geänderter AS-Position',()=>{
  const labels=Karte.layoutJunctionLabels([
    {id:'outside',point:[60,20],junctionName:'AS außerhalb'},
    {id:'valid',point:[50.01,7.01],junctionRef:'22',junctionName:'Koblenz'}
  ],project,{width:200,height:200,reserved:[{x:0,y:0,width:200,height:200}]});
  assert.deepEqual(labels,[]);
});
