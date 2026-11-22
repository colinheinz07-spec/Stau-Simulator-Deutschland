/* Traffic demand reference, ported from Traffic-Sinulator/02_Verkehr.js
 * and 02_Verkehr/anschlussstellen-nachfrage.js (13 Nov 2026).
 * Directional PEAK-HOUR scenario references; never interpreted as DTV.
 * Commuter curves plus separately calibrated through-traffic component.
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
// Minimum combined long-distance passenger and freight demand, as a fraction
// of the directional peak: not measured hourly values. Calibration anchor:
// BASt 2019 AD Dernbach VQ Süd, as published in FIRU GfI report P20-081/B5
// (Aug 2025), pp. 10–11: DTV 106366, night mean 1489 Kfz/h (both directions),
// night goods-vehicle groups 10.5% and 26.3%. Workday night demand is higher
// than the weekly night average. Never apply this to a local ramp source.
const THROUGH_PROFILE_SCALE={A3:1,A61:1,A1:.90,A4:.85,A48:.70};
const THROUGH_WEEKDAY=[[0,.22],[1,.20],[2,.19],[3,.22],[4,.26],[4.5,.31],
  [5,.36],[6,.52],[7,.75],[8,.76],[9,.76],[12,.76],[15,.76],[18,.70],
  [20,.48],[22,.29],[23,.24],[24,.22]];
const THROUGH_SATURDAY=[[0,.20],[2,.14],[4,.13],[6,.15],[8,.18],[12,.20],
  [18,.20],[22,.15],[24,.095]];
const THROUGH_SUNDAY=[[0,.095],[2,.07],[4,.07],[6,.08],[8,.12],[16,.14],
  [21,.14],[22,.15],[23,.19],[24,.20]];
function throughTrafficFloor(ref,clock,holiday){
  const scale=THROUGH_PROFILE_SCALE[ref];
  if(!scale)return 0;
  const curve=holiday||clock.day===0?THROUGH_SUNDAY:
    clock.day===6?THROUGH_SATURDAY:THROUGH_WEEKDAY;
  // Floor is already expressed on the final demand scale. Applying the
  // commuter exponent again would erase most overnight through traffic.
  return scale*smoothInterpolate(curve,clock.hour);
}
const REFERENCE_PEAKS = {
    // Ring and newly connected A57/A59 arms: estimated weekday boundary
    // demand, not a full downstream AADT injected at every junction.
    'extra-a1-dortmund': 3900, 'extra-a1-koblenz': 4000,
    'extra-a57-krefeld': 2600, 'extra-a57-koeln': 3200,
    'extra-a59-duesseldorf': 1900, 'extra-a59-leverkusen': 2000,
    // Regional scenario calibration, not official traffic-counter data.
    'A3-koeln': 5000, 'A3-frankfurt': 5000, 'A48-dernbach': 3200, 'A48-koblenz': 2500,
    // Southern B42 boundary feeds A59 in addition to the A562/A565/A560
    // interchanges. Do not use the combined downstream peak at this source.
    'extra-a59-koeln': 3000, 'extra-a59-bonn': 3600,
    'extra-a4-aachen': 4200, 'extra-a4-olpe': 4300,
    // These retained A555 corridors include one-lane AK Köln-Süd turning arms.
    // Calibrate only traffic committed to each arm, not entire three-lane A555.
    'extra-a555-koeln': 1250, 'extra-a555-bonn': 1200,
    'extra-a559-gremberg': 3100, 'extra-a559-porz': 3000,
    'extra-a560-hennef': 2900, 'extra-a560-bonn': 2800,
    'extra-a562-bonn': 2800, 'extra-a562-bonn-ost': 2400,
    // Explicit scenario assumptions (not measured BASt data).
    // Regional model peaks, anchored to corridor DTV magnitude rather than
    // claiming hourly counter data. A571/A573 are local Ahr valley feeders.
    'extra-a61-nord': 3300, 'extra-a61-sued': 3200,
    'extra-a565-nord': 2300, 'extra-a565-sued': 2600,
    'extra-a571-nord': 700, 'extra-a571-sued': 750,
    'extra-a573-nord': 1050, 'extra-a573-sued': 1050
};

const LOCAL_JUNCTION_PROFILES = [
    {road:'A1',ref:'103',name:'Köln-Lövenich',entryPercent:10,exitPercent:10,entryCapacity:1000,exitCapacity:1100},
    {road:'A1',ref:'102',name:'Köln-Bocklemünd',entryPercent:12,exitPercent:12,entryCapacity:1100,exitCapacity:1150},
    {road:'A1',ref:'100',name:'Köln-Niehl',entryPercent:17,exitPercent:17,entryCapacity:1200,exitCapacity:1300},
    {road:'A57',ref:'27',name:'Köln-Chorweiler',entryPercent:12,exitPercent:12,entryCapacity:900,exitCapacity:1000},
    {road:'A57',ref:'28',name:'Köln-Longerich',entryPercent:10,exitPercent:10,entryCapacity:900,exitCapacity:950},
    {road:'A57',ref:'29',name:'Köln-Bickendorf',entryPercent:15,exitPercent:15,entryCapacity:1050,exitCapacity:1100},
    // Large urban junctions on the newly connected northern Cologne ring.
    {road:'A3',ref:'24',name:'Leverkusen-Zentrum',entryPercent:14,exitPercent:14,entryCapacity:1100,exitCapacity:1200},
    {road:'A3',ref:'25',name:'Köln-Mülheim',entryPercent:12,exitPercent:12,entryCapacity:1000,exitCapacity:1050},
    {road:'A3',ref:'26',name:'Köln-Dellbrück',entryPercent:10,exitPercent:10,entryCapacity:900,exitCapacity:950},
    // A3: regionale Abschnitte zwischen Köln/Bonn, Westerwald und Limburg.
    { road: 'A3', ref: '33', name: 'Siebengebirge', entryPercent: 6, exitPercent: 6, reason: 'Regionaler Zubringer' },
    { road: 'A3', ref: '34', name: 'Bad Honnef/Linz', entryPercent: 5.5, exitPercent: 5, reason: 'Regionalverkehr Rheintal' },
    { road: 'A3', ref: '35', name: 'Neustadt/Wied', entryPercent: 4.5, exitPercent: 4, reason: 'Ländlicher Anschluss' },
    { road: 'A3', ref: '36', name: 'Neuwied', entryPercent: 7.5, exitPercent: 7, reason: 'Regionale Ziel- und Quellverkehre' },
    { road: 'A3', ref: '37', name: 'Dierdorf', entryPercent: 5, exitPercent: 5, reason: 'Kleinerer ländlicher Anschluss' },
    { road: 'A3', ref: '38', name: 'Ransbach-Baumbach', entryPercent: 8, exitPercent: 8, reason: 'Regional- und Gewerbeverkehr' },
    { road: 'A3', ref: '40', name: 'Montabaur', entryPercent: 17, exitPercent: 17, exitCapacity: 1050, entryCapacity: 1000, reason: 'Größerer regionaler Verteiler' },
    { road: 'A3', ref: '41', name: 'Diez', entryPercent: 6, exitPercent: 5.5, reason: 'Regionale Pendlerzufahrt' },
    { road: 'A3', ref: '42', name: 'Limburg-Nord', entryPercent: 16, exitPercent: 16, exitCapacity: 1100, entryCapacity: 1050, reason: 'Städtischer Anschluss und Bundesstraßen' },
    { road: 'A3', ref: '43', name: 'Limburg-Süd', entryPercent: 7, exitPercent: 8, reason: 'Bahnhof und lokales Einzugsgebiet' },
    // A48: westliche Anschlüsse und Rheinbrücke sind kein einheitlicher Korridor.
    { road: 'A48', ref: '10', name: 'Koblenz-Nord', entryPercent: 23, exitPercent: 23, exitCapacity: 1150, entryCapacity: 1050, reason: 'Großer regionaler Verteiler' },
    { road: 'A48', ref: '11', name: 'Bendorf/Neuwied', entryPercent: 19, exitPercent: 19, exitCapacity: 1000, entryCapacity: 950, reason: 'Rheinquerung und Umland' },
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
    { road: 'A565', ref: '3', name: 'Bonn-Auerberg', entryPercent: 10, exitPercent: 9.5, reason: 'Städtischer Anschluss' },
    { road: 'A565', ref: '5', name: 'Bonn-Tannenbusch', entryPercent: 12, exitPercent: 12, entryCapacity: 900, exitCapacity: 900 },
    { road: 'A565', ref: '6', name: 'Bonn-Endenich', entryPercent: 12, exitPercent: 13, entryCapacity: 900, exitCapacity: 950 },
    { road: 'A565', ref: '7', name: 'Bonn-Poppelsdorf', entryPercent: 18, exitPercent: 18, entryCapacity: 1000, exitCapacity: 1050 },
    { road: 'A565', ref: '8', name: 'Bonn-Lengsdorf', entryPercent: 10, exitPercent: 10, entryCapacity: 800, exitCapacity: 850 },
    { road: 'A565', ref: '9', name: 'Bonn-Hardtberg', entryPercent: 13, exitPercent: 13, entryCapacity: 950, exitCapacity: 1000 },
    { road: 'A565', ref: '10', name: 'Meckenheim-Nord', entryPercent: 8, exitPercent: 8, entryCapacity: 750, exitCapacity: 800 },
    { road: 'A565', ref: '11', name: 'Merl', entryPercent: 10, exitPercent: 10, entryCapacity: 850, exitCapacity: 850 },
    { road: 'A565', ref: '13', name: 'Gelsdorf', entryPercent: 7, exitPercent: 7, entryCapacity: 650, exitCapacity: 650 },
    { road: 'A61', ref: '32', name: 'Niederzissen', entryPercent: 6, exitPercent: 6, entryCapacity: 800, exitCapacity: 850 },
    { road: 'A61', ref: '33', name: 'Wehr', entryPercent: 5, exitPercent: 5, entryCapacity: 700, exitCapacity: 750 },
    { road: 'A61', ref: '34', name: 'Mendig', entryPercent: 10, exitPercent: 10, entryCapacity: 950, exitCapacity: 1000 },
    { road: 'A61', ref: '35', name: 'Kruft', entryPercent: 7, exitPercent: 7, entryCapacity: 850, exitCapacity: 850 },
    { road: 'A61', ref: '36', name: 'Plaidt', entryPercent: 9, exitPercent: 9, entryCapacity: 900, exitCapacity: 950 },
    { road: 'A571', ref: '', name: 'Löhndorf', entryPercent: 18, exitPercent: 18, entryCapacity: 600, exitCapacity: 650 },
    { road: 'A571', ref: '', name: 'Ehlingen', entryPercent: 16, exitPercent: 16, entryCapacity: 650, exitCapacity: 700 },
    { road: 'A573', ref: '2', name: 'Bad Neuenahr-West', entryPercent: 25, exitPercent: 25, entryCapacity: 850, exitCapacity: 900 }
];

const familyByRef={
  A3:"transit",A48:"koblenz",A59:"airport",A4:"ring",
  A1:"ring",A57:"ring",A555:"ring",A559:"urban",A560:"siegtal",
  A562:"urban",A565:"urban",A61:"transit",A571:"urban",A573:"urban"
};
const siteProfiles=new Map(LOCAL_JUNCTION_PROFILES.map(p=>[p.road+":"+p.ref,p]));
// Off-map motorway corridors: verified endpoints in the existing OSM
// extract, coarse geographic waypoints outside it. Travel times and spare
// capacity are model assumptions, NOT an imported A61 road geometry.
const WIDE_CORRIDORS=[
  {id:"a61-nord",ref:"A3",direction:"A3-koeln",label:"A61 → A4 Richtung Köln",
    reentryId:"extra-a4-olpe",targetId:"A3-206716768",
    via:[[50.3555867,7.4793613],[50.88,6.68]],capacityVph:1800},
  {id:"a61-sued",ref:"A3",direction:"A3-frankfurt",label:"A61 → Raum Wiesbaden Richtung Frankfurt",
    reentryId:"extra-heumar-4208710",targetId:"A3-3994279",
    via:[[50.3555867,7.4793613],[49.96,7.90]],capacityVph:1800}
];
function junctionProfile(ref,name){
  const match=String(name||"").match(/\bAS\s*(\d+[a-z]?)\b/i);
  return match?siteProfiles.get(ref+":"+match[1]):LOCAL_JUNCTION_PROFILES.find(p=>
    p.road===ref&&!p.ref&&String(name).includes("AS "+p.name));
}
// Model calibration, not measured signal timings: fewer conflicts with
// cross traffic after the evening peak. Keep the transition continuous.
function junctionCapacityFactor(hour,entry=false){
  const relief=smoothInterpolate([[0,1],[4,1],[6,0],[19,0],[21,.45],[23,1],[24,1]],hour);
  return 1+relief*(entry?.18:.35);
}
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
let lastClockMinute=NaN,lastClock;
function localClock(ms){
  const minute=Math.floor(ms/60000);
  if(minute===lastClockMinute)return lastClock;
  const t=Object.fromEntries(formatter.formatToParts(new Date(ms))
    .map(x=>[x.type,x.value]));
  const days={Sun:0,Mon:1,Tue:2,Wed:3,Thu:4,Fri:5,Sat:6};
  lastClockMinute=minute;
  return lastClock={day:days[t.weekday]??0,hour:Number(t.hour)+Number(t.minute)/60,
    date:t.year+"-"+t.month+"-"+t.day};
}
function motorwayDirection(ref,points,name=""){
  const first=points[0],last=points.at(-1),dy=last[0]-first[0],dx=last[1]-first[1];
  const route=(String(name).split("→").at(-1)||"").toLowerCase();
  if(ref==="A3")return /frankfurt|wiesbaden/.test(route)?"A3-frankfurt":
    /köln|koeln/.test(route)?"A3-koeln":dy>=0?"A3-koeln":"A3-frankfurt";
  if(ref==="A48")return /dernbach/.test(route)?"A48-dernbach":
    /koblenz/.test(route)?"A48-koblenz":dx>=0?"A48-dernbach":"A48-koblenz";
  if(ref==="A59"&&first[0]>51)return /düsseldorf|duesseldorf/.test(route)||!route&&dy>0?"extra-a59-duesseldorf":"extra-a59-leverkusen";
  if(ref==="A59")return /bonn/.test(route)&&!/köln|koeln|heumar/.test(route)?
    "extra-a59-bonn":dy>=0?"extra-a59-koeln":"extra-a59-bonn";
  if(ref==="A4")return /aachen/.test(route)?"extra-a4-aachen":
    /olpe/.test(route)?"extra-a4-olpe":dx>=0?"extra-a4-olpe":"extra-a4-aachen";
  if(ref==="A1")return /dortmund/.test(route)?"extra-a1-dortmund":/koblenz/.test(route)?"extra-a1-koblenz":dy>=0?"extra-a1-dortmund":"extra-a1-koblenz";
  if(ref==="A57")return /krefeld/.test(route)?"extra-a57-krefeld":/köln|koeln/.test(route)?"extra-a57-koeln":dy>=0?"extra-a57-krefeld":"extra-a57-koeln";
  if(ref==="A555")return dy>=0?"extra-a555-koeln":"extra-a555-bonn";
  if(ref==="A559")return /porz/.test(route)?"extra-a559-porz":
    /gremberg/.test(route)?"extra-a559-gremberg":dy>=0?"extra-a559-gremberg":"extra-a559-porz";
  if(ref==="A560")return /hennef/.test(route)?"extra-a560-hennef":
    /bonn/.test(route)?"extra-a560-bonn":dx>=0?"extra-a560-hennef":"extra-a560-bonn";
  if(ref==="A562")return dx>=0?"extra-a562-bonn-ost":"extra-a562-bonn";
  if(ref==="A61")return dy>=0?"extra-a61-nord":"extra-a61-sued";
  if(ref==="A565")return dy>=0?"extra-a565-nord":"extra-a565-sued";
  if(ref==="A571")return dy>=0?"extra-a571-nord":"extra-a571-sued";
  if(ref==="A573")return dy>=0?"extra-a573-nord":"extra-a573-sued";
  return ref+"-"+(Math.abs(dy)>=Math.abs(dx)?"lat":"lon")+(Math.abs(dy)>=Math.abs(dx)?Math.sign(dy):Math.sign(dx));
}
// Display destinations, deliberately independent of traffic-profile keys.
// Ordered motorway landmarks, not nearest-city distances or the compass
// bearing of individual OSM Ways. Each change applies to the interval AFTER
// its landmark in the axis order; reverse traffic has its own destination.
// The axis landmarks are the junction positions of the imported network;
// regional onward destinations are navigation labels, not claimed sign text.
const DESTINATION_AXES=[
  {ref:"A3",points:[[50.051,8.392],[50.146,8.326],[50.210,8.251],[50.298,8.237],[50.385,8.083],[50.402,8.064],[50.413,7.941],[50.446,7.828],[50.466,7.764],[50.535,7.597],[50.567,7.521],[50.604,7.430],[50.649,7.331],[50.690,7.271],[50.778,7.242],[50.821,7.208],[50.886,7.180],[50.920,7.074],[50.9462625,7.0392933],[50.984,7.016],[51.021,7.012],[51.038,7.009]],
    initial:["Limburg","Frankfurt"],changes:{4:["Limburg","Limburg"],5:["Köln","Limburg"],17:["Köln","Köln"],18:["Düsseldorf","Köln"]}},
  {ref:"A48",points:[[50.3556,7.4794],[50.3888,7.5403],[50.4139,7.5810],[50.4439,7.6646],[50.4556,7.7495]],
    initial:["Koblenz","Trier"],changes:{0:["Koblenz","Koblenz"],1:["Neuwied","Koblenz"],2:["Montabaur","Koblenz"]}},
  {ref:"A61",points:[[50.5896176,7.0395749],[50.5755,7.1130],[50.5263,7.1888],[50.4729,7.2277],[50.4102,7.2366],[50.3852,7.2742],[50.3917,7.3560],[50.3787,7.3875],[50.3552877,7.4895745],[50.35035,7.49628]],
    initial:["Koblenz","Köln"],changes:{0:["Koblenz","Bonn"],8:["Rheinböllen","Koblenz"]}},
  {ref:"A4",points:[[50.925833,6.845278],[50.8961,6.9144],[50.891,6.92655],[50.88552,6.9683],[50.902,6.996],[50.9176,7.0319],[50.9206,7.0498],[50.9462625,7.0392933]],
    initial:["Köln","Aachen"],changes:{0:["Köln","Köln"],6:["Olpe","Köln"]}},
  {ref:"A1",points:[[50.925833,6.845278],[50.9354,6.8493],[50.9804,6.8523],[50.9996,6.8976],[51.0280,6.9489],[51.0370,6.9654],[51.0393643,7.0005214]],
    initial:["Köln","Euskirchen"],changes:{0:["Köln","Köln"],3:["Leverkusen","Köln"],6:["Dortmund","Leverkusen"]}},
  {ref:"A59",points:[[50.7231,7.1568],[50.7476,7.1422],[50.7594,7.1386],[50.7894,7.1499],[50.8080,7.1342],[50.8168,7.1142],[50.8437,7.0966],[50.8818,7.0945],[50.9044,7.0725],[50.9285,7.0557]],
    initial:["Bonn","Königswinter"],changes:{0:["Bonn","Bonn"],2:["Köln","Bonn"]}},
  {ref:"A59",points:[[51.018,6.965],[51.03698,6.96540],[51.046,6.94745]],initial:["Düsseldorf","Leverkusen"],changes:{}},
  {ref:"A57",points:[[50.968,6.9186],[50.995,6.893],[51.0056,6.8801],[51.018,6.8621]],initial:["Neuss","Köln"],changes:{}},
  {ref:"A555",points:[[50.7492,7.0630],[50.7639,7.0314],[50.8111,6.9855],[50.8487,6.9678],[50.8855,6.9683]],initial:["Köln","Bonn"],changes:{}},
  {ref:"A559",points:[[50.9044,7.0725],[50.9072,7.0641],[50.9135,7.0312],[50.9196,7.0249]],initial:["Köln","Porz"],changes:{}},
  {ref:"A560",points:[[50.7935,7.1515],[50.7953,7.1753],[50.7886,7.1946],[50.7783,7.2227],[50.7764,7.2332],[50.7798,7.2656],[50.7764,7.2988],[50.7677,7.3113]],initial:["Hennef","Bonn"],changes:{}},
  {ref:"A562",points:[[50.7050,7.1313],[50.7083,7.1359],[50.7213,7.1468],[50.7231,7.1577]],initial:["Bonn-Beuel","Bonn-Bad Godesberg"],changes:{}},
  {ref:"A565",points:[[50.7648,7.1320],[50.7601,7.1085],[50.7516,7.0847],[50.7489,7.0785],[50.7318,7.0745],[50.7141,7.0642],[50.7092,7.0610],[50.6512,7.0461],[50.6360,7.0581],[50.59817,7.03496],[50.58450,7.02622]],
    initial:["Bonn","Bonn-Beuel"],changes:{6:["Meckenheim","Bonn"],9:["Gelsdorf","Bonn"]}},
  {ref:"A571",points:[[50.52974,7.18845],[50.53250,7.19286],[50.54560,7.19724]],initial:["Sinzig","Koblenz"],changes:{}},
  {ref:"A573",points:[[50.57321,7.11844],[50.55283,7.11946],[50.55016,7.12558]],initial:["Bad Neuenahr-Ahrweiler","Bonn"],changes:{}}
];
function navigationProject(axis,point){
  const lonScale=Math.cos(point[0]*Math.PI/180),p=axis.points;
  let best=null;
  for(let i=1;i<p.length;i++){
    const a=p[i-1],b=p[i],x=(b[1]-a[1])*lonScale,y=b[0]-a[0];
    const norm=x*x+y*y;
    if(norm<1e-12)continue;
    const qx=(point[1]-a[1])*lonScale,qy=point[0]-a[0];
    const raw=(x*qx+y*qy)/norm;
    // Permit the next/previous destination immediately beyond a cropped
    // map end instead of pinning the vehicle to the last landmark.
    const t=Math.max(i===1?-2:0,Math.min(i===p.length-1?3:1,raw));
    const error=Math.hypot(qx-t*x,qy-t*y);
    if(!best||error<best.error)best={station:i-1+t,error};
  }
  return best;
}
function navigationPosition(ref,point,travelPoints){
  if(!point||!travelPoints?.length||!travelPoints[0]||!travelPoints.at(-1))return undefined;
  let chosen=null;
  for(const axis of DESTINATION_AXES){
    if(axis.ref!==ref)continue;
    const at=navigationProject(axis,point);
    if(at&&(!chosen||at.error<chosen.at.error))chosen={axis,at};
  }
  // Do not reuse a Rheinland label on an unrelated extract of the same
  // numbered motorway hundreds of kilometres away.
  if(!chosen||chosen.at.error>.12)return undefined;
  const {axis,at}=chosen;
  const start=navigationProject(axis,travelPoints[0]),end=navigationProject(axis,travelPoints.at(-1));
  if(!start||!end||Math.abs(end.station-start.station)<1e-7)return undefined;
  return {axis,at,forward:end.station>start.station};
}
function navigationDestination(ref,point,travelPoints){
  const position=navigationPosition(ref,point,travelPoints);
  if(!position)return undefined;
  const {axis,at,forward}=position;
  let pair=axis.initial;
  for(const [station,change] of Object.entries(axis.changes))if(at.station>=Number(station))pair=change;
  return pair[forward?0:1];
}
// Traffic radio reports use the two major destinations bounding the
// motorway corridor, not whichever town happens to be nearest the queue.
// These corridor pairs follow exactly the same directed axis as the map.
function navigationRoute(ref,point,travelPoints){
  const position=navigationPosition(ref,point,travelPoints);
  if(!position)return undefined;
  const {axis,at,forward}=position,s=at.station;
  let pair;
  switch(ref){
    case "A3": pair=s>=18?["Köln","Oberhausen"]:["Frankfurt","Köln"];break;
    case "A61": pair=s>=8?["Koblenz","Rheinböllen"]:["Mönchengladbach","Koblenz"];break;
    case "A48": pair=s>=0?["Koblenz","Montabaur"]:["Trier","Koblenz"];break;
    case "A4": pair=s>=6?["Köln","Olpe"]:["Aachen","Köln"];break;
    case "A1": pair=s>=3?["Köln","Dortmund"]:["Euskirchen","Köln"];break;
    case "A59": pair=axis.points[0][0]>51?["Leverkusen","Düsseldorf"]:["Bonn","Köln"];break;
    case "A57": pair=["Köln","Krefeld"];break;
    case "A555": pair=["Bonn","Köln"];break;
    case "A559": pair=["Köln-Porz","Köln"];break;
    case "A560": pair=["Bonn","Hennef"];break;
    case "A562": pair=["Bonn-Bad Godesberg","Bonn-Beuel"];break;
    case "A565": pair=["Bonn","Meckenheim"];break;
    case "A571": pair=["Bad Neuenahr-Ahrweiler","Sinzig"];break;
    case "A573": pair=["Remagen","Bad Neuenahr-Ahrweiler"];break;
    default:return undefined;
  }
  return {origin:pair[forward?0:1],destination:pair[forward?1:0]};
}
// Sample the direction over real connected mainline Ways (including very
// short, curving OSM fragments), never cross to the opposite carriageway.
function navigationTravelPoints(edge,back,forward,geometry,length){
  function endpoint(neighbours,first){
    let current=edge,distance=length(edge);const seen=new Set([edge]);
    for(let i=0;i<150&&distance<3500;i++){
      const next=neighbours(current).filter(e=>!seen.has(e));
      if(next.length!==1)break;
      current=next[0];seen.add(current);distance+=length(current);
    }
    const points=geometry(current);
    return first?points[0]:points.at(-1);
  }
  return [endpoint(back,true),endpoint(forward,false)];
}
function regionFor(key,ref,points){
  if(ref==="A3"&&points?.some(p=>p[0]>50.84&&p[1]<7.17))return "ring";
  return familyByRef[ref]||"transit";
}
let profileMinute=NaN;const profileCache=new Map();
function profileFactor(key,ref,ms,points=[],kind="mainline"){
  const clock=localClock(ms),day=clock.day,hour=clock.hour;
  const family=regionFor(key,ref,points),base=weekday[family]||weekday.transit;
  const minute=Math.floor(ms/60000);
  if(minute!==profileMinute){profileMinute=minute;profileCache.clear();}
  const cacheKey=[key,ref,family,localState(ref,points),kind].join(":");
  if(profileCache.has(cacheKey))return profileCache.get(cacheKey);
  let raw,directionWeekend=1;
  if(day===0||day===6){
    const weekend=day===0?sunday:saturday;
    const curve=weekend.map(([h,v])=>[h,h===0||h===24?base[0][1]:v]);
    raw=smoothInterpolate(curve,hour);
    const s=Math.sin(Math.PI*hour/24)**2;
    if(family==="urban"||family==="siegtal")raw*=1-.18*s;
    if(family==="koblenz")raw*=1-.24*s;
    if(family==="airport")raw+=.08*s;
    // New peak calibration is for workday traffic. Preserve the independently
    // calibrated weekend loads instead of scaling those up indiscriminately.
    const weekendPeak={"A3-koeln":4200,"A3-frankfurt":4100,
      "A48-dernbach":2400,"A48-koblenz":1700}[key];
    if(weekendPeak)directionWeekend=weekendPeak/REFERENCE_PEAKS[key];
  }else{
    raw=smoothInterpolate(day===5?friday[family]:base,hour);
    const scale=day===2?.98:day===4?1.02:day===5?(family==="transit"?1.06:.94):1;
    raw*=1+(scale-1)*Math.sin(Math.PI*hour/24)**2;
  }
  let direction=directionWeekend;
  if(day!==0&&day!==6){
    const morning=Math.max(0,1-Math.abs(hour-(family==="transit"?7.75:7.4))/2.5);
    const evening=Math.max(0,1-Math.abs(hour-(day===5?14.5:16.75))/2.5);
    const morningKeys=new Set(["A3-frankfurt","A48-dernbach",
      "extra-a59-koeln","extra-a559-gremberg","extra-a560-bonn",
      "extra-a4-olpe","extra-a555-koeln","extra-a562-bonn","extra-a565-nord","extra-a571-nord","extra-a573-sued"]);
    const eveningKeys=new Set(["A3-koeln","A48-koblenz",
      "extra-a59-bonn","extra-a559-porz","extra-a560-hennef",
      "extra-a4-aachen","extra-a555-bonn","extra-a562-bonn-ost","extra-a565-sued","extra-a571-sued","extra-a573-nord"]);
    if(morningKeys.has(key))direction+=.09*morning;
    if(eveningKeys.has(key))direction+=.09*evening;
  }
  const exp=exponent[family]||1.3;
  const context=calendarStatus(ref,points,ms);
  const commuter=(raw<1?raw**exp:raw)*direction;
  const through=kind==="mainline"?throughTrafficFloor(ref,clock,context.holiday):0;
  const factor=Math.max(0,commuter,through)*context.factor;
  profileCache.set(cacheKey,factor);return factor;
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
  const site=junctionProfile(descriptor.ref,row[5]);
  const percentage=site?.entryPercent??legacyShares[descriptor.ref+":"+(match?.[1]||"")]??
    (descriptor.ref==="A59"||descriptor.ref==="A559"?9:6);
  return Math.max(0,descriptor.peakVph*percentage/100);
}
const api=Object.freeze({REFERENCE_PEAKS,LOCAL_JUNCTION_PROFILES,
  referenceForRoad,junctionEntryPeak,junctionProfile,junctionCapacityFactor,profileFactor,motorwayDirection,localClock,WIDE_CORRIDORS,
  calendarStatus,isPublicHoliday,schoolBreaks,navigationDestination,navigationRoute,navigationTravelPoints});
root.StauTrafficReference=api;
})(typeof window!=="undefined"?window:globalThis);
