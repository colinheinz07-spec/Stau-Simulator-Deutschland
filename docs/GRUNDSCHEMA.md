# Stausimulator Deutschland – verbindliches Grundschema (Version 1)

## Grundprinzip
Wir entwickeln ein deutschlandweit **erweiterbares** System. Nicht erst eine hübsche Karte zeichnen und danach Fahrwege erraten: **Original-OSM-Netz → gerichtete Fahrbeziehungen → Verkehrsnachfrage → physikalische Simulation → Kartendarstellung**. Ereignisse modifizieren die tatsächlich vorhandene Infrastruktur, Umleitungen verändern zulässige Routen im selben Netz.

Die sechs zentralen Hauptdateien liegen direkt in `src/`:
1. **01_Strassennetz.ts** – Hauptfahrbahnen, Fahrstreifen, Anschlussstellen, Rampen, gerichtete Knoten und OSM-Quellen.
2. **02_Verkehr.ts** – nach Region, Wochentag, Uhrzeit und Ziel differenzierte *Nachfrage*.
3. **03_Stauphysik.ts** – Fahrzeuge, Kapazitäten, Dichte, Geschwindigkeiten, Rückstau, Abfluss und Fahrzeugbilanz.
4. **04_Ereignisse.ts** – Unfälle, Pannen, Baustellen, Sperrungen, Zeitpläne und Fahrstreifenverfügbarkeit.
5. **05_Umleitungen.ts** – erlaubte Alternativwege mit realen Abbiegevorschriften und begrenzten Kapazitäten.
6. **06_Karte.ts** – Verkehrsfarben, Sperrmarkierung, Geometrie und Bedienoberfläche; berechnet keine Fahrzeuge.

`src/model.ts` stellt gemeinsame Typen bereit, `src/index.ts` exportiert nur die öffentliche Schnittstelle. **Nicht** sechs riesige Dateien schaffen: Wenn die Logik wächst, gehören kleine, fachlich abgegrenzte Unterdateien in die jeweilige Abteilung; die Hauptdateien bleiben verständliche Einstiegspunkte.

## Verbindliche Datenverträge
Jedes gerichtete **RoadEdge** hat eine stabile ID, Anfangs-/Endknoten, OSM-Quell-Way-IDs, komplette Koordinatenfolge, Fahrbahnart, Fahrstreifenzahl, Abschnittslänge, freie Geschwindigkeit und stündliche Kapazität je Spur. Gegenrichtungen sind **eigene** Fahrwege, keine automatisch umgedrehte Geometrie. Die **TurnMovement**-Tabelle enthält ausschließlich reale, explizit erlaubte Übergänge – gemeinsamer OSM-Knoten allein reicht nicht für eine Abbiegeerlaubnis. Quelle, Geometrie, Simulation und Kartendarstellung müssen über **dieselbe Edge-ID** verbunden sein.

**Strikte Trennung:** `motorway` = Hauptfahrbahn, `motorway_link` = Rampe/Überleitung. Landstraßen und Stadtstraßen sind öffentliche Straßen für reale mögliche Umleitungen, aber nicht automatisch grüne Autobahnsegmente. Rastplatz-/Parkplatzrampen sind keine normalen Anschlussstellen und bekommen keine künstliche AS-Nachfrage.

## Importablauf für neue Autobahnen
1. Festen OSM-Snapshot mit Datum, Quelle und Nutzungshinweis ablegen (nicht ungeprüft aus alter App kopieren).
2. Original-Knoten, Verkehrsrichtung, `oneway`, Access-Tags, Fahrstreifen, Rampen und geometrische Segmente prüfen.
3. Wege **an realen Knoten** aufteilen, jede Fahrtrichtung getrennt anlegen.
4. Ein- und Ausfahrtsbeziehungen explizit erzeugen, Abbiegeverbote beachten, bei unklarer Verbindung **nicht** raten.
5. Mit Validierung sicherstellen, dass *jedes zugelassene* `motorway`- und `motorway_link`-OSM-Stück im unterstützten Gebiet entweder als Fahrweg vorhanden oder **begründet ausgeschlossen** ist; auch kleine Geometrie-Lücken melden.
6. Bei Konflikten Import stoppen und Fundstelle melden, niemals eine Landstraße als grüne Brücke färben.
7. Erst nach erfolgreicher topologischer Prüfung Verkehr und Ereignisse aktivieren.
8. Karte zeichnet exakt die vollständigen akzeptierten Netzabschnitte. Ein sichtbares Teilstück ohne berechenbare Fahrbeziehung muss als **nicht verbunden** ausgewiesen werden, bis es geprüft ist.

