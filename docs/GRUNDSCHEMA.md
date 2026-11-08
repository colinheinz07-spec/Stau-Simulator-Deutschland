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
