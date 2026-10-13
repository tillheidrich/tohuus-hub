# Übergabe am Abend, 13.10.2026

Für Till. Ergänzt [uebergabe-2026-10-13-abschluss.md](uebergabe-2026-10-13-abschluss.md) und
[uebergabe-2026-10-13.md](uebergabe-2026-10-13.md). Deploy in Coolify (dort Abschnitt 2) und Xcode-Build (dort
Abschnitt 3) gehen genauso wie beschrieben.

Alles liegt auf `claude/tohuus-status-btntbq`, neuer Draft-PR https://github.com/tillheidrich/tohuus-hub/pull/3
(PR #2 war geschlossen, der Branch gelöscht; er ist wiederhergestellt und enthält `main`). **Nichts ist deployed.**
Die iOS-App ist **nicht kompiliert** (kein Xcode hier). Typecheck grün, 1029 Tests grün, 9 übersprungen.

---

## 1. Reihenfolge für dich

1. PR #3 prüfen und mergen. Danach Backup von `/data` und Redeploy von `tohuus-cloud`.
2. Umgebungsvariablen setzen (Abschnitt 3). Die drei APNs-Werte sind Pflicht für den Test, sonst kommen keine
   Mitteilungen aufs iPhone.
3. In `/betrieb` › Einstellungen `beta.gift` auf `plus` setzen. **Wichtig:** Ohne das bekommt jeder Testhaushalt
   14 Tage Probezeit und fällt mitten im Test auf Free (20 Assistent-Nachrichten im Monat, 250 MB, keine
   Bon-Adresse). Danach unter Beta-Zugang Zugangscodes anlegen und `support.email` prüfen.
4. iOS: `CURRENT_PROJECT_VERSION` in `ios/project.yml` hochzählen, `xcodegen generate`, bauen. Compiler-Fehler an
   mich. Neue Datei: `ios/ToHuus/Features/Settings/FeedbackMail.swift` (xcodegen nimmt sie automatisch mit).
5. Kurztest auf dem iPhone (Abschnitt 4), dann TestFlight.
6. Vor dem ersten Tester: einmal `node dist/restore-check.mjs` im Container, Uptime-Monitor auf `/health`,
   Mail-Zustellung mit mail-tester.com prüfen (SPF, DKIM, DMARC für den Absender).

---

## 2. Was seit der letzten Übergabe neu ist

- **Mails abbestellen**: Schalter „Mails von ToHuus“ unter Mitteilungen (Web und iPhone). Zusammenfassung und
  Abo-Erinnerung haben einen Abmeldelink und die Ein-Klick-Abmeldung, die Gmail und Apple Mail anzeigen.
  Anmeldelinks und Sicherheitshinweise kommen immer.
- **Mit Apple anmelden**: Die Nonce ist jetzt auch für die App Pflicht (die App schickt sie schon immer). Beim
  Löschen eines Kontos schickt die App einen frischen Code, damit der Apple-Zugang sicher widerrufen wird.
- **KI nur mit Zustimmung (Cloud)**: Nach der Anmeldung fragt die App einmal, ob KI genutzt werden darf, und nennt
  „Mistral AI (EU)“. Ohne Ja geht nichts an ein Sprachmodell. Kinder und Bons per Mail brauchen die Zustimmung
  eines Admins. KI für Kinder ist in der Cloud erst aus. Selbst gehostet ändert sich nichts.
- **App Store**: „Code einlösen“ ist in der Web-Ansicht in der App versteckt und wird vom Server abgelehnt
  (Regel 3.1.1). Texte für Mikrofon und Spracherkennung stimmen jetzt. Gesundheitsdaten stehen im Privacy-Manifest.
- **Für einen längeren Test**: „Feedback senden“ (Mail an die Support-Adresse mit Version und Build),
  Build-Nummer in den Einstellungen, Test-Mitteilung und Hinweis, wenn dem Server der APNs-Schlüssel fehlt,
  „Bitte aktualisieren“-Bildschirm über `MIN_IOS_BUILD`, kein „14 Tage, dann Free“ während des Beta-Geschenks,
  Offline-Liste auch bei gesperrtem iPhone (Siri).
- **Assistent**: strengerer Filter für fremde Themen, Spracheingabe nach etwa einer Minute begrenzt (kein
  kostenloser Abschreibdienst).
- **REWE-Mails**: Bestellbestätigung, Änderung und Ersatzartikel-Mail werden bewusst nicht gebucht, sonst zählt es
  doppelt, wenn der eBon kommt. Für den nächsten Schritt brauche ich eine REWE-Mail als `.eml` **mit Anhang**
  (eBon-PDF und Ersatzliste); deine PDFs waren nur Ausdrucke der Mails.
- **Datenschutzerklärung**: KI-Zustimmung, abbestellbare Mails, Widerruf bei Apple, Beta-Zugangscodes, Schriften
  in Mails. OpenRouter steht dort weiter als Dienstleister (Pflicht nach Art. 13 DSGVO), in App und Website nicht.
- **Self-Host und Home Assistant** geprüft: frisch eingerichtet, Update von einer Version vom 11.10., alle
  HA-Endpunkte, 32 HA-Tests grün. Docker-Healthcheck folgt jetzt `PORT`.
- **Barrierefreiheit**: Fokus nicht mehr unter festen Leisten versteckt, Kontraste, Überschriften, Landmarks
  (Web und Website). Weitere Korrekturen für Web und iOS laufen noch.

---

## 3. Umgebungsvariablen (Coolify, `tohuus-cloud`)

| Variable | Wofür | Ohne sie |
|---|---|---|
| `APNS_KEY_ID`, `APNS_TEAM_ID=FVS7WVTQ67`, `APNS_KEY_P8` | Mitteilungen aufs iPhone | keine Push-Mitteilungen; die App zeigt einen Hinweis |
| `APNS_ENV` | **leer lassen oder `production`** – TestFlight nutzt den Produktions-Push, `sandbox` geht nur für Xcode-Builds | – |
| `BACKUP_S3_*` | nächtliche Sicherung außerhalb des Servers (siehe [cloud.md](cloud.md)) | Sicherungen liegen auf demselben Volume |
| `LEGAL_PRIVACY_URL`, `LEGAL_TERMS_URL`, `LEGAL_IMPRINT_URL` | Links in den Apps | Apps nehmen die Seiten der Website |
| `APPLE_SIWA_KEY_ID`, `APPLE_SIWA_KEY_P8`, `APPLE_TEAM_ID` | Widerruf von „Mit Apple anmelden“ beim Löschen (Apple-Pflicht) | Widerruf fehlt |
| `MIN_IOS_BUILD` | ältere Builds zeigen nur „Bitte aktualisieren“ | alle Builds laufen |
| `TRUST_PROXY_HOPS=2` | nur wenn Cloudflare die Cloud-Domain proxyt (orange Wolke) | alle Tester teilen sich eine IP für die Limits |

---

## 4. Kurztest auf dem iPhone

- Anmelden mit Apple, mit Mail-Code und mit Passwort. Neues Konto mit Zugangscode.
- Nach der Anmeldung: Frage „KI nutzen? Du entscheidest.“ erscheint einmal. „Ohne KI weiter“ → Sprechen antwortet
  einfach. Mehr › Mit oder ohne KI → zustimmen → Sprechen nutzt KI.
- Mehr › Mitteilungen: „Test-Mitteilung senden“ kommt an. „Per Mail“ → Schalter „Mails von ToHuus“.
- Einstellungen: Version zeigt „1.0.0 (Build)“, „Feedback senden“ öffnet eine Mail mit Version.
- Konto löschen mit Apple-Konto: geht durch, das Konto taucht unter Apple-ID › Mit Apple anmelden nicht mehr auf
  (nur wenn die `APPLE_SIWA_*`-Werte gesetzt sind).
- Flugmodus, etwas auf die Liste setzen, iPhone sperren, per Siri etwas hinzufügen, entsperren, Flugmodus aus: alles
  kommt an.

---

## 5. App Store Connect und Review (machst du)

- **Datenschutz-Angaben** in App Store Connect an das Manifest anpassen: Gesundheit (Allergien), Audio, Fotos,
  E-Mail, Name, Nutzer-ID, Kaufverlauf, Finanzinfos, Diagnose – alles „mit dir verknüpft“, kein Tracking.
- **Altersfreigabe**: die neuen Fragen zu KI-Inhalten beantworten (Assistent beschränkt auf Haushalt, mit Filter).
- **Review-Notizen**: Testkonto mit Zugangscode, Hinweis auf die KI-Zustimmung, dass Abos während der Beta
  geschenkt sind und wo die Preise stehen.
- **Rechtstexte**: Website zeigt noch „Entwurf, rechtlich nicht geprüft“. Ob das für TestFlight bleibt oder vor dem
  Store raus muss, entscheidest du.
- **TestFlight**: Builds laufen nach 90 Tagen ab. Feedback und Abstürze der Tester landen in App Store Connect ›
  TestFlight › Feedback, nicht in deiner Mail.

---

## 6. Offen

- Barrierefreiheit iOS (Undo-Leisten im Dunkelmodus, Tap-Ziele, Bewegung reduzieren) – in Arbeit.
- Marketing-Website auf den neuen Stand bringen (Plus-Rezepte, Bons per Mail, KI-Zustimmung, Preise) – als Nächstes.
- Für Einladungen gibt es in der App keinen „Ich habe eine Einladung“-Weg. Tester mit Einladung öffnen den Link im
  Browser; bitte im Testerbrief erwähnen.
