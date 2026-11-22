"""Merge audited OSM relation/full and junction map extracts into SPCK geometry.

Inputs in the argument directory: stau-*.json (OSM API 0.6, 2026-11-22).
Retains the previous Bonn bridge alignment and its event IDs while it is rebuilt.
All connections are exact shared OSM coordinates, never proximity snapping.
"""
import collections, glob, json, math, pathlib, sys

folder=pathlib.Path(sys.argv[1]); path=pathlib.Path('web/legacy-geometry.js')
source=pathlib.Path(sys.argv[2]) if len(sys.argv)>2 else path
prefix, raw=source.read_text().split('window.STAU_LEGACY_GEOMETRY=',1)
data=json.loads(raw.rstrip().rstrip(';'))
base=data['roads']; nodes={}; ways={}; routes={}; junctions={}
def point(n): return (nodes[n]['lat'],nodes[n]['lon'])
def merge(name):
    elements=json.loads(name.read_text())['elements']
    for e in elements:
        if e['type']=='node':nodes[e['id']]=e
        elif e['type']=='way':ways[e['id']]=e
    return elements
for ref,files in {'A565':['a565-relation'],'A61':['17404207','17404360'],'A571':['a571-relation'],'A573':['a573-relation']}.items():
    ids=set()
    for file in files:
        for e in merge(folder/('stau-'+file+'.json')):
            if e['type']=='way':ids.add(e['id'])
            if e['type']!='node' or e.get('tags',{}).get('highway')!='motorway_junction':continue
            t=e['tags']; name=t.get('name'); num=t.get('ref','')
            if not name or ref=='A61' and not(num.isdigit() and 29<=int(num)<=37):continue
            name={'Kreuz Meckenheim':'AK Meckenheim','Kreuz Koblenz':'AK Koblenz','Kreuz Bonn-Nord':'AK Bonn-Nord','Dreieck Bonn-Nordost':'AD Bonn-Nordost','Dreieck Sinzig':'AD Sinzig','Dreieck Bad Neuenahr-Ahrweiler':'AD Bad Neuenahr-Ahrweiler','Bonn-Beuel':'Bonn-Beuel-Nord'}.get(name,name)
            junctions.setdefault((ref,num,name),[]).append((e['lat'],e['lon']))
    routes[ref]=ids
for file in sorted(folder.glob('stau-junction-*.json')):merge(file)

def distance(a,b): return math.hypot((a[0]-b[0])*111200,(a[1]-b[1])*70500)

# Preserve northern A565 event IDs but recover omitted intermediate OSM
# vertices (e.g. the Auerberg exit). Replace only a directed OSM path between
# two already identical legacy vertices; no geometric nearest-point joining.
a565_next=collections.defaultdict(set)
for id in routes['A565']:
    w=ways[id];t=w['tags']
    if t.get('highway')!='motorway':continue
    p=[point(n) for n in w['nodes']]
    for a,b in zip(p,p[1:]):a565_next[a].add(b)
for r in base:
    if r[0] not in ('extra-a565-siegburg','extra-a565-koblenz'):continue
    p=[tuple(x) for x in r[4]]; updated=[p[0]]; i=0
    while i<len(p)-1:
        j=i+1
        while j<len(p)-1 and p[j] not in a565_next:j+=1
        q=[p[i]]; seen_path=set(q); length=0
        while q[-1]!=p[j] and len(a565_next[q[-1]])==1 and length<1600:
            nxt=next(iter(a565_next[q[-1]]))
            if nxt in seen_path:break
            length+=distance(q[-1],nxt);q.append(nxt);seen_path.add(nxt)
        old_length=sum(distance(a,b) for a,b in zip(p[i:j],p[i+1:j+1]))
        if q[-1]==p[j] and length<=old_length*1.2+10:
            updated.extend(q[1:]);i=j
        else:updated.append(p[i+1]);i+=1
    r[4]=updated

def lanes(w,ref,kind):
    t=w['tags']; count=int(t.get('lanes','1' if kind=='ramp' else '2'))
    if kind=='mainline':
        # Dedicated departure lanes and acceleration lanes are not through lanes.
        turns=t.get('turn:lanes','').split('|')
        if len(turns)==count and count>2:
            count=max(2,count-sum(v in ('slight_right','right','merge_to_left','merge_to_right') for v in turns))
        dest=t.get('destination:ref:lanes','').split('|')
        if len(dest)==count and count>2:
            kept=sum(ref.replace(' ','') in v.replace(' ','').split(';') for v in dest)
            if kept>=2:count=kept
    return count

main=[]
for ref,ids in routes.items():
    for id in sorted(ids):
        w=ways[id]; t=w['tags']; p=[point(n) for n in w['nodes']]
        if t.get('highway')!='motorway':continue
        if ref=='A61' and (max(a[0] for a in p)<50.352 or min(a[0] for a in p)>50.606):continue
        if ref=='A565':
            # Existing northbound/southbound snapshot starts/ends at these exact nodes.
            north=p[-1][0]>p[0][0]; cut=(50.7489373,7.0785291) if north else (50.7489623,7.0782501)
            if cut in p:p=p[:p.index(cut)+1] if north else p[p.index(cut):]
            elif max(a[0] for a in p)>cut[0]:continue
        if len(p)<2:continue
        direction='Nord' if p[-1][0]>p[0][0] else 'Süd'
        label=ref+' → '+direction
        main.append([f'{ref}-{id}','mainline',ref,lanes(w,ref,'mainline'),p,label,id,t.get('shoulder')])

