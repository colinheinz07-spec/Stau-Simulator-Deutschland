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

## SPCK 0.10.11 – Dynamische Verkehrsleistung und Routenwahl

- Nennkapazität (2.200 Kfz/h je Hauptfahrstreifen) bleibt eine Obergrenze. Dichte, konkurrierende Zuflüsse, Wiederanfahren und sehr niedrige Geschwindigkeiten verändern die tatsächliche Leistung und die Bewegung der Zellen. Die Detailansicht zeigt den aktuellen Modellwert und das nominelle Maximum separat. Die Faktoren sind noch nicht mit Messdaten kalibriert.
- Frühere Ausfahrten konkurrieren anhand der geschätzten Gesamtfahrzeit einschließlich Abfahrtsstau, späterem Ausstieg, Fahrt außerhalb des Autobahnnetzes und Rückkehrstau. Es gibt keinen festen Abstand zum Stauende mehr. Volle Sperrungen bleiben physisch unpassierbar; bei offenem, aber stark verzögertem Verkehr bleibt ein kleiner Anteil auf der ursprünglichen Route.
- Tatsächlich verbundene alternative Autobahnen werden anhand der Fahrzeit zum gleichen nachgelagerten Streckenabschnitt geprüft. Umleitungsgruppen behalten ihren Zielabschnitt; ihre Wege werden neu berechnet. Ist eine bisherige Route nicht mehr erreichbar, wird die Gruppe wieder zur legalen Routenwahl freigegeben. Zuführende Autobahnen erhalten graphbasierte Ausweichmöglichkeiten, ohne speziell auf Dernbach oder andere benannte Kreuze festgelegte Verbindungen.
- Lokale Fahrzeuge können schon vor der Auffahrt eine geschätzte günstigere Umfahrung wählen. Der Wiedereintritt hinter der Störung verwendet eine echte Auffahrt mit endlicher Kapazität; weitere zulässige Einfahrten können bei deutlich kürzerer erwarteter Fahrzeit berücksichtigt werden. Normale und umgeleitete Fahrzeuge teilen dieselben physischen Kapazitätsgrenzen. Landstraßen werden weiterhin nur über geschätzte externe Reisezeiten modelliert; vollständige individuelle Start-Ziel-Matrizen und mikroskopische Fahrstreifenwechsel sind noch nicht verfügbar.
- Der kompilierte OSM-Netzfluss übernimmt ebenfalls die dynamische Betriebsleistung; die erweiterte zeitabhängige Umleitungssteuerung ist zunächst im lokal getesteten SPCK-Modell integriert.

## SPCK 0.10.12 – Tatsächliche Rampenfahrstreifen und generische Abbiegenachfrage

- Feste Abbiegequoten am AD Dernbach entfernt. Autobahnüberleitungen werden im gerichteten Graph einheitlich von Ortsabfahrten unterschieden; die planmäßige Nachfrage nutzt eine allgemeine Modellannahme anhand der durchgängigen Fahrstreifen, keine ortsgebundene Umleitungsregel.
- Die vier Dernbacher Überleitungen besitzen ihre tatsächlich unterschiedlichen Fahrstreifenbreiten gemäß OSM (Abfrage 18.11.2026). A48 → Frankfurt: zweistreifig bis zum Übergang auf OSM-Way 75746365, anschließend einstreifig. Alle vorhandenen Geometriepunkte und Anschlussknoten bleiben erhalten. Vollsperrungen umfassen die verbundenen Rampenteile unabhängig von ihrer Breite.
- Gespeicherte Ereignisse auf den bisher zusammengefassten Rampen werden anhand ihrer bestehenden Position auf den entsprechenden Teilabschnitt übertragen.

## SPCK 0.10.13 – Richtungsgebundener Rückstau und tatsächliche Zeitvorteile

- Normale Abbieger behalten ihren gewählten Fahrweg auch bei mangelnder Aufnahmefähigkeit einer Rampe. Wartende Fahrzeuge werden nicht bei jedem Zeitschritt erneut nach Abbiegequoten aufgeteilt. Das gilt auch für den kompilierten Netzfluss.
- Im SPCK-Netz werden überlastete Abbiegearme und die durchgehende Fahrbahn im tatsächlichen gerichteten Zulauf zu einer Verzweigung getrennt bilanziert. Die jeweiligen Fahrzeuggruppen konkurrieren um endlichen Zellraum und Fahrstreifenleistung. Rückstau kann entlang verbundener Zellen anwachsen; eine freie Durchgangsrichtung erhält weiterhin Durchfluss. Die Karte und die Fahrzeitberechnung verwenden die Geschwindigkeit der durchgehenden Richtung statt des Stillstands der Abbieger. Die Aufteilung der nutzbaren Fahrstreifen ist eine Modellannahme anhand der vorhandenen Fahrstreifen, keine mikroskopische Spurführung.
- Autobahn-Umleitungen vergleichen Fahrzeiten zum gleichen nachgelagerten Abschnitt über die tatsächliche ursprüngliche, gerichtete Route. Ein fehlender Graphpfad zählt nicht als unendlicher Zeitverlust. Ein bereits hinter der Abzweigung liegender Rückstau allein löst keine Umleitung aus. Echte Sperrungen bleiben zwingende Hindernisse; optionale Umleitungen benötigen einen nachweisbaren Zeitvorteil.
- Neue Regression: Rückstau einer blockierten Überleitung wächst in ihrem Zulauf, ohne die freie Hauptrichtung auf diese Überleitung umzulenken. Bei Wiederöffnung bauen die gebundenen Fahrzeuge den Rückstau ab. Fahrzeugbilanz bleibt erhalten.

