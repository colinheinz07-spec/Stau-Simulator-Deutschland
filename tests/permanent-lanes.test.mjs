import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {importOsmNetwork} from '../dist/01_Strassennetz.js';

const expected = new Map([
  ...[88004925,37264385,992482669,992482670,25404897,620672136,840177199,840177198,992482934,992482935,140575546,840177202,840177203,423654340,992483386,223297045].map(id=>[id,3]),
  ...[132614469,886737506,886737507,753473363,753473366,312198258,132624375,258491549,258491543,318531282,281774000,258495162,258491542,258491546,132624368,315647742,992498412,992498413,258503935,258503936,193706950,208913376,132624378,132624384,992498533,206716755,206716768,258495161,258495159,281773996,26164974,281774006,208913378,132624381,132624387,132624371,132624372,315647743,315647744].map(id=>[id,4]),
]);

test('Permanent A3 lane widths drive both map inventory and nominal capacity',()=>{
  const window={};
  const context=vm.createContext({window,console});
  for(const path of ['legacy-geometry.js','event-schedule.js','traffic-reference.js','offline-traffic.js']){
    vm.runInContext(readFileSync(new URL('../web/'+path,import.meta.url),'utf8'),context);
  }
  const data=window.STAU_LEGACY_GEOMETRY;
  const scenario=window.createLegacyTrafficScenario(data);
  let checked=0;
  for(const row of data.roads){
    if(row[1]!=='mainline'||row[2]!=='A3'||!expected.has(row[6]))continue;
    const width=expected.get(row[6]);
    assert.equal(row[3],width,row[0]);
    assert.equal(scenario.edgeActivity(row[0]).capacityVph,width*2200,row[0]);
    checked++;
  }
  assert.equal(checked,expected.size);
  assert.equal(data.roads.find(row=>row[0]==='extra-heumar-132614489')[3],2);
  for(const [id,width] of [['A3-312198258',4],['A3-37264385',3]]){
    const eventId='old-'+id;
    // Previously saved full-width incident, when the snapshot had one fewer lane.
    scenario.restoreEvent({id:eventId,edgeId:id,kind:'accident',
      lengthM:100,offsetM:0,speedKmh:0,closedLanes:Array.from({length:width-1},(_,i)=>i)});
    assert.equal(scenario.listEvents().find(e=>e.id===eventId).closedLanes.length,width);
    scenario.step(5);
    assert.equal(scenario.edgeActivity(id).operatingCapacityVph,0);
    scenario.removeEvent(eventId);
    scenario.setMode(id,'roadworks');
    scenario.step(5);
    assert.equal(scenario.edgeActivity(id).capacityVph,width*2200);
    assert.ok(scenario.edgeActivity(id).operatingCapacityVph<=(width-1)*2200);
    scenario.setMode(id,'none');
    scenario.step(5);
    assert.equal(scenario.edgeActivity(id).capacityVph,width*2200);
  }
});

test('OSM importer uses verified permanent lanes, not temporary snapshot count',()=>{
  // Synthetic importer inputs with the corresponding OSM IDs; no map data is changed.
  for(const [wayId,width] of expected){
    const elements=[
      {type:'node',id:1,lat:50.9,lon:7.1},
      {type:'node',id:2,lat:50.91,lon:7.1},
      {type:'way',id:wayId,nodes:[1,2],tags:{highway:'motorway',ref:'A 3',
        oneway:'yes',lanes:String(width-1)}}
    ];
    const {network}=importOsmNetwork(elements,{strict:false});
    assert.equal(network.edges.length,1);
    assert.equal(network.edges[0].lanes,width,String(wayId));
  }
});
