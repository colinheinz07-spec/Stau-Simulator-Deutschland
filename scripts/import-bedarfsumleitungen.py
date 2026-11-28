#!/usr/bin/env python3
"""Nationwide signed motorway diversion import; partial results are explicit.
OSM geometry: ODbL. Wiki catalogue: CC BY-SA 2.0.
No fabricated road segments or guessed official status.
"""
import html, json, math, re, time, urllib.request, urllib.parse, os
from pathlib import Path
from html.parser import HTMLParser
from repair_detour_geometry import repair_route, connect, meters

ROOT="https://wiki.openstreetmap.org/wiki/DE:Germany/Bedarfsumleitung"
REGIONS=["Baden-Württemberg","Bayern","Bayern2","Berlin und Brandenburg","Niedersachsen und Bremen","Hamburg","Hessen","Mecklenburg-Vorpommern","Nordrhein-Westfalen","Rheinland-Pfalz","Saarland","Sachsen","Sachsen-Anhalt","Schleswig-Holstein","Thüringen"]
UA="Stau-Simulator-Deutschland/1.0 (https://github.com/colinheinz07-spec/Stau-Simulator-Deutschland)"
ENDPOINTS=["https://overpass-api.de/api/interpreter","https://overpass.kumi.systems/api/interpreter","https://overpass.private.coffee/api/interpreter"]
OUT=Path("web/data/bedarfsumleitungen-data.js")
REVIEW=OUT.with_name("bedarfsumleitungen-research.json")
def get(url,data=None,timeout=100):
    req=urllib.request.Request(url,data=data,headers={"User-Agent":UA,"Accept":"application/json,text/html"})
    with urllib.request.urlopen(req,timeout=timeout) as r:return r.read().decode("utf-8")
def overpass(q,attempts=3):
    for i in range(attempts):
        try:
            response=json.loads(get(ENDPOINTS[i%len(ENDPOINTS)],urllib.parse.urlencode({"data":q}).encode(),timeout=100))
            if response.get("remark"):raise RuntimeError(response["remark"])
            return response["elements"]
        except Exception as ex:
            print("Overpass attempt",i+1,str(ex),flush=True)
            if i+1<attempts:time.sleep(3*(i+1))
    raise RuntimeError("Overpass unavailable")
class Wiki(HTMLParser):
    def __init__(self):
        super().__init__();self.rows={};self.unmapped=[];self.row=None;self.cell=None
        self.heading=None;self.h="";self.motorway="";self.direction="";self.ids=set()
    def handle_starttag(self,tag,attrs):
        a=dict(attrs)
        if tag in ("h2","h3","h4"):self.heading=tag;self.h=""
        if tag=="tr":self.row=[];self.ids=set()
        if tag in ("td","th") and self.row is not None:self.cell=""
        if tag=="img" and self.cell is not None:self.cell+=" "+a.get("alt","")+" "+a.get("title","")
        if tag=="a" and self.row is not None:
            link=html.unescape(a.get("href",""))
            m=re.search(r"/(?:browse/)?relation/(\d+)(?:[/?#]|$)",link)
            if m and int(m.group(1))>0:self.ids.add(int(m.group(1)))
    def handle_data(self,data):
        if self.heading:self.h+=data
        if self.cell is not None:self.cell+=data
    def handle_endtag(self,tag):
        if self.heading==tag:
            h=" ".join(self.h.split());m=re.search(r"\bA\s*(\d+)\b",h)
            if tag=="h2":self.motorway="A"+m.group(1) if m else "";self.direction=""
            elif tag in ("h3","h4"):
                if m:self.motorway="A"+m.group(1)
                self.direction=h
            self.heading=None
        if tag in ("td","th") and self.row is not None and self.cell is not None:
            self.row.append(" ".join(self.cell.split()));self.cell=None
        if tag=="tr" and self.row is not None:
            c=self.row
            if c and re.match(r"^U\s*\d+[a-z]?\b",c[0],re.I):
                row={"ref":c[0],"motorway":self.motorway,"direction":self.direction,"destination":c[1] if len(c)>1 else "",
                    "from":c[2] if len(c)>2 else "","to":c[3] if len(c)>3 else "","notes":" ".join(c[5:7])}
                if self.ids:
                    for rid in self.ids:self.rows[rid]=row
                else:self.unmapped.append(row)
            self.row=None;self.cell=None
