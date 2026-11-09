/* Map renderer adapted from the working Canvas approach in Traffic-Sinulator.
 * Local, real OSM geometry; no Leaflet or Overpass required for road visibility.
 * Static preview only; do not imply the offline snapshot is a live simulation.
 */
(function(){
"use strict";
const $=id=>document.getElementById(id);
const RAD=Math.PI/180;
const CORRIDOR=[[50.15,6.84],[50.88,8.21]];
const GERMANY=[[47.1,5.65],[55.15,15.35]];
function merc(point){
  const lat=Math.max(-85,Math.min(85,point[0]))*RAD;
  return [(point[1]+180)*256/360,
    (1-Math.log(Math.tan(Math.PI/4+lat/2))/Math.PI)*128];
}
function distance(a,b){
  const d1=(b[0]-a[0])*RAD,d2=(b[1]-a[1])*RAD;
  const v=Math.sin(d1/2)**2+
    Math.cos(a[0]*RAD)*Math.cos(b[0]*RAD)*Math.sin(d2/2)**2;
  return 12742000*Math.asin(Math.min(1,Math.sqrt(v)));
}
function clamp(n,a,b){return Math.min(b,Math.max(a,n));}
function format(n){return n.toLocaleString("de-DE");}
function prepareGeometry(data){
  return data.roads.filter(row=>Array.isArray(row[4])&&row[4].length>1).map(row=>{
    const path=row[4].map(merc);
    let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity,meters=0;
    for(let i=0;i<path.length;i++){
      const p=path[i];
      minX=Math.min(minX,p[0]);maxX=Math.max(maxX,p[0]);
      minY=Math.min(minY,p[1]);maxY=Math.max(maxY,p[1]);
      if(i)meters+=distance(row[4][i-1],row[4][i]);
    }
    return {id:row[0],kind:row[1],ref:row[2],lanes:row[3],
      points:path,bbox:[minX,minY,maxX,maxY],meters,
      name:row[5],osm:row[6]};
  });
}
async function startLegacyCanvas(existingMap=null){
  if(document.body.classList.contains("canvas-preview"))return;
  const data=window.STAU_LEGACY_GEOMETRY;
  if(!data||!Array.isArray(data.roads)||data.roads.length<100)
    throw Error("Die lokalen Autobahngeometrien fehlen.");
  const root=$("map");
  if(existingMap){try{existingMap.remove();}catch(error){console.warn(error);}}
  root.replaceChildren();
  document.body.classList.add("preview-only","canvas-preview");
  const canvas=document.createElement("canvas");
  canvas.className="legacy-preview-canvas";
  canvas.setAttribute("aria-label","Interaktive Autobahnkarte mit Original-Geometrien aus der alten Stau-App");
  root.append(canvas);
  const context=canvas.getContext("2d",{alpha:false});
  if(!context)throw Error("Canvas 2D wird von diesem Browser nicht unterstützt.");

  const zoomBox=document.createElement("div");
  zoomBox.className="preview-zoom";
  const zoomIn=document.createElement("button"),zoomOut=document.createElement("button");
  zoomIn.type=zoomOut.type="button";
  zoomIn.textContent="+";zoomOut.textContent="−";
  zoomIn.setAttribute("aria-label","Karte vergrößern");
  zoomOut.setAttribute("aria-label","Karte verkleinern");
  zoomBox.append(zoomIn,zoomOut);
  root.append(zoomBox);

  const coverage=$("coverage");
  coverage.querySelector("b").textContent="A3 / A48 · Straßennetz aus alter App";
  const note=coverage.querySelector("small");
  if(note)note.textContent="Originale OSM-Geometrie · lokale Kartenvorschau";
  const info=$("map-bottom-info");
  if(info)info.hidden=true;
  const disclaimer=document.querySelector(".legend + .disclaimer");
  if(disclaimer)disclaimer.textContent="Lokale OSM-Kartenvorschau ohne simulierte Fahrzeuge. Für die vollständige Stauphysik wird die gebaute Netzversion verwendet.";
  const eventActions=document.querySelector(".detail-drawer .event-actions");
  if(eventActions)eventActions.hidden=true;
  const junctionToggle=$("toggle-junctions");
  const selection=$("detail-drawer");
  const backdrop=$("drawer-backdrop");
  const segments=prepareGeometry(data);
  const mainlines=segments.filter(x=>x.kind!=="ramp");
  const ramps=segments.filter(x=>x.kind==="ramp");
  $("chip-roads").textContent=format(segments.length)+" Fahrwege";
  $("chip-ramps").textContent=format(ramps.length)+" Rampen";
  $("map-status").textContent=format(mainlines.length)+" Hauptfahrbahnen · "+
    format(ramps.length)+" Rampen aus alter App geladen";
  const tiles=new Map();
  let width=0,height=0,zoom=8,center=merc([50.5,7.5]),
    request=null,visible=$("toggle-network").checked,
    labels=junctionToggle.checked, selected=null;
  function requestDraw(){
    if(request!==null)return;
    request=requestAnimationFrame(()=>{request=null;draw();});
  }
  function fit(bounds){
    const a=merc(bounds[0]),b=merc(bounds[1]);
    center=[(a[0]+b[0])/2,(a[1]+b[1])/2];
    const availableW=Math.max(150,width-42),availableH=Math.max(180,height-56);
    zoom=clamp(Math.log2(Math.min(
      availableW/Math.max(.01,Math.abs(a[0]-b[0])),
      availableH/Math.max(.01,Math.abs(a[1]-b[1]))
    )),5,16);
    updateButtons();requestDraw();
  }
  function updateButtons(){
    $("btn-germany").classList.toggle("selected",zoom<7);
    $("btn-test-region").classList.toggle("selected",zoom>=7);
  }
  function pointAt(world){
    const scale=2**zoom;
    return [(world[0]-center[0])*scale+width/2,
      (world[1]-center[1])*scale+height/2];
  }
  function zoomAt(x,y,step){
    const oldScale=2**zoom;
    const anchor=[center[0]+(x-width/2)/oldScale,
      center[1]+(y-height/2)/oldScale];
    zoom=clamp(zoom+step,5,17.5);
    const next=2**zoom;
    center=[anchor[0]-(x-width/2)/next,
      anchor[1]-(y-height/2)/next];
    updateButtons();requestDraw();
  }
  function pan(dx,dy){
    const scale=2**zoom;
    center=[center[0]-dx/scale,center[1]-dy/scale];
    requestDraw();
  }
  function tileImage(z,x,y){
    const n=2**z;
    if(x<0||y<0||x>=n||y>=n)return null;
    const key=z+"/"+x+"/"+y;
    if(tiles.has(key))return tiles.get(key);
    if(tiles.size>140){
      for(const k of tiles.keys()){tiles.delete(k);if(tiles.size<100)break;}
    }
    const item={image:new Image(),ready:false,error:false};
    tiles.set(key,item);
    item.image.onload=()=>{item.ready=true;requestDraw();};
    item.image.onerror=()=>{item.error=true;requestDraw();};
    item.image.src="https://tile.openstreetmap.org/"+z+"/"+x+"/"+y+".png";
    return item;
  }
  function drawTiles(){
    const z=clamp(Math.floor(zoom),5,17);
    const scale=2**zoom;
    const tileWorld=256/2**z;
    const pSize=tileWorld*scale;
    const xMin=Math.floor((center[0]-width/(2*scale))/tileWorld);
    const xMax=Math.floor((center[0]+width/(2*scale))/tileWorld);
    const yMin=Math.floor((center[1]-height/(2*scale))/tileWorld);
    const yMax=Math.floor((center[1]+height/(2*scale))/tileWorld);
    // Standard OSM tiles are a background enhancement, never a road dependency.
    for(let y=yMin;y<=yMax;y++)for(let x=xMin;x<=xMax;x++){
      const tile=tileImage(z,x,y);
      if(!tile||!tile.ready)continue;
      const sx=width/2+(x*tileWorld-center[0])*scale;
      const sy=height/2+(y*tileWorld-center[1])*scale;
      context.drawImage(tile.image,Math.floor(sx),Math.floor(sy),
        Math.ceil(pSize)+1,Math.ceil(pSize)+1);
    }
  }
  function inView(s,scale){
    const l=center[0]-(width/2+35)/scale;
    const r=center[0]+(width/2+35)/scale;
    const t=center[1]-(height/2+35)/scale;
    const b=center[1]+(height/2+35)/scale;
    return s.bbox[0]<=r&&s.bbox[2]>=l&&s.bbox[1]<=b&&s.bbox[3]>=t;
  }
  function appendRoad(s,scale){
    const points=s.points;
    for(let i=0;i<points.length;i++){
      const x=(points[i][0]-center[0])*scale+width/2;
      const y=(points[i][1]-center[1])*scale+height/2;
      if(i===0)context.moveTo(x,y);else context.lineTo(x,y);
    }
  }
  function strokeGroup(roads,line,scale){
    context.beginPath();
    for(const road of roads){
      if(road!==selected&&inView(road,scale))appendRoad(road,scale);
    }
    context.lineWidth=line+2;
    context.strokeStyle="#132c3a";
    context.stroke();
    context.lineWidth=line;
    context.strokeStyle="#19b979";
    context.stroke();
  }
  function drawLabels(){
    if(!labels||zoom<11.4)return;
    context.font="600 11px -apple-system,Arial,sans-serif";
    context.textAlign="center";
    const boxes=[],max=60;
    for(const j of data.junctions){
      if(boxes.length>=max)break;
      const xy=pointAt(merc(j[3]));
      if(xy[0]<15||xy[1]<120||xy[0]>width-15||xy[1]>height-20)continue;
      const name=j[0]+" "+j[2];
      const textWidth=Math.min(context.measureText(name).width+12,205);
      const rect=[xy[0]-textWidth/2,xy[1]-20,xy[0]+textWidth/2,xy[1]-3];
      if(boxes.some(b=>rect[0]<b[2]+6&&rect[2]>b[0]-6&&rect[1]<b[3]+5&&rect[3]>b[1]-5))continue;
      boxes.push(rect);
      context.fillStyle="#14283ae8";
      context.fillRect(rect[0],rect[1],textWidth,17);
      context.fillStyle="#ffffff";
      context.fillText(name,xy[0],xy[1]-7,Math.max(20,textWidth-8));
    }
  }
  function draw(){
    if(!width||!height)return;
    const dpr=clamp(window.devicePixelRatio||1,1,2);
    context.setTransform(dpr,0,0,dpr,0,0);
    context.fillStyle="#dae5e1";
    context.fillRect(0,0,width,height);
    drawTiles();
    if(visible){
      const scale=2**zoom;
      context.lineJoin="round";context.lineCap="round";
      for(const group of [mainlines,ramps]){
        if(group===ramps&&zoom<7.6)continue;
        const line=group===ramps?clamp(1.5+(zoom-10)*.25,1,3.8):
          clamp(3.5+(zoom-10)*.65,2.2,7);
        // Batch hundreds of OSM segments into just two Canvas strokes,
        // so drag/pinch stays responsive even on older iPhones.
        strokeGroup(group,line,scale);
        if(selected&&group.includes(selected)&&inView(selected,scale)){
          context.beginPath();
          appendRoad(selected,scale);
          context.lineWidth=line+2;context.strokeStyle="#132c3a";context.stroke();
          context.lineWidth=line;context.strokeStyle="#ffe37c";context.stroke();
        }
      }
      drawLabels();
    }
    context.fillStyle="#ffffffee";
    context.fillRect(7,height-24,185,18);
    context.font="10px system-ui,sans-serif";
    context.textAlign="left";
    context.fillStyle="#334c59";
    context.fillText("© OpenStreetMap-Mitwirkende · ODbL",11,height-11);
  }
  function resize(){
    const rect=root.getBoundingClientRect();
    const nextWidth=Math.floor(rect.width),nextHeight=Math.floor(rect.height);
    if(nextWidth<80||nextHeight<80)return;
    width=nextWidth;height=nextHeight;
    const dpr=clamp(window.devicePixelRatio||1,1,2);
    canvas.width=Math.round(width*dpr);
    canvas.height=Math.round(height*dpr);
    if(!canvas.dataset.fitted){canvas.dataset.fitted="yes";fit(CORRIDOR);}
    requestDraw();
  }
  function close(){
    selection.classList.remove("open");
    selection.setAttribute("aria-hidden","true");
    backdrop.hidden=true;
    selected=null;requestDraw();
  }
  function open(s){
    selected=s;
    $("detail-heading").textContent=s.name||s.ref||"Autobahnabschnitt";
    $("detail-type").textContent=s.kind==="ramp"?
      "Auf-/Abfahrt oder Autobahn-Überleitung":"Autobahn-Hauptfahrbahn";
    $("detail-lanes").textContent=s.lanes+" Fahrstreifen";
    $("detail-length").textContent=s.meters>=1000?
      (s.meters/1000).toLocaleString("de-DE",{maximumFractionDigits:2})+" km":
      Math.round(s.meters)+" m";
    $("detail-speed").textContent="Keine simulierten Geschwindigkeiten";
    $("detail-osm").textContent=s.osm?String(s.osm):"OSM-Geometrie aus Altbestand";
    selection.classList.add("open");
    selection.setAttribute("aria-hidden","false");
    backdrop.hidden=false;
    requestDraw();
  }
  function nearest(x,y){
    if(!visible)return null;
    const scale=2**zoom,threshold=14;
    let best=null,bestD=threshold*threshold;
    const search=zoom<7.6?mainlines:segments;
    for(const s of search){
      if(!inView(s,scale))continue;
      let prev=null;
      for(const p of s.points){
        const px=(p[0]-center[0])*scale+width/2;
        const py=(p[1]-center[1])*scale+height/2;
        if(prev){
          const vx=px-prev[0],vy=py-prev[1],d=vx*vx+vy*vy;
          const t=d?clamp(((x-prev[0])*vx+(y-prev[1])*vy)/d,0,1):0;
          const dx=x-(prev[0]+t*vx),dy=y-(prev[1]+t*vy);
          const dsq=dx*dx+dy*dy;
          if(dsq<bestD){best=s;bestD=dsq;}
        }
        prev=[px,py];
      }
    }
    return best;
  }
  const pointers=new Map();
  let tap=null,wasPinching=false;
  const local=e=>{
    const r=canvas.getBoundingClientRect();
    return [e.clientX-r.left,e.clientY-r.top];
  };
  canvas.addEventListener("pointerdown",e=>{
    canvas.setPointerCapture(e.pointerId);
    const p=local(e);
    pointers.set(e.pointerId,p);
    if(pointers.size===1){tap={x:p[0],y:p[1]};wasPinching=false;}
    else{tap=null;wasPinching=true;}
  });
  canvas.addEventListener("pointermove",e=>{
    if(!pointers.has(e.pointerId))return;
    const old=pointers.get(e.pointerId);
    const before=[...pointers.values()];
    const p=local(e);
    pointers.set(e.pointerId,p);
    if(tap&&Math.hypot(tap.x-p[0],tap.y-p[1])>8)tap=null;
    if(pointers.size===1){pan(p[0]-old[0],p[1]-old[1]);return;}
    if(pointers.size!==2)return;
    const after=[...pointers.values()];
    const oldDist=Math.hypot(before[0][0]-before[1][0],before[0][1]-before[1][1]);
    const newDist=Math.hypot(after[0][0]-after[1][0],after[0][1]-after[1][1]);
    const oldMid=[(before[0][0]+before[1][0])/2,(before[0][1]+before[1][1])/2];
    const newMid=[(after[0][0]+after[1][0])/2,(after[0][1]+after[1][1])/2];
    pan(newMid[0]-oldMid[0],newMid[1]-oldMid[1]);
    if(oldDist>8&&newDist>8)
      zoomAt(newMid[0],newMid[1],Math.log2(newDist/oldDist));
  });
  function endPointer(e){
    if(!pointers.has(e.pointerId))return;
    pointers.delete(e.pointerId);
    const p=local(e);
    if(!pointers.size&&!wasPinching&&tap&&Math.hypot(p[0]-tap.x,p[1]-tap.y)<10){
      const hit=nearest(p[0],p[1]);
      if(hit)open(hit);
    }
    if(!pointers.size){tap=null;wasPinching=false;}
  }
  canvas.addEventListener("pointerup",endPointer);
  canvas.addEventListener("pointercancel",endPointer);
  canvas.addEventListener("wheel",e=>{e.preventDefault();const p=local(e);
    zoomAt(p[0],p[1],e.deltaY<0?.45:-.45);
  },{passive:false});
  zoomIn.addEventListener("click",()=>zoomAt(width/2,height/2,.8));
  zoomOut.addEventListener("click",()=>zoomAt(width/2,height/2,-.8));
  $("btn-germany").addEventListener("click",()=>{close();fit(GERMANY);});
  $("btn-test-region").addEventListener("click",()=>{close();fit(CORRIDOR);});
  $("toggle-network").addEventListener("change",e=>{visible=e.target.checked;requestDraw();});
  junctionToggle.addEventListener("change",e=>{labels=e.target.checked;requestDraw();});
  $("close-drawer").addEventListener("click",close);
  backdrop.addEventListener("click",close);
  document.addEventListener("keydown",e=>{if(e.key==="Escape")close();});
  if(typeof ResizeObserver==="function")new ResizeObserver(resize).observe(root);
  window.addEventListener("resize",resize);
  resize();
  setTimeout(resize,120);
}
window.startLegacyCanvas=startLegacyCanvas;
})();