## SPCK 0.10.14 – Ausweichverkehr vor überlasteten Autobahnüberleitungen
- Die Umleitungsplanung erfasst nun nicht nur Staus auf einer Hauptfahrbahn, sondern auch Rückstaus auf tatsächlichen Autobahn-Überleitungsrampen ohne Vollsperrung.
- Endet eine Autobahn an einem AD/AK (beispielsweise A48→A3), wird die tatsächliche nachfolgende Autobahn als Ziel der Umleitung verwendet; die bisherige Suche nach einem Wiedereinstieg auf derselben endenden Autobahn entfällt.
- Die Routenwahl vergleicht die geschätzte Reisezeit zum **gleichen Ziel** über das verknüpfte Netz. Frühere Ausfahrten werden erst bei wirklichem Zeitvorteil gegenüber späteren Ausfahrten genutzt. Andere offene Zielrichtungen bleiben nutzbar.
- Allgemeine gerichtete Graphregeln statt benannter Dernbach-Korrekturen; realer A48→A3-Rampentest ohne Vollsperrung und synthetischer Autobahnende-Test sind Bestandteil der Regressionen.
- Limitation: Das SPCK-Modell verwendet weiterhin aggregierte Fahrzeuggruppen sowie geschätzte Nebenstraßenzeiten und keine vollständigen individuellen Start-Ziel-Routen.


## SPCK 0.10.15 – Verkehrsverlagerung aus der alten App auch vor Autobahn-Enden

- **Ursachenbehebung:** Bei gerichteten OSM-Verbindungen wurden bisher nur Zielkante und Gewicht gespeichert. Der Routenalgorithmus erwartete zusätzlich Abbiegeposition, Zielposition und Zellindizes. Dadurch scheiterte die Suche beim Übergang A48 → A3, obwohl die Autobahnen graphisch verbunden waren. Alle Endpunktverbindungen behalten jetzt die vollständigen Werte.
- **Allgemeine Weiterführung:** Hat eine Autobahn **nach einem Stau keine weitere Auffahrt auf dieselbe Autobahn**, wird das reale gerichtete Netz über die Autobahnüberleitungen verfolgt. Die Umleitung kann dadurch auf eine nachfolgende Autobahn zurückkehren, ohne eine imaginäre Auffahrt auf der beendeten Autobahn zu erfinden.
- **Ereignisunabhängig:** Dies gilt auch bei hohem Zeitverlust durch Unfall und Stau ohne offizielle Vollsperrung. Früheres Abfahren wird anhand des Zeitgewinns bewertet; der Rückstau reduziert sich durch den tatsächlichen Abfluss und nicht durch ein reines Kartensymbol.
- **Verifikation:** Neuer synthetischer Regressionstest: A48-artiger Zulauf mit zwei Ausfahrten, angeschlossenem A3-Ziel und einem schweren Unfall vor dem Autobahndreieck. Er prüft, dass beide Ausfahrten tatsächlich Fahrzeuge zugewiesen bekommen und die Bilanz aufgeht. Vor dieser Korrektur lieferte dasselbe Netz auch nach 180 Minuten Stauzeitverlust **keinen** Umleitungsplan. Ohne Unfall darf die Teststrecke keine künstliche Umleitung haben.
- Die physikalischen Fahrzeuggruppen und geschätzten Umfahrungszeiten bleiben vereinfachte Modellannahmen; das alte und das neue Netzmodell sind technisch nicht identisch. Die Richtungswahl muss bei der späteren deutschlandweiten OD-Nachfrage weiter verfeinert werden.


## Version 0.10.16 – Deutschlandweite progressive Umleitung und kumulierte Zeitverluste

