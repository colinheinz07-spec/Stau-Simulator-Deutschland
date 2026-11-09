/** Inspect every directed OSM motorway_link in the selected A3/A48 area.
 * Expected PBF boundary sources are reported; never draw any connecting
 * line to conceal a missing real movement.
 *
 * node scripts/audit-a3-a48-connectivity.mjs GRAPH.json OUTPUT.json
 */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {Strassennetz} from '../dist/index.js';
const [source,target]=process.argv.slice(2);
if(!source||!target)throw Error('Usage: audit-a3-a48-connectivity.mjs GRAPH.json OUTPUT.json');
const network=JSON.parse(await readFile(resolve(source),'utf8'));
const errors=Strassennetz.validateNetwork(network);
if(errors.length)throw Error('Netzfehler: '+errors.slice(0,10).join('; '));
const audit=Strassennetz.auditConnections(network);
const unresolved=audit.rampFindings.filter(r=>r.kind!=='connected');
const output={
  origin:'Imported OSM network, no inferred connections',
  counts:{
    edges:audit.edgeCount,mainlines:audit.motorwayMainlineCount,
    ramps:audit.motorwayRampCount,validMotorwayMovements:audit.motorwayMovements,
    graphSources:audit.sourceEdges,graphSinks:audit.sinkEdges,
    rampSources:audit.rampSources,rampSinks:audit.rampSinks,
    isolatedRamps:audit.isolatedRamps,invalidTurns:audit.invalidMovements.length,
    viaWayRestrictions:audit.routeRestrictionCount
  },
  /** These are inspection targets, NOT automatically deemed errors:
   * the A3/A48 model is a finite corridor and intentionally ends at its bounds. */
  rampReview:unresolved,
  invalidTurns:audit.invalidMovements,
  assumptions:[
    'Ein offenes Rampenende am Rand des Ausschnitts ist nicht automatisch ein Fehler.',
    'Fehlende Straßen werden nicht nach Koordinatennähe verbunden.',
    'Via-way-Verkehrsbeschränkungen benötigen Fahrzeugweghistorien im späteren OD-Modell.'
  ]
};
await mkdir(dirname(resolve(target)),{recursive:true});
await writeFile(resolve(target),JSON.stringify(output,null,2)+'\n');
console.log('A3/A48-Rampenprüfung:',JSON.stringify(output.counts));
if(audit.invalidMovements.length)process.exitCode=1;