def catalog():
    records={};unmapped=[];coverage={}
    for region in REGIONS:
        try:
            url=ROOT+"/"+urllib.parse.quote(region.replace(" ","_"))
            p=Wiki();p.feed(get(url))
            if not p.rows and not p.unmapped:raise ValueError("empty catalogue")
            for rid,row in p.rows.items():
                old=records.get(rid)
                if old:
                    old["regions"]=sorted(set(old["regions"]+[region]))
                    if len(row["from"])+len(row["to"])>len(old["from"])+len(old["to"]):old.update(row)
                else:records[rid]={**row,"region":region,"regions":[region]}
            unmapped.extend({**r,"region":region} for r in p.unmapped)
            coverage[region]={"relations":len(p.rows),"withoutRelation":len(p.unmapped),"status":"read"}
        except Exception as e:
            coverage[region]={"status":"failed","error":str(e)}
        print(region,coverage[region],flush=True)
    return records,unmapped,coverage
def ref(value):
    m=re.search(r"\bA\s*(\d+)\b",value or "",re.I)
    return "A"+m.group(1) if m else ""
def known_name(s):
    return bool(re.search(r"[A-Za-zÄÖÜäöüß]{3}",re.sub(r"\b(?:AS|AK|AD)\b","",s or "")))
def dist(parts):return round(sum(meters(a,b) for p in parts for a,b in zip(p,p[1:])))
def valid_way(w):
    t=w.get("tags",{})
    return t.get("highway") in {"motorway","motorway_link","trunk","trunk_link","primary","primary_link","secondary","secondary_link","tertiary","tertiary_link","unclassified","residential","living_street"} and not any(t.get(k) in {"no","private","destination","agricultural","forestry","customers"} for k in ("access","motor_vehicle","motorcar","vehicle"))
def oriented_parts(members,ways):
    """Orient ordered relation members by shared OSM node IDs and one-way rules.
    Select the longest connected legal chain without pretending gaps are roads."""
    states=[([],[],[])]
    for member in members:
        w=ways.get(member["ref"])
        if not w or not valid_way(w):return [],False
        nodes=w.get("nodes",[]);geo=w.get("geometry",[])
        if len(nodes)!=len(geo) or len(nodes)<2 or any(not p for p in geo):return [],False
        p=[(round(g["lat"],7),round(g["lon"],7)) for g in geo]
        t=w["tags"];one=t.get("oneway","yes" if t.get("highway")=="motorway" or t.get("junction")=="roundabout" else "no")
        role=member.get("role","")
        signs=[]
        if one not in ("-1","reversible","alternating") and role!="backward":signs.append(1)
        if one not in ("yes","1","true","reversible","alternating") and role!="forward":signs.append(-1)
        if not signs:return [],False
        candidates=[]
        for paths,ends,parts in states:
            for sign in signs:
                n=nodes if sign==1 else nodes[::-1];points=p if sign==1 else p[::-1]
                if ends and ends[-1]==n[0]:
                    candidates.append((paths+[sign],ends[:-1]+[n[-1]],parts[:-1]+[parts[-1]+points[1:]]))
                else:candidates.append((paths+[sign],ends+[n[-1]],parts+[points]))
        candidates.sort(key=lambda x:len(x[2]))
        # retain both orientation hypotheses at the current end node
        states=[];seen=set()
        for c in candidates:
            key=(c[1][-1],c[0][0])
            if key not in seen:states.append(c);seen.add(key)
    if not states:return [],False
    states.sort(key=lambda c:len(c[2]))
    best=states[0];unique=len(states)==1 or len(states[1][2])>len(best[2])
    return best[2],unique
def convert(e,meta,ways):
    t=e.get("tags",{});rid=e["id"]
    m=re.search(r"\bU\s*(\d+[a-z]?)\b",meta.get("ref") or t.get("ref") or t.get("name",""),re.I)
    if not m:return None
    official=meta.get("officialEvidence")
    start=meta.get("from") if official else t.get("from") or meta.get("from","")
    end=meta.get("to") if official else t.get("to") or meta.get("to","")
    motorways=sorted(set("A"+n for n in re.findall(r"\bA\s*(\d+)\b"," ".join([t.get("detour",""),t.get("name",""),meta.get("motorway",""),start or "",end or ""]),re.I)))
    fallback=motorways[0] if len(motorways)==1 else ""
    src=meta.get("fromMotorway") or ref(start) or fallback
    dst=meta.get("toMotorway") or ref(end) or fallback
    members=[m for m in e.get("members",[]) if m.get("type")=="way"]
    parts,unique=oriented_parts(members,ways)
    if not parts:return None
    notes=meta.get("notes","")
    uncertain=bool(re.search(r"angefangen|begonnen|unvollständig|gelöscht|unsicher|stummel|nicht fertig|nicht mehr|ein anfang|nur.*(?:anfang|ende)|relation\s*\([0123]/4\)",notes,re.I))
    complete=bool(len(parts)==1 and src and dst and known_name(start) and known_name(end) and not uncertain and not any(m.get("type")=="relation" for m in e.get("members",[])))
    return {"id":rid,"ref":"U "+m.group(1),"motorways":motorways,"fromMotorway":src,"toMotorway":dst,
        "from":start,"to":end,"destination":t.get("destination") or meta.get("destination",""),"direction":meta.get("direction",""),
        "region":meta.get("region",""),"regions":meta.get("regions",[]),"notes":notes,"officialEvidence":official,
        "lengthM":dist(parts),"parts":parts,"connected":len(parts)==1,"eligible":complete,"geometryStatus":"mapped" if complete else "incomplete",
        "directedGeometry":unique and len(parts)==1}