- **Einheitliche Entscheidungsfunktion:** Ab rund 30–45 Minuten beobachtetem Zeitverlust beginnen Fahrer freiwillig auszuweichen, sobald die Alternativroute nach ihren Zusatzkosten tatsächlich günstiger ist. Selbst bei kleinen Netto-Zeitgewinnen von 10–30 Minuten weicht nur eine Minderheit aus. Bei 60 Minuten **Netto-Zeitgewinn** beträgt die gewünschte Modellquote ca. 12 %, bei 90 Minuten ca. 45 %, bei 120 Minuten ca. 80 %, bei 150 Minuten ca. 90 %, bei 180 Minuten ca. 96,5 % und bei 240 Minuten ca. 99 % der **betroffenen** Zielgruppe. Eine positive Kostenersparnis ist Voraussetzung; die Werte sind keine pauschalen Quoten für alle vorbeifahrenden Fahrzeuge.
- **Wege über mehrere Autobahnen:** die Stauverzögerung wird auf gerichteten Netzpfaden einschließlich Überleitungsrampen und nachfolgender Autobahnen betrachtet. Ein Unfall auf A3 nach dem Autobahndreieck beeinflusst daher auch die vorausschauende A48-Routenwahl.
- **Alternative Autobahnrichtung:** bei einem nicht passierbaren bzw. massiv verlangsamten Arm können Fahrzeuge des **betroffenen Ziels** einen anderen offenen, real angeschlossenen Autobahnarm nehmen, an einer echten Ausfahrt das Netz verlassen und hinter der Störung wieder auf ihre Zielautobahn auffahren. Normaler Verkehr mit anderem Ziel bleibt im offenen Arm. Das gilt für Unfälle und Vollsperrungen.
- **Physische Grenzen bleiben:** Ausfahrten und Ortsstraßen sind keine unbegrenzten Abflusskanäle. Übersteigt die umgeleitete Nachfrage deren Durchlass, verlagert sich der Rückstau an die Ausfahrt. Bestehende Staus lösen sich nur durch tatsächliche Fahrzeugbewegungen auf.
- **Sicherung:** neue regressionsfeste Tests für die 30–240-Minuten-Kurve und reale A48→A3-Routen über die Köln-Verbindung bei Unfall bzw. Sperrung; ergänzt um bestehende Tests für Rampen, freie Verkehrsführung, Kapazitäten, Fahrzeugbilanz und Stauabbau.
- **Grenze:** Die Fahrzeugnachfrage ist weiterhin aggregiert, ohne individuelle Start-Ziel-Matrix. Lokale Umleitungsstraßen sind zeitlich geschätzt, nicht vollständig als lokales Straßennetz modelliert. Die genauen 80–99-%-Anteile sind gewünschte Simulatorannahmen, keine empirischen BASt-Messwerte.

## Version 0.10.18 – Stufenlose bundesweite Umleitungsbereitschaft

- Die freiwillige Umleitungsbereitschaft steigt kontinuierlich mit der beobachteten Verzögerung: 45 min 2 %, 60 min 15 %, 88 min 43 %, 120 min 75 %, 180 min 98 %, 240 min 100 %. Die Quote betrifft den betroffenen Durchgangsverkehr, zusätzlich zu normalen Abfahrten. Sie ist eine Modellannahme und wird nicht durch die Empfangskapazität der Abfahrt gekappt.
- Die Regel berücksichtigt die tatsächliche Autobahnverzögerung auch dann, wenn die geschätzte Umleitungsfahrt selbst lange dauert. Wenn keine Wiederauffahrt im Kartenausschnitt bekannt ist, können Fahrzeuge trotzdem über eine echte öffentliche Abfahrt das Netz verlassen.
- Lokale Zuflüsse, die hinter der Abfahrt direkt in den weiterhin gestörten Abschnitt führen, wählen anteilig bereits außerhalb der Autobahn eine Umleitung. Ein sekundärer Rückstau vor dem ursprünglichen Ereignis erzeugt keine künstliche Wiederauffahrt vor diesem Ereignis.
- Die physikalische Ausfahrtkapazität und Fahrzeugbilanz bleiben erhalten: Ist die Abfahrt voll, warten Fahrzeuge vor dem Abzweig, statt geradeaus in den Stau zu fahren. Bei nachlassender Verzögerung ist die normale Weiterfahrt wieder möglich.
- Vollsperrungen behalten unabhängig von der Verzögerung die letzte rechtlich erreichbare Abfahrt als zwingenden Ausweg. Bei wachsenden Staus greifen frühere erreichbare Abfahrten.

## Version 0.10.19 – Letzte freie Abfahrt vor dem Rückstau

- Bei Vollsperrungen wird die Umleitungsbereitschaft erst an der letzten real erreichbaren Abfahrt vor dem tatsächlichen Rückstau angewendet. Solange eine spätere Anschlussstelle staufrei erreichbar ist, behalten frühere Ausfahrten ihren regulären Verkehrsanteil.
- Wächst der sperrungsbedingte Rückstau über eine weitere Anschlussstelle hinaus, verschiebt sich die Umleitung entsprechend nach stromaufwärts. Unabhängige Staus auf derselben Autobahn lösen keine verfrühte Umleitung für diese Sperrung aus. Die physikalischen Rampenkapazitäten und die 45–240-Minuten-Kurve bleiben unverändert.

## Version 0.10.20 – Schrittweise Ausleitung je Anschlussstelle

