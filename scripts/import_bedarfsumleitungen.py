#!/usr/bin/env python3
"""Import German signed motorway diversions from OSM and the regional wiki.
No fabricated geometries. Incomplete/disconnected relations are map-only.
"""
import html, json, math, re, time, urllib.request, urllib.parse
from pathlib import Path
from html.parser import HTMLParser
from repair_detour_geometry import repair_route,connect,meters

ROOT="https://wiki.openstreetmap.org/wiki/DE:Germany/Bedarfsumleitung"
UA="Stau-Simulator-Deutschland/1.0 (https://github.com/colinheinz07-spec/Stau-Simulator-Deutschland)"
ENDPOINTS=["https://overpass-api.de/api/interpreter","https://overpass.kumi.systems/api/interpreter"]
OUT=Path("web/data/bedarfsumleitungen-data.js")
EVIDENCE=Path("scripts/bedarfsumleitungen-evidence.json")
RESEARCH=Path("web/data/bedarfsumleitungen-research.json")
def official_evidence():
    return json.loads(EVIDENCE.read_text(encoding="utf-8"))
def known_ramps():
    p=Path("web/legacy-geometry.js")
    if not p.exists():return {}
    data=json.loads(p.read_text(encoding="utf-8").split("window.STAU_LEGACY_GEOMETRY=",1)[1].strip().rstrip(";"))
    return {r[0]:r for r in data["roads"] if r[1]=="ramp"}
def research_record(route):
    query=" ".join(str(x) for x in [route.get("motorway") or " ".join(route.get("motorways",[])),route.get("ref"),route.get("from"),route.get("to")] if x and x not in ("AS","?"))
    return {**{k:route.get(k) for k in ("id","ref","motorway","motorways","from","to","region","notes","geometryStatus")},
            "searchQueries":[query+" Bedarfsumleitung Autobahn GmbH",query+" Umleitungsstrecke Straßenbau Geoportal"],
            "status":"needs-source-review"}
def repair_candidates(routes,evidence):
    ramps=known_ramps();budget=16;cache={}
    def fetch(a,b):
        nonlocal budget
        if budget<=0:return None
        # Small targeted requests only, with room for real road curvature.
        pad=min(.055,max(.012,meters(a,b)/111195*.45))
        bounds=(min(a[0],b[0])-pad,min(a[1],b[1])-pad,min(a[0],b[0])+pad,max(a[1],b[1])+pad)
        k=tuple(round(v,3) for v in bounds)
        if k not in cache:
            budget-=1
            bbox=",".join(str(v) for v in bounds)
            q='[out:json][timeout:60];way["highway"~"^(trunk|primary|secondary|tertiary|unclassified|residential|living_street|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link)$"]('+bbox+');out geom;'
            try:cache[k]=overpass(q)
            except Exception as exc:
                print("Repair deferred",a,b,exc,flush=True);cache[k]=[]
        return connect(cache[k],a,b)
    for i,r in sorted(enumerate(routes),key=lambda item:(not bool(item[1].get("officialEvidence")),len(item[1].get("parts",[]))==1)):
        if budget<=0:break
        e=evidence.get(str(r["id"]),{})
        anchors=None
        if e.get("exitEdge") in ramps and e.get("entryEdge") in ramps:
            exit,entry=ramps[e["exitEdge"]],ramps[e["entryEdge"]]
            if exit[2]==e.get("fromMotorway",e.get("motorway")) and entry[2]==e.get("toMotorway",e.get("motorway")) and "Abfahrt" in exit[5] and "Auffahrt" in entry[5]:
                anchors=(exit[4][-1],entry[4][0])
        if r["eligible"] or (len(r["parts"])<2 and not anchors):continue
        routes[i]=repair_route(r,fetch,anchors)
        if routes[i].get("inferredParts"):print("Reconstructed",r["ref"],r["id"],routes[i]["geometryStatus"],flush=True)

def get(url, data=None, timeout=200):
    req=urllib.request.Request(url,data=data,headers={"User-Agent":UA,"Accept":"application/json,text/html"})
    with urllib.request.urlopen(req,timeout=timeout) as response:
        return response.read().decode("utf-8")
