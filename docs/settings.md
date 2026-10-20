# Einstellungen: sechs Seiten (Paket C, 20.10.2026)

Aus dem UX-Audit (`docs/ux-audit-2026-10.md`, Befund P0-3, Abschnitt 5.4). Statt zwölf seitlich scrollender Reiter
(Web) und elf loser Zeilen in Mehr (iOS) gibt es **eine Liste mit sechs Seiten**, gleich auf iOS und Web, Cloud und
eigenem Server:

| Seite (Id) | Zeilen (Id) – „Mehr Optionen“ kursiv |
|---|---|
| **Ich** (`ich`) | Ruhe & Fokus (`fokus`, direkt auf der Seite: Sanfter Modus, Nur eins, Heute höchstens, Erinnerungen bündeln, Timer, abends fragen) · Name, Bild & Geschmack (`profil`) · Deine Leiste (`leiste`) · Darstellung & Lesbarkeit (`darstellung`, Admins: „Für alle im Haushalt“) · Anmeldung & Sicherheit (`anmeldung`: Passwort, Passkeys, E-Mail, 2FA, SSO, PIN, iPhone-App verbinden, Geräte) |
| **Haushalt** (`haushalt`) | Name & Sprache (`name`, auf der Seite) · Wer wohnt hier? (`leute`: Haushaltsform, Leute, Mitglieder, Kinder) · Region & Währung (`region`) · Wie kocht ihr? (`kochstil`) · Extras im Wocheneinkauf (`extras`) · Brotdose (`brotdose`) · *Anmeldewege (`anmeldewege`, Admins: Passkeys, Mail-Link, Passwort, SSO) · Wochenfrage (`wochenfrage`) · Sterne (`sterne`) · Zeile unter geteilten Listen (`teilen-zeile`)* |
| **Bereiche & Orte** (`bereiche`) | Was nutzt ihr? (`module`, erste Zeile) · Orte & Kategorien (`orte`) · Vorrat: was verfolgen? (`vorrat`) · Rezepte & Importe (`rezepte`) · Bring mir was: Karte (`karte`) · Urlaub & Übergabe (`urlaub`, Link auf `/urlaub`) |
| **Mitteilungen & Kalender** (`mitteilungen`) | Was dich erreicht (`meine`) · Für den ganzen Haushalt (`haushalt-kanaele`: HA-Webhook, ntfy, E-Mail, Telegram/Gotify/Matrix, Matrix „Was geht wohin?“) · Kalender: Euren Kalender lesen (`kalender-lesen`), Erinnerungen & Kalender (`caldav`), Kalender-Abo (`kalender-abo`) · Hinweis im Laden (`laden`, nur iPhone) |
| **Verbindungen & Geräte** (`verbindungen`) | KI (`ki`) · KI-Assistenten & Zugänge (`assistent`: MCP, Zugangsschlüssel) · Home Assistant (`home-assistant`, mit Cookidoo über HA) · Displays & Familien-Tablet (`displays`) · Drucker (`drucker`) · QR-Etiketten (`etiketten`, Link) · Teilen aus anderen Apps (`teilen`, nur Web – das iPhone hat das Teilen-Menü) · Server & Haushalte (`server`, nur iPhone) · *Bons per E-Mail (`mail`, Admins)* |
| **Daten, Abo & Konto** (`daten`) | Abo & Speicher (`abo`; eigener Server: „Eigener Server – alles inklusive“) · Daten & Sicherung (`sicherung`) · Daten & Zurücksetzen (`zuruecksetzen`, DataWipe) · Deine Daten & Konto (`konto`, nur Cloud: Export und Konto löschen) |

Gäste sehen nur **Ich** mit `profil` und `anmeldung`. Abgeschaltete Bereiche („Was nutzt ihr?“) blenden ihre Zeilen aus.

## Wo es steht

- Register (Seiten, Zeilen, Suchwörter, alte Links): `web/src/settings/registry.ts`. iOS: `SettingsRegistry` in
  `ios/ToHuus/Features/Settings/SettingsHome.swift` mit denselben Ids. `test/settings-registry.test.ts` vergleicht beide.
- Web: `pages/Settings.tsx` (was jede Zeile zeigt, `rowViews`), Rahmen `settings/SettingsShell.tsx` +
  `settings/settings.css`. Routen `/einstellungen`, `/einstellungen/<seite>`, `/einstellungen/<seite>/<zeile>`,
  `/einstellungen/<seite>/mehr`; Zeilen auf der Seite selbst als Anker (`/einstellungen/ich#fokus`).
  Handy: Liste → Seite → Unterseite. Desktop (≥ 960 px): Liste links, Seite rechts.
- Suche oben in den Einstellungen (Web und iOS) filtert alle Zeilen aller Seiten (Titel DE/EN, Kurztext, Suchwörter,
  Seitenname; Umlaute egal). Die globale Suche (⌘K, Lupe) findet dieselben Zeilen.
- Mehr: nur noch eine Zeile „Einstellungen“ (iOS und Web). „Geräte & Verbindungen“, „Abo & Speicher“ und „Konto
  löschen“ sind aus Mehr in die Einstellungen gewandert.

## Alte Links

`/einstellungen?tab=<x>` leitet weiter (andere Parameter und `#` bleiben):

| alt | neu |
|---|---|
| `plan` | `/einstellungen/daten/abo` |
| `home` | `/einstellungen/haushalt` |
| `account` | `/einstellungen/ich` (mit `sso=…`: `/einstellungen/ich/anmeldung`) |
| `members` | `/einstellungen/haushalt/leute` |
| `places` | `/einstellungen/bereiche/orte` |
| `notify` | `/einstellungen/mitteilungen` |
| `access` | `/einstellungen/verbindungen` |
| `ha` | `/einstellungen/verbindungen/home-assistant` |
| `displays` | `/einstellungen/verbindungen/displays` |
| `print` | `/einstellungen/verbindungen/drucker` |
| `recipes` | `/einstellungen/bereiche/rezepte` |
| `data` | `/einstellungen/daten` (mit `#demo`: `/einstellungen/daten/zuruecksetzen#demo`) |

Unbekannte Reiter und Pfade landen auf `/einstellungen`. Server-Links (Mails, Pushes, SSO-Rückkehr) zeigen schon auf
die neuen Pfade. iPhone-Pushes: `server/lib/apns.ts settingsDeepLink` macht aus `/einstellungen/…` den Link
`tohuus://more/settings/<seite>/<zeile>` – neue App: Mehr › Einstellungen › Seite (› Zeile); ältere App liest nur
`more` und öffnet Mehr. Simulator: `-debugSettings YES -debugSettingsPath haushalt/leute`.

## Platzhalter

Die Zeile für Geschenk-Erinnerungen (Wunschlisten) ist vorgesehen, aber noch nicht eingetragen: Kommentar in
`registry.ts` und `SettingsHome.swift` (Seite Mitteilungen & Kalender, Modul `wishes`).