- Für Unfälle, Baustellen, Staus und Vollsperrungen gilt die Ausweichkurve ab 45 Minuten. Bei einer früheren AS ist ausschließlich die zusätzliche Fahrzeit bis zur nächsten realen AS maßgeblich, gedeckelt durch den beobachteten Zeitverlust bis zum Ereignis. Eine einzelne sehr lange Verzögerung wird nicht gleichzeitig an alle vorherigen AS übertragen.
- Bei Autobahndreiecken und -kreuzen bleiben die letzten lokalen Ausfahrten auf den jeweiligen Zufahrtsautobahnen sowie verfügbare Überleitungen zu realen Ausweich-AS für den betroffenen Zielverkehr nutzbar. Eine offene Überleitung kann auch dann zunehmend genutzt werden, wenn eine formal noch mögliche spätere Abfahrt auf dem betroffenen Arm selbst mindestens 45 Minuten Zeitverlust verursacht.
- Bereits zwischen zwei Ausfahrten befindlicher Verkehr kann weiterhin die nächstgelegene geeignete Abfahrt nutzen. Physikalische Empfangskapazität und normale Abfahrtsanteile bleiben erhalten; keine künstlichen Ausleitungsgrenzen und keine erfundenen Wiederauffahrten.

## Version 0.10.21 – Keine Zielfahrten in geschlossene Rampenkreisläufe

- Die Netzprüfung entfernt Zielfahrbeziehungen in geschlossene Rampengruppen ohne gerichteten Weg zu einer Autobahn oder einer offenen Netzgrenze. Die Kartengeometrie bleibt erhalten; reguläre AS-Abfahrten und vorhandene, offene Überleitungen bleiben befahrbar. Damit kann der isolierte Rampenkreislauf am AK Bonn-Ost nicht mehr die A59 und nachfolgend A565 und A3 blockieren.
- Die freiwillige Ausweichkurve bleibt bis 90 Minuten gleich. Bei 120 Minuten beträgt sie 65 %, bei 150 Minuten 80 %, bei 180 Minuten 90 % und bei 240 Minuten weiterhin 100 %. Eine physisch unbefahrbare Strecke erfordert unabhängig davon die letzte legale Ausfahrt.

## Version 0.10.22 – Kalibrierte Randzuflüsse und flüssigere mobile Karte

- Beginnt eine Autobahn im Modell an einer vorhandenen Überleitung aus einer anderen Autobahn, entsteht dort kein zusätzlicher Randzufluss. Fünf doppelte Einspeisungen im Bestandsnetz entfallen; echte örtliche Auffahrten und externe Netzgrenzen bleiben erhalten. Die angenommenen Spitzenzuflüsse aus dem Raum Bonn (A59 Südgrenze, A560 West, A562 Ost und A565 Nord) sind außerdem moderater kalibriert. Es handelt sich nicht um gemessene Zählstellendaten.
- Bei freiwilligen Umleitungen gelten 45 min 2 %, 60 min 15 %, 90 min 40 %, 120 min 58 %, 150 min 73 %, 180 min 85 % und 240 min 100 %. Eine Vollsperrung bleibt zwingend; überlastete Rampen erzeugen physikalischen Rückstau, auch bei der Überleitung von der A48 nach Ransbach auf die A3 Richtung Köln.
- Die Stauliste bezeichnet eine zusammenhängende Schlange nach ihrer streckengewichteten Durchschnittsgeschwindigkeit. Die Kartenfarbe bleibt lokal je Zelle dynamisch, und die Detailansicht zeigt die Geschwindigkeit an der ausgewählten Position. Die SPCK-Canvas-Simulation verteilt die 12 Fünfsekundenschritte auf kurze Browser-Aufgaben, ohne überlappende Minuten; Pause und Hintergrundwechsel brechen ausstehende Aufgaben ab.

## Version 0.10.23 – Gerichtete Umleitungen ohne Autobahn-Wendeschleifen

- Eine Autobahnalternative muss einen tatsächlichen Zeitvorteil haben und erst hinter dem Hindernis auf der ursprünglichen Fahrbahn wieder einfädeln. Ein Wechsel auf die Gegenfahrbahn eines bereits befahrenen Autobahnkorridors ist keine Umleitung. Bereits zugewiesene Fahrzeuge bleiben auf dem legalen direkten Weg zu ihrer Abfahrt, statt wegen Stau auf derselben Route neue Schleifen zu fahren.
- Die Entscheidung für frühere Anschlussstellen berücksichtigt den Zeitverlust bis zur nächsten erreichbaren Abfahrt auf dem normalen Zielweg, auch über einen Autobahnwechsel hinweg. Fahrzeuge auf einer auslaufenden Zubringerautobahn werden daher nicht allein wegen ferner Staus vorzeitig auf Ortsstraßen geschickt.
- Am tatsächlich überlasteten Abzweig können wartende Fahrzeuge ihre bisherige Durchfahrtsentscheidung schrittweise zugunsten der Umleitung ändern. Die Abfahrtsrampe nimmt weiterhin nur die physikalisch mögliche Menge auf; Rückstau wird nicht gelöscht. Die freiwillige Abfahrtskurve bleibt unverändert.

