"""Extend the Cologne ring with directed OSM motorway Ways and junction links.

Usage: python scripts/extend-koeln-ring.py /tmp/koeln-osm [base geometry]
Inputs: A1 relation 20904/full.json as a1.json, A57 TMC segments
1238877,1237500,1553255,1553267/full.json as a57-*.json; map-*.json
API extracts around Lövenich, Bocklemünd, Köln-Nord, Niehl, Leverkusen-West,
Chorweiler and Bickendorf. Source: OpenStreetMap, ODbL.
"""
import collections, json, math, pathlib, sys

folder=pathlib.Path(sys.argv[1]); path=pathlib.Path('web/legacy-geometry.js')
source=pathlib.Path(sys.argv[2]) if len(sys.argv)>2 else path
prefix,raw=source.read_text().split('window.STAU_LEGACY_GEOMETRY=',1)
data=json.loads(raw.rstrip().rstrip(';')); roads=data['roads']; nodes={}; ways={}
def merge(file):
    elements=json.loads(file.read_text())['elements']
    for el in elements:
        if el['type']=='node':nodes[el['id']]=el
        elif el['type']=='way':ways[el['id']]=el
    return {el['id'] for el in elements if el['type']=='way' and el.get('tags',{}).get('highway')=='motorway'}
a1=merge(folder/'a1.json');a57=set()
for file in sorted(folder.glob('a57-*.json')):a57|=merge(file)
for file in sorted(folder.glob('map-*.json')):merge(file)
def point(id):return nodes[id]['lat'],nodes[id]['lon']
def points(w):return [point(n) for n in w['nodes']]
def distance(a,b):return math.hypot((a[0]-b[0])*111200,(a[1]-b[1])*70000)
old={r[0]:r for r in roads}; new=[]
def chain(ids,start,end,forward=True):
    index=collections.defaultdict(list)
    for id in sorted(ids):
        w=ways[id];p=points(w)
        for i,v in enumerate(p):
            if (forward and i<len(p)-1 or not forward and i>0):index[v].append((w,p,i))
    at=start; seen=set(); result=[]
    while at!=end:
        candidates=[(w,p,i) for w,p,i in index[at] if w['id'] not in seen]
        assert len(candidates)==1,(at,candidates)
        w,p,i=candidates[0];seen.add(w['id'])
        q=p[i:] if forward else p[:i+1]
        if end in q:q=q[:q.index(end)+1] if forward else q[q.index(end):]
        result.append((w,q));at=q[-1] if forward else q[0]
    return result

def add_main(ref,ch,name,lanes):
    for w,p in ch:
        id=f'{ref}-{w["id"]}'
        assert id not in old,id
        new.append([id,'mainline',ref,lanes(w,p) if callable(lanes) else lanes,p,name,w['id'],w['tags'].get('shoulder')])

def a1_width(w,p):
    # The permanent two-through-lane throat at the old AK Köln-Nord
    # precedes the PLANNED six-lane conversion (not a temporary work zone).
    return 2 if w['id'] in {26261434,389508665,60328187} else 3

def a57_width(w,p):
    # North of AK Köln-Nord the six-lane expansion is not yet built.
    # South of the cross, preserve the mapped continuous third lanes,
    # but don't count turn-only auxiliary lanes as through lanes.
    t=w['tags'];n=int(t.get('lanes','2'))
    if min(v[0] for v in p)>=50.990:return 2
    dest=t.get('destination:ref:lanes','').split('|')
    if len(dest)==n:
        kept=sum('A57' in v.replace(' ','').split(';') for v in dest)
        if kept>=2:return min(3,kept)
    return min(3,n)

# Existing southern aggregate Ways contain the Köln-West ramps. Continue
# from their exact endpoints (even when an endpoint cuts an OSM Way).
add_main('A1',chain(a1,tuple(old['extra-a1-dortmund'][4][-1]),(51.0377794,6.9935838)), 'A1 → Dortmund',a1_width)
add_main('A1',chain(a1,tuple(old['extra-a1-koblenz'][4][0]),(51.0379569,6.9937563),False),'A1 → Koblenz',a1_width)
for row in roads:
    if row[1]=='mainline' and row[2]=='A1':
        if row[0].startswith('A1-'):
            row[5]='A1 → '+('Dortmund' if row[4][-1][1]>row[4][0][1] else 'Koblenz')

# A57: adjacent genuine junctions on both sides, not a whole new motorway.
# Four regular lanes north of the interchange; to the south the northbound
# permanent cross-section is three including the dedicated feeder section.
ch=chain(a57,(50.9627124,6.9253405),(51.0180883,6.8622476))
add_main('A57',ch,'A57 → Krefeld',a57_width)
add_main('A57',chain(a57,(51.0180188,6.8620963),(50.9637345,6.9239824)),'A57 → Köln',a57_width)

# Complete the actual A59 transfer at AK Leverkusen-West, including short
# approach pieces and its existing urban end, not a fictitious A59 link to Bonn.
a59={id for id,w in ways.items() if w.get('tags',{}).get('highway')=='motorway' and w['tags'].get('ref')=='A 59' and all(i in nodes for i in w['nodes'])}
add_main('A59',chain(a59,(51.0354863,6.9672336),(51.0461436,6.9476168)),'A59 → Düsseldorf',2)
add_main('A59',chain(a59,(51.0460733,6.9474477),(51.035268,6.9665204)),'A59 → Leverkusen',2)

