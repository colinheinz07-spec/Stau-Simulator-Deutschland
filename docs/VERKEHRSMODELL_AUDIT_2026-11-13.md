# Verkehrsmodell 0.6 – verbindlicher Befund und Abnahmekriterien

Stand: 13.11.2026. Für dieses Projekt gelten **bundesweite, nicht streckenspezifische** Regeln. Der lokale SPCK-Modus und die vollständig veröffentlichte Import-Karte haben aktuell **verschiedene** Engines. Keine der beiden darf als kalibrierte Echtzeit-Verkehrsprognose ausgegeben werden.

## Festgestellte Ursachen in der lokalen SPCK-Karte

1. **Verlorene Fahrbeziehungen:** Der alte SPCK-Zellfluss verband OSM-Ways nur Endpunkt→Anfangspunkt. Viele Abfahrten beginnen und Auffahrten enden an **inneren Punkten** eines längeren OSM-Ways. Dadurch waren trotz sichtbarer Straßen nur **825 von 1.929** Geometrien aus den 13 damals gewählten Modellquellen erreichbar. Die überarbeitete Modelltopologie erreicht nach Hinzufügen gemeinsamer Originalgeometrie-Knoten **1.676 von 1.929** Fahrwegen. Dies ist rechnerische Erreichbarkeit, keine Validierung aller Fahrtrichtungen und Ziele.

2. **Unplausible Abzweiganteile:** Bei einer Hauptfahrbahn (Gewicht 6) und einer Rampe (Gewicht 2) wurden **25 % des Verkehrs** pauschal auf die Abfahrt geschickt – auch bei kleinen Anschlussstellen. Dies verdünnte den Durchgangsverkehr im Verlauf der Autobahn erheblich. Neu: Gewicht 20 versus 1,5 für die normale Abzweigung (~7 % bei einer Rampe). Bei Autobahnkreuzen und realen Abbiegerelationen fehlen noch getrennte OD-Anteile; diese Annahme ersetzt keine Zählung.

3. **Fehlende örtliche Rampennachfrage:** Nur wenige geometrische Netzgrenzen speisten Verkehr ein. Neu werden an gerichteten Rampen ohne modellierten Vorgänger **angenommene** externe Zuflüsse zugelassen, wenn die Rampe einen echten gemeinsamen OSM-Verbindungspunkt zum Netz hat. ACHTUNG: Der Legacy-Datensatz enthält fragmentierte Rampenketten. Solche Quellen sind noch **nicht gegen lokale Verkehrszählungen oder vollständig importierte Netze validiert**. Ihre Einspeisung kann ein Grund für übertriebene städtische Modellstaus sein.

4. **Zu optimistische Unfallrestkapazität:** Eine einzelne offene Spur wurde vorher bis zu 2.200 Kfz/h angesetzt, ohne den zusätzlichen Einfädel- und Bremsverlust. Das neue Prototypmodell reduziert diesen Wert bei einem Unfall auf rund **1.518 Kfz/h** (Faktor 0,69) und unterscheidet Unfall, Baustelle und Panne. Diese Faktoren sind **Modellannahmen**. Sie müssen an Auswertungen realer Arbeitsstellen und Störfälle kalibriert werden.

5. **Keine Uhrzeit im Verkehrsaufkommen:** Die lokale Startzeit betraf bislang nur Ereignispläne, nicht die Nachfrage. Jetzt gibt es ein nachvollziehbares Stunden- und Wochentagsprofil. Freitag-Nachmittagsverkehr und Sonntagnacht erhalten unterschiedliche Verkehrsmengen; Basiswerte sind noch nicht BASt-kalibriert.

6. **Unzuverlässige Visualisierung:** Die später gezeichneten grünen Rampen verdeckten teilweise rote Hauptfahrbahn-Abschnitte. Jetzt werden zuerst alle Grundfahrbahnen, danach alle Geschwindigkeitsbänder und zuletzt die rot-weißen Sperrungen gezeichnet. Ereignisse haben getrennte klickbare Symbole. Straßen ohne Modellzufluss haben dieselbe grüne Kartengrundfarbe wie alle anderen real vorhandenen OSM-Fahrbahnen. Der Zuflussstatus ist ausschließlich in Diagnosewerten ersichtlich; nur tatsächliche Geschwindigkeitsrückgänge und Sperrüberlagerungen verändern die Farbe.

7. **Fehlende Reaktion bei angehaltener Simulation:** Ein nachträglich gespeichertes Ereignis konnte sichtbar markiert sein, während der Simulations-Zeitgeber angehalten war. Ein aktives Ereignis setzt nun die Simulation fort, ohne die bisherigen Fahrzeuge zu löschen. Kurzzeitige iOS-/SPCK-Sichtbarkeitswechsel sollen den Benutzerzustand nicht mehr auf „Pause“ setzen.

