# Radeln – virtuelles Indoor-Radtraining

Radeln ist eine Web-App für das Training auf der Rolle. Du verbindest deinen Smart-Trainer per Bluetooth
und fährst durch prozedural erzeugte 3D-Landschaften, allein oder mit Computer-Fahrern. Dazu gibt es
strukturierte Trainings, Bergwertungen und eine Auswertung nach jeder Fahrt.

## Funktionen

| Bereich | Was es kann |
|---|---|
| **Smart-Trainer** | Bluetooth-Kopplung über offene Standards (FTMS, Cycling Power, Heart Rate). Im **Simulationsmodus** stellt der Trainer die Steigung der Strecke nach, im **ERG-Modus** gibt er die Zielleistung des Trainings vor. |
| **Steigungsgefühl** | Regler von 0 bis 100 %, mit dem sich die Steigungssimulation abschwächen lässt |
| **Simulator** | Ohne Gerät steuerst du die Leistung mit den Pfeiltasten oder dem Regler, praktisch zum Ausprobieren |
| **Physik** | Geschwindigkeit aus Leistung, Gewicht, Luft- und Rollwiderstand sowie Steigung, inklusive **Windschatten** (bis −32 %) |
| **Strecken** | 4 eigene Rundkurse: Seeufer-Runde (flach), Hügelland-Schleife (wellig), Gipfelsturm (Pass, über 500 Hm), Waldkriterium (kurz) |
| **Mitfahrer** | Bis zu 24 Computer-Fahrer mit eigenem Leistungsniveau. Etwa die Hälfte fährt in deiner Gruppe mit. |
| **Trainings** | 6 Vorlagen (Grundlage, Sweetspot, Schwelle, VO2max, Sprint-Pyramide, Rampentest), dazu ein Baukasten mit Kurzschreibweise und Import von `.zwo`- und `.json`-Dateien |
| **FTP-Test** | Rampentest mit automatischer FTP-Schätzung, die sich mit einem Klick ins Profil übernehmen lässt |
| **Wertungen** | Bergwertung und Zielsprint mit Zeitnahme und persönlichen Bestzeiten |
| **HUD** | Leistung, W/kg, Puls, Trittfrequenz, Leistungszone, Steigung, Minikarte, Höhenprofil, Fahrerliste mit Abständen |
| **Kameras** | Verfolger, Helm, Seite, Vogel (Taste `C`) |
| **Auswertung** | Ø/NP/Max-Leistung, IF, TSS, Bestwerte (5 s/1/5/20 min), Puls, kcal, Diagramm, XP und Level |
| **Export** | TCX-Datei mit Leistung, Puls, Trittfrequenz und Höhe zum Hochladen auf gängige Trainingsplattformen |

## Starten

```bash
npm install
npm run dev        # Entwicklungsserver auf http://localhost:5173
npm run build      # statischer Build in dist/ (auf jedem Webserver lauffähig)
npm test           # Unit-Tests (Physik, Bluetooth-Parser, Trainings, Statistik, Strecken)
```

**Browser:** Für Bluetooth brauchst du **Chrome oder Edge** auf Desktop oder Android. Firefox und Safari
unterstützen Web Bluetooth nicht, der Simulator-Modus läuft aber auch dort. Web Bluetooth funktioniert
nur über `https://` oder `localhost`.

### Tastatur

| Taste | Funktion |
|---|---|
| `↑` / `↓` | Leistung ±10 W (Simulator, mit Shift ±50 W) bzw. Trainingsintensität ±1 % |
| `←` / `→` | Spur wechseln (für den Windschatten) |
| `C` | Kamera wechseln |
| `P` / Leertaste | Pause |
| `H` | HUD reduzieren |

### Trainings-Kurzschreibweise

```
10m 50-75%, 4x(4m 105%, 2m 55%), 8m 60-45%, 5m frei
```
`10m 65%` steht für einen konstanten Block, `5m 50-80%` für eine Rampe, `3x(...)` für Wiederholungen und
`frei` für einen Block ohne Vorgabe. Als Einheiten gehen `s`, `m` und `h`. Prozentwerte beziehen sich auf deine FTP.

