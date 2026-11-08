#!/usr/bin/env bash
# Build full OSM Germany graph on a workstation/server, not in phone/SPCK.
set -euo pipefail
help() {
 cat <<'HELP'
Deutschlandnetz erstellen (kein fest codiertes Autobahngebiet):
 bash scripts/build-germany-network.sh /path/to/germany-latest.osm.pbf /path/to/output-directory [--include-public] [--boundary-poly=country.poly]

Source: https://download.geofabrik.de/europe/germany-latest.osm.pbf
Requirements: osmium-tool, Python 3, Node 22+, npm install, npm run build.
The Germany raw source is multi-GB. Do not commit it to the repository.
With --include-public, include the original public-road geometry for detours.
Without that flag, public ways are only used to verify ramp termini.
HELP
}
if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then help; exit 0; fi
if [[ $# -lt 2 ]]; then help >&2; exit 2; fi
PBF="$1"
OUTPUT="$2"
shift 2
INCLUDE=""
BOUNDARY=""
for flag in "$@"; do
 case "$flag" in
   --include-public) INCLUDE="--include-public" ;;
   --boundary-poly=*) BOUNDARY="$flag" ;;
   *) echo "Invalid flag: $flag" >&2; exit 2 ;;
 esac
done
for cmd in osmium python3 node sha256sum mktemp; do
 if ! command -v "$cmd" >/dev/null 2>&1; then
   echo "Missing command: $cmd" >&2; exit 1
 fi
done
if [[ ! -s "$PBF" || "$PBF" != *.osm.pbf ]]; then
 echo "Provide an existing nonempty .osm.pbf file: $PBF" >&2; exit 1
fi
mkdir -p "$OUTPUT"
OUTPUT="$(cd "$OUTPUT" && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
printf '%s\n' "OSM source: $PBF"
echo "Step 1/5: preserve all motorways, motorway_links, connecting roads, turn restrictions"
# IMPORTANT: no osmium -R: referred nodes and restriction members must remain.
osmium tags-filter "$PBF" \
 'w/highway=motorway,motorway_link' \
 'w/highway=trunk,trunk_link,primary,primary_link,secondary,secondary_link,tertiary,tertiary_link,unclassified,residential,living_street,service' \
 'r/type=restriction' \
 'r/route=road' \
 -o "$WORK/highways.osm.pbf"
echo "Step 2/5: convert selected source to compressed node/way/restriction JSON"
osmium cat "$WORK/highways.osm.pbf" -f osm -o - |
 python3 scripts/osm-xml-to-json.py - "$WORK/elements.json.gz"
echo "Step 3/5: create directed network, audit every ramp endpoint and all source segments"
IMPORT_FLAGS=()
if [[ "$INCLUDE" == "--include-public" ]]; then IMPORT_FLAGS+=("--include-public"); fi
if [[ -n "$BOUNDARY" ]]; then IMPORT_FLAGS+=("$BOUNDARY"); fi
node --max-old-space-size=8192 scripts/import-osm.mjs "$WORK/elements.json.gz" \
 "${IMPORT_FLAGS[@]}" "--output=$OUTPUT/generated-network.json"
echo "Step 4/5: build lazy-loaded stable-ID map tiles"
node --max-old-space-size=8192 scripts/shard-network.mjs \
 "$OUTPUT/generated-network.json" "--output-dir=$OUTPUT/tiles"
echo "Step 5/5: record ODbL provenance"
SOURCE_SHA="$(sha256sum "$PBF" | cut -d' ' -f1)"
python3 - "$OUTPUT/source-metadata.json" "$SOURCE_SHA" "$PBF" <<'PY'
import datetime,json,sys
out,sha,path=sys.argv[1:]
obj={
 "source":"Geofabrik / OpenStreetMap Germany PBF",
 "sourceUrl":"https://download.geofabrik.de/europe/germany-latest.osm.pbf",
 "sourceSha256":sha,
 "sourceFilename":path.split("/")[-1],
 "generatedAtUtc":datetime.datetime.now(datetime.timezone.utc).isoformat(),
 "dataLicense":"ODbL 1.0",
 "attribution":"© OpenStreetMap contributors",
 "attributionUrl":"https://www.openstreetmap.org/copyright"
}
with open(out,"w",encoding="utf-8") as stream:
 json.dump(obj,stream,indent=2,ensure_ascii=False)
 stream.write("\n")
PY
echo "Graph and tiles created. See generated-network.json.audit.json and tiles/manifest.json"
