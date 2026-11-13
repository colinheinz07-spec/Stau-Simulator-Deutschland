# Verkehrsmodell 0.6 – verbindlicher Befund und Abnahmekriterien

Stand: 13.11.2026. Für dieses Projekt gelten **bundesweite, nicht streckenspezifische** Regeln. Der lokale SPCK-Modus und die vollständig veröffentlichte Import-Karte haben aktuell **verschiedene** Engines. Keine der beiden darf als kalibrierte Echtzeit-Verkehrsprognose ausgegeben werden.

## Festgestellte Ursachen in der lokalen SPCK-Karte

1. **Verlorene Fahrbeziehungen:** Der alte SPCK-Zellfluss verband OSM-Ways nur Endpunkt→Anfangspunkt. Viele Abfahrten beginnen und Auffahrten enden an **inneren Punkten** eines längeren OSM-Ways. Dadurch waren trotz sichtbarer Straßen nur **825 von 1.929** Geometrien aus den 13 damals gewählten Modellquellen erreichbar. Die überarbeitete Modelltopologie erreicht nach Hinzufügen gemeinsamer Originalgeometrie-Knoten **1.676 von 1.929** Fahrwegen. Dies ist rechnerische Erreichbarkeit, keine Validierung aller Fahrtrichtungen und Ziele.

2. **Unplausible Abzweiganteile:** Bei einer Hauptfahrbahn (Gewicht 6) und einer Rampe (Gewicht 2) wurden **25 % des Verkehrs** pauschal auf die Abfahrt geschickt – auch bei kleinen Anschlussstellen. Dies verdünnte den Durchgangsverkehr im Verlauf der Autobahn erheblich. Neu: Gewicht 20 versus 1,5 für die normale Abzweigung (~7 % bei einer Rampe). Bei Autobahnkreuzen und realen Abbiegerelationen fehlen noch getrennte OD-Anteile; diese Annahme ersetzt keine Zählung.

3. **Fehlende örtliche Rampennachfrage:** Nur wenige geometrische Netzgrenzen speisten Verkehr ein. Neu werden an gerichteten Rampen ohne modellierten Vorgänger **angenommene** externe Zuflüsse zugelassen, wenn die Rampe einen echten gemeinsamen OSM-Verbindungspunkt zum Netz hat. ACHTUNG: Der Legacy-Datensatz enthält fragmentierte Rampenketten. Solche Quellen sind noch **nicht gegen lokale Verkehrszählungen oder vollständig importierte Netze validiert**. Ihre Einspeisung kann ein Grund für übertriebene städtische Modellstaus sein.

4. **Zu optimistische Unfallrestkapazität:** Eine einzelne offene Spur wurde vorher bis zu 2.200 Kfz/h angesetzt, ohne den zusätzlichen Einfädel- und Bremsverlust. Das neue Prototypmodell reduziert diesen Wert bei einem Unfall auf rund **1.518 Kfz/h** (Faktor 0,69) und unterscheidet Unfall, Baustelle und Panne. Diese Faktoren sind **Modellannahmen**. Sie müssen an Auswertungen realer Arbeitsstellen und Störfälle kalibriert werden.

5. **Keine Uhrzeit im Verkehrsaufkommen:** Die lokale Startzeit betraf bislang nur Ereignispläne, nicht die Nachfrage. Jetzt gibt es ein nachvollziehbares Stunden- und Wochentagsprofil. Freitag-Nachmittagsverkehr und Sonntagnacht erhalten unterschiedliche Verkehrsmengen; Basiswerte sind noch nicht BASt-kalibriert.

6. **Unzuverlässige Visualisierung:** Die später gezeichneten grünen Rampen verdeckten teilweise rote Hauptfahrbahn-Abschnitte. Jetzt werden zuerst alle Grundfahrbahnen, danach alle Geschwindigkeitsbänder und zuletzt die rot-weißen Sperrungen gezeichnet. Ereignisse haben getrennte klickbare Symbole. Straßen **ohne Modellzufluss** sind grau statt fälschlich grün.

7. **Fehlende Reaktion bei angehaltener Simulation:** Ein nachträglich gespeichertes Ereignis konnte sichtbar markiert sein, während der Simulations-Zeitgeber angehalten war. Ein aktives Ereignis setzt nun die Simulation fort, ohne die bisherigen Fahrzeuge zu löschen. Kurzzeitige iOS-/SPCK-Sichtbarkeitswechsel sollen den Benutzerzustand nicht mehr auf „Pause“ setzen.

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
2. **Bessere Datengrundlage** im lokalen SPCK-Modus: aktuell 1.929 Legacy-Geometrien mit 253 modellseitig nicht erreichbaren Abschnitten, teils unbestätigten externen Rampenquellen. Die vollständige A3/A48-OSM-Importpipeline ist davon getrennt. Der vollständige Import muss maßgeblich werden.
3. **Zusammenhängende Korridor-Vollsperrungen und Umleitungen** im lokalen SPCK-Modus; die Produktionslogik unter src/04_Ereignisse/netzsperrungen.ts ist umfangreicher und darf nicht mit dem lokalen 200-m-Ereignisprototyp gleichgesetzt werden.
4. **Verkehrsfluss bei bereits voller Autobahn**, Priorität an Einfädelungen und Rampen, dynamische Zielwahl bei Überlastung und einheitliche Datenverträge zwischen Canvas und Leaflet.
5. **Praxisprüfung am iPhone in SPCK** inklusive realer Bildausschnitte und Ereignissen. Automatische GitHub-Tests ersetzen diese nicht.

## Herkunft nutzbarer Grundlagen aus dem Altprojekt

- `Traffic-Sinulator/03_Stauphysik/traffic-cells.js`: Zellvorrat, Receiving/Sending, Kapazitätsschwellen, Fahrzeugbilanz, Engpassköpfe.
- `Traffic-Sinulator/03_Stauphysik/speed-delay.js`: Verzögerung als zusätzliche Reisezeit der tatsächlich betroffenen Zellen, getrennte Behandlung blockierter Fahrten.
- `Traffic-Sinulator/02_Verkehr/anschlussstellen-nachfrage.js`: Größenordnung typischer Abfahrtsanteile, örtliche Nachfrageprofile.
- `Traffic-Sinulator/03_Stauphysik/network-receiving.js`: gemeinsames, begrenztes Aufnahmevermögen bei Einfädelungen.
- `Traffic-Sinulator/06_Karte/map-callouts.js`: Kollisionen und Positionierung von Stauhinweisen.

**Keinen kompletten Legacy-Code blind kopieren:** Er enthält streckenspezifische Sonderlogik und andere Datenverträge. Nur physikalisch tragfähige Regeln übernehmen und durch bundesweite Tests absichern.