## Version 0.10.24 – Durchgängige Anschlussstellen und absolute Zufahrtssperren

- Tatsächlich verbundene lokale Zufahrten werden am Beginn ihrer gerichteten Rampenkette gespeist, auch wenn OSM nur einen Rampenzweig bezeichnet. Mehrere Zweige derselben Anschlussstelle und Richtung teilen ein Nachfrageprofil; Autobahnkreuze sind keine zusätzlichen Verkehrsquellen. Lokale Einfahrten folgen ihrer legalen Fahrtrichtung und nicht einem benachbarten Abfahrtszweig.
- Umleitungsverkehr nutzt alle legalen Abfahrtszweige derselben Anschlussstelle, etwa die drei B255-Rampenäste in Montabaur. Ihre gemeinsame endliche Abflusskapazität erzeugt bei Überlastung realen Rückstau. Neu erschlossene Zuflüsse ersetzen einen Teil der bisherigen aggregierten Randnachfrage, wobei A3/A48 ihren Fernverkehrsanteil behalten. Reine Überlastung löst die gestaffelte Abfahrt an Anschlussstellen aus; weiträumige Autobahnalternativen erfordern ein tatsächliches Ereignis.
- Eine Vollsperrung sperrt auch Abzweige hinter ihrer Zufahrtsgrenze in derselben Modellzelle. Beim Simulationsstart bereits gesperrte Abschnitte werden nicht mit Fahrzeugen befüllt; nur tatsächlich vorher vorhandener Verkehr kann den gesperrten Korridor räumen, soweit keine separate physische Blockade vorliegt.

## Version 0.10.25 – Spätere, zurückhaltende Umleitungen

- Freiwillige Abfahrtsbereitschaft des betroffenen Durchgangsverkehrs: unter 60 Minuten 0 %, ab 60 Minuten 2 %, 90 Minuten 15 %, 120 Minuten 32 %, 180 Minuten 55 %, 240 Minuten 70 %, 360 Minuten 82 %, ab 480 Minuten 90 %. Normale lokale Abfahrten und zwingende Zufahrtssperren sind davon unabhängig.
- Die letzte nutzbare Abfahrt kann auf einer offenen Überleitung zu einer anderen Autobahn liegen. Für A48 → A3 Frankfurt bei gesperrtem Frankfurt-Arm führt die primäre Umleitung über den offenen Köln-Arm zur AS Ransbach-Baumbach. Eine frühere Abfahrt bei Höhr-Grenzhausen wird erst mit mindestens 60 Minuten tatsächlicher Zusatzfahrzeit bis zur nächsten erreichbaren Abfahrt freiwillig attraktiv. Es gibt keinen Zwangsabfahrts-Fallback, solange diese Überleitung offen ist. Dieselbe gerichtete Prüfung gilt an anderen Autobahnkreuzen und -dreiecken.
- In Mehrfachsperrungen haben explizite Sperrungsrouten Vorrang vor sekundären Stauplänen. Die letzte legale Abfahrt vor einer echten Vollsperrung bleibt zwingend; 90 % ist keine Erlaubnis, eine Sperre zu durchfahren.

## Version 0.10.26 – Anschlussstellenkapazität und A48

- Große AS erhalten individuelle Modellannahmen für die Tageskapazität je Fahrstreifen: Montabaur 1.050 Kfz/h Abfahrt / 1.000 Auffahrt, Limburg-Nord 1.100 / 1.050, Koblenz-Nord 1.150 / 1.050 und Bendorf/Neuwied 1.000 / 950. Gemeinsame Rampenäste teilen weiterhin die physische Kapazität.
- Ab 19 Uhr steigt die verfügbare Abflusskapazität fließend auf bis zu 135 %, die Zuflusskapazität auf bis zu 118 %; ab 4 Uhr sinkt sie wieder auf Tagesniveau um 6 Uhr. Physische Rampenkapazität bleibt die Obergrenze. Die Werte sind Simulationsannahmen, keine Verkehrszählungen.
- Die A61-Zubringer am AK Koblenz nutzen modellierte Anteile der bestehenden A48-Randnachfrage. Bei einer Sperrung können sie außerhalb des Kartennetzes zur ersten offenen A48-Auffahrt ausweichen. Richtung A61 ist eine Umleitung bis zur Netzgrenze möglich; ohne vollständige A61-Geometrie wird dort keine fiktive Auffahrt gezeichnet.

## Version 0.10.27 – Abfahren im Rückstau und großräumige Umfahrung

