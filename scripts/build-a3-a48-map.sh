#!/usr/bin/env bash
# Original OSM A3 Limburg-Nord–Siegburg and A48 AD Vulkaneifel–AD Dernbach.
# The geographic input rectangle is only a prefilter. No synthetic roads.
set -euo pipefail
if [[ $# -ne 1 ]]; then echo "Usage: bash scripts/build-a3-a48-map.sh OUTPUT_DIR" >&2; exit 2; fi
DEST="$1"
mkdir -p "$DEST"
DEST="$(cd "$DEST" && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
ROOT="$(pwd)"
for command in osmium node python3 curl; do
  if ! command -v "$command" >/dev/null; then echo "Missing $command" >&2; exit 1; fi
done

# Wide enough to fully include both requested roads and their interchanges.
BBOX="6.82,50.10,8.25,50.88"
cat > "$WORK/region.poly" <<'POLY'
A3 A48 Rohdatenausschnitt
1
 6.82 50.10
 8.25 50.10
 8.25 50.88
 6.82 50.88
 6.82 50.10
END
END
POLY

for state in rheinland-pfalz koeln-regbez hessen; do
  echo "Download OSM: $state"
  # Köln/Bonn/Siegburg lies in Regierungsbezirk Köln. Download only this
  # genuine NRW sub-region (about 215MB instead of NRW's ~874MB).
  region="$state"
  if [[ "$state" == "koeln-regbez" ]]; then region="nordrhein-westfalen/koeln-regbez"; fi
  curl -fLsS --retry 3 --retry-delay 4 --connect-timeout 25 --max-time 1200 \
    "https://download.geofabrik.de/europe/germany/$region-latest.osm.pbf" \
    -o "$WORK/$state.osm.pbf"
  test -s "$WORK/$state.osm.pbf"
  # Retain ORIGINAL motorway, ramp, connecting road and restriction data.
  osmium tags-filter "$WORK/$state.osm.pbf" \
    'w/highway=motorway,motorway_link' \
    'w/highway=trunk,trunk_link,primary,primary_link,secondary,secondary_link,tertiary,tertiary_link,unclassified,residential,living_street,service' \
    'r/type=restriction' \
    'r/route=road' \
    -o "$WORK/$state-roads.osm.pbf"
  rm -f "$WORK/$state.osm.pbf"
done

echo "OSM: Merge original state boundaries and duplicate node IDs"
osmium merge \
  "$WORK/rheinland-pfalz-roads.osm.pbf" \
  "$WORK/koeln-regbez-roads.osm.pbf" \
  "$WORK/hessen-roads.osm.pbf" \
  -o "$WORK/merged.osm.pbf"

echo "OSM: Keep complete source ways inside broad corridor bounds"
osmium extract --strategy complete_ways --bbox="$BBOX" \
  "$WORK/merged.osm.pbf" -o "$WORK/corridor.osm.pbf"

echo "OSM: Preserve all original geometry and relations"
osmium cat "$WORK/corridor.osm.pbf" -f osm -o - |
  python3 "$ROOT/scripts/osm-xml-to-json.py" - "$WORK/corridor.json.gz"

# Unlike full-production mode, map-preview preserves a diagnostic audit for
# cut source edges instead of failing to show real, verified OSM lines.
echo "OSM: Build real directed graph with detailed preview audit"
node --max-old-space-size=6144 "$ROOT/scripts/import-osm.mjs" \
  "$WORK/corridor.json.gz" --include-public --map-preview \
  --boundary-poly="$WORK/region.poly" \
  "--output=$DEST/corridor-source.json"

echo "OSM: Select actual A3/A48 mainlines and all attached ramp chains"
node "$ROOT/scripts/select-motorway-corridor.mjs" \
  "$DEST/corridor-source.json" "$DEST/selected-network.json" \
  --refs=A3,A48 --bbox="$BBOX"

echo "MAP: Prepare viewport tiles with shared map/simulation edge IDs"
node "$ROOT/scripts/shard-network.mjs" \
  "$DEST/selected-network.json" "--output-dir=$DEST/tiles" --tile-degrees=.20

echo "MAP: Verify both motorway refs and original ramp geometry are populated"
node - "$DEST/selected-network.json" "$DEST/tiles/manifest.json" <<'NODE'
const fs=require('node:fs');
const graph=JSON.parse(fs.readFileSync(process.argv[2]));
const manifest=JSON.parse(fs.readFileSync(process.argv[3]));
for(const ref of ['A3','A48']){
  const main=graph.edges.filter(e=>e.kind==='mainline' &&
    (e.motorwayRefs??[e.motorwayRef]).includes(ref));
  if(main.length<30)throw Error('Real motorway segments absent: '+ref+' count='+main.length);
}
const ramps=graph.edges.filter(e=>e.kind==='ramp');
if(ramps.length<20)throw Error('Original OSM ramps absent: '+ramps.length);
if(manifest.counts.uniqueEdges!==graph.edges.length)throw Error('Tile count mismatch');
console.log(JSON.stringify({a3:graph.edges.filter(e=>e.kind==='mainline'&&
 (e.motorwayRefs??[e.motorwayRef]).includes('A3')).length,
 a48:graph.edges.filter(e=>e.kind==='mainline'&&
 (e.motorwayRefs??[e.motorwayRef]).includes('A48')).length,
 ramps:ramps.length,tiles:manifest.counts.tiles},null,2));
NODE
echo "Map build complete: $DEST/tiles/manifest.json"