def overpass(query):
    payload=urllib.parse.urlencode({"data":query}).encode()
    for attempt in range(6):
        try:
            result=json.loads(get(ENDPOINTS[attempt%len(ENDPOINTS)],payload))
            if result.get("remark"): raise RuntimeError(result["remark"])
            return result["elements"]
        except Exception as exc:
            print("Overpass retry",attempt+1,exc,flush=True)
            time.sleep(10*(attempt+1))
    raise RuntimeError("Overpass import failed; previous dataset preserved")
def relation_id(link):
    m=re.search(r"(?:osm\.org|openstreetmap\.org)/(?:browse/)?relation/(\d+)",link)
    if not m: m=re.search(r"/relation/(\d+)(?:[/?#]|$)",link)
    return int(m.group(1)) if m else None
class Wiki(HTMLParser):
    def __init__(self):
        super().__init__(); self.links=set(); self.rows={}; self.unmapped=[]; self.heading=None
        self.heading_text=""; self.motorway=""; self.direction=""; self.row=None; self.cell=None
    def handle_starttag(self,tag,attrs):
        a=dict(attrs)
        if tag in ("h2","h3","h4"):
            self.heading=tag; self.heading_text=""
        if tag=="tr": self.row=[];self.ids=set()
        if tag in ("td","th") and self.row is not None: self.cell=""
        if tag=="a":
            link=html.unescape(a.get("href",""))
            absolute=urllib.parse.urljoin(ROOT,link)
            path=urllib.parse.unquote(urllib.parse.urlsplit(absolute).path)
            if "wiki.openstreetmap.org" in absolute and re.match(r"^/wiki/(?:DE:)?(?:Germany|WikiProject_Germany)/Bedarfsumleitung/[^/]+$",path):
                self.links.add(absolute.split("#")[0])
            rid=relation_id(link)
            if rid and rid>0 and self.row is not None and len(self.row)==4: self.ids.add(rid)
        if tag=="img" and self.cell is not None:
            self.cell+=" "+a.get("alt","")+" "+a.get("title","")
    def handle_data(self,data):
        if self.heading: self.heading_text+=data
        if self.cell is not None: self.cell+=data
    def handle_endtag(self,tag):
        if tag==self.heading:
            h=" ".join(self.heading_text.split()); m=re.search(r"\bA\s*(\d+)\b",h)
            if tag=="h2": self.motorway="A"+m.group(1) if m else "";self.direction=""
            if tag in ("h3","h4"):
                if m: self.motorway="A"+m.group(1)
                self.direction=h
            self.heading=None
        if tag in ("td","th") and self.cell is not None and self.row is not None:
            self.row.append(" ".join(self.cell.split()));self.cell=None
        if tag=="tr" and self.row is not None:
            c=self.row
            if c and re.match(r"^U\s*\d+",c[0],re.I) and not re.search(r"gibt es nicht|keine Bedarfsumleitung beschildert|aufgehoben", " ".join(c[5:7]),re.I):
                record={"ref":c[0],"motorway":self.motorway,
                        "from":c[2] if len(c)>2 else "", "to":c[3] if len(c)>3 else "",
                        "direction":self.direction,"destination":c[1] if len(c)>1 else "",
                        "notes":" ".join(c[5:7])}
                for rid in self.ids: self.rows[rid]=record
                if not self.ids: self.unmapped.append(record)
            self.row=None;self.cell=None
def wiki_catalogue():
    index=Wiki();index.feed(get(ROOT))
    expected=["Baden-Württemberg","Bayern","Bayern2","Berlin und Brandenburg","Niedersachsen und Bremen","Hamburg","Hessen","Mecklenburg-Vorpommern","Nordrhein-Westfalen","Rheinland-Pfalz","Saarland","Sachsen","Sachsen-Anhalt","Schleswig-Holstein","Thüringen"]
    pages={urllib.parse.unquote(urllib.parse.urlsplit(link).path).split("/")[-1].replace("_"," "):link for link in index.links}
    records={};unmapped=[];coverage={}
    for region in expected:
        page=pages.get(region,ROOT+"/"+urllib.parse.quote(region.replace(" ","_")))
        parser=Wiki();parser.feed(get(page))
        if not parser.rows and not parser.unmapped:
            raise RuntimeError("Regional catalogue empty: "+region)
        for rid,row in parser.rows.items():
            previous=records.get(rid)
            if previous:
                previous["regions"]=sorted(set(previous.get("regions",[previous["region"]])+[region]))
                if len(row.get("from",""))+len(row.get("to",""))>len(previous.get("from",""))+len(previous.get("to","")):
                    previous.update({**row,"region":region})
            else: records[rid]={**row,"region":region,"regions":[region]}
        unmapped.extend({**row,"region":region} for row in parser.unmapped)
        coverage[region]={"relations":len(parser.rows),"withoutRelation":len(parser.unmapped)}
        print(page,coverage[region],flush=True);time.sleep(.3)
    if len(records)<100: raise RuntimeError("Wiki relation catalogue unexpectedly small")
    return records,unmapped,coverage
