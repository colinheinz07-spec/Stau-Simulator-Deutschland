/* 03_Stauphysik / local SPCK adapter.
 * A conservative directed cell-transmission prototype for the local OSM snapshot.
 * Same principles as src/03_Stauphysik/netzfluss.ts: finite receiving space,
 * sending capacity, wave spillback, real node transfers, and vehicle balance.
 * This is NOT the fully routed Germany-wide vehicle model.
 */
(function(global){
"use strict";
const R=6371000,rad=Math.PI/180;
const REST=/\b(?:rastst[aä]tte|rastplatz|rastanlage|autohof|p\s*\+?\s*wc|pwc|service\s*area|rest\s*area)\b/i;
const colourForSpeed=s=>s>65?"free":s>30?"slow":s>10?"jam":"standstill";
const coord=p=>p.map(n=>Number(n).toFixed(7)).join(",");
const lengthM=pts=>{
  let length=0;
  for(let i=1;i<pts.length;i++){
    const a=pts[i-1],b=pts[i],lat1=a[0]*rad,lat2=b[0]*rad;
    const dLat=(b[0]-a[0])*rad,dLon=(b[1]-a[1])*rad;
    const s=Math.sin(dLat/2)**2+Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLon/2)**2;
    length+=2*R*Math.asin(Math.min(1,Math.sqrt(s)));
  }
  return length;
};
const finite=n=>Number.isFinite(n)&&n>=0;
function createLegacyTrafficScenario(data){
  if(!data||!Array.isArray(data.roads))throw Error("Geprüfte lokale Kartendaten fehlen");
  const edges=[],outByNode=new Map(),inByNode=new Map(),byId=new Map();
  let excludedRest=0;
  for(const row of data.roads){
    if(!Array.isArray(row[4])||row[4].length<2)continue;
    if(row[1]==="ramp"&&REST.test(row[5]||"")){excludedRest++;continue;}
    const id=String(row[0]),lanes=Math.max(1,Math.min(6,Math.floor(Number(row[3])||1)));
    const meters=lengthM(row[4]);
    if(meters<0.2||byId.has(id))continue;
    const count=Math.max(1,Math.ceil(meters/230));
    const edge={
      id,kind:row[1],ref:row[2],lanes,
      from:coord(row[4][0]),to:coord(row[4].at(-1)),
      first:row[4][0],lengthM:meters,
      n:count,cellLength:meters/count,
      stock:new Float64Array(count),
      capacityPerLane:row[1]==="ramp"?1550:2200,
      freeKmh:row[1]==="ramp"?75:120,
      jamPerCell:130*lanes*(meters/count)/1000,
      next:[],incoming:0,source:false,backlog:0,
      mode:"none",speed:row[1]==="ramp"?75:120
    };
    const index=edges.length;edges.push(edge);byId.set(id,edge);
    if(!outByNode.has(edge.from))outByNode.set(edge.from,[]);
    outByNode.get(edge.from).push(index);
    if(!inByNode.has(edge.to))inByNode.set(edge.to,[]);
    inByNode.get(edge.to).push(index);
  }
  const legalIndices=new Set();
  // A relationship exists ONLY if source and target share the exact OSM
  // endpoint. Never snap nearby ramps into fictitious driving movements.
  for(const edge of edges){
    const possible=outByNode.get(edge.to)||[];
    for(const j of possible){
      const dest=edges[j];
      if(dest===edge)continue;
      edge.next.push({to:j,weight:dest.kind==="mainline"?6:2});
      dest.incoming++;
      legalIndices.add(j);
    }
  }
  // Select external corridor boundaries from actual graph sources.
  // This avoids injecting imaginary cars at all the map's internal OSM gaps.
  const limits=new Map();
  for(const edge of edges){
    if(edge.kind!=="mainline"||!edge.ref)continue;
    const box=limits.get(edge.ref)??{minLat:90,maxLat:-90,minLon:180,maxLon:-180};
    for(const p of [edge.first]){
      box.minLat=Math.min(box.minLat,p[0]);box.maxLat=Math.max(box.maxLat,p[0]);
      box.minLon=Math.min(box.minLon,p[1]);box.maxLon=Math.max(box.maxLon,p[1]);
    }
    limits.set(edge.ref,box);
  }
  const sources=[];
  for(const edge of edges){
    if(edge.incoming||edge.kind!=="mainline"||!edge.ref)continue;
    const box=limits.get(edge.ref);
    if(!box)continue;
    const [lat,lon]=edge.first;
    const latMargin=Math.max(.001,(box.maxLat-box.minLat)*.035);
    const lonMargin=Math.max(.001,(box.maxLon-box.minLon)*.035);
    if(lat-box.minLat<=latMargin||box.maxLat-lat<=latMargin||
       lon-box.minLon<=lonMargin||box.maxLon-lon<=lonMargin){
      edge.source=true;sources.push(edge);
    }
  }
  let elapsed=0,generated=0,exited=0,demandPercent=100;
  function totals(){
    let inside=0,backlog=0;
    for(const edge of edges){
      for(const n of edge.stock)inside+=n;
      backlog+=edge.backlog;
    }
    const residual=generated-exited-inside-backlog;
    return {simSeconds:elapsed,generatedVehicles:generated,exitedVehicles:exited,
      vehiclesOnNetwork:inside,waitingOutsideSources:backlog,
      conservationResidual:Math.abs(residual)<1e-7?0:residual,
      sources:sources.length,edges:edges.length,excludedRest};
  }
  function recomputeSpeeds(){
    for(const edge of edges){
      let fraction=0;
      for(const vehicles of edge.stock)
        fraction=Math.max(fraction,Math.min(1,vehicles/edge.jamPerCell));
      edge.speed=edge.freeKmh*
        (fraction<=.15?1:Math.max(.06,1-Math.pow((fraction-.15)/.85,1.4)));
    }
  }
  function reset(clearEvents=false){
    elapsed=0;generated=0;exited=0;
    for(const edge of edges){
      edge.stock.fill(0);edge.backlog=0;edge.speed=edge.freeKmh;
      if(clearEvents)edge.mode="none";
    }
    return totals();
  }
  function setMode(id,mode){
    const edge=byId.get(id);
    if(!edge)throw Error("Unbekannter OSM-Abschnitt: "+id);
    if(!["none","roadworks","accident","closure"].includes(mode))
      throw Error("Ungültiger Ereignistyp");
    edge.mode=mode;
  }
  function setDemandPercent(pct){
    if(!finite(Number(pct))||Number(pct)>200)throw Error("Verkehrslast muss 0–200 % sein");
    demandPercent=Number(pct);
  }
  function step(dt=5){
    if(!finite(dt)||dt<=0||dt>15)throw Error("Ungültiger Simulationstakt");
    const send=[],receive=[],delta=[];
    for(let j=0;j<edges.length;j++){
      const edge=edges[j],n=edge.n,stock=edge.stock;
      const s=new Float64Array(n),r=new Float64Array(n),d=new Float64Array(n);
      const blocked=edge.mode==="closure"?edge.lanes:
        edge.mode==="accident"?Math.min(edge.lanes,2):
        edge.mode==="roadworks"?1:0;
      const cap=Math.max(0,edge.lanes-blocked)*edge.capacityPerLane*dt/3600;
      const moving=Math.min(1,(edge.freeKmh/3.6)*dt/edge.cellLength);
      const wave=Math.min(1,(22/3.6)*dt/edge.cellLength);
      for(let k=0;k<n;k++){
        s[k]=Math.min(stock[k],cap,stock[k]*moving);
        const room=Math.max(0,edge.jamPerCell-stock[k]);
        r[k]=Math.min(room,cap,room*wave);
      }
      send.push(s);receive.push(r);delta.push(d);
    }
    // Simultaneous internal cell transfers. The upstream vehicle remains
    // stored if its downstream cell is too full to receive it.
    for(let j=0;j<edges.length;j++){
      const s=send[j],r=receive[j],d=delta[j];
      for(let k=0;k<s.length-1;k++){
        const moved=Math.min(s[k],r[k+1]);
        d[k]-=moved;d[k+1]+=moved;
        s[k]-=moved;r[k+1]-=moved;
      }
    }
    const proposed=new Map();
    for(let j=0;j<edges.length;j++){
      const edge=edges[j],s=send[j],available=s[s.length-1];
      if(available<=0||!edge.next.length)continue;
      const valid=edge.next.filter(x=>edges[x.to].mode!=="closure");
      if(!valid.length)continue;
      const totalWeight=valid.reduce((sum,x)=>sum+x.weight,0);
      for(const link of valid){
        const want=available*link.weight/totalWeight;
        const arr=proposed.get(link.to)||[];
        arr.push([j,want]);proposed.set(link.to,arr);
      }
    }
    for(const [to,requests] of proposed){
      const accepting=receive[to][0];
      const required=requests.reduce((n,r)=>n+r[1],0);
      const factor=required>accepting?accepting/required:1;
      for(const [from,requested] of requests){
        const transferred=requested*factor;
        delta[from][edges[from].n-1]-=transferred;
        delta[to][0]+=transferred;
      }
    }
    // Only a true graph sink can discharge vehicles.
    for(let j=0;j<edges.length;j++){
      const edge=edges[j];
      if(edge.next.length)continue;
      const moved=send[j][edge.n-1];
      delta[j][edge.n-1]-=moved;
      exited+=moved;
    }
    // No internal phantom demand: source edges must be actual directed
    // network boundaries. Unadmitted vehicles remain in external backlog.
    for(const edge of sources){
      const j=edges.indexOf(edge);
      const offered=(edge.lanes*1750)*(demandPercent/100)*dt/3600;
      generated+=offered;
      const available=edge.backlog+offered;
      const admitted=Math.min(available,receive[j][0]);
      delta[j][0]+=admitted;
      edge.backlog=Math.max(0,available-admitted);
    }
    for(let j=0;j<edges.length;j++){
      const edge=edges[j],change=delta[j];
      for(let k=0;k<edge.n;k++){
        const after=edge.stock[k]+change[k];
        if(after < -1e-7||after>edge.jamPerCell+1e-6)
          throw Error("Ungültiger Fahrzeugbestand auf "+edge.id);
        edge.stock[k]=Math.max(0,after);
      }
    }
    elapsed+=dt;
    recomputeSpeeds();
    const stats=totals();
    if(Math.abs(stats.conservationResidual)>1e-5*Math.max(1,generated))
      throw Error("Fahrzeugbilanz verletzt: "+stats.conservationResidual);
    return stats;
  }
  function advance(steps=12){
    if(!Number.isInteger(steps)||steps<1||steps>120)throw Error("Ungültige Simulationsschritte");
    let result;
    for(let i=0;i<steps;i++)result=step();
    return result;
  }
  function speed(id){return byId.get(id)?.speed??null;}
  function color(id){const edge=byId.get(id);return edge?colourForSpeed(edge.speed):"free";}
  function mode(id){return byId.get(id)?.mode??"none";}
  function activeEvents(){return edges.filter(x=>x.mode!=="none").map(x=>({edgeId:x.id,kind:x.mode}));}
  return {advance,step,reset,setMode,setDemandPercent,totals,speed,color,mode,
    activeEvents,sourceCount:()=>sources.length,edgeCount:()=>edges.length};
}
global.createLegacyTrafficScenario=createLegacyTrafficScenario;
})(window);