## Betriebsregeln
- **Fahrzeugerhaltung:** vorhandener Bestand + Einfahrten = abfließende Fahrzeuge + verbleibender Bestand. Keine Phantomfahrzeuge, auch nicht beim Löschen/Beenden eines Ereignisses.
- **Kapazität:** Ausgangsannahme Hauptfahrbahn 2.100 Fzg/h/Fahrstreifen (frühere +100), Rampe initial 1.500 Fzg/h/Fahrstreifen. Diese Werte sind *kalibrierbare Szenarioparameter*, keine universellen Realmessungen. Keine zusätzliche Spur an normalen Beschleunigungsstreifen erfinden.
- **Nachfrage ≠ Kapazität:** ein Anschluss kann theoretisch mehr Ausfahrtswunsch als Rampenleistung haben; der Rest **wartet im Netz**, statt aus der Simulation zu verschwinden. Austritte werden durch tatsächlich verfügbare Fahrzeuge und Kapazität begrenzt, nicht durch pauschale Obergrenzen des Wunsches.
- **Verkehrszeiten:** werktags erste Belastung ab etwa 05–06 Uhr, regional und richtungsabhängig; Freitag Nachmittagsspitze früher (ungefähr 13–15 Uhr). Wochenende und Ferien später getrennt kalibrieren. Ursprungs-/Ziel-Nachfrage nicht mit der Fahrzeuganzahl auf einem einzelnen Abschnitt verwechseln.
- **Stau/Rückstau:** zuerst Engpass und belegte Zellen, Rückstau entgegen Fahrtrichtung, Überlast an AS, Auf-/Abfahrt, Kreuz und Dreieck kann sich physikalisch bis zu anderer Autobahn fortpflanzen. Keine willkürliche Rückstaulängen-Begrenzung an einer Rampe.
- **Farben ausschließlich nach Geschwindigkeit:** >65 km/h grün; >30–65 km/h orange; >10–30 km/h rot; 0–10 km/h dunkelrot. Keine Verzögerungs-Farbgebung auf Rampen. Kein dekorativer roter Strich in tatsächlich freiem Grün; keine grünen Lücken in belegten Stauräumen.
- **Vollsperrung:** genau gerichteten gesperrten Abschnitt und *nur zwingend betroffene* Rampenzweige rot-weiß markieren. Vor einer Verzweigung offen lassen, wenn eine legale offene Fahrbeziehung besteht. Neue Fahrzeuge dürfen nicht in gesperrten Teil einfahren; vorhandene Fahrzeuge behalten ihre Bilanz, eventuell mit begrenzter Restabfahrt. Gesperrte Abschnitte sind nicht automatisch vollständig mit stehenden Fahrzeugen belegt.
- **Umleitungen:** Nur verifizierte gerichtete Wege; alternative Autobahnen, Rampen und örtliche Straßen einbeziehen, Kapazitätslimits auch an Ampeln/Knoten. Routenwechsel nur an noch erreichbaren Entscheidungspunkten, nicht durch Teleportieren oder Zurückversetzen. Nicht alle Fahrer weichen aus; Entscheidung kann von Reisezeit, Bekanntheit und Verkehr abhängen.
- **Kartenbedienung:** Übersicht zeigt Autobahnnetz/Staus/Ereignisse ohne überfüllende AS-Nummern; Detailzoom blendet Namen ein. Jede relevante Autobahnrampe wird vollständig überzeichnet – nicht durch willkürliche dicke Linien über Straßen anderer Klassen.

## Aktueller Implementierungsumfang
**Phase 1 ist ein geprüftes Daten- und Regelgerüst, keine fertige Simulations-App.** Der Verkehrsteil bietet Szenario-Tagesfaktoren; die Stauphysik enthält zunächst einen konservativen *einzelnen* Engpassspeicher; die Umleitungssuche kann gerichtete explizite Wege routen; Ereignisse verändern Abschnittskapazität; die Karte erzeugt vollständige Darstellungsdatensätze. **Noch nicht umgesetzt** sind flächige Cell-Transmission-Simulation, Netzwerk-Rückstau, Verkehrsverteilung an Kreuzungen, reale Bundesnetz-Geodaten und die interaktive Benutzeroberfläche.

## Reihenfolge nach diesem Grundgerüst
1. Reproduzierbarer, lizenzkonformer OSM-Import + Audit aller Rampen und Fahrbeziehungen.
2. Kleines echtes Testnetz A3/A48 Dernbach–Montabaur–Limburg statt sofort aller Autobahnen.
3. Gemeinsames konservatives Zellmodell für Hauptfahrbahnen und Rampen mit Knoten-Receiving und Rückstau.
4. Ereignisse, echte Umleitungsentscheidungen, Ausfahrtsnachfrage und Sperrpfade.
5. Von denselben Segment-IDs gespeiste Karte, Zoom- und Stauanzeige.
6. Regionale Ausweitung bis deutschlandweit; danach Performance-/Lasttests und Play-Store-Reife.

## Phase 2 – bundesweit gleicher OSM-Netzimport (bereits im Repository)

**Wichtig:** Der Importer ist *generisch*, das Bundesnetz ist noch nicht geladen. Er verarbeitet jeden passenden **vollständigen OSM-Snapshot**, nicht nur A3/A48. Originalknoten-/Way-IDs und die Weg-Geometrie sind die einzige Grundlage. Unter `src/01_Strassennetz/osm-import.ts` werden:

