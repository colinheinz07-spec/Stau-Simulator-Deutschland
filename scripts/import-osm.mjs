/** Reproduzierbarer Datenimport, unabhängig von Region oder Autobahnnummer.
 * npm run build && node scripts/import-osm.mjs data/region-osm.json
 * Erwartet OSM-JSON (elements:[node/way/relation...]) mit allen Knoten und
 * Abbiegerelationen des gewählten Gebietes. Niemals geometrische Lücken raten.
 */
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {gunzipSync} from 'node:zlib';
import {Strassennetz} from '../dist/index.js';

const args=process.argv.slice(2);
const input=args.find(s=>!s.startsWith('--'));
const outputArg=args.find(s=>s.startsWith('--output='));
const output=outputArg?.slice('--output='.length)??'data/generated-network.json';
const includePublicRoads=args.includes('--include-public');
// Map-only preview: preserve unresolved snapshot audit, but NEVER allow invalid
// graph structure, invented coordinates or missing rendered source segments.
const mapPreview=args.includes('--map-preview');
const boundaryFile=args.find(s=>s.startsWith('--boundary-poly='))?.slice('--boundary-poly='.length);
if(!input){
  console.error('Verwendung: node scripts/import-osm.mjs SNAPSHOT.json [--include-public] [--output=DATEI.json]');
  process.exit(2);
}
try{
  const bytes=await readFile(resolve(input));
  const raw=JSON.parse(input.endsWith('.gz')?gunzipSync(bytes).toString('utf8'):bytes.toString('utf8'));
  const elements=Array.isArray(raw)?raw:raw.elements;
  if(!Array.isArray(elements))throw Error('Snapshot enthält kein elements-Array');
  // Always produce the detailed audit, even when strict import would fail.
  // Only publish the graph after ALL geometry and topology checks pass.
  const extractBoundaryRings=boundaryFile?
    Strassennetz.parseOsmosisPoly(await readFile(resolve(boundaryFile),'utf8')):undefined;
  const {network,audit}=Strassennetz.importOsmNetwork(elements,{includePublicRoads,strict:false,
    ...(extractBoundaryRings?{extractBoundaryRings}:{})});
  await mkdir(dirname(resolve(output)),{recursive:true});
  const fatal=Strassennetz.validateNetwork(network);
  if (fatal.length || audit.unrepresentedSourceSegments.length || (audit.issues.length && !mapPreview)) {
    const failed=resolve(output+'.failed-audit.json');
    await writeFile(failed,JSON.stringify(audit,null,2)+'\n');
    throw Error('OSM-Netzimport nicht veröffentlichbar: '+audit.issues.length+
      ' Geometrie-/Topologiefehler. Prüfbericht: '+failed+
      '\n'+audit.issues.slice(0,8).join('\n'));
  }
  // Atomic replacement: no half-written graph if disk IO is interrupted.
  const temporary=resolve(output+'.tmp');
  await writeFile(temporary,JSON.stringify(network)+'\n');
  await rename(temporary,resolve(output));
  await writeFile(resolve(output+'.audit.json'),JSON.stringify(audit,null,2)+'\n');
  console.log('OSM Import erfolgreich:',JSON.stringify({
    mainlineWays:audit.importedMotorwayWays,
    motorwayLinkWays:audit.importedRampWays,
    directedEdges:audit.importedDirectedEdges,
    movements:audit.importedMovements,
    unrepresentedEdges:audit.unrepresentedSourceSegments.length,
    unresolvedRampEnds:audit.unconnectedRampEnds.length,
    verifiedExtractBoundaryRampEnds:audit.extractBoundaryRampEnds.length,
    mapPreview,previewWarnings:audit.issues.length
  }));
}catch(error){
  console.error('OSM-Import gestoppt – Daten nicht als vollständig veröffentlicht:',error);
  process.exitCode=1;
}
