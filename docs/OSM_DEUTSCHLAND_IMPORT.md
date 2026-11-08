# Deutschlandweiter OSM-Import – reproduzierbarer Ablauf

## Was bereits implementiert ist

Die App verarbeitet **dieselben OSM-Klassen unabhängig von Autobahnnummern oder Bundesländern**. Der allgemeine Importer unter src/01_Strassennetz/osm-import.ts erfasst Hauptfahrbahnen (motorway), Rampen (motorway_link), OSM-Node-IDs, Gegenrichtungen und unterstützte Abbiegeverbote. Ein Import ist nur dann erfolgreich, wenn alle gelieferten Originalsegmente und angeschlossenen Rampenenden überprüft wurden.

Der verifizierte Graph enthält physische Kanten-IDs, die in Karte, Ereignissen, Routing und späterer Stauphysik identisch bleiben. Keine Landstraßen werden zum optischen Ausfüllen fehlender grüner Rampen verwendet.

**Dieser Prozess ist noch kein fertig generiertes Bundesnetz.** Es liegt zurzeit kein kompletter geprüfter Deutschland-Graph in diesem Repository.

## Datenquelle und Lizenz

- Rohdaten: [Geofabrik OpenStreetMap Germany](https://download.geofabrik.de/europe/germany.html).
- Rohdatei: https://download.geofabrik.de/europe/germany-latest.osm.pbf
- Die Quelle ist mehrere Gigabyte groß; nicht auf ein Mobiltelefon, in Git oder als Browser-Download jeder App-Sitzung laden.
- Datenlizenz: Open Database License 1.0 (ODbL), **© OpenStreetMap-Mitwirkende**. Bereitgestellte abgeleitete Datenbanken unterliegen gegebenenfalls denselben ODbL-Weitergabebedingungen. OSM-Daten dürfen grundsätzlich kommerziell genutzt werden; Attribution muss sichtbar sein.
- OSM-Kartentiles von tile.openstreetmap.org sind **nicht** mit einem unbegrenzt nutzbaren kommerziellen Kartenservice gleichzusetzen. Für die später veröffentlichte Karte eigene/entsprechend lizenzierte Tiles einsetzen.

## Voraussetzungen

Ein Rechner oder Build-Server mit **osmium-tool**, Python 3, Node.js 22+ und ausreichend freiem Speicher/Arbeitsspeicher. Für den vollständigen Import sind die Anforderungen deutlich höher als für die App auf dem Smartphone. Der GitHub-Standardtest erstellt nur kleine synthetische Netze; ein 4,5-GB-Build wird nicht heimlich auf jedem Commit gestartet.

## Konkreter Import

Zuerst die OSM-Quelldatei separat herunterladen und die von Geofabrik bereitgestellte Prüfsumme abgleichen:

    https://download.geofabrik.de/europe/germany-latest.osm.pbf

Im Projektverzeichnis:

    npm install
    npm run build
    bash scripts/build-germany-network.sh /pfad/germany-latest.osm.pbf /pfad/build-ausgabe

Mit öffentlichen Straßen zum späteren Umleiten:

    bash scripts/build-germany-network.sh /pfad/germany-latest.osm.pbf /pfad/build-ausgabe --include-public

### Was die Pipeline erledigt

1. **Osmium filtert** alle motorway/motorway_link-Ways sowie öffentliche Wege, an denen echte Rampen enden können. OSM-Abbiegerelationen und referenzierte Original-Nodes bleiben erhalten.
2. Ein **speicherschonender Python-XML-Converter** bewahrt die originalen Node- und Way-IDs in einer komprimierten Zwischendatei.
3. Der allgemeine **TypeScript-Netzimport** erzeugt gerichtete Fahrwege und explizit zulässige Fahrbeziehungen. Jede importierte Rampe wird überprüft. Auch sehr kurze OSM-Way-Teilstücke müssen vollständig in der Geometrie auftauchen.
4. Unklare/fehlende OSM-Daten erzeugen **generated-network.json.failed-audit.json** und verhindern die Veröffentlichung der neuen Graphdatei. Der alte erfolgreich geprüfte Graph bleibt unangetastet. Eine manuelle Nachbearbeitung muss die OSM-Quelle korrigieren, nicht freie Linien zwischen nahezu berührende Fahrbahnen malen.
5. Ein **Kachel-Exporter** verteilt Straßen auf räumliche JSON.gz-Dateien unter tiles/, behält aber dieselben Segment-IDs wie im Gesamtgraphen. An Kachelgrenzen werden keine neuen Fahrwege erfunden und echte Kreuz-Kachel-Fahrbeziehungen bleiben referenziert.
6. **source-metadata.json** enthält Quell-Datei, SHA-256, Erstellungsdatum und ODbL-Attribution.

### Ergebnisse

- generated-network.json: geprüfter gerichteter Graph, **Build-Artefakt auf dem Server**.
- generated-network.json.audit.json: Quellen-/Lücken-/Rampenaudit.
- tiles/manifest.json: Übersicht aller Kartenteile mit Bounding Box, Größen und SHA-256.
- tiles/\*.json.gz: ladbare geometrische Kacheln mit stabilen Edge-IDs.
- source-metadata.json: Herkunft und Lizenz.

**Wichtig:** Noch fehlt eine echte interaktive Kartenoberfläche und der Laufzeit-Loader für diese Tiles. Ebenso ist die konservative räumliche Stauphysik noch zu entwickeln. Diese Dateien sind die *Datenpipeline*, nicht das fertige Spiel.

## Bekannte Grenzen – keine falschen Versprechen

- Geofabrik-Exporte schneiden an Landesgrenzen und enthalten teilweise OSM-Abbiegerestriktionen über ganze Ways oder bedingte Zeitfenster. Die aktuelle strenge Importlogik stoppt bei **relevanten noch nicht unterstützten via-way/conditional-Restriktionen** oder unvollständigen Rampen.
- Manche motorway-Ways haben keine eindeutig eingetragene ref-Nummer. Diese Fälle müssen geprüft oder später durch eine ausschließlich topologisch eindeutige Referenzauflösung behandelt werden; keine Nummer raten.
- Nationale Rohdateien können bei der bisherigen In-Memory-Graphbildung sehr viel RAM beanspruchen; Node erhält im Buildskript maximal 8 GiB Heap. Falls das nicht ausreicht, brauchen wir die nächste technische Stufe: speicherbegrenzte, disk-backed Graphbildung. **Das ist noch nicht implementiert.**
- Räumliche Kacheln sind nur eine spätere *Darstellungseinheit*. Die Simulation muss Bewegungen und Sperrungen über Kachelgrenzen anhand derselben Kanten-IDs fortsetzen.
- Spurenzahlen, Kapazitäten und Zuflüsse sind häufig nicht vollständig in OSM gepflegt. Fehlende Werte sind als **Szenarioannahmen** auszuweisen und vor Veröffentlichung zu kalibrieren.
- Die automatische Abdeckung beweist nur die Vollständigkeit im **gelieferten Snapshot**. Ein Vollständigkeitsvergleich gegen die tatsächliche Autobahnrealität erfordert aktuellere Quelldaten und Stichproben; auch ein vorhandener OSM-Way kann falsch getaggt sein.

## Abnahmetests

    npm run check

Die CI prüft außerdem eine komplette Kette aus kleinem XML-Snapshot, komprimierter Zwischenstufe, importierter realer OSM-Struktur, Rampen-/Abbiegelogik, Kachelgrenzen und ID-Gleichheit. **Synthetische Mini-Netze sind nicht mit einer Prüfung aller deutschen Autobahnen zu verwechseln.**