- Deutschlandweite Regel: Sobald ein Rückstau den Abzweig einer offenen AS erreicht, zählt der verbleibende Zeitverlust bis zum Hindernis. Die AS bleibt auch nach dem Weiterwandern des Stauendes aktiv; bereits wartende Fahrzeuge können ihre Entscheidung ändern. Vor dem Stau gilt weiterhin die zurückhaltende Regel anhand der nächsten erreichbaren Abfahrt.
- Fernverkehr entscheidet sich bei extremen Verzögerungen zunehmend schon an den Zuflüssen für einen großräumigen, tatsächlich günstigeren Korridor. Die modellierte Bereitschaft steigt ab drei Stunden von 8 % auf bis zu 90 % bei zehn Stunden (jeweils nur beim anteiligen Fernverkehr, nicht der gesamten Nachfrage). Kapazität, Fahrzeit und Wartezeit an der Wiedereinfahrt begrenzen die Wahl.
- Für die A3 sind zwei richtungskorrekte A61-Korridore hinterlegt. Richtung Köln erfolgt die Rückkehr über die A4, Richtung Frankfurt über den Bereich Wiesbaden/Niedernhausen. Die A61 außerhalb des Ausschnitts bleibt eine geschätzte Fahrt mit reservierter Restkapazität, bis die vollständigen OSM-Straßen importiert werden. Alle Fahrzeuge werden während der Umfahrung bilanziert und können nur hinter dem Hindernis in das offene, gerichtete Netz zurückkehren.

## Version 0.10.28 – Staulänge, Bremswellen und klare Sperrungsanzeige

- Die freiwillige Ausweichbereitschaft berücksichtigt neben dem Zeitverlust die tatsächliche Länge einer vorausliegenden Staugruppe: 3 km 2 %, 5 km 7 %, 10 km 22 %, 20 km 45 % und ab 30 km 65 %. Der höhere der beiden Modellanteile gilt für den betroffenen Durchgangsverkehr. Kurze fließende Lücken bis 500 m trennen eine Stop-and-go-Gruppe nicht; es werden nur wirklich verlangsamte Meter gezählt. Eine spätere staufrei erreichbare AS hat Vorrang. Es gibt keine künstliche Begrenzung der physischen Staulänge.
- Ein kleiner Rückstau an einer Ausfahrt darf die weiter vorne liegende, wesentlich längere Staugruppe nicht aus der Routenentscheidung verdrängen. Abfahrten im bereits entstandenen Rückstau bleiben offen und kapazitätsbegrenzt.
- Verzögerte Brems- und Anfahrreaktionen verändern die reale Zellkapazität zustandsabhängig (max. 7 % zusätzliche Headway-Reduktion; Erholung mit 45 Sekunden Zeitkonstante). Bremswellen und Stauabbau ergeben sich aus Fahrzeugbewegungen und verfügbarem Platz, nicht aus zufälligen Kartenfarben.
- Staufarben und Stauwerte zählen ausschließlich befahrbare Teilintervalle; eingeschlossene Fahrzeuge bleiben im Bestand. Sehr kurze Rückstaus an Sperrsymbolen bleiben in der Verkehrsliste, ohne die mobile Karte mit zusätzlichen Labels zu verdecken.


## Version 0.10.30 – Dauerhafte Fahrstreifen statt Baustellenquerschnitt