## Projektstruktur

```
src/
  main.js       Menü, Ablaufsteuerung, Zusammenfassung
  ride.js       Spielschleife: Physik, Mitfahrer, Trainersteuerung, Aufzeichnung, Kamera
  world.js      3D-Welt (Three.js): Gelände, Straße, Vegetation, Landmarken
  riders.js     Low-Poly-Fahrermodell mit Tretanimation
  route.js      Prozedurale Rundkurse und Höhenprofile
  physics.js    Fahrphysik und Windschatten
  ble.js        Web-Bluetooth: FTMS / Cycling Power / Herzfrequenz
  workouts.js   Trainingsvorlagen, Import, Kurzschreibweise
  stats.js      NP, IF, TSS, Bestwerte, XP/Level
  export.js     TCX-Export
  hud.js        Anzeige während der Fahrt
  storage.js    Lokale Speicherung (localStorage)
test/           Unit-Tests (node:test)
```

## Abgrenzung zu bestehenden Produkten

Radeln ist eine **Eigenentwicklung**. Es nutzt die gleichen allgemeinen Konzepte wie andere
Indoor-Cycling-Apps, übernimmt aber nichts Geschütztes:

- **Eigener Code:** Alles ist neu geschrieben. Es wurde kein fremder Code, keine fremde Grafik, kein Sound und kein Text verwendet.
- **Eigene Welten:** Alle Strecken werden aus Zufallszahlen erzeugt. Es gibt keine nachgebauten Fantasiewelten, Inseln oder Landmarken anderer Apps.
- **Eigenes Erscheinungsbild:** Name, Logo, Farbschema (Türkis/Violett), HUD-Layout, Fahrermodell und Begriffe („Steigungsgefühl“, „Bergwertung“) sind eigenständig.
- **Keine geschützten Spielelemente:** Es gibt keine Power-ups, keine Spielwährung und keine Figuren oder Ausrüstung, die anderen Apps nachempfunden sind.
- **Offene Standards:** Bluetooth FTMS, CPS und HRS sind öffentliche Spezifikationen der Bluetooth SIG. TCX ist ein offenes Austauschformat.
- **Dateiimport:** Der `.zwo`-Import dient nur der Interoperabilität mit Trainingsdateien, die der Nutzer selbst besitzt. Es werden keine fremden Trainingsbibliotheken mitgeliefert.

Allgemeine Spielideen wie „virtuell auf der Rolle fahren“, Windschatten, Intervalltraining oder ein FTP-Test
sind nicht urheberrechtlich geschützt. Geschützt sind konkrete Umsetzungen wie Code, Grafiken, Karten und
Texte sowie Marken. Bei einer Veröffentlichung oder kommerziellen Nutzung solltest du trotzdem
Folgendes beachten:

- Fremde Markennamen nicht für Werbung oder im Produktnamen verwenden (z. B. nicht „wie X“ oder „X-Alternative“ im Namen).
- Vor einem kommerziellen Start eine **Markenrecherche** für „Radeln“ durchführen (DPMA/EUIPO) und rechtlichen Rat einholen. Diese Hinweise ersetzen keine Rechtsberatung.

## Mögliche nächste Schritte

- **Echter Mehrspielermodus** mit einem WebSocket-Server, damit echte Menschen gemeinsam fahren können (aktuell sind die Mitfahrer computergesteuert)
- FIT-Export und direkter Upload zu Trainingsplattformen über deren offizielle APIs
- Weitere Strecken, Tageszeiten und Wetter
- Gruppenfahrten und Rennen mit Startaufstellung
- Mobile App über einen Wrapper (z. B. Capacitor) für iOS, wo Web Bluetooth fehlt

## Screenshots

![Bergwertung am Gipfelsturm](docs/ff-climb.png)
![Gruppenfahrt im Waldkriterium](docs/ff-wald.png)
![Auswertung nach dem Rampentest](docs/ff-summary.png)
