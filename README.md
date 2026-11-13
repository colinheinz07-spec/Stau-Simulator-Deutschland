# 🚗 Stau-Simulator Deutschland

**Neuaufbau (nicht Kopie des alten Traffic-Sinulator-Codes)** – saubere, nachvollziehbare Basis für eine zukünftige deutschlandweite Autobahn-Verkehrssimulation.

## Sechs Hauptbereiche

| Datei | Aufgabe |
| --- | --- |
| [01_Strassennetz.ts](src/01_Strassennetz.ts) | 🛣️ gerichtete OSM-Autobahnen, Rampen, Fahrstreifen und überprüfte Fahrbeziehungen |
| [02_Verkehr.ts](src/02_Verkehr.ts) | 🚘 Nachfrage nach Region, Wochentag und Uhrzeit; Freitag gesondert |
| [03_Stauphysik.ts](src/03_Stauphysik.ts) | 📈 physikalische Kapazitäten und Fahrzeugerhaltung |
| [04_Ereignisse.ts](src/04_Ereignisse.ts) | 🚧 Unfall, Baustelle, Panne, Vollsperrung |
| [05_Umleitungen.ts](src/05_Umleitungen.ts) | ↪️ Routing über echte, explizit erlaubte Wege |
| [06_Karte.ts](src/06_Karte.ts) | 🗺️ Kartenmerkmale, Staufarben, Sperr-Overlay |

Alle Bereiche verwenden dieselben Datenverträge in [src/model.ts](src/model.ts).

Der [ausführliche Verkehrsmodell-Audit vom 13.11.2026](docs/VERKEHRSMODELL_AUDIT_2026-11-13.md) hält die überprüften Fehlerursachen, die übernommenen Stauphysik-Prinzipien aus dem alten Projekt, die Regressionstests und die weiterhin offenen Kalibrierungsaufgaben fest.
Der vollständige **[Architektur-, Regel- und Ausbauplan](docs/GRUNDSCHEMA.md)** erklärt, was wir aus der bisherigen App übernehmen und was bewusst neu entwickelt wird.

## Qualitätsregeln

- **Keine erfundenen Verbindungen:** Rampen und Überleitungen nur mit realer OSM-Geometrie und explizit zulässiger Richtung.
- **Keine verdeckten Lücken:** das importierte `motorway`/`motorway_link`-Netz muss für jedes Gebiet vollständig auditiert werden.
- **Keine Phantomfahrzeuge:** Zufluss, Abfluss und Bestand müssen bei jedem Schritt bilanziert werden.
- **Keine pauschale Sperrung eines ganzen Autobahnkreuzes** wegen eines gesperrten Astes.
- **Eine Datenquelle für Karte und Simulation:** identische Segment-IDs.
- **Jede Erweiterung wird automatisch getestet.**

## Deutschlandweite Erweiterungen und gerichtete Vollsperrungen

Der allgemeine [OSM-Importer](src/01_Strassennetz/osm-import.ts) übernimmt alle enthaltenen Autobahn-/Rampen-Ways mit Originalknoten, Fahrtrichtung und Abbiegerestriktionen. [scripts/import-osm.mjs](scripts/import-osm.mjs) führt den Import mit strengem Lücken-/Rampen-Audit aus. **A3/A48 sind keine hart codierte Grundlage.**

Die [bundesweite A→B-Sperrlogik](src/04_Ereignisse/netzsperrungen.ts) sperrt die vollständigen gerichteten Hauptfahrbahnzweige und automatisch alle Rampenketten, die ausschließlich hineinführen. Zufahrten mit echten freien Alternativen und offene Ausfahrten bleiben offen. Routing, Kapazität und rot-weiße Karte verwenden denselben Sperrplan.

Dokumentiert und mit neutralen Netztests abgedeckt im [vollständigen Grundschema](docs/GRUNDSCHEMA.md). Ein tatsächliches komplettes OSM-Bundesnetz und die dynamische Fahrzeugausbreitung sind noch nicht importiert beziehungsweise umgesetzt.

## Deutschlandweite OSM-Datenpipeline

**Neu:** [Deutschland-Importanleitung](docs/OSM_DEUTSCHLAND_IMPORT.md) mit einem reproduzierbaren Ablauf für original Geofabrik-`germany-latest.osm.pbf`:

