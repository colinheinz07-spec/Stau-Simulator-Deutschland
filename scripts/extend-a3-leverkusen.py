"""Append the actual A3 carriageways and interchange links from OSM API extracts.
Usage from repository root: python scripts/extend-a3-leverkusen.py /tmp [base geometry]
Inputs: stau-a3-full.json and stau-leverkusen-*.json (OSM API 0.6).
"""
import collections, json, math, pathlib, sys

folder=pathlib.Path(sys.argv[1]); path=pathlib.Path('web/legacy-geometry.js')
source=pathlib.Path(sys.argv[2]) if len(sys.argv)>2 else path
prefix, raw=source.read_text().split('window.STAU_LEGACY_GEOMETRY=',1)
data=json.loads(raw.rstrip().rstrip(';')); roads=data['roads']; nodes={}; ways={}
def merge(path):
    x=json.loads(path.read_text())['elements']
    for a in x:
        if a['type']=='node':nodes[a['id']]=a
        elif a['type']=='way':ways[a['id']]=a
    return x
route=merge(folder/'stau-a3-full.json'); mainids={a['id'] for a in route if a['type']=='way' and a.get('tags',{}).get('highway')=='motorway'}
sites={}
for a in route:
    if a['type']!='node':continue
    t=a.get('tags',{}); ref=t.get('ref');name=t.get('name')
    if t.get('highway')=='motorway_junction' and ref in ('22','23','24','25','26') and 50.96<a['lat']<51.06 and 6.98<a['lon']<7.05:
        sites.setdefault((ref,'AK Leverkusen' if ref=='23' else name),[]).append((a['lat'],a['lon']))
for p in sorted(folder.glob('stau-leverkusen-*.json')):merge(p)
def point(n):return nodes[n]['lat'],nodes[n]['lon']
def pts(w):return [point(n) for n in w['nodes']]
def distance(a,b):return math.hypot((a[0]-b[0])*111200,(a[1]-b[1])*70000)
def width(w,ref):
    t=w['tags']; n=int(t.get('lanes','1'))
    if ref=='A3':
        # Autobahn GmbH: eight-lane Ausbau from south to Leverkusen-Zentrum
        # (2017), six regular lanes north of that section. OSM 5/6 lanes
        # near the signed exits include dedicated departure/collector lanes.
        p=pts(w); center=sum(a[0] for a in p)/len(p)
        return 4 if center<51.024 else 3
    dest=t.get('destination:ref:lanes','').split('|')
    if len(dest)==n:
        kept=sum(ref in v.replace(' ','').split(';') for v in dest)
        if kept>=2:return kept
    return n

old={r[0]:r for r in roads}; new=[]; nextways=collections.defaultdict(list); backways=collections.defaultdict(list)
old_coverage={r[6]:r for r in roads if r[0].startswith('extra-osm-ramp-gap-')}
for i in mainids:
    w=ways[i]; p=pts(w)
    if (50.95<min(a[0] for a in p)<51.06 and 6.98<min(a[1] for a in p)<7.05):
        nextways[p[0]].append(w);backways[p[-1]].append(w)
def chain(start,end,forward):
    at=start; found=[]; seen=set()
    while at!=end:
        choices=(nextways if forward else backways)[at]
        if len(choices)!=1:raise ValueError((at,len(choices)))
        w=choices[0];p=pts(w)
        if w['id'] in seen:raise ValueError('cycle')
        seen.add(w['id']);found.append(w);at=p[-1] if forward else p[0]
    return found
# Keep the existing ID and all old event distances; append the one real
# vertex omitted by the old cut of OSM way 206716768.
last=old['A3-206716768']; latest=pts(ways[206716768]); assert tuple(last[4][-1]) in latest
last[4].extend(latest[latest.index(tuple(last[4][-1]))+1:]);last[3]=4
chains=chain(latest[-1],(51.0516266,6.9966935),True)+chain((50.96083,7.0333507),(51.053091,6.9943579),False)
for w in chains:
    i=w['id'];p=pts(w);assert f'A3-{i}' not in old
    new.append([f'A3-{i}','mainline','A3',width(w,'A3'),p,'',i,w['tags'].get('shoulder')])

