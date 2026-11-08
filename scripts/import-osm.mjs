/** Reproduzierbarer Datenimport, unabhängig von Region oder Autobahnnummer.
 * npm run build && node scripts/import-osm.mjs data/region-osm.json
 * Erwartet OSM-JSON (elements:[node/way/relation...]) mit allen Knoten und
 * Abbiegerelationen des gewählten Gebietes. Niemals geometrische Lücken raten.
 */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {Strassennetz} from '../dist/index.js';

const args=process.argv.slice(2);
const input=args.find(s=>!s.startsWith('--'));
const outputArg=args.find(s=>s.startsWith('--output='));
const output=outputArg?.slice('--output='.length)??'data/generated-network.json';
const includePublicRoads=args.includes('--include-public');
if(!input){
  console.error('Verwendung: node scripts/import-osm.mjs SNAPSHOT.json [--include-public] [--output=DATEI.json]');
  process.exit(2);
}
try{
  const raw=JSON.parse(await readFile(resolve(input),'utf8'));
  const elements=Array.isArray(raw)?raw:raw.elements;
  if(!Array.isArray(elements))throw Error('Snapshot enthält kein elements-Array');
  // strict=true: unvollständige OSM-Knoten, Rampenenden oder Restriktionen
  // dürfen nicht als vollständig gezeichnetes Netz veröffentlicht werden.
  const {network,audit}=Strassennetz.importOsmNetwork(elements,{includePublicRoads,strict:true});
  await mkdir(dirname(resolve(output)),{recursive:true});
  await writeFile(resolve(output),JSON.stringify(network,null,2)+'\n');
  await writeFile(resolve(output+'.audit.json'),JSON.stringify(audit,null,2)+'\n');
  console.log('OSM Import erfolgreich:',JSON.stringify({
    mainlineWays:audit.importedMotorwayWays,
    motorwayLinkWays:audit.importedRampWays,
    directedEdges:audit.importedDirectedEdges,
    movements:audit.importedMovements,
    unrepresentedEdges:audit.unrepresentedSourceSegments.length,
    unresolvedRampEnds:audit.unconnectedRampEnds.length
  }));
}catch(error){
  console.error('OSM-Import gestoppt – Daten nicht als vollständig veröffentlicht:',error);
  process.exitCode=1;
}