## Ergänzungen nach erneuter Nutzerprüfung am 13.11.2026

- **Kapazitätsentscheidung: 2.200 Kfz/h je Hauptfahrstreifen** (nicht 2.600). Die importerbasierte Standardkapazität und der lokale SPCK-Adapter wurden einheitlich zurückgestellt; Rampenbasis 1.500 Kfz/h.
- Aus der alten App sind die tages-, freitags- und richtungsabhängigen Spitzenstundenprofile, A3/A48-Referenzen, AS-Einfahrtsanteile und regionale Kurven in `web/traffic-reference.js` übernommen. Feiertage (beweglich nach Ostern) sowie die für 2026/27 veröffentlichten KMK-Ferienfenster RLP/NRW/Hessen beeinflussen die Prognose; Verkehrsreaktionen auf Ferien sind Annahmen.
- **Netzrandproblem:** Pauschale Einspeisung an 188 OSM-Quellen hat NRW-Teilstrecken ohne echte durchgehende Hauptfahrbahn überlastet. Jetzt nur 18 nachgewiesene Autobahn- und benannte AS-Quellen; bei einer fehlenden zusammenhängenden Hauptfahrbahn wird die angenommene externe Spitzenlast NICHT eingespeist.
- **Vollsperrung:** Der Editor bestimmt verbindlich die vorherige und die nächste AS/AK auf derselben gerichteten Hauptfahrbahn und sperrt das gesamte dazwischenliegende Fahrwegintervall, auch über viele OSM-Ways. Persistierte 200-m-Vollsperrungen werden beim Laden auf die reale AS-zu-AS-Länge umgestellt. Ausschließlich hineinführende Rampenketten werden mitsamt den gesperrten Abbiegebewegungen berücksichtigt; Rampen außerhalb des Intervalls auf einem langen OSM-Way bleiben ausdrücklich offen. Bereits innerhalb der Sperrung vorhandene Autos dürfen weiter ausfahren. Keine pauschale Sperrung offener Ausfahrten.
- **Stauhinweise:** zusammenhängende Hauptfahrbahn-Rückstaus werden über eine Abfahrt hinweg verbunden und auf höchstens vier beschriftete Hinweise begrenzt; rote Segmente selbst bleiben sichtbar.
- **Regressionen:** Bei plausibler niedriger Sonntagnacht-Belastung nach 90 Modellminuten null Staus im lokalen A3/A48/NRW-Snapshot; unveränderte Fahrzeugbilanz. Die GitHub-Prüfkette enthält zusätzlich einen Unfall-Test und einen Evakuierungstest für Sperrungen.
- **Wichtig:** Noch nicht nachgewiesen ist, dass die Langzeitbelastung an allen Kölner Rampen realistisch ist. Die vorher künstlich überlasteten, datenarmen Randstrecken sind daher noch nicht als vollständig simuliert gekennzeichnet.

## Fachliche Regeln (verbindlich)

- Freie Fahrt, stockend, Stau und Stillstand müssen vom **berechneten Fahrzeugbestand und Fahrverhalten** stammen. Tempolimit und Ereignissymbol sind keine Staufarbe.
- Verkehrsbelastung, Fahrstreifenkapazität, Speicherdichte und Wellenlaufzeit müssen in physikalisch nachvollziehbaren Größen modelliert sein. **Ein Unfall mit zwei gesperrten von drei Fahrstreifen erzeugt Rückstau, wenn der angebotene Zufluss die Restkapazität überschreitet**; bei sehr schwacher Belastung darf nicht künstlich ein Stau erscheinen.
- Jede Einfädelung und jede Abfahrt braucht eine erlaubte **gerichtete topologische Beziehung** und eine begrenzte Empfangs-/Abflusskapazität. Kein „Zusammenschnappen“ nur aufgrund räumlicher Nähe. Bei unvollständigen Daten den Abschnitt markieren und gesondert auditieren.
- Mehrere OSM-Segmente können eine physisch zusammenhängende Warteschlange bilden. **Staulänge** ist die Summe tatsächlich betroffener Geometrieintervalle, **Verzögerung** resultiert aus der zusätzlichen Modell-Reisezeit, nicht aus Ereignisalter oder einer willkürlichen Zahl.
- Bei Vollsperrungen müssen **Betreten, Abfließen der bereits eingeschlossenen Fahrzeuge, offene Ausfahrten und zulässige Umleitungen** getrennt behandelt werden. Sperr-Overlay und Routing benutzen dieselbe gerichtete Sperrtopologie. Der lokale SPCK-Modus erfüllt die bundesweite Korridorsperrungslogik noch nicht vollständig.
- An Kreuzungen/Anschlussstellen wird nur eine tatsächlich belegte, verlangsamte Rampe rot. Ein roter Punkt auf einer fernen Autobahn färbt nicht die ganze Rampe um.
- Regelsätze gelten bundesweit; örtliche Fahrzeugmengen sind später als **Daten/Konfiguration**, nicht als Sonderbedingungen im Algorithmus einzutragen.