def atomic(path,content):
    path.parent.mkdir(parents=True,exist_ok=True)
    tmp=path.with_suffix(path.suffix+".tmp");tmp.write_text(content,encoding="utf-8");tmp.replace(path)
def old_data():
    if not OUT.exists():return {}
    try:return json.loads(OUT.read_text(encoding="utf-8").strip().removeprefix("window.StauBedarfsumleitungen.install(").removesuffix(");"))
    except Exception:return {}
def repair(routes,evidence):
    p=Path("web/legacy-geometry.js")
    ramps={}
    if p.exists():
        d=json.loads(p.read_text(encoding="utf-8").split("window.STAU_LEGACY_GEOMETRY=",1)[1].strip().rstrip(";"))
        ramps={r[0]:r for r in d["roads"] if r[1]=="ramp"}
    budget=int(os.environ.get("DETOUR_REPAIR_BUDGET","24"))
    def fetch(a,b):
        nonlocal budget
        if budget<=0:return None
        budget-=1;pad=min(.06,max(.012,meters(a,b)/111195*.45))
        box=",".join(str(x) for x in (min(a[0],b[0])-pad,min(a[1],b[1])-pad,max(a[0],b[0])+pad,max(a[1],b[1])+pad))
        q='[out:json][timeout:60];way["highway"~"^(trunk|primary|secondary|tertiary|unclassified|residential|living_street|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link)$"]('+box+');out geom;'
        try:return connect(overpass(q,2),a,b)
        except Exception as ex:print("Gap deferred",str(ex));return None
    for r in sorted(routes.values(),key=lambda r:(not bool(r.get("officialEvidence")),r["id"])):
        if budget<=0:break
        e=evidence.get(str(r["id"]),{});a=ramps.get(e.get("exitEdge"));b=ramps.get(e.get("entryEdge"));anchors=None
        if a and b and a[2]==r["fromMotorway"] and b[2]==r["toMotorway"] and "Abfahrt" in a[5] and "Auffahrt" in b[5] and not re.search(r"\b(?:AK|AD)\b",a[5]+" "+b[5]):anchors=(a[4][-1],b[4][0])
        if r["eligible"] and not anchors:continue
        if anchors or len(r["parts"])>1:
            updated=repair_route(r,fetch,anchors)
            if updated.get("inferredParts"):
                updated["directedGeometry"]=bool(updated["eligible"])
                routes[r["id"]]=updated
def review_row(r):
    q=" ".join(str(r.get(k) or "") for k in ("motorway","ref","from","to")).strip()
    return {**{k:r.get(k) for k in ("id","ref","motorway","from","to","region","notes","geometryStatus")},"searchQueries":[q+" Autobahn GmbH Umleitung",q+" Landesbetrieb Straßenbau Bedarfsumleitung",q+" historische Vollsperrung"],"status":"needs-source-review"}
