# Übergabe 15.10.2026: Release 1.0, Lizenz-Codes, alles Neue

Stand: 15.10.2026, mittags. Branch `claude/gallant-clarke-0rmbhq`, PR #7 nach `main`. Ausführlich im Repo: `CHANGELOG.md` (Unreleased), `docs/release-1.0.md` und die Docs zu den einzelnen Bereichen.

## Entscheidung: Die Beta ist vorbei

ToHuus geht als **1.0 in den App Store**. Interessierte bekommen keine TestFlight-Plätze mehr, sondern **kostenlose Lizenz-Codes**: ein Monat, ein Jahr oder für immer.

**Bedingung:** Build 10 wird einmal in Xcode gebaut und auf einem echten iPhone kurz getestet. Von Linux aus geht das nicht. Dort liefen nur der Swift-Parse, der API-Vertragscheck und die Übersetzungsprüfung.

### Schritte für Till

1. **Coolify `tohuus-cloud`:** `CLOUD_SIGNUP` entfernen (oder auf `open` setzen), `BETA_GIFT` entfernen und `main` deployen.
2. **/betrieb:**
   * Einstellungen › Anmeldung auf „open“ setzen.
   * Unter Geschenke „Geschenk für alle Haushalte“ ausschalten.
   * Codes für die Tester anlegen, z. B. Plus für immer, ein Code pro Haushalt.
3. **iOS:**
   * `cd ios && xcodegen generate`, dann in Xcode bauen und auf dem iPhone testen.
   * Archivieren und mit `app-store-connect` hochladen.
   * Version 1.0 mit Build 10 zur Prüfung einreichen. Texte stehen in `docs/app-store-texte.md`, Hinweise für die Prüfung in `docs/ios-app-review.md`.
4. **Tester:** Mail mit App-Store-Link und Code. Eingelöst wird im Browser unter Einstellungen › Abo › Code einlösen.

## Lizenz-Codes

* **Anlegen:** /betrieb › Geschenke › „Neue Geschenk-Codes“.
  * Dauer: Ein Monat, Ein Jahr, Für immer oder eine Zahl von Tagen.
  * Plan: Haushalt oder Plus.
  * Bis zu 50 Codes auf einmal, mit „Alle kopieren“.
* **Einlösen:** im Web, von einer Admin-Person des Haushalts. Danach gilt der Code auf allen Geräten, auch auf dem iPhone.
* **iPhone-App:** Sie hat bewusst **kein Code-Feld**. Apple-Regel 3.1.1 verbietet eigene Freischaltcodes in der App. Für Abos könnte man später Apples eigene Offer Codes nutzen.
* **Härtefälle:** Das Formular „Wir können uns das nicht leisten“ auf der Website landet unter /betrieb › Härtefälle und per Mail bei den Betreibern; die Adresse ist nirgends zu sehen. Ein Klick schickt der Person einen Code.

## Preise

* **Free:** ohne KI (Assistent, Bon-KI, Import-KI = 0), 30 Tage Verlauf, 20 Uploads pro Tag, 100 MB.
* **Testphase:** 14 Tage Plus starten automatisch, ohne Zahlungsdaten.
* **Haushalt:** 3,99 € im Monat oder 34,99 € im Jahr.
* **Plus:** 5,99 € im Monat oder 59,99 € im Jahr.
* **Selbst hosten:** kostenlos, mit eigener oder ohne KI.
* Auf der Website steht ehrlich: Abos finanzieren Lizenzen für Familien, die es sich nicht leisten können. Keine Werbung, keine Datenverkäufe.

## Neu seit dem 14.10.

* **Rückblick:**
  * Woche und Monat, pro Person und Haushalt, nur positiv.
  * Als Bild teilen in Story 9:16 oder Feed 4:5.
  * „Aufgaben teilen“: Man wählt selbst bis zu 6 erledigte Aufgaben fürs Bild.
* **Im Kopf und „nebenbei erledigt“:**
  * Privat oder geteilt, jederzeit umstellbar.
  * Mehrere Gedanken auf einmal (Brain-Dump) und ein weiches „Bis wann?“.
  * Aufräumen per Wischen: „Was davon ist noch wichtig?“
* **Unterwegs:**
  * Für alle oder einzelne Personen, mit Anlass: Urlaub, Dienstreise, Feier, Krankenhaus.
  * „Was passiert zu Hause“: Wer übernimmt welche Aufgabe, was darf warten.
  * Was nicht warten kann (Müll, Tiere), erinnert trotzdem.
  * Easteregg im Kopfbereich: „Nich to Huus“.
* **Gäste helfen mit:** Feste Gäste wie Oma bekommen Aufgaben, sehen nur ihre eigenen und haken sie ab.
* **Abendfrage „Was habt ihr heute gelöst?“:** jeden zweiten Abend, macht Zusammenarbeit sichtbar.
* **Für wen ich da bin:**
  * Angehörige zu Hause, in der eigenen Wohnung oder im Pflegeheim; Besuche und Termine.
  * Links zu offizieller Hilfe.
  * Gesundheitsdaten bleiben privat und gehen nie an KI, MCP oder Home Assistant.
