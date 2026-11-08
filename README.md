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

Die echten Deutschland-Rohdaten sind mehrere GB groß und **nicht in GitHub gespeichert**. Der vollständige Import muss auf einem ausreichend leistungsfähigen Rechner/Build-Server laufen; die bisherigen CI-Tests nutzen kleine OSM-Testdaten. Die mobile Oberfläche und der bundesweite Echtbetrieb sind noch nicht fertig.

## Entwicklungsstand
Das Projekt befindet sich in **Phase 1: Kernarchitektur und prüfbare Basismodule**. Es enthält aktuell **noch keine fertige interaktive Karte und kein deutschlandweites Straßennetz**. Tests nutzen absichtlich ein als *synthetisch* gekennzeichnetes kleines Prüfnetz. Eine echte Verkehrs-Engine mit Fahrzeugbewegung über alle Knoten folgt erst nach dem OSM-Netzimport.

## Lokal testen (Node.js 22+)
```bash
npm install
npm run check
```
Die Prüfkette baut zunächst TypeScript, führt Modelltests aus und prüft die Fahrbeziehungen.

*OSM-Daten werden künftig unter Einhaltung der ODbL und geeigneter Quellenhinweise eingebunden.*
