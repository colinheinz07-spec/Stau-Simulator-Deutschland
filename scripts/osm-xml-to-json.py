#!/usr/bin/env python3
"""Convert an Osmium-filtered OSM XML stream to compact Overpass-style JSON.

Bounded XML parser memory: nodes/ways/relations are written one at a time,
never held as one ElementTree. Node references and restriction relations are
preserved for src/01_Strassennetz/osm-import.ts.

Examples:
  osmium cat -f osm -o - filtered.osm.pbf | \
    python3 scripts/osm-xml-to-json.py - work/osm-elements.json.gz
  python3 scripts/osm-xml-to-json.py tests/fixtures/tiny.osm out.json
"""
import gzip
import json
import sys
import xml.etree.ElementTree as ET
from contextlib import nullcontext
from pathlib import Path


def xml_objects(stream):
    """Iterate only complete top-level OSM objects, without retaining the tree."""
    context = ET.iterparse(stream, events=("start", "end"))
    root = None
    for event, element in context:
        if event == "start" and root is None:
            if element.tag != "osm":
                raise ValueError("Erwartet OSM-XML mit <osm> als Wurzel")
            root = element
        if event != "end":
            continue
        if element.tag not in ("node", "way", "relation"):
            continue
        item = {"type": element.tag, "id": int(element.attrib["id"])}
        if element.tag == "node":
            item["lat"] = float(element.attrib["lat"])
            item["lon"] = float(element.attrib["lon"])
            node_tags = {tag.attrib["k"]: tag.attrib["v"] for tag in element.findall("tag")}
            if node_tags:
                item["tags"] = node_tags
        else:
            tags = {el.attrib["k"]: el.attrib["v"] for el in element.findall("tag")}
            if tags:
                item["tags"] = tags
            if element.tag == "way":
                item["nodes"] = [int(el.attrib["ref"]) for el in element.findall("nd")]
            else:
                item["members"] = [
                    {
                        "type": el.attrib["type"],
                        "ref": int(el.attrib["ref"]),
                        "role": el.attrib.get("role", ""),
                    }
                    for el in element.findall("member")
                ]
        yield item
        element.clear()
        if root is not None:
            root.clear()


def main():
    if len(sys.argv) != 3:
        raise SystemExit("Usage: osm-xml-to-json.py input.osm|- output.json[.gz]")
    src, target = sys.argv[1:]
    if src == "-":
        source = nullcontext(sys.stdin.buffer)
    elif src.endswith(".gz"):
        source = gzip.open(src, "rb")
    else:
        source = open(src, "rb")
    output = Path(target)
    output.parent.mkdir(parents=True, exist_ok=True)
    counts = {"node": 0, "way": 0, "relation": 0}
    outopen = gzip.open if target.endswith(".gz") else open
    with source as stream, outopen(output, "wt", encoding="utf-8") as handle:
        handle.write('{"elements":[')
        first = True
        for obj in xml_objects(stream):
            if not first:
                handle.write(",")
            handle.write(json.dumps(obj, separators=(",", ":"), ensure_ascii=False))
            counts[obj["type"]] += 1
            first = False
        handle.write("]}\n")
    print(json.dumps({"output": str(output), "objects": counts}), file=sys.stderr)


if __name__ == "__main__":
    main()