# The OSM route relations omit some motorway-tagged turning arms at the
# A571/A573 triangles. Preserve those real, separately signed branches as
# transfer ramps, not additional independently fed mainline corridors.
connector_ids={28372074,28372076,60458531,60458533,326239476,
    4414881,23338593,30274173,232152275,232152276,232152278,
    326239520,326239521,326239527,1553681738,1553681740,1553681747}
# Extend the A48 just across AK Koblenz, so the western boundary is connected
# to the actual four-way interchange instead of injecting traffic in ramps.
west_a48={8177334,9645685,24351894,108889860,210611610,312834606,
    312834607,485852379,485852380,485852381,485852382,824372860}
for id in sorted(west_a48):
    w=ways[id];t=w['tags'];p=[point(n) for n in w['nodes']]
    main.append([f'A48-{id}','mainline','A48',lanes(w,'A48','mainline'),p,'',id,t.get('shoulder')])
# The junction at Ehlingen connects to the B266 via primary_link ramps.
connector_ids.update({53791642,53791639})
# Include all motorway_link components connected to the actual motorway vertices.
# Do not connect the surface-road network or service areas into the motorway graph.
targetrefs=set(routes); targetpoints={tuple(p) for r in base+main if r[1]=='mainline' and r[2] in targetrefs for p in r[4]}
allmain={tuple(p) for r in base+main if r[1]=='mainline' for p in r[4]}
links={id:w for id,w in ways.items() if (w.get('tags',{}).get('highway')=='motorway_link' or id in connector_ids) and all(n in nodes for n in w['nodes']) and w['tags'].get('access') not in ('no','private')}
at=collections.defaultdict(set)
for id,w in links.items():
    for n in w['nodes']:at[n].add(id)
public_nodes={n for w in ways.values() if w.get('tags',{}).get('highway') in
    ('primary','secondary','tertiary','trunk','unclassified','residential') and
    w['tags'].get('access') not in ('no','private') for n in w['nodes'] if n in nodes}
seen=set(); ramps=[]; ramp_ids=set(); report=collections.Counter(); local_boundaries=set()
for id,w in links.items():
    if id in seen:continue
    component=[]; work=[id]
    for i in work:
        if i in seen:continue
        seen.add(i);component.append(i)
        for n in links[i]['nodes']:work.extend(at[n]-seen)
    pts={point(n) for i in component for n in links[i]['nodes']}
    touched=pts&targetpoints
    if not touched:continue
    closest=min(junctions,key=lambda j:min(distance(a,b) for a in touched for b in junctions[j]))
    dist=min(distance(a,b) for a in touched for b in junctions[closest])
    if dist>2300:continue
    ref,num,name=closest
    interchange=name.startswith(('AK ','AD '))
    # Shared connector names must stay identical for local capacity grouping.
    label=name if interchange else f'{ref} AS {num+" " if num else ""}{name}'
    if name=='AK Koblenz':label='AK Koblenz (A61)'
    # At a real public-street junction, split the modeled ramp ring into
    # its local arrivals/departures. The surface roads themselves stay off-map.
    component_boundary={point(n) for i in component for n in links[i]['nodes'] if n in public_nodes} - allmain
    if not interchange:local_boundaries.update(component_boundary)
    for i in component:
        w=links[i];t=w['tags'];p=[point(n) for n in w['nodes']];n=lanes(w,ref,'ramp')
        if t.get('oneway')=='-1':p.reverse()
        directions=[(p,n,'')]
        if t.get('oneway')=='no':directions=[(p,max(1,n//2),''),(p[::-1],max(1,n//2),':reverse')]
        for points,number,suffix in directions:
            ending='Rampenzweig'
            if points[0] in allmain:ending='Abfahrt'
            elif points[-1] in allmain or not interchange and points[0] in component_boundary:ending='Auffahrt'
            # Keep original stable IDs and labels at existing motorway junctions.
            previous=next((r for r in base if r[1]=='ramp' and r[6]==i and tuple(r[4][0])==points[0] and tuple(r[4][-1])==points[-1]),None)
            # Keep IDs even if a shared OSM node was adjusted a few metres.
            matching=next((r for r in base if r[1]=='ramp' and r[6]==i and not r[0].endswith((':reverse','-back'))),None)
            stable=previous[0] if previous else matching[0] if matching and not suffix else f'OSM-link-{i}{suffix}'
            ramps.append([stable,'ramp',ref,number,points,label+' · '+ending,i,t.get('shoulder'), 'two-way' if len(directions)>1 else None])
        ramp_ids.add(i);report[(ref,num,name)]+=1

# Old incomplete local ramp fragments get replaced by current original Ways.
# Preserve original northern bridge ramps not returned in current construction map.
base=[r for r in base if not(r[1]=='ramp' and r[6] in ramp_ids)]
data['roads']=base+main+ramps
data['localRampBoundaryNodes']=[list(p) for p in sorted(local_boundaries)]
old={(r[0],r[1]):r for r in data['junctions']}
for (ref,num,name),pts in junctions.items():
    key=(ref,num or name)
    if key not in old:old[key]=[ref,num,name,list(pts[0])]
data['junctions']=list(old.values())
data['provenance']=str(data['provenance'])+'; OSM API relation/full + junction maps, Bonn–Ahr–Koblenz (2026-11-22)'
path.write_text(prefix+'window.STAU_LEGACY_GEOMETRY='+json.dumps(data,ensure_ascii=False,separators=(',',':'))+';\n')
print('Mainline:',collections.Counter(r[2] for r in main));print('Ramp components:',sorted(report.items()))