def distance(a,b):
    p,q=math.radians(a[0]),math.radians(b[0])
    dlat=q-p;dlon=math.radians(b[1]-a[1])
    return 12742000*math.asin(min(1,math.sqrt(math.sin(dlat/2)**2+math.cos(p)*math.cos(q)*math.sin(dlon/2)**2)))
def simplify(points, tolerance=12):
    if len(points)<=2:return points
    # Iterative Douglas-Peucker in local metres, preserve every part endpoint.
    keep={0,len(points)-1};stack=[(0,len(points)-1)]
    lat=math.radians(points[0][0]);kx=111320*math.cos(lat);ky=111320
    while stack:
        a,b=stack.pop();p,q=points[a],points[b]
        dx=(q[1]-p[1])*kx;dy=(q[0]-p[0])*ky;den=dx*dx+dy*dy
        far=tolerance*tolerance;index=None
        for i in range(a+1,b):
            x=(points[i][1]-p[1])*kx;y=(points[i][0]-p[0])*ky
            t=max(0,min(1,(x*dx+y*dy)/den)) if den else 0
            d=(x-t*dx)**2+(y-t*dy)**2
            if d>far:far=d;index=i
        if index is not None:
            keep.add(index);stack.extend(((a,index),(index,b)))
    return [points[i] for i in sorted(keep)]
def join(ways,reverse=False):
    if not ways:return []
    parts=[ways[0][::-1] if reverse else ways[0][:]]
    for way in ways[1:]:
        if parts[-1][-1]==way[0]:parts[-1].extend(way[1:])
        elif parts[-1][-1]==way[-1]:parts[-1].extend(way[-2::-1])
        else:parts.append(way[:])
    return parts
def convert(element,meta):
    tags=element.get("tags",{}); rid=element["id"]
    ref=tags.get("ref") or meta.get("ref") or tags.get("name","")
    m=re.search(r"\bU\s*(\d+[a-z]?)\b",ref,re.I)
    if not m:return None
    ref="U "+m.group(1)
    motor=" ".join([tags.get("detour",""),meta.get("motorway",""),tags.get("name","")])
    motors=sorted(set("A"+x for x in re.findall(r"\bA\s*(\d+)\b",motor,re.I)))
    members=[m for m in element.get("members",[]) if m.get("type")=="way"]
    ways=[]
    for member in members:
        points=[(round(p["lat"],6),round(p["lon"],6)) for p in member.get("geometry",[]) if p and "lat" in p and "lon" in p]
        if len(points)>=2:ways.append(points)
    if not ways:return None
    parts=min((join(ways),join(ways,True)),key=len)
    length=sum(distance(a,b) for p in parts for a,b in zip(p,p[1:]))
    official=meta.get("officialEvidence")
    start=meta.get("from") if official else tags.get("from") or meta.get("from","")
    end=meta.get("to") if official else tags.get("to") or meta.get("to","")
    # A connected line is necessary but not sufficient for an audited route.
    uncertain=bool(re.search(r"angefangen|begonnen|unvollständig|gelöscht|unsicher|stummel|nicht fertig|nicht mehr|nur.*(?:anfang|ende)|an ausfahrt gesichtet|relation\s*\([0123]/4\)",meta.get("notes",""),re.I))
    complete=(not uncertain and not (official and official.get("exitEdge")) and len(parts)==1 and len(ways)==len(members) and
              not any(x.get("type")=="relation" for x in element.get("members",[])) and
              bool(motors and start and end and re.search(r"[A-Za-zÄÖÜäöüß]{3}",start) and re.search(r"[A-Za-zÄÖÜäöüß]{3}",end)))
    def endpoint_ref(value):
        refs=set("A"+n for n in re.findall(r"\bA\s*(\d+)\b",value or "",re.I))
        return next(iter(refs)) if len(refs)==1 else ""
    from_motorway=meta.get("fromMotorway") or endpoint_ref(start) or (motors[0] if len(motors)==1 else "")
    to_motorway=meta.get("toMotorway") or endpoint_ref(end) or (motors[0] if len(motors)==1 else "")
    motors=sorted(set(motors+[m for m in (from_motorway,to_motorway) if m]))
    return {"id":rid,"ref":ref,"motorways":motors,"from":start,"to":end,
        "fromMotorway":from_motorway,"toMotorway":to_motorway,
        "destination":tags.get("destination") or meta.get("destination",""),
        "direction":meta.get("direction",""),"operator":tags.get("operator",""),
        "region":meta.get("region",""),"regions":meta.get("regions",[]),"notes":meta.get("notes",""),
        "lengthM":round(length),"connected":len(parts)==1,"eligible":complete,
        "officialEvidence":official,"geometryStatus":"mapped" if complete else "incomplete",
        "parts":[simplify(p) for p in parts]}