- Die reguläre Anzahl der durchgehenden Fahrstreifen ist eine Netzeigenschaft. Eine Baustelle oder Sperrung verändert ausschließlich die verfügbaren Fahrstreifen und die jeweilige Betriebskapazität, niemals die Grundzahl.
- Auf 16 belegten A3-Ways zwischen Siebengebirge und Kreuz Bonn/Siegburg wird der temporäre zweistreifige Bestand auf die regulären drei Fahrstreifen zurückgeführt. Auf 39 belegten Ways der A3/A4 ab der gemeinsamen Hauptfahrbahn am AD Heumar bis zur nördlichen Netzgrenze hinter AK Köln-Ost gelten vier Fahrstreifen je Richtung. Die getrennten Verbindungsrampen bleiben unverändert.
- Nachweise: [Autobahn GmbH, Bauabschnitt IV](https://www.autobahn.de/planen-bauen/projekt/bauabschnitt-iv-grundhafte-erneuerung-zwischen-koeln-heumar-und-bad-honnef); [Autobahn GmbH, Ausbau A3 Richtung Leverkusen](https://www.autobahn.de/planen-bauen/projekt/a-bei-lev-ausbau-der-a1-und-a3-in-leverkusen); [DEGES, Umbau Heumar](https://www.deges.de/projekte/projekt/a-3-a-4-a-59-umbau-des-autobahndreieck-heumar/). Die konkreten Korrekturen sind über vorhandene OSM-Way-IDs in Offline-Modell und OSM-Importer dokumentiert; bei aktualisiertem dauerhaftem Ausbau erneut prüfen.

## Version 0.10.31 – Rheinland-Netz Bonn–Ahr–Koblenz (SPCK)

- A565 bis Gelsdorf/B257, A61 zwischen AK Meckenheim und AK Koblenz inklusive kurzer Anschlussstücke, A571 bis Ehlingen/B266 und A573 bis Bad Neuenahr/B266. Originale OSM-Relations- und Anschlussstellengeometrien vom 22.11.2026; keine frei gezeichneten Verbindungen. Die A48 am AK Koblenz ist durchgebunden. Die vorhandenen A565-Nordabschnitt-IDs bleiben erhalten.
- Normale OSM-Hauptfahrbahnspuren, separate Ein-/Ausfädelspuren und Rampenspuren; ein Baustellenereignis ändert nicht die Grundkapazität. Nominal 2.200 Kfz/h je durchgehendem Fahrstreifen, 1.500 je Rampenfahrstreifen; nachgeordnete AS-Kapazitäten begrenzen die tatsächliche Abfertigung.
- Zeitabhängige Modellnachfrage, richtungsbezogene A61-Durchgangsverkehre und lokale AS-Profile. Modell-Spitzenwerte der A61: 3.300 Kfz/h nordwärts und 3.200 südwärts an den Netzgrenzen; A571/A573 geringere Zubringerwerte. Dies sind keine gemessenen Stundenwerte. Lokale Straßen bleiben außerhalb des detaillierten Autobahn-Zellnetzes; Umleitungsfahrzeiten und lokale Kapazitäten werden geschätzt. Jetzt können reale Autobahntransfers auch auf dem hinzugefügten Netz umfahren werden, statt an der alten A61-Netzgrenze zu verschwinden.

## Version 0.10.32 – Rollender Stau und A3 bis Leverkusen

- A3 ab AK Köln-Ost über AS Köln-Dellbrück, AS Köln-Mülheim und AS Leverkusen-Zentrum bis AK Leverkusen inklusive der realen A1-Verbindungsrampen und kurzer A1-Anschlussstücke. Die Netzgrenze liegt nördlich des Kreuzes, nicht erst an der nächsten Anschlussstelle. Originale OSM-Ways und Anschlussstellengeometrien; durchgehende vier Fahrstreifen je Richtung bis Leverkusen-Zentrum, anschließend drei gemäß dauerhaftem Querschnitt (siehe [Autobahn GmbH](https://www.autobahn.de/planen-bauen/projekt/a-bei-lev-ausbau-der-a1-und-a3-in-leverkusen)). Lokale Nachfrageprofile sind Modellwerte, keine gemessenen Stundenwerte.
- Fahrzeuggewichtete, aus Zellbewegungen abgeleitete Geschwindigkeit mit 60 Sekunden Zeitkonstante; kurze Bremsphasen werden nicht als dauerhafter Stillstand hochgerechnet. Kapazitätsverlust und Rückstauwelle moderater kalibriert, ohne Mindestabfluss für gesperrte Streifen oder künstliche Mindestgeschwindigkeit. Die Zeitverlustberechnung verwendet diese tatsächliche Modellgeschwindigkeit. Bei sehr langen Wartezeiten ohne Abfluss an einer Vollsperrung wird keine scheinpräzise Reisezeit angezeigt.

## Version 0.10.37 – Ortsbezogene Staurichtungen

- Gemeinsame Zielortauflösung für alle 14 vorhandenen Autobahnnummern (inklusive getrennter A59-Korridore): geordnete Straßenlandmarken und tatsächliche Fahrtrichtung auf verbundenen OSM-Ways statt starrer Verkehrsprofilnamen. Beim Überfahren eines Zielort-Ankers wechselt das Ziel automatisch, etwa A61 vor AK Koblenz → Koblenz und dahinter → Rheinböllen. Kartenlabels und Stauliste verwenden dieselbe Auflösung. Die Ziele sind modellierte regionale Navigationsziele, keine Behauptung zum exakten Wortlaut der Schilder. Verkehrsnachfrage, Kapazität und Umleitungen bleiben unverändert.

## Version 0.10.36 – Abfahrten bei langen Staus

- Ab 60 Minuten verbleibender Verzögerung auf der betroffenen Richtungsfahrbahn können Fahrer bereits an der letzten freien Anschlussstelle vor dem Stau und an weiteren Anschlussstellen im Stau abfahren. Die kurze Fahrt zur nächsten AS muss nicht selbst eine Stunde dauern. Freie, weiter entfernte Ausfahrten und nicht betroffene Autobahnrichtungen behalten ihre normale Verkehrsaufteilung. Außerhalb des Netzes werden keine Rückkehranschlüsse erfunden.
- Ortsbezogene Richtungsanzeige: A3 nordwärts ab Köln-Ost Richtung Düsseldorf im Bereich Leverkusen; die bisherigen richtungsbezogenen Verkehrsprofile bleiben unverändert.

## Version 0.10.35 – Abfahrtsrückstaus und normale Durchfahrt

- Normale Abfahrtsziele und Durchgangsverkehr bleiben getrennt. Eine bloß vorbereitete Umleitung oder entfernte Sperrung deaktiviert die Fahrstreifentrennung nicht mehr; ein später erreichbares, offenes Autobahndreieck zählt als reale Ausweichmöglichkeit. An derselben Verzweigung wird eine Umleitung nicht doppelt auf den Verkehr angewandt.
- Zusätzliche freiwillige Abfahrtsentscheidungen werden als eigene Wartemenge geführt, solange die Fahrzeuge noch auf der Hauptfahrbahn sind. Bei entfallendem Umleitungsgrund wechseln sie zurück zur legalen Originalroute; auf der Rampe befindliche Fahrzeuge fahren weiter. Die Fahrzeugbilanz bleibt unverändert.
- Wartezeit an Rampen wird in Kartenbeschriftungen als Abfahrt, Auffahrt oder Überleitung gekennzeichnet; ein Ausfahrtsrückstau wird nicht als ununterscheidbarer allgemeiner Autobahnstau bezeichnet. Echte Sperrgrenzen und normale Durchfahrt bleiben physisch wirksam.

## Version 0.10.34 – Dynamische Umleitungsentscheidungen und Stauabfluss

- Netzweit keine neuen freiwilligen Umleitungsentscheidungen unter 60 Minuten beobachtetem Zeitverlust am eigentlichen Engpass. Staulänge verstärkt erst oberhalb der Schwelle die Bereitschaft; eine erreichbare spätere Abfahrt und die Kosten der alternativen Route werden berücksichtigt. Großräumige Alternativen bleiben eine Minderheitsentscheidung. Die letzte legale Ausfahrt vor einer Vollsperrung bleibt zwingend.
- Zeitverlust am zusammenhängenden Hauptstau getrennt von ausgelösten Abfahrts- und Rückstaus. Bereits umgeleitete Fahrzeuge bleiben in der konservierten Fahrzeuginventur und fahren ihren Rückweg weiter, auch wenn keine neuen Umleitungen mehr gewählt werden. Kein künstliches Löschen eines Sekundärstaus und keine Zwangsumleitung bei frei werdendem Hauptfahrweg.
- Variable Abflusshäufigkeit durch unterschiedliche Fahrzeuggruppen und verzögertes Wiederanfahren; tatsächliche Zellbewegungen bestimmen Geschwindigkeit, Farben und Zeitverlust. Der Fahrzeuggruppen-Faktor entwickelt sich ausschließlich mit realem Abfluss; bei Stillstand bleibt er stehen. 30-Sekunden-Glättung der gemessenen Bewegung, unveränderte physische Sperrgates. Modellparameter sind Annahmen und keine einzeln gemessenen Pkw-/Lkw-Trajektorien.

## Version 0.10.33 – Kölner Ring und mobile Performance

- A1 zwischen AK Köln-West und AK Leverkusen vollständig in beiden Richtungen, inklusive Köln-Lövenich, Köln-Bocklemünd, AK Köln-Nord, Köln-Niehl und AK Leverkusen-West. A57 von Köln-Chorweiler über AK Köln-Nord/Longerich bis Köln-Bickendorf mit kurzen Randstücken und realen Überleitungsrampen; auch das A59-Anschlussstück am AK Leverkusen-West ist verbunden. Originale OSM-Ways, keine geografisch angenäherten Verbindungen.
- Dauerhafte Querschnitte statt Baustellen- oder Zukunftsquerschnitte: überwiegend drei durchgehende A1-Spuren, am alten Kreuz Köln-Nord bestehende zweistreifige Durchfahrt; A57 nördlich des Kreuzes zwei je Richtung, südlich je nach tatsächlicher Richtungsfahrbahn zwei/drei. Der geplante Ausbau am [AK Köln-Nord](https://www.autobahn.de/planen-bauen/projekt/umbau-des-autobahnkreuzes-koeln-nord) und die künftige achtstreifige [Rheinbrücke](https://www.autobahn.de/planen-bauen/projekt/a-bei-lev-rheinbruecke-leverkusen) werden nicht vorweggenommen. Separate lokale Nachfrageprofile mit geschätzten Spitzen-Randzuflüssen (A1 3.900/4.000, A57 2.600/3.200 Kfz/h); keine gemessenen Stundenwerte.
- Wiederverwendete Transferpuffer, numerische Zellschlüssel, minütlich gecachte Nachfrageprofile und ein direkter Rechenpfad für unverzweigte Zellen. Die gleiche simultane Flusszuteilung und Fahrzeugbilanz bleiben bestehen. Canvas verwendet einen Verkehrssnapshot pro Modellaktualisierung. Beim Ziehen/Zoomen bekommt das Kartenrendering Vorrang; der laufende Physikbatch setzt danach ohne verlorene Modellschritte fort. Warmstart und Minutentakte sind getrennte kurze Browser-Aufgaben. Der Kartenausschnitt enthält nun auch den nördlichen Kölner Ring.
