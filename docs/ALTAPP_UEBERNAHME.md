# Weiterverwendung der alten Traffic-Sinulator-App

Quelle: https://github.com/colinheinz07-spec/Traffic-Sinulator

Die alte App wird **nicht verworfen**. Statt unkontrolliert alle Dateien zu kopieren,
übernehmen wir geprüfte Bestandteile mit eindeutiger Zuständigkeit in die sechs Fachmodule.

| Neuer Fachbereich | Vorhandene Quelle im Altprojekt | Übernahmestand |
| --- | --- | --- |
| 01 Straßennetz | `geodata.js`, `network-extensions.js`, `01_Strassennetz/osm-zusatzrampen.js`, `osm-rampenluecken.js` | **Für SPCK-Kartenansicht übernommen:** 986 Hauptfahrbahngeometrien, 943 Rampengeometrien, 73 Anschlusspunkt-Labels; noch nicht als neue gerichtete Simulationskanten validiert |
| 02 Verkehr | `02_Verkehr/regional-traffic.js`, `calendar-traffic.js`, `traffic.js` | Auswerten/Überführen steht aus – regionale Tages- und Freitagsspitzen beibehalten |
| 03 Stauphysik | `03_Stauphysik/traffic-cells.js`, `spatial.js`, `network-receiving.js` | **Erste konservative Zellflusssimulation im SPCK-Prototyp umgesetzt**: `web/offline-traffic.js`, angelehnt an `src/03_Stauphysik/netzfluss.ts`; detaillierte alte Nachfrage, Routen und gemeinsame Einfädelkapazitäten bleiben als separate Migration offen |
| 04 Ereignisse | `04_Ereignisse/closure-network.js`, `recurring-events.js` | Auswerten/Überführen steht aus – Sperrung nur betroffener Fahrbeziehungen |
| 05 Umleitungen | `05_Umleitungen/auto-diversions.js`, `routed-traffic.js` | Auswerten/Überführen steht aus – Netzgraph und erlaubte Umleitungen nutzen |
| 06 Karte | `06_Karte/map-gestures.js`, `map-geometry.js`, `06_Karte.js` | **Canvas-Ansatz wiederverwendet:** `web/legacy-canvas.js`, mit Fingerbedienung und gebündelter Zeichnung |

## Technische Abgrenzung

- `web/legacy-geometry.js` ist ein lokaler **OSM-Geometrieschnappschuss** aus dem Altbestand, keine neue Simulation und keine Live-Quelle. Original-OSM-Mitwirkende/ODbL sind zu nennen.
- `web/legacy-canvas.js` zeigt die Schnappschussgeometrien **und** farbcodierte Modellgeschwindigkeiten aus `web/offline-traffic.js`. Eine fehlende Netzdatei oder eine fehlende Online-Verbindung darf die Straßendarstellung nicht mehr leer machen.
- Der vollständige kompilierte Build mit `web/app.js` und `dist/` behält die neue gerichtete Netzsimulation. Eine Übernahme alter Verhaltensregeln erfolgt nur nach Vergleich und Tests.
- Jede neue Region wird datengetrieben importiert; keine ausschließlich für A3/A48 programmierte Sonderlogik.
- Die lokalen 943 Rampen dürfen **nicht als 943 geprüfte, fehlerfreie Rampenverbindungen** ausgegeben werden. Die alten bekannten Lücken und fraglichen Verbindungen bleiben Audit-Aufgaben.

## Prüfungen

`tests/spck-canvas.test.mjs` prüft, dass die lokale Karte tatsächlich Geometrien zeichnet, ohne Leaflet, Overpass oder andere Datenabrufe.
`tests/map-web.test.mjs` sichert die Reihenfolge der lokalen Skripte und den Zugang zum vollständigen Build.

## Erste lokale Simulation (Prototyp 0.3)

- Start/Pause und Verkehrsbelastung 0–200 % funktionieren in SPCK ohne Build. Ein realer Sekundentakt simuliert 60 Sekunden Modellzeit (12 Schritte à 5 Sekunden).
- Die importierten OSM-Hauptfahrbahn- und Rampengeometrien werden zu gerichteten Zellen mit begrenztem Speicher, Kapazität je Fahrstreifen und stromaufwärts wanderndem Rückstau.
- Verbindungen zwischen OSM-Segmenten erfordern **exakt identische Endknoten-Koordinaten**. Es wird keine benachbarte Straße als neue Rampe zusammengeschweißt.
- Fahrzeuge entstehen nur an ausgewählten äußeren Quellkanten; Abfluss nur an gerichteten Netzenden; alle Bestände und Warteschlangen werden bilanziert.
- Unfall, Baustelle und Vollsperrung reduzieren die Kapazität des angeklickten Segments. Die rot-weiße Sperrung wird getrennt von Geschwindigkeitsfarben gezeichnet.
- Rastplatzrampen mit **ausdrücklicher Rast-/Servicebezeichnung** werden aus der lokalen Karte und Simulation ausgeschlossen. Die vollständige OSM-Importpipeline hat zusätzlich eine topologische Service-only-Regel; die alten Schnappschussdaten ohne Service-Tags reichen für ein restloses Aussortieren nicht aus.
- **Einschränkung:** Das alte OSM-Schnappschussnetz hat ungeprüfte Lücken und einzelne nicht eindeutig verbundenen Knoten. Das Szenario hat vereinfachte äußere Zuflüsse, noch keine aus der alten App portierten Anschlussstellen-Zu-/Abfahrtsprofile, kein realistisches OD-Routing und keine dynamisch belasteten Umleitungsstrecken. Kein Live-Verkehr, keine deutschlandweite vollständige Simulation.

Tests: `tests/offline-traffic.test.mjs` (Massenerhaltung, Rückstau, Ereignisse, Null-Nachfrage, Servicefilter) und `tests/spck-canvas.test.mjs` (mobiler Kartenstart und laufende Simulation).
