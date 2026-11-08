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

Zuerst die OSM-Quelldatei und die dazugehörige **originale Geofabrik-Clippinggrenze** separat herunterladen und die von Geofabrik bereitgestellte Prüfsumme abgleichen. Eine `.poly`-Datei für den gleichen Datenstand ermöglicht es, nachweisliche Extraktränder von echten Rampenlücken zu unterscheiden:

    https://download.geofabrik.de/europe/germany-latest.osm.pbf
    https://download.geofabrik.de/europe/germany.poly

Im Projektverzeichnis:

    npm install
    npm run build
    bash scripts/build-germany-network.sh /pfad/germany-latest.osm.pbf /pfad/build-ausgabe --boundary-poly=/pfad/germany.poly

Mit öffentlichen Straßen zum späteren Umleiten:

    bash scripts/build-germany-network.sh /pfad/germany-latest.osm.pbf /pfad/build-ausgabe --include-public --boundary-poly=/pfad/germany.poly

### Was die Pipeline erledigt

1. **Osmium filtert** alle motorway/motorway_link-Ways sowie öffentliche Wege, an denen echte Rampen enden können. OSM-Abbiegerelationen und referenzierte Original-Nodes bleiben erhalten.
2. Ein **speicherschonender Python-XML-Converter** bewahrt die originalen Node- und Way-IDs in einer komprimierten Zwischendatei.
3. Der allgemeine **TypeScript-Netzimport** erzeugt gerichtete Fahrwege und explizit zulässige Fahrbeziehungen. Jede importierte Rampe wird überprüft. Auch sehr kurze OSM-Way-Teilstücke müssen vollständig in der Geometrie auftauchen. Eindeutige `highway=service`-Rastplatz- und Betriebszufahrten bleiben außerhalb des normalen Anschlussstellennetzes. Ein Autobahn-`motorway`-Way ohne sichere A-Nummer bleibt geometrisch vorhanden und wird ausdrücklich als unnummeriert gemeldet.
4. Echte Extraktränder können **nur mit passender .poly-Originalgrenze** als externe Netzgrenzen klassifiziert werden (standardmäßig höchstens 150 m Abstand und keine innere Fremdstraßenverbindung). Zwei gerichtete Fahrwege, die am exakt gleichen OSM-Knoten beginnen, bilden eine ausdrücklich protokollierte Graphquelle; daraus wird **keine erfundene Abbiegeverbindung** erzeugt. Andere unklare OSM-Lücken erzeugen `generated-network.json.failed-audit.json` und verhindern die Veröffentlichung der neuen Graphdatei. Der alte erfolgreich geprüfte Graph bleibt unangetastet.
5. OSM-`no_*`- und `only_*`-Abbiegerelationen mit einer oder mehreren **via-Way-Fahrfolgen** werden, soweit alle betroffenen Fahrwege importiert wurden, als echte Wegsequenzen behandelt. Diese Regeln werden auch im Kachel-Exporter erhalten. Der **Kachel-Exporter** verteilt Straßen auf räumliche JSON.gz-Dateien unter tiles/; seine Segment-IDs entsprechen dem Gesamtgraphen.
6. **source-metadata.json** enthält Quell-Datei, SHA-256, Erstellungsdatum und ODbL-Attribution.

### Ergebnisse

- generated-network.json: geprüfter gerichteter Graph, **Build-Artefakt auf dem Server**.
- generated-network.json.audit.json: Quellen-/Lücken-/Rampenaudit.
- tiles/manifest.json: Übersicht aller Kartenteile mit Bounding Box, Größen und SHA-256.
- tiles/\*.json.gz: ladbare geometrische Kacheln mit stabilen Edge-IDs.
- source-metadata.json: Herkunft und Lizenz.

**Wichtig:** Noch fehlt eine echte interaktive Kartenoberfläche und der Laufzeit-Loader für diese Tiles. Ebenso ist die konservative räumliche Stauphysik noch zu entwickeln. Diese Dateien sind die *Datenpipeline*, nicht das fertige Spiel.

## Bekannte Grenzen – keine falschen Versprechen

- Geofabrik-Exporte schneiden an regionalen Grenzen; die zugehörige .poly-Datei belegt die **Extraktgrenze**, ohne dort eine neue Straße zu erfinden. Via-Way-`no_*`/`only_*`-Beschränkungen werden als gerichtete Ketten berücksichtigt, **wenn die notwendigen Ways im Graph vorhanden sind**. Nicht importierte Teilrelationen werden als `deferredViaWayRelations` protokolliert; bedingte Zeitregeln (`restriction:conditional`) und nicht unterstützte Fälle können weiterhin einen strengen Import verhindern.
- Manche physische `motorway`-Ways besitzen keine eindeutige A-Nummer. Sie werden **nicht weggelassen**, aber als `unassignedMotorwayWays` im Prüfbericht geführt. Ohne nachgewiesene A-Nummer dürfen sie nicht stillschweigend einer bestimmten A→B-Vollsperrung zugeordnet werden.
- Nationale Rohdateien können bei der bisherigen In-Memory-Graphbildung sehr viel RAM beanspruchen; Node erhält im Buildskript maximal 8 GiB Heap. Falls das nicht ausreicht, brauchen wir die nächste technische Stufe: speicherbegrenzte, disk-backed Graphbildung. **Das ist noch nicht implementiert.**
- Räumliche Kacheln sind nur eine spätere *Darstellungseinheit*. Die Simulation muss Bewegungen und Sperrungen über Kachelgrenzen anhand derselben Kanten-IDs fortsetzen.
- Spurenzahlen, Kapazitäten und Zuflüsse sind häufig nicht vollständig in OSM gepflegt. Fehlende Werte sind als **Szenarioannahmen** auszuweisen und vor Veröffentlichung zu kalibrieren.
- Die automatische Abdeckung beweist nur die Vollständigkeit im **gelieferten Snapshot**. Ein Vollständigkeitsvergleich gegen die tatsächliche Autobahnrealität erfordert aktuellere Quelldaten und Stichproben; auch ein vorhandener OSM-Way kann falsch getaggt sein.

## Abnahmetests

    npm run check

Die CI prüft außerdem eine komplette Kette aus kleinem XML-Snapshot, komprimierter Zwischenstufe, OSM-Struktur, Rampen-/Abbiegelogik und Kachelgrenzen. Der zusätzliche **echte Geofabrik-Bremen-Praxistest** hat 415 Hauptfahrbahn-Ways, 411 regulär einbezogene Rampen-Ways, 850 gerichtete Fahrwege und 864 Fahrbeziehungen erfolgreich importiert. Dabei wurden 13 service-only-Zufahrten ausgeschlossen, vier `.poly`-Extraktgrenzen erkannt, ein gerichteter Quellknoten dokumentiert und **null ungeklärte Rampenenden** gemeldet. Ergebnis: [erfolgreicher GitHub-Actions-Lauf](https://github.com/colinheinz07-spec/Stau-Simulator-Deutschland/actions/runs/42531933452).

**Synthetische Mini-Netze und ein echter Regionalextrakt sind ausdrücklich noch keine Prüfung sämtlicher deutscher Autobahnen.**
