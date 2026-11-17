# Fußball-Collector

Eine App zum Verwalten einer Fußballkarten-Sammlung: Fotos von Vorder- und Rückseite (automatisch zugeschnitten und begradigt), Besonderheiten wie Nummerierung, Autogramm oder Patch, Ankaufspreis, Marktwert, Lagerort und Notizen.

Die App läuft im Browser und lässt sich auf **PC, Mac, iPhone, iPad und Android** wie eine normale App installieren (Progressive Web App). Sie funktioniert auch offline.

## App öffnen und installieren

Adresse: **https://stephanweigelt-ger.github.io/Fu-ball-Collector/**

- **iPhone / iPad:** Adresse in Safari öffnen → „Teilen“ → „Zum Home-Bildschirm“.
- **PC / Mac:** In Chrome oder Edge öffnen → Installations-Symbol rechts in der Adresszeile.
- **Android:** In Chrome öffnen → Menü → „App installieren“.

## Wo liegen die Daten?

Alle Karten und Fotos werden **nur lokal auf dem jeweiligen Gerät** gespeichert (IndexedDB des Browsers). Es gibt keinen Server und kein Konto. Jeder, der die App öffnet, startet mit einer leeren Sammlung.

Über **„Sichern & Laden“** lässt sich

- eine **Sicherung** (eine `.json`-Datei mit allen Karten und Fotos) herunterladen,
- eine Sicherung **einspielen**, z. B. auf einem anderen Gerät,
- die Sammlung als **CSV-Tabelle** für Excel exportieren.

Tipp: Regelmäßig eine Sicherung erstellen, z. B. in iCloud Drive oder Dropbox. Wird die App gelöscht oder der Browserspeicher geleert, sind die Daten sonst weg.

## Aufbau des Codes

Keine Abhängigkeiten, kein Build-Schritt. Einfach die Dateien auf einen Webserver legen.

| Datei | Inhalt |
|---|---|
| `index.html` | Seitenaufbau |
| `css/app.css` | Gestaltung (heller und dunkler Modus) |
| `js/app.js` | App-Logik: Liste, Filter, Formular, Sichern & Laden |
| `js/store.js` | Lokale Datenhaltung (IndexedDB) und Sicherungsformat |
| `js/cardproc.js` | Fotobearbeitung: Karte erkennen, entzerren, Licht korrigieren |
| `sw.js` | Service Worker für Offline-Betrieb |
| `manifest.webmanifest`, `icons/` | App-Name und Logo für die Installation |

Lokal testen: `python3 -m http.server` im Ordner starten und http://localhost:8000 öffnen.

**Bei Änderungen** die Versionsnummer in `sw.js` (`CACHE`) und in `js/app.js` (`APP_VERSION`) erhöhen, damit installierte Apps das Update laden.

## Veröffentlichung

Die App wird über GitHub Pages aus dem Branch `main` (Ordner `/`) ausgeliefert. Jeder Push auf `main` aktualisiert die App automatisch.
