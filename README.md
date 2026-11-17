# Fußball-Collector

Eine App zum Verwalten einer Fußballkarten-Sammlung: Fotos von Vorder- und Rückseite (automatisch zugeschnitten und begradigt), Besonderheiten wie Nummerierung, Autogramm oder Patch, Ankaufspreis, Marktwert, Lagerort und Notizen.

Die App läuft im Browser und lässt sich auf **PC, Mac, iPhone, iPad und Android** wie eine normale App installieren (Progressive Web App). Sie funktioniert auch offline.

## App öffnen und installieren

Adresse: **https://stephanweigelt-ger.github.io/Fu-ball-Collector/**

- **iPhone / iPad:** Adresse in Safari öffnen → „Teilen“ → „Zum Home-Bildschirm“.
- **PC / Mac:** In Chrome oder Edge öffnen → Installations-Symbol rechts in der Adresszeile.
- **Android:** In Chrome öffnen → Menü → „App installieren“.

## Wo liegen die Daten?

In der **eigenen Dropbox** jedes Nutzers. Beim ersten Start auf „Mit Dropbox verbinden“ tippen und bei Dropbox anmelden. Die App bekommt nur Zugriff auf ihren eigenen Ordner **„Apps/Fussball-Collector“**, nicht auf die übrige Dropbox:

- `karten.json` – alle Karten
- `fotos/<id>.jpg` – die Fotos

Jedes Gerät, das mit derselben Dropbox verbunden ist, zeigt dieselbe Sammlung. Wer sich mit einer anderen Dropbox anmeldet, startet leer. Änderungen werden automatisch abgeglichen; ohne Internet arbeitet die App mit einer Kopie auf dem Gerät weiter und gleicht später ab.

### Automatische Marktwert-Bewertung

Eine geplante Claude-Aufgabe liest jeden Sonntag um 23:59 Uhr `karten.json`, recherchiert die Preise und legt das Ergebnis als `bewertung-<Datum>.json` in den App-Ordner. Die App übernimmt die Werte beim nächsten Abgleich und löscht die Datei. Format:

```json
{"app":"Fussball-Collector","art":"bewertung","karten":{"<karten-id>":{"marktwert":13.9,"bewertetAm":"2026-11-22T23:05:00Z","bewertungHinweis":"…","marktwertQuellen":[{"quelle":"eBay.de","art":"Verkauft","titel":"…","preis":13.9,"original":"13,90 €","url":"https://…"}]}}}
```

Eine Datei `import.json` (Sicherungsformat) im App-Ordner wird beim nächsten Abgleich ebenfalls automatisch eingespielt und danach gelöscht.

Über **„Sichern & Laden“** lässt sich zusätzlich eine Sicherungsdatei (`.json` mit allen Karten und Fotos) herunterladen oder einspielen sowie eine CSV-Tabelle für Excel exportieren.

### Dropbox-App einrichten (einmalig, für den Betreiber)

1. https://www.dropbox.com/developers/apps → „Create app“ → „Scoped access“ → „App folder“.
2. Reiter „Permissions“: `files.content.write` und `files.content.read` aktivieren, „Submit“.
3. Reiter „Settings“ → „Redirect URIs“: die Adresse der App eintragen (z. B. `https://stephanweigelt-ger.github.io/Fu-ball-Collector/`).
4. Den „App key“ in `js/config.js` eintragen. Das „App secret“ wird nicht gebraucht.
5. Solange die Dropbox-App im Status „Development“ ist, können sich bis zu 500 Nutzer verbinden. Für mehr in der Dropbox-Konsole „Apply for production“ wählen.

## Aufbau des Codes

Keine Abhängigkeiten, kein Build-Schritt. Einfach die Dateien auf einen Webserver legen.

| Datei | Inhalt |
|---|---|
| `index.html` | Seitenaufbau |
| `css/app.css` | Gestaltung (heller und dunkler Modus) |
| `js/app.js` | App-Logik: Liste, Filter, Formular, Sichern & Laden |
| `js/config.js` | Einstellungen, u. a. Dropbox-App-Schlüssel |
| `js/store.js` | Lokale Kopie der Daten (IndexedDB) und Sicherungsformat |
| `js/sync.js` | Dropbox-Anmeldung und Abgleich |
| `js/cardproc.js` | Fotobearbeitung: Karte erkennen, entzerren, Licht korrigieren |
| `sw.js` | Service Worker für Offline-Betrieb |
| `manifest.webmanifest`, `icons/` | App-Name und Logo für die Installation |

Lokal testen: `python3 -m http.server` im Ordner starten und http://localhost:8000 öffnen.

**Bei Änderungen** die Versionsnummer in `sw.js` (`CACHE`) und in `js/app.js` (`APP_VERSION`) erhöhen, damit installierte Apps das Update laden.

## Veröffentlichung

Die App wird über GitHub Pages aus dem Branch `main` (Ordner `/`) ausgeliefert. Jeder Push auf `main` aktualisiert die App automatisch.