## Automatisierte Abnahme

- Null-Zufluss + 20-km/h-Baustelle: **null Fahrzeuge, null rote Stauflächen, null fiktive Verzögerung**.
- Gemeinsame innere OSM-Knoten: echte Auffahrt, Abfahrt und Durchfahrt verbunden; nahe, aber unverbundene Wege bleiben getrennt.
- Freitag 16:51, dreispuriger Autobahnabschnitt, davon zwei Spuren durch Unfall geschlossen: höherer Rückstau **vor** dem Engpass, positiver Zeitverlust bei ausreichendem Zufluss.
- Montag/Freitag/Sonntag: begründete Nachfrageunterschiede; keine einheitlich hohe Last rund um die Uhr.
- Fahrzeugbilanz nach jedem Schritt: erzeugt = abgefahren + im Netz + außerhalb wartend (numerische Toleranz).
- Mobile Bedienung: nur auf Wunsch stoppen; Ereignis anklicken/bearbeiten; sichtbare Staufarbe nicht hinter einer grünen Rampe verstecken; Kartenbedienfeld vertikal scrollbar.

## Noch nicht abgeschlossen – keine falschen Fertigmeldungen

1. **OD-Matrix und lokale Auf-/Abfahrtszahlen** für A3/A48 und NRW samt Richtungsprofilen, Quell-/Zielverkehr, Schwerverkehr. Das jetzige Verhältnis der Abfahrten ist nur ein generischer Ausgangspunkt.
2. **Bessere Datengrundlage** im lokalen SPCK-Modus: aktuell 1.929 Legacy-Geometrien, davon 1.219 über 18 begründete Quelleinfahrten erreichbar und 710 derzeit ohne modellierten Quelleintrag. Alle werden grün als vorhandene Fahrbahnen dargestellt, unabhängig vom Modellzufluss. Die vorherigen 188 Einspeisungen (1.676 erreichbare Wege) waren größtenteils unbestätigte Rampenfragment-Quellen und wurden bewusst entfernt. Der vollständige OSM-Import muss maßgeblich werden.
3. **Zusammenhängende Korridor-Vollsperrungen und Umleitungen** im lokalen SPCK-Modus: Zugeordnete Zubringerrampen schließen jetzt bei fehlender Alternative; die Sperrlänge reicht verbindlich von der vorigen bis zur nächsten bekannten Anschlussstelle, wenn die Originalgeometrie in Fahrtrichtung eindeutig ist; bei Unsicherheit meldet der Editor einen Fehler statt einer Mini-Sperrung. Das ist **noch keine flächendeckende Quell-Ziel-Umleitung**. Die Produktionslogik unter src/04_Ereignisse/netzsperrungen.ts ist umfangreicher.
4. **Verkehrsfluss bei bereits voller Autobahn**, Priorität an Einfädelungen und Rampen, dynamische Zielwahl bei Überlastung und einheitliche Datenverträge zwischen Canvas und Leaflet.
5. **Praxisprüfung am iPhone in SPCK** inklusive realer Bildausschnitte und Ereignissen. Automatische GitHub-Tests ersetzen diese nicht.

## Herkunft nutzbarer Grundlagen aus dem Altprojekt

- `Traffic-Sinulator/03_Stauphysik/traffic-cells.js`: Zellvorrat, Receiving/Sending, Kapazitätsschwellen, Fahrzeugbilanz, Engpassköpfe.
- `Traffic-Sinulator/03_Stauphysik/speed-delay.js`: Verzögerung als zusätzliche Reisezeit der tatsächlich betroffenen Zellen, getrennte Behandlung blockierter Fahrten.
- `Traffic-Sinulator/02_Verkehr/anschlussstellen-nachfrage.js`: Größenordnung typischer Abfahrtsanteile, örtliche Nachfrageprofile.
- `Traffic-Sinulator/03_Stauphysik/network-receiving.js`: gemeinsames, begrenztes Aufnahmevermögen bei Einfädelungen.
- `Traffic-Sinulator/06_Karte/map-callouts.js`: Kollisionen und Positionierung von Stauhinweisen.

**Keinen kompletten Legacy-Code blind kopieren:** Er enthält streckenspezifische Sonderlogik und andere Datenverträge. Nur physikalisch tragfähige Regeln übernehmen und durch bundesweite Tests absichern.

