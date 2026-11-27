"""Targeted gap repair on actual OSM public road geometry, never a straight line.
Inferred pieces remain distinguishable from officially surveyed signs."""
import heapq, math, re
from collections import defaultdict

ALLOWED={"trunk","trunk_link","primary","primary_link","secondary","secondary_link",
         "tertiary","tertiary_link","unclassified","residential","living_street","motorway_link"}
def point(p):
    return (round(p[0],6),round(p[1],6))
def meters(a,b):
    return math.hypot((a[0]-b[0])*111195,(a[1]-b[1])*111195*math.cos(math.radians((a[0]+b[0])/2)))
def road_graph(elements):
    graph=defaultdict(list);coords={}
    for e in elements:
        t=e.get("tags",{})
        if e.get("type")!="way" or t.get("highway") not in ALLOWED:continue
        if any(t.get(k) in {"private","no","destination","customers","agricultural","forestry","delivery"} for k in ("access","vehicle","motor_vehicle","motorcar")):continue
        if t.get("construction") or t.get("proposed") or t.get("area")=="yes":continue
        if any(k.endswith(":conditional") for k in t if k.startswith(("access","motor_vehicle","motorcar","vehicle","oneway"))):continue
        nodes=e.get("nodes",[]);geom=e.get("geometry",[])
        if len(nodes)!=len(geom) or any(not p for p in geom):continue
        for n,p in zip(nodes,geom):coords[n]=point((p["lat"],p["lon"]))
        one=t.get("oneway","yes" if t.get("junction")=="roundabout" else "no")
        if one not in {"yes","1","true","-1","no","0","false"}:continue
        factor={"trunk":1,"primary":1,"secondary":1.05,"tertiary":1.15,"residential":1.7,"living_street":2.5}.get(t["highway"],1.25)
        for a,b in zip(nodes,nodes[1:]):
            length=meters(coords[a],coords[b])
            if length<.01:continue
            if one!="-1":graph[a].append((b,length*factor))
            if one not in {"yes","1","true"}:graph[b].append((a,length*factor))
    return graph,coords
def connect(elements,start,end):
    graph,coords=road_graph(elements);start,end=point(start),point(end)
    # Shared OSM node ID is the actual connection. Never join grade-separated
    # roads merely because their coordinates happen to cross.
    a=[n for n,p in coords.items() if meters(p,start)<1]
    b={n for n,p in coords.items() if meters(p,end)<1}
    if len(a)!=1 or len(b)!=1:return None
    target=next(iter(b));origin=a[0];dist={origin:0};parent={};queue=[(0,origin)]
    while queue:
        cost,node=heapq.heappop(queue)
        if cost!=dist[node]:continue
        if node==target:
            path=[node]
            while node in parent:node=parent[node];path.append(node)
            points=[coords[n] for n in reversed(path)]
            length=sum(meters(p,q) for p,q in zip(points,points[1:]))
            if length>max(300,meters(start,end)*4.0):return None
            return points
        for next_node,w in graph.get(node,[]):
            d=cost+w
            if d<dist.get(next_node,float("inf")):
                dist[next_node]=d;parent[next_node]=node;heapq.heappush(queue,(d,next_node))
    return None
def repair_route(route,fetch,anchors=None):
    parts=[[point(p) for p in part] for part in route["parts"]]
    if not parts:return route
    if anchors:
        start,end=map(point,anchors)
        if meters(parts[-1][-1],start)<meters(parts[0][0],start):
            parts=[p[::-1] for p in reversed(parts)]
        if meters(start,parts[0][0])>.8:parts.insert(0,[start])
        if meters(parts[-1][-1],end)>.8:parts.append([end])
    if len(parts)<2:return route
    result=[parts[0][:]];repairs=[]
    for p in parts[1:]:
        a,b=result[-1][-1],p[0]
        if a==b:
            result[-1].extend(p[1:]);continue
        gap=meters(a,b)
        if gap>25000:
            result.append(p);continue
        path=fetch(a,b)
        if not path:
            result.append(p);continue
        # All inserted vertices are from the actual road graph.
        repairs.append(path)
        result[-1].extend(path[1:])
        result[-1].extend(p[1:])
    if not repairs:return route
    fully_connected=len(result)==1 and len(result[0])>1
    result=[p for p in result if len(p)>1]
    new={**route,"parts":result,"inferredParts":repairs,
         "geometryStatus":"inferred" if fully_connected else "partly-inferred",
         "connected":fully_connected,
         "lengthM":round(sum(meters(a,b) for p in result for a,b in zip(p,p[1:])))}
    # A confirmed endpoint pair plus a reconstructed path may be usable for
    # simulation but must never be presented as an officially verified itinerary.
    new["eligible"]=bool(fully_connected and anchors and route.get("officialEvidence"))
    return new
def self_test():
    a=(50.0,7.0);b=(50.0,7.01);c=(50.0,7.02)
    way={"type":"way","id":1,"nodes":[1,2,3],"tags":{"highway":"primary","oneway":"yes"},
         "geometry":[{"lat":p[0],"lon":p[1]} for p in (a,b,c)]}
    assert connect([way],a,c)==[a,b,c]
    assert connect([way],c,a) is None
    assert connect([{**way,"tags":{"highway":"primary","access":"private"}}],a,c) is None
    r={"parts":[[a,b],[c,(50.0,7.03)]],"eligible":False}
    fixed=repair_route(r,lambda x,y:connect([way],x,y))
    assert fixed["connected"] and not fixed["eligible"] and fixed["inferredParts"]==[[b,c]]
    print("4 targeted repair tests passed")
if __name__=="__main__":self_test()
