/* 04_Ereignisse: recurrence in Europe/Berlin; DST and overnight-safe. */
(function(global){
"use strict";
const ZONE="Europe/Berlin";
const pad=n=>String(n).padStart(2,"0");
const dateRE=/^\d{4}-\d{2}-\d{2}$/;
const timeRE=/^(?:[01]\d|2[0-3]):[0-5]\d$/;
const fmt=new Intl.DateTimeFormat("en-GB",{timeZone:ZONE,year:"numeric",month:"2-digit",
  day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"});
function parts(ms){
  const p={};
  for(const entry of fmt.formatToParts(new Date(ms)))if(entry.type!=="literal")
    p[entry.type]=Number(entry.value);
  return p;
}
function localDate(ms){
  const p=parts(ms);
  return String(p.year)+"-"+pad(p.month)+"-"+pad(p.day);
}
function localDateTime(ms){
  const p=parts(ms);
  return localDate(ms)+"T"+pad(p.hour)+":"+pad(p.minute);
}
function validDate(x){
  if(typeof x!=="string"||!dateRE.test(x))return false;
  const d=new Date(x+"T12:00:00Z");
  return !Number.isNaN(d.getTime())&&d.toISOString().slice(0,10)===x;
}
function validTime(x){return typeof x==="string"&&timeRE.test(x);}
function plusDays(d,n){
  return new Date(Date.parse(d+"T12:00:00Z")+n*86400000).toISOString().slice(0,10);
}
function wall(p){return Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second);}
function localInstant(date,time,preferLast=false){
  if(!validDate(date)||!validTime(time))throw Error("Ungültiges Datum oder Uhrzeit");
  const target=Date.parse(date+"T"+time+":00Z"),offsets=new Set();
  for(const h of [-36,-12,0,12,36]){
    const sampled=target+h*3600000;
    offsets.add(wall(parts(sampled))-sampled);
  }
  const instants=[...offsets].map(offset=>target-offset);
  const exact=instants.filter(ms=>wall(parts(ms))===target).sort((a,b)=>a-b);
  if(exact.length)return preferLast?exact.at(-1):exact[0];
  const next=instants.map(ms=>({ms,w:wall(parts(ms))}))
    .filter(x=>x.w>target).sort((a,b)=>a.w-b.w);
  if(!next.length)throw Error("Ortszeit konnte nicht aufgelöst werden");
  return next[0].ms;
}
const occCache=new Map();
function occurrence(s,date){
  if(date<s.firstDate||date>s.lastDate)return null;
  const day=new Date(date+"T12:00:00Z").getUTCDay();
  if(!s.weekdays.includes(day))return null;
  const key=[date,s.startTime,s.endTime].join("|");
  if(occCache.has(key))return occCache.get(key);
  const endDate=s.endTime<s.startTime?plusDays(date,1):date;
  const start=localInstant(date,s.startTime),end=localInstant(endDate,s.endTime,true);
  const value=end>start?{start,end}:null;
  occCache.set(key,value);
  if(occCache.size>1000)occCache.delete(occCache.keys().next().value);
  return value;
}
function validate(schedule){
  if(schedule===null||schedule===undefined)return true;
  if(!schedule||typeof schedule!=="object")return false;
  if(schedule.mode==="once")
    return Number.isFinite(schedule.startAt)&&Number.isFinite(schedule.endAt)&&
      schedule.startAt<schedule.endAt;
  if(schedule.mode!=="repeat"||!validDate(schedule.firstDate)||
    !validDate(schedule.lastDate)||schedule.firstDate>schedule.lastDate||
    !validTime(schedule.startTime)||!validTime(schedule.endTime)||
    schedule.startTime===schedule.endTime||!Array.isArray(schedule.weekdays)||
    schedule.weekdays.length<1||schedule.weekdays.length>7||
    new Set(schedule.weekdays).size!==schedule.weekdays.length||
    !schedule.weekdays.every(n=>Number.isInteger(n)&&n>=0&&n<=6))return false;
  let hasOccurrence=false;
  for(let i=0;i<7;i++){
    const d=plusDays(schedule.firstDate,i);
    if(d>schedule.lastDate)break;
    if(occurrence(schedule,d)){hasOccurrence=true;break;}
  }
  return hasOccurrence;
}
function active(schedule,at){
  if(!Number.isFinite(at))return false;
  if(schedule===null||schedule===undefined)return true;
  if(!validate(schedule))return false;
  if(schedule.mode==="once")return at>=schedule.startAt&&at<schedule.endAt;
  const today=localDate(at);
  for(const day of [today,plusDays(today,-1)]){
    const window=occurrence(schedule,day);
    if(window&&at>=window.start&&at<window.end)return true;
  }
  return false;
}
function label(schedule){
  if(!schedule)return "Sofort / dauerhaft";
  if(schedule.mode==="once")return "Einmalig: "+
    localDateTime(schedule.startAt).replace("T"," ")+" – "+
    localDateTime(schedule.endAt).replace("T"," ");
  return "Wiederholt: "+schedule.firstDate+" bis "+schedule.lastDate+" · "+
    schedule.startTime+"–"+schedule.endTime+" Uhr · "+
    schedule.weekdays.map(d=>["So","Mo","Di","Mi","Do","Fr","Sa"][d]).join(", ");
}
global.StauEventSchedule={ZONE,parts,localDate,localDateTime,validDate,validTime,
  plusDays,localInstant,validate,active,label};
})(window);