* **Alleinerziehend wird erkannt**, nie abgefragt. „Du machst das seit Wochen“ zeigt Dank statt Vergleich.
* **Wischen zum Entscheiden:** „Was schaffst du heute?“, „Was essen wir diese Woche?“ (ein „Gern“ legt das Gericht auf einen freien Abend) und Im Kopf aufräumen. Höchstens 10 Karten, immer auch mit Knöpfen.
* **Fakten-Karten mit Primärquellen:** in der App, auf der Website, im Ratgeber und auf der Teilen-Seite.
* **Tour in der iOS-App:** überspringbar. **„Was ist neu“** erscheint kurz nach Updates.
* **Assistent:**
  * Kann jetzt Im Kopf, den Rückblick, „Wer ist weg?“ samt „Was passiert zu Hause“ und Gäste als Erledigende.
  * Allgemeine Haushaltsfragen beantwortet er als Richtwert.
  * Private Gedanken und Gesundheitsdaten sieht er nie.
* **Export nach Notizen und Mail:** Listen und Ideen lassen sich als Text teilen.

## Design

Überarbeitet nach der Methode des Design-Skills, aber im eigenen Look „Dutch Detail“:

* **Share-Karten:** Der Text füllt das Bild. Eine gemeinsame Skala für Zahl, Titel, Text und Liste gilt in Web, iOS und auf der Website. Kein Text mit Transparenz.
* **Web-App:** Zweittexte haben keine Transparenz mehr; der Kontrast-Check besteht für alle Paare.
* **iOS:** Tap-Ziele mindestens 44 pt, große Schrift wird nicht mehr abgeschnitten, Chips folgen Dutch Detail.
* **Website:**
  * Größere Typo-Stufen, Regeln statt Kartenraster.
  * „Im App Store laden“ statt TestFlight.
  * Neue Screenshots.

## Security-Review

Alle relevanten Funde sind behoben und getestet:

* **Export:** keine fremden privaten Gedanken und keine fremden privaten Pflege-Daten mehr.
* **Aufgaben für gepflegte Menschen:** Sie gehen nicht mehr an Webhooks, Home Assistant, Chat-Kanäle, Kiosk, Drucker, Tickets, den Sitter-Zettel oder MCP-Checklisten. Wird die Person gelöscht, werden ihre Aufgaben mitgelöscht.
* **Krankenhaus-Aufenthalt:** erscheint nach außen nur als „weg“. Die Packliste ist über MCP nicht abrufbar.
* **Härtefall-Formular:** geht durch den CSRF-Schutz, aber nur von der eigenen Website. Rate-Limit und Honeypot sind aktiv.

## Fragen von Till, beantwortet

* **Web gleich iOS?** Ja, funktional. Seit heute plant auch der Essens-Stapel im Web wie auf iOS.
* **Cloud und Self-Host?** Beide laufen im automatischen Test aller 71 Ansichten.
  * Die Fenster, die das Test-Skript nicht öffnen konnte, lagen an fehlenden Testdaten.
  * Die CSP-Meldung ließ sich nicht nachstellen, und im App-Code steht kein eval.
* **Psychologie:** passt zur Forschung.
  * Mental Load sichtbar machen ohne Punkte, Rankings oder Streaks.
  * Kleine, geordnete Auswahlen statt langer Listen.
  * Erst ablegen, dann sortieren (wie in ADHS-Apps); loslassen ist erlaubt.
  * Wir versprechen keine Wirkung, nur wie ToHuus gebaut ist.
* **Apple Intelligence:**
  * ChatGPT ist seit iOS 18.2 per Opt-in nutzbar, in der EU und auf Deutsch seit 18.4.
  * Die neue Siri ist auf EU-iPhones noch nicht verfügbar.
  * ToHuus nutzt KI auf dem Gerät nur als Zusatz, mit Ersatzweg. Der Kern ist Mistral auf EU-Servern.
* **Beta beenden?** Ja, siehe oben.

## Offen

* **iOS:** Build 10 in Xcode bauen und auf dem Gerät testen, besonders die neuen Share-Karten (gerendert mit Systemschrift) und die Sprachprüfung in OnDeviceAI (iOS 26).
* **Website:** Sie ist mit 19 Abschnitten lang. Zum Kürzen kommen in Frage:
  * „Ruhig gebaut“, das sich mit „Für Köpfe“ überschneidet;
  * die Tabelle „Zwei Wege“;
  * die sechs gleich gebauten Funktionsabschnitte.
* **Formulierungen zum Prüfen:** der neue Datenschutz-Absatz zu Codes und „Wochenfrage (Testphase)“ in der App, ob das noch „Testphase“ heißen soll.