def main():
    catalogue,unmapped,coverage=wiki_catalogue()
    evidence=official_evidence()
    verified=evidence.get("relations",{})
    for rid,record in verified.items():
        previous=catalogue.get(int(rid),{})
        catalogue[int(rid)]={**previous,**record,"notes":previous.get("notes","")+" "+record.get("notes",""),"officialEvidence":record}
    query='[out:json][timeout:120];area(3600051477)->.de;(rel["type"="route"]["route"="detour"](area.de);rel["type"="route"]["ref"~"^U ?[0-9]+[a-zA-Z]?$"]["detour"](area.de);rel["type"="route"]["ref"~"^U ?[0-9]+[a-zA-Z]?$"]["route"="road"](area.de););out ids;'
    ids=set(catalogue)|{e["id"] for e in overpass(query) if e["type"]=="relation"}
    print("Relation IDs",len(ids),flush=True)
    result=[];returned=set();ordered=sorted(ids)
    for start in range(0,len(ordered),60):
        batch=ordered[start:start+60]
        q="[out:json][timeout:120];rel(id:"+",".join(map(str,batch))+");out geom;"
        for element in overpass(q):
            if element.get("type")!="relation":continue
            returned.add(element["id"])
            route=convert(element,catalogue.get(element["id"],{}))
            if route:result.append(route)
        print("Imported",start+len(batch),"/",len(ordered),flush=True);time.sleep(2)
    if len(result)<100 or len(returned)<.8*len(ids):raise RuntimeError("Dataset incomplete; old data retained")
    repair_candidates(result,verified)
    result.sort(key=lambda r:r["id"])
    known_ids={r["id"] for r in result}
    review=[research_record(r) for r in result if not r["eligible"] or r.get("inferredParts")]
    review.extend(research_record(r) for r in unmapped)
    review.extend(research_record({"id":rid,**catalogue[rid]}) for rid in sorted(set(catalogue)-known_ids))
    data={"schema":1,"source":"OpenStreetMap contributors","license":"ODbL-1.0",
          "wiki":"https://wiki.openstreetmap.org/wiki/DE:Germany/Bedarfsumleitung",
          "wikiLicense":"CC BY-SA 2.0","requested":len(ids),"missing":sorted(ids-returned),
          "coverage":coverage,"unmapped":unmapped,"unmappedRelations":[{"id":rid,**catalogue[rid]} for rid in sorted(set(catalogue)-{r["id"] for r in result})],
          "officialSources":evidence.get("sources",[]),"routes":result}
    OUT.parent.mkdir(parents=True,exist_ok=True)
    tmp=OUT.with_suffix(".tmp")
    tmp.write_text("window.StauBedarfsumleitungen.install("+json.dumps(data,ensure_ascii=False,separators=(",",":"))+");\n",encoding="utf-8")
    tmp.replace(OUT)
    RESEARCH.write_text(json.dumps({"schema":1,"officialSources":evidence.get("sources",[]),"unresolved":review},ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print("Routes:",len(result),"connected eligible:",sum(r["eligible"] for r in result),flush=True)
if __name__=="__main__":main()