# A1 only the authentic four-way cross and approach pieces, ending at map
# boundaries. No invented A1 connection to the old Köln-West extract.
for i,w in sorted(ways.items()):
    t=w.get('tags',{});
    if t.get('highway')!='motorway' or t.get('ref')!='A 1' or not all(n in nodes for n in w['nodes']):continue
    p=pts(w)
    if not any(51.035<a[0]<51.048 and 6.9935<=a[1]<=7.0191 for a in p):continue
    if min(a[1] for a in p)<6.985 or max(a[1] for a in p)>7.030:continue
    n=width(w,'A1');new.append([f'A1-{i}','mainline','A1',n,p,'',i,t.get('shoulder')])

selected={tuple(p) for r in new for p in r[4]} | {tuple(p) for p in last[4]}
links={i:w for i,w in ways.items() if w.get('tags',{}).get('highway')=='motorway_link' and all(n in nodes for n in w['nodes']) and w['tags'].get('access') not in ('no','private')}
at=collections.defaultdict(set)
for i,w in links.items():
    for n in w['nodes']:at[n].add(i)
public={n for w in ways.values() if w.get('tags',{}).get('highway') in ('trunk','primary','secondary','tertiary','unclassified','residential') for n in w['nodes'] if n in nodes}
seen=set(); ramp=[]; boundaries={tuple(p) for p in data.get('localRampBoundaryNodes',[])};report=collections.Counter()
for i,w in links.items():
    if i in seen:continue
    comp=[];work=[i]
    for j in work:
        if j in seen:continue
        seen.add(j);comp.append(j)
        for n in links[j]['nodes']:work.extend(at[n]-seen)
    touch={point(n) for j in comp for n in links[j]['nodes']} & selected
    if not touch:continue
    site=min(sites,key=lambda s:min(distance(a,b) for a in touch for b in sites[s]))
    num,name=site
    if num=='22' or min(distance(a,b) for a in touch for b in sites[site])>1800:continue
    inter=num=='23';label=name if inter else f'A3 AS {num} {name}'
    boundary={point(n) for j in comp for n in links[j]['nodes'] if n in public}-selected
    if not inter:boundaries.update(boundary)
    for j in comp:
        w=links[j];t=w['tags'];p=pts(w);lanes=int(t.get('lanes','1'))
        if t.get('oneway')=='-1':p.reverse()
        variants=[(p,lanes,'')]
        if t.get('oneway')=='no':variants=[(p,max(1,lanes//2),''),(p[::-1],max(1,lanes//2),':reverse')]
        for q,n,suffix in variants:
            role='Abfahrt' if q[0] in selected else 'Auffahrt' if q[-1] in selected or not inter and q[0] in boundary else 'Rampenzweig'
            id=f'OSM-link-{j}{suffix}'
            if id in old:continue
            row=[id,'ramp','A3',n,q,label+' · '+role,j,t.get('shoulder'),'two-way' if len(variants)>1 else None]
            # Earlier loose coverage already included a few Dellbrück ways
            # under the Köln-Ost label. Relabel the original row, retaining
            # its stable ID; parallel copies would create phantom junctions.
            existing=old_coverage.get(j) if not suffix else None
            if existing is not None:
                row[0]=existing[0];existing[:]=row
            else:ramp.append(row)
            report[label]+=1
data['roads']+=new+ramp;data['localRampBoundaryNodes']=[list(p) for p in sorted(boundaries)]
for (num,name),p in sites.items():
    if num!='22':data['junctions'].append(['A3',num,name,list(p[0]),p])
ak_nodes=[n for n in nodes.values() if n.get('tags',{}).get('highway')=='motorway_junction' and n['tags'].get('ref')=='98' and n['tags'].get('name')=='Kreuz Leverkusen' and 51.035<n['lat']<51.05]
ak_points=[(n['lat'],n['lon']) for n in ak_nodes]
data['junctions'].append(['A1','98','AK Leverkusen',ak_points[0],ak_points])
data['provenance']=str(data['provenance'])+'; OSM API A3 Köln-Ost–AK Leverkusen, 2026-11-22'
path.write_text(prefix+'window.STAU_LEGACY_GEOMETRY='+json.dumps(data,ensure_ascii=False,separators=(',',':'))+';\n')
print('Mainline',collections.Counter(r[2] for r in new),'Ramps',report)
