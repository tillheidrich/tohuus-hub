# Übergabe Nacht 13./14.10.2026

Wiki: „Übergabe Nacht 13./14.10.2026: Stand nach Datenverlust, Feedback und PDF-Fix“ (Collection ToHuus Hub / Fredirando).

## Stand
- `main` = Cloud-Deploy (`tohuus-cloud`), dauerhafter Speicher auf `/data` seit 13.10. 20:09 UTC; vorher löschte jeder Deploy alle Konten.
- iOS Build 8 in TestFlight.
- Neu an diesem Abend: Platt-Begrüßung (`server/lib/platt.ts`, `server/data/platt.json`, Website-Hero), eigenen Namen ändern (`PATCH /api/cloud/me`), Hausinfo „Verbergen“ auf dem iPhone, `CLOUD_RECIPES_PUBLISH_ALL`, Store-Texte (`docs/app-store-texte.md`), Schutz in `list_add` (keine Antworten, Mengen als Notiz), Übersetzungen für LC/LCF-Schlüssel (`ios/tools/gen_strings.py`).

## PDF-Fix (wichtig)
In der Cloud sind gespeicherte Dateien verschlüsselt (`images.ts › writeStoredFile`). Externe Programme (pdftotext, tesseract …) dürfen nie den gespeicherten Pfad lesen, immer erst `readStoredFile` → Temp-Datei. `pdfToText` macht das seit `93c5407`. Neue Funktionen mit Dateien brauchen einen Test im Cloud-Modus (`test/admin-host.test.ts` zeigt, wie).

## Offen
1. Till legt sein Konto neu an und richtet den Authenticator auf betrieb.tohuus.heidrich-digital.de ein.
2. App-Review-Demokonto neu anlegen.
3. Vor App-Store-Einreichung: Vertrag für kostenpflichtige Apps, Abos anlegen, Beta-Geschenk aus, Anmeldung öffnen.
4. Schalter für `today.platt` in den Einstellungen.