sites={}
for n in nodes.values():
    t=n.get('tags',{});num=t.get('ref');name=t.get('name');p=point(n['id'])
    if t.get('highway')!='motorway_junction' or not (50.93<p[0]<51.06 and 6.83<p[1]<7.02):continue
    if num in {'99','100','101','102','103'} and name in {'Kreuz Leverkusen-West','Köln-Niehl','Kreuz Köln-Nord','Köln-Bocklemünd','Köln-Lövenich'}:
        ref='A1'
    elif num in {'27','28','29'} and name in {'Köln-Chorweiler','Kreuz Köln-Nord','Bickendorf','Köln-Longerich','Longerich'}:ref='A57'
    else:continue
    if name.startswith('Kreuz '):name='AK '+name[6:]
    elif name=='Bickendorf':name='Köln-Bickendorf'
    sites.setdefault((ref,num,name),[]).append(p)

# Select components of physical motorway_link Ways touching our new or
# adjacent existing sections using actual OSM nodes, never distance joins.
selected={tuple(p) for r in new for p in r[4]}
selected|={tuple(p) for r in roads if r[2]=='A1' and r[1]=='mainline' for p in r[4]}
# The city-end turnaround at Rheinallee is the interface to the public
# street network, not an A59 motorway transfer (avoid recycling all traffic).
links={i:w for i,w in ways.items() if i!=208308897 and w.get('tags',{}).get('highway')=='motorway_link' and all(n in nodes for n in w['nodes']) and w['tags'].get('access') not in ('no','private')}
at=collections.defaultdict(set)
for i,w in links.items():
    for n in w['nodes']:at[n].add(i)
public={n for w in ways.values() if w.get('tags',{}).get('highway') in ('trunk','primary','secondary','tertiary','unclassified','residential') for n in w['nodes'] if n in nodes}
old_links={r[6]:r for r in roads if r[1]=='ramp' and isinstance(r[6],int) and not r[0].endswith(':reverse') and ('ramp-gap' in r[0] or 'koelnwest-link-' in r[0])}
existing_osm={r[6] for r in roads if r[1]=='ramp' and isinstance(r[6],int)}
seen=set(); ramps=[]; report=collections.Counter()
boundaries={tuple(p) for p in data.get('localRampBoundaryNodes',[])}
for id in sorted(links):
    if id in seen:continue
    comp=[];work=[id]
    for j in work:
        if j in seen:continue
        seen.add(j);comp.append(j)
        for n in links[j]['nodes']:work.extend(at[n]-seen)
    touch={point(n) for j in comp for n in links[j]['nodes']} & selected
    if not touch:continue
    site=min(sites,key=lambda s:min(distance(a,b) for a in touch for b in sites[s]))
    ref,num,name=site
    if min(distance(a,b) for a in touch for b in sites[site])>1750:continue
    inter=name.startswith('AK ');label=name if inter else f'{ref} AS {num} {name}'
    boundary={point(n) for j in comp for n in links[j]['nodes'] if n in public}-selected
    boundaries.update(boundary)
    for j in sorted(comp):
        w=links[j];t=w['tags'];p=points(w)
        if t.get('oneway')=='-1':p.reverse()
        # Do not include motorway service/rest-area accesses.
        if t.get('service') in ('parking_aisle','driveway') or 'Rast' in t.get('destination',''):continue
        n=int(t.get('lanes','1'));variants=[(p,n,'')]
        if t.get('oneway')=='no':variants=[(p,max(1,n//2),''),(p[::-1],max(1,n//2),':reverse')]
        for q,width,suffix in variants:
            if j in existing_osm and j not in old_links:continue
            motorway_dest=any(v.strip().startswith('A ') for v in t.get('destination:ref','').split(';'))
            role='Abfahrt' if q[0] in selected or q[-1] in boundary and q[0] not in boundary and not motorway_dest else 'Auffahrt' if q[-1] in selected or q[0] in boundary else 'Rampenzweig'
            # Longerich shares the collector roads with the A1/A57 cross.
            # Only the genuine public-road start/end gets the local AS label.
            local= name=='AK Köln-Nord' and (q[0] in boundary or q[-1] in boundary)
            row=[f'OSM-link-{j}{suffix}','ramp','A57' if local else ref,width,q,('A57 AS 28 Köln-Longerich' if local else label)+' · '+role,j,t.get('shoulder'),'two-way' if len(variants)>1 else None]
            existing=old_links.get(j) if not suffix else None
            if existing is not None:row[0]=existing[0];existing[:]=row
            elif row[0] not in old:ramps.append(row)
            report[label]+=1
data['roads']+=new+ramps;data['localRampBoundaryNodes']=[list(p) for p in sorted(boundaries)]
for (ref,num,name),p in sorted(sites.items()):data['junctions'].append([ref,num,name,p[0],p])
data['provenance']=str(data['provenance'])+'; OSM API A1 Köln-West–Leverkusen, A57 Köln-Nord, 2026-11-22'
path.write_text(prefix+'window.STAU_LEGACY_GEOMETRY='+json.dumps(data,ensure_ascii=False,separators=(',',':'))+';\n')
print('mainlines',collections.Counter(r[2] for r in new),'ramps',report)