- `scripts/build-germany-network.sh`: Netzaufbau aus dem deutschlandweiten PBF, keine A3/A48-Sonderfalllisten;
- `scripts/osm-xml-to-json.py`: speicherschonende Umwandlung mit Original-OSM-Knoten und Abbiegerelationen;
- `scripts/import-osm.mjs`: ursprüngliche Ways zu gerichteten Autobahnen und Rampen, automatisches Lücken-Audit; bei Fehlern bleibt ein `.failed-audit.json` zurück;
- `scripts/shard-network.mjs`: Karte in kleinere räumliche `.json.gz`-Kacheln aufteilen;
- `src/06_Karte/network-tiles.ts`: Kartenkacheln anhand stabiler IDs zusammenführen, echte Cross-Tile-Fahrbeziehungen erhalten, Duplikate verhindern.

**Echter OSM-Praxistest erfolgreich:** Ein Geofabrik-Bremen-Extrakt wurde mit der zugehörigen `.poly`-Gebietsgrenze verarbeitet: **415 Hauptfahrbahn-Ways, 411 Rampen-Ways, 850 gerichtete Fahrwege, 864 Fahrbeziehungen und null ungeklärte Rampenenden**. Die 13 service-only-Zugänge wurden ausgeschlossen und vier echte Kartenausschnitt-Grenzen separat protokolliert. [GitHub Actions: Real-OSM-Erfolg](https://github.com/colinheinz07-spec/Stau-Simulator-Deutschland/actions/runs/42531933452).

Die echten Deutschland-Rohdaten sind mehrere GB groß und **nicht in GitHub gespeichert**. Der vollständige Import muss auf einem ausreichend leistungsfähigen Rechner/Build-Server laufen; die Standard-CI nutzt kleine OSM-Testdaten, zusätzlich ist ein echter regionaler PBF-Test eingerichtet. Die mobile Oberfläche und der bundesweite Echtbetrieb sind noch nicht fertig.

## Aktuelle Kartenansichten (SPCK / vollständiger Build)
- **SPCK direkt aus `web/index.html`:** lokale touchfähige Canvas-Karte. Dafür sind die **1.929 OSM-Geometrien, darunter 943 Rampen**, aus der alten [Traffic-Sinulator-App](https://github.com/colinheinz07-spec/Traffic-Sinulator) im Repository unter `web/legacy-geometry.js` übernommen. Der Original-Ansatz aus dem alten Canvas-Kartenmodul lebt in `web/legacy-canvas.js` weiter. Die Karte funktioniert auch ohne Overpass und ohne Leaflet-Bibliothek; OSM-Kacheln sind ein optionaler Hintergrund. Tippen, Verschieben, Zoomen und Fahrstreifeninformationen funktionieren. **Seit Prototyp 0.3 enthält SPCK auch ein laufendes, fahrzeugbilanziertes Zellflussmodell** (`web/offline-traffic.js`) mit Start/Pause, Lastregler, Unfällen, Baustellen und Sperrungen. In Prototyp 0.7 werden die exakten gemeinsamen OSM-Innenknoten für Ein- und Ausfädelungen berücksichtigt. Von den 1.929 lokalen Fahrwegen werden derzeit **1.219 über 18 nachvollziehbare Rand- und AS-Quellen** erreicht; 710 bleiben grau, weil die Teilnetze nicht ausreichend belegt sind. Das ist absichtlich weniger als die frühere scheinbar große Abdeckung (1.676 über 188 zu großzügige Quellen): keine zusätzlichen Fahrzeuge an Rampenfragmenten oder künstlichen Kartenenden. Die örtliche Nachfrage ist ein Szenario, keine gemessene Zielmatrix.
- **Vollständiger GitHub-Workflow-Build:** Bei erfolgreichem OSM-Import enthält er kompiliertes `dist/` und importierte `data/tiles/`-Dateien. Hier arbeitet die experimentelle Fahrzeug-Engine mit frisch importierten gerichteten A3/A48-OSM-Strecken. Wenn externe OSM-Rohdaten nicht heruntergeladen werden können oder das Netzaudit scheitert, wird stattdessen ein **ausdrücklich gekennzeichneter lokaler Canvas-Fallback** veröffentlicht – keine irreführende vollständige OSM-Karte. Auch der Vollimport ist noch nicht deutschlandweit fertig.
- **Nicht verwechseln:** Die lokale Legacy-Karte zeigt zusätzlich Autobahnen aus dem Altprojekt; das ist noch kein vollständig validiertes bundesweites Simulationsnetz. Rampenlücken aus der alten App können weiterhin bestehen und werden nicht automatisch als behoben ausgegeben.

## Ereignisse konfigurieren (SPCK 0.7)

In `web/index.html` auf einen OSM-Fahrweg tippen und **Baustelle, Unfall, Panne oder Vollsperrung** wählen. Im Ereigniseditor werden nicht sofort pauschal Spuren gesperrt: Es lassen sich die tatsächlichen Fahrstreifen (F1 rechts bis Fn links), Geschwindigkeit, Länge und Standstreifenstatus auswählen. Ein bestätigter Standstreifen kann als zusätzliche Fahrspur freigegeben werden; bei ausdrücklich als `shoulder=no` markierten OSM-Segmenten ist dies untersagt. Die 29 verfügbaren Schulter-OSM-Tags der alten A3/A48-Geometrie wurden übernommen; sonst ist die Verfügbarkeit unbekannt und muss bewusst für den gesamten betroffenen Abschnitt bestätigt werden.

Zeitplanung: **sofort/dauerhaft**, **einmalig von–bis**, **wöchentlich wiederholt an frei ausgewählten Wochentagen**. Die Wiederholung folgt Europe/Berlin auch über Mitternacht und bei Zeitumstellung. Der Modellstart ist separat einstellbar. Ereignisse werden lokal im Browser gespeichert, können bearbeitet und entfernt werden. Pannen/Unfälle sind auf maximal 200 m begrenzt; Baustellen auf 20 km, Vollsperrungen auf 100 km. Bei unklaren Netzübergängen wird eine verkürzte tatsächliche Wirkung angezeigt. Mehrphasige Bauabläufe aus der alten App, automatische AS-Verkehrsführung und vollständige Umleitungen sind **noch nicht** übernommen.

Kapazitäten und geschätzte Geschwindigkeiten reagieren auf die tatsächlich aktiven, von/bis-limitierten Fahrstreifen-Regeln. Sperren werden nur über die betroffenen Teilstücke rot-weiß markiert. Der lokale Prototyp verwendet weiterhin ein vereinfachtes Zellmodell; es ersetzt noch keine nach Zielen geroutete, flächendeckende Straßenverkehrssimulation.

## Stand 0.7: Verkehr, Wochenende, Vollsperrung

- **Hauptfahrbahn: 2.200 Kfz/h je Fahrstreifen** als bestätigte Szenariokapazität; einspurige Rampen separat mit 1.500 Kfz/h. Ereignisse senken die nutzbare Kapazität über gesperrte Spuren, kein automatisches Rot wegen niedriger Geschwindigkeitsbegrenzungen.
- **Alte Verkehrswerte wiederverwendet:** gerichtete Referenzspitzen A3 Köln 4.200, A3 Frankfurt 4.100, A48 Dernbach 2.400, A48 Koblenz 1.700 Kfz/h, NRW-Referenzen im `web/traffic-reference.js`. Weitere A3-/A48-/NRW-Korridorwerte bleiben ungeprüfte Modellannahmen und werden nicht blind als lokaler Rampenzufluss eingespeist.
- **Tagesgang:** die ursprünglichen Wochentags-, Freitags-, Samstags- und Sonntagskurven samt Fahrtrichtung werden angewendet; Ferien 2026/27 für Rheinland-Pfalz/NRW/Hessen (KMK) und bewegliche gesetzliche Feiertage werden im Szenario berücksichtigt. Ferien/Feiertags-Verkehrsfaktoren sind noch unkalibriert.
- **Vollsperrung:** exklusiv in die Sperrung führende Rampenketten sind ebenfalls für neue Einfahrten gesperrt und rot-weiß markiert; offene Ausfahrten bleiben offen. Fahrzeuge, die sich bereits innerhalb der Sperrung befinden, dürfen weiter abfließen. Im lokalen Editor wird eine Länge bis zur nächsten bekannten Anschlussstelle vorgeschlagen, soweit die OSM-Fahrbeziehung eindeutig ist.
- **Stauanzeigen:** zusammenhängende Hauptfahrbahnen werden auch über gewöhnliche Abfahrten hinweg zu einem Stau zusammengeführt; maximal vier große Kartenhinweise statt vieler überlagerter Textboxen.

**Grenze:** Noch keine durchgehende dynamische Quell-Ziel-Umleitung über die gesamte Deutschlandkarte und kein Vollständigkeitsnachweis aller 1.929 Legacy-Geometrien. Fehlende Teilnetzverbindungen werden nicht mit erfundenen Pkw aufgefüllt.

## Entwicklungsstand
Das Projekt befindet sich in der Aufbau- und Testphase. Die lokale SPCK-Karte ist jetzt ohne separates Build sichtbar. Die vollständige Stauphysik, Rampen-, Sperr- und Umleitungslogik befindet sich in den sechs Fachmodulen und wird weiter validiert. Deutschlandweite OSM-Daten sind noch nicht vollständig importiert.

## Lokal testen (Node.js 22+)
```bash
npm install
npm run check
```
Die Prüfkette baut zunächst TypeScript, führt Modelltests aus und prüft die Fahrbeziehungen.

*OSM-Daten werden künftig unter Einhaltung der ODbL und geeigneter Quellenhinweise eingebunden.*
