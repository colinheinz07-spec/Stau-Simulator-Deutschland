# Weiterverwendung der alten Traffic-Sinulator-App

Quelle: https://github.com/colinheinz07-spec/Traffic-Sinulator

Die alte App wird **nicht verworfen**. Statt unkontrolliert alle Dateien zu kopieren,
übernehmen wir geprüfte Bestandteile mit eindeutiger Zuständigkeit in die sechs Fachmodule.

| Neuer Fachbereich | Vorhandene Quelle im Altprojekt | Übernahmestand |
| --- | --- | --- |
| 01 Straßennetz | `geodata.js`, `network-extensions.js`, `01_Strassennetz/osm-zusatzrampen.js`, `osm-rampenluecken.js` | **Für SPCK-Kartenansicht übernommen:** 986 Hauptfahrbahngeometrien, 943 Rampengeometrien, 73 Anschlusspunkt-Labels; noch nicht als neue gerichtete Simulationskanten validiert |
| 02 Verkehr | `02_Verkehr/regional-traffic.js`, `calendar-traffic.js`, `traffic.js` | Auswerten/Überführen steht aus – regionale Tages- und Freitagsspitzen beibehalten |
| 03 Stauphysik | `03_Stauphysik/traffic-cells.js`, `spatial.js`, `network-receiving.js` | Auswerten/Überführen steht aus – Fahrzeugbilanz, echte Rampenrückstaus und gemeinsame Kapazitäten sind Pflicht |
| 04 Ereignisse | `04_Ereignisse/closure-network.js`, `recurring-events.js` | Auswerten/Überführen steht aus – Sperrung nur betroffener Fahrbeziehungen |
| 05 Umleitungen | `05_Umleitungen/auto-diversions.js`, `routed-traffic.js` | Auswerten/Überführen steht aus – Netzgraph und erlaubte Umleitungen nutzen |
| 06 Karte | `06_Karte/map-gestures.js`, `map-geometry.js`, `06_Karte.js` | **Canvas-Ansatz wiederverwendet:** `web/legacy-canvas.js`, mit Fingerbedienung und gebündelter Zeichnung |

## Technische Abgrenzung

- `web/legacy-geometry.js` ist ein lokaler **OSM-Geometrieschnappschuss** aus dem Altbestand, keine neue Simulation und keine Live-Quelle. Original-OSM-Mitwirkende/ODbL sind zu nennen.
- `web/legacy-canvas.js` zeigt die Schnappschussgeometrien. Eine fehlende Netzdatei oder eine fehlende Online-Verbindung darf die Straßendarstellung nicht mehr leer machen.
- Der vollständige kompilierte Build mit `web/app.js` und `dist/` behält die neue gerichtete Netzsimulation. Eine Übernahme alter Verhaltensregeln erfolgt nur nach Vergleich und Tests.
- Jede neue Region wird datengetrieben importiert; keine ausschließlich für A3/A48 programmierte Sonderlogik.
- Die lokalen 943 Rampen dürfen **nicht als 943 geprüfte, fehlerfreie Rampenverbindungen** ausgegeben werden. Die alten bekannten Lücken und fraglichen Verbindungen bleiben Audit-Aufgaben.

## Prüfungen

`tests/spck-canvas.test.mjs` prüft, dass die lokale Karte tatsächlich Geometrien zeichnet, ohne Leaflet, Overpass oder andere Datenabrufe.
`tests/map-web.test.mjs` sichert die Reihenfolge der lokalen Skripte und den Zugang zum vollständigen Build.
