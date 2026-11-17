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
- **SPCK direkt aus `web/index.html`:** lokale touchfähige Canvas-Karte. Dafür sind die **1.929 OSM-Geometrien, darunter 943 Rampen**, aus der alten [Traffic-Sinulator-App](https://github.com/colinheinz07-spec/Traffic-Sinulator) im Repository unter `web/legacy-geometry.js` übernommen. Der Original-Ansatz aus dem alten Canvas-Kartenmodul lebt in `web/legacy-canvas.js` weiter. Die Karte funktioniert auch ohne Overpass und ohne Leaflet-Bibliothek; OSM-Kacheln sind ein optionaler Hintergrund. Tippen, Verschieben, Zoomen und Fahrstreifeninformationen funktionieren. **Seit Prototyp 0.3 enthält SPCK auch ein laufendes, fahrzeugbilanziertes Zellflussmodell** (`web/offline-traffic.js`) mit Start/Pause, Lastregler, Unfällen, Baustellen und Sperrungen. In Prototyp 0.9 werden die exakten gemeinsamen OSM-Innenknoten für Ein- und Ausfädelungen berücksichtigt. Von den 1.929 lokalen Fahrwegen sind nach Wiederherstellung 48 fehlerhaft gerichteter OSM-Ways **1.559 über 20 begründete Rand- und AS-Quellen** erreichbar, darunter sämtliche 821 A3- und 149 A48-Hauptfahrbahn-Ways; für die übrigen Teilnetze fehlt teilweise weiterhin die Quelle/Ziel-Kalibrierung. Ihre OSM-Fahrbahnen bleiben dennoch wie alle anderen Autobahnen grün sichtbar; das ist kein Hinweis auf eine fehlende geometrische Straßenanbindung. Das sind wesentlich weniger Fahrzeugquellen als früher (188 zu großzügige Quellen), aber mehr korrekt gerichtete Hauptfahrbahnsegmente: keine zusätzlichen Fahrzeuge an Rampenfragmenten oder künstlichen Kartenenden. Die örtliche Nachfrage ist ein Szenario, keine gemessene Zielmatrix.
- **Vollständiger GitHub-Workflow-Build:** Bei erfolgreichem OSM-Import enthält er kompiliertes `dist/` und importierte `data/tiles/`-Dateien. Hier arbeitet die experimentelle Fahrzeug-Engine mit frisch importierten gerichteten A3/A48-OSM-Strecken. Wenn externe OSM-Rohdaten nicht heruntergeladen werden können oder das Netzaudit scheitert, wird stattdessen ein **ausdrücklich gekennzeichneter lokaler Canvas-Fallback** veröffentlicht – keine irreführende vollständige OSM-Karte. Auch der Vollimport ist noch nicht deutschlandweit fertig.
- **Nicht verwechseln:** Die lokale Legacy-Karte zeigt zusätzlich Autobahnen aus dem Altprojekt; das ist noch kein vollständig validiertes bundesweites Simulationsnetz. Rampenlücken aus der alten App können weiterhin bestehen und werden nicht automatisch als behoben ausgegeben.

## Ereignisse konfigurieren (SPCK 0.9)

In `web/index.html` auf einen OSM-Fahrweg tippen und **Baustelle, Unfall, Panne oder Vollsperrung** wählen. Im Ereigniseditor werden nicht sofort pauschal Spuren gesperrt: Es lassen sich die tatsächlichen Fahrstreifen (F1 rechts bis Fn links), Geschwindigkeit, Länge und Standstreifenstatus auswählen. Ein bestätigter Standstreifen kann als zusätzliche Fahrspur freigegeben werden; bei ausdrücklich als `shoulder=no` markierten OSM-Segmenten ist dies untersagt. Die 29 verfügbaren Schulter-OSM-Tags der alten A3/A48-Geometrie wurden übernommen; sonst ist die Verfügbarkeit unbekannt und muss bewusst für den gesamten betroffenen Abschnitt bestätigt werden.

Zeitplanung: **sofort/dauerhaft**, **einmalig von–bis**, **wöchentlich wiederholt an frei ausgewählten Wochentagen**. Die Wiederholung folgt Europe/Berlin auch über Mitternacht und bei Zeitumstellung. Der Modellstart ist separat einstellbar. Ereignisse werden lokal im Browser gespeichert, können bearbeitet und entfernt werden. Pannen/Unfälle sind auf maximal 200 m begrenzt; Baustellen auf 20 km, Vollsperrungen auf 100 km. Eine Vollsperrung auf der Hauptfahrbahn wird automatisch von der vorherigen bis zur nächsten AS/AK entlang der ausgewählten Richtung festgelegt; die Längenangabe ist dann schreibgeschützt. Wenn eine der beiden realen Grenz-AS im vorhandenen OSM-Graph nicht zuverlässig zuordenbar ist, wird das Ereignis **nicht stillschweigend auf 200 m reduziert**, sondern abgelehnt. Mehrphasige Bauabläufe und vollständige Quell-Ziel-Umleitungen sind **noch nicht** übernommen.

Kapazitäten und geschätzte Geschwindigkeiten reagieren auf die tatsächlich aktiven, von/bis-limitierten Fahrstreifen-Regeln. Sperren werden nur über die betroffenen Teilstücke rot-weiß markiert. Der lokale Prototyp verwendet weiterhin ein vereinfachtes Zellmodell; es ersetzt noch keine nach Zielen geroutete, flächendeckende Straßenverkehrssimulation.

## SPCK 0.9 – korrigierte Verkehrsphysik und Kartendarstellung

- **48 falsch herum importierte OSM-Hauptfahrbahn-Ways** auf A3/A48 werden entlang originaler gemeinsamer Endknoten gedreht. Beide gerichteten Autobahnkorridore sind nun durchgängig für den Fluss erreichbar (A3 821/821, A48 149/149 Hauptfahrbahn-Ways).
- **Anfangsverkehr aus dem alten Modell:** Eine einmalige zur eingestellten Uhrzeit passende Fahrzeugbelegung wird bei Simulationsbeginn gezählt und in die Fahrzeugbilanz aufgenommen. Anschließend kommen neue Fahrzeuge aus den benannten Quellstellen, nicht an beliebigen Way-Bruchkanten.
- **Phantomstaus:** Echte Kartenenden entlassen Fahrzeuge auch dann, wenn weiter vorne eine Abfahrtrampe liegt. Winzige OSM-Ways bekommen ein zum Zeitschritt passendes virtuelles Speichervermögen; die Karten-Geometrie bleibt metrisch unverändert.
- **Unfallstau:** Geschwindigkeit berücksichtigt den tatsächlich möglichen Abfluss aus der belegten Zelle, statt erst bei fast vollständiger Staufüllung rot zu werden. Zwei gesperrte von drei Fahrstreifen erzeugen bei höherem Zufluss physisch sichtbaren Rückstau. Die früher fehlerhafte Abfluss-Umleitung aller Fahrzeuge auf Seitenrampen ist bei Unfällen/Baustellen abgeschaltet; dynamische Umleitung bleibt für echte kommende Vollsperrungen erhalten.
- **AS-zu-AS-Sperrungen:** Mehrfacherkennung derselben Anschlussstelle und die künstliche 75-km-Grenze der Suche entfernt. Im Datenbestand geprüft z. B. A565 Bonn-Auerberg–Bonn-Beuel-Nord sowie A3 AD Dernbach–Montabaur.
- **Mobil & Stauanzeigen:** Stauhinweise werden wie im Altprojekt mit Kollisionsprüfung um Karten- und Zoom-Bedienelemente platziert, Ereignisse sind kompakter bedienbar, tatsächliche gesperrte Rampen können im größeren Zoom ein ⛔-Symbol bekommen. Alte lokal gespeicherte Ereignisse bleiben als v2-Sicherung vorhanden und werden in den v3-Arbeitsspeicher übernommen.

Die Werte sind **Modellannahmen**, keine Echtzeit-Daten. Vollständige Zielrouten/Umleitungen und andere Autobahnen als A3/A48 sind noch nicht flächendeckend validiert.

## Stand 0.9: Verkehr, Wochenende, Vollsperrung

- **Hauptfahrbahn: 2.200 Kfz/h je Fahrstreifen** als bestätigte Szenariokapazität; einspurige Rampen separat mit 1.500 Kfz/h. Ereignisse senken die nutzbare Kapazität über gesperrte Spuren, kein automatisches Rot wegen niedriger Geschwindigkeitsbegrenzungen.
- **Alte Verkehrswerte wiederverwendet:** gerichtete Referenzspitzen A3 Köln 4.200, A3 Frankfurt 4.100, A48 Dernbach 2.400, A48 Koblenz 1.700 Kfz/h, NRW-Referenzen im `web/traffic-reference.js`. Weitere A3-/A48-/NRW-Korridorwerte bleiben ungeprüfte Modellannahmen und werden nicht blind als lokaler Rampenzufluss eingespeist.
- **Tagesgang:** die ursprünglichen Wochentags-, Freitags-, Samstags- und Sonntagskurven samt Fahrtrichtung werden angewendet; Ferien 2026/27 für Rheinland-Pfalz/NRW/Hessen (KMK) und bewegliche gesetzliche Feiertage werden im Szenario berücksichtigt. Ferien/Feiertags-Verkehrsfaktoren sind noch unkalibriert.
- **Vollsperrung:** exklusiv in die Sperrung führende Rampenketten sind ebenfalls für neue Einfahrten gesperrt und rot-weiß markiert; offene Ausfahrten bleiben offen. Fahrzeuge, die sich bereits innerhalb der Sperrung befinden, dürfen weiter abfließen. Im lokalen Editor ist die vollständige AS-zu-AS-Länge verbindlich, sofern der gerichtete OSM-Graph beide Anschlussstellen sicher erfasst. Auch alte gespeicherte 200-m-Vollsperrungen werden beim Laden erneut an die Grenz-AS angepasst. Für rein als OSM-Verbindung erfasste Zufahrten ohne eigenständige Rampengeometrie blockiert das Modell die erlaubte Abbiegebewegung, ohne eine falsche Rampe einzuzeichnen.
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


## SPCK 0.9.1 – Stauauflösung, Abfahrten und Sperrampeln

- Die lokale Zellfluss-Simulation und die Darstellung sind getrennt: kurze isolierte verlangsamte OSM-Ways werden bei Übersichtsstufen nicht mehr als rote Punkte gezeichnet. Zusammenhängende Staus und die Stauwerte bleiben modellberechnet; höhere Zoomstufen bleiben detaillierter.
- Bei einer Vollsperrung zwischen **zwei realen Anschlussstellen** werden alle real erfassten Einfahrten und Fahrbeziehungen in die geschlossene Richtung blockiert. Die offene Gegenfahrbahn und offene andere Autobahnen bleiben in Betrieb. So ist beispielsweise A59→A3 im betroffenen Kölner-Heumar-Fall verboten, ohne die gesamte A59 zu schließen.
- Vor einem erkannten Vollsperrungsabschnitt wird der vorhandene Verkehr an der nächsten erreichbaren **zulässigen** Umleitungsmöglichkeit abgeleitet. Eine volle einspurige Abfahrt verursacht stattdessen einen physisch beschränkten Rückstau vor der Verzweigung; Fahrzeuge dürfen deswegen nicht an der Ausfahrt vorbei in die Sperrung fahren. Schon innerhalb der Vollsperrung befindliche Fahrzeuge fließen wie bisher ab.
- Die Annahme für **freiwillige** Abfahrten bei Verzögerungen wird ab 45 Minuten erhöht und erreicht bei 240 Minuten 100 % Umleitungsbereitschaft. Dies ist eine Verhaltensregel, keine gemessene Deutschlandquote; tatsächlich stattfindende Abbiegungen bleiben auf vorhandene, legal fahrbare OSM-Verbindungen und Rampenkapazitäten beschränkt.
- Leichte modellierte Anfahrverluste bei sehr hohen Zelldichten vermeiden eine schlagartige Vollkapazität nach Stauauflösung. Vorhandene Unfall- und Baustellen-Engpässe bleiben kapazitätsgesteuert und fahrzeugbilanziert.

**Wichtige fachliche Einschränkung:** Die lokale Karte enthält Autobahnen und Rampen, aber kein lückenloses Straßennetz zwischen allen Anschlussstellen. Eine Ausfahrt in eine unmodellierte Straße ist ein Netzabfluss; das Fahrzeug kann ohne echte weiterführende Geometrie und belastbare OD-Ziele **nicht** hinter dem Stau wieder aufgefahren werden. Für vollständige Autobahn-zu-Autobahn-Umleitungen mit wiederkehrenden Fahrten braucht die spätere importbasierte OD-Engine reale Alternativrouten und Zielwahl. Außerdem muss der Vollständigkeitsstatus der Kölner Verbindungsketten auf dem iPhone weiterhin geprüft werden.


## SPCK 0.9.2 – Vollsperrungen als Anschlussstellenabschnitt und verzögerte Wiederauffahrt

- **Keine frei wählbare Sperrlänge:** Im Ereigniseditor wird bei Vollsperrung das Längenfeld ausgeblendet. Es muss ein gerichteter Hauptfahrbahnabschnitt mit zwei erkannten, tatsächlich verbundenen Anschlussstellen/Autobahnkreuzen vorliegen. Ohne diese beiden Anker verweigert der Editor die Sperrung, statt eine zufällige 200-m-Sperre zu setzen. Die Länge existiert weiterhin intern nur als abgeleitete geometrische Größe.
- **Sperre als Einfahrverbot statt Wandsperre:** Ein ganzer Korridor und die ausschließlich hineingehenden Rampen werden für *neue* Zufahrten gesperrt. Fahrzeuge, die bei Aktivierung bereits innerhalb der administrativen Sperrzone oder auf einer ihrer Zufahrtsrampen fahren, können diese bei frei gebliebenen Fahrstreifen räumen. Ein gesonderter Unfall, der alle Fahrstreifen tatsächlich blockiert, verhindert diese Räumung weiterhin.
- **Abfahrt und spätere Wiederauffahrt:** Bei erkannter Umleitung via einer echten OSM-Abfahrtrampe wird der zur Umfahrung bestimmte Fahrzeuganteil markiert, bis er die Abfahrt tatsächlich durchfahren hat. Nur wenn eine konkrete, in Fahrtrichtung erreichbare und **hinter dem Ende der Sperrung liegende OSM-Auffahrt** existiert, bleibt dieser Anteil während einer externen Fahrt als `vehiclesOnDetours` in der Fahrzeugbilanz und fließt nach einer geschätzten Fahrtzeit an der echten Auffahrt wieder zu. Die lokale Quellnachfrage und die Rückkehr teilen sich die begrenzte Zufahrtskapazität. Überfüllte Rückfahrtszuflüsse warten außerhalb des dargestellten Netzes. Ohne identifizierte reale Wiederauffahrt werden **keine** neuen Fahrzeuge erfunden.
- **Echte Kartendaten validiert:** Der Test mit einer Vollsperrung **A3 AD Dernbach–AS Montabaur** findet vorhandene OSM-Ausfahrten und in Fahrtrichtung nachfolgende reale Auffahrten. Zusätzlich werden Rampen-Räumung, Rückkehr mit Fahrzeit, Fahrzeugbilanz und fehlende Rückkehrmöglichkeit durch Tests abgesichert.
- **Lokalstraßen sind noch nicht kartiert:** Die direkte Verbindung von Abfahrt zu Auffahrt über Bundes-/Land-/Stadtstraßen ist im SPCK-Snapshot **nicht** als befahrbares OSM-Straßennetz enthalten. Dafür nutzt die Simulation derzeit einen *makroskopischen, nicht zeichnerisch dargestellten* Außenweg mit einer geschätzten Fahrtzeit (Luftlinie × 1,55 bei 40 km/h plus drei Minuten, mindestens fünf Minuten). Das ist eine ausdrückliche Modellannahme, **keine nachgewiesene Straßenroute**. Eine lückenlose regionale bzw. deutschlandweite OD-Simulation mit konkreter Straßenroute und Kapazität jedes Straßenabschnitts erfordert einen zusätzlichen vollständigen öffentlichen Straßengraphen; dafür ist der aktuelle Offline-Kartenausschnitt nicht ausreichend.

Der Umfang der tatsächlichen Umsetzung ist damit transparent: **Rampen-Abfluss, konservierte externe Reise und reale Wiederauffahrt sind implementiert; straßengenaue Umleitungen durch Orte noch nicht.**


## SPCK 0.9.3 – vollständig markierte Sperrrampen und frühe Knoten-Umleitung

**Gemeldetes Beispiel: AD Dernbach, A48 → A3 Richtung Frankfurt.** Der Echtkartentest für eine A3-Vollsperrung AD Dernbach–AS Montabaur überprüft die *volle Länge* der gerichteten A48→Frankfurt-Rampe (ab ihrem tatsächlichen A48-Abzweig), das Einfahrverbot von der A48, das Weiterlaufen der separaten Rampe A48→Köln und die Räumung der gesperrten Rampe ohne neue Zuflüsse. Es werden keine Straßengeometrien erfunden.

Die bisherige Stauursache lag auch in einer zu kurzen Vorausschau: Der bisherige Routencheck endete, wenn eine Autobahn nur in **Rampen zu verschiedenen weiterführenden Autobahnen** zerfällt. Ein geplanter A3-Fahrtrichtungsverschluss wurde deshalb auf der vorangehenden A48 nicht rechtzeitig als Risiko erkannt; die Nachfrage konnte erst am gesperrten Knoten auf einen einzigen einspurigen Fahrweg ausweichen. Die neue, deutschlandweit generische `closureExposureAhead`-Berechnung verfolgt **reale gerichtete Rampenverbindungen**: Bei zwei Endästen (Köln offen, Frankfurt gesperrt) wird nicht pauschal die ganze A48 gesperrt, sondern nur der geschätzt betroffene Anteil der Nachfrage vor dem Knoten an echte vorhandene Ausfahrten verwiesen. Die Anteile sind derzeit ein **gleichverteiltes Modell** für unbekannte Zielwahrscheinlichkeiten, keine Messwerte. Überlastete Alternativen erzeugen weiterhin realen Rückstau.

Die kartografische Sperrmarkierung hat jetzt **eine durchgehende rote Unterlage und weiße Striche**, keine grünen Zwischenräume. Das Sperrschild steht am tatsächlichen Rampeneingang statt bei 70 % einer Rampe. Eine vorab indizierte Eingangskantenliste vermeidet quadratischen Aufwand beim Neuzeichnen auf mobilen Geräten. Die algorithmische Vorausschau wird nur bei Änderungen der aktiven Vollsperrungen neu berechnet, nicht in jedem 5-Sekunden-Schritt.

**Abgrenzung:** Die Simulation berechnet im lokalen SPCK-Prototyp keine vollständig straßengenauen Land-/Stadtstraßenrouten; die schon implementierten externen Umleitungen haben geschätzte Fahrzeiten und führen nur über echte OSM-Auf-/Abfahrten zurück. Deshalb ist dies eine generische, physisch bilanzerhaltende Verkehrsmodell-Verbesserung, keine bundesweite Straßenfeinmodellkalibrierung.


## SPCK 0.9.4 – Wiederauffahrt nach der Behinderung statt Straßengenauigkeit

**Zielvorgabe:** Die Simulation benötigt keine vollständige Land- und Stadtstraßen-Route. Ausweichende Fahrzeuge verlassen die Autobahn an einer **tatsächlichen vorgelagerten Abfahrt**, bleiben für ihre geschätzte Fahrtzeit außerhalb des dargestellten Autobahnnetzes im Fahrzeugbestand und kehren auf der richtigen Richtungsfahrbahn **ab der ersten tatsächlich verfügbaren Anschlussstelle hinter der Sperrung bzw. dem Stau** zurück. Auch bei vollständig überlasteter Auffahrt verschwinden sie nicht, sondern warten außerhalb des Netzes, bis wieder Kapazität verfügbar ist.

Da die bisherige lokale Zellfluss-Engine keine individuellen Fahrtziele kennt, werden **keine willkürlichen Fahrzielanteile erfunden**. Für Fahrzeuge, die auf derselben Autobahn weiterfahren, ist daher die **erste tatsächlich geeignete Auffahrt hinter der Behinderung zu 100 %** der Standard-Wiederauffahrtspunkt. Weitere reale Anschlussstellen werden als Kandidaten für spätere nachgewiesene Ursprung-Ziel-Zuordnungen gespeichert, erhalten aber ohne solche Daten keinen angenommenen Verkehr. Rampensegmente derselben Anschlussstelle zählen nicht mehrfach. Die Fahrzeugbilanz bleibt exakt erhalten, zurückkehrende Fahrten unterliegen denselben Kapazitäten wie örtliche Auffahrten. Ankommende Außennetz-Fahrten werden für bessere iPhone-Leistung in 30-Sekunden-Gruppen verarbeitet.

Die Logik ist nicht auf Verwaltungs-Vollsperrungen begrenzt: Auch bei Unfall, Baustelle oder Panne kann eine **tatsächliche berechnete Verzögerung ab 45 Minuten** zu dieser Umleitung führen. Schwerwiegende ungeplante Staus ohne Ereignis erhalten anhand des gemessenen Staukopfs (mindestens 45 Minuten) ebenfalls eine nachgelagerte Wiederauffahrtsplanung. Der Staukopf wird aus zusammenhängenden betroffenen Straßenabschnitten und nicht aus der Position der Stau-Beschriftung bestimmt. Dies ist eine makroskopische Approximation; konkrete lokalstraßengeführte Wege und individuelle Fahrzeug-Zieladressen sind weiterhin nicht enthalten.


## SPCK 0.9.5 – gerichtete Vollsperrungen an realen Rampengrenzen

- Ein Fingertipp auf die Autobahn-Hauptfahrbahn wählt den tatsächlich umgebenden Anschlussstellen-Abschnitt der jeweiligen Fahrtrichtung. Kein automatischer Sprung um 450 m in den Folgeabschnitt.
- **Beginn:** Letzte Abfahrt vor dem Sperrbereich bleibt offen; die in den Sperrbereich führende Auffahrt wird gesperrt. **Ende:** Abfahrt aus dem gesperrten Bereich wird ebenfalls gesperrt; die folgende Auffahrt für den zurückkehrenden Verkehr bleibt offen.
- Sperrgrenzen werden soweit im importierten OSM-Graph möglich aus echten Abfahrt-Verzweigungen und Auffahrt-Einmündungen hergeleitet statt aus der Position eines Anschlussstellennamens. Interne OSM-Way-Grenzen unterbrechen die Sperrlogik nicht.
- Umleitungen dürfen Fahrzeuge an der **ersten rechtmäßigen Auffahrt hinter der Sperrung** wieder auf die Autobahn führen, auch wenn diese exakt am Sperrende ansetzt. Das innerörtliche Straßennetz ist weiterhin nicht modelliert; Reisezeit außerhalb des Autobahnnetzes ist eine Schätzung.
- Regressionen u. a. mit A3 Dierdorf–Neuwied, AD Dernbach, AD Köln-Heumar, AK Köln-Gremberg, AK Bonn/Siegburg und einem generischen mehrarmigen Kreuz mit alternativen Überleitungen. 114 automatische Tests erfolgreich beim Merge.
- **Wichtig:** Die Änderungen sind universell **konzipiert**, aber nicht für jede Anschlussstelle Deutschlands nachgewiesen. Der aktuelle Karten- und Simulationsdatenbestand bildet weiterhin nur einen Ausschnitt des bundesweiten Autobahnnetzes ab. Größere OSM-Netzerweiterungen erfordern weitere Graph-, Rampen- und reale SPCK-Interaktionstests.


## SPCK 0.9.6 – echte Knoten-Grenzen statt angenäherter AS-Punkte

**Vollsperrungen auf Hauptfahrbahnen werden durch den gerichteten Autobahn-Graphen zwischen zwei benachbarten Anschlussstellen definiert, unabhängig von deren Entfernung.** Der einmal angetippte Abschnitt bestimmt den Korridor. Am letzten echten Abfahrts-Abzweig beginnt die Sperrung, am ersten für die Rückkehr bestimmten Auffahrts-Einmündung hinter dem gesperrten Abschnitt endet sie. Die vorgelagerte Abfahrt bleibt offen; ihre anschließende Auffahrt Richtung Sperrung wird gesperrt. Am anderen Ende gilt umgekehrt: Abfahrt gesperrt, Auffahrt hinter der Sperrung offen.

- Die bisherige Nähe-Suche mit maximal 1.500 Metern um das ungefähre Anschlussstellensymbol entfällt. Insbesondere am AD Dernbach endet der Umleitungsweg zur A48 Richtung Koblenz **nicht** in einer Absperrung; die A3 Richtung Köln wird ab dem tatsächlichen A3/A48-Abzweig gesperrt.
- Rampen werden nur dann gesperrt, wenn sie in den gesperrten gerichteten Korridor führen und kein erlaubter Abzweig mehr davor bleibt. Unabhängige Fahrbeziehungen, darunter die Gegenrichtung und alternative Überleitungen, bleiben offen.
- Zwangsumleitungen erfolgen am **letzten** noch offenen Abfahrtspunkt vor der Sperrung, statt bereits an früheren Anschlussstellen. Für Sperrungen gelten keine 16-, 25- oder 60-km-Suchgrenzen bei der Ermittlung des letzten legalen Abfahrts- und ersten Wiederauffahrtspunktes.
- Die Karte verwendet dieselben physischen OSM-Kanten wie die Simulation: Sperrstart rot, Wiederfreigabe grün. Die Anzahl gleichzeitig aktiver gespeicherter Vollsperrungen wird separat angezeigt. Im Ereignis-Editor wird bei Vollsperrungen keine manuelle Meterlänge benötigt.
- Der bisher fehlende Autobahn-`ref` bei A559 und A560 wird aus vorhandener Beschilderungsbezeichnung und der Anschlussstellenliste generisch ergänzt; es gibt keine Ausnahmeregel speziell für diese beiden Autobahnen.
- Automatisierte Regressionen für AD Dernbach → Ransbach-Baumbach, Ransbach-Baumbach → Dierdorf, A3 Dierdorf → Neuwied, AD Köln-Heumar, AK Köln-Gremberg, AK Bonn/Siegburg, verästelte Kreuzungsrampen und Abschnittslängen von 2 m bis 14 km sowie lange Umleitungswege. Unvollständige Knoten im echten OSM-Netz lösen einen sichtbaren Fehler aus, keine erfundene Teilsperrung.

**Wichtige Grenze:** Die Regeln sind für beliebige gerichtete Autobahnnetze konzipiert; die vorhandene offline SPCK-Karte enthält aber noch nicht das komplette deutsche Autobahnnetz und ersetzt keine getesteten, realen Abbiegeverbots-/OD-Routingdaten. Das bundesweite Verhalten ist daher noch nicht flächendeckend bestätigt. Bei aktiven Alt-Ereignissen vor einem Vergleich bitte unter „Ereignisse und Simulation zurücksetzen“ aufräumen, damit keine mehreren gespeicherten Vollsperrungen miteinander verwechselt werden.

## SPCK 0.9.7 – vollständige Zubringer und Rampenketten

- Eine Autobahn, die direkt in eine gesperrte Fahrbahn mündet, wird ab ihrem letzten legalen Abzweig ebenfalls gesperrt. Beispiel: A3 Heumar → Köln-Ost sperrt die A59 Richtung Heumar ab dem realen Abzweig A559 am AD Porz (ca. 3 km); die A559 und die A59 Richtung Bonn bleiben befahrbar.
- Kleine Rampenteilstücke werden in beiden Richtungen entlang echter OSM-Verbindungen verfolgt. Gemeinsame Rampenabschnitte bleiben ab dem nächsten offenen Zulauf befahrbar. Direkte Autobahn-zu-Autobahn-Abzweige zählen ebenso wie Rampen als legale Ausweichmöglichkeit.
- Sperrmarkierung, Zugangssperre und Abfluss beruhen auf denselben gerichteten Intervallen. Bereits innerhalb der Sperrung vorhandene Fahrzeuge können abfließen; neue Fahrzeuge dürfen nicht nachrücken. Die abgeleiteten Sperrungen werden beim Aufheben oder Ablauf des Ereignisses zurückgenommen.
- Die Regeln gelten ohne Sonderfall für Köln; die Tests enthalten reale Kreuzungen und künstliche fragmentierte Zubringer mit gemeinsamen Ausfahrten.

## SPCK 0.9.8 – Parallelfahrbahnen und Freigabe am nächsten Knoten

- Bei der A4 Köln-Süd → Eifeltor bleibt die echte Eifeltor-Auffahrt über die Parallelfahrbahn bis zur Einfädelung Richtung Aachen zugänglich. Die bisher fehlenden Rückrichtungen zweier OSM-Links (`455315441`, `455315447`, jeweils `oneway=no`) wurden anhand der Original-Tags rekonstruiert; beide Fahrtrichtungen erscheinen separat. Die bestätigten westwärts gerichteten lokalen Zufahrten (Am Eifeltor und Luxemburger Straße) sind über ihre realen Rampenketten angebunden.
- Köln-Klettenberg → Köln-West beginnt dagegen auf der Hauptfahrbahn schon am Eifeltor-Abzweig, weil die Parallelfahrbahn die letzte Abfahrt Richtung Klettenberg bedient. Die Abfahrt bleibt erreichbar, die Einfädelung in die gesperrte A4 bleibt geschlossen.
- Am nachgelagerten Autobahnkreuz bleiben Abfahrten zu einer unabhängigen offenen Autobahn frei (z.B. A3 Siebengebirge → Bonn/Siegburg: Überleitungen zur A560). Normale Rampen innerhalb des gesperrten Korridors bleiben nach wie vor gesperrt.
- Der Offline-Import unterscheidet ausdrücklich verifizierte zweirichtungsfähige OSM-Links, örtliche Quellen und durchgehende Parallelfahrbahnen. Es werden keine geometrisch nur benachbarten Straßen verbunden. Die lokalen OSM-Bestandsdaten sind weiterhin kein flächendeckend auditierter Deutschland-Datensatz.

## SPCK 0.9.9 – kombinierte Vollsperrungen und reale Wiedereinfahrten

- Alle gleichzeitig aktiven Vollsperrungen (auch einzeln gesetzte Rampensperrungen) werden gemeinsam ausgewertet. Wenn die letzte offene Weiterfahrt entfällt, reicht die Folgesperrung bis zum letzten realen Abzweig zurück. Beispiel: beide A3-Richtungen ab Heumar gesperrt → A4 Richtung Heumar ab dem letzten A559-Abzweig am Kreuz Gremberg gesperrt; die Gegenrichtung bleibt offen. Bei Beendigung eines Ereignisses wird der Zugang erneut berechnet.
- Umleitungen werden je erreichbarem Hindernis und gerichteter Zielautobahn ermittelt. AK/AD-Überleitungen sind keine lokalen Auf- oder Abfahrten; eine Wiedereinfahrt ist nur an einer im Netz belegten lokalen Auffahrt außerhalb der Sperrung möglich. Für A3 Richtung Frankfurt nach Heumar ist dies beispielsweise AS Königsforst. Bei mehreren offenen Zielrichtungen fehlen echte OD-Anteile; die Verteilung ist deshalb eine Modellannahme.
- Die Zeit auf dem untergeordneten Straßennetz bleibt eine Schätzung. Ohne nachgewiesene lokale Auffahrt wird keine Rückkehr erfunden. Es handelt sich nicht um einen vollständigen amtlichen U-Nummern-Katalog oder eine geprüfte Straßenroute.

## SPCK 0.10.2 – richtungsbezogene Staus und endlicher Abfahrtsstauraum

- Staumeldungen nutzen Anfang und Ende der tatsächlich zusammenhängenden gerichteten Staufläche. Die angrenzenden Anschlussstellen werden aus dem Netz ermittelt; ein einzelnes kurviges OSM-Teilstück allein bestimmt nicht mehr die Fahrtrichtung. Die Karte nennt zusätzlich die Richtung.
- Eine lokale Abfahrt hat eine modellierte Abflussleistung von 700 Kfz/h je Ausfahrtsspur (maximal zwei), getrennt von der Lagerkapazität in Fahrzeugen. Der Stauraum folgt der tatsächlichen Rampenlänge, mit einer kleinen numerischen Untergrenze für sehr kurze Fragmente. Überlastung staut sich über die Rampe auf die Autobahn zurück. Die Detailansicht zeigt beide Werte.
- Vorgegebene Modellumleitung bei AD Dernbach → Montabaur in Richtung Frankfurt: A3-Verkehr verlässt die Autobahn bei Ransbach-Baumbach; der betroffene Anteil von der A48 nutzt die offene A3-Überleitung Richtung Köln und die dortige Ransbacher Abfahrt. Beide fahren in Montabaur Richtung Frankfurt wieder auf. Die übrigen A48-Fahrer behalten ihre ursprüngliche Zielrichtung. Die lokalen Wege und Zielanteile bleiben Modellannahmen, keine amtlich verifizierte U-Route.

## SPCK 0.10.3 – Zeitverlust und Rampen

- Zeitverlust des befahrbaren Staus = Summe der Fahrzeiten je Modellzelle minus freie Fahrt. Auch ein Stau vor einer Vollsperrung erhält diesen momentanen Schätzwert; er ist keine Prognose der Wiederöffnung. Bei weniger als 1 km/h wird mit 1 km/h als ausdrücklich gekennzeichneter Mindestzeitverlust gerechnet.
- Kurze zusätzliche Fahrstreifen (bis 900 m zwischen gleich breiten gerichteten Hauptfahrbahnen) im kompakten OSM-Bestand werden als Ein-/Ausfädelungsstreifen behandelt. Das ist eine aus der Geometrie abgeleitete Annahme, keine flächendeckend vermessene Spurklassifikation. Dauerhafte Verbreiterungen und uneindeutige Knoten bleiben unverändert.
- Abfahrten behalten ihre Zielverteilung auch bei begrenztem Empfang; kurze belastete Rampen können farbig erscheinen. Die Karte zeigt schlankere Linien und weniger Stauboxen, die Liste enthält weiterhin alle ermittelten Staus.
- Bei AD Dernbach → Ransbach Richtung Köln nutzt der betroffene A48-Anteil die reale Abfahrt Höhr-Grenzhausen und die Auffahrt Ransbach Richtung Köln; der Frankfurter Anteil nutzt weiter die offene Überleitung.

## SPCK 0.10.4 – Rastanlagen und richtungsabhängige Rampen

- Die im Koordinatenbestand fälschlich als Anschlussstellen beschrifteten Rastanlagen-Rampen werden aus Simulation und Kartenoverlay entfernt. Die durchgehende Autobahn bleibt bestehen.
- Ein doppelt importierter, unvollständiger Wendefahrweg bei Rösrath wurde ebenso ausgeschlossen; die tatsächliche Abfahrt bleibt erhalten.
- Reguläre Abfahrten enden am öffentlichen Straßennetz. Ein anschließender Auffahrtszweig zieht nicht automatisch abfahrende Fahrzeuge zurück auf die Autobahn; Umleitungsverkehr kehrt über die dafür vorgesehenen Auffahrten zurück.
- Am AD Dernbach gelten vorläufig unterschiedliche Zielanteile für A3 Richtung Köln → A48 (40 %) und A3 Richtung Frankfurt → A48 (15 %). Die Werte sind Modellkalibrierungen, keine erhobenen Fahrbeziehungen. Die tatsächlich ankommenden Mengen können abweichen. Ausgelastete Überleitungen behalten ihre zugeordneten Fahrzeuge und erzeugen kapazitätsabhängigen Rückstau.

## SPCK 0.10.5 – Sperrgrenzen und Stauumleitungen

- Lokale Anschlussstellen verwenden den nachgewiesenen Abfahrtspunkt auch bei einem Klick zwischen Abfahrt und Kartenbeschriftung. Diez → Montabaur beginnt deshalb nicht mehr versehentlich in Limburg-Nord.
- Weitere fünf Rastanlagen-Wege werden unabhängig vom Import-ID-Präfix ausgeschlossen. Durchgehende Fahrbahnen und echte Anschlussstellen bleiben im Modell.
- Höhere Werktags-Referenzspitzen für A3 (5.000 Kfz/h je Richtung) und A48 (3.200 Richtung Dernbach, 2.500 Richtung Koblenz) sind Modellannahmen; an den Wochenenden bleiben die bisherigen Profile erhalten.
- Stauanzeige und Umleitungsentscheidung nutzen dieselbe Untergrenze von 1 km/h. Fahrbare Umleitungen mit tatsächlicher Ab- und Auffahrt werden bereits bei Ereignisbeginn vorbereitet und abhängig vom Zeitverlust aktiviert (ab 45 min zunehmend, ab 240 min vollständig). Die Rampenkapazität bleibt beschränkt; die Fahrzeuge können deshalb vor der Abfahrt warten müssen.

## SPCK 0.10.6 – Fernverkehr auch nachts

- A3, A1, A4, A61 und A48 erhalten einen eigenständigen Mindestnachfrageverlauf für Durchgangsverkehr (einschließlich Schwerverkehr). Der Berufsverkehrs-Exponent wird nicht nochmals auf diesen Verlauf angewandt. A3-Mittagsnachfrage fällt werktags nicht mehr so stark ab. Lokale Auffahrten behalten ihre eigenen Nachfragekurven; normale lokale Abfahrtsanteile sinken entsprechend der lokalen Nachfrage. Autobahnwechsel und erzwungene Umleitungen bleiben davon unberührt; Kapazität und frei wählbare Verkehrslast bleiben unverändert.
- Kalibrierungsanker: BASt-Zählstelle AD Dernbach VQ Süd, Stand 2019, veröffentlicht in der [Schalltechnischen Untersuchung Montabaur, P20-081/B5](https://www.vg-montabaur.de/dokumente/leben-erleben/bauen-wohnen/laufende-bauleitplanverfahren/bebauungsplaene-der-stadt-montabaur/outlet-montabaur/22-p20-081-b5-2025-08-12-su-montabaur-bpl-foc.pdf?cid=2sxd), August 2025, S. 10–11: 106.366 Kfz/24 h, 1.489 Kfz/h Nachtmittel (22–6 Uhr, beide Fahrtrichtungen), 17,2 % Schwerverkehr im Tagesmittel. Stundenverlauf und Übertragung auf andere Autobahnen sind modellierte Annahmen, keine ausgelesenen BASt-Stundenmesswerte. Der [BASt-Stundenwertdatensatz](https://www.govdata.de/suche/daten/automatische-zahlstellen-auf-autobahnen-und-bundesstrassen-stundenwerte) ist die vorgesehene Grundlage für zukünftige zählstellenspezifische Kalibrierungen.

## SPCK 0.10.7 – Kapazitätsabhängige Stauumfahrung

- Die vorgesehene Abfahrt bleibt zunächst priorisiert. Bei langem Rückstau nutzen Fahrzeuge zusätzlich frühere echte Anschlussstellen, wenn der geschätzte Zeitverlust den Aufwand der Umfahrung rechtfertigt; die Abflusskapazität jeder Rampe begrenzt den Anteil. Alle Umleitungsfahrzeuge bleiben bilanziert und kehren über eine offene Auffahrt hinter der Sperrung zurück.
- AD Dernbach → Montabaur (Frankfurt): Ransbach bleibt für die A48 der konfigurierte Umleitungsweg über die offene A3-Köln-Überleitung. Ein zusätzlicher Stau darf diese Zuordnung nicht durch eine kürzere, vor der Sperrung endende Umfahrung ersetzen. Jede Sperrung prüft ihre eigene gerichtete Erreichbarkeit; die gleichzeitige Sperrung Diez → Montabaur (Köln) darf keine fremden A48-Abfahrten beanspruchen. Höhr bleibt der Ausweichweg für bereits an Ransbach vorbeigefahrene Fahrzeuge beziehungsweise bei gesperrter Verbindung.
- Nicht eingezeichnete, zeitlich geschätzte Verbindungen durch das nachgeordnete Straßennetz; keine behauptete straßengenaue Navigation. Ältere wartende Umleitungsfahrzeuge an der Wiedereinfahrt werden vor neuen abgefertigt. Eine mehrstündige Verzögerung wird bei praktisch fehlendem Abfluss und Vollsperrung als nicht berechenbar angezeigt, anstatt aus Stillstand eine genaue Ankunftszeit zu extrapolieren.

## SPCK 0.10.8 – Zielgebundene Umleitungsströme und Auffahrtskapazität

- Umgeleitete Verkehrsgruppen aus Autobahnüberleitungen behalten ihre tatsächliche Zielabfahrt über alle folgenden Verzweigungen. Die kürzeste legale Verbindung im gerichteten Autobahnnetz wird nach Streckenlänge bestimmt. Für jede Zielabfahrt lassen sich zugewiesene, abgefahrene und noch im Netz befindliche Fahrzeuge separat bilanzieren. Die reguläre Durchfahrt in die offene Richtung bleibt erhalten (OD-Anteile sind Modellannahmen).
- Bei AD Dernbach → Montabaur gelangen A48-Fahrzeuge mit Frankfurt-Ziel über die offene Köln-Überleitung nach Ransbach-Baumbach. Bei Überlastung warten sie vor der Abfahrt, statt unterwegs auf andere Rampen verteilt zu werden. Lokale Frankfurt-Fahrten ab dem Abfahrtsknoten beginnen ihre Umfahrung direkt im nachgeordneten Netz.
- Normale Zufahrt und wiederkehrender Umleitungsverkehr teilen sich an jeder echten lokalen Auffahrt einen gemeinsamen Zulauf von modellierten 700 Kfz/h je Spur (max. zwei Spuren). Überschüssige Nachfrage wartet im lokalen Netz. Rückstau auf Auffahrten bleibt bei überlasteter Einfädelung auf die Autobahn möglich, aber nicht durch unbegrenzten Zustrom bei freier Strecke.

## SPCK 0.10.9 – Keine verfrühten Vollsperrungsumleitungen

- Bei einer Vollsperrung bleibt die letzte geeignete Abfahrt vor der Sperre das primäre Ziel. Frühere Abfahrten werden nur bei tatsächlich nahem Rückstau und einem sinnvollen Zeitgewinn zur freiwilligen Umfahrung genutzt.
- Ist die Weiterfahrt über eine offene Überleitung zur regulären Abfahrt noch möglich, wird die zuführende Autobahn nicht pauschal umgeleitet. Beispielsweise fährt die A48 bei Montabaur–Diez weiterhin zur AS Montabaur.
- Auch bei direkten Abfahrten bleibt das zugewiesene Ende der Rampe über alle Rampenzweige erhalten. Die lokale Abflussrate schwankt modelliert unterhalb der nominalen Kapazität; sie ist keine gemessene Ampelsteuerung oder Vorfahrtsregelung.

## SPCK 0.10.10 – Anschlussstellen mit Kreisverkehr

- Geschlossene lokale Rampenzyklen im Autobahnextrakt werden graphbasiert erkannt. Wenn eine echte Abfahrt ausschließlich in einen solchen Kreisverkehr ohne importierten öffentlichen Straßenabfluss führt, endet der modellierte Autobahnverkehr am realen Kreisverkehrszulauf. Es werden keine neuen Straßen und keine künstlichen Abfahrten erzeugt; Autobahnkreuze und -dreiecke bleiben davon unberührt.
- Damit bleibt auch eine Abfahrt mit ausgelassenem untergeordneten Straßennetz als letzte zulässige Umleitungsabfahrt nutzbar. Der Abfluss ist begrenzt und umgeleitete Fahrzeuge kehren erst hinter der Sperrung zurück. Regressionsfälle: Neustadt/Wied → Bad Honnef sowie ein unabhängiges A4-Testnetz.
- Fehlt ein eigenständiger Ortsstraßenausgang und führen sämtliche Rampenzweige ausschließlich zurück zu einer lokalen Auffahrt derselben Anschlussstelle, wird die Grenze zum untergeordneten Netz am realen Übergang erkannt. Prüfung aller 73 bezeichneten Abfahrten im mitgelieferten Netz sowie ein eigener A59-Wahn-Sperrungsfall.