def main():
    catalogue,unmapped,coverage=catalog()
    evidence=json.loads(Path("scripts/bedarfsumleitungen-evidence.json").read_text(encoding="utf-8"))
    verified=evidence.get("relations",{})
    for rid,row in verified.items():
        previous=catalogue.get(int(rid),{})
        catalogue[int(rid)]={**previous,**row,"notes":previous.get("notes","")+" "+row.get("notes",""),"officialEvidence":row}
    ids=set(catalogue);national=False;errors=[]
    try:
        q='[out:json][timeout:120];area(3600051477)->.de;(rel["type"="route"]["route"="detour"](area.de);rel["type"="route"]["ref"~"^U ?[0-9]+[a-zA-Z]?$"]["detour"](area.de);rel["type"="route"]["ref"~"^U ?[0-9]+[a-zA-Z]?$"]["route"="road"](area.de););out ids;'
        ids.update(e["id"] for e in overpass(q) if e["type"]=="relation");national=True
    except Exception as ex:errors.append(str(ex))
    old=old_data();routes={r["id"]:r for r in old.get("routes",[])}
    fetched=set();failed=[]
    # Prioritize the currently simulated motorways and new official evidence.
    ordered=sorted(ids,key=lambda rid:(str(rid) not in verified,catalogue.get(rid,{}).get("region") not in ("Rheinland-Pfalz","Nordrhein-Westfalen","Hessen"),rid))
    for i in range(0,len(ordered),40):
        batch=ordered[i:i+40]
        try:
            q="[out:json][timeout:90];rel(id:"+",".join(map(str,batch))+")->.r;.r out body;way(r.r);out geom;"
            elements=overpass(q);ways={e["id"]:e for e in elements if e["type"]=="way"}
            for e in elements:
                if e["type"]!="relation":continue
                rid=e["id"];fetched.add(rid)
                r=convert(e,catalogue.get(rid,{}),ways)
                if r:routes[rid]=r
                elif rid in routes:routes[rid]={**routes[rid],"eligible":False,"geometryStatus":"stale-unverified"}
            print("Batch",i+len(batch),"/",len(ordered),"routes",len(routes),flush=True)
        except Exception as ex:failed.extend(batch);errors.append(str(ex));print("Deferred",i,str(ex),flush=True)
        time.sleep(.5)
    repair(routes,verified)
    missing=sorted(ids-set(routes))
    unresolved=[review_row({"id":rid,**row}) for rid,row in catalogue.items() if rid not in routes or not routes[rid]["eligible"]]
    unresolved.extend(review_row(r) for r in unmapped)
    complete=bool(national and all(x["status"]=="read" for x in coverage.values()) and not failed and not missing and not unresolved)
    data={"schema":1,"source":"OpenStreetMap contributors","license":"ODbL-1.0","wiki":ROOT,"wikiLicense":"CC BY-SA 2.0",
        "coverage":coverage,"complete":complete,"nationalQuerySucceeded":national,"requested":len(ids),"fetched":len(fetched),
        "missing":missing,"failed":failed,"unmapped":unmapped,"officialSources":evidence.get("sources",[]),"routes":sorted(routes.values(),key=lambda r:r["id"])}
    atomic(REVIEW,json.dumps({"schema":1,"complete":complete,"coverage":coverage,"errors":errors,"missing":missing,"failed":failed,"unresolved":unresolved},ensure_ascii=False,indent=2)+"\n")
    if not routes:raise RuntimeError("No route geometry retrieved; no fabricated dataset published")
    atomic(OUT,"window.StauBedarfsumleitungen.install("+json.dumps(data,ensure_ascii=False,separators=(",",":"))+");\n")
    print("Published",len(routes),"routes; unresolved",len(unresolved),"complete",complete,flush=True)
def self_test():
    p=Wiki();p.feed('<h2>A 3</h2><h3>A 3 Richtung Köln</h3><tr><td>U 3</td><td></td><td>AS 40 Montabaur</td><td>AS 38 Ransbach-Baumbach</td><td><a href="https://www.openstreetmap.org/relation/398045">398045</a></td><td></td><td></td></tr>')
    assert p.rows[398045]["from"]=="AS 40 Montabaur"
    def w(i,n,one):return {"id":i,"nodes":n,"geometry":[{"lat":50.0,"lon":7+x/100} for x in n],"tags":{"highway":"primary","oneway":one}}
    a={"id":1,"tags":{"ref":"U 3","detour":"A 3","from":"AS 40 Montabaur","to":"AS 38 Ransbach-Baumbach"},"members":[{"type":"way","ref":1},{"type":"way","ref":2}]}
    r=convert(a,{}, {1:w(1,[1,2],"yes"),2:w(2,[2,3],"yes")})
    assert r["eligible"] and r["directedGeometry"] and len(r["parts"][0])==3
    r=convert(a,{}, {1:w(1,[1,2],"yes"),2:w(2,[3,2],"yes")})
    assert not r["eligible"] and len(r["parts"])==2
    print("Importer: 3 fixture tests passed")
if __name__=="__main__":
    import sys
    if "--self-test" in sys.argv:self_test()
    else:main()