## Nachtrag 13.11.2026 – SPCK 0.8, zwei konkrete Screenshot-Regressionen

- **Keine grauen Autobahnen** aufgrund fehlender Modellzuflüsse. Alle vorhandenen OSM-Fahrwege haben die normale grüne Basiskarte. Die Zahl 1.219/1.929 beschreibt lediglich Fahrwege, die über die derzeitigen Modell-Nachfragequellen erreichbar sind.
- **A59 AD Köln-Heumar → AS Rath (Richtung Bonn):** vollständige Sperrung von 2.132 m statt 200 m, von Knoten 31 bis 32. Die Abbiegebewegung A3→A59 an Köln-Heumar ist gesperrt, während die Gegenrichtung und die weiter entfernt gelegenen Rampen (etwa Wahn) nicht mitgesperrt werden.
- **A3 AK Köln-Ost → AD Köln-Heumar:** 3.796 m über 17 gerichtete OSM-Ways, mit zugehörigen ausschließlich hineinführenden Rampen. Der vorherige Test mit einer kurzen OSM-Fragment-Sperrung ist beseitigt.
- **Sperrendarstellung:** Stau-/Sperr-Overlay wird nach der kompletten grünen Straßenbasis gezeichnet. Die Auswahl-Markierung zeichnet nicht mehr nachträglich über die rot-weißen Sperrstreifen.
- Die lokale Rampensperrung verwendet jetzt die tatsächliche Einmündungsposition innerhalb eines langen OSM-Ways. Die bloße Zugehörigkeit zum selben 26-km-Way genügt nicht mehr als Sperrgrund.
- **Noch offen:** flächendeckende Validierung aller Knoten und echte OD-Umleitungsplanung. Bei einem unklaren AS-Korridor wird jetzt eine eindeutige Fehlermeldung statt einer falschen 200-m-Sperrung ausgegeben.

## 14.11.2026 – SPCK 0.9: Screenshot-Regressionen

1. **Fehlende Unfallstaus:** Es gab 48 Hauptfahrbahn-Ways mit verkehrter Richtung im alten Geometriedatensatz. Nach Normierung exakt gemeinsamer OSM-Endpunkte sind alle 821 A3- und 149 A48-Hauptfahrbahn-Ways im gerichteten Modell erreichbar.
2. **Phantomstaus:** Das CTM hat zu kurze OSM-Ways mit einer Speicherkapazität unter der Fünf-Sekunden-Fahrzeugmenge behandelt. Außerdem verhinderten Innenabfahrten irrtümlich die Ausfahrt von Fahrzeugen am tatsächlichen Ende der Kartengeometrie. Virtuelles Zelllager und echte Netzend-Erkennung verhindern dies. Samstag 14 Uhr, 25 simulierte Minuten, ohne Ereignis: null Staugruppen im Snapshot.
3. **Ereignis-Staumechanik:** Der Rückstau wird jetzt anhand der tatsächlichen Zellabflüsse und Bestände in eine beobachtete Geschwindigkeit übersetzt. Zufluss vor dem 2/3-Spuren-Unfall auf der dreispurigen A3 kann die Restkapazität von rund 1518 Kfz/h überschreiten und erzeugt Rückstau. Überlagerte Baustelle + Unfall können die Restkapazität noch stärker einschränken. Automatischer Abfahrts-Bypass ist nur für vorher bekannte Korridorsperrungen aktiviert.
4. **Fehlerhafte AS-zu-AS-Sperrung:** Mehrfachprojektion derselben AS wurde dedupliziert, und die 75-km-Längenbegrenzung wurde entfernt. A3 AD Dernbach–Montabaur, A48 AK Koblenz–Koblenz-Nord und A565 Bonn-Auerberg–Bonn-Beuel-Nord sind regressionstestiert. Wenn der gerichtete Korridor tatsächlich unvollständig ist, muss weiter eine Fehlermeldung statt einer falschen Sperrung erscheinen.
5. **Alte App-Regeln übernommen:** vorhandener Anfangsbestand (mit Bilanz), Verkehrsstrom/Bestands-Tempo, receiving/sending der Zellen, kollisionsfreie Platzierung der Stauhinweise und deduplizierte Darstellung. Keine blind übernommenen streckenspezifischen Sonderfälle.
6. **iPhone-UI:** kleinere Fahrstreifen-Schaltflächen, sticky Aktionsleiste, weniger verdeckte Kartenfläche, kleine Sperricons auf realen gesperrten Rampen bei Zoom.

**Ausstehend:** Nicht alle A565-/NRW-Teilstrecken sind mit kalibrierten Zielrouten-/Zuflussprofilen ausgestattet; automatische Tests sind kein manueller iPhone-Bildnachweis.
