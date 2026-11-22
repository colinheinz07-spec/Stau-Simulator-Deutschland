import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

async function reference(){
  const w={};
  new Function('window',await readFile('web/traffic-reference.js','utf8'))(w);
  return w;
}

test('regional destinations advance at a route landmark, independently in each direction',async()=>{
  const {StauTrafficReference:t}=await reference();
  const north=[50.38,7.42],south=[50.34,7.51];
  assert.equal(t.navigationDestination('A61',north,[north,south]),'Koblenz');
  assert.equal(t.navigationDestination('A61',south,[north,south]),'Rheinböllen');
  assert.equal(t.navigationDestination('A61',south,[south,north]),'Koblenz');
  assert.equal(t.navigationDestination('A61',north,[south,north]),'Bonn');
  const lev=[51.025,7.01],kol=[50.93,7.06];
  assert.equal(t.navigationDestination('A3',lev,[kol,lev]),'Düsseldorf');
  assert.equal(t.navigationDestination('A3',lev,[lev,kol]),'Köln');
  assert.equal(t.navigationDestination('A3',kol,[kol,lev]),'Köln');
  assert.equal(t.navigationDestination('A3',[49,10],[[49,10],[49.1,10]]),undefined,'do not assign a Rheinland destination outside the covered corridor');
});

test('the same real A61 crossroads changes its label on both carriageways',async()=>{
  const w=await reference();
  for(const file of ['legacy-geometry','offline-traffic'])
    new Function('window',await readFile(`web/${file}.js`,'utf8'))(w);
  const s=w.createLegacyTrafficScenario(w.STAU_LEGACY_GEOMETRY);
  const road=(id,offset)=>s.queueRoadInfo({edgeId:id,offsetM:offset??s.edgeActivity(id).lengthM/2});
  assert.equal(road('A61-10713286').destination,'Bonn');
  assert.equal(road('A61-312834611').destination,'Koblenz');
  assert.equal(road('A61-10713288').destination,'Rheinböllen');
  assert.equal(road('A61-824372859').destination,'Koblenz');
  const southbound=w.STAU_LEGACY_GEOMETRY.roads.find(r=>r[1]==='mainline'&&r[2]==='A61'&&r[4][0][0]>50.36&&r[4][0][0]<50.38&&r[4][0][1]>7.39&&r[4].at(-1)[1]>r[4][0][1]);
  assert.ok(southbound,'actual road before the interchange');
  assert.equal(road(southbound[0]).destination,'Koblenz');
  // Each currently mapped motorway family has a meaningful destination.
  for(const [id,expected] of [
    ['A3-992501211','Düsseldorf'],['A3-126500248','Köln'],['A3-25341152','Köln'],
    ['A48-196288593','Montabaur'],['A48-390574344','Koblenz'],
    ['extra-a4-olpe','Köln'],['extra-a4-aachen','Köln'],['A1-7854060','Köln'],
    ['extra-a59-bonn','Bonn'],['extra-a59-koeln','Köln'],['A59-6583909','Düsseldorf'],
    ['A57-179737810','Neuss'],['A57-286321028','Köln'],['extra-a555-koeln','Köln'],
    ['extra-a559-gremberg','Köln'],['extra-a560-hennef','Hennef'],['extra-a562-bonn','Bonn-Bad Godesberg'],
    ['A565-23338614','Meckenheim'],['A571-72490993','Sinzig'],['A573-23338590','Bad Neuenahr-Ahrweiler']])
    assert.equal(road(id).destination,expected,id);
  // One very long OSM Way can contain several target regions; use the
  // queue's actual position, not a label fixed for the whole Way.
  const len=s.edgeActivity('extra-a4-aachen').lengthM;
  assert.equal(road('extra-a4-aachen',len-5).destination,'Aachen');
  assert.equal(road('extra-a4-olpe',s.edgeActivity('extra-a4-olpe').lengthM-5).destination,'Olpe');
});