- alle enthaltenen zulässigen `motorway` und `motorway_link` automatisch gelesen, unabhängig vom Namen der Autobahn oder Anschlussstelle;
- Fahrwege an wirklich gemeinsamen OSM-Knoten geteilt (einschließlich kurzer Auffahrts-/Abfahrtssegmente);
- `oneway`, `oneway=-1`, ausdrücklich zweirichtungsfähige Wege und die Fahrstreifenzahl ausgewertet;
- motorcar-Abbiegebeschränkungen vom OSM-Typ `from-way → via-node → to-way` angewendet;
- gemeinsame Autobahnfahrbahnen mit mehreren Nummern (z. B. A3/A4) **einmal physisch** gespeichert, aber jeder zugehörigen Autobahnnummer zugeordnet;
- echte Nicht-Autobahn-Straßen auf Wunsch als separate `public`-Fahrwege für Umleitungsnetze importiert, nicht als grüne Autobahn;
- jedes erwartete originale OSM-Teilsegment mit den tatsächlich erzeugten gerichteten Segmenten verglichen;
- ungeklärte Rampenenden als Fehler gemeldet, nicht mit geraden Verbindungsstücken überschrieben.

**Fehler müssen sichtbar sein:** Fehlende Knoten, widersprüchliche Geometrie, unverbundene Rampen, fehlende eindeutige Hauptfahrbahnreferenzen und derzeit nicht implementierte komplizierte Abbiegerelationen (*via-way, conditional*) stoppen bei `strict=true` den Import. Diese Einschränkung ist absichtlich: Der neue Simulator darf seine Netzqualität nicht vortäuschen.

Der Import läuft offline mit Node.js 22+ nach `npm install` und `npm run build`:

```bash
node scripts/import-osm.mjs data/mein-osm-snapshot.json --include-public --output=data/generated-network.json
```

Der Quellsnapshot muss alle benötigten Nodes, Ways und Restrictions des gewünschten Gebiets enthalten. Output sind `generated-network.json` und `generated-network.json.audit.json`. Ein neuer Autobahnabschnitt wird so über **Daten**, nicht über neue Regeln importiert. Ohne `--include-public` wird nur die Autobahn samt Rampen importiert; Anschlussstellen können trotzdem nachweislich an unmodellierte öffentliche OSM-Straßen enden. Für reale Umleitungen muss der separate öffentliche Straßengraph tatsächlich vorhanden sein.

## Phase 2 – bundesweit einheitliche Sperrung A→B (bereits implementierter Topologiekern)

Unter `src/04_Ereignisse/netzsperrungen.ts` gibt es eine **CorridorClosure** mit `motorwayRef`, `fromNodeId`, `toNodeId` und Zeitplan. Die Knoten müssen im gerichteten Netz vorhanden sein; bei Positionsklicks zwischen Knoten muss der Importer später die betroffene Fahrbahn passend aufteilen.

1. Alle gerichteten Hauptfahrbahnsegmente auf legal erreichbaren Wegen zwischen A und B werden gesperrt, auch parallele Fahrbahnzweige. Die Gegenrichtung bleibt offen.
2. Das System läuft rückwärts über die **tatsächlich erlaubten** Rampen-/Autobahn-Beziehungen: Zufahrtsketten, die nur in den gesperrten Bereich führen, werden vollständig geschlossen.
3. Eine gemeinsame vorgelagerte Zufahrt bleibt **nur dann** offen, wenn eine weiterführende, legale Route zu einem echten offenen Ausweg besteht. Ein offener Autobahnabschnitt, der ausschließlich am Sperrgatter endet, gilt nicht als Ausweichroute.
4. Eine offene Ausfahrt vor A oder ein offener Flucht-/Evakuierungsast wird nicht blind mitgesperrt. Hauptfahrbahnen vor A werden nicht unnötig rot-weiß eingefärbt; deren Fahrzeuge können sich trotzdem bis zum Sperrpunkt stauen.
5. Die Markierung für eine administrative Sperrung ist **rot-weiß**. Die tatsächliche Staufarbe ist getrennt und folgt ausschließlich der berechneten Geschwindigkeit.
6. `src/05_Umleitungen.ts` darf keine Fahrwege/Moves in gesperrte Kanten benutzen. `src/04_Ereignisse.ts` berechnet dort Nullkapazität. `src/06_Karte.ts` erhält **dieselben Edge-IDs** für die Sperrmarkierung.

Das Verhalten hängt nie von Sonderfällen wie „Montabaur“ oder „Heumar“ ab. Die neutralen Tests prüfen A1, A3, A7, A61 und A100 mit denselben Regeln einschließlich paralleler Fahrbahnen, Ketten von Zufahrtsrampen, offenen Abzweigen und Sperrzeitraum.

**Grenze der bisherigen Implementierung:** Die Graph- und Ereignis-Topologie ist vorbereitet. Vollständig dynamischer Durchgangsverkehr, bereits im gesperrten Abschnitt befindliche Fahrzeuge, Kapazitätsabhängigkeit von Kreuzungen, realistische Reisezeitumverteilung und das räumliche Zellmodell sind weiterhin eigene Ausbauschritte. Das Importskript lädt noch keinen kompletten Deutschland-OSM-Snapshot herunter und es gibt derzeit keine spielbare Deutschlandkarte.
