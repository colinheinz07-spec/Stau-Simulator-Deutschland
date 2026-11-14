/* Traffic demand reference, ported from Traffic-Sinulator/02_Verkehr.js
 * and 02_Verkehr/anschlussstellen-nachfrage.js (13 Nov 2026).
 * Directional PEAK-HOUR scenario references; never interpreted as DTV.
 * Original weekday/friday/weekend curve tables retained exactly.
 * No network source may be created merely because a road Way is disconnected.
 */
(function(root){
"use strict";
const weekday = {
    transit: [[0, .14], [4, .09], [5, .20], [6, .52], [7, .86], [8, 1], [9, .79], [10, .66], [12, .68], [14, .72], [15, .82], [16, 1], [17, 1.05], [18, .82], [19, .58], [21, .32], [23, .19], [24, .14]],
    koblenz: [[0, .12], [4, .08], [4.5, .12], [5, .24], [6, .62], [7.25, 1], [8, .94], [9, .64], [10, .55], [12, .58], [14, .68], [15.5, .94], [16.5, 1], [17.5, .92], [19, .52], [21, .28], [23, .16], [24, .12]],
    ring: [[0, .18], [4, .12], [4.5, .18], [5, .32], [6, .65], [7.5, 1], [8, .98], [9, .82], [10, .72], [12, .73], [14, .79], [15.5, .98], [16.75, 1.02], [18, .88], [19.5, .64], [22, .31], [24, .18]],
    airport: [[0, .17], [4, .13], [4.5, .21], [5, .34], [6, .72], [7.25, 1], [8, .96], [9, .80], [10, .70], [12, .72], [14, .77], [15.5, .96], [16.75, 1], [18, .86], [20, .52], [22, .28], [24, .17]],
    urban: [[0, .13], [4, .08], [4.5, .14], [5, .29], [6, .73], [7.25, 1], [8, .93], [9, .64], [10, .56], [12, .60], [14, .70], [15.5, .94], [17, 1], [18, .83], [20, .42], [22, .22], [24, .13]],
    siegtal: [[0, .13], [4, .08], [4.5, .13], [5, .27], [6, .66], [7.5, 1], [8, .94], [9, .69], [10, .59], [12, .62], [14, .73], [16, 1], [17, 1.01], [18, .84], [20, .46], [22, .23], [24, .13]]
};
/** Freitag: eigene angenommene Nachfragekurven mit vorgezogener
 * Nachmittags-Hauptbelastung (oft ab 12 Uhr, Spitze etwa 13–15 Uhr).
 * Keine gemessenen Stundenwerte; regional unterschiedlich modelliert. */
const friday = {
    transit: [[0, .14], [4, .09], [5, .20], [6, .52], [7, .86], [8, .97], [9, .76], [10, .71], [11, .76], [12, .87], [13, 1.05], [14, 1.18], [15, 1.17], [16, 1.09], [17, .90], [18, .72], [19, .51], [21, .30], [23, .19], [24, .14]],
    koblenz: [[0, .12], [4, .08], [4.5, .12], [5, .24], [6, .62], [7.25, 1], [8, .94], [9, .64], [10, .60], [11, .69], [12, .83], [13, .99], [14, 1.10], [15, 1.06], [16, .80], [17, .64], [19, .47], [21, .27], [23, .16], [24, .12]],
    ring: [[0, .18], [4, .12], [4.5, .18], [5, .32], [6, .65], [7.5, 1], [8, .98], [9, .82], [10, .73], [11, .79], [12, .90], [13, 1.02], [14, 1.14], [15, 1.12], [16, .96], [17, .80], [18, .69], [19.5, .54], [22, .30], [24, .18]],
    airport: [[0, .17], [4, .13], [4.5, .21], [5, .34], [6, .72], [7.25, 1], [8, .96], [9, .80], [10, .72], [11, .77], [12, .88], [13, 1.02], [14, 1.11], [15, 1.10], [16, .90], [17, .76], [18, .66], [20, .43], [22, .27], [24, .17]],
    urban: [[0, .13], [4, .08], [4.5, .14], [5, .29], [6, .73], [7.25, 1], [8, .93], [9, .64], [10, .62], [11, .71], [12, .85], [13, 1.08], [14, 1.19], [15, 1.06], [16, .79], [17, .66], [18, .52], [20, .36], [22, .20], [24, .13]],
    siegtal: [[0, .13], [4, .08], [4.5, .13], [5, .27], [6, .66], [7.5, 1], [8, .94], [9, .69], [10, .64], [11, .73], [12, .88], [13, 1.04], [14, 1.16], [15, 1.10], [16, .85], [17, .72], [18, .55], [20, .39], [22, .22], [24, .13]]
};
const saturday = [[0, .14], [3, .15], [6, .14], [8, .28], [10, .54], [12, .78], [15, .85], [17, .76], [20, .61], [23, .25], [24, .14]];
const sunday = [[0, .14], [4, .13], [8, .18], [10, .40], [12, .63], [15, .79], [17, .92], [19, .76], [21, .46], [23, .23], [24, .14]];
const exponent = { transit: 1.4, koblenz: 1.25, ring: 1.15, airport: 1.2, urban: 1.3, siegtal: 1.3 };
const REFERENCE_PEAKS = {
    'extra-a1-dortmund': 2900, 'extra-a1-koblenz': 2850,
    'A3-koeln': 4200, 'A3-frankfurt': 4100, 'A48-dernbach': 2400, 'A48-koblenz': 1700,
    'extra-a59-koeln': 3600, 'extra-a59-bonn': 3600,
    'extra-a4-aachen': 4200, 'extra-a4-olpe': 4300,
    // These retained A555 corridors include one-lane AK Köln-Süd turning arms.
    // Calibrate only traffic committed to each arm, not entire three-lane A555.
    'extra-a555-koeln': 1250, 'extra-a555-bonn': 1200,
    'extra-a559-gremberg': 3100, 'extra-a559-porz': 3000,
    'extra-a560-hennef': 2900, 'extra-a560-bonn': 3200,
    'extra-a562-bonn': 2800, 'extra-a562-bonn-ost': 2700,
    // Explicit scenario assumptions (not measured BASt data).
    'extra-a61-nord': 2800, 'extra-a61-sued': 2700,
    'extra-a565-nord': 2600, 'extra-a565-sued': 2600
};

const LOCAL_JUNCTION_PROFILES = [
    // A3: regionale Abschnitte zwischen Köln/Bonn, Westerwald und Limburg.
    { road: 'A3', ref: '33', name: 'Siebengebirge', entryPercent: 6, exitPercent: 6, reason: 'Regionaler Zubringer' },
    { road: 'A3', ref: '34', name: 'Bad Honnef/Linz', entryPercent: 5.5, exitPercent: 5, reason: 'Regionalverkehr Rheintal' },
    { road: 'A3', ref: '35', name: 'Neustadt/Wied', entryPercent: 4.5, exitPercent: 4, reason: 'Ländlicher Anschluss' },
    { road: 'A3', ref: '36', name: 'Neuwied', entryPercent: 7.5, exitPercent: 7, reason: 'Regionale Ziel- und Quellverkehre' },
    { road: 'A3', ref: '37', name: 'Dierdorf', entryPercent: 5, exitPercent: 5, reason: 'Kleinerer ländlicher Anschluss' },
    { road: 'A3', ref: '38', name: 'Ransbach-Baumbach', entryPercent: 8, exitPercent: 8, reason: 'Regional- und Gewerbeverkehr' },
    { road: 'A3', ref: '40', name: 'Montabaur', entryPercent: 12, exitPercent: 12, reason: 'Größerer regionaler Verteiler' },
    { road: 'A3', ref: '41', name: 'Diez', entryPercent: 6, exitPercent: 5.5, reason: 'Regionale Pendlerzufahrt' },
    { road: 'A3', ref: '42', name: 'Limburg-Nord', entryPercent: 11, exitPercent: 10, reason: 'Städtischer Anschluss und Bundesstraßen' },
    { road: 'A3', ref: '43', name: 'Limburg-Süd', entryPercent: 7, exitPercent: 8, reason: 'Bahnhof und lokales Einzugsgebiet' },
    // A48: westliche Anschlüsse und Rheinbrücke sind kein einheitlicher Korridor.
    { road: 'A48', ref: '10', name: 'Koblenz-Nord', entryPercent: 12, exitPercent: 12, reason: 'Großer regionaler Verteiler' },
    { road: 'A48', ref: '11', name: 'Bendorf/Neuwied', entryPercent: 11, exitPercent: 11, reason: 'Rheinquerung und Umland' },
    { road: 'A48', ref: '12', name: 'Höhr-Grenzhausen', entryPercent: 10, exitPercent: 10, reason: 'Westerwald und Gewerbe' },
    // Köln/Bonn: Flughafen, Pendler und städtische Anschlüsse erhalten eigene Ansätze.
    { road: 'A59', ref: '32', name: 'Rath', entryPercent: 8, exitPercent: 8, reason: 'Städtischer Verteiler' },
    { road: 'A59', ref: '34', name: 'Flughafen', entryPercent: 10, exitPercent: 9, reason: 'Flughafen- und Zubringerverkehr' },
    { road: 'A59', ref: '35', name: 'Wahn', entryPercent: 8, exitPercent: 8, reason: 'Städtischer Anschluss' },
    { road: 'A59', ref: '36', name: 'Lind', entryPercent: 8.5, exitPercent: 8, reason: 'Städtischer Anschluss' },
    { road: 'A59', ref: '37', name: 'Spich', entryPercent: 9.5, exitPercent: 9, reason: 'Gewerbe und Wohngebiete' },
    { road: 'A59', ref: '38', name: 'Troisdorf', entryPercent: 10, exitPercent: 10, reason: 'Regionaler Stadtanschluss' },
    { road: 'A59', ref: '41', name: 'Bonn-Vilich', entryPercent: 8, exitPercent: 8, reason: 'Städtischer Einzugsbereich' },
    { road: 'A59', ref: '42', name: 'Bonn-Pützchen', entryPercent: 7.5, exitPercent: 7, reason: 'Städtischer Einzugsbereich' },
    { road: 'A4', ref: '11a', name: 'Köln-Klettenberg', entryPercent: 8, exitPercent: 8, reason: 'Städtische Ein- und Ausfahrt' },
    { road: 'A4', ref: '11b', name: 'Köln-Eifeltor', entryPercent: 9.5, exitPercent: 9, reason: 'Gewerbe und städtischer Verkehr' },
    { road: 'A4', ref: '13', name: 'Köln-Poll', entryPercent: 10, exitPercent: 10, reason: 'Städtischer Verteiler' },
    { road: 'A559', ref: '2', name: 'Köln-Gremberghoven', entryPercent: 11, exitPercent: 11, reason: 'Gewerbe und Stadtzubringer' },
    { road: 'A555', ref: '3', name: 'Rodenkirchen', entryPercent: 9.5, exitPercent: 9, reason: 'Städtischer Anschluss' },
    { road: 'A555', ref: '4', name: 'Köln-Godorf', entryPercent: 10, exitPercent: 9, reason: 'Industrie und Gewerbe' },
    { road: 'A555', ref: '5', name: 'Wesseling', entryPercent: 9, exitPercent: 9, reason: 'Pendler und Gewerbe' },
    { road: 'A555', ref: '6', name: 'Bornheim', entryPercent: 7.5, exitPercent: 7.5, reason: 'Regionalverkehr' },
    { road: 'A560', ref: '2', name: 'Siegburg', entryPercent: 9, exitPercent: 9, reason: 'Städtischer Anschluss' },
    { road: 'A560', ref: '3', name: 'Sankt Augustin', entryPercent: 9.5, exitPercent: 9, reason: 'Pendler und Stadtzubringer' },
    { road: 'A560', ref: '4', name: 'Niederpleis', entryPercent: 8, exitPercent: 8, reason: 'Regionaler Stadtanschluss' },
    { road: 'A560', ref: '6', name: 'Hennef-West', entryPercent: 8, exitPercent: 8, reason: 'Regionale Pendlerzufahrt' },
    { road: 'A560', ref: '7', name: 'Hennef-Ost', entryPercent: 6.5, exitPercent: 6.5, reason: 'Regionale Pendlerzufahrt' },
    { road: 'A562', ref: '2', name: 'Bonn-Bad Godesberg', entryPercent: 10, exitPercent: 10, reason: 'Städtischer Verteiler' },
    { road: 'A562', ref: '3', name: 'Bonn-Rheinaue', entryPercent: 9, exitPercent: 9, reason: 'Städtischer Anschluss' },
    { road: 'A562', ref: '4', name: 'Bonn-Ramersdorf', entryPercent: 9.5, exitPercent: 9, reason: 'Städtischer Anschluss' },
    { road: 'A565', ref: '2', name: 'Bonn-Beuel-Nord', entryPercent: 9, exitPercent: 9, reason: 'Städtischer Anschluss' },
    { road: 'A565', ref: '3', name: 'Bonn-Auerberg', entryPercent: 10, exitPercent: 9.5, reason: 'Städtischer Anschluss' }
];

const familyByRef={
  A3:"transit",A48:"koblenz",A59:"airport",A4:"ring",
  A1:"ring",A555:"ring",A559:"urban",A560:"siegtal",
  A562:"urban",A565:"urban",A61:"transit"
};
const siteProfiles=new Map(LOCAL_JUNCTION_PROFILES.map(p=>[p.road+":"+p.ref,p]));
const legacyShares={"A3:40":12,"A3:43":7,"A3:37":5,"A3:36":7,"A3:38":8,
  "A48:12":10,"A48:11":11,"A48:10":12};
function smoothInterpolate(points,hour){
  if(hour<=points[0][0])return points[0][1];
  for(let i=1;i<points.length;i++){
    const [end,value]=points[i], [begin,prev]=points[i-1];
    if(hour<=end){
      const t=(hour-begin)/(end-begin),smooth=t*t*(3-2*t);
      return prev+(value-prev)*smooth;
    }
  }
  return points.at(-1)[1];
}
// Published school vacation windows for RP, NRW, HE (2026 and 2026/27).
// Sources: kmk.org/service/ferienregelung/ferienkalender.html and VRM.
// These are CALENDAR dates; their traffic multipliers remain model assumptions.
const schoolBreaks={
  RP:[["2026-03-30","2026-04-10"],["2026-06-29","2026-08-07"],
    ["2026-10-05","2026-10-16"],["2026-12-23","2027-01-08"],
    ["2027-03-22","2027-04-02"],["2027-06-28","2027-08-06"]],
  NW:[["2026-03-30","2026-04-11"],["2026-05-26","2026-05-26"],
    ["2026-07-20","2026-09-01"],["2026-10-17","2026-10-31"],
    ["2026-12-23","2027-01-06"],["2027-03-22","2027-04-03"],
    ["2027-05-18","2027-05-18"],["2027-07-19","2027-08-31"]],
  HE:[["2026-03-30","2026-04-10"],["2026-06-29","2026-08-07"],
    ["2026-10-05","2026-10-17"],["2026-12-23","2027-01-12"],
    ["2027-03-22","2027-04-02"],["2027-06-28","2027-08-06"]]
};
function localState(ref,points){
  if(ref==="A48")return "RP";
  const first=points[0]||[50.5,7.5];
  if(first[0]>=50.67)return "NW";
  if(first[0]<50.48&&first[1]>=8.06)return "HE";
  return "RP";
}
function easterSunday(year){
  const a=year%19,b=Math.floor(year/100),c=year%100,d=Math.floor(b/4),e=b%4;
  const f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3);
  const h=(19*a+b-d-g+15)%30,i=Math.floor(c/4),k=c%4;
  const l=(32+2*e+2*i-h-k)%7,m=Math.floor((a+11*h+22*l)/451);
  const v=h+l-7*m+114,month=Math.floor(v/31),day=v%31+1;
  return Date.UTC(year,month-1,day);
}
const plusDays=(ms,n)=>new Date(ms+n*86400000).toISOString().slice(0,10);
function isPublicHoliday(date,state){
  const year=Number(date.slice(0,4)),easter=easterSunday(year);
  const fixed=["01-01","05-01","10-03","12-25","12-26"];
  if(fixed.includes(date.slice(5)))return true;
  if([plusDays(easter,-2),plusDays(easter,1),plusDays(easter,39),
    plusDays(easter,50)].includes(date))return true;
  if(["RP","NW","HE"].includes(state)&&date===plusDays(easter,60))return true;
  return ["RP","NW"].includes(state)&&date.endsWith("-11-01");
}
function calendarStatus(ref,points,time){
  const clock=localClock(time),state=localState(ref,points),date=clock.date;
  const isBreak=st=>(schoolBreaks[st]||[]).some(([a,b])=>date>=a&&date<=b);
  const regionalVacation=isBreak(state),neighborVacation=["RP","NW","HE"]
    .filter(st=>st!==state&&isBreak(st)).length;
  const holiday=isPublicHoliday(date,state);
  const weekday=clock.day>=1&&clock.day<=5,hour=clock.hour;
  let factor=1;
  if(holiday&&weekday){
    // A public holiday removes commuter traffic, but leaves tourist travel.
    factor=hour>=6&&hour<10?.58:hour>=15&&hour<19?.70:
      hour>=10&&hour<15?.92:.82;
  }else if(regionalVacation&&weekday){
    const commute=hour>=6&&hour<9||hour>=15&&hour<19;
    factor=commute?.88:hour>=10&&hour<16?1.10:1;
  }
  if(weekday&&!holiday&&neighborVacation>0&&hour>=10&&hour<18)
    factor*=1+.035*neighborVacation;
  return {date,state,holiday,schoolHoliday:regionalVacation,
    neighboringSchoolHolidays:neighborVacation,factor};
}
const formatter=new Intl.DateTimeFormat("en-GB",{
  timeZone:"Europe/Berlin",weekday:"short",hour:"2-digit",
  minute:"2-digit",year:"numeric",month:"2-digit",day:"2-digit",hourCycle:"h23"
});
function localClock(ms){
  const t=Object.fromEntries(formatter.formatToParts(new Date(ms))
    .map(x=>[x.type,x.value]));
  const days={Sun:0,Mon:1,Tue:2,Wed:3,Thu:4,Fri:5,Sat:6};
  return {day:days[t.weekday]??0,hour:Number(t.hour)+Number(t.minute)/60,
    date:t.year+"-"+t.month+"-"+t.day};
}
function motorwayDirection(ref,points,name=""){
  const first=points[0],last=points.at(-1),dy=last[0]-first[0],dx=last[1]-first[1];
  const route=(String(name).split("→").at(-1)||"").toLowerCase();
  if(ref==="A3")return /frankfurt|wiesbaden/.test(route)?"A3-frankfurt":
    /köln|koeln/.test(route)?"A3-koeln":dy>=0?"A3-koeln":"A3-frankfurt";
  if(ref==="A48")return /dernbach/.test(route)?"A48-dernbach":
    /koblenz/.test(route)?"A48-koblenz":dx>=0?"A48-dernbach":"A48-koblenz";
  if(ref==="A59")return /bonn/.test(route)&&!/köln|koeln|heumar/.test(route)?
    "extra-a59-bonn":dy>=0?"extra-a59-koeln":"extra-a59-bonn";
  if(ref==="A4")return /aachen/.test(route)?"extra-a4-aachen":
    /olpe/.test(route)?"extra-a4-olpe":dx>=0?"extra-a4-olpe":"extra-a4-aachen";
  if(ref==="A1")return dy>=0?"extra-a1-dortmund":"extra-a1-koblenz";
  if(ref==="A555")return dy>=0?"extra-a555-koeln":"extra-a555-bonn";
  if(ref==="A559")return /porz/.test(route)?"extra-a559-porz":
    /gremberg/.test(route)?"extra-a559-gremberg":dy>=0?"extra-a559-gremberg":"extra-a559-porz";
  if(ref==="A560")return /hennef/.test(route)?"extra-a560-hennef":
    /bonn/.test(route)?"extra-a560-bonn":dx>=0?"extra-a560-hennef":"extra-a560-bonn";
  if(ref==="A562")return dx>=0?"extra-a562-bonn-ost":"extra-a562-bonn";
  if(ref==="A61")return dy>=0?"extra-a61-nord":"extra-a61-sued";
  if(ref==="A565")return dy>=0?"extra-a565-nord":"extra-a565-sued";
  return ref+"-"+(Math.abs(dy)>=Math.abs(dx)?"lat":"lon")+(Math.abs(dy)>=Math.abs(dx)?Math.sign(dy):Math.sign(dx));
}
function regionFor(key,ref,points){
  if(ref==="A3"&&points?.some(p=>p[0]>50.84&&p[1]<7.17))return "ring";
  return familyByRef[ref]||"transit";
}
function profileFactor(key,ref,ms,points=[]){
  const clock=localClock(ms),day=clock.day,hour=clock.hour;
  const family=regionFor(key,ref,points),base=weekday[family]||weekday.transit;
  let raw;
  if(day===0||day===6){
    const weekend=day===0?sunday:saturday;
    const curve=weekend.map(([h,v])=>[h,h===0||h===24?base[0][1]:v]);
    raw=smoothInterpolate(curve,hour);
    const s=Math.sin(Math.PI*hour/24)**2;
    if(family==="urban"||family==="siegtal")raw*=1-.18*s;
    if(family==="koblenz")raw*=1-.24*s;
    if(family==="airport")raw+=.08*s;
  }else{
    raw=smoothInterpolate(day===5?friday[family]:base,hour);
    const scale=day===2?.98:day===4?1.02:day===5?(family==="transit"?1.06:.94):1;
    raw*=1+(scale-1)*Math.sin(Math.PI*hour/24)**2;
  }
  let direction=1;
  if(day!==0&&day!==6){
    const morning=Math.max(0,1-Math.abs(hour-(family==="transit"?7.75:7.4))/2.5);
    const evening=Math.max(0,1-Math.abs(hour-(day===5?14.5:16.75))/2.5);
    const morningKeys=new Set(["A3-frankfurt","A48-dernbach",
      "extra-a59-koeln","extra-a559-gremberg","extra-a560-bonn",
      "extra-a4-olpe","extra-a555-koeln","extra-a562-bonn"]);
    const eveningKeys=new Set(["A3-koeln","A48-koblenz",
      "extra-a59-bonn","extra-a559-porz","extra-a560-hennef",
      "extra-a4-aachen","extra-a555-bonn","extra-a562-bonn-ost"]);
    if(morningKeys.has(key))direction+=.09*morning;
    if(eveningKeys.has(key))direction+=.09*evening;
  }
  const exp=exponent[family]||1.3;
  const context=calendarStatus(ref,points,ms);
  return Math.max(0,(raw<1?raw**exp:raw)*direction*context.factor);
}
function referenceForRoad(row){
  const ref=row[2]||"",points=row[4],name=row[5]||"";
  const key=motorwayDirection(ref,points,name);
  const peak=REFERENCE_PEAKS[key]||0;
  return {key,ref,peakVph:peak,kind:row[1],family:regionFor(key,ref,points)};
}
function junctionEntryPeak(row){
  const descriptor=referenceForRoad(row);
  // Apply original AS entrance percentage to the corresponding motorway
  // directional peak; do not insert one whole motorway flow at each ramp.
  const match=(row[5]||"").match(/\bAS\s*(\d+[a-z]?)\b/i);
  const site=match?siteProfiles.get(descriptor.ref+":"+match[1]):null;
  const percentage=site?.entryPercent??legacyShares[descriptor.ref+":"+(match?.[1]||"")]??
    (descriptor.ref==="A59"||descriptor.ref==="A559"?9:6);
  return Math.max(0,descriptor.peakVph*percentage/100);
}
const api=Object.freeze({REFERENCE_PEAKS,LOCAL_JUNCTION_PROFILES,
  referenceForRoad,junctionEntryPeak,profileFactor,motorwayDirection,localClock,
  calendarStatus,isPublicHoliday,schoolBreaks});
root.StauTrafficReference=api;
})(typeof window!=="undefined"?window:globalThis);
