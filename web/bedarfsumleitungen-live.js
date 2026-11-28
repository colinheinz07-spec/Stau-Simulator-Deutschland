/* Regional OSM recovery when the published Germany snapshot is absent.
 * Async, browser-only. No network work in the traffic timestep or renderer.
 * OSM contributors, ODbL. Partial coverage is explicitly labeled. */
(function(w){
"use strict";
const api=w.StauBedarfsumleitungen;
if(!api)return;
const key="stau-signed-regional-v2";
const mirrors=["https://overpass-api.de/api/interpreter","https://overpass.kumi.systems/api/interpreter"];
const metadata={
  186894:["A3","U 1","AS 41 Diez","AS 40 Montabaur","nordwärts"],
  398045:["A3","U 3","AS 40 Montabaur","AS 38 Ransbach-Baumbach","nordwärts"],
  398046:["A3","U 5","AS 38 Ransbach-Baumbach","AS 37 Dierdorf","nordwärts"],
  398057:["A3","U 7","AS 37 Dierdorf","","nordwärts"],
  398059:["A3","U 9","AS 36 Neuwied","AS 35 Neustadt/Wied","nordwärts"],
  398061:["A3","U 11","AS 35 Neustadt/Wied","AS 34 Bad Honnef/Linz","nordwärts"],
  186645:["A3","U 4","AS 35 Neustadt/Wied","AS 36 Neuwied","südwärts"],
  186644:["A3","U 6","AS 36 Neuwied","AS 37 Dierdorf","südwärts"],
  398709:["A3","U 8","AS 37 Dierdorf","AS 38 Ransbach-Baumbach","südwärts"],
  186855:["A3","U 10","AS 38 Ransbach-Baumbach","AS 40 Montabaur","südwärts"],
  186892:["A3","U 12","AS 40 Montabaur","AS 41 Diez","südwärts"],
  6806117:["A48","U 95","AS 10 Koblenz-Nord","AS 11 Bendorf/Neuwied","nordwärts"],
  6806118:["A48","U 97","AS 11 Bendorf/Neuwied","AS 12 Höhr-Grenzhausen","nordwärts"],
  7330760:["A48","U 42","AS 12 Höhr-Grenzhausen","AS 11 Bendorf/Neuwied","südwärts"],
  9288841:["A48","U 54","AS 4 Kaisersesch","AS 6 Mayen","nordwärts"],
  9288757:["A48","U 85","AS 6 Mayen","AS 4 Kaisersesch","südwärts"],
  2825543:["A61","U 86","AS 33 Wehr","AS 34 Mendig","südwärts"],
  2825544:["A61","U 88","AS 34 Mendig","AS 35 Kruft","südwärts"],
  2825545:["A61","U 90","AS 35 Kruft","AS 36 Plaidt","südwärts"],
  2825552:["A61","U 92","AS 36 Plaidt","AS 37 Kreuz Koblenz","südwärts"]
};
// Endpoint metadata from regional OSM wiki; unresolved geometry is never
// presented as a completed official diversion.
const ref=v=>String(v||"").match(/\bA\s*(\d+)\b/i)?.[1];
const named=v=>/[a-zäöüß]{3}/i.test(String(v||"").replace(/\b(?:AS|AK|AD)\b/gi,""));
const meters=(a,b)=>Math.hypot((a[0]-b[0])*111195,(a[1]-b[1])*111195*Math.cos((a[0]+b[0])*Math.PI/360));
function convert(elements){
  const ways=new Map(elements.filter(e=>e.type==="way").map(e=>[e.id,e])),routes=[];
  for(const e of elements){
    if(e.type!=="relation")continue;
    const t=e.tags||{},m=metadata[e.id],number=String(t.ref||m?.[1]||t.name||"").match(/\bU\s*(\d+[a-z]?)\b/i);
    if(!number)continue;
    const start=t.from||m?.[2]||"",end=t.to||m?.[3]||"";
    const refs=[...new Set((String(t.detour||"")+" "+(m?.[0]||"")+" "+String(t.name||"")).match(/\bA\s*\d+\b/gi)?.map(x=>"A"+ref(x))||[])];
    const a=ref(start)||ref(m?.[0])||(refs.length===1?ref(refs[0]):null),b=ref(end)||ref(m?.[0])||(refs.length===1?ref(refs[0]):null);
    let states=[{parts:[],last:null,first:null}];let bad=false;
    for(const member of e.members||[]){
      if(member.type==="relation"){bad=true;continue;}
      if(member.type!=="way")continue;
      const way=ways.get(member.ref),tags=way?.tags||{};
      if(!way||!way.nodes||way.nodes.length!==way.geometry?.length||way.nodes.length<2||way.geometry.some(p=>!p||!Number.isFinite(p.lat))||!tags.highway||["construction","proposed","service","track","path","footway","cycleway"].includes(tags.highway)||["access","motor_vehicle","motorcar","vehicle"].some(k=>["no","private","destination","agricultural","forestry"].includes(tags[k]))){bad=true;continue;}
      const one=tags.oneway||(tags.junction==="roundabout"||tags.highway==="motorway"?"yes":"no");
      const signs=[1,-1].filter(sign=>sign===1?!["-1","reversible","alternating"].includes(one)&&member.role!=="backward":!["yes","1","true","reversible","alternating"].includes(one)&&member.role!=="forward");
      if(!signs.length){bad=true;continue;}
      const next=[];
      for(const state of states)for(const sign of signs){
        const nodes=sign===1?way.nodes:[...way.nodes].reverse();
        const p=(sign===1?way.geometry:[...way.geometry].reverse()).map(g=>[g.lat,g.lon]);
        const joined=state.last===nodes[0];
        next.push({first:state.first??nodes[0],last:nodes.at(-1),parts:joined?[...state.parts.slice(0,-1),[...state.parts.at(-1),...p.slice(1)]]:[...state.parts,p]});
      }
      next.sort((x,y)=>x.parts.length-y.parts.length);
      const seen=new Set();states=next.filter(x=>{const k=x.first+":"+x.last;if(seen.has(k))return false;seen.add(k);return true;}).slice(0,8);
    }
    const p=states[0]?.parts;if(!p?.length)continue;
    const unique=states.length===1||states[1].parts.length>p.length;
    const lengthM=Math.round(p.reduce((n,part)=>n+part.slice(1).reduce((sum,x,i)=>sum+meters(part[i],x),0),0));
    const eligible=!bad&&p.length===1&&!!a&&!!b&&named(start)&&named(end)&&lengthM>=100;
    routes.push({id:e.id,ref:"U "+number[1],from:start,to:end,motorways:refs,fromMotorway:a?"A"+a:"",toMotorway:b?"A"+b:"",direction:m?.[4]||"",lengthM,parts:p,eligible,connected:p.length===1,directedGeometry:unique&&p.length===1,geometryStatus:eligible?"mapped":"incomplete"});
  }
  return routes;
}
let started=false;
async function recover(){
  if(started||api.status!=="unavailable")return;started=true;
  try{
    const cached=JSON.parse(w.localStorage.getItem(key)||"null");
    if(cached?.data?.routes?.length&&Date.now()-cached.at<7*86400000){api.install(cached.data);return;}
  }catch{}
  // Bounding box covers the actual western Germany simulation network.
  // Avoid repeated global requests from every mobile browser.
  const box="50.05,6.50,51.15,8.65";
  const q='[out:json][timeout:35];(rel["route"="detour"]('+box+');rel["ref"~"^U ?[0-9]+[a-zA-Z]?$"]["route"="road"]('+box+');rel(id:'+Object.keys(metadata).join(",")+');)->.r;.r out body;way(r.r);out geom;';
  for(const url of mirrors){
    const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),45000);
    try{
      const res=await fetch(url,{method:"POST",body:new URLSearchParams({data:q}),signal:ctl.signal});
      if(!res.ok)throw Error("HTTP "+res.status);
      const raw=await res.json();if(raw.remark||!raw.elements)throw Error("Incomplete OSM response");
      const routes=convert(raw.elements);if(!routes.length)throw Error("No usable OSM relations");
      if(api.status==="ready")return;
      const data={schema:1,scope:"regional-fallback",complete:false,source:"OpenStreetMap contributors",license:"ODbL-1.0",wiki:"https://wiki.openstreetmap.org/wiki/DE:Germany/Bedarfsumleitung/Rheinland-Pfalz",routes};
      api.install(data);
      try{w.localStorage.setItem(key,JSON.stringify({at:Date.now(),data}));}catch{}
      return;
    }catch(err){console.warn("Regional U-route recovery:",err.message);}
    finally{clearTimeout(timer);}
  }
}
w.StauSignedRecovery={convert,recover};
api.subscribe(recover);
recover();
})(window);
